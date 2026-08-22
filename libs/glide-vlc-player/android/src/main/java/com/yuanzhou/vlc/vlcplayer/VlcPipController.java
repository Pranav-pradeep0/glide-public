package com.yuanzhou.vlc.vlcplayer;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.graphics.Rect;
import android.os.Build;
import android.os.Looper;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.ViewGroup;

import androidx.activity.ComponentActivity;
import androidx.core.app.PictureInPictureModeChangedInfo;
import androidx.core.util.Consumer;

import java.util.ArrayList;
import java.util.List;

/**
 * Owns Picture-in-Picture for a single video view.
 *
 * Everything PiP needs is known here and nowhere else: the hosting Activity, the
 * decoded video's real dimensions and sample aspect ratio, the view's own bounds in
 * window pixels, and whether playback is live. Previously these were assembled in
 * JavaScript and pushed down as props, which meant the aspect ratio came from the
 * screen instead of the video, the source rect hint was measured in dp and used as
 * px, and auto-enter could stay armed after the player was gone.
 *
 * The Activity needs no PiP code at all: androidx.activity exposes a listener for
 * mode changes, so this class subscribes and unsubscribes with the view.
 */
final class VlcPipController {

    private static final String TAG = "VlcPipController";

    /**
     * Android rejects PictureInPictureParams outside roughly 1:2.39 .. 2.39:1 and
     * throws from enterPictureInPictureMode. Clamp just inside the documented range
     * so an ultrawide or very tall source degrades to letterboxing in PiP instead of
     * failing to enter it at all.
     */
    private static final float MIN_ASPECT_RATIO = 0.42f;
    private static final float MAX_ASPECT_RATIO = 2.38f;

    private final ReactVlcPlayerView videoView;

    /** Views hidden for the PiP presentation, in the order they were hidden. */
    private final List<View> hiddenViews = new ArrayList<>();
    /** Ancestor transforms neutralised for the PiP presentation. */
    private final List<SavedTransform> savedTransforms = new ArrayList<>();

    private Consumer<PictureInPictureModeChangedInfo> modeChangedListener;
    private ComponentActivity listeningActivity;

    private boolean enabled = false;
    private boolean playing = false;
    private boolean inPipMode = false;

    private int videoWidth = 0;
    private int videoHeight = 0;
    private int sarNum = 0;
    private int sarDen = 0;

    private static final class SavedTransform {
        final View view;
        final float scaleX;
        final float scaleY;
        final float translationX;
        final float translationY;

        SavedTransform(View view) {
            this.view = view;
            this.scaleX = view.getScaleX();
            this.scaleY = view.getScaleY();
            this.translationX = view.getTranslationX();
            this.translationY = view.getTranslationY();
        }

        void restore() {
            view.setScaleX(scaleX);
            view.setScaleY(scaleY);
            view.setTranslationX(translationX);
            view.setTranslationY(translationY);
        }
    }

