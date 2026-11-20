package com.meniviner.tankmalle;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.io.File;
import java.io.FileOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Tests the optimized release without relying on AndroidX/JUnit classes R8 may rename or remove. */
public class ReleaseSmokeInstrumentation extends Instrumentation {
    private String expectedOrientation;

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        expectedOrientation = arguments == null ? null : arguments.getString("expectedOrientation");
        start();
    }

    private void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private String evaluate(MainActivity activity, String script) throws Exception {
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            finished.countDown();
        }));
        check(finished.await(10, TimeUnit.SECONDS), "WebView did not return a JavaScript result");
        return result.get();
    }

    private void awaitTrue(MainActivity activity, String script) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(activity, script))) return;
            Thread.sleep(100);
        }
        throw new AssertionError("WebView condition timed out: " + script);
    }

    private void verifySafeControls(MainActivity activity) throws Exception {
        if (Build.VERSION.SDK_INT < 30) return;
        AtomicReference<JSONObject> viewport = new AtomicReference<>();
        runOnMainSync(() -> {
            try {
                View decor = activity.getWindow().getDecorView();
                View webView = activity.getBridge().getWebView();
                Insets safe = decor.getRootWindowInsets().getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                int[] location = new int[2];
                webView.getLocationOnScreen(location);
                viewport.set(new JSONObject().put("x", location[0]).put("y", location[1]).put("width", webView.getWidth())
                    .put("windowWidth", decor.getWidth()).put("height", decor.getHeight())
                    .put("top", safe.top).put("bottom", safe.bottom).put("left", safe.left).put("right", safe.right));
            } catch (Exception error) {
                throw new AssertionError(error);
            }
        });
        String safe = evaluate(activity, """
            (() => {
              const viewport = %s;
              const scale = viewport.width / window.innerWidth;
              const buttons = [...document.querySelectorAll('button')].map(button => button.getBoundingClientRect())
                .filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
              return buttons.length > 0 && buttons.every(rect =>
                viewport.y + rect.top * scale >= viewport.top - 1 &&
                viewport.y + rect.bottom * scale <= viewport.height - viewport.bottom + 1 &&
                viewport.x + rect.left * scale >= viewport.left - 1 &&
                viewport.x + rect.right * scale <= viewport.windowWidth - viewport.right + 1);
            })()
            """.formatted(viewport.get()));
        check("true".equals(safe), "Visible buttons overlap a system bar or cutout: " + viewport.get());
    }

    private void verifyInstalledIdentity() throws Exception {
        Context target = getTargetContext();
        check("טנק מלא".contentEquals(target.getApplicationInfo().loadLabel(target.getPackageManager())), "Wrong installed app name");
        File folder = new File(target.getExternalFilesDir(null), "icon-validation");
        check(folder.isDirectory() || folder.mkdirs(), "Cannot write icon validation output");
        for (boolean night : new boolean[] { false, true }) {
            Configuration config = new Configuration(target.getResources().getConfiguration());
            config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
                | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
            Context themed = target.createConfigurationContext(config);
            Drawable icon = themed.getDrawable(target.getApplicationInfo().icon);
            check(icon != null, "Missing installed launcher icon");
            if (Build.VERSION.SDK_INT >= 26) {
                check(icon instanceof AdaptiveIconDrawable, "Launcher icon is not adaptive");
                AdaptiveIconDrawable adaptive = (AdaptiveIconDrawable) icon;
                Bitmap background = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888);
                adaptive.getBackground().setBounds(0, 0, 32, 32);
                adaptive.getBackground().draw(new Canvas(background));
                check(background.getPixel(16, 16) == Color.parseColor(night ? "#121619" : "#25282B"), "Wrong day/night launcher background");
                if (Build.VERSION.SDK_INT >= 33) {
                    check(adaptive.getMonochrome() != null, "Missing themed launcher layer");
                    if (!night) {
                        Drawable mono = adaptive.getMonochrome().mutate();
                        mono.setTint(Color.parseColor("#413A52"));
                        writeIcon(new AdaptiveIconDrawable(new ColorDrawable(Color.parseColor("#E7DFF3")), mono), new File(folder, "themed.png"));
                    }
                }
            }
            writeIcon(icon, new File(folder, night ? "dark.png" : "default.png"));
        }
    }

    private void writeIcon(Drawable icon, File file) throws Exception {
        Bitmap bitmap = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888);
        icon.setBounds(0, 0, 512, 512);
        icon.draw(new Canvas(bitmap));
        try (FileOutputStream output = new FileOutputStream(file)) {
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output), "Cannot encode launcher icon");
        }
    }

    @Override
    public void onStart() {
        Bundle result = new Bundle();
        try {
            verifyInstalledIdentity();
            Intent launch = new Intent(Intent.ACTION_MAIN)
                .setClassName(getTargetContext().getPackageName(), MainActivity.class.getName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            MainActivity activity = (MainActivity) startActivitySync(launch);
            if (expectedOrientation != null) {
                int orientation = "landscape".equals(expectedOrientation)
                    ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
                runOnMainSync(() -> activity.setRequestedOrientation(orientation));
            }
            awaitTrue(activity, "!!(window.Capacitor?.nativePromise && document.querySelector('button'))");
            if (expectedOrientation != null) {
                awaitTrue(activity, "landscape".equals(expectedOrientation)
                    ? "innerWidth > innerHeight" : "innerWidth < innerHeight");
            }
            evaluate(activity, """
                (() => {
                  window.__releaseBridgeTest = null;
                  const call = (plugin, method, args = {}) => window.Capacitor.nativePromise(plugin, method, args);
                  (async () => {
                    const info = await call('App', 'getInfo');
                    const camera = await call('Camera', 'checkPermissions');
                    const notifications = await call('LocalNotifications', 'checkPermissions');
                    const share = await call('Share', 'canShare');
                    await call('SystemBars', 'setStyle', { style: 'LIGHT' });
                    await call('SystemBars', 'show');
                    const path = 'release-bridge-smoke-' + Date.now() + '.txt';
                    let read;
                    try {
                      await call('Filesystem', 'writeFile', { path, directory: 'CACHE', data: 'R8 bridge OK', encoding: 'utf8' });
                      read = await call('Filesystem', 'readFile', { path, directory: 'CACHE', encoding: 'utf8' });
                    } finally {
                      await call('Filesystem', 'deleteFile', { path, directory: 'CACHE' });
                    }
                    window.__releaseBridgeTest = { info, camera, notifications, share, file: read.data };
                  })().catch(error => { window.__releaseBridgeTest = { error: String(error) }; });
                })()
                """);
            awaitTrue(activity, "window.__releaseBridgeTest !== null");
            String json = new JSONArray("[" + evaluate(activity, "JSON.stringify(window.__releaseBridgeTest)") + "]").getString(0);
            JSONObject nativeResult = new JSONObject(json);
            check(!nativeResult.has("error"), "Native plugin failure: " + json);
            check(getTargetContext().getPackageName().equals(nativeResult.getJSONObject("info").getString("id")), "Wrong app id");
            check("טנק מלא".equals(nativeResult.getJSONObject("info").getString("name")), "Wrong native app display name");
            check(nativeResult.getJSONObject("info").getString("version").matches("\\d+\\.\\d+\\.\\d+"), "Missing app version");
            check("R8 bridge OK".equals(nativeResult.getString("file")), "Filesystem round trip failed");
            check(nativeResult.getJSONObject("camera").has("camera"), "Camera permission bridge failed");
            check(nativeResult.getJSONObject("notifications").has("display"), "Notification permission bridge failed");
            check(nativeResult.getJSONObject("share").getBoolean("value"), "Share bridge failed");
            check("true".equals(evaluate(activity, "document.documentElement.scrollWidth <= window.innerWidth + 1")), "Horizontal overflow");
            verifySafeControls(activity);
            JSONObject size = new JSONObject(new JSONArray("[" + evaluate(activity,
                "JSON.stringify({width:innerWidth,height:innerHeight})") + "]").getString(0));
            if (expectedOrientation != null) {
                boolean landscape = size.getInt("width") > size.getInt("height");
                check(landscape == "landscape".equals(expectedOrientation), "Unexpected orientation: " + size);
            }
            result.putString("viewport", size.toString());
            result.putString("stream", "\nRelease native bridge passed: " + json + "\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", "\nRelease native bridge FAILED: " + error + "\n");
            finish(Activity.RESULT_CANCELED, result);
        }
    }
}
