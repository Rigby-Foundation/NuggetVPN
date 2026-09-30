package com.wails.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.RouteInfo;
import android.net.VpnService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * NuggetBridge is what the Go side (internal/android) calls into: the
 * tunnel from VpnService, keeping the core's own sockets out of it, the
 * network in use, which app owns a connection, and the Material You palette.
 *
 * Go calls these methods by name through JNI, each taking and returning a
 * string (JSON where there is structure), and Java calls back through the
 * native methods below.
 */
public final class NuggetBridge {
    private static final String TAG = "NuggetBridge";
    public static final int VPN_PERMISSION_REQUEST = 7100;

    private static native void nativeAttach(NuggetBridge bridge);
    static native void nativeDefaultNetwork(String name, int index, boolean expensive, boolean constrained);
    static native void nativeRevoked();
    static native void nativeOpenLink(String link);

    private static NuggetBridge instance;

    private final Context context;
    private volatile Activity activity;
    private volatile CountDownLatch permissionLatch;
    private volatile boolean permissionGranted;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private NuggetBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Hands the bridge to Go; called once the Go library is loaded. */
    public static synchronized void attach(Activity activity) {
        if (instance == null) {
            instance = new NuggetBridge(activity);
            nativeAttach(instance);
        }
        instance.activity = activity;
    }

    public static synchronized void detach(Activity activity) {
        if (instance != null && instance.activity == activity) {
            instance.activity = null;
        }
    }

