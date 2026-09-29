using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Platformer.Core;

public sealed record LeaderboardEntry(int Rank, string Name, bool Registered, int TimeTicks, int Score, int Coins);

/// <summary>Result of an API call: either data or an error key ("error", "rejected", "nick_taken", ...).</summary>
public sealed record OnlineResult<T>(T? Data, string? Error)
{
    public bool Ok => Error == null;
}

/// <summary>
/// Client for the game server API ({baseUrl}/api/v1). HTTPS only; the login is a bearer token
/// (never the password) stored in the save file. All calls are asynchronous - scenes poll the tasks.
/// </summary>
public static class Online
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
    {
        Timeout = TimeSpan.FromSeconds(20)
    };

    public static bool Enabled => GameConfig.BaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                                  || GameConfig.BaseUrl.StartsWith("http://127.0.0.1", StringComparison.Ordinal);

    public static bool LoggedIn => !string.IsNullOrEmpty(SaveData.Current.OnlineToken);
    public static string? Username => SaveData.Current.OnlineUser;
    private static string Client => "desktop-" + Updater.PlatformKey;

    private static async Task<OnlineResult<JsonNode>> Call(HttpMethod method, string path, object? body = null, bool auth = true)
    {
        if (!Enabled) return new(null, "not_configured");
        try
        {
            using var req = new HttpRequestMessage(method, $"{GameConfig.BaseUrl}/api/v1{path}");
            if (body != null) req.Content = JsonContent.Create(body);
            if (auth && LoggedIn) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", SaveData.Current.OnlineToken);
            using var resp = await Http.SendAsync(req);
            var text = await resp.Content.ReadAsStringAsync();
            var json = string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
            if (resp.StatusCode == HttpStatusCode.Unauthorized && auth && LoggedIn && path != "/auth/login")
            {
                // token expired or revoked: forget it
                SaveData.Current.OnlineToken = null;
                SaveData.Save();
            }
            if (!resp.IsSuccessStatusCode) return new(null, json?["error"]?.GetValue<string>() ?? "error");
            return new(json, null);
        }
        catch
        {
            return new(null, "error");
        }
    }

    /// <summary>Asks the server for a run id when a level starts (needed to submit the run later).</summary>
    public static async Task<string?> StartRun(string levelId)
    {
        var r = await Call(HttpMethod.Post, "/runs", new { level = levelId }, auth: false);
        return r.Data?["run"]?.GetValue<string>();
    }

    public static async Task<OnlineResult<JsonNode>> Submit(string run, string levelId, string replay, int timeTicks, int score, int coins, string? nickname)
    {
        return await Call(HttpMethod.Post, "/scores", new
        {
            run, level = levelId, replay, nickname = LoggedIn ? null : nickname, client = Client,
            result = new { timeTicks, score, coins }
        });
    }

    public static async Task<OnlineResult<List<LeaderboardEntry>>> Top(string levelId, string by, int limit = 10)
    {
        var r = await Call(HttpMethod.Get, $"/scores?level={Uri.EscapeDataString(levelId)}&by={by}&limit={limit}", auth: false);
        if (!r.Ok) return new(null, r.Error);
        var list = r.Data?["entries"]?.AsArray().Select(e => new LeaderboardEntry(
            e!["rank"]!.GetValue<int>(), e["name"]!.GetValue<string>(), e["registered"]!.GetValue<bool>(),
            e["timeTicks"]!.GetValue<int>(), e["score"]!.GetValue<int>(), e["coins"]!.GetValue<int>())).ToList() ?? new();
        return new(list, null);
    }

    /// <summary>Login or registration; on success the token is stored. Registration also returns the recovery code.</summary>
    public static async Task<OnlineResult<string?>> Authenticate(string username, string password, bool register)
    {
        var r = await Call(HttpMethod.Post, register ? "/auth/register" : "/auth/login", new { username, password, client = Client }, auth: false);
        if (!r.Ok) return new(null, r.Error);
        SaveData.Current.OnlineToken = r.Data!["token"]!.GetValue<string>();
        SaveData.Current.OnlineUser = r.Data!["username"]!.GetValue<string>();
        SaveData.Save();
        return new(register ? r.Data!["recoveryCode"]?.GetValue<string>() : null, null);
    }

    public static async Task Logout()
    {
        await Call(HttpMethod.Post, "/auth/logout", new { });
        SaveData.Current.OnlineToken = null;
        SaveData.Current.OnlineUser = null;
        SaveData.Save();
    }

    // ------------------------------------------------------------------ levels
    /// <summary>The published main levels (null if unchanged / offline).</summary>
    public static async Task<JsonNode?> MainLevels(string knownVersion)
    {
        if (!Enabled) return null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"{GameConfig.BaseUrl}/api/v1/levels/main");
            req.Headers.TryAddWithoutValidation("If-None-Match", $"\"{knownVersion}\"");
            using var resp = await Http.SendAsync(req);
            if (resp.StatusCode != HttpStatusCode.OK) return null;
            var j = JsonNode.Parse(await resp.Content.ReadAsStringAsync());
            return j?["version"]?.GetValue<string>() == knownVersion ? null : j;
        }
        catch
        {
            return null;
        }
    }

    public static Task<OnlineResult<JsonNode>> Community(string sort, string q, int page) =>
        Call(HttpMethod.Get, $"/community?sort={sort}&page={page}&q={Uri.EscapeDataString(q)}");

    public static Task<OnlineResult<JsonNode>> CommunityLevel(string code) => Call(HttpMethod.Get, "/community/" + code);
    public static Task<OnlineResult<JsonNode>> Like(string code) => Call(HttpMethod.Post, $"/community/{code}/like", new { });
    public static Task<OnlineResult<JsonNode>> Report(string code, string reason) => Call(HttpMethod.Post, $"/community/{code}/report", new { reason });
    public static Task<OnlineResult<JsonNode>> MyLevels() => Call(HttpMethod.Get, "/my/levels");

    public static Task<OnlineResult<JsonNode>> SaveLevel(string? code, string title, int world, IEnumerable<string> rows) =>
        Call(HttpMethod.Post, code == null ? "/my/levels" : "/my/levels/" + code, new { title, world, rows = rows.ToArray() });

    public static async Task<OnlineResult<string>> StartVerifyRun(string code)
    {
        var r = await Call(HttpMethod.Post, "/runs", new { level = code, purpose = "verify" });
        return r.Ok ? new(r.Data!["run"]!.GetValue<string>(), null) : new(null, r.Error);
    }

    public static Task<OnlineResult<JsonNode>> Publish(string code, string run, string replay, int timeTicks, int score) =>
        Call(HttpMethod.Post, $"/my/levels/{code}/publish", new { run, replay, result = new { timeTicks, score } });

    /// <summary>Translation key for an error returned by the API.</summary>
    public static string ErrorKey(string? error) => error switch
    {
        "not_configured" => "online.not_configured",
        "nick_format" => "online.name_invalid",
        "nick_bad" or "nick_taken" => "online.name_taken",
        "login_failed" => "online.login_failed",
        "too_many" => "online.too_many",
        "password_short" or "password_long" or "password_weak" => "online.password_weak",
        "username_format" or "username_taken" => "online.user_taken",
        "rejected" or "bad_run" or "run_expired" or "bad_replay" => "online.rejected",
        "not_found" or "bad_level" => "editor.not_found",
        "level_start" => "editor.need_start",
        "level_goal" => "editor.need_goal",
        "level_width" => "editor.too_small",
        "title_format" => "editor.title_short",
        "title_bad" => "online.name_taken",
        "too_many_levels" => "editor.too_many",
        "draft_changed" => "editor.draft_changed",
        "login_required" => "editor.login_needed",
        _ => "online.error"
    };

    public static string FormatTime(int ticks)
    {
        int cs = ticks * 100 / 120;
        return $"{cs / 6000}:{cs / 100 % 60:D2}.{cs % 100:D2}";
    }
}
