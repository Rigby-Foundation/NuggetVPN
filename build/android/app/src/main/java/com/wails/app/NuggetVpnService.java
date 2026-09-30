package com.wails.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * The VPN itself, as Android sees it: a foreground service that builds the
 * tunnel interface on the core's instructions and hands its descriptor to
 * Go, which reads and writes packets from then on.
 */
public class NuggetVpnService extends VpnService {
    private static final String TAG = "NuggetVpnService";
    private static final String CHANNEL = "vpn";
    private static final int NOTIFICATION_ID = 1;

    private static volatile NuggetVpnService current;
    private static volatile CountDownLatch started;

    /** Starts the service if it is not running, and waits until it is. */
    static NuggetVpnService start(Context context, long timeoutMillis) throws Exception {
        NuggetVpnService running = current;
        if (running != null) {
            return running;
        }
        started = new CountDownLatch(1);
        ContextCompat.startForegroundService(context, new Intent(context, NuggetVpnService.class));
        if (!started.await(timeoutMillis, TimeUnit.MILLISECONDS) || current == null) {
            throw new Exception("The VPN service did not start.");
        }
        return current;
    }

    static NuggetVpnService current() {
        return current;
    }

    static void stop() {
        NuggetVpnService running = current;
        current = null;
        if (running != null) {
            ServiceCompat.stopForeground(running, ServiceCompat.STOP_FOREGROUND_REMOVE);
            running.stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        showNotification();
        current = this;
        CountDownLatch latch = started;
        if (latch != null) latch.countDown();
        // If Android stops it, the core notices the tunnel is gone; it is not
        // brought back without the app.
        return START_NOT_STICKY;
    }

    private void showNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.vpn_channel), NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_vpn)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.vpn_connected))
                .setContentIntent(openApp())
                .setOngoing(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * Builds the interface from the core's options and returns its
     * descriptor, which the caller then owns.
     */
    int establish(JSONObject options) throws Exception {
        Builder builder = new Builder()
                .setSession(getString(R.string.app_name))
                .setMtu(options.optInt("mtu", 9000))
                .setConfigureIntent(openApp());
        if (Build.VERSION.SDK_INT >= 29) {
            builder.setMetered(false);
        }
        JSONArray addresses = options.optJSONArray("addresses");
        for (int i = 0; addresses != null && i < addresses.length(); i++) {
            String[] parts = addresses.getString(i).split("/");
            builder.addAddress(parts[0], Integer.parseInt(parts[1]));
        }
        JSONArray routes = options.optJSONArray("routes");
        for (int i = 0; routes != null && i < routes.length(); i++) {
            String[] parts = routes.getString(i).split("/");
            builder.addRoute(parts[0], Integer.parseInt(parts[1]));
        }
        JSONArray dns = options.optJSONArray("dns");
        for (int i = 0; dns != null && i < dns.length(); i++) {
            builder.addDnsServer(dns.getString(i));
        }
        JSONArray include = options.optJSONArray("include_package");
        JSONArray exclude = options.optJSONArray("exclude_package");
        if (include != null && include.length() > 0) {
            for (int i = 0; i < include.length(); i++) {
                try {
                    builder.addAllowedApplication(include.getString(i));
                } catch (PackageManager.NameNotFoundException ignored) {
                    // Not installed here.
                }
            }
        } else {
            // The app itself stays in: its speed test and address check are
            // meant to go through the tunnel. The core's own sockets are kept
            // out one by one, with protect().
            for (int i = 0; exclude != null && i < exclude.length(); i++) {
                try {
                    builder.addDisallowedApplication(exclude.getString(i));
                } catch (PackageManager.NameNotFoundException ignored) {
                    // Not installed here.
                }
            }
        }
        ParcelFileDescriptor descriptor = builder.establish();
        if (descriptor == null) {
            throw new Exception("Android refused to create the VPN; the permission may have been withdrawn.");
        }
        return descriptor.detachFd();
    }

    @Override
    public void onRevoke() {
        Log.i(TAG, "revoked");
        NuggetBridge.nativeRevoked();
        stop();
    }

    @Override
    public void onDestroy() {
        if (current == this) {
            current = null;
        }
        super.onDestroy();
    }
}
