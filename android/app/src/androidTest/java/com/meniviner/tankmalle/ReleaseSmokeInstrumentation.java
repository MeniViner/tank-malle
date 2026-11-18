package com.meniviner.tankmalle;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
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

    @Override
    public void onStart() {
        Bundle result = new Bundle();
        try {
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
