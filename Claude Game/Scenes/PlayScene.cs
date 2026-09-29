using Platformer.Core;
using Platformer.Game;
using Raylib_cs;

namespace Platformer.Scenes;

public sealed class PlayScene : IScene
{
    private enum Mode { Intro, Playing, Paused, Complete, GameOver, Victory }

    private readonly int _index;
    private readonly LevelData _data;
    private Stage _stage;
    private Mode _mode = Mode.Intro;
    private float _modeTime, _accumulator;
    private bool _pendingJump, _pendingAction;

    /// <summary>Inputs of the current attempt (from level start, across respawns) - sent for online highscores.</summary>
    private readonly Replay _replay = new();
    private bool _recording = true;
    private readonly Task<string?>? _runTask;   // server run id, requested at level start (online highscores)
    private int _finalTimeTicks, _finalScore;
    private readonly Menu _menu = new();
    private bool _newRecord;
    private int _timeBonus;

    public PlayScene(int index, CheckpointState? cp = null)
    {
        _index = index;
        _data = LevelData.Load(Session.Levels[index]);
        _stage = CreateStage(cp);
        Audio.PlayMusic(_data.World);
        if (Online.Enabled && cp == null) _runTask = Online.StartRun(_data.Id);
    }

    private bool CanSubmit => Online.Enabled && _finalTimeTicks > 0;
    private int EndMenuCount => CanSubmit ? 3 : 2;

    private void GoSubmit(Func<IScene> next)
    {
        string? run = _runTask is { IsCompletedSuccessfully: true } ? _runTask.Result : null;
        SceneManager.Go(new SubmitScene(new SubmitScene.Run(_data.Id, run, _replay.Encode(), _finalTimeTicks, _finalScore, _stage.Coins), next));
    }

    private Stage CreateStage(CheckpointState? cp)
    {
        var st = new Stage(_data, cp);
        st.PlayerDied += OnPlayerDied;
        st.LevelCompleted += OnLevelCompleted;
        st.ExtraLife += () => Session.Lives++;
        return st;
    }

    private void SetMode(Mode m)
    {
        _mode = m;
        _modeTime = 0;
        _menu.Selected = 0;
    }

    private void OnPlayerDied()
    {
        Session.Lives--;
        if (Session.Lives < 0)
        {
            Audio.Play(Sfx.GameOver);
            SetMode(Mode.GameOver);
            return;
        }
        _stage = CreateStage(_stage.LastCheckpoint);
        Audio.PlayMusic(_data.World);
        SetMode(Mode.Intro);
    }

    private void OnLevelCompleted()
    {
        _timeBonus = RunResult.TimeBonus(_stage.TimeTicks);
        _stage.Score = _stage.FinalScore + _timeBonus;
        _finalTimeTicks = _stage.TimeTicks;
        _finalScore = _stage.Score;
        var save = SaveData.Current;
        save.Records.TryGetValue(_data.Id, out var rec);
        _newRecord = rec == null || _stage.Score > rec.Score;
        rec ??= new LevelRecord();
        rec.Score = Math.Max(rec.Score, _stage.Score);
        rec.Coins = Math.Max(rec.Coins, _stage.Coins);
        rec.TotalCoins = _stage.TotalCoins;
        rec.Time = rec.Time <= 0 ? (float)_stage.Time : Math.Min(rec.Time, (float)_stage.Time);
        save.Records[_data.Id] = rec;
        save.Unlocked = Math.Max(save.Unlocked, Math.Min(_index + 2, Session.Levels.Count));
        SaveData.Save();
        SetMode(_index + 1 >= Session.Levels.Count ? Mode.Victory : Mode.Complete);
    }

