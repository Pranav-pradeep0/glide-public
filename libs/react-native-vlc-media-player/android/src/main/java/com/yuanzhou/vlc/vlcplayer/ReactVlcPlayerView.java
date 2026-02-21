package com.yuanzhou.vlc.vlcplayer;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.text.TextUtils;
import android.Manifest;
import android.content.res.Configuration;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import android.graphics.Bitmap;
import android.graphics.SurfaceTexture;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeArray;
import com.facebook.react.bridge.WritableArray;

import com.facebook.react.uimanager.ThemedReactContext;

import org.videolan.libvlc.interfaces.IVLCVout;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.Dialog;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.ParcelFileDescriptor;

import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.support.v4.media.MediaMetadataCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.media.session.MediaButtonReceiver;
import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.graphics.BitmapFactory;
import android.os.Build;

@SuppressLint("ViewConstructor")
class ReactVlcPlayerView extends TextureView implements
        LifecycleEventListener,
        TextureView.SurfaceTextureListener,
        AudioManager.OnAudioFocusChangeListener {

    private static final String TAG = "ReactVlcPlayerView";
    private final String tag = "ReactVlcPlayerView";

    private final VideoEventEmitter eventEmitter;
    private LibVLC libvlc;
    private MediaPlayer mMediaPlayer = null;
    private boolean mMuted = false;
    private boolean isSurfaceViewDestory;
    private String src;
    private String _subtitleUri;
    private int _textTrack = -1; // Store desired text track, default to -1 (disabled)
    private int _audioTrack = -1; // Store desired audio track, default to -1 (disabled)
    private int currentlyAppliedAudioTrack = -1; // Track which audio track is currently active in VLC
    private ReadableMap srcMap;
    private int mVideoHeight = 0;

    private Surface surfaceVideo;
    private int mVideoWidth = 0;
    private int mVideoVisibleHeight = 0;
    private int mVideoVisibleWidth = 0;
    private int mSarNum = 0;
    private int mSarDen = 0;
    private int mLastViewWidth = 0;
    private int mLastViewHeight = 0;

    private boolean isPaused = true;
    private boolean isHostPaused = false;
    private int preVolume = 100;
    private boolean autoAspectRatio = false;
    private boolean acceptInvalidCertificates = false;
    private boolean playInBackground = false;
    private boolean isInPipMode = false;
    private String resizeMode = "contain";
    private Boolean mBestFitUsingCover = null;
    private boolean isResizeModeApplied = false;
    private long mAudioDelay = 0;
    private boolean wasPlayingBeforeHostPause = false;
    private float mSavedPosition = 0f; // Save position across player recreation

    private float mProgressUpdateInterval = 0;
    private Handler mProgressUpdateHandler = new Handler(Looper.getMainLooper());
    private Runnable mProgressUpdateRunnable = null;

    // Executor for background seeking to prevent UI thread blocking
    private ExecutorService seekExecutor = Executors.newSingleThreadExecutor();

    private final ThemedReactContext themedReactContext;
    private final AudioManager audioManager;
    private AudioFocusRequest mAudioFocusRequest; // For API 26+ audio focus management
    private boolean mHasAudioFocus = false;
    private boolean mResumeOnFocusGain = false;
    private int mVolumeBeforeDuck = -1;
    private BroadcastReceiver mNoisyReceiver;

    // Bridge-level seek filtering state (Main thread)
    private float mLastBridgeSeekValue = Float.NaN;

    private String mVideoInfoHash = null;
    private ParcelFileDescriptor currentPfd = null;

    // Media Session & Notification
    private MediaSessionCompat mMediaSession;
    private NotificationManagerCompat mNotificationManager;
    private String mVideoTitle = "Video";
    private String mVideoArtist = "Glide";
    private static final String NOTIFICATION_CHANNEL_ID = "vlc_media_player_channel";
    private static final int NOTIFICATION_ID = 1001;

    // Buffering debounce
    private static final int BUFFERING_DEBOUNCE_MS = 200;
    private Handler bufferingHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingBufferingEvent = null;

    // Resize debounce logic
    private Handler resizeDebounceHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingResize = null;
    private static final int RESIZE_DEBOUNCE_MS = 100;
    private static final float BEST_FIT_MAX_CROP_RATIO = 0.08f;
    private static final float BEST_FIT_ENTER_CROP_RATIO = 0.06f;
    private static final float BEST_FIT_EXIT_CROP_RATIO = 0.10f;
    private static final float BEST_FIT_MAX_BAR_RATIO = 0.06f;
    private static final float BEST_FIT_ENTER_BAR_RATIO = 0.05f;
    private static final float BEST_FIT_EXIT_BAR_RATIO = 0.08f;
    private static final long PLAYBACK_EVENT_DEBOUNCE_MS = 120;
    private String mLastPlaybackEventType = null;
    private long mLastPlaybackEventTimestamp = 0L;
    private static final long SEEK_FLUSH_EVENT_SUPPRESS_MS = 420L;
    private static final long SEEK_FLUSH_EVENT_HARD_TIMEOUT_MS = 950L;
    private static final int SEEK_FLUSH_SUPPRESSION_BUDGET = 3;
    private long mSuppressPlaybackEventsUntilMs = 0L;
    private int mTransientSeekSuppressionBudget = 0;
    private long mTransientSeekSuppressionUntilMs = 0L;
    private Runnable mPendingSeekFlushPlayRunnable = null;
    private Runnable mPendingSeekVerifyRunnable = null;
    private Runnable mPendingReviveFallbackRunnable = null;
    private int mSeekToken = 0;
    private long mLastSurfaceUpdateAtMs = 0L;
    private float mLastRequestedSeekPosition = -1f;
    private long mLastRequestedSeekAtMs = 0L;
    private static final long SEEK_OVERRIDE_RECENT_MS = 900L;
    private static final long SEEK_FRAME_STALL_MS = 420L;
    private static final long SEEK_VERIFY_DELAY_EARLY_MS = 90L;
    private static final long SEEK_VERIFY_DELAY_LATE_MS = 480L;
    private static final long SEEK_VERIFY_PROGRESS_EPSILON_MS = 120L;
    private static final float END_STATE_POSITION_THRESHOLD = 0.90f;
    private boolean mNativeStopped = true;

    public ReactVlcPlayerView(ThemedReactContext context) {
        super(context);
        this.eventEmitter = new VideoEventEmitter(context);
        this.themedReactContext = context;
        audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        this.setSurfaceTextureListener(this);

        this.addOnLayoutChangeListener(onLayoutChangeListener);

        // Register lifecycle listener to handle app background/foreground events
        context.addLifecycleEventListener(this);
        initMediaSession();
    }

    @Override
    public void setId(int id) {
        super.setId(id);
        eventEmitter.setViewId(id);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        // createPlayer();
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        cleanUpResources();
    }

    // LifecycleEventListener implementation

    @Override
    public void onHostResume() {
        long timestamp = System.currentTimeMillis();
        tracePlayback("onHostResume:enter");

        // Resume playback if we were playing before pause, OR if surface needs
        // restoration
        // logic: if player exists AND (surface was destroyed OR we were playing) AND we
        // are currently paused by host
        if (mMediaPlayer != null && (isSurfaceViewDestory || wasPlayingBeforeHostPause) && isHostPaused) {
            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            if (!vlcOut.areViewsAttached()) {
                vlcOut.attachViews(onNewVideoLayoutListener);
                isSurfaceViewDestory = false;
            }

            // Auto-resume playback if it was playing before backgrounding
            // CRITICAL CHANGE: Removed '!isPaused' check because onSurfacesDestroyed NOW
            // sets isPaused=true.
            // We rely on 'wasPlayingBeforeHostPause' as the source of truth for user
            // intent.
            if (wasPlayingBeforeHostPause) {
                isPaused = false;

                if (requestAudioFocusInternal()) {
                    mMediaPlayer.play();
                    tracePlayback("onHostResume:play-called");
                }
            }
        }

        isHostPaused = false;
        tracePlayback("onHostResume:exit");
        // Keep playback event source-of-truth in VLC listener callbacks.
        // Avoid forcing a paused event on resume before native play transition settles.
    }

    @Override
    public void onHostPause() {
        long timestamp = System.currentTimeMillis();
        tracePlayback("onHostPause:enter");
        // 1. Capture playing state BEFORE we pause
        // If player is playing, OR if our internal flag says we are not paused (intent
        // to play)
        wasPlayingBeforeHostPause = (mMediaPlayer != null && mMediaPlayer.isPlaying()) || !isPaused;

        // 2. Mark host as paused
        isHostPaused = true;

        Log.i(TAG, "onHostPause: wasPlaying=" + wasPlayingBeforeHostPause + ", playInBackground=" + playInBackground);

        // 3. Update PiP state
        boolean currentIsInPipMode = false;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            try {
                android.app.Activity activity = themedReactContext.getCurrentActivity();
                if (activity != null) {
                    currentIsInPipMode = activity.isInPictureInPictureMode();
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to check PIP mode: " + e.getMessage());
            }
        }

        // Update internal state just in case
        this.isInPipMode = currentIsInPipMode;

        // 4. Pause if needed
        if (!playInBackground && !currentIsInPipMode) {
            if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                isPaused = true;
                mMediaPlayer.pause();
                emitPausedEvent(Arguments.createMap());
                Log.i(TAG, "onHostPause: Paused playback (Background)");
                tracePlayback("onHostPause:pause-called");
            }
        }
        tracePlayback("onHostPause:exit");
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);

        long timestamp = System.currentTimeMillis();
        // CRITICAL: Detect PiP Exit here
        boolean newIsInPipMode = false;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            try {
                android.app.Activity activity = themedReactContext.getCurrentActivity();
                if (activity != null) {
                    newIsInPipMode = activity.isInPictureInPictureMode();
                }
            } catch (Exception e) {
            }
        }

        // Transition detected: PiP -> No PiP (Close or Maximize)
        if (this.isInPipMode && !newIsInPipMode) {
            // If Host is Paused, it means the user CLOSED the PiP window (stayed in
            // background)
            // If Host is Resumed (not paused), it means user MAXIMIZED the window
            // (foreground)
            if (isHostPaused && !playInBackground) {
                Log.i(TAG, "PiP Exit detected while Host Paused -> Stopping Playback (User Closed PiP)");
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    isPaused = true;
                    mMediaPlayer.pause();
                    setKeepScreenOn(false);
                    emitPausedEvent(Arguments.createMap());
                }
            }
        }

        this.isInPipMode = newIsInPipMode;
    }

    @Override
    public void onHostDestroy() {
        cleanUpResources();
    }

    IVLCVout.Callback callback = new IVLCVout.Callback() {
        @Override
        public void onSurfacesCreated(IVLCVout ivlcVout) {
            isSurfaceViewDestory = false;

        }

        @Override
        public void onSurfacesDestroyed(IVLCVout ivlcVout) {
            isSurfaceViewDestory = true;
            tracePlayback("onSurfacesDestroyed");

            // Only pause on surface destroy when host is actually paused/backgrounded.
            // Surface recreation can happen transiently while foregrounded.
            if (isHostPaused && !playInBackground) {
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    isPaused = true;

                    mMediaPlayer.pause();
                    emitPausedEvent(Arguments.createMap());
                    Log.i(TAG, "onSurfacesDestroyed: Paused playback (host paused + !playInBackground)");
                    tracePlayback("onSurfacesDestroyed:pause-called");
                }
            }
        }

    };

    // AudioManager.OnAudioFocusChangeListener implementation
    @Override
    public void onAudioFocusChange(int focusChange) {
        tracePlayback("onAudioFocusChange:" + focusChange);
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_GAIN:
                // Regained focus
                mHasAudioFocus = true;
                registerNoisyReceiver(); // Ensure noisy receiver is active (covers delayed focus path)
                if (mMediaPlayer != null) {
                    // Restore volume if we were ducking
                    if (mVolumeBeforeDuck >= 0) {
                        mMediaPlayer.setVolume(mVolumeBeforeDuck);
                        mVolumeBeforeDuck = -1;
                    }
                    // Resume ONLY if we were playing before the transient loss
                    // (or if focus was delayed and we intended to play)
                    if (mResumeOnFocusGain) {
                        isPaused = false;
                        mMediaPlayer.play();
                        setKeepScreenOn(true);
                        tracePlayback("audioFocus:gain-play-called");

                        WritableMap map = createEventMap();
                        if (map != null) {
                            emitPlayingEvent(map);
                        }
                    }
                }
                mResumeOnFocusGain = false;
                break;

            case AudioManager.AUDIOFOCUS_LOSS:
                // Permanent loss - pause and release focus
                mHasAudioFocus = false;
                mResumeOnFocusGain = false; // Never auto-resume after permanent loss
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    isPaused = true;
                    mMediaPlayer.pause();
                    setKeepScreenOn(false);
                    tracePlayback("audioFocus:loss-pause-called");

                    // Notify JS side
                    WritableMap map = createEventMap();
                    if (map != null) {
                        emitPausedEvent(map);
                        Log.i(TAG, "Paused playback due to permanent audio focus loss");
                    }
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // Temporary loss (e.g., phone call) - pause but keep resources
                if (mMediaPlayer != null) {
                    mResumeOnFocusGain = mMediaPlayer.isPlaying();
                    if (mMediaPlayer.isPlaying()) {
                        isPaused = true;
                        mMediaPlayer.pause();
                        setKeepScreenOn(false);
                        tracePlayback("audioFocus:transient-pause-called");

                        WritableMap map = createEventMap();
                        if (map != null) {
                            emitPausedEvent(map);
                            Log.i(TAG, "Paused playback due to transient audio focus loss");
                        }
                    }
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // Can duck - lower volume temporarily
                if (mMediaPlayer != null) {
                    mVolumeBeforeDuck = preVolume;
                    mMediaPlayer.setVolume(30); // Duck to 30%
                    Log.i(TAG, "Ducking audio due to transient focus loss");
                }
                break;
        }
    }

    /**
     * Registers broadcast receiver for headphone disconnect detection.
     */
    private void registerNoisyReceiver() {
        if (mNoisyReceiver != null) {
            return;
        }

        try {
            mNoisyReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                        // Headphones disconnected — pause immediately
                        if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                            isPaused = true;
                            mResumeOnFocusGain = false; // User unplugged - don't auto-resume
                            mMediaPlayer.pause();
                            setKeepScreenOn(false);
                            tracePlayback("audioNoisy:pause-called");

                            WritableMap map = createEventMap();
                            if (map != null) {
                                emitPausedEvent(map);
                                Log.i(TAG, "Paused: headphones disconnected (ACTION_AUDIO_BECOMING_NOISY)");
                            }
                        }
                    }
                }
            };

            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            themedReactContext.registerReceiver(mNoisyReceiver, filter);
            Log.d(TAG, "Noisy audio receiver registered");
        } catch (Exception e) {
            Log.e(TAG, "Error registering noisy audio receiver", e);
        }
    }

    /**
     * Unregisters noisy audio receiver.
     */
    private void unregisterNoisyReceiver() {
        if (mNoisyReceiver != null) {
            try {
                themedReactContext.unregisterReceiver(mNoisyReceiver);
                mNoisyReceiver = null;
                Log.d(TAG, "Noisy audio receiver unregistered");
            } catch (Exception e) {
                Log.e(TAG, "Error unregistering noisy audio receiver", e);
            }
        }
    }

    /**
     * Request audio focus before starting playback.
     * Uses modern AudioFocusRequest API for Android 8.0+ (API 26+).
     */
    private boolean requestAudioFocusInternal() {
        if (!mHasAudioFocus) {
            int result;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                        .build();

                mAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(audioAttributes)
                        .setOnAudioFocusChangeListener(this)
                        .setAcceptsDelayedFocusGain(true)
                        .build();

                result = audioManager.requestAudioFocus(mAudioFocusRequest);
            } else {
                // Legacy API for pre-Oreo
                result = audioManager.requestAudioFocus(
                        this,
                        AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN);
            }

            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                mHasAudioFocus = true;
                mResumeOnFocusGain = false;
                registerNoisyReceiver();
            } else if (result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED) {
                mHasAudioFocus = false;
                mResumeOnFocusGain = true; // Will auto-play when GAIN arrives
                Log.i(TAG, "Audio focus request delayed, will resume when focus is granted");
                return false; // Don't start playback yet
            } else {
                mHasAudioFocus = false;
                mResumeOnFocusGain = false;
            }
        }

        // Force re-apply volume when we have focus.
        // This ensures the AudioTrack is active and volume is correct.
        // CHECK mMuted: If muted, we should not unmute just because we got focus.
        if (mHasAudioFocus && mMediaPlayer != null && !mMuted) {
            mMediaPlayer.setVolume(preVolume);
        }

        return mHasAudioFocus;
    }

    /**
     * Abandon audio focus when stopping playback.
     * Uses modern API for Android 8.0+.
     */
    private void abandonAudioFocusInternal() {
        unregisterNoisyReceiver();

        if (!mHasAudioFocus) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mAudioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(mAudioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(this);
        }

        mHasAudioFocus = false;
    }

    private void setProgressUpdateRunnable() {
        if (mMediaPlayer != null && mProgressUpdateInterval > 0) {
            // Cancel existing updates if any
            if (mProgressUpdateRunnable != null) {
                mProgressUpdateHandler.removeCallbacks(mProgressUpdateRunnable);
            }

            mProgressUpdateRunnable = new Runnable() {
                @Override
                public void run() {
                    MediaPlayer player = mMediaPlayer;
                    if (player != null && !isPaused && player.isPlaying()) {
                        long currentTime = player.getTime();
                        float position = player.getPosition();
                        long totalLength = player.getLength();

                        WritableMap map = Arguments.createMap();
                        map.putBoolean("isPlaying", true);
                        map.putDouble("position", position);
                        map.putDouble("currentTime", currentTime);
                        map.putDouble("duration", totalLength);

                        eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_PROGRESS);
                    }

                    if (mMediaPlayer != null && mProgressUpdateInterval > 0) {
                        mProgressUpdateHandler.postDelayed(mProgressUpdateRunnable,
                                Math.round(mProgressUpdateInterval));
                    }
                }
            };

            mProgressUpdateHandler.postDelayed(mProgressUpdateRunnable, 0);
        }
    }

    private boolean areDimensionsStable() {
        if (mMediaPlayer == null) {
            return false;
        }
        if (getWidth() <= 0 || getHeight() <= 0 || isSurfaceViewDestory) {
            return false;
        }
        // Auto-aspect mode only needs stable view dimensions.
        if (autoAspectRatio) {
            return true;
        }
        return mVideoWidth > 0 && mVideoHeight > 0;
    }

    private float getVideoDisplayAspectRatio() {
        if (mVideoHeight == 0)
            return 0;
        float pixelAspect = (float) mVideoWidth / mVideoHeight;
        if (mSarNum > 0 && mSarDen > 0) {
            float sampleAspect = (float) mSarNum / mSarDen;
            return pixelAspect * sampleAspect;
        }
        return pixelAspect;
    }

    private void clearPendingResizeRequest() {
        if (pendingResize != null) {
            resizeDebounceHandler.removeCallbacks(pendingResize);
            pendingResize = null;
        }
    }

    private void requestResizeMode() {
        if (!areDimensionsStable()) {
            return;
        }

        clearPendingResizeRequest();

        pendingResize = new Runnable() {
            @Override
            public void run() {
                if (areDimensionsStable()) {
                    applyResizeMode();
                }
            }
        };

        resizeDebounceHandler.postDelayed(pendingResize, RESIZE_DEBOUNCE_MS);
    }

    /*************
     * Events Listener
     *************/

    private View.OnLayoutChangeListener onLayoutChangeListener = new View.OnLayoutChangeListener() {

        @Override
        public void onLayoutChange(View view, int left, int top, int right, int bottom, int oldLeft, int oldTop,
                int oldRight, int oldBottom) {
            int width = right - left;
            int height = bottom - top;

            if (width > 0 && height > 0) {
                int oldWidth = oldRight - oldLeft;
                int oldHeight = oldBottom - oldTop;

                boolean sizeChanged = (width != oldWidth) || (height != oldHeight);

                if (sizeChanged) {
                    Log.d(TAG,
                            String.format("View size changed from %dx%d to %dx%d", oldWidth, oldHeight, width, height));

                    mLastViewWidth = width;
                    mLastViewHeight = height;

                    if (mMediaPlayer != null) {
                        // Removed direct setWindowSize to avoid double-setting and race conditions
                        // Removed direct applyResizeMode call

                        // Use debounced request
                        requestResizeMode();
                    }
                }
            }
        }
    };

    /**
     * 播放过程中的时间事件监听
     */
    // Helper to create a standard event map with playback state
    private WritableMap createEventMap() {
        if (mMediaPlayer == null)
            return null;

        WritableMap map = Arguments.createMap();
        map.putBoolean("isPlaying", mMediaPlayer.isPlaying());
        map.putDouble("position", mMediaPlayer.getPosition());
        map.putDouble("currentTime", mMediaPlayer.getTime());
        map.putDouble("duration", mMediaPlayer.getLength());
        return map;
    }

    private boolean shouldSuppressPlaybackEvent(String type) {
        long now = System.currentTimeMillis();
        if (type.equals(mLastPlaybackEventType) && (now - mLastPlaybackEventTimestamp) < PLAYBACK_EVENT_DEBOUNCE_MS) {
            return true;
        }
        mLastPlaybackEventType = type;
        mLastPlaybackEventTimestamp = now;
        return false;
    }

    private boolean isTransientSeekPlaybackSuppressed() {
        if (isPaused) {
            return false;
        }
        final long now = System.currentTimeMillis();
        if (now < mSuppressPlaybackEventsUntilMs) {
            return true;
        }
        return mTransientSeekSuppressionBudget > 0 && now < mTransientSeekSuppressionUntilMs;
    }

    private void beginTransientSeekSuppression() {
        final long now = System.currentTimeMillis();
        mSuppressPlaybackEventsUntilMs = now + SEEK_FLUSH_EVENT_SUPPRESS_MS;
        mTransientSeekSuppressionBudget = SEEK_FLUSH_SUPPRESSION_BUDGET;
        mTransientSeekSuppressionUntilMs = now + SEEK_FLUSH_EVENT_HARD_TIMEOUT_MS;
    }

    private void consumeTransientSeekSuppression() {
        if (mTransientSeekSuppressionBudget > 0) {
            mTransientSeekSuppressionBudget--;
            if (mTransientSeekSuppressionBudget == 0) {
                mTransientSeekSuppressionUntilMs = 0L;
            }
        }
    }

    private void clearTransientSeekSuppression() {
        mSuppressPlaybackEventsUntilMs = 0L;
        mTransientSeekSuppressionBudget = 0;
        mTransientSeekSuppressionUntilMs = 0L;
    }

    private void emitPausedEvent(WritableMap map) {
        WritableMap eventMap = map != null ? map : Arguments.createMap();
        eventMap.putString("type", "Paused");
        if (shouldSuppressPlaybackEvent("Paused")) {
            tracePlayback("emitPausedEvent:suppressed");
            return;
        }
        tracePlayback("emitPausedEvent:sent");
        eventEmitter.sendEvent(eventMap, VideoEventEmitter.EVENT_ON_PAUSED);
    }

    private void emitPlayingEvent(WritableMap map) {
        WritableMap eventMap = map != null ? map : Arguments.createMap();
        eventMap.putString("type", "Playing");
        // Hard guard: never emit playing while pause intent is active.
        if (isPaused) {
            tracePlayback("emitPlayingEvent:suppressed-paused-intent");
            return;
        }
        if (shouldSuppressPlaybackEvent("Playing")) {
            tracePlayback("emitPlayingEvent:suppressed");
            return;
        }
        tracePlayback("emitPlayingEvent:sent");
        eventEmitter.sendEvent(eventMap, VideoEventEmitter.EVENT_ON_IS_PLAYING);
    }

    private ExecutorService ensureSeekExecutor() {
        if (seekExecutor == null || seekExecutor.isShutdown()) {
            seekExecutor = Executors.newSingleThreadExecutor();
        }
        return seekExecutor;
    }

    private void tracePlayback(String where) {
        boolean nativePlaying = false;
        float nativePos = -1f;
        try {
            if (mMediaPlayer != null) {
                nativePlaying = mMediaPlayer.isPlaying();
                nativePos = mMediaPlayer.getPosition();
            }
        } catch (Exception ignored) {
        }
        Log.w(TAG, "[TRACE] " + where
                + " | isPaused=" + isPaused
                + " isHostPaused=" + isHostPaused
                + " playInBackground=" + playInBackground
                + " isInPipMode=" + isInPipMode
                + " surfaceDestroyed=" + isSurfaceViewDestory
                + " nativePlaying=" + nativePlaying
                + " nativePos=" + nativePos);
    }

    private MediaPlayer.EventListener mPlayerListener = new MediaPlayer.EventListener() {
        @Override
        public void onEvent(MediaPlayer.Event event) {
            if (mMediaPlayer == null)
                return;

            // OPTIMIZATION: Only create WritableMap for events that actually need it.
            // This avoids JNI allocations and VLC API calls for high-frequency ignored
            // events.
            switch (event.type) {
                case MediaPlayer.Event.EndReached: {
                    mNativeStopped = true;
                    // CRITICAL FIX: Emit final 100% progress event before Ending
                    // This ensures the seekbar always snaps to the very end
                    WritableMap progressMap = Arguments.createMap();
                    if (progressMap != null && mMediaPlayer != null) {
                        progressMap.putBoolean("isPlaying", false);
                        progressMap.putDouble("position", 1.0);
                        progressMap.putDouble("currentTime", mMediaPlayer.getLength());
                        progressMap.putDouble("duration", mMediaPlayer.getLength());
                        eventEmitter.sendEvent(progressMap, VideoEventEmitter.EVENT_PROGRESS);
                    }

                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Ended");
                    setKeepScreenOn(false);
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_END);
                    break;
                }
                case MediaPlayer.Event.Playing: {
                    mNativeStopped = false;
                    // Root race fix: VLC can transiently report Playing while user intent is paused
                    // (seek revive, decoder wake-up, rapid toggle). Do not surface it.
                    if (isPaused) {
                        tracePlayback("event:Playing(suppressed-paused-intent)");
                        try {
                            if (mMediaPlayer.isPlaying()) {
                                mMediaPlayer.pause();
                            }
                        } catch (Exception ignored) {
                        }
                        setKeepScreenOn(false);
                        updatePlayPauseState(PlaybackStateCompat.STATE_PAUSED);
                        break;
                    }
                    if (isTransientSeekPlaybackSuppressed()) {
                        tracePlayback("event:Playing(suppressed-transient-seek)");
                        consumeTransientSeekSuppression();
                        // Skip transient playing event generated by internal seek flush.
                        break;
                    }
                    tracePlayback("event:Playing");
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;

                    // Force disable subtitles after VLC auto-enables them
                    // VLC automatically enables the first subtitle track when media loads,
                    // so we need to re-apply our desired text track setting here
                    if (_textTrack == -1 && mMediaPlayer.getSpuTracksCount() > 0) {
                        mMediaPlayer.setSpuTrack(-1);
                        Log.i(TAG, "Force disabled embedded subtitles in Playing event");
                    } else if (_textTrack != -1) {
                        mMediaPlayer.setSpuTrack(_textTrack);
                        Log.i(TAG, "Applied text track " + _textTrack + " in Playing event");
                    }

                    // Apply stored audio track ONLY if it has changed
                    // CRITICAL FIX: Don't blindly reapply audio track on every Playing event
                    // as it causes VLC to reinitialize the audio decoder → 2 second silence
                    if (_audioTrack != -1 && _audioTrack != currentlyAppliedAudioTrack) {

                        mMediaPlayer.setAudioTrack(_audioTrack);
                        currentlyAppliedAudioTrack = _audioTrack;
                        Log.i(TAG, "Applied audio track " + _audioTrack + " in Playing event");
                    } else {

                    }

                    // Apply stored audio delay if set (safety net)
                    if (mAudioDelay != 0) {
                        mMediaPlayer.setAudioDelay(mAudioDelay * 1000);
                        Log.i(TAG, "Re-applied audio delay " + mAudioDelay + "ms in Playing event (safety net)");
                    }

                    // FALLBACK: Get video dimensions from video track if onNewVideoLayout hasn't
                    // fired
                    // NOTE: VideoTrack does NOT provide SAR, so this is only for getting pixel
                    // dimensions
                    // The proper SAR will be applied when onNewVideoLayout fires
                    if (mVideoWidth <= 0 || mVideoHeight <= 0) {
                        Media.VideoTrack videoTrack = mMediaPlayer.getCurrentVideoTrack();
                        if (videoTrack != null && videoTrack.width > 0 && videoTrack.height > 0) {
                            mVideoWidth = videoTrack.width;
                            mVideoHeight = videoTrack.height;
                            Log.i(TAG, "Got video dimensions from track: " + mVideoWidth + "x" + mVideoHeight
                                    + " (SAR will come from onNewVideoLayout)");

                            // CRITICAL FIX: Use debounced request instead of direct call
                            // This prevents race conditions and ensures resize happens at the right time
                            requestResizeMode();
                        } else {
                            Log.w(TAG, "Could not get video dimensions from track");
                        }
                    }

                    setKeepScreenOn(true); // Acquire wake lock
                    emitPlayingEvent(map);

                    // RE-APPLIED FIX: Move video info update here (only when playback starts)
                    // instead of in the progress polling loop to save CPU cycles.
                    updateVideoInfo();

                    updateMediaMetadata();
                    updatePlayPauseState(PlaybackStateCompat.STATE_PLAYING);
                    break;
                }
                case MediaPlayer.Event.Opening: {
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Opening");
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_OPEN);
                    break;
                }
                case MediaPlayer.Event.Paused: {
                    mNativeStopped = false;
                    if (isTransientSeekPlaybackSuppressed()) {
                        tracePlayback("event:Paused(suppressed-transient-seek)");
                        consumeTransientSeekSuppression();
                        // Skip transient paused event generated by internal seek flush.
                        break;
                    }
                    tracePlayback("event:Paused");
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    setKeepScreenOn(false); // Release wake lock
                    emitPausedEvent(map);
                    updatePlayPauseState(PlaybackStateCompat.STATE_PAUSED);
                    break;
                }
                case MediaPlayer.Event.Buffering:
                    // Debounce buffering events to reduce bridge crossings
                    final float bufferRate = event.getBuffering();

                    if (pendingBufferingEvent != null) {
                        bufferingHandler.removeCallbacks(pendingBufferingEvent);
                    }

                    pendingBufferingEvent = new Runnable() {
                        @Override
                        public void run() {
                            WritableMap bufferMap = Arguments.createMap();
                            bufferMap.putDouble("bufferRate", bufferRate);
                            bufferMap.putString("type", "Buffering");
                            eventEmitter.sendEvent(bufferMap, VideoEventEmitter.EVENT_ON_VIDEO_BUFFERING);
                            pendingBufferingEvent = null;
                        }
                    };

                    bufferingHandler.postDelayed(pendingBufferingEvent, BUFFERING_DEBOUNCE_MS);
                    break;
                case MediaPlayer.Event.Stopped: {
                    tracePlayback("event:Stopped");
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    isPaused = true;
                    mNativeStopped = true;
                    map.putString("type", "Stopped");
                    setKeepScreenOn(false); // Release wake lock
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_VIDEO_STOPPED);
                    updatePlayPauseState(PlaybackStateCompat.STATE_STOPPED);
                    break;
                }
                case MediaPlayer.Event.EncounteredError: {
                    mNativeStopped = true;
                    tracePlayback("event:EncounteredError");
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Error");
                    setKeepScreenOn(false); // Release wake lock
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_ERROR);
                    break;
                }
                case MediaPlayer.Event.TimeChanged:
                    // REMOVED bridge spam: TimeChanged fires every frame (30-60+ times/sec)
                    // Progress is already handled by our 250ms polling loop.
                    // Logic moved to JS handleProgress.
                    break;
                case MediaPlayer.Event.RecordChanged: {
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "RecordingPath");
                    map.putBoolean("isRecording", event.getRecording());
                    // Record started emits and event with the record path (but no file).
                    // Only want to emit when recording has stopped and the recording is created.
                    if (!event.getRecording() && event.getRecordPath() != null) {
                        map.putString("recordPath", event.getRecordPath());
                    }
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_RECORDING_STATE);
                    break;
                }
                default:
                    // OPTIMIZATION: Suppress unknown events to avoid unnecessary bridge crossings.
                    // VLC fires many internal events we don't need in JS.
                    break;
            }

        }
    };

    private IVLCVout.OnNewVideoLayoutListener onNewVideoLayoutListener = new IVLCVout.OnNewVideoLayoutListener() {
        @Override
        public void onNewVideoLayout(IVLCVout vout, int width, int height, int visibleWidth, int visibleHeight,
                int sarNum, int sarDen) {
            if (width * height == 0)
                return;

            // Store video size
            mVideoWidth = width;
            mVideoHeight = height;
            mVideoVisibleWidth = visibleWidth;
            mVideoVisibleHeight = visibleHeight;
            mSarNum = sarNum;
            mSarDen = sarDen;

            Log.d(TAG, String.format("New video layout: %dx%d (visible: %dx%d, SAR: %d:%d)", width, height,
                    visibleWidth, visibleHeight, sarNum, sarDen));

            // Use debounce mechanism to apply resize mode
            requestResizeMode();

            WritableMap map = Arguments.createMap();
            map.putInt("mVideoWidth", mVideoWidth);
            map.putInt("mVideoHeight", mVideoHeight);
            map.putInt("mVideoVisibleWidth", mVideoVisibleWidth);
            map.putInt("mVideoVisibleHeight", mVideoVisibleHeight);
            map.putInt("mSarNum", mSarNum);
            map.putInt("mSarDen", mSarDen);
            map.putString("type", "onNewVideoLayout");

            // Update track/video info when layout changes
            updateVideoInfo();

            eventEmitter.onVideoStateChange(map);
        }
    };

    /*************
     * MediaPlayer
     *************/

    private void stopPlayback() {
        onStopPlayback();
        releasePlayer();
    }

    private void onStopPlayback() {
        setKeepScreenOn(false);
        abandonAudioFocusInternal();

        // Clean up buffering handler
        if (pendingBufferingEvent != null) {
            bufferingHandler.removeCallbacks(pendingBufferingEvent);
            pendingBufferingEvent = null;
        }
    }

    private void createPlayer(boolean autoplayResume, boolean isResume) {
        releasePlayer();
        if (this.getSurfaceTexture() == null) {
            return;
        }
        if (srcMap == null) {
            Log.w(TAG, "createPlayer: source map is null, skipping player creation.");
            return;
        }
        try {
            final ArrayList<String> cOptions = new ArrayList<>();
            String uriString = srcMap.hasKey("uri") ? srcMap.getString("uri") : null;
            if (TextUtils.isEmpty(uriString)) {
                Log.w(TAG, "createPlayer: URI is empty or null, skipping.");
                return;
            }
            boolean isNetwork = srcMap.hasKey("isNetwork") ? srcMap.getBoolean("isNetwork") : false;
            boolean autoplay = srcMap.hasKey("autoplay") ? srcMap.getBoolean("autoplay") : true;
            int initType = srcMap.hasKey("initType") ? srcMap.getInt("initType") : 1;
            ReadableArray mediaOptions = srcMap.hasKey("mediaOptions") ? srcMap.getArray("mediaOptions") : null;
            ReadableArray initOptions = srcMap.hasKey("initOptions") ? srcMap.getArray("initOptions") : null;
            // Robust Defaults: Enable HW Decoder by default (1), Do not force (0)
            Integer hwDecoderEnabled = srcMap.hasKey("hwDecoderEnabled") ? srcMap.getInt("hwDecoderEnabled") : 1;
            Integer hwDecoderForced = srcMap.hasKey("hwDecoderForced") ? srcMap.getInt("hwDecoderForced") : 0;

            if (initOptions != null) {
                ArrayList options = initOptions.toArrayList();
                for (int i = 0; i < options.size(); i++) {
                    String option = (String) options.get(i);
                    cOptions.add(option);
                }
            } else {
                // Performance optimizations if no custom options provided
                cOptions.add("--network-caching=600");
                cOptions.add("--file-caching=600");
                cOptions.add("--live-caching=600");
                // Removed aggressive quality flags (RV32, skip-idct=0) that caused lag on
                // low-end devices
            }

            // CRITICAL: Always add these audio options regardless of custom initOptions
            // This fixes audio dropouts during speed changes, track switches, and
            // play/pause
            cOptions.add("--audio-time-stretch");
            cOptions.add("--audio-filter=scaletempo");
            cOptions.add("--scaletempo-overlap=0.30"); // 30% overlap for smoother transitions
            cOptions.add("--scaletempo-search=15"); // 15ms search window
            cOptions.add("--audio-desync=100"); // 100ms buffer to smooth glitches
            // Create LibVLC
            if (initType == 1) {
                libvlc = new LibVLC(getContext());
            } else {
                libvlc = new LibVLC(getContext(), cOptions);
            }
            // Create media player
            mMediaPlayer = new MediaPlayer(libvlc);
            setMutedModifier(mMuted);
            mMediaPlayer.setEventListener(mPlayerListener);

            // Register dialog callbacks for certificate handling
            Dialog.setCallbacks(libvlc, new Dialog.Callbacks() {
                @Override
                public void onDisplay(Dialog.QuestionDialog dialog) {
                    handleCertificateDialog(dialog);
                }

                @Override
                public void onDisplay(Dialog.ErrorMessage dialog) {
                    // Handle error dialogs if needed
                }

                @Override
                public void onDisplay(Dialog.LoginDialog dialog) {
                    // Handle login dialogs if needed
                }

                @Override
                public void onDisplay(Dialog.ProgressDialog dialog) {
                    // Handle progress dialogs if needed
                }

                @Override
                public void onCanceled(Dialog dialog) {
                    // Handle dialog cancellation
                }

                @Override
                public void onProgressUpdate(Dialog.ProgressDialog dialog) {
                    // Handle progress updates
                }
            });

            IVLCVout vlcOut = mMediaPlayer.getVLCVout();

            // Set initial window size if available
            int viewWidth = getWidth();
            int viewHeight = getHeight();
            if (viewWidth > 0 && viewHeight > 0) {
                vlcOut.setWindowSize(viewWidth, viewHeight);
                if (autoAspectRatio) {
                    mMediaPlayer.setAspectRatio(viewWidth + ":" + viewHeight);
                }
            }

            Media m = null;
            if (isNetwork) {
                Uri uri = Uri.parse(uriString);
                m = new Media(libvlc, uri);
            } else if (uriString != null && uriString.startsWith("content://")) {
                // Use FileDescriptor for content:// URIs to ensure we can read them
                try {
                    Uri uri = Uri.parse(uriString);
                    ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(uri, "r");
                    if (pfd != null) {
                        FileDescriptor fd = pfd.getFileDescriptor();
                        m = new Media(libvlc, fd);
                        // Store pfd to close it later
                        if (currentPfd != null) {
                            try {
                                currentPfd.close();
                            } catch (Exception ignored) {
                            }
                        }
                        currentPfd = pfd;
                    } else {
                        throw new Exception("Could not open FileDescriptor for " + uriString);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to open content URI: " + e.getMessage());
                    // Fallback to URI method if FD fails
                    Uri uri = Uri.parse(uriString);
                    m = new Media(libvlc, uri);
                }
            } else {
                m = new Media(libvlc, uriString);
            }
            m.setEventListener(mMediaListener);
            // Apply HW Decoder settings (always applied due to robust defaults)
            boolean hmEnabled = (hwDecoderEnabled >= 1);
            boolean hmForced = (hwDecoderForced >= 1);
            m.setHWDecoderEnabled(hmEnabled, hmForced);
            Log.i(TAG, "HW Decoder: enabled=" + hmEnabled + ", forced=" + hmForced);

            // Add media options
            if (mediaOptions != null) {
                ArrayList options = mediaOptions.toArrayList();
                for (int i = 0; i < options.size(); i++) {
                    String option = (String) options.get(i);
                    m.addOption(option);
                }
            }

            // CRITICAL FIX: Add audio delay as media option for early application
            if (mAudioDelay != 0) {
                // VLC's audio-desync option expects milliseconds
                m.addOption(":audio-desync=" + mAudioDelay);
                Log.i(TAG, "Added audio delay media option: " + mAudioDelay + "ms");
            }

            mVideoInfoHash = null;
            isResizeModeApplied = false;
            currentlyAppliedAudioTrack = -1; // Reset to force audio track reapplication for new media
            mLastBridgeSeekValue = Float.NaN; // Reset seek filter for new media
            mLastPlaybackEventType = null;
            mLastPlaybackEventTimestamp = 0L;
            mNativeStopped = false;

            mMediaPlayer.setMedia(m);
            m.release();
            mMediaPlayer.setScale(0);

            if (_subtitleUri != null) {
                mMediaPlayer.addSlave(Media.Slave.Type.Subtitle, _subtitleUri, true);
            }

            // Apply equalizer before attaching views
            applyEqualizer();

            // CRITICAL FIX: Apply audio delay BEFORE starting playback
            if (mAudioDelay != 0) {
                boolean success = mMediaPlayer.setAudioDelay(mAudioDelay * 1000);
                Log.i(TAG, "Pre-applied audio delay: " + mAudioDelay + "ms, success: " + success);
            }

            if (!vlcOut.areViewsAttached()) {
                vlcOut.addCallback(callback);
                vlcOut.setVideoSurface(this.getSurfaceTexture());
                vlcOut.attachViews(onNewVideoLayoutListener);
            }

            // RESTORE SAVED POSITION if available
            if (mSavedPosition > 0f) {
                final float positionToRestore = mSavedPosition;
                mSavedPosition = 0f; // Clear saved position

                // Start playback first, then seek
                if (isResume) {
                    if (autoplayResume) {
                        if (requestAudioFocusInternal()) {
                            mMediaPlayer.play();
                        }
                    }
                } else {
                    if (autoplay) {
                        isPaused = false;
                        if (requestAudioFocusInternal()) {
                            mMediaPlayer.play();
                        }
                    }
                }

                // Restore position after player has started with a small delay

                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (mMediaPlayer != null) {

                            // Use our background seek method
                            setPosition(positionToRestore);

                        }
                    }
                }, 200);

            } else {
                if (isResume) {
                    if (autoplayResume) {
                        if (requestAudioFocusInternal()) {
                            mMediaPlayer.play();
                        }
                    }
                } else {
                    if (autoplay) {
                        isPaused = false;
                        if (requestAudioFocusInternal()) {
                            mMediaPlayer.play();
                        }
                    }
                }
            }

            eventEmitter.loadStart();
            setProgressUpdateRunnable();

        } catch (Exception e) {
            e.printStackTrace();
            Log.e(TAG, "Error creating player: " + e.getMessage());
        }
    }

    private void releasePlayer() {
        clearPendingResizeRequest();

        // Clean up buffering handler
        if (pendingBufferingEvent != null) {
            bufferingHandler.removeCallbacks(pendingBufferingEvent);
            pendingBufferingEvent = null;
        }

        if (mProgressUpdateRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mProgressUpdateRunnable);
        }
        if (mPendingSeekFlushPlayRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mPendingSeekFlushPlayRunnable);
            mPendingSeekFlushPlayRunnable = null;
        }
        if (mPendingSeekVerifyRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mPendingSeekVerifyRunnable);
            mPendingSeekVerifyRunnable = null;
        }
        if (mPendingReviveFallbackRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mPendingReviveFallbackRunnable);
            mPendingReviveFallbackRunnable = null;
        }

        if (mMediaPlayer != null) {
            // SAVE POSITION before releasing
            try {
                // Only save if we are not at the very beginning or very end (to avoid restart
                // loops)
                float currentPos = mMediaPlayer.getPosition();

                if (currentPos > 0.01f && currentPos < 0.99f) {
                    mSavedPosition = currentPos;

                } else {
                    mSavedPosition = 0f;

                }
            } catch (Exception e) {

                mSavedPosition = 0f;
            }

            final IVLCVout vout = mMediaPlayer.getVLCVout();
            vout.removeCallback(callback);
            vout.detachViews();
            mMediaPlayer.release();
            mMediaPlayer = null;
        }

        if (libvlc != null) {
            libvlc.release();
            libvlc = null;
        }

        if (currentPfd != null) {
            try {
                currentPfd.close();
            } catch (Exception e) {
                Log.e(TAG, "Error closing pfd: " + e.getMessage());
            }
            currentPfd = null;
        }

        isResizeModeApplied = false;
        mVideoWidth = 0;
        mVideoHeight = 0;
        mVideoVisibleWidth = 0;
        mVideoVisibleHeight = 0;
        mSarNum = 0;
        mSarDen = 0;
        currentlyAppliedAudioTrack = -1; // Reset tracking state
        mLastBridgeSeekValue = Float.NaN; // Reset seek filter
        mBestFitUsingCover = null;
        mLastRequestedSeekPosition = -1f;
        mLastRequestedSeekAtMs = 0L;
        clearTransientSeekSuppression();
    }

    // Track last seek to prevent identical repeated seeks
    private float lastSeekPosition = -1f;
    private long mLastSeekTargetMs = -1L;
    private static final long SEEK_TIME_EPSILON_MS = 60L;
    private long mLastReviveFallbackTime = 0L;
    private static final long REVIVE_FALLBACK_COOLDOWN_MS = 900L;
    // Fraction fallback for unknown-duration streams when targetMs is unavailable.
    private static final float SEEK_THRESHOLD = 0.0001f;

    private float resolveRestartTarget(float defaultTarget) {
        final long now = System.currentTimeMillis();
        if (mLastRequestedSeekAtMs > 0
                && (now - mLastRequestedSeekAtMs) <= SEEK_OVERRIDE_RECENT_MS
                && mLastRequestedSeekPosition >= 0f
                && mLastRequestedSeekPosition <= 1f) {
            return Math.max(0f, Math.min(0.98f, mLastRequestedSeekPosition));
        }
        return Math.max(0f, Math.min(0.98f, defaultTarget));
    }

    private void scheduleReviveFallback(final float targetPosition, final String reason) {
        final long now = System.currentTimeMillis();
        final boolean replacingPending = mPendingReviveFallbackRunnable != null;
        if (!replacingPending && (now - mLastReviveFallbackTime) < REVIVE_FALLBACK_COOLDOWN_MS) {
            return;
        }
        mLastReviveFallbackTime = now;

        if (mPendingReviveFallbackRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mPendingReviveFallbackRunnable);
            mPendingReviveFallbackRunnable = null;
        }

        mPendingReviveFallbackRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    if (mMediaPlayer == null) {
                        mPendingReviveFallbackRunnable = null;
                        return;
                    }
                    // Do not recreate player when user intent is paused.
                    if (isPaused) {
                        mPendingReviveFallbackRunnable = null;
                        return;
                    }
                    if (mMediaPlayer.isPlaying()) {
                        mPendingReviveFallbackRunnable = null;
                        return;
                    }
                    if (srcMap == null) {
                        mPendingReviveFallbackRunnable = null;
                        return;
                    }

                    final boolean keepPausedIntent = isPaused;
                    final float clamped = Math.max(0f, Math.min(0.98f, targetPosition));
                    Log.w(TAG, "reviveFallback: reason=" + reason + ", target=" + clamped
                            + " recreating player, keepPausedIntent=" + keepPausedIntent);
                    mSavedPosition = clamped;
                    // Temporarily allow autoplay during recreation so VLC can decode and seek.
                    isPaused = false;
                    createPlayer(true, true);

                    // Restore paused intent after recreation if user was paused.
                    if (keepPausedIntent) {
                        mProgressUpdateHandler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                if (mMediaPlayer != null) {
                                    isPaused = true;
                                    mMediaPlayer.pause();
                                    setKeepScreenOn(false);
                                }
                            }
                        }, 220);
                    }
                } catch (Exception ignored) {
                } finally {
                    mPendingReviveFallbackRunnable = null;
                }
            }
        };
        mProgressUpdateHandler.postDelayed(mPendingReviveFallbackRunnable, 240);
    }

    /**
     * Determines if a seek call from the React bridge should be skipped.
     * Prevents spamming the native player with identical position requests.
     * Called on the Main UI Thread.
     */
    public boolean shouldSkipSeek(float seek) {
        // Value -1 means "no seek requested" from JS side (sentinel value)
        if (seek < 0) {
            return true;
        }

        // Skip identical consecutive values (common during React
        // re-renders/reconciliation)
        // We use strict equality here as we are filtering the exact values sent over
        // the bridge
        if (seek == mLastBridgeSeekValue) {
            return true;
        }

        mLastBridgeSeekValue = seek;
        return false;
    }

    /**
     * 视频进度调整
     *
     * @param position
     */
    public void setPosition(final float position) {
        if (mMediaPlayer == null) {
            return;
        }
        if (position < 0 || position > 1) {
            return;
        }

        mLastRequestedSeekPosition = position;
        mLastRequestedSeekAtMs = System.currentTimeMillis();

        // libVLC player mutations are safer on main thread (play/pause/seek sequencing).
        mProgressUpdateHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (mMediaPlayer == null) {
                        return;
                    }

                    boolean nativePlaying = mMediaPlayer.isPlaying();
                    float nativePos = mMediaPlayer.getPosition();
                    long lengthMs = mMediaPlayer.getLength();
                    long currentMs = mMediaPlayer.getTime();
                    long targetMs = lengthMs > 0 ? (long) (position * lengthMs) : -1L;

                    // Skip only if target is effectively unchanged.
                    // Prefer time-based epsilon for consistency across short/long videos.
                    if (targetMs >= 0) {
                        if (mLastSeekTargetMs >= 0 && Math.abs(targetMs - mLastSeekTargetMs) < SEEK_TIME_EPSILON_MS) {
                            return;
                        }
                        mLastSeekTargetMs = targetMs;
                    } else {
                        // Fallback for unknown-duration media.
                        if (Math.abs(position - lastSeekPosition) < SEEK_THRESHOLD) {
                            return;
                        }
                        lastSeekPosition = position;
                    }

                    final int seekToken = ++mSeekToken;
                    // If native core is stopped (or close to end), seek must revive playback path first.
                    boolean likelyStoppedOrEnded = mNativeStopped || nativePos < 0f || nativePos >= END_STATE_POSITION_THRESHOLD;
                    boolean shouldReviveForSeek = !isPaused && !nativePlaying && likelyStoppedOrEnded;
                    boolean backwardSeek = targetMs >= 0 && currentMs >= 0 && (currentMs - targetMs) > 200;
                    boolean nearEndWindow = nativePos >= 0.78f
                            || (lengthMs > 0 && currentMs >= (long) (lengthMs * 0.75f));
                    boolean largeBackwardSeek = nativePlaying
                            && targetMs >= 0
                            && currentMs >= 0
                            && (currentMs - targetMs) > 2500;
                    boolean backwardNearEndSeek = nativePlaying && backwardSeek && nearEndWindow;
                    // Prefer direct seek for responsiveness; keep flush only for fragile near-end backward jumps.
                    // Verification pass below still recovers true stalls.
                    boolean needsFlush = backwardNearEndSeek;
                    Log.d(TAG, "setPosition: target=" + position + ", nativePos=" + nativePos
                            + ", nativePlaying=" + nativePlaying + ", isPaused=" + isPaused
                            + ", targetMs=" + targetMs + ", currentMs=" + currentMs
                            + ", revive=" + shouldReviveForSeek
                            + ", backwardSeek=" + backwardSeek
                            + ", nearEndWindow=" + nearEndWindow
                            + ", needsFlush=" + needsFlush);

                    if (shouldReviveForSeek) {
                        if (mPendingReviveFallbackRunnable != null) {
                            mProgressUpdateHandler.removeCallbacks(mPendingReviveFallbackRunnable);
                            mPendingReviveFallbackRunnable = null;
                        }
                        final boolean keepPausedAfterSeek = isPaused;
                        requestAudioFocusInternal();
                        mMediaPlayer.play();
                        if (targetMs >= 0) {
                            mMediaPlayer.setTime(targetMs);
                        } else {
                            mMediaPlayer.setPosition(position);
                        }

                        // If user intent is paused, pause again after forcing frame refresh.
                        if (keepPausedAfterSeek) {
                            mProgressUpdateHandler.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    if (mMediaPlayer != null && isPaused) {
                                        mMediaPlayer.pause();
                                        setKeepScreenOn(false);
                                    }
                                }
                            }, 100);
                        }
                        scheduleReviveFallback(Math.max(0f, Math.min(0.98f, position)), "seek-revive-from-stopped");
                    } else if (!nativePlaying && !isPaused) {
                        if (targetMs >= 0) {
                            mMediaPlayer.setTime(targetMs);
                        } else {
                            mMediaPlayer.setPosition(position);
                        }
                        requestAudioFocusInternal();
                        mMediaPlayer.play();
                        if (mNativeStopped || nativePos >= END_STATE_POSITION_THRESHOLD) {
                            scheduleReviveFallback(Math.max(0f, Math.min(0.98f, position)), "seek-from-stopped");
                        }
                    } else {
                        if (needsFlush && targetMs >= 0) {
                            Log.d(TAG, "setPosition: flush path, currentMs=" + currentMs
                                    + ", targetMs=" + targetMs
                                    + ", largeBackwardSeek=" + largeBackwardSeek
                                    + ", backwardNearEndSeek=" + backwardNearEndSeek);
                            beginTransientSeekSuppression();
                            mMediaPlayer.pause();
                            mMediaPlayer.setTime(targetMs);

                            if (!isPaused) {
                                if (mPendingSeekFlushPlayRunnable != null) {
                                    mProgressUpdateHandler.removeCallbacks(mPendingSeekFlushPlayRunnable);
                                }
                                mPendingSeekFlushPlayRunnable = new Runnable() {
                                    @Override
                                    public void run() {
                                        if (mMediaPlayer != null && !isPaused) {
                                            requestAudioFocusInternal();
                                            mMediaPlayer.play();
                                        }
                                    }
                                };
                                mProgressUpdateHandler.post(mPendingSeekFlushPlayRunnable);
                            }
                        } else {
                            if (targetMs >= 0) {
                                mMediaPlayer.setTime(targetMs);
                            } else {
                                mMediaPlayer.setPosition(position);
                            }
                        }
                    }

                    // Verify seek landed in two phases. A single early check misses delayed stalls.
                    if (!isPaused && targetMs >= 0) {
                        scheduleSeekVerify(targetMs, seekToken, 0);
                    }

                    WritableMap seekMap = createEventMap();
                    if (seekMap != null) {
                        seekMap.putString("type", "TimeChanged");
                        eventEmitter.sendEvent(seekMap, VideoEventEmitter.EVENT_SEEK);
                    }
                } catch (Exception ignored) {
                }
            }
        });
    }

    private void performSeekRecoveryFlush(final long targetForVerify) {
        if (mMediaPlayer == null || isPaused) {
            return;
        }
        beginTransientSeekSuppression();
        mMediaPlayer.pause();
        mMediaPlayer.setTime(targetForVerify);

        if (mPendingSeekFlushPlayRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mPendingSeekFlushPlayRunnable);
        }
        mPendingSeekFlushPlayRunnable = new Runnable() {
            @Override
            public void run() {
                if (mMediaPlayer != null && !isPaused) {
                    requestAudioFocusInternal();
                    mMediaPlayer.play();
                }
            }
        };
        mProgressUpdateHandler.post(mPendingSeekFlushPlayRunnable);
    }

    private void scheduleSeekVerify(final long targetForVerify, final int seekToken, final int pass) {
        if (mMediaPlayer == null || isPaused) {
            return;
        }
        if (mPendingSeekVerifyRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mPendingSeekVerifyRunnable);
        }

        final long delay = pass == 0 ? SEEK_VERIFY_DELAY_EARLY_MS : SEEK_VERIFY_DELAY_LATE_MS;
        mPendingSeekVerifyRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    if (mMediaPlayer == null || isPaused) {
                        return;
                    }
                    if (seekToken != mSeekToken) {
                        return;
                    }

                    long nowMs = mMediaPlayer.getTime();
                    long drift = Math.abs(nowMs - targetForVerify);
                    long nowWall = System.currentTimeMillis();
                    long sinceFrameMs = mLastSurfaceUpdateAtMs > 0
                            ? (nowWall - mLastSurfaceUpdateAtMs)
                            : 0L;
                    boolean nativePlaying = mMediaPlayer.isPlaying();
                    boolean unexpectedlyNotPlaying = !nativePlaying;
                    boolean behindTargetTooFar = nowMs + 350 < targetForVerify;
                    boolean advancedPastTarget = nowMs > (targetForVerify + (pass == 0 ? 2000 : 1800));
                    // Frame stall alone causes false positives on some devices near scene cuts;
                    // require a time-position anomaly in addition to stale frames.
                    boolean frameLikelyStalled = nativePlaying
                            && sinceFrameMs > (SEEK_FRAME_STALL_MS * 3)
                            && (behindTargetTooFar || advancedPastTarget);

                    if (unexpectedlyNotPlaying) {
                        if (Math.abs(nowMs - targetForVerify) <= 250) {
                            requestAudioFocusInternal();
                            mMediaPlayer.play();
                            if (mNativeStopped) {
                                float pos = mMediaPlayer.getPosition();
                                scheduleReviveFallback(Math.max(0f, Math.min(0.98f, pos)), "seek-verify-not-playing");
                            }
                            if (pass == 0) {
                                scheduleSeekVerify(targetForVerify, seekToken, 1);
                            }
                            return;
                        }
                        // If not playing and not near target, use regular recovery path below.
                    }

                    if (behindTargetTooFar || advancedPastTarget || frameLikelyStalled) {
                        Log.w(TAG, "seekVerify(pass=" + pass + "): drift=" + drift
                                + ", nowMs=" + nowMs
                                + ", targetMs=" + targetForVerify
                                + ", nativePlaying=" + nativePlaying
                                + ", sinceFrameMs=" + sinceFrameMs
                                + " -> recovery flush");
                        performSeekRecoveryFlush(targetForVerify);
                        return;
                    }

                    if (pass == 0) {
                        scheduleSeekVerify(targetForVerify, seekToken, 1);
                    }
                } catch (Exception ignored) {
                }
            }
        };
        mProgressUpdateHandler.postDelayed(mPendingSeekVerifyRunnable, delay);
    }

    public void setSubtitleUri(String subtitleUri) {
        _subtitleUri = subtitleUri;
        if (mMediaPlayer != null) {
            mMediaPlayer.addSlave(Media.Slave.Type.Subtitle, _subtitleUri, true);
        }
    }

    /**
     * 设置资源路径
     *
     * @param uri
     * @param isNetStr
     */
    public void setSrc(String uri, boolean isNetStr, boolean autoplay) {
        this.src = uri;

        // CRITICAL FIX: Ensure clean state for new source even in this overload
        releasePlayer();
        mSavedPosition = 0f;

        createPlayer(autoplay, false);
    }

    public void setSrc(ReadableMap src) {
        if (src == null) {
            return;
        }
        String newUri = src.hasKey("uri") ? src.getString("uri") : null;
        // Optimization: If URI is identical and player exists, avoid recreation.
        if (newUri != null && this.src != null && newUri.equals(this.src) && mMediaPlayer != null) {
            Log.i(TAG, "setSrc: URI is identical (" + newUri + "), skipping player recreation.");
            this.srcMap = src;
            return;
        }

        this.src = newUri;
        this.srcMap = src;

        // CRITICAL FIX: Changing source!
        // We must release the old player and Explicitly CLEAN saved position.
        releasePlayer();
        mSavedPosition = 0f; // Clear position for new video

        createPlayer(true, false);
    }

    /**
     * 改变播放速率
     *
     * @param rateModifier
     */
    public void setRateModifier(float rateModifier) {
        long timestamp = System.currentTimeMillis();

        if (mMediaPlayer != null) {
            int currentAudioTrack = mMediaPlayer.getAudioTrack();

            mMediaPlayer.setRate(rateModifier);

            updatePlayPauseState(
                    mMediaPlayer.isPlaying() ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED);

        }
    }

    public void setmProgressUpdateInterval(float interval) {
        mProgressUpdateInterval = interval;
        if (mProgressUpdateRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mProgressUpdateRunnable);
            mProgressUpdateRunnable = null;
        }
        if (mMediaPlayer != null && mProgressUpdateInterval > 0) {
            setProgressUpdateRunnable();
        }
    }

    /**
     * Set Audio Delay in milliseconds
     * FIXED VERSION with retry mechanism
     * 
     * @param delayMs delay in milliseconds (positive = audio later, negative =
     *                audio earlier)
     */
    public void setAudioDelay(long delayMs) {
        mAudioDelay = delayMs;
        Log.i(TAG, "setAudioDelay called with: " + delayMs + "ms");

        if (mMediaPlayer != null) {
            // VLC expects microseconds (μs), so multiply by 1000
            final long delayUs = mAudioDelay * 1000;
            boolean success = mMediaPlayer.setAudioDelay(delayUs);
            Log.i(TAG, "Applied audio delay: " + mAudioDelay + "ms (" + delayUs + "μs), success: " + success);

            // Some VLC versions need the delay to be re-applied after a short delay
            // This ensures the delay takes effect properly
            if (mMediaPlayer.isPlaying()) {
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (mMediaPlayer != null) {
                            boolean retrySuccess = mMediaPlayer.setAudioDelay(delayUs);
                            Log.i(TAG,
                                    "Re-applied audio delay: " + mAudioDelay + "ms (retry), success: " + retrySuccess);
                        }
                    }
                }, 150); // 150ms delay to ensure it takes effect
            }
        } else {
            Log.w(TAG, "Cannot apply audio delay: MediaPlayer is null. Will be applied when player is created.");
        }
    }

    /**
     * 改变声音大小
     *
     * @param volumeModifier
     */
    public void setVolumeModifier(int volumeModifier) {
        // Clamp to libVLC's supported range (0-200)
        int clampedVolume = Math.max(0, Math.min(200, volumeModifier));
        this.preVolume = clampedVolume; // CRITICAL FIX: Update preVolume to track state
        if (mMediaPlayer != null) {
            mMediaPlayer.setVolume(clampedVolume);
        }
    }

    /**
     * 改变静音状态
     *
     * @param muted
     */
    public void setMutedModifier(boolean muted) {
        mMuted = muted;
        if (mMediaPlayer != null) {
            if (muted) {
                // Don't overwrite preVolume with getVolume() as it might be unreliable or
                // already 0
                // Just set player to 0
                mMediaPlayer.setVolume(0);
            } else {
                // Restore the tracked preVolume
                mMediaPlayer.setVolume(this.preVolume);
            }
        }
    }

    // Guard against rapid play/pause toggling
    private long lastPauseModifierTime = 0;
    private boolean lastPauseModifierState = true;
    private static final long PAUSE_MODIFIER_DEBOUNCE_MS = 50;

    /**
     * 改变播放状态
     *
     * @param paused
     */
    public void setPausedModifier(boolean paused) {
        long now = System.currentTimeMillis();
        tracePlayback("setPausedModifier:requested=" + paused);
        // Explicit user intent should cancel any stale internal seek suppression.
        clearTransientSeekSuppression();

        // Skip if same state requested within debounce window
        if (paused == lastPauseModifierState && (now - lastPauseModifierTime) < PAUSE_MODIFIER_DEBOUNCE_MS) {
            Log.d(TAG, "setPausedModifier: Skipping rapid duplicate call, paused=" + paused);
            return;
        }

        lastPauseModifierTime = now;
        lastPauseModifierState = paused;

        Log.i(TAG, "setPausedModifier: paused=" + paused + ", mMediaPlayer=" + mMediaPlayer);
        if (mMediaPlayer != null) {
            if (paused) {
                isPaused = true;
                if (mPendingReviveFallbackRunnable != null) {
                    mProgressUpdateHandler.removeCallbacks(mPendingReviveFallbackRunnable);
                    mPendingReviveFallbackRunnable = null;
                }
                mMediaPlayer.pause();
                tracePlayback("setPausedModifier:pause-called");
            } else {
                isPaused = false;
                // If we are at the very end and user clicks play, restart from beginning.
                // Also recover from "stopped but not ended" states via fallback recreate.
                float nativePos = mMediaPlayer.getPosition();
                boolean nativePlaying = mMediaPlayer.isPlaying();
                boolean nearEndOrInvalid = mNativeStopped || nativePos < 0f || nativePos >= END_STATE_POSITION_THRESHOLD;
                float restartTarget = nearEndOrInvalid ? resolveRestartTarget(0f) : Math.max(0f, nativePos);
                if (nearEndOrInvalid || !nativePlaying) {
                    if (nearEndOrInvalid) {
                        mMediaPlayer.setPosition(restartTarget);
                    }
                    requestAudioFocusInternal();
                    mMediaPlayer.play();
                    tracePlayback("setPausedModifier:play-called(revive-or-end)");
                    // Root fix: only fallback-recreate for true stopped/invalid/end states.
                    if (nearEndOrInvalid) {
                        scheduleReviveFallback(restartTarget, "play-from-stopped");
                    }
                } else {
                    requestAudioFocusInternal();
                    mMediaPlayer.play();
                    tracePlayback("setPausedModifier:play-called");
                }
            }
        } else {
            createPlayer(!paused, false);
        }
    }

    /**
     * Take a screenshot of the current video frame
     *
     * @param path The file path where to save the screenshot
     * @return boolean indicating if the screenshot was taken successfully
     */
    public boolean doSnapshot(String path) {
        if (mMediaPlayer != null) {
            Bitmap bitmap = null;
            try {
                bitmap = getBitmap();
                if (bitmap == null) {
                    WritableMap event = Arguments.createMap();
                    event.putBoolean("success", false);
                    event.putString("error", "Failed to capture bitmap");
                    eventEmitter.sendEvent(event, VideoEventEmitter.EVENT_ON_SNAPSHOT);
                    return false;
                }

                File file = new File(path);
                file.getParentFile().mkdirs();

                FileOutputStream out = new FileOutputStream(file);

                String extension = path.substring(path.lastIndexOf(".") + 1);
                if (extension.equals("png")) {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                } else {
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 100, out);
                }
                out.flush();
                out.close();

                WritableMap event = Arguments.createMap();
                event.putBoolean("success", true);
                event.putString("path", path);
                eventEmitter.sendEvent(event, VideoEventEmitter.EVENT_ON_SNAPSHOT);
                return true;
            } catch (Exception e) {
                WritableMap event = Arguments.createMap();
                event.putBoolean("success", false);
                event.putString("error", e.getMessage());
                eventEmitter.sendEvent(event, VideoEventEmitter.EVENT_ON_SNAPSHOT);
                e.printStackTrace();
                return false;
            } finally {
                if (bitmap != null) {
                    bitmap.recycle();
                }
            }
        }
        WritableMap event = Arguments.createMap();
        event.putBoolean("success", false);
        event.putString("error", "MediaPlayer is null");
        eventEmitter.sendEvent(event, VideoEventEmitter.EVENT_ON_SNAPSHOT);
        return false;
    }

    /**
     * 重新加载视频
     *
     * @param autoplay
     */
    public void doResume(boolean autoplay) {
        createPlayer(autoplay, true);
    }

    public void setRepeatModifier(boolean repeat) {
    }

    /**
     * 改变宽高比
     *
     * @param aspectRatio
     */
    public void setAspectRatio(String aspectRatio) {
        if (!autoAspectRatio && mMediaPlayer != null) {
            mMediaPlayer.setAspectRatio(aspectRatio);
        }
    }

    public void setAutoAspectRatio(boolean auto) {
        if (autoAspectRatio == auto) {
            return;
        }
        autoAspectRatio = auto;
        requestResizeMode();
    }

    public void setAudioTrack(int track) {
        _audioTrack = track;
        if (mMediaPlayer != null) {
            mMediaPlayer.setAudioTrack(track);
        }
    }

    public void setTextTrack(int track) {
        _textTrack = track; // Store the desired text track
        if (mMediaPlayer != null) {
            mMediaPlayer.setSpuTrack(track);
        } else {
            // mMediaPlayer is null, handle gracefully if needed or ignore
        }
    }

    public void startRecording(String recordingPath) {
        if (mMediaPlayer == null)
            return;
        if (recordingPath != null) {
            mMediaPlayer.record(recordingPath);
        }
    }

    public void stopRecording() {
        if (mMediaPlayer == null)
            return;
        mMediaPlayer.record(null);
    }

    public void stopPlayer() {
        if (mMediaPlayer == null)
            return;
        abandonAudioFocusInternal();
        mNativeStopped = true;
        mMediaPlayer.stop();
    }

    /**
     * Pause the player (keeps resources loaded)
     */
    public void pausePlayer() {
        if (mMediaPlayer == null)
            return;
        if (!isPaused) {
            isPaused = true;
            mMediaPlayer.pause();
            setKeepScreenOn(false);

            // Notify JS side so UI stays in sync
            WritableMap map = createEventMap();
            if (map != null) {
                emitPausedEvent(map);
            }
            Log.i(TAG, "Paused via native pausePlayer method");
        }
    }

    private void handleCertificateDialog(Dialog.QuestionDialog dialog) {
        String title = dialog.getTitle();
        String text = dialog.getText();

        Log.i(TAG, "Certificate dialog - Title: " + title + ", Text: " + text);

        // Check if it's a certificate validation dialog
        if (text != null && (text.contains("certificate") || text.contains("SSL") || text.contains("TLS")
                || text.contains("cert"))) {
            if (acceptInvalidCertificates) {
                // Auto-accept invalid certificate
                dialog.postAction(1); // Action 1 typically means "Accept"
                Log.i(TAG, "Auto-accepted certificate dialog");
            } else {
                // Reject invalid certificate (default secure behavior)
                dialog.postAction(2); // Action 2 typically means "Reject"
                Log.i(TAG, "Rejected certificate dialog (acceptInvalidCertificates=false)");
            }
        } else {
            // For non-certificate dialogs, dismiss
            dialog.dismiss();
            Log.i(TAG, "Dismissed non-certificate dialog");
        }
    }

    public void setAcceptInvalidCertificates(boolean accept) {
        this.acceptInvalidCertificates = accept;
        Log.i(TAG, "Set acceptInvalidCertificates to: " + accept);
    }

    public void setPlayInBackground(boolean playInBackground) {
        this.playInBackground = playInBackground;
        Log.i(TAG, "Set playInBackground to: " + playInBackground);
    }

    /**
     * Set the PiP mode state from JS
     * Critical for deciding whether to pause when PiP is closed (and app is in
     * background)
     */
    public void setIsInPipMode(boolean isInPipMode) {
        boolean wasInPipMode = this.isInPipMode;
        this.isInPipMode = isInPipMode;
        Log.i(TAG, "Set isInPipMode to: " + isInPipMode + " (was: " + wasInPipMode + ")");

        // CRITICAL FIX: Handle PiP Close event
        // If we transitioned from PiP -> No PiP
        // AND we are NOT supposed to play in background
        // AND the host is paused (meaning app is in background, not foreground)
        if (wasInPipMode && !isInPipMode) {
            if (!playInBackground && isHostPaused) {
                Log.i(TAG, "PiP closed while PlayInBackground is OFF and Host is Paused -> Pausing Player");
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    isPaused = true;
                    mMediaPlayer.pause();
                    setKeepScreenOn(false);
                    emitPausedEvent(Arguments.createMap());
                }
            }
        }
    }

    /**
     * Set the resize mode for video display
     * 
     * @param resizeMode The resize mode: "contain", "cover", "fill", "none",
     *                   "scale-down", "best-fit", or aliases "stretch" (fill)
     *                   and "center" (none)
     */
    public void setResizeMode(String resizeMode) {
        String previousResizeMode = this.resizeMode;
        if (resizeMode == null) {
            this.resizeMode = "contain";
        } else {
            // Validate resize mode
            switch (resizeMode) {
                case "contain":
                case "cover":
                case "fill":
                case "stretch": // Alias for fill
                case "none":
                case "scale-down":
                case "best-fit":
                    this.resizeMode = resizeMode;
                    break;
                case "bestfit":
                case "best_fit":
                    this.resizeMode = "best-fit";
                    break;
                case "center": // Compatibility alias for legacy wrapper types
                    this.resizeMode = "none";
                    break;
                default:
                    Log.w(TAG, "Invalid resizeMode: " + resizeMode + ", defaulting to 'contain'");
                    this.resizeMode = "contain";
                    break;
            }
        }

        if (!"best-fit".equals(this.resizeMode) || !"best-fit".equals(previousResizeMode)) {
            mBestFitUsingCover = null;
        }

        Log.i(TAG,
                "Set resizeMode to: " + this.resizeMode + ", playerReady=" + (mMediaPlayer != null && mVideoWidth > 0));

        // Use requestResizeMode logic
        requestResizeMode();
    }

    /**
     * Apply the current resize mode
     * This method checks for valid dimensions before applying
     */
    private void applyResizeMode() {
        if (mMediaPlayer == null) {
            Log.d(TAG, "Cannot apply resize mode: MediaPlayer is null");
            return;
        }

        // Use view dimensions instead of screen dimensions
        int viewWidth = getWidth();
        int viewHeight = getHeight();

        if (viewWidth <= 0 || viewHeight <= 0) {
            Log.d(TAG, "View dimensions not available yet, deferring resize mode application");
            return;
        }

        // Auto-aspect mode: force AR to current view and let VLC auto-fit.
        if (autoAspectRatio) {
            try {
                mMediaPlayer.setAspectRatio(viewWidth + ":" + viewHeight);
                mMediaPlayer.setScale(0);
                mLastViewWidth = viewWidth;
                mLastViewHeight = viewHeight;
                isResizeModeApplied = true;
                Log.d(TAG, "Auto aspect ratio applied: " + viewWidth + ":" + viewHeight);
            } catch (Exception e) {
                Log.e(TAG, "Error applying auto aspect ratio: " + e.getMessage());
            }
            return;
        }

        // Wait until we have valid video dimensions for non-auto modes.
        if (mVideoWidth <= 0 || mVideoHeight <= 0) {
            Log.d(TAG, "Video dimensions not available yet, deferring resize mode application");
            return;
        }

        // Store current dimensions
        mLastViewWidth = viewWidth;
        mLastViewHeight = viewHeight;

        // Now apply the resize mode with valid dimensions
        try {
            Log.i(TAG, "Calling applyResizeModeInternal, mode=" + resizeMode + " view=" + viewWidth + "x" + viewHeight);
            applyResizeModeInternal(viewWidth, viewHeight);
            isResizeModeApplied = true;
        } catch (Exception e) {
            Log.e(TAG, "Error applying resize mode: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * Internal method to apply resize mode with validated dimensions
     * 
     * @param viewWidth  The width of the view
     * @param viewHeight The height of the view
     */
    private void applyResizeModeInternal(int viewWidth, int viewHeight) {
        IVLCVout vlcOut = mMediaPlayer.getVLCVout();

        // IMPORTANT: Reset TextureView to identity transform to avoid double-scaling
        resetTextureViewTransform();

        Log.d(TAG, String.format("Applying resize mode '%s': view=%dx%d, video=%dx%d",
                resizeMode, viewWidth, viewHeight, mVideoWidth, mVideoHeight));

        // Set window size for all modes
        vlcOut.setWindowSize(viewWidth, viewHeight);

        switch (resizeMode) {
            case "cover":
                applyCoverMode();
                break;
            case "fill":
            case "stretch":
                applyFillMode(viewWidth, viewHeight);
                break;
            case "none":
                applyNoneMode();
                break;
            case "scale-down":
                applyScaleDownMode();
                break;
            case "best-fit":
                applyBestFitMode();
                break;
            case "contain":
            default:
                applyContainMode();
                break;
        }
    }

    /**
     * Reset TextureView transform to identity (no transformation)
     * This is critical to prevent double-scaling when switching modes
     */
    private void resetTextureViewTransform() {
        android.graphics.Matrix matrix = new android.graphics.Matrix();
        // Identity matrix = no transformation
        setTransform(matrix);
    }

    private int getEffectiveVideoWidth() {
        return mVideoVisibleWidth > 0 ? mVideoVisibleWidth : mVideoWidth;
    }

    private int getEffectiveVideoHeight() {
        return mVideoVisibleHeight > 0 ? mVideoVisibleHeight : mVideoHeight;
    }

    /**
     * Apply "cover" mode - fill the view while maintaining aspect ratio (may crop
     * edges)
     * Similar to CSS background-size: cover
     * 
     * In VLC: setScale(0) = auto-fit (contain), >0 = zoom factor
     * For cover, we need to zoom until the smaller dimension fills the view
     */
    /**
     * Apply "cover" mode - fill the view while maintaining aspect ratio (may crop
     * edges)
     * Correctly handles SAR (Sample Aspect Ratio)
     * Similar to CSS background-size: cover
     */
    private void applyCoverMode() {
        mMediaPlayer.setAspectRatio(null);

        int viewWidth = getWidth();
        int viewHeight = getHeight();
        int effectiveVideoWidth = getEffectiveVideoWidth();
        int effectiveVideoHeight = getEffectiveVideoHeight();

        // Calculate SAR-corrected display dimensions
        float sarFactor = (mSarNum > 0 && mSarDen > 0) ? (float) mSarNum / mSarDen : 1.0f;
        float videoDisplayWidth = effectiveVideoWidth * sarFactor;
        float videoDisplayHeight = effectiveVideoHeight; // Height is not affected by SAR

        // Calculate scale factors based on DISPLAY dimensions (not pixel dimensions)
        // This ensures SAR is properly accounted for in the zoom calculation
        float scaleX = (float) viewWidth / videoDisplayWidth;
        float scaleY = (float) viewHeight / videoDisplayHeight;

        // Cover mode: use the LARGER scale to ensure video fills the view completely
        // This will cause cropping on the dimension that doesn't match
        float coverScale = Math.max(scaleX, scaleY);

        mMediaPlayer.setScale(coverScale);
        Log.i(TAG,
                String.format("Cover mode: scale=%.3f (SAR=%.2f, videoDisplay=%.0fx%.0f, source=%dx%d, view=%dx%d)",
                        coverScale, sarFactor, videoDisplayWidth, videoDisplayHeight,
                        effectiveVideoWidth, effectiveVideoHeight, viewWidth, viewHeight));
    }

    /**
     * Apply "best-fit" mode similar to YouTube fit behavior:
     * use cover only when expected crop is tiny, otherwise keep full frame (contain).
     */
    private void applyBestFitMode() {
        mMediaPlayer.setAspectRatio(null);

        int viewWidth = getWidth();
        int viewHeight = getHeight();
        int effectiveVideoWidth = getEffectiveVideoWidth();
        int effectiveVideoHeight = getEffectiveVideoHeight();
        if (viewWidth <= 0 || viewHeight <= 0 || effectiveVideoWidth <= 0 || effectiveVideoHeight <= 0) {
            applyContainMode();
            return;
        }

        float sarFactor = (mSarNum > 0 && mSarDen > 0) ? (float) mSarNum / mSarDen : 1.0f;
        float videoDisplayWidth = effectiveVideoWidth * sarFactor;
        float videoDisplayHeight = effectiveVideoHeight;
        if (videoDisplayWidth <= 0f || videoDisplayHeight <= 0f) {
            applyContainMode();
            return;
        }

        float scaleX = (float) viewWidth / videoDisplayWidth;
        float scaleY = (float) viewHeight / videoDisplayHeight;
        float containScale = Math.min(scaleX, scaleY);
        float coverScale = Math.max(scaleX, scaleY);

        float containW = videoDisplayWidth * containScale;
        float containH = videoDisplayHeight * containScale;
        float coverW = videoDisplayWidth * coverScale;
        float coverH = videoDisplayHeight * coverScale;
        float viewArea = (float) viewWidth * (float) viewHeight;
        float containAreaRatio = viewArea > 0f ? (containW * containH) / viewArea : 1f;
        float cropRatio = (coverW > 0f && coverH > 0f)
                ? (1f - (viewArea / (coverW * coverH)))
                : 1f;
        float horizontalBarRatio = viewWidth > 0 ? Math.max(0f, (viewWidth - containW) / (float) viewWidth) : 0f;
        float verticalBarRatio = viewHeight > 0 ? Math.max(0f, (viewHeight - containH) / (float) viewHeight) : 0f;
        float maxBarRatio = Math.max(horizontalBarRatio, verticalBarRatio);

        boolean canUseCover = cropRatio >= 0f
                && cropRatio <= BEST_FIT_MAX_CROP_RATIO
                && maxBarRatio <= BEST_FIT_MAX_BAR_RATIO
                && containAreaRatio < 0.999f;

        // Hysteresis prevents mode flapping around threshold boundaries due to tiny
        // layout/frame-dimension fluctuations.
        boolean useCover;
        if (Boolean.TRUE.equals(mBestFitUsingCover)) {
            useCover = cropRatio <= BEST_FIT_EXIT_CROP_RATIO && maxBarRatio <= BEST_FIT_EXIT_BAR_RATIO;
        } else {
            useCover = canUseCover
                    && cropRatio <= BEST_FIT_ENTER_CROP_RATIO
                    && maxBarRatio <= BEST_FIT_ENTER_BAR_RATIO;
        }
        mBestFitUsingCover = useCover;

        if (useCover) {
            mMediaPlayer.setScale(coverScale);
            Log.d(TAG, String.format(
                    "Best-fit mode: using cover scale=%.3f crop=%.2f%% fill=%.2f%% bars(h=%.2f%%,v=%.2f%%)",
                    coverScale, cropRatio * 100f, containAreaRatio * 100f,
                    horizontalBarRatio * 100f, verticalBarRatio * 100f));
        } else {
            mMediaPlayer.setScale(0f);
            Log.d(TAG, String.format(
                    "Best-fit mode: using contain crop=%.2f%% fill=%.2f%% bars(h=%.2f%%,v=%.2f%%)",
                    cropRatio * 100f, containAreaRatio * 100f,
                    horizontalBarRatio * 100f, verticalBarRatio * 100f));
        }
    }

    /**
     * Apply "fill" mode - stretch to fill entire view (distorts aspect ratio)
     */
    private void applyFillMode(int viewWidth, int viewHeight) {
        // Force the video aspect ratio to match the view
        mMediaPlayer.setAspectRatio(viewWidth + ":" + viewHeight);
        mMediaPlayer.setScale(0);
        Log.d(TAG, String.format("Fill mode: forcing AR to %d:%d", viewWidth, viewHeight));
    }

    /**
     * Apply "none" mode
     */
    private void applyNoneMode() {
        int effectiveVideoWidth = getEffectiveVideoWidth();
        int effectiveVideoHeight = getEffectiveVideoHeight();
        if (mSarNum > 0 && mSarDen > 0) {
            String ar = (effectiveVideoWidth * mSarNum) + ":" + (effectiveVideoHeight * mSarDen);
            mMediaPlayer.setAspectRatio(ar);
        } else {
            mMediaPlayer.setAspectRatio(null);
        }
        mMediaPlayer.setScale(1.0f);
        Log.d(TAG, "None mode: 1:1 scale (SAR corrected)");
    }

    /**
     * Apply "contain" mode - fit entire video within view
     * Now considers SAR to avoid letterboxing issues
     */
    private void applyContainMode() {
        // Let VLC handle SAR automatically with auto-fit
        mMediaPlayer.setAspectRatio(null);
        mMediaPlayer.setScale(0); // VLC auto-fit - should respect SAR
        Log.d(TAG, "Contain mode: auto-fit (VLC handles SAR automatically)");
    }

    /**
     * Apply "scale-down" mode - like contain, but never enlarges small videos
     * Only shrinks videos that are larger than the view
     */
    private void applyScaleDownMode() {
        float sarFactor = 1.0f;
        int effectiveVideoWidth = getEffectiveVideoWidth();
        int effectiveVideoHeight = getEffectiveVideoHeight();
        if (mSarNum > 0 && mSarDen > 0) {
            String ar = (effectiveVideoWidth * mSarNum) + ":" + (effectiveVideoHeight * mSarDen);
            mMediaPlayer.setAspectRatio(ar);
            sarFactor = (float) mSarNum / mSarDen;
        } else {
            mMediaPlayer.setAspectRatio(null);
        }

        int viewWidth = getWidth();
        int viewHeight = getHeight();

        // Calculate Display Dimensions
        float displayWidth = effectiveVideoWidth * sarFactor;
        float displayHeight = effectiveVideoHeight;

        // Check if video is larger than view in any dimension
        boolean videoLargerThanView = displayWidth > viewWidth || displayHeight > viewHeight;

        if (videoLargerThanView) {
            // Video is larger - use contain behavior (shrink to fit)
            float scaleX = (float) viewWidth / displayWidth;
            float scaleY = (float) viewHeight / displayHeight;
            float containScale = Math.min(scaleX, scaleY);
            mMediaPlayer.setScale(containScale); // Instant change
            Log.d(TAG, String.format("Scale-down mode: shrinking to scale=%.3f", containScale));
        } else {
            // Video is smaller - display at original size (don't enlarge)
            mMediaPlayer.setScale(1.0f); // Instant change
            Log.d(TAG, "Scale-down mode: video smaller than view, using 1:1 scale");
        }
    }

    public void cleanUpResources() {
        clearPendingResizeRequest();

        // Shutdown executor
        if (seekExecutor != null && !seekExecutor.isShutdown()) {
            seekExecutor.shutdownNow();
            seekExecutor = null;
        }

        this.removeOnLayoutChangeListener(onLayoutChangeListener);

        // Unregister lifecycle listener
        if (themedReactContext != null) {
            themedReactContext.removeLifecycleEventListener(this);
        }
        stopPlayback();
        releaseMediaSession();

        // Release surface
        if (surfaceVideo != null) {
            surfaceVideo.release();
            surfaceVideo = null;
        }
    }

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
        Log.d(TAG, String.format("Surface texture available: %dx%d", width, height));
        surfaceVideo = new Surface(surface);
        mLastSurfaceUpdateAtMs = System.currentTimeMillis();

        if (mMediaPlayer != null && libvlc != null) {
            // Player exists (e.g. reusing after background play)
            Log.i(TAG, "Restoring surface to existing player for seamless background resume");
            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            if (!vlcOut.areViewsAttached()) {
                vlcOut.setVideoSurface(surface);
                vlcOut.attachViews(onNewVideoLayoutListener);
                vlcOut.setWindowSize(width, height);
                // Ensure resize mode is re-applied
                requestResizeMode();
            }
        } else {
            // Fresh start
            createPlayer(true, false);
        }
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        Log.d(TAG, String.format("Surface texture size changed: %dx%d", width, height));
        // Apply resize mode when surface size changes
        if (mMediaPlayer != null && (autoAspectRatio || (mVideoWidth > 0 && mVideoHeight > 0))) {
            applyResizeMode();
        }
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        Log.d(TAG, "Surface texture destroyed");
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture surface) {
        mLastSurfaceUpdateAtMs = System.currentTimeMillis();
    }

    private final Media.EventListener mMediaListener = new Media.EventListener() {
        @Override
        public void onEvent(Media.Event event) {
            switch (event.type) {
                case Media.Event.MetaChanged:
                    Log.i(tag, "Media.Event.MetaChanged: " + event.getMetaId());
                    break;
                case Media.Event.ParsedChanged:
                    Log.i(tag, "Media.Event.ParsedChanged: " + event.getMetaId());
                    break;
                case Media.Event.StateChanged:
                    Log.i(tag, "Media.Event.StateChanged: " + event.getMetaId());
                    break;
                default:
                    Log.i(tag, "Media.Event.type=" + event.type + " eventgetParsedStatus=" + event.getParsedStatus());
                    break;
            }
        }
    };

    /**
     * Update video info and emit event if changed
     * This includes duration, tracks, and video dimensions
     */
    private void updateVideoInfo() {
        if (mMediaPlayer == null) {
            return;
        }

        // Create a hash of the video info to compare for changes
        StringBuilder infoHash = new StringBuilder();

        infoHash.append("duration:").append(mMediaPlayer.getLength()).append(";");

        if (mMediaPlayer.getAudioTracksCount() > 0) {
            MediaPlayer.TrackDescription[] audioTracks = mMediaPlayer.getAudioTracks();
            infoHash.append("audioTracks:");
            for (MediaPlayer.TrackDescription track : audioTracks) {
                infoHash.append(track.id).append(":").append(track.name).append(",");
            }
            infoHash.append(";");
        }

        if (mMediaPlayer.getSpuTracksCount() > 0) {
            MediaPlayer.TrackDescription[] spuTracks = mMediaPlayer.getSpuTracks();
            infoHash.append("textTracks:");
            for (MediaPlayer.TrackDescription track : spuTracks) {
                infoHash.append(track.id).append(":").append(track.name).append(",");
            }
            infoHash.append(";");
        }

        Media.VideoTrack video = mMediaPlayer.getCurrentVideoTrack();
        if (video != null) {
            infoHash.append("videoSize:").append(video.width).append("x").append(video.height).append(";");
        }

        String currentHash = infoHash.toString();

        // Only send update if info has changed
        if (mVideoInfoHash == null || !mVideoInfoHash.equals(currentHash)) {
            WritableMap info = Arguments.createMap();

            long duration = mMediaPlayer.getLength();
            // Don't emit Load if duration is junk (VLC often reports 1 or 0 during init)
            if (duration <= 1) {
                return;
            }
            info.putDouble("duration", duration);

            if (mMediaPlayer.getAudioTracksCount() > 0) {
                MediaPlayer.TrackDescription[] audioTracks = mMediaPlayer.getAudioTracks();
                WritableArray tracks = new WritableNativeArray();
                for (MediaPlayer.TrackDescription track : audioTracks) {
                    WritableMap trackMap = Arguments.createMap();
                    trackMap.putInt("id", track.id);
                    trackMap.putString("name", track.name);
                    tracks.pushMap(trackMap);
                }
                info.putArray("audioTracks", tracks);
            }

            if (mMediaPlayer.getSpuTracksCount() > 0) {
                MediaPlayer.TrackDescription[] spuTracks = mMediaPlayer.getSpuTracks();
                WritableArray tracks = new WritableNativeArray();
                for (MediaPlayer.TrackDescription track : spuTracks) {
                    WritableMap trackMap = Arguments.createMap();
                    trackMap.putInt("id", track.id);
                    trackMap.putString("name", track.name);
                    tracks.pushMap(trackMap);
                }
                info.putArray("textTracks", tracks);
            }

            Media.VideoTrack video2 = mMediaPlayer.getCurrentVideoTrack();
            if (video2 != null) {
                WritableMap mapVideoSize = Arguments.createMap();
                mapVideoSize.putInt("width", video2.width);
                mapVideoSize.putInt("height", video2.height);
                info.putMap("videoSize", mapVideoSize);
            }

            eventEmitter.sendEvent(info, VideoEventEmitter.EVENT_ON_LOAD);
            mVideoInfoHash = currentHash;
        }
    }

    private void initMediaSession() {
        mMediaSession = new MediaSessionCompat(getContext(), TAG);
        mMediaSession.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);

        mMediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                setPausedModifier(false);
            }

            @Override
            public void onPause() {
                setPausedModifier(true);
            }

            @Override
            public void onSeekTo(long pos) {
                if (mMediaPlayer != null && mMediaPlayer.getLength() > 0) {
                    float relativePos = (float) pos / mMediaPlayer.getLength();
                    setPosition(relativePos);
                }
            }
        });

        mMediaSession.setActive(true);
        mNotificationManager = NotificationManagerCompat.from(getContext());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "Media Playback",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Media playback controls");
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            if (manager != null)
                manager.createNotificationChannel(channel);
        }
    }

    private void releaseMediaSession() {
        if (mMediaSession != null) {
            mMediaSession.setActive(false);
            mMediaSession.release();
            mMediaSession = null;
        }
        if (mNotificationManager != null) {
            mNotificationManager.cancel(NOTIFICATION_ID);
        }
    }

    private void updateMediaMetadata() {
        if (mMediaSession == null)
            return;

        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder();
        builder.putString(MediaMetadataCompat.METADATA_KEY_TITLE, mVideoTitle);
        builder.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, mVideoArtist);
        if (mMediaPlayer != null) {
            builder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, mMediaPlayer.getLength());
        }

        mMediaSession.setMetadata(builder.build());
        if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
            showNotification(PlaybackStateCompat.STATE_PLAYING);
        }
    }

    public void setVideoTitle(String title) {
        Log.d(TAG, "setVideoTitle: " + title);
        mVideoTitle = title;
        updateMediaMetadata();
    }

    public void setVideoArtist(String artist) {
        mVideoArtist = artist;
        updateMediaMetadata();
    }

    private void updatePlayPauseState(int state) {
        if (mMediaSession == null)
            return;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder();
        long position = mMediaPlayer != null ? mMediaPlayer.getTime() : 0;
        float speed = mMediaPlayer != null ? mMediaPlayer.getRate() : 1.0f;

        stateBuilder.setActions(PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SEEK_TO);

        stateBuilder.setState(state, position, speed);
        mMediaSession.setPlaybackState(stateBuilder.build());

        if (state == PlaybackStateCompat.STATE_PLAYING || state == PlaybackStateCompat.STATE_PAUSED) {
            showNotification(state);
        } else {
            mNotificationManager.cancel(NOTIFICATION_ID);
        }
    }

    private void showNotification(int state) {
        if (mMediaSession == null)
            return;

        // Permission check for Android 13+
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(),
                    Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "Notification permission not granted, skipping notification");
                return;
            }
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), NOTIFICATION_CHANNEL_ID);

        int icon;
        String playPauseAction;
        long actionCode;
        if (state == PlaybackStateCompat.STATE_PLAYING) {
            icon = android.R.drawable.ic_media_pause;
            playPauseAction = "Pause";
            actionCode = PlaybackStateCompat.ACTION_PAUSE;
        } else {
            icon = android.R.drawable.ic_media_play;
            playPauseAction = "Play";
            actionCode = PlaybackStateCompat.ACTION_PLAY;
        }

        builder.addAction(new NotificationCompat.Action(
                icon, playPauseAction,
                MediaButtonReceiver.buildMediaButtonPendingIntent(getContext(), actionCode)));

        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        PendingIntent contentIntent = PendingIntent.getActivity(getContext(), 0, intent, PendingIntent.FLAG_IMMUTABLE);

        builder.setContentTitle(mVideoTitle)
                .setContentText(mVideoArtist)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(contentIntent)
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(mMediaSession.getSessionToken())
                        .setShowActionsInCompactView(0))
                .setPriority(NotificationCompat.PRIORITY_LOW);

        mNotificationManager.notify(NOTIFICATION_ID, builder.build());
    }

    private float[] mEqualizerBands = null;

    /**
     * 设置均衡器
     *
     * @param bands Array of gain values (in dB) for each band. 10 bands supported.
     */
    public void setAudioEqualizer(ReadableArray bands) {
        if (bands == null || bands.size() == 0) {
            mEqualizerBands = null;
            if (mMediaPlayer != null) {
                mMediaPlayer.setEqualizer(null);
            }
            return;
        }

        try {
            int bandCount = bands.size();
            mEqualizerBands = new float[bandCount];
            for (int i = 0; i < bandCount; i++) {
                mEqualizerBands[i] = (float) bands.getDouble(i);
            }

            if (mMediaPlayer != null) {
                applyEqualizer();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error setting equalizer: " + e.getMessage());
        }
    }

    private void applyEqualizer() {
        if (mMediaPlayer == null || libvlc == null)
            return;

        if (mEqualizerBands != null) {
            try {
                MediaPlayer.Equalizer equalizer = MediaPlayer.Equalizer.create();
                int supportedBands = equalizer.getBandCount();

                // LibVLC usually 10 bands. Map input bands to supported bands.
                for (int i = 0; i < supportedBands && i < mEqualizerBands.length; i++) {
                    equalizer.setAmp(i, mEqualizerBands[i]);
                }
                // Boost pre-amp to default volume level (approx +10dB to +12dB is common to
                // offset EQ headroom)
                equalizer.setPreAmp(12.0f);
                mMediaPlayer.setEqualizer(equalizer);
                Log.d(TAG, "Applied equalizer with " + mEqualizerBands.length + " bands");
            } catch (Exception e) {
                Log.e(TAG, "Failed to apply equalizer: " + e.getMessage());
            }
        } else {
            mMediaPlayer.setEqualizer(null);
        }
    }

}
