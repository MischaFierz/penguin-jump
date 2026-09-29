package game.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

/**
 * Self-update of the Android app.
 * 1. downloads {BASE_URL}/version.json and version.json.sig and checks the ECDSA P-256 signature
 *    against the public key compiled into the app (same key as the desktop game),
 * 2. downloads the APK named in the signed manifest (HTTPS only) and checks its SHA-256,
 * 3. checks that the APK is signed with the same certificate as the installed app,
 * 4. hands it to the system installer (Android itself refuses updates signed with another key).
 * Progress and errors are reported to the game via window.onUpdateProgress / onUpdateFailed.
 */
final class Updater {
    private final Activity activity;
    private final WebView web;
    private volatile boolean running;
    private File pendingApk;

    Updater(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    void start() {
        if (running) return;
        running = true;
        new Thread(this::run, "updater").start();
    }

    void onResume() {
        if (pendingApk != null && canInstall()) {
            File apk = pendingApk;
            pendingApk = null;
            install(apk);
        }
    }

    private void run() {
        try {
            String base = BuildConfig.BASE_URL;
            if (!base.startsWith("https://")) throw new SecurityException("no https server configured");
            long t = System.currentTimeMillis();
            byte[] manifest = get(base + "/version.json?t=" + t, 256 * 1024);
            String sig = new String(get(base + "/version.json.sig?t=" + t, 4096), StandardCharsets.US_ASCII).trim();
            if (!verify(manifest, sig)) throw new SecurityException("bad manifest signature");

            JSONObject android = new JSONObject(new String(manifest, StandardCharsets.UTF_8)).getJSONObject("downloads").getJSONObject("android");
            String url = android.getString("url");
            byte[] expected = hex(android.getString("sha256"));
            if (!url.startsWith("https://") || expected.length != 32) throw new SecurityException("bad manifest entry");

            File dir = new File(activity.getCacheDir(), "updates");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File apk = new File(dir, "update.apk");
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            HttpURLConnection c = open(url);
            long total = c.getContentLengthLong(), done = 0;
            byte[] buf = new byte[65536];
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                int n;
                long lastReport = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    sha.update(buf, 0, n);
                    done += n;
                    if (done > 300L * 1024 * 1024) throw new SecurityException("too large");
                    if (total > 0 && System.currentTimeMillis() - lastReport > 150) {
                        lastReport = System.currentTimeMillis();
                        progress(Math.min(0.99, done / (double) total));
                    }
                }
            } finally {
                c.disconnect();
            }
            if (!MessageDigest.isEqual(sha.digest(), expected)) throw new SecurityException("checksum mismatch");
            if (!sameSigner(apk)) throw new SecurityException("apk signed by a different key");

            progress(1);
            activity.runOnUiThread(() -> install(apk));
        } catch (Exception e) {
            js("window.onUpdateFailed && window.onUpdateFailed()");
        } finally {
            running = false;
        }
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.getPackageManager().canRequestPackageInstalls();
    }

    private void install(File apk) {
        if (!canInstall()) {
            // the user has to allow this app to install updates once; we continue in onResume
            pendingApk = apk;
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(i);
    }

    // ------------------------------------------------------------------ helpers
    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true); // GitHub release downloads redirect (https -> https only)
        int code = c.getResponseCode();
        if (code != 200 || !"https".equals(c.getURL().getProtocol())) throw new SecurityException("http " + code);
        return c;
    }

    private static byte[] get(String url, int max) throws Exception {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > max) throw new SecurityException("too large");
            }
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    /** ECDSA P-256 / SHA-256; the signature is raw r||s (64 bytes) like WebCrypto/.NET, Java needs DER. */
    static boolean verify(byte[] data, String sigBase64) {
        try {
            byte[] raw = Base64.decode(sigBase64, Base64.DEFAULT);
            if (raw.length != 64 || BuildConfig.UPDATE_KEY.isEmpty()) return false;
            PublicKey key = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Base64.decode(BuildConfig.UPDATE_KEY, Base64.DEFAULT)));
            java.security.Signature s = java.security.Signature.getInstance("SHA256withECDSA");
            s.initVerify(key);
            s.update(data);
            return s.verify(toDer(raw));
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] toDer(byte[] raw) {
        byte[] r = new BigInteger(1, Arrays.copyOfRange(raw, 0, 32)).toByteArray();
        byte[] s = new BigInteger(1, Arrays.copyOfRange(raw, 32, 64)).toByteArray();
        byte[] der = new byte[6 + r.length + s.length];
        der[0] = 0x30;
        der[1] = (byte) (4 + r.length + s.length);
        der[2] = 0x02;
        der[3] = (byte) r.length;
        System.arraycopy(r, 0, der, 4, r.length);
        der[4 + r.length] = 0x02;
        der[5 + r.length] = (byte) s.length;
        System.arraycopy(s, 0, der, 6 + r.length, s.length);
        return der;
    }

    @SuppressWarnings("deprecation")
    private boolean sameSigner(File apk) {
        try {
            PackageManager pm = activity.getPackageManager();
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo mine = pm.getPackageInfo(activity.getPackageName(), flags);
            PackageInfo other = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
            if (other == null || !activity.getPackageName().equals(other.packageName)) return false;
            Signature[] a, b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                if (mine.signingInfo == null || other.signingInfo == null) return false;
                a = mine.signingInfo.getApkContentsSigners();
                b = other.signingInfo.getApkContentsSigners();
            } else {
                a = mine.signatures;
                b = other.signatures;
            }
            return a != null && b != null && a.length > 0 && Arrays.equals(a, b);
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] hex(String s) {
        if (s.length() % 2 != 0) return new byte[0];
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        return out;
    }

    private void progress(double p) {
        js("window.onUpdateProgress && window.onUpdateProgress(" + p + ")");
    }

    private void js(String code) {
        activity.runOnUiThread(() -> web.evaluateJavascript(code, null));
    }
}
