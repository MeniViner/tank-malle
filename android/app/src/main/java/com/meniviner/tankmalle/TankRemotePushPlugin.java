package com.meniviner.tankmalle;

import android.content.Intent;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "TankRemotePush")
public class TankRemotePushPlugin extends Plugin {
    @PluginMethod
    public void available(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", !FirebaseApp.getApps(getContext()).isEmpty());
        call.resolve(result);
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("Firebase Messaging configuration is unavailable");
            return;
        }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Unable to register this device");
                return;
            }
            JSObject result = new JSObject();
            result.put("token", task.getResult());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setOwner(PluginCall call) {
        String uid = call.getString("uid");
        if (uid == null || uid.isEmpty() || uid.length() > 128) {
            call.reject("Missing account");
            return;
        }
        if (!getContext().getSharedPreferences(TankPushService.PREFERENCES, 0).edit().putString("owner", uid).commit()) {
            call.reject("Unable to save notification preference");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void clearOwner(PluginCall call) {
        if (!getContext().getSharedPreferences(TankPushService.PREFERENCES, 0).edit().remove("owner").commit()) {
            call.reject("Unable to clear notification preference");
            return;
        }
        TankPushService.clearVisible(getContext());
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent settings = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        try {
            getActivity().startActivity(settings);
            call.resolve();
        } catch (android.content.ActivityNotFoundException error) {
            call.reject("Notification settings unavailable");
        }
    }

    @PluginMethod
    public void takeTap(PluginCall call) {
        call.resolve(take(getActivity().getIntent()));
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        JSObject event = take(intent);
        if (event.has("route")) notifyListeners("tap", event, true);
    }

    private JSObject take(Intent intent) {
        JSObject event = new JSObject();
        if (intent == null) return event;
        String uid = intent.getStringExtra(TankPushService.EXTRA_OWNER);
        String route = intent.getStringExtra(TankPushService.EXTRA_ROUTE);
        intent.removeExtra(TankPushService.EXTRA_OWNER);
        intent.removeExtra(TankPushService.EXTRA_ROUTE);
        if (uid != null && route != null) {
            event.put("uid", uid);
            event.put("route", route);
        }
        return event;
    }
}