    public void Update(float dt)
    {
        _modeTime += dt;
        switch (_mode)
        {
            case Mode.Intro:
                if (_modeTime > 1.3f || (_modeTime > 0.3f && (Input.JumpPressed || Input.Confirm))) SetMode(Mode.Playing);
                break;

            case Mode.Playing:
                if (Input.PausePressed && !_stage.Completed && !_stage.Player.Dead)
                {
                    Audio.Play(Sfx.MenuSelect);
                    SetMode(Mode.Paused);
                    return;
                }
                _accumulator += MathF.Min(dt, 0.1f);
                _pendingJump |= Input.JumpPressed;
                _pendingAction |= Input.ActionPressed;
                while (_accumulator >= Phys.Step)
                {
                    // button presses of this frame go into the first tick only
                    var input = new TickInput(Input.Left, Input.Right, Input.RunHeld, Input.JumpHeld, _pendingJump, _pendingAction);
                    _pendingJump = _pendingAction = false;
                    _stage.Update(Phys.Step, input);
                    if (_recording) _replay.Add(input);
                    if (_stage.Completed) _recording = false;
                    _accumulator -= (float)Phys.Step;
                    if (_mode != Mode.Playing) break;
                }
                break;

            case Mode.Paused:
                if (Input.PausePressed || Input.Back) { SetMode(Mode.Playing); return; }
                LayoutMenu(4, 250);
                switch (_menu.Update(4))
                {
                    case 0: SetMode(Mode.Playing); break;
                    case 1: SceneManager.Go(new PlayScene(_index)); break;
                    case 2: SceneManager.Go(new LevelSelectScene()); break;
                    case 3: SceneManager.Go(new TitleScene()); break;
                }
                break;

            case Mode.Complete:
                _stage.Update(dt, TickInput.None);
                if (_modeTime < 0.8f) break;
                LayoutMenu(EndMenuCount, 440);
                switch (_menu.Update(EndMenuCount))
                {
                    case 0: SceneManager.Go(new PlayScene(_index + 1)); break;
                    case 1 when CanSubmit: GoSubmit(() => new PlayScene(_index + 1)); break;
                    case 1:
                    case 2: SceneManager.Go(new LevelSelectScene()); break;
                }
                break;

            case Mode.Victory:
                _stage.Update(dt, TickInput.None);
                if (_modeTime < 1.5f) break;
                if (!CanSubmit)
                {
                    if (Input.Confirm || Input.Back || Input.Click) SceneManager.Go(new TitleScene());
                    break;
                }
                VictoryLayout();
                switch (_menu.Update(2))
                {
                    case 0: GoSubmit(() => new TitleScene()); break;
                    case 1: SceneManager.Go(new TitleScene()); break;
                }
                break;

            case Mode.GameOver:
                if (_modeTime < 1f) break;
                LayoutMenu(2, 380);
                switch (_menu.Update(2))
                {
                    case 0:
                        Session.Lives = Session.StartLives;
                        SceneManager.Go(new PlayScene(_index));
                        break;
                    case 1: SceneManager.Go(new LevelSelectScene()); break;
                }
                break;
        }
    }

    private void VictoryLayout()
    {
        _menu.Rects.Clear();
        _menu.Rects.Add(new Rectangle(Ui.Width / 2f - 300, 560, 290, 62));
        _menu.Rects.Add(new Rectangle(Ui.Width / 2f + 10, 560, 290, 62));
    }

    private void LayoutMenu(int count, float y)
    {
        _menu.Rects.Clear();
        for (int i = 0; i < count; i++) _menu.Rects.Add(new Rectangle(Ui.Width / 2f - 220, y + i * 76, 440, 62));
    }