    /** Passes a nuggetvpn:// link the app was opened with to Go. */
    public static void deliverLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        if (!"nuggetvpn".equals(intent.getData().getScheme())) return;
        nativeOpenLink(intent.getData().toString());
    }

    /** The answer to the VPN permission prompt, from MainActivity. */
    public static void onPermissionResult(boolean granted) {
        NuggetBridge bridge = instance;
        if (bridge == null) return;
        bridge.permissionGranted = granted;
        CountDownLatch latch = bridge.permissionLatch;
        if (latch != null) latch.countDown();
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("error", message == null ? "failed" : message).toString();
        } catch (Exception e) {
            return "{\"error\":\"failed\"}";
        }
    }

    // ------------------------------------------------------------------
    // The tunnel
    // ------------------------------------------------------------------

    /** Asks for the VPN permission if needed, starts the service and builds the interface. */
    public String openTun(String request) {
        try {
            Intent consent = VpnService.prepare(context);
            if (consent != null && !askPermission(consent)) {
                return error("The VPN permission was not granted.");
            }
            NuggetVpnService service = NuggetVpnService.start(context, 15_000);
            int fd = service.establish(new JSONObject(request));
            return new JSONObject().put("fd", fd).toString();
        } catch (Exception e) {
            Log.e(TAG, "openTun", e);
            return error(e.getMessage());
        }
    }

    private boolean askPermission(Intent consent) throws InterruptedException {
        Activity current = activity;
        if (current == null) {
            return false;
        }
        permissionGranted = false;
        permissionLatch = new CountDownLatch(1);
        current.runOnUiThread(() -> current.startActivityForResult(consent, VPN_PERMISSION_REQUEST));
        permissionLatch.await(2, TimeUnit.MINUTES);
        return permissionGranted;
    }

    /** Stops the VPN service, once the core has let go of the tunnel. */
    public String stopVpn(String ignored) {
        NuggetVpnService.stop();
        return "{}";
    }

    public boolean protect(int fd) {
        NuggetVpnService service = NuggetVpnService.current();
        return service != null && service.protect(fd);
    }

    public boolean vpnRunning(int ignored) {
        return NuggetVpnService.current() != null;
    }

    // ------------------------------------------------------------------
    // Networks
    // ------------------------------------------------------------------

    private ConnectivityManager connectivity() {
        return (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    /** Every network but our own VPN, as JSON. */
    public String networkInterfaces(String ignored) {
        JSONArray result = new JSONArray();
        try {
            ConnectivityManager manager = connectivity();
            for (Network network : manager.getAllNetworks()) {
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                LinkProperties link = manager.getLinkProperties(network);
                if (capabilities == null || link == null || link.getInterfaceName() == null) continue;
                if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
                NetworkInterface netInterface = NetworkInterface.getByName(link.getInterfaceName());
                if (netInterface == null) continue;

                JSONObject item = new JSONObject();
                item.put("name", netInterface.getName());
                item.put("index", netInterface.getIndex());
                item.put("mtu", netInterface.getMTU());
                item.put("up", netInterface.isUp());
                item.put("loopback", netInterface.isLoopback());
                item.put("point_to_point", netInterface.isPointToPoint());
                item.put("multicast", netInterface.supportsMulticast());
                item.put("type", typeOf(capabilities));
                item.put("metered", !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
                JSONArray addresses = new JSONArray();
                for (LinkAddress address : link.getLinkAddresses()) {
                    addresses.put(address.getAddress().getHostAddress().split("%")[0] + "/" + address.getPrefixLength());
                }
                item.put("addresses", addresses);
                JSONArray dns = new JSONArray();
                for (InetAddress server : link.getDnsServers()) {
                    dns.put(server.getHostAddress().split("%")[0]);
                }
                item.put("dns", dns);
                JSONArray gateways = new JSONArray();
                for (RouteInfo route : link.getRoutes()) {
                    if (route.isDefaultRoute() && route.getGateway() != null) {
                        gateways.put(route.getGateway().getHostAddress().split("%")[0]);
                    }
                }
                item.put("gateways", gateways);
                result.put(item);
            }
        } catch (Exception e) {
            Log.e(TAG, "networkInterfaces", e);
        }
        return result.toString();
    }

    private static String typeOf(NetworkCapabilities capabilities) {
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        return "other";
    }

    /**
     * Follows the network Android would use without us. A plain request
     * excludes VPNs by default, which is what keeps our own tunnel out of it.
     */
    public synchronized String startNetworkMonitor(String ignored) {
        if (networkCallback != null) return "{}";
        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
                .build();
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                report(network);
            }

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                report(network);
            }

            @Override
            public void onLinkPropertiesChanged(Network network, LinkProperties link) {
                report(network);
            }

            @Override
            public void onLost(Network network) {
                nativeDefaultNetwork("", -1, false, false);
            }
        };
        try {
            ConnectivityManager manager = connectivity();
            if (Build.VERSION.SDK_INT >= 31) {
                manager.registerBestMatchingNetworkCallback(request, networkCallback, mainHandler);
            } else if (Build.VERSION.SDK_INT >= 28) {
                manager.requestNetwork(request, networkCallback, mainHandler);
            } else {
                manager.registerDefaultNetworkCallback(networkCallback, mainHandler);
            }
        } catch (Exception e) {
            Log.e(TAG, "startNetworkMonitor", e);
            networkCallback = null;
            return error(e.getMessage());
        }
        return "{}";
    }

    private void report(Network network) {
        try {
            ConnectivityManager manager = connectivity();
            LinkProperties link = manager.getLinkProperties(network);
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (link == null || link.getInterfaceName() == null) return;
            NetworkInterface netInterface = NetworkInterface.getByName(link.getInterfaceName());
            if (netInterface == null) return;
            boolean metered = capabilities != null && !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
            nativeDefaultNetwork(netInterface.getName(), netInterface.getIndex(), metered, false);
        } catch (Exception e) {
            Log.e(TAG, "report network", e);
        }
    }

    public synchronized String stopNetworkMonitor(String ignored) {
        if (networkCallback != null) {
            try {
                connectivity().unregisterNetworkCallback(networkCallback);
            } catch (Exception ignoredError) {
                // Already gone.
            }
            networkCallback = null;
        }
        return "{}";
    }

    /** Which app owns a connection, for the connections screen and app rules. */
    public String findConnectionOwner(String request) {
        if (Build.VERSION.SDK_INT < 29) {
            return error("needs Android 10");
        }
        try {
            JSONObject query = new JSONObject(request);
            int uid = connectivity().getConnectionOwnerUid(
                    query.getInt("protocol"),
                    new InetSocketAddress(query.getString("source"), query.getInt("source_port")),
                    new InetSocketAddress(query.getString("destination"), query.getInt("destination_port")));
            if (uid < 0) {
                return error("owner not found");
            }
            JSONArray packages = new JSONArray();
            String[] names = context.getPackageManager().getPackagesForUid(uid);
            if (names != null) {
                for (String name : names) packages.put(name);
            }
            return new JSONObject().put("uid", uid).put("packages", packages).toString();
        } catch (Exception e) {
            return error(e.getMessage());
        }
    }

    /**
     * Colours the status and navigation bars like the page behind them:
     * {"color":"#RRGGBB","light":true} for a light theme.
     */
    public String setSystemBars(String request) {
        Activity current = activity;
        if (current == null) return "{}";
        try {
            JSONObject options = new JSONObject(request);
            int color = android.graphics.Color.parseColor(options.getString("color"));
            boolean light = options.optBoolean("light", false);
            current.runOnUiThread(() -> {
                View container = current.findViewById(R.id.main_container);
                if (container != null) container.setBackgroundColor(color);
                current.getWindow().getDecorView().setBackgroundColor(color);
                androidx.core.view.WindowInsetsControllerCompat controller =
                        androidx.core.view.WindowCompat.getInsetsController(current.getWindow(), current.getWindow().getDecorView());
                controller.setAppearanceLightStatusBars(light);
                controller.setAppearanceLightNavigationBars(light);
            });
        } catch (Exception e) {
            return error(e.getMessage());
        }
        return "{}";
    }

    // ------------------------------------------------------------------
    // Installed apps, for routing rules
    // ------------------------------------------------------------------

    /**
     * The apps that can use the network, as JSON: package, label, and
     * whether it came with the system. Sorted by label.
     */
    public String installedApps(String ignored) {
        JSONArray result = new JSONArray();
        try {
            PackageManager manager = context.getPackageManager();
            java.util.List<android.content.pm.PackageInfo> packages =
                    manager.getInstalledPackages(PackageManager.GET_PERMISSIONS);
            java.util.List<JSONObject> apps = new java.util.ArrayList<>();
            for (android.content.pm.PackageInfo info : packages) {
                if (info.requestedPermissions == null || info.applicationInfo == null) continue;
                boolean network = false;
                for (String permission : info.requestedPermissions) {
                    if ("android.permission.INTERNET".equals(permission)) {
                        network = true;
                        break;
                    }
                }
                if (!network || info.packageName.equals(context.getPackageName())) continue;
                JSONObject app = new JSONObject();
                app.put("package", info.packageName);
                app.put("label", String.valueOf(info.applicationInfo.loadLabel(manager)));
                app.put("system", (info.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0);
                apps.add(app);
            }
            apps.sort((a, b) -> a.optString("label").compareToIgnoreCase(b.optString("label")));
            for (JSONObject app : apps) result.put(app);
        } catch (Exception e) {
            Log.e(TAG, "installedApps", e);
        }
        return result.toString();
    }

    /** An app's icon, as a PNG data URL; "" when it has none. */
    public String appIcon(String packageName) {
        try {
            android.graphics.drawable.Drawable icon = context.getPackageManager().getApplicationIcon(packageName);
            int size = 96;
            android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap);
            icon.setBounds(0, 0, size, size);
            icon.draw(canvas);
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
            bitmap.recycle();
            return "data:image/png;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    // ------------------------------------------------------------------
    // Material You
    // ------------------------------------------------------------------

    /**
     * The wallpaper-derived palette of Android 12 and later, for the
     * "system" theme; "" before that.
     */
    public String systemPalette(String ignored) {
        if (Build.VERSION.SDK_INT < 31) {
            return "";
        }
        try {
            int night = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            JSONObject palette = new JSONObject();
            palette.put("dark", night == Configuration.UI_MODE_NIGHT_YES);
            palette.put("accent1", tones(new int[]{
                    android.R.color.system_accent1_100, android.R.color.system_accent1_200,
                    android.R.color.system_accent1_500, android.R.color.system_accent1_600}));
            palette.put("neutral1", tones(new int[]{
                    android.R.color.system_neutral1_10, android.R.color.system_neutral1_50,
                    android.R.color.system_neutral1_900}));
            palette.put("neutral2", tones(new int[]{
                    android.R.color.system_neutral2_100, android.R.color.system_neutral2_500,
                    android.R.color.system_neutral2_800}));
            return palette.toString();
        } catch (Exception e) {
            Log.e(TAG, "systemPalette", e);
            return "";
        }
    }

    private JSONArray tones(int[] ids) {
        JSONArray result = new JSONArray();
        for (int id : ids) {
            result.put(String.format("#%06X", context.getColor(id) & 0xFFFFFF));
        }
        return result;
    }
}