    private final View.OnLayoutChangeListener layoutChangeListener =
            (v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
                if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
                    applyParams();
                }
            };

    VlcPipController(ReactVlcPlayerView videoView) {
        this.videoView = videoView;
    }

    // =========================================================================
    // Attach / detach
    // =========================================================================

    void attach() {
        ComponentActivity activity = componentActivity();
        if (activity == null || listeningActivity != null) {
            return;
        }

        modeChangedListener = info -> handleModeChanged(info.isInPictureInPictureMode());
        activity.addOnPictureInPictureModeChangedListener(modeChangedListener);
        listeningActivity = activity;
        videoView.addOnLayoutChangeListener(layoutChangeListener);
        Log.d(TAG, "attached to " + activity.getClass().getSimpleName());
    }

    void detach() {
        videoView.removeOnLayoutChangeListener(layoutChangeListener);

        if (listeningActivity != null && modeChangedListener != null) {
            listeningActivity.removeOnPictureInPictureModeChangedListener(modeChangedListener);
        }
        listeningActivity = null;
        modeChangedListener = null;

        // Disarm auto-enter before going away, otherwise the Activity keeps entering
        // PiP on whatever screen replaced the player.
        enabled = false;
        playing = false;
        applyParams();

        restorePresentation();
        inPipMode = false;
    }

    // =========================================================================
    // State from the view
    // =========================================================================

    /** JS tells us only whether PiP is currently allowed, never how or when. */
    void setEnabled(boolean enabled) {
        if (this.enabled == enabled) {
            return;
        }
        this.enabled = enabled;
        Log.d(TAG, "enabled=" + enabled);
        applyParams();
    }

    void setPlaying(boolean playing) {
        if (this.playing == playing) {
            return;
        }
        this.playing = playing;
        applyParams();
    }

    void setVideoGeometry(int width, int height, int sarNum, int sarDen) {
        if (this.videoWidth == width && this.videoHeight == height
                && this.sarNum == sarNum && this.sarDen == sarDen) {
            return;
        }
        this.videoWidth = width;
        this.videoHeight = height;
        this.sarNum = sarNum;
        this.sarDen = sarDen;
        applyParams();
    }

    boolean isInPipMode() {
        // The Activity is the ground truth; the cached flag only covers the window
        // between teardown and the last callback.
        Activity activity = currentActivity();
        return activity != null ? activity.isInPictureInPictureMode() : inPipMode;
    }

    // =========================================================================
    // Entry
    // =========================================================================

    /** @return true if the Activity accepted the transition. */
    boolean enter() {
        Activity activity = currentActivity();
        if (activity == null) {
            return false;
        }

        try {
            return activity.enterPictureInPictureMode(buildParams());
        } catch (Exception e) {
            Log.w(TAG, "enterPictureInPictureMode failed: " + e.getMessage());
            return false;
        }
    }

    boolean isSupported() {
        Activity activity = currentActivity();
        if (activity == null) {
            return false;
        }
        return activity.getPackageManager()
                .hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    // =========================================================================
    // Params
    // =========================================================================

    private void applyParams() {
        // Video geometry and play state arrive on LibVLC's own thread; Activity PiP
        // params must be set from the main thread.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            videoView.post(this::applyParams);
            return;
        }

        Activity activity = currentActivity();
        if (activity == null) {
            return;
        }

        try {
            activity.setPictureInPictureParams(buildParams());
        } catch (Exception e) {
            Log.w(TAG, "setPictureInPictureParams failed: " + e.getMessage());
        }
    }

    private PictureInPictureParams buildParams() {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();

        Rational aspectRatio = videoAspectRatio();
        if (aspectRatio != null) {
            builder.setAspectRatio(aspectRatio);
        }

        Rect sourceRectHint = sourceRectHint();
        if (sourceRectHint != null) {
            builder.setSourceRectHint(sourceRectHint);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(enabled && playing);
            // Video content can be resized without a crossfade.
            builder.setSeamlessResizeEnabled(true);
        }

        return builder.build();
    }

    /**
     * The PiP window must take the aspect ratio of the <em>video</em>, corrected for a
     * non-square sample aspect ratio. Using the surface bounds gives the PiP window the
     * shape of the phone, which is why the video used to sit letterboxed inside it.
     */
    private Rational videoAspectRatio() {
        if (videoWidth <= 0 || videoHeight <= 0) {
            return null;
        }

        float sar = (sarNum > 0 && sarDen > 0) ? ((float) sarNum / sarDen) : 1f;
        float dar = (videoWidth * sar) / videoHeight;
        if (dar <= 0f || Float.isNaN(dar) || Float.isInfinite(dar)) {
            return null;
        }

        float clamped = Math.max(MIN_ASPECT_RATIO, Math.min(MAX_ASPECT_RATIO, dar));
        return new Rational(Math.round(clamped * 1000f), 1000);
    }

    /**
     * Window-relative pixel bounds of the video surface, which is what the system
     * animates from. Measuring this in JS produced dp and therefore a rect that was
     * wrong by the display density.
     */
    private Rect sourceRectHint() {
        Rect rect = new Rect();
        if (!videoView.getGlobalVisibleRect(rect)) {
            return null;
        }
        if (rect.width() <= 0 || rect.height() <= 0) {
            return null;
        }
        return rect;
    }

    // =========================================================================
    // Presentation
    // =========================================================================

    private void handleModeChanged(boolean isInPipMode) {
        if (this.inPipMode == isInPipMode) {
            return;
        }
        this.inPipMode = isInPipMode;
        Log.i(TAG, "pip mode changed → " + isInPipMode);

        if (isInPipMode) {
            applyPresentation();
        } else {
            restorePresentation();
        }

        videoView.onPipModeChangedInternal(isInPipMode);
    }

    /**
     * A PiP window shows the whole Activity, so everything except the video has to go.
     * Doing it here runs on the main thread in the same frame batch as the PiP resize,
     * which a React re-render cannot match — that timing gap is why the HUD and
     * transport controls used to appear inside the PiP window.
     */
    private void applyPresentation() {
        Activity activity = currentActivity();
        if (activity == null) {
            return;
        }

        View contentRoot = activity.findViewById(android.R.id.content);
        View child = videoView;
        ViewGroup parent = parentOf(child);

        while (parent != null) {
            for (int i = 0; i < parent.getChildCount(); i++) {
                View sibling = parent.getChildAt(i);
                if (sibling != child && sibling.getVisibility() == View.VISIBLE) {
                    sibling.setVisibility(View.GONE);
                    hiddenViews.add(sibling);
                }
            }

            // Any zoom/pan the user applied to an ancestor would crop the PiP window.
            savedTransforms.add(new SavedTransform(parent));
            parent.setScaleX(1f);
            parent.setScaleY(1f);
            parent.setTranslationX(0f);
            parent.setTranslationY(0f);

            if (parent == contentRoot) {
                break;
            }
            child = parent;
            parent = parentOf(child);
        }

        Log.d(TAG, "pip presentation: hid " + hiddenViews.size() + " sibling views");
    }

    private void restorePresentation() {
        for (int i = hiddenViews.size() - 1; i >= 0; i--) {
            hiddenViews.get(i).setVisibility(View.VISIBLE);
        }
        hiddenViews.clear();

        for (int i = savedTransforms.size() - 1; i >= 0; i--) {
            savedTransforms.get(i).restore();
        }
        savedTransforms.clear();
    }

    private static ViewGroup parentOf(View view) {
        return (view.getParent() instanceof ViewGroup) ? (ViewGroup) view.getParent() : null;
    }

    private Activity currentActivity() {
        Activity activity = videoView.getReactActivity();
        return (activity == null || activity.isFinishing()) ? null : activity;
    }

    private ComponentActivity componentActivity() {
        Activity activity = currentActivity();
        return (activity instanceof ComponentActivity) ? (ComponentActivity) activity : null;
    }
}