    public void Draw()
    {
        StageView.Draw(_stage, Session.Lives);

        switch (_mode)
        {
            case Mode.Intro:
            {
                float a = _modeTime < 1f ? 1 : 1 - (_modeTime - 1f) / 0.3f;
                Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, Art.Fade(new Color(8, 14, 34, 255), a * 0.75f));
                Ui.Title($"{Loc.T("hud.world")} {_data.Id}", Ui.Width / 2f, 250, 80, Art.Fade(Color.White, a), Art.Fade(new Color(30, 60, 130, 255), a));
                Ui.Text(Loc.T("world." + _data.World), Ui.Width / 2f, 360, 40, Art.Fade(Ui.Accent, a), Align.Center);
                Art.PenguinHead(new System.Numerics.Vector2(Ui.Width / 2f - 50, 450), 1.6f);
                Ui.Text($"× {Session.Lives}", Ui.Width / 2f - 10, 432, 40, Art.Fade(Color.White, a));
                break;
            }
            case Mode.Paused:
            {
                Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 150));
                Ui.Panel(new Rectangle(Ui.Width / 2f - 280, 140, 560, 460));
                Ui.Text(Loc.T("pause.title"), Ui.Width / 2f, 170, 52, Ui.Accent, Align.Center);
                LayoutMenu(4, 250);
                string[] items = [Loc.T("pause.resume"), Loc.T("pause.restart"), Loc.T("pause.levels"), Loc.T("pause.menu")];
                for (int i = 0; i < 4; i++) Ui.Button(_menu.Rects[i], items[i], _menu.Selected == i, 30);
                break;
            }
            case Mode.Complete:
            case Mode.Victory:
            {
                float a = MathF.Min(1, _modeTime * 3);
                Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, Art.Fade(new Color(0, 0, 0, 255), 0.5f * a));
                Ui.Panel(new Rectangle(Ui.Width / 2f - 330, 90, 660, _mode == Mode.Victory ? (CanSubmit ? 580 : 520) : 580));
                bool victory = _mode == Mode.Victory;
                Ui.Title(victory ? Loc.T("victory.title") : Loc.T("complete.title"), Ui.Width / 2f, 112, 56, Ui.Accent, new Color(60, 30, 0, 255));
                float y = 205;
                Stat(Loc.T("complete.coins"), $"{_stage.Coins} / {_stage.TotalCoins}", ref y);
                Stat(Loc.T("complete.time"), StageView.FormatTime((float)_stage.Time), ref y);
                Stat(Loc.T("complete.score"), $"{_stage.Score}  (+{_timeBonus})", ref y);
                if (_newRecord && (int)(_modeTime * 3) % 2 == 0)
                    Ui.Text(Loc.T("complete.record"), Ui.Width / 2f, y + 4, 32, new Color(120, 255, 170, 255), Align.Center);
                if (victory)
                {
                    Ui.TextBlock(Loc.T("victory.text"), Ui.Width / 2f, 440, 30, 580, Color.White);
                    if (_modeTime > 1.5f && !CanSubmit) Ui.Text(Loc.T("menu.continue") + " >", Ui.Width / 2f, 560, 26, Ui.Accent, Align.Center);
                    if (_modeTime > 1.5f && CanSubmit)
                    {
                        VictoryLayout();
                        Ui.Button(_menu.Rects[0], Loc.T("online.submit"), _menu.Selected == 0, 26);
                        Ui.Button(_menu.Rects[1], Loc.T("menu.continue"), _menu.Selected == 1, 26);
                    }
                }
                else if (_modeTime >= 0.8f)
                {
                    LayoutMenu(EndMenuCount, 440);
                    string[] items = CanSubmit ? [Loc.T("complete.next"), Loc.T("online.submit"), Loc.T("pause.levels")] : [Loc.T("complete.next"), Loc.T("pause.levels")];
                    for (int i = 0; i < items.Length; i++) Ui.Button(_menu.Rects[i], items[i], _menu.Selected == i, 30);
                }
                break;
            }
            case Mode.GameOver:
            {
                float a = MathF.Min(1, _modeTime * 2);
                Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, Art.Fade(new Color(20, 0, 10, 255), 0.7f * a));
                Ui.Title(Loc.T("gameover.title"), Ui.Width / 2f, 200, 90, Art.Fade(new Color(255, 90, 90, 255), a), Art.Fade(Color.Black, a));
                if (_modeTime >= 1f)
                {
                    LayoutMenu(2, 380);
                    Ui.Button(_menu.Rects[0], Loc.T("gameover.retry"), _menu.Selected == 0, 30);
                    Ui.Button(_menu.Rects[1], Loc.T("pause.levels"), _menu.Selected == 1, 30);
                }
                break;
            }
        }
    }

    private static void Stat(string label, string value, ref float y)
    {
        Ui.Text(label, Ui.Width / 2f - 260, y, 32, new Color(180, 210, 255, 255));
        Ui.Text(value, Ui.Width / 2f + 260, y, 32, Color.White, Align.Right);
        y += 56;
    }
}
