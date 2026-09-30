package com.wails.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import java.util.Arrays;

/**
 * What the page asks of the browser around it.
 *
 * A WebView without one ignores both of these: an <input type="file"> did
 * nothing when tapped, and the camera could not be opened for scanning a QR
 * code. Files go through the system picker; the camera goes to our own page
 * only, after the user allows it.
 */
class NuggetChromeClient extends WebChromeClient {
    static final int FILE_CHOOSER_REQUEST = 7020;
    static final int CAMERA_REQUEST = 7021;

    private final Activity activity;
    private final String host;
    private ValueCallback<Uri[]> pendingFiles;
    private PermissionRequest pendingCamera;

    NuggetChromeClient(Activity activity, String host) {
        this.activity = activity;
        this.host = host;
    }

    @Override
    public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        pendingFiles = callback;
        try {
            activity.startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
        } catch (ActivityNotFoundException e) {
            pendingFiles = null;
            callback.onReceiveValue(null);
        }
        return true;
    }

    /** Hands a picked file to the page; true when the result was ours. */
    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_CHOOSER_REQUEST) return false;
        ValueCallback<Uri[]> callback = pendingFiles;
        pendingFiles = null;
        if (callback != null) callback.onReceiveValue(FileChooserParams.parseResult(resultCode, data));
        return true;
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
        boolean camera = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
        if (!camera || !host.equals(request.getOrigin().getHost())) {
            request.deny();
            return;
        }
        if (activity.checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        if (pendingCamera != null) pendingCamera.deny();
        pendingCamera = request;
        activity.requestPermissions(new String[]{android.Manifest.permission.CAMERA}, CAMERA_REQUEST);
    }

    @Override
    public void onPermissionRequestCanceled(PermissionRequest request) {
        if (pendingCamera == request) pendingCamera = null;
    }

    /** Answers the page once the user has decided; true when it was ours. */
    boolean onRequestPermissionsResult(int requestCode, int[] grantResults) {
        if (requestCode != CAMERA_REQUEST) return false;
        PermissionRequest request = pendingCamera;
        pendingCamera = null;
        if (request != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                request.deny();
            }
        }
        return true;
    }
}
