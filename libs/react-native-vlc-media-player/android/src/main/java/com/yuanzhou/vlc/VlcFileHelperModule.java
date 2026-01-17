package com.yuanzhou.vlc;

import android.content.ContentResolver;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.FileNotFoundException;
import java.io.IOException;

public class VlcFileHelperModule extends ReactContextBaseJavaModule {
    private static final String TAG = "VlcFileHelperModule";

    public VlcFileHelperModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "VlcFileHelperModule";
    }

    @ReactMethod
    public void getContentUriFd(String uriString, Promise promise) {
        try {
            Uri uri = Uri.parse(uriString);
            ContentResolver resolver = getReactApplicationContext().getContentResolver();

            // Try to open as ParcelFileDescriptor first
            ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r");
            if (pfd != null) {
                // We return the raw FD. The Java object must stay open for the FD to remain
                // valid?
                // Actually, if we return the FD integer, we must ensure the PFD isn't garbage
                // collected immediately closing the FD.
                // However, passing FD to another process (ffmpeg) usually works if we keep it
                // open.
                // But for React Native -> FFmpegKit (same process), /proc/self/fd/N works.
                // We need to detach it or keep a reference?
                // FFmpegKit might need us to keep it open until it's done.
                // A better approach for "one-off" usage like probe:
                // We can't really manage the lifecycle easily from JS if we just return an int.

                // WAIT. If we return the int, and let the PFD be GC'ed, it might close.
                // We should detach the fd? pfd.detachFd() returns the fd and closes the PFD
                // object *without* closing the underlying fd.
                int fd = pfd.detachFd();
                promise.resolve(fd);
            } else {
                promise.reject("e_err", "Could not open file descriptor");
            }
        } catch (FileNotFoundException e) {
            promise.reject("e_not_found", e.getMessage());
        } catch (Exception e) {
            promise.reject("e_unknown", e.getMessage());
        }
    }

    @ReactMethod
    public void closeFd(int fd, Promise promise) {
        try {
            ParcelFileDescriptor.adoptFd(fd).close();
            promise.resolve(true);
        } catch (IOException e) {
            promise.reject("e_close_err", e.getMessage());
        }
    }
}
