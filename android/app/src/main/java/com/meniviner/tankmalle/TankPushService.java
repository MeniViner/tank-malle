package com.meniviner.tankmalle;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class TankPushService extends FirebaseMessagingService {
    static final String PREFERENCES = "tank-malle-push";
    static final String EXTRA_OWNER = "tank-malle.push.owner";
    static final String EXTRA_ROUTE = "tank-malle.push.route";
    private static final String CHANNEL = "tank-malle-reminders";
    private static final String TAG = "tank-malle-remote";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String uid = data.get("uid");
        String owner = getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("owner", null);
        if (uid == null || !uid.equals(owner)) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return;
        String route = data.get("route");
        if (route == null || (!route.startsWith("/open?") && !route.equals("/notifications")) || route.length() > 1024) return;
        String event = data.get("event");
        if (event == null || event.length() > 196) return;
        int notificationId = event.hashCode();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "תזכורות רכב", NotificationManager.IMPORTANCE_HIGH));
        }

        Intent intent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_OWNER, uid).putExtra(EXTRA_ROUTE, route);
        PendingIntent open = PendingIntent.getActivity(this, notificationId, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String body = "יש תזכורת חדשה לרכב שלך";
        if ("test".equals(event)) body = "התראת בדיקה מטנק מלא";
        manager.notify(TAG, notificationId, new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_push)
                .setContentTitle("טנק מלא")
                .setContentText(body)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build());
    }

    static void clearVisible(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        for (StatusBarNotification notification : manager.getActiveNotifications()) {
            if (TAG.equals(notification.getTag())) manager.cancel(TAG, notification.getId());
        }
    }
}
