package com.yuanzhou.vlc.vlcplayer;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.text.TextUtils;
import android.content.res.Configuration;
import android.graphics.SurfaceTexture;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
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
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.Dialog;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.app.Activity;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleEventObserver;
import androidx.lifecycle.LifecycleOwner;
import android.os.Build;

@SuppressLint("ViewConstructor")
class ReactVlcPlayerView extends TextureView implements
        LifecycleEventListener,
        TextureView.SurfaceTextureListener,
        AudioManager.OnAudioFocusChangeListener,
        VlcMedia3Player.Host {

    // =========================================================================
    // Constants
    // =========================================================================


    private static final String NOTIFICATION_CHANNEL_ID = "vlc_media_player_channel";

    // Seek
    private static final long SEEK_TIME_EPSILON_MS = 60L;

    // After calling play() following a seek, suppress any Paused events that
    // arrive within this window (they are VLC internal codec-flush artefacts).
    private static final long POST_SEEK_PAUSED_SUPPRESSION_MS = 250L;

    // If Buffering=100% never fires after a codec-flush seek, force play() after
    // this many milliseconds to prevent a permanent stall.
    private static final long SEEK_BUFFER_TIMEOUT_MS = 200L;

    // Buffering debounce for UI indicator
    private static final int BUFFERING_DEBOUNCE_MS = 200;

    // Resize debounce
    private static final int RESIZE_DEBOUNCE_MS = 50;

    // Best-fit thresholds (hysteresis)
    /** A real sample aspect ratio reduces to small terms; 32:27 and 64:45 are typical. */
    private static final int MAX_PLAUSIBLE_SAR_TERM = 1000;

    private static final float BEST_FIT_ENTER_CROP_RATIO = 0.06f;
    private static final float BEST_FIT_EXIT_CROP_RATIO = 0.10f;
    private static final float BEST_FIT_ENTER_BAR_RATIO = 0.05f;
    private static final float BEST_FIT_EXIT_BAR_RATIO = 0.08f;

    // =========================================================================
    // Fields — all VLC-thread-accessible fields must be volatile
    // =========================================================================

    private final VideoEventEmitter eventEmitter;
    private final ThemedReactContext themedReactContext;
    /** Owns the native LibVLC objects; this view only borrows the player. */
    private final VlcPlaybackEngine mEngine = new VlcPlaybackEngine();
    private Lifecycle mObservedLifecycle = null;
    private final AudioManager audioManager;

    // Player instances
    private MediaPlayer mMediaPlayer = null;

    // Surface
    private Surface surfaceVideo;
    private volatile boolean isSurfaceViewDestroyed = false;

    // Config / props
    private String src;
    private String _subtitleUri;
    private int _textTrack = -1;
    private int _audioTrack = -1;
    private int currentlyAppliedAudioTrack = -1;
    private ReadableMap srcMap;
    private boolean mMuted = false;
    private int preVolume = 100;
    private boolean autoAspectRatio = false;
    private boolean acceptInvalidCertificates = false;
    private boolean playInBackground = false;
    private boolean mPipEnabled = false;
    private final VlcPipController mPipController = new VlcPipController(this);
    private String resizeMode = "contain";
    private long mAudioDelay = 0;

    // Video dimensions
    private int mVideoHeight = 0;
    private int mVideoWidth = 0;
    private int mVideoVisibleHeight = 0;
    private int mVideoVisibleWidth = 0;
    private int mSarNum = 0;
    private int mSarDen = 0;
    private int mLastAppliedViewWidth = -1;
    private int mLastAppliedViewHeight = -1;
    private int mLastAppliedVideoWidth = -1;
    private int mLastAppliedVideoHeight = -1;
    private int mLastAppliedSarNum = -1;
    private int mLastAppliedSarDen = -1;
    private boolean mLastAppliedAutoAspectRatio = false;
    private String mLastAppliedResizeMode = null;
    private Boolean mBestFitUsingCover = null;

    // Playback state — volatile because VLC events arrive on VLC's internal thread
    private volatile boolean isPaused = true;
    private volatile boolean mNativeStopped = true;
    private boolean isHostStopped = false;
    private boolean wasPlayingBeforeHostStop = false;
    private boolean mPausedForHostStop = false;
    private boolean mPausedForAudioFocus = false;
    private boolean mPausedForNoisyEvent = false;
    private boolean isResizeModeApplied = false;

    // Saved position for resume after releasePlayer
    private float mSavedPosition = 0f;
    private float mForceSeekOnCreate = -1f;

    // ─── SEEK STATE ───────────────────────────────────────────────────────────

    // Bridge-level duplicate filter (only reset on full player recreation)
    private float mLastBridgeSeekValue = Float.NaN;
    private float mLastBridgePreviewSeekValue = Float.NaN;

    // Native-level duplicate filter (ms-based)
    private long mLastSeekTargetMs = -1L;
    private long mLastPreviewSeekTargetMs = -1L;

    // Pending seek play: non-null acts as a sentinel to suppress spurious
    // VLC Paused events during the codec-flush cycle.
    // The Runnable body is intentionally empty when used as a sentinel only.
    private volatile Runnable pendingSeekPlay = null;

    // True once Buffering=100% should trigger play() after a codec-flush seek
    private volatile boolean mPlayAfterBufferComplete = false;
    /** Mirrors the last buffering event, so the media session can report STATE_BUFFERING. */
    private volatile boolean mIsBuffering = false;

    // Monotonic counter; incremented on every new seek. Lets delayed callbacks
    // discard themselves if a newer seek has already taken over.
    private volatile long mSeekVersion = 0L;

    // Timestamp of the last seek-initiated play() call; used to suppress
    // any stale Paused events that arrive shortly after.
    private volatile long mLastSeekPlayTimestampMs = -1L;

    private long mPendingReviveSeekMs = -1L;

    // ─── PROGRESS POLLING ────────────────────────────────────────────────────

    private long mProgressUpdateIntervalMs = 0L;
    private final Handler mProgressUpdateHandler = new Handler(Looper.getMainLooper());
    private Runnable mProgressUpdateRunnable = null;

    // Dedicated seek handler so seeks are never delayed by a progress poll
    private final Handler mSeekHandler = new Handler(Looper.getMainLooper());

    // ─── AUDIO FOCUS ─────────────────────────────────────────────────────────

    private AudioFocusRequest mAudioFocusRequest;
    private boolean mHasAudioFocus = false;
    private boolean mResumeOnFocusGain = false;
    private int mVolumeBeforeDuck = -1;
    private BroadcastReceiver mNoisyReceiver;

    // ─── BUFFERING DEBOUNCE ──────────────────────────────────────────────────

    private final Handler bufferingHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingBufferingEvent = null;

    // ─── RESIZE DEBOUNCE ─────────────────────────────────────────────────────

    private final Handler resizeDebounceHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingResize = null;

    // ─── MISC ────────────────────────────────────────────────────────────────

    private ExecutorService seekExecutor = Executors.newSingleThreadExecutor();
    private String mVideoInfoHash = null;

    // Cached equalizer instance — reused rather than re-allocated on every call
    private MediaPlayer.Equalizer mEqualizer = null;
    private float[] mEqualizerBands = null;
    private float mLastAppliedRate = Float.NaN;
    private final Handler mRateHandler = new Handler(Looper.getMainLooper());
    private Runnable mPendingRateRunnable = null;
    private float mPendingRate = Float.NaN;
    private final Handler mAudioTrackHandler = new Handler(Looper.getMainLooper());
    private Runnable mPendingAudioTrackRunnable = null;

    // Guard against concurrent createPlayer() calls
    private volatile boolean mCreatingPlayer = false;

    // Guard against double cleanUpResources()
    private boolean mCleaned = false;

    // When non-null, createPlayer uses these instead of reading initOptions from srcMap.
    // Set temporarily by applyEnhancementWithRecreate().
    private ArrayList<String> mEffectiveInitOptionsOverride = null;

    // ─── MEDIA SESSION ───────────────────────────────────────────────────────

    private String mVideoTitle = "Video";
    private String mVideoArtist = "Glide";

    // ─── VIDEO ENHANCEMENT ──────────────────────────────────────────────────

    /**
     * Reason for a player recreate — isolates enhancement changes from other
     * recreate triggers so they cannot interfere with each other's state.
     */
    private enum RecreateReason { SOURCE_CHANGE, DECODER_CHANGE, ENHANCEMENT_CHANGE }

    private boolean  mRequestedEnhancement = false;   // What React wants
    private boolean  mAppliedEnhancement = false;      // What's actually applied
    private boolean  mEnhancementCompatiblePipeline = false;
    private long     mEnhancementGeneration = 0;       // Gates all callbacks + restore
    private boolean  mEnhancementRecreateInFlight = false;
    private Runnable mPendingEnhancementRunnable = null;
    private boolean  mEnhancementRestoreCompleted = false; // Idempotent restore guard
    private PlaybackSnapshot mPendingEnhancementSnapshot = null;
    private boolean  mPendingEnhancementTarget = false;

    private static final long ENHANCEMENT_DEBOUNCE_MS = 75L;
    private final Handler mEnhancementHandler = new Handler(Looper.getMainLooper());

    /**
     * Captured playback state before an enhancement recreate.
     * Used to restore all player state after the recreate completes.
     */
    private static class PlaybackSnapshot {
        final long    timeMs;
        final boolean userPausedIntent;     // isPaused (user intent, distinct from native isPlaying)
        final boolean nativeWasPlaying;
        final float   rate;
        final int     audioTrack;
        final int     textTrack;            // -1 = disabled
        final long    audioDelayMs;
        final String  subtitleUri;          // null if none
        final boolean externalSubAttached;  // if external subtitle slave was added
        final boolean muted;

        PlaybackSnapshot(long timeMs, boolean userPausedIntent, boolean nativeWasPlaying,
                         float rate, int audioTrack, int textTrack, long audioDelayMs,
                         String subtitleUri, boolean externalSubAttached, boolean muted) {
            this.timeMs = timeMs;
            this.userPausedIntent = userPausedIntent;
            this.nativeWasPlaying = nativeWasPlaying;
            this.rate = rate;
            this.audioTrack = audioTrack;
            this.textTrack = textTrack;
            this.audioDelayMs = audioDelayMs;
            this.subtitleUri = subtitleUri;
            this.externalSubAttached = externalSubAttached;
            this.muted = muted;
        }
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    public ReactVlcPlayerView(ThemedReactContext context) {
        super(context);
        this.eventEmitter = new VideoEventEmitter(context);
        this.themedReactContext = context;

        // FIX Q4: null-check AudioManager; crash fast rather than NPE later
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        this.audioManager = Objects.requireNonNull(am, "AudioManager must not be null");

        this.setSurfaceTextureListener(this);
        this.addOnLayoutChangeListener(onLayoutChangeListener);
        context.addLifecycleEventListener(this);
    }

    @Override
    public void setId(int id) {
        super.setId(id);
        eventEmitter.setViewId(id);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        mPipController.attach();
        observeActivityLifecycle();
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        stopObservingActivityLifecycle();
        mPipController.detach();
        cleanUpResources();
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * Activity ON_START / ON_STOP, not onResume / onPause.
     *
     * Entering PiP pauses the Activity but never stops it, so onPause cannot distinguish
     * "the user backgrounded us" from "we are becoming a PiP window". This view used to
     * guess by waiting 800 ms to see whether PiP appeared. onStop carries that
     * information directly: it fires when the app is genuinely backgrounded and does not
     * fire for PiP, which is what the platform documentation recommends for video.
     */
    private final LifecycleEventObserver mActivityLifecycleObserver = (source, event) -> {
        if (event == Lifecycle.Event.ON_START) {
            onHostStart();
        } else if (event == Lifecycle.Event.ON_STOP) {
            onHostStop();
        }
    };

    private void observeActivityLifecycle() {
        if (mObservedLifecycle != null) {
            return;
        }
        Activity activity = themedReactContext.getCurrentActivity();
        if (!(activity instanceof LifecycleOwner)) {
            VlcLog.warn("LIFECYCLE", "host Activity is not a LifecycleOwner; ON_STOP pausing unavailable");
            return;
        }
        mObservedLifecycle = ((LifecycleOwner) activity).getLifecycle();
        mObservedLifecycle.addObserver(mActivityLifecycleObserver);
    }

    private void stopObservingActivityLifecycle() {
        if (mObservedLifecycle != null) {
            mObservedLifecycle.removeObserver(mActivityLifecycleObserver);
            mObservedLifecycle = null;
        }
    }

    private void onHostStart() {
        VlcLog.trace("LIFECYCLE", "ON_START | isSurfaceViewDestroyed=" + isSurfaceViewDestroyed
                + " wasPlayingBeforeHostStop=" + wasPlayingBeforeHostStop
                + " isHostStopped=" + isHostStopped
                + " isPaused=" + isPaused);

        if (mMediaPlayer != null && (isSurfaceViewDestroyed || wasPlayingBeforeHostStop) && isHostStopped) {
            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            if (!vlcOut.areViewsAttached()) {
                vlcOut.attachViews(onNewVideoLayoutListener);
                isSurfaceViewDestroyed = false;
                VlcLog.trace("LIFECYCLE", "ON_START: re-attached VLC views");
            }
            if (wasPlayingBeforeHostStop && mPausedForHostStop && !isPaused) {
                if (requestAudioFocusInternal()) {
                    mMediaPlayer.play();
                    VlcLog.trace("LIFECYCLE", "ON_START: resumed playback");
                }
            }
        }
        mPausedForHostStop = false;
        isHostStopped = false;
    }

    private void onHostStop() {
        wasPlayingBeforeHostStop = (mMediaPlayer != null && mMediaPlayer.isPlaying()) || !isPaused;
        isHostStopped = true;

        VlcLog.trace("LIFECYCLE", "ON_STOP | wasPlaying=" + wasPlayingBeforeHostStop
                + " playInBackground=" + playInBackground);

        // Reaching ON_STOP means this is a real background transition, never PiP.
        if (!playInBackground) {
            pauseForHostBackground("onHostStop");
        }
    }

    @Override
    public void onHostResume() {
        // Activity ON_START owns resume; onResume also fires on every PiP focus change.
    }

    @Override
    public void onHostPause() {
        // Activity ON_STOP owns pausing; onPause cannot tell backgrounding from PiP.
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // PiP enter/exit is handled by VlcPipController; this only needs to refit the
        // video to whatever bounds the window now has.
        invalidateAndRefitGeometry();
    }

    @Override
    public void onHostDestroy() {
        cleanUpResources();
    }

    // =========================================================================
    // Surface callbacks
    // =========================================================================

    IVLCVout.Callback callback = new IVLCVout.Callback() {
        @Override
        public void onSurfacesCreated(IVLCVout ivlcVout) {
            isSurfaceViewDestroyed = false;
            VlcLog.trace("SURFACE", "onSurfacesCreated");
        }

        @Override
        public void onSurfacesDestroyed(IVLCVout ivlcVout) {
            isSurfaceViewDestroyed = true;
            VlcLog.trace("SURFACE", "onSurfacesDestroyed | isHostStopped=" + isHostStopped + " playInBackground="
                    + playInBackground);

            if (isHostStopped && !shouldKeepPlayingWhileHostStopped()) {
                pauseForHostBackground("onSurfacesDestroyed");
            }
        }
    };

    // =========================================================================
    // Audio Focus
    // =========================================================================

    @Override
    public void onAudioFocusChange(int focusChange) {
        VlcLog.trace("AUDIO_FOCUS", "change=" + focusChange);
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_GAIN:
                mHasAudioFocus = true;
                registerNoisyReceiver();
                if (mMediaPlayer != null) {
                    if (mVolumeBeforeDuck >= 0) {
                        mMediaPlayer.setVolume(mVolumeBeforeDuck);
                        mVolumeBeforeDuck = -1;
                    }
                    if (mResumeOnFocusGain && mPausedForAudioFocus) {
                        boolean allowResume = !isHostStopped || shouldKeepPlayingWhileHostStopped();
                        if (allowResume && !isPaused) {
                            mMediaPlayer.play();
                            setKeepScreenOn(true);
                            VlcLog.trace("AUDIO_FOCUS", "GAIN → resumed playback");
                            WritableMap map = createEventMap();
                            if (map != null)
                                emitPlayingEvent(map);
                        } else {
                            VlcLog.trace("AUDIO_FOCUS", "GAIN -> host paused, background disabled; skip resume");
                        }
                    }
                }
                mPausedForAudioFocus = false;
                mResumeOnFocusGain = false;
                break;

            case AudioManager.AUDIOFOCUS_LOSS:
                mHasAudioFocus = false;
                mResumeOnFocusGain = false;
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    mPausedForAudioFocus = true;
                    mMediaPlayer.pause();
                    setKeepScreenOn(false);
                    VlcLog.trace("AUDIO_FOCUS", "LOSS → paused");
                    WritableMap map = createEventMap();
                    if (map != null)
                        emitPausedEvent(map);
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if (mMediaPlayer != null) {
                    mResumeOnFocusGain = mMediaPlayer.isPlaying();
                    if (mMediaPlayer.isPlaying()) {
                        mPausedForAudioFocus = true;
                        mMediaPlayer.pause();
                        setKeepScreenOn(false);
                        VlcLog.trace("AUDIO_FOCUS", "LOSS_TRANSIENT → paused");
                        WritableMap map = createEventMap();
                        if (map != null)
                            emitPausedEvent(map);
                    }
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                if (mMediaPlayer != null) {
                    mVolumeBeforeDuck = preVolume;
                    mMediaPlayer.setVolume(30);
                    VlcLog.trace("AUDIO_FOCUS", "DUCK → volume set to 30%");
                }
                break;
        }
    }

    private void registerNoisyReceiver() {
        if (mNoisyReceiver != null)
            return;
        try {
            mNoisyReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                        if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                            mPausedForNoisyEvent = true;
                            mResumeOnFocusGain = false;
                            mMediaPlayer.pause();
                            setKeepScreenOn(false);
                            VlcLog.trace("NOISY", "headphones disconnected → paused");
                            WritableMap map = createEventMap();
                            if (map != null)
                                emitPausedEvent(map);
                        }
                    }
                }
            };
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            themedReactContext.registerReceiver(mNoisyReceiver, filter);
            VlcLog.trace("NOISY", "receiver registered");
        } catch (Exception e) {
            VlcLog.error("NOISY", "register error: " + e.getMessage());
        }
    }

    private void unregisterNoisyReceiver() {
        if (mNoisyReceiver != null) {
            try {
                themedReactContext.unregisterReceiver(mNoisyReceiver);
                mNoisyReceiver = null;
                VlcLog.trace("NOISY", "receiver unregistered");
            } catch (Exception e) {
                VlcLog.error("NOISY", "unregister error: " + e.getMessage());
            }
        }
    }

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
                result = audioManager.requestAudioFocus(
                        this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }

            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                mHasAudioFocus = true;
                mResumeOnFocusGain = false;
                registerNoisyReceiver();
                VlcLog.trace("AUDIO_FOCUS", "request GRANTED");
            } else if (result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED) {
                mHasAudioFocus = false;
                mResumeOnFocusGain = true;
                VlcLog.trace("AUDIO_FOCUS", "request DELAYED — will resume on gain");
                return false;
            } else {
                mHasAudioFocus = false;
                mResumeOnFocusGain = false;
                VlcLog.warn("AUDIO_FOCUS", "request FAILED result=" + result);
            }
        }

        if (mHasAudioFocus && mMediaPlayer != null && !mMuted) {
            mMediaPlayer.setVolume(preVolume);
        }
        return mHasAudioFocus;
    }

    private void abandonAudioFocusInternal() {
        unregisterNoisyReceiver();
        if (!mHasAudioFocus)
            return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mAudioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(mAudioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(this);
        }
        mHasAudioFocus = false;
        VlcLog.trace("AUDIO_FOCUS", "abandoned");
    }

    // =========================================================================
    // Progress polling
    // =========================================================================

    private void setProgressUpdateRunnable() {
        if (mMediaPlayer == null || mProgressUpdateIntervalMs <= 0)
            return;

        // Cancel any existing runnable before creating a new one
        if (mProgressUpdateRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mProgressUpdateRunnable);
            mProgressUpdateRunnable = null;
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
                if (mMediaPlayer != null && mProgressUpdateIntervalMs > 0) {
                    mProgressUpdateHandler.postDelayed(mProgressUpdateRunnable, mProgressUpdateIntervalMs);
                }
            }
        };
        mProgressUpdateHandler.postDelayed(mProgressUpdateRunnable, 0);
    }

    // =========================================================================
    // Resize helpers
    // =========================================================================

    private boolean areDimensionsStable() {
        if (mMediaPlayer == null)
            return false;
        if (getWidth() <= 0 || getHeight() <= 0 || isSurfaceViewDestroyed)
            return false;
        if (autoAspectRatio)
            return true;
        return mVideoWidth > 0 && mVideoHeight > 0;
    }

    private void clearPendingResizeRequest() {
        if (pendingResize != null) {
            resizeDebounceHandler.removeCallbacks(pendingResize);
            pendingResize = null;
        }
    }

    private void requestResizeMode() {
        if (!areDimensionsStable())
            return;
        clearPendingResizeRequest();
        if (!isResizeModeApplied) {
            applyResizeMode();
            return;
        }
        pendingResize = new Runnable() {
            @Override
            public void run() {
                if (areDimensionsStable())
                    applyResizeMode();
            }
        };
        resizeDebounceHandler.postDelayed(pendingResize, RESIZE_DEBOUNCE_MS);
    }

    // =========================================================================
    // Layout change
    // =========================================================================

    private View.OnLayoutChangeListener onLayoutChangeListener = new View.OnLayoutChangeListener() {
        @Override
        public void onLayoutChange(View view, int left, int top, int right, int bottom, int oldLeft, int oldTop,
                int oldRight, int oldBottom) {
            int width = right - left;
            int height = bottom - top;
            if (width > 0 && height > 0) {
                boolean sizeChanged = (width != (oldRight - oldLeft)) || (height != (oldBottom - oldTop));
                if (sizeChanged) {
                    VlcLog.trace("LAYOUT", "size changed → " + width + "x" + height);
                    if (mMediaPlayer != null) {
                        requestResizeMode();
                    }
                }
            }
        }
    };

    // =========================================================================
    // Event helpers
    // =========================================================================

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

    private void emitPausedEvent(WritableMap map) {
        WritableMap eventMap = map != null ? map : Arguments.createMap();
        eventMap.putString("type", "Paused");
        VlcLog.trace("EVENT", "→ Paused");
        eventEmitter.sendEvent(eventMap, VideoEventEmitter.EVENT_ON_PAUSED);
    }

    private void emitPlayingEvent(WritableMap map) {
        WritableMap eventMap = map != null ? map : Arguments.createMap();
        eventMap.putString("type", "Playing");
        if (isPaused) {
            VlcLog.trace("EVENT", "Playing suppressed — isPaused=true (user intent)");
            return;
        }
        VlcLog.trace("EVENT", "→ Playing");
        eventEmitter.sendEvent(eventMap, VideoEventEmitter.EVENT_ON_IS_PLAYING);
    }

    private String mDecoderMode = "hardware";

    private void maybeMarkEnhancementAppliedFromNormalCreate() {
        if (!mEnhancementRecreateInFlight && mAppliedEnhancement != mRequestedEnhancement) {
            mAppliedEnhancement = mRequestedEnhancement;
        }
    }

    private void maybeRestorePendingEnhancementSnapshot() {
        if (!mEnhancementRecreateInFlight || mPendingEnhancementSnapshot == null || mEnhancementRestoreCompleted) {
            return;
        }
        restorePlaybackSnapshot(mPendingEnhancementSnapshot, mEnhancementGeneration, mPendingEnhancementTarget);
    }

    private boolean shouldUseEnhancementCompatiblePipeline(boolean targetEnhancement) {
        return "hardware".equals(mDecoderMode) && (targetEnhancement || mEnhancementCompatiblePipeline);
    }

    private boolean supportsVisibleLiveEnhancement(boolean targetEnhancement) {
        if ("software".equals(mDecoderMode) || "hardware_plus".equals(mDecoderMode)) {
            return true;
        }
        return mEnhancementCompatiblePipeline;
    }

    private boolean applyVideoEnhancementLive(boolean enabled) {
        if (mMediaPlayer == null) {
            return false;
        }
        if (!supportsVisibleLiveEnhancement(enabled)) {
            return false;
        }
        if (!VlcAdjustBridge.isAvailable()) {
            return false;
        }

        try {
            long mediaPlayerHandle = mMediaPlayer.getInstance();
            if (mediaPlayerHandle == 0L) {
                return false;
            }

            boolean applied = VlcAdjustBridge.applyEnhancement(mediaPlayerHandle, enabled);
            if (applied) {
                mAppliedEnhancement = enabled;
            }
            return applied;
        } catch (Exception e) {
            VlcLog.warn("ENHANCE", "live apply failed: " + e.getMessage());
            return false;
        }
    }

    // =========================================================================
    // VLC Media Player listener
    // =========================================================================

    private MediaPlayer.EventListener mPlayerListener = new MediaPlayer.EventListener() {
        @Override
        public void onEvent(MediaPlayer.Event event) {
            // NOTE: VLC dispatches events on its own internal thread, NOT Android's
            // main thread. Fields that are read here AND written on the main thread
            // must be declared volatile. All such fields are marked volatile above.
            if (mMediaPlayer == null)
                return;

            // Auto-enter must only ever be armed while media is actually playing.
            switch (event.type) {
                case MediaPlayer.Event.Playing:
                case MediaPlayer.Event.Paused:
                case MediaPlayer.Event.Stopped:
                case MediaPlayer.Event.EndReached:
                    mPipController.setPlaying(
                            mMediaPlayer != null && mMediaPlayer.isPlaying());
                    break;
                default:
                    break;
            }

            switch (event.type) {

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Playing: {
                    mNativeStopped = false;

                    // FIX: clear seek suppression sentinel — VLC has confirmed
                    // actual playback at the new position.
                    if (pendingSeekPlay != null) {
                        pendingSeekPlay = null;
                        VlcLog.trace("VLC_EVENT", "Playing: cleared seek suppression sentinel");
                    }
                    mLastSeekPlayTimestampMs = -1L;
                    mPausedForAudioFocus = false;
                    mPausedForNoisyEvent = false;

                    VlcLog.trace("VLC_EVENT", "Playing | isPaused=" + isPaused + " pos=" + mMediaPlayer.getPosition()
                            + " time=" + mMediaPlayer.getTime() + " duration=" + mMediaPlayer.getLength());

                    // If user intent is paused, suppress this transient Playing and re-pause.
                    if (isPaused) {
                        VlcLog.warn("VLC_EVENT", "Playing suppressed (user intent=paused) → re-pausing");
                        try {
                            if (mMediaPlayer.isPlaying())
                                mMediaPlayer.pause();
                        } catch (Exception ignored) {
                        }
                        setKeepScreenOn(false);
                        notifyMediaSession();
                        break;
                    }

                    // Verify seek landed near target and log if large drift detected
                    logSeekVerification();

                    // Force subtitle state
                    if (_textTrack == -1 && mMediaPlayer.getSpuTracksCount() > 0) {
                        mMediaPlayer.setSpuTrack(-1);
                    } else if (_textTrack != -1) {
                        mMediaPlayer.setSpuTrack(_textTrack);
                    }

                    // Apply pending audio-track change after the player is in a stable playing state.
                    applyRequestedAudioTrack("playing", false);

                    // Re-apply audio delay
                    if (mAudioDelay != 0) {
                        mMediaPlayer.setAudioDelay(mAudioDelay * 1000);
                    }

                    // Fallback: get video dimensions if onNewVideoLayout hasn't fired yet
                    if (mVideoWidth <= 0 || mVideoHeight <= 0) {
                        Media.VideoTrack videoTrack = mMediaPlayer.getCurrentVideoTrack();
                        if (videoTrack != null && videoTrack.width > 0 && videoTrack.height > 0) {
                            mVideoWidth = videoTrack.width;
                            mVideoHeight = videoTrack.height;
                            // Take the sample aspect ratio too. Without it, anamorphic
                            // sources on the many files where onNewVideoLayout never
                            // fires were treated as square-pixel and rendered at the
                            // wrong shape in every mode that corrects for SAR.
                            setSampleAspectRatio(videoTrack.sarNum, videoTrack.sarDen);
                            VlcLog.trace("VLC_EVENT", "Playing: fallback dimensions=" + mVideoWidth + "x" + mVideoHeight
                                    + " SAR=" + videoTrack.sarNum + ":" + videoTrack.sarDen
                                    + " stored=" + mSarNum + ":" + mSarDen);
                            // onNewVideoLayout never fires on many files, so this is
                            // the only source of truth for the video size. Without it the
                            // PiP controller has no aspect ratio to give the window.
                            mPipController.setVideoGeometry(
                                    mVideoWidth, mVideoHeight, mSarNum, mSarDen);
                            requestResizeMode();
                        }
                    }

                    setKeepScreenOn(true);
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    maybeRestorePendingEnhancementSnapshot();
                    maybeMarkEnhancementAppliedFromNormalCreate();
                    emitPlayingEvent(map);
                    updateVideoInfo();
                    notifyMediaSession();
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Paused: {
                    mNativeStopped = false;

                    // Suppress Paused events during a codec-flush seek cycle.
                    // pendingSeekPlay (non-null sentinel) means we are between
                    // pause()+setTime() and the subsequent play() call.
                    if (pendingSeekPlay != null) {
                        VlcLog.trace("VLC_EVENT", "Paused suppressed — codec flush in progress");
                        break;
                    }

                    // FIX S1/Bug2: suppress stale Paused events that can arrive
                    // shortly after the seek-triggered play() call fires.
                    if (mLastSeekPlayTimestampMs > 0 && System.currentTimeMillis()
                            - mLastSeekPlayTimestampMs < POST_SEEK_PAUSED_SUPPRESSION_MS) {
                        VlcLog.trace("VLC_EVENT", "Paused suppressed — post-seek suppression window");
                        break;
                    }
                    mLastSeekPlayTimestampMs = -1L;

                    VlcLog.trace("VLC_EVENT", "Paused | isPaused=" + isPaused + " pos=" + mMediaPlayer.getPosition()
                            + " time=" + mMediaPlayer.getTime());

                    if (mPausedForHostStop && !isPaused) {
                        VlcLog.trace("VLC_EVENT", "Paused suppressed — host lifecycle pause");
                        // React must not see this as a user pause, but the media session
                        // reports what playback is actually doing, so it still gets told.
                        notifyMediaSession();
                        break;
                    }

                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    setKeepScreenOn(false);
                    emitPausedEvent(map);
                    notifyMediaSession();
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Buffering: {
                    final float bufferRate = event.getBuffering();
                    VlcLog.trace("VLC_EVENT", "Buffering rate=" + bufferRate + "%");

                    // FIX (primary seek freeze): trigger play() when the buffer
                    // fills after a codec-flush seek, instead of using a fixed timer.
                    mIsBuffering = bufferRate < 100f;
                    if (bufferRate >= 100f && mPlayAfterBufferComplete && !isPaused) {
                        final long capturedVersion = mSeekVersion;
                        mPlayAfterBufferComplete = false;

                        // Post to main thread so VLC's state fully settles before play()
                        mSeekHandler.post(() -> {
                            if (mMediaPlayer != null && !isPaused && mSeekVersion == capturedVersion) {
                                VlcLog.trace("SEEK", "buffer=100% -> resuming play");
                                mLastSeekPlayTimestampMs = System.currentTimeMillis();
                                requestAudioFocusInternal();
                                mMediaPlayer.play();
                                // pendingSeekPlay sentinel stays non-null until
                                // the Playing event clears it (above).
                            }
                        });
                    }

                    // Debounced UI buffering indicator
                    if (pendingBufferingEvent != null) {
                        bufferingHandler.removeCallbacks(pendingBufferingEvent);
                    }
                    pendingBufferingEvent = new Runnable() {
                        @Override
                        public void run() {
                            WritableMap bufferMap = Arguments.createMap();
                            bufferMap.putBoolean("isBuffering", bufferRate < 100f);
                            bufferMap.putDouble("bufferRate", bufferRate);
                            bufferMap.putString("type", "Buffering");
                            eventEmitter.sendEvent(bufferMap, VideoEventEmitter.EVENT_ON_VIDEO_BUFFERING);
                            pendingBufferingEvent = null;
                        }
                    };
                    bufferingHandler.postDelayed(pendingBufferingEvent, BUFFERING_DEBOUNCE_MS);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Opening: {
                    VlcLog.trace("VLC_EVENT", "Opening");
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Opening");
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_OPEN);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.EndReached: {
                    VlcLog.trace("VLC_EVENT", "EndReached | pos=" + mMediaPlayer.getPosition());
                    mNativeStopped = true;

                    // Emit final 100% progress so UI snaps to end
                    WritableMap progressMap = Arguments.createMap();
                    progressMap.putBoolean("isPlaying", false);
                    progressMap.putDouble("position", 1.0);
                    progressMap.putDouble("currentTime", mMediaPlayer.getLength());
                    progressMap.putDouble("duration", mMediaPlayer.getLength());
                    eventEmitter.sendEvent(progressMap, VideoEventEmitter.EVENT_PROGRESS);

                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Ended");
                    setKeepScreenOn(false);
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_END);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Stopped: {
                    VlcLog.trace("VLC_EVENT", "Stopped | isPaused=" + isPaused);
                    isPaused = true;
                    mNativeStopped = true;
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Stopped");
                    setKeepScreenOn(false);
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_VIDEO_STOPPED);
                    notifyMediaSession();
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.EncounteredError: {
                    VlcLog.error("VLC_EVENT", "EncounteredError");
                    mNativeStopped = true;
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Error");
                    setKeepScreenOn(false);
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_ERROR);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.TimeChanged:
                    // High-frequency — progress handled by polling loop. No-op.
                    break;

                default:
                    break;
            }
        }
    };

    // =========================================================================
    // Video layout callback
    // =========================================================================

    private IVLCVout.OnNewVideoLayoutListener onNewVideoLayoutListener = new IVLCVout.OnNewVideoLayoutListener() {
        @Override
        public void onNewVideoLayout(IVLCVout vout, int width, int height, int visibleWidth, int visibleHeight,
                int sarNum, int sarDen) {
            if (width * height == 0)
                return;

            mVideoWidth = width;
            mVideoHeight = height;
            mVideoVisibleWidth = visibleWidth;
            mVideoVisibleHeight = visibleHeight;
            setSampleAspectRatio(sarNum, sarDen);

            mPipController.setVideoGeometry(
                    mVideoVisibleWidth > 0 ? mVideoVisibleWidth : mVideoWidth,
                    mVideoVisibleHeight > 0 ? mVideoVisibleHeight : mVideoHeight,
                    mSarNum, mSarDen);

            VlcLog.trace("VIDEO_LAYOUT", width + "x" + height + " visible=" + visibleWidth + "x" + visibleHeight
                    + " SAR=" + sarNum + ":" + sarDen + " stored=" + mSarNum + ":" + mSarDen);

            requestResizeMode();

            WritableMap map = Arguments.createMap();
            map.putInt("mVideoWidth", mVideoWidth);
            map.putInt("mVideoHeight", mVideoHeight);
            map.putInt("mVideoVisibleWidth", mVideoVisibleWidth);
            map.putInt("mVideoVisibleHeight", mVideoVisibleHeight);
            map.putInt("mSarNum", mSarNum);
            map.putInt("mSarDen", mSarDen);
            map.putString("type", "onNewVideoLayout");
            updateVideoInfo();
            eventEmitter.onVideoStateChange(map);
        }
    };

    // =========================================================================
    // Seek verification (diagnostic, no correction — auto-correction loops)
    // =========================================================================

    private void logSeekVerification() {
        if (mLastSeekTargetMs < 0 || mMediaPlayer == null) {
            return;
        }
        final long targetMs = mLastSeekTargetMs;
        // Answer once per seek. Leaving the target set meant every later Playing event —
        // resuming from a pause, returning from PiP — compared the live position against
        // a seek from minutes ago and reported drift that was simply playback progressing.
        mLastSeekTargetMs = -1L;

        final long actualMs = mMediaPlayer.getTime();
        final long delta = Math.abs(actualMs - targetMs);
        final String detail = "target=" + targetMs + "ms actual=" + actualMs + "ms delta=" + delta + "ms";
        if (delta > 500) {
            VlcLog.warn("SEEK_VERIFY", "drift: " + detail);
        } else {
            VlcLog.trace("SEEK_VERIFY", detail);
        }
    }

    // =========================================================================
    // Player lifecycle
    // =========================================================================

    private void stopPlayback() {
        onStopPlayback();
        releasePlayer();
    }

    private void onStopPlayback() {
        setKeepScreenOn(false);
        abandonAudioFocusInternal();
        if (pendingBufferingEvent != null) {
            bufferingHandler.removeCallbacks(pendingBufferingEvent);
            pendingBufferingEvent = null;
        }
    }

    /**
     * Record the sample aspect ratio, defending against the values LibVLC actually hands
     * back. {@code Media.VideoTrack} has been observed reporting the frame *area* in both
     * fields — 2073600:2073600 for 1920x1080 — which is not a ratio at all. It reduces to
     * 1:1 so the arithmetic survives, but the raw numbers are meaningless and anything
     * equally implausible should not be trusted to correct a picture's shape.
     */
    private void setSampleAspectRatio(int sarNum, int sarDen) {
        if (sarNum <= 0 || sarDen <= 0) {
            mSarNum = 0;
            mSarDen = 0;
            return;
        }
        int divisor = sarNum;
        int remainder = sarDen;
        while (remainder != 0) {
            int next = divisor % remainder;
            divisor = remainder;
            remainder = next;
        }
        int num = sarNum / divisor;
        int den = sarDen / divisor;

        // A real sample aspect ratio is a small rational: 1:1, 32:27, 64:45, 8:9.
        // Anything that stays large after reduction is not one.
        if (num > MAX_PLAUSIBLE_SAR_TERM || den > MAX_PLAUSIBLE_SAR_TERM) {
            VlcLog.warn("VIDEO_INFO", "implausible SAR " + sarNum + ":" + sarDen
                    + " reduced to " + num + ":" + den + " — assuming square pixels");
            mSarNum = 1;
            mSarDen = 1;
            return;
        }
        mSarNum = num;
        mSarDen = den;
    }

    private static List<String> toStringList(ReadableArray array) {
        final List<String> out = new ArrayList<>(array.size());
        for (Object option : array.toArrayList()) {
            out.add(String.valueOf(option));
        }
        return out;
    }

    private void createPlayer(boolean autoplayResume, boolean isResume) {
        if (mCreatingPlayer) {
            VlcLog.warn("CREATE_PLAYER", "already in progress, ignoring concurrent call");
            return;
        }
        mCreatingPlayer = true;

        try {
            cancelPendingSeek();
            mPendingReviveSeekMs = -1L;

            releasePlayer();
            // ↑ releasePlayer() runs here. If mNativeStopped is still true (set by
            // EndReached and NOT cleared by setPausedModifier), the guard inside
            // releasePlayer() will see mNativeStopped=true and skip saving the EOF
            // position. This is the correct behaviour for replay-from-start.

            // If setPosition() Case 1 triggered this to restart a stopped VLC,
            // mForceSeekOnCreate holds the desired target fraction.
            if (mForceSeekOnCreate >= 0f) {
                mSavedPosition = mForceSeekOnCreate;
                mForceSeekOnCreate = -1f;
                VlcLog.trace("CREATE_PLAYER", "override savedPos=" + mSavedPosition
                        + " from stopped revive");
            }

            if (this.getSurfaceTexture() == null) {
                VlcLog.warn("CREATE_PLAYER", "no surface texture yet, aborting");
                return;
            }
            if (srcMap == null) {
                VlcLog.warn("CREATE_PLAYER", "srcMap is null, aborting");
                return;
            }

            final ArrayList<String> cOptions = new ArrayList<>();
            String uriString = srcMap.hasKey("uri") ? srcMap.getString("uri") : null;
            if (TextUtils.isEmpty(uriString)) {
                VlcLog.warn("CREATE_PLAYER", "URI is empty, aborting");
                return;
            }
            if (srcMap.hasKey("decoderMode") && !srcMap.isNull("decoderMode")) {
                mDecoderMode = srcMap.getString("decoderMode");
            }

            boolean isNetwork = srcMap.hasKey("isNetwork") && srcMap.getBoolean("isNetwork");
            boolean autoplay = !srcMap.hasKey("autoplay") || srcMap.getBoolean("autoplay");
            int initType = srcMap.hasKey("initType") ? srcMap.getInt("initType") : 1;
            ReadableArray mediaOptions = srcMap.hasKey("mediaOptions") ? srcMap.getArray("mediaOptions") : null;
            int hwDecoderEnabled = srcMap.hasKey("hwDecoderEnabled") ? srcMap.getInt("hwDecoderEnabled") : 1;
            int hwDecoderForced = srcMap.hasKey("hwDecoderForced") ? srcMap.getInt("hwDecoderForced") : 0;

            VlcLog.trace("CREATE_PLAYER", "uri=" + uriString
                    + " autoplay=" + autoplay + " isNetwork=" + isNetwork
                    + " initType=" + initType + " hw=" + hwDecoderEnabled + "/" + hwDecoderForced
                    + " savedPos=" + mSavedPosition);

            // Enhancement is always composed natively. Explicit overrides are only
            // used for a specific in-flight enhancement recreate target.
            if (mEffectiveInitOptionsOverride != null) {
                cOptions.addAll(mEffectiveInitOptionsOverride);
                VlcLog.trace("CREATE_PLAYER", "using enhancement init options override (" + cOptions.size() + " options)");
            } else {
                cOptions.addAll(buildEffectiveInitOptions(mRequestedEnhancement));
            }
            mEnhancementCompatiblePipeline = shouldUseEnhancementCompatiblePipeline(mRequestedEnhancement);

            VlcPlaybackEngine.Source engineSource = new VlcPlaybackEngine.Source(
                    uriString, isNetwork, initType, cOptions,
                    mediaOptions != null ? toStringList(mediaOptions) : null,
                    hwDecoderEnabled >= 1, hwDecoderForced >= 1, mAudioDelay);

            mMediaPlayer = mEngine.open(getContext(), engineSource, mPlayerListener, mMediaListener,
                    new Dialog.Callbacks() {
                @Override
                public void onDisplay(Dialog.QuestionDialog dialog) {
                    handleCertificateDialog(dialog);
                }

                @Override
                public void onDisplay(Dialog.ErrorMessage dialog) {
                }

                @Override
                public void onDisplay(Dialog.LoginDialog dialog) {
                }

                @Override
                public void onDisplay(Dialog.ProgressDialog dialog) {
                }

                @Override
                public void onCanceled(Dialog dialog) {
                }

                @Override
                public void onProgressUpdate(Dialog.ProgressDialog d) {
                }
            });

            if (mMediaPlayer == null) {
                VlcLog.error("CREATE_PLAYER", "engine could not open " + uriString);
                return;
            }
            setMutedModifier(mMuted);

            // The session describes a live player, so publish only once one exists.
            VlcPlaybackHost.start(getContext(), this);

            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            int viewWidth = getWidth();
            int viewHeight = getHeight();
            if (viewWidth > 0 && viewHeight > 0) {
                vlcOut.setWindowSize(viewWidth, viewHeight);
                if (autoAspectRatio)
                    mMediaPlayer.setAspectRatio(viewWidth + ":" + viewHeight);
            }

            // Reset per-media state.
            // NOTE: mNativeStopped is reset HERE (after releasePlayer) so that
            // releasePlayer's guard (!mNativeStopped) correctly blocked saving the
            // EOF position. Do NOT reset it earlier in setPausedModifier.
            mNativeStopped = false;

            mVideoInfoHash = null;
            isResizeModeApplied = false;
            currentlyAppliedAudioTrack = -1;
            // NOTE: mLastBridgeSeekValue and mLastSeekTargetMs are intentionally
            // NOT reset here — managed by callers to prevent stale React prop re-sends.

            mMediaPlayer.setScale(0);

            applyVideoEnhancementLive(mRequestedEnhancement);

            if (_subtitleUri != null) {
                mMediaPlayer.addSlave(Media.Slave.Type.Subtitle, _subtitleUri, true);
            }

            applyEqualizer();

            if (mAudioDelay != 0) {
                mMediaPlayer.setAudioDelay(mAudioDelay * 1000);
            }

            if (!vlcOut.areViewsAttached()) {
                vlcOut.addCallback(callback);
                vlcOut.setVideoSurface(this.getSurfaceTexture());
                vlcOut.attachViews(onNewVideoLayoutListener);
            }

            boolean shouldPlay = isResume ? autoplayResume : autoplay;

            if (mSavedPosition > 0f) {
                final float positionToRestore = mSavedPosition;
                mSavedPosition = 0f;
                VlcLog.trace("CREATE_PLAYER", "restoring saved position=" + positionToRestore);

                if (shouldPlay) {
                    isPaused = false;
                    if (requestAudioFocusInternal())
                        mMediaPlayer.play();
                }

                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (mMediaPlayer != null) {
                        long lengthMs = mMediaPlayer.getLength();
                        long targetMs = lengthMs > 0 ? (long) (positionToRestore * lengthMs) : -1L;
                        VlcLog.trace("SEEK", "restoring position=" + positionToRestore
                                + " targetMs=" + targetMs + " lengthMs=" + lengthMs);
                        if (targetMs >= 0) {
                            mMediaPlayer.setTime(targetMs);
                        } else {
                            mMediaPlayer.setPosition(positionToRestore);
                        }
                    }
                }, 200);
            } else {
                if (shouldPlay) {
                    isPaused = false;
                    if (requestAudioFocusInternal())
                        mMediaPlayer.play();
                }
            }

            eventEmitter.loadStart();
            setProgressUpdateRunnable();

        } catch (Exception e) {
            VlcLog.error("CREATE_PLAYER", "Error: " + e.getMessage(), e);
        } finally {
            mCreatingPlayer = false;
        }
    }

    private void releasePlayer() {
        clearPendingResizeRequest();
        cancelPendingSeek();

        if (pendingBufferingEvent != null) {
            bufferingHandler.removeCallbacks(pendingBufferingEvent);
            pendingBufferingEvent = null;
        }
        if (mProgressUpdateRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mProgressUpdateRunnable);
            mProgressUpdateRunnable = null;
        }

        if (mMediaPlayer != null) {
            try {
                float currentPos = mMediaPlayer.getPosition();
                // Do NOT save position if:
                // 1. At/near start (< 1%)
                // 2. At/near end (>= 95%) — covers EOF positions like 0.94, 0.96, 0.99
                // 3. Native player already stopped due to EndReached (mNativeStopped)
                // 4. mSavedPosition was explicitly zeroed by caller (already 0f from
                // setPausedModifier)
                if (currentPos > 0.01f && currentPos < 0.95f && !mNativeStopped) {
                    mSavedPosition = currentPos;
                    VlcLog.trace("RELEASE", "saved position=" + mSavedPosition);
                } else {
                    // Respect caller's explicit zero — don't overwrite with EOF position
                    VlcLog.trace("RELEASE", "NOT saving position=" + currentPos
                            + " mNativeStopped=" + mNativeStopped
                            + " (keeping mSavedPosition=" + mSavedPosition + ")");
                }
            } catch (Exception e) {
                mSavedPosition = 0f;
            }

            // Detach this view's output before the engine releases the player; the
            // engine has no idea which views are attached.
            final IVLCVout vout = mMediaPlayer.getVLCVout();
            vout.removeCallback(callback);
            vout.detachViews();
            mMediaPlayer = null;
        }

        mEngine.close();

        // Reset per-player state (but NOT mLastBridgeSeekValue / mLastSeekTargetMs —
        // those are managed by callers to prevent React stale-prop re-sends).
        isResizeModeApplied = false;
        mVideoWidth = 0;
        mVideoHeight = 0;
        mVideoVisibleWidth = 0;
        mVideoVisibleHeight = 0;
        mSarNum = 0;
        mSarDen = 0;
        mLastAppliedViewWidth = -1;
        mLastAppliedViewHeight = -1;
        mLastAppliedVideoWidth = -1;
        mLastAppliedVideoHeight = -1;
        mLastAppliedSarNum = -1;
        mLastAppliedSarDen = -1;
        mLastAppliedAutoAspectRatio = false;
        mLastAppliedResizeMode = null;
        currentlyAppliedAudioTrack = -1;
        mBestFitUsingCover = null;
        mPlayAfterBufferComplete = false;
        mLastSeekPlayTimestampMs = -1L;
        mLastAppliedRate = Float.NaN;
        if (mPendingAudioTrackRunnable != null) {
            mAudioTrackHandler.removeCallbacks(mPendingAudioTrackRunnable);
            mPendingAudioTrackRunnable = null;
        }
        if (mPendingRateRunnable != null) {
            mRateHandler.removeCallbacks(mPendingRateRunnable);
            mPendingRateRunnable = null;
        }
        mPendingRate = Float.NaN;
        mLastPreviewSeekTargetMs = -1L;
        mLastBridgePreviewSeekValue = Float.NaN;
        // mEqualizer intentionally not nulled — it can be reused by the next player.
    }

    // ─── Cancel pending seek operations ───────────────────────────────────────

    private void cancelPendingSeek() {
        if (pendingSeekPlay != null) {
            mSeekHandler.removeCallbacks(pendingSeekPlay);
            pendingSeekPlay = null;
        }
        mPlayAfterBufferComplete = false;
        // Increment version so any in-flight Buffering=100% callback self-discards
        mSeekVersion++;
    }

    // =========================================================================
    // SEEK
    // =========================================================================

    /**
     * Bridge-level duplicate filter.
     * Returns true if this seek value should be skipped (identical or invalid).
     */
    public boolean shouldSkipSeek(float seek) {
        if (seek < 0) {
            return true;
        }
        if (seek == mLastBridgeSeekValue) {
            return true;
        }
        mLastBridgeSeekValue = seek;
        return false;
    }

    public boolean shouldSkipPreviewSeek(float seek) {
        if (seek < 0) {
            return true;
        }
        if (seek == mLastBridgePreviewSeekValue) {
            return true;
        }
        mLastBridgePreviewSeekValue = seek;
        return false;
    }

    /**
     * Seek to a fractional position in [0, 1].
     *
     * Strategy:
     *
     * Case 1 — Native player is stopped/ended (mNativeStopped=true):
     * VLC is in a terminal Stopped state; setTime() is a no-op. The only way
     * to seek is to fully restart the player via createPlayer(). We store the
     * target in mForceSeekOnCreate so createPlayer() applies it post-release.
     *
     * Case 2 — Normal seek:
     * a) Pause VLC to interrupt any in-progress MediaCodec drain (codec flush).
     * b) Call setTime(). VLC reseeks the demuxer.
     * c) Set mPlayAfterBufferComplete=true. The Buffering=100% event handler
     * calls play() once VLC has finished buffering the new target position.
     * d) Safety timer (SEEK_BUFFER_TIMEOUT_MS) forces play() if buffering never
     * completes (e.g., the target was already in the decoded frame cache).
     * e) pendingSeekPlay acts as a NON-NULL SENTINEL that suppresses spurious
     * VLC Paused events during the entire flush/buffer cycle.
     */
    public void setPosition(final float position) {
        if (mMediaPlayer == null) {
            VlcLog.warn("SEEK", "setPosition(" + position + ") — player is null, ignoring");
            return;
        }
        if (position < 0 || position > 1) {
            VlcLog.warn("SEEK", "setPosition(" + position + ") — out of range, ignoring");
            return;
        }

        mSeekHandler.post(() -> {
            if (mMediaPlayer == null) {
                VlcLog.warn("SEEK", "player gone before seek executed");
                return;
            }

            final long lengthMs = mMediaPlayer.getLength();
            final long targetMs = lengthMs > 0 ? (long) (position * lengthMs) : -1L;
            final boolean nativePlaying = mMediaPlayer.isPlaying();
            final long currentMsBeforeSeek = mMediaPlayer.getTime();

            // ── Duplicate check ───────────────────────────────────────────────
            if (targetMs >= 0) {
                if (mLastSeekTargetMs >= 0
                        && Math.abs(targetMs - mLastSeekTargetMs) < SEEK_TIME_EPSILON_MS) {
                    VlcLog.trace("SEEK", "duplicate (delta < " + SEEK_TIME_EPSILON_MS + "ms), skipping"
                            + " targetMs=" + targetMs + " lastMs=" + mLastSeekTargetMs);
                    return;
                }
                mLastSeekTargetMs = targetMs;
            }

            if (targetMs >= 0 && !mNativeStopped
                    && Math.abs(currentMsBeforeSeek - targetMs) < SEEK_TIME_EPSILON_MS) {
                emitSeekEvent();
                return;
            }

            cancelPendingSeek();
            final long thisSeekVersion = ++mSeekVersion;

            VlcLog.trace("SEEK", "► position=" + position
                    + " targetMs=" + targetMs
                    + " lengthMs=" + lengthMs
                    + " nativePlaying=" + nativePlaying
                    + " isPaused=" + isPaused
                    + " mNativeStopped=" + mNativeStopped);

            // ── Case 1: Native player stopped/ended ───────────────────────────
            if (mNativeStopped) {
                VlcLog.trace("SEEK", "native stopped — restarting via createPlayer."
                        + " position=" + position + " isPaused=" + isPaused);
                isPaused = false;
                mForceSeekOnCreate = position;
                mSavedPosition = 0f;
                createPlayer(true, true);
                mLastBridgeSeekValue = position;
                mLastSeekTargetMs = targetMs;
                VlcLog.trace("SEEK", "createPlayer dispatched with forceSeek=" + position);
                emitSeekEvent();
                return;
            }

            // ── Case 2: Normal seek — buffer-completion approach ───────────────
            //
            final boolean needsCodecFlush = nativePlaying && !isPaused;

            // ── ROOT FIX: set mPlayAfterBufferComplete BEFORE pause()+setTime() ──
            // On local files with a warm cache, VLC fires Buffering=100% synchronously
            // inside setTime(). If we set the flag AFTER setTime() (old code), the
            // Buffering=100% handler sees false and skips, forcing the 350ms safety
            // timeout to rescue playback. Setting the flag first ensures the handler
            // can act immediately, eliminating the artificial seek latency.
            if (!isPaused) {
                mPlayAfterBufferComplete = true;
            }

            // Set pendingSeekPlay sentinel BEFORE pause() so the Paused event that
            // pause() immediately fires is suppressed. The sentinel body is empty —
            // play() is triggered by the Buffering=100% handler (or the safety timer).
            pendingSeekPlay = () -> {
                /* sentinel — play() triggered by Buffering=100% or timeout */ };

            if (needsCodecFlush) {
                VlcLog.trace("SEEK", "playing seek -> pausing to flush codec drain");
                mMediaPlayer.pause();
            }

            if (targetMs >= 0) {
                VlcLog.trace("SEEK", "setTime(" + targetMs + "ms)");
                mMediaPlayer.setTime(targetMs);
            } else {
                VlcLog.trace("SEEK", "setPosition(" + position + ") [no duration]");
                mMediaPlayer.setPosition(position);
            }

            VlcLog.trace("SEEK", "seek dispatched | isPaused=" + isPaused
                    + " codecFlush=" + needsCodecFlush);

            if (!isPaused) {
                // Safety fallback: if Buffering=100% never fires (e.g. network hiccup,
                // decoder quirk), force play() after timeout to prevent a permanent stall.
                mSeekHandler.postDelayed(() -> {
                    if (mSeekVersion == thisSeekVersion && mPlayAfterBufferComplete
                            && mMediaPlayer != null && !isPaused) {
                        VlcLog.warn("SEEK", "buffer timeout (" + SEEK_BUFFER_TIMEOUT_MS
                                + "ms) -> forcing play()");
                        mPlayAfterBufferComplete = false;
                        mLastSeekPlayTimestampMs = System.currentTimeMillis();
                        requestAudioFocusInternal();
                        mMediaPlayer.play();
                        // pendingSeekPlay sentinel remains; cleared by Playing event.
                    }
                }, SEEK_BUFFER_TIMEOUT_MS);
            }

            emitSeekEvent();
        });
    }

    private void emitSeekEvent() {
        WritableMap seekMap = createEventMap();
        if (seekMap != null) {
            seekMap.putString("type", "TimeChanged");
            eventEmitter.sendEvent(seekMap, VideoEventEmitter.EVENT_SEEK);
        }
    }

    // =========================================================================
    // Public player controls
    // =========================================================================

    public void setSubtitleUri(String subtitleUri) {
        _subtitleUri = subtitleUri;
        if (mMediaPlayer != null) {
            mMediaPlayer.addSlave(Media.Slave.Type.Subtitle, _subtitleUri, true);
        }
    }

    public void setSrc(String uri, boolean isNetStr, boolean autoplay) {
        // Cancel any pending enhancement work for the old source
        cancelPendingEnhancement();
        mAppliedEnhancement = false;
        mEnhancementCompatiblePipeline = false;

        this.src = uri;
        releasePlayer();
        mSavedPosition = 0f;
        createPlayer(autoplay, false);
    }

    public void setSrc(ReadableMap src) {
        if (src == null)
            return;
        String newUri = src.hasKey("uri") ? src.getString("uri") : null;

        if (newUri != null && this.src != null && newUri.equals(this.src) && mMediaPlayer != null) {
            VlcLog.trace("SET_SRC", "URI unchanged, skipping recreation: " + newUri);
            this.srcMap = src;
            return;
        }

        // Cancel any pending enhancement work for the old source
        cancelPendingEnhancement();
        mAppliedEnhancement = false;
        mEnhancementCompatiblePipeline = false;

        VlcLog.trace("SET_SRC", "new URI: " + newUri);
        this.src = newUri;
        this.srcMap = src;
        releasePlayer();
        mSavedPosition = 0f;
        createPlayer(true, false);
    }

    public void setRateModifier(float rateModifier) {
        if (mMediaPlayer != null) {
            if (!Float.isNaN(mLastAppliedRate) && Math.abs(mLastAppliedRate - rateModifier) < 0.01f) {
                return;
            }
            mPendingRate = rateModifier;
            if (mPendingRateRunnable != null) {
                mRateHandler.removeCallbacks(mPendingRateRunnable);
            }
            mPendingRateRunnable = () -> {
                if (mMediaPlayer == null || Float.isNaN(mPendingRate)) {
                    return;
                }
                float rateToApply = mPendingRate;
                if (!Float.isNaN(mLastAppliedRate) && Math.abs(mLastAppliedRate - rateToApply) < 0.01f) {
                    mPendingRateRunnable = null;
                    return;
                }
                mMediaPlayer.setRate(rateToApply);
                mLastAppliedRate = rateToApply;
                notifyMediaSession();
                mPendingRateRunnable = null;
            };
            mRateHandler.post(mPendingRateRunnable);
        }
    }

    /**
     * Preview seek used while scrubbing.
     *
     * Unlike committed seek, this does not pause for codec flush and does not
     * wait for buffering/playback resumption. It aims for responsive visual
     * updates during drag, even if exact frame accuracy is lower.
     */
    public void setPreviewPosition(final float position) {
        if (mMediaPlayer == null) {
            return;
        }
        if (position < 0 || position > 1) {
            return;
        }

        mSeekHandler.post(() -> {
            if (mMediaPlayer == null || mNativeStopped) {
                return;
            }

            final long lengthMs = mMediaPlayer.getLength();
            final long targetMs = lengthMs > 0 ? (long) (position * lengthMs) : -1L;

            if (targetMs >= 0) {
                if (mLastPreviewSeekTargetMs >= 0
                        && Math.abs(targetMs - mLastPreviewSeekTargetMs) < SEEK_TIME_EPSILON_MS) {
                    return;
                }
                mLastPreviewSeekTargetMs = targetMs;
            }

            cancelPendingSeek();

            if (targetMs >= 0) {
                mMediaPlayer.setTime(targetMs);
            } else {
                mMediaPlayer.setPosition(position);
            }
        });
    }

    /**
     * Set the progress update interval in milliseconds.
     * Pass 0 to disable polling.
     */
    public void setmProgressUpdateInterval(long intervalMs) {
        // FIX Q6: field type is now long to match Handler.postDelayed()
        mProgressUpdateIntervalMs = intervalMs;
        if (mProgressUpdateRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mProgressUpdateRunnable);
            mProgressUpdateRunnable = null;
        }
        if (mMediaPlayer != null && mProgressUpdateIntervalMs > 0) {
            setProgressUpdateRunnable();
        }
    }

    public void setAudioDelay(long delayMs) {
        mAudioDelay = delayMs;
        VlcLog.trace("AUDIO_DELAY", "set=" + delayMs + "ms");
        if (mMediaPlayer != null) {
            final long delayUs = mAudioDelay * 1000;
            boolean ok = mMediaPlayer.setAudioDelay(delayUs);
            VlcLog.trace("AUDIO_DELAY", "applied " + delayMs + "ms (" + delayUs + "μs) ok=" + ok);

            if (mMediaPlayer.isPlaying()) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (mMediaPlayer != null) {
                        boolean retryOk = mMediaPlayer.setAudioDelay(delayUs);
                        VlcLog.trace("AUDIO_DELAY", "retry ok=" + retryOk);
                    }
                }, 150);
            }
        } else {
            VlcLog.warn("AUDIO_DELAY", "player null — will apply on createPlayer");
        }
    }

    public void setVolumeModifier(int volumeModifier) {
        int clamped = Math.max(0, Math.min(200, volumeModifier));
        this.preVolume = clamped;
        // VlcLog.trace("VOLUME", "set=" + clamped);
        if (mMediaPlayer != null)
            mMediaPlayer.setVolume(clamped);
    }

    public void setMutedModifier(boolean muted) {
        mMuted = muted;
        VlcLog.trace("MUTE", "muted=" + muted);
        if (mMediaPlayer != null) {
            mMediaPlayer.setVolume(muted ? 0 : preVolume);
        }
    }

    /**
     * Toggle play/pause state.
     *
     * paused=true → mMediaPlayer.pause()
     * paused=false + mNativeStopped → createPlayer to restart from beginning
     * paused=false + player exists → mMediaPlayer.play()
     * paused=false + no player → createPlayer
     */
    public void setPausedModifier(boolean paused) {
        VlcLog.trace("PAUSE_MOD", "paused=" + paused
                + " | current isPaused=" + isPaused
                + " nativePlaying=" + (mMediaPlayer != null && mMediaPlayer.isPlaying())
                + " mNativeStopped=" + mNativeStopped);

        isPaused = paused;
        if (paused) {
            mPausedForHostStop = false;
            mPausedForAudioFocus = false;
            mPausedForNoisyEvent = false;
        }

        if (mMediaPlayer == null) {
            VlcLog.trace("PAUSE_MOD", "no player → createPlayer(autoplay=" + !paused + ")");
            createPlayer(!paused, false);
            return;
        }

        if (paused) {
            mMediaPlayer.pause();
            VlcLog.trace("PAUSE_MOD", "pause() called");
        } else {
            if (mNativeStopped) {
                VlcLog.trace("PAUSE_MOD", "mNativeStopped=true → createPlayer(restart from 0)");
                isPaused = false;
                // Clear stale force-seek target so createPlayer doesn't restore it.
                mForceSeekOnCreate = -1f;
                // ── KEY: do NOT clear mNativeStopped here ────────────────────────────
                // releasePlayer() (called inside createPlayer) uses !mNativeStopped to
                // decide whether to save position. If we clear it now, releasePlayer
                // sees mNativeStopped=false and saves the EOF position (~0.93-0.99),
                // then createPlayer restores it, immediately triggering EndReached again.
                // createPlayer() resets mNativeStopped=false itself after releasePlayer.
                float savedBridgeSeek = mLastBridgeSeekValue;
                long savedSeekTargetMs = mLastSeekTargetMs;
                createPlayer(true, false);
                mLastBridgeSeekValue = savedBridgeSeek;
                mLastSeekTargetMs = savedSeekTargetMs;
            } else {
                requestAudioFocusInternal();
                if (!mMediaPlayer.isPlaying()) {
                    mMediaPlayer.play();
                    VlcLog.trace("PAUSE_MOD", "play() called");
                } else {
                    VlcLog.trace("PAUSE_MOD", "play() skipped — already playing (redundant call)");
                }
            }
        }
    }

    public void doResume(boolean autoplay) {
        VlcLog.trace("RESUME", "doResume autoplay=" + autoplay);
        createPlayer(autoplay, true);
    }

    /**
     * Repeat is implemented via the :input-repeat=65535 media option, which is
     * added to mediaOptions in JS before createPlayer() is called. This Java
     * method is intentionally a no-op; repeat cannot be toggled mid-playback
     * without recreating the player.
     */
    public void setRepeatModifier(boolean repeat) {
        VlcLog.trace("REPEAT", "repeat=" + repeat + " (applied via mediaOptions at createPlayer time)");
    }

    public void setAspectRatio(String aspectRatio) {
        if (!autoAspectRatio && mMediaPlayer != null) {
            mMediaPlayer.setAspectRatio(aspectRatio);
        }
    }

    public void setAutoAspectRatio(boolean auto) {
        if (autoAspectRatio == auto)
            return;
        autoAspectRatio = auto;
        requestResizeMode();
    }

    public void setAudioTrack(int track) {
        VlcLog.trace("AUDIO_TRACK", "set=" + track);
        _audioTrack = track;
        scheduleAudioTrackApply(true);
    }

    public void setTextTrack(int track) {
        VlcLog.trace("TEXT_TRACK", "set=" + track);
        _textTrack = track;
        if (mMediaPlayer != null)
            mMediaPlayer.setSpuTrack(track);
    }

    public void stopPlayer() {
        if (mMediaPlayer == null)
            return;
        VlcLog.trace("STOP", "stopPlayer()");
        abandonAudioFocusInternal();
        mNativeStopped = true;
        mMediaPlayer.stop();
    }

    public void pausePlayer() {
        if (mMediaPlayer == null)
            return;
        if (!isPaused) {
            isPaused = true;
            mMediaPlayer.pause();
            setKeepScreenOn(false);
            VlcLog.trace("STOP", "pausePlayer()");
            WritableMap map = createEventMap();
            if (map != null)
                emitPausedEvent(map);
        }
    }

    // ─── Certificate dialog ───────────────────────────────────────────────────

    /**
     * FIX S5: Apply the configured certificate policy regardless of dialog text.
     * VLC dialogs are localized; the old text-match approach fails on non-English
     * devices. Use the configuration flag as the sole decision criterion.
     */
    private void handleCertificateDialog(Dialog.QuestionDialog dialog) {
        if (acceptInvalidCertificates) {
            dialog.postAction(1); // Accept / "Yes"
            VlcLog.trace("CERT", "auto-accepted (acceptInvalidCertificates=true)");
        } else {
            dialog.postAction(2); // Reject / "No"
            VlcLog.trace("CERT", "rejected (acceptInvalidCertificates=false)");
        }
    }

    public void setAcceptInvalidCertificates(boolean accept) {
        this.acceptInvalidCertificates = accept;
        VlcLog.trace("CONFIG", "acceptInvalidCertificates=" + accept);
    }

    public void setPlayInBackground(boolean playInBackground) {
        this.playInBackground = playInBackground;
        VlcLog.trace("CONFIG", "playInBackground=" + playInBackground);
    }

    /**
     * JS states only that PiP is currently allowed (player focused, nothing modal on
     * top). Geometry, source rect and auto-enter arming are decided natively, where
     * the video dimensions and view bounds actually live.
     */
    public void setPipEnabled(boolean pipEnabled) {
        this.mPipEnabled = pipEnabled;
        mPipController.setEnabled(pipEnabled);
        VlcLog.trace("PIP", "enabled=" + pipEnabled);
    }

    public void enterPictureInPicture() {
        mPipController.enter();
    }

    /** Single source of truth: the hosting Activity. */
    private boolean isInPipMode() {
        return mPipController.isInPipMode();
    }

    /** Called by {@link VlcPipController} once the Activity has changed PiP state. */
    void onPipModeChangedInternal(boolean inPipMode) {
        if (!inPipMode && isHostStopped && !playInBackground) {
            VlcLog.trace("PIP", "PiP closed while host paused → pausing");
            pauseForHostBackground("pipExit");
        }

        // The window changed size; recompute geometry once against the new bounds.
        invalidateAndRefitGeometry();
    }

    android.app.Activity getReactActivity() {
        try {
            return themedReactContext.getCurrentActivity();
        } catch (Exception e) {
            return null;
        }
    }


    public void setResizeMode(String mode) {
        String prev = this.resizeMode;
        if (mode == null) {
            this.resizeMode = "contain";
        } else {
            switch (mode) {
                case "contain":
                case "cover":
                case "fill":
                case "stretch":
                case "none":
                case "scale-down":
                case "best-fit":
                    this.resizeMode = mode;
                    break;
                case "bestfit":
                case "best_fit":
                    this.resizeMode = "best-fit";
                    break;
                case "center":
                    this.resizeMode = "none";
                    break;
                default:
                    VlcLog.warn("RESIZE", "invalid mode: " + mode + " → contain");
                    this.resizeMode = "contain";
                    break;
            }
        }

        // FIX Q2: reset best-fit state ONLY when transitioning AWAY from best-fit.
        // Old code used OR logic which reset on almost every call.
        if ("best-fit".equals(prev) && !"best-fit".equals(this.resizeMode)) {
            mBestFitUsingCover = null;
        }

        VlcLog.trace("RESIZE", "mode=" + this.resizeMode);
        requestResizeMode();
    }

    // =========================================================================
    // Resize implementation
    // =========================================================================

    /**
     * The one way to say "the window holding this video changed; refit it". Posted so it
     * runs after the layout pass that triggered it, and guarded inside applyResizeMode
     * against a player or view that is not measurable yet.
     */
    private void invalidateAndRefitGeometry() {
        isResizeModeApplied = false;
        post(this::applyResizeMode);
    }

    private void applyResizeMode() {
        if (mMediaPlayer == null)
            return;
        int viewWidth = getWidth();
        int viewHeight = getHeight();
        if (viewWidth <= 0 || viewHeight <= 0)
            return;

        // In PiP, do exactly what LibVLC's own VideoHelper.updateVideoSurfaces does:
        // publish the window size, let the surface fill it, and apply NO scale or
        // aspect ratio. Running the custom geometry here leaves VLC rendering at the
        // pre-PiP dimensions, so the SurfaceTexture buffer and the vout's window size
        // disagree and a TextureView shows the top-left crop of an oversized frame.
        if (isInPipMode()) {
            applyPipSurfaceGeometry(viewWidth, viewHeight);
            return;
        }

        if (isResizeConfigurationAlreadyApplied(viewWidth, viewHeight))
            return;

        if (autoAspectRatio) {
            try {
                mMediaPlayer.setAspectRatio(viewWidth + ":" + viewHeight);
                mMediaPlayer.setScale(0);
                recordAppliedResizeState(viewWidth, viewHeight);
                isResizeModeApplied = true;
                VlcLog.trace("RESIZE", "autoAR applied " + viewWidth + ":" + viewHeight);
            } catch (Exception e) {
                VlcLog.error("RESIZE", "autoAR error: " + e.getMessage());
            }
            return;
        }

        if (mVideoWidth <= 0 || mVideoHeight <= 0)
            return;


        try {
            applyResizeModeInternal(viewWidth, viewHeight);
            recordAppliedResizeState(viewWidth, viewHeight);
            isResizeModeApplied = true;
        } catch (Exception e) {
            VlcLog.error("RESIZE", "error: " + e.getMessage(), e);
        }
    }


    /**
     * PiP surface geometry, mirroring LibVLC's VideoHelper: window size published to
     * the vout, no scale, no aspect ratio override, no TextureView transform. Never
     * recorded as "already applied", because a PiP window can be resized repeatedly
     * and every one of those has to reach the vout.
     */
    private void applyPipSurfaceGeometry(int viewWidth, int viewHeight) {
        try {
            // While the Activity is paused — i.e. the whole time PiP is open — Fabric
            // pauses its mount dispatch, so nothing in React's normal layout/draw path
            // resizes this TextureView's buffer. Set it explicitly, or LibVLC renders
            // into a buffer that is still the previous size.
            SurfaceTexture texture = getSurfaceTexture();
            if (texture != null) {
                texture.setDefaultBufferSize(viewWidth, viewHeight);
            }

            mMediaPlayer.getVLCVout().setWindowSize(viewWidth, viewHeight);
            resetTextureViewTransform();
            mMediaPlayer.setAspectRatio(null);
            mMediaPlayer.setScale(0f);
            invalidate();
        } catch (Exception e) {
            VlcLog.warn("PIP_RESIZE", "failed: " + e.getMessage());
            return;
        }

        isResizeModeApplied = false;
        mLastAppliedViewWidth = -1;
        mLastAppliedViewHeight = -1;

        // A PiP window is resized continuously while the user drags it, and reading the
        // decor view to describe it is real work. Do none of it unless tracing is on.
        if (VlcLog.tracing()) {
            android.app.Activity activity = getReactActivity();
            String decorSize = "?";
            if (activity != null && activity.getWindow() != null) {
                View decor = activity.getWindow().getDecorView();
                decorSize = decor.getWidth() + "x" + decor.getHeight();
            }
            VlcLog.trace("PIP_RESIZE", "bounds=" + getWidth() + "x" + getHeight()
                    + " decor=" + decorSize
                    + " buffer<-" + viewWidth + "x" + viewHeight
                    + " video=" + mVideoWidth + "x" + mVideoHeight
                    + " mode=" + resizeMode);
        }
    }

    private boolean isResizeConfigurationAlreadyApplied(int viewWidth, int viewHeight) {
        return isResizeModeApplied
                && mLastAppliedViewWidth == viewWidth
                && mLastAppliedViewHeight == viewHeight
                && mLastAppliedVideoWidth == getEffectiveVideoWidth()
                && mLastAppliedVideoHeight == getEffectiveVideoHeight()
                && mLastAppliedSarNum == mSarNum
                && mLastAppliedSarDen == mSarDen
                && mLastAppliedAutoAspectRatio == autoAspectRatio
                && ((mLastAppliedResizeMode == null && resizeMode == null)
                        || (mLastAppliedResizeMode != null && mLastAppliedResizeMode.equals(resizeMode)));
    }

    private void recordAppliedResizeState(int viewWidth, int viewHeight) {
        mLastAppliedViewWidth = viewWidth;
        mLastAppliedViewHeight = viewHeight;
        mLastAppliedVideoWidth = getEffectiveVideoWidth();
        mLastAppliedVideoHeight = getEffectiveVideoHeight();
        mLastAppliedSarNum = mSarNum;
        mLastAppliedSarDen = mSarDen;
        mLastAppliedAutoAspectRatio = autoAspectRatio;
        mLastAppliedResizeMode = resizeMode;
    }

    private boolean shouldKeepPlayingWhileHostStopped() {
        return playInBackground || isInPipMode();
    }

    private void pauseForHostBackground(String reason) {
        if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
            mPausedForHostStop = true;
            mMediaPlayer.pause();
            setKeepScreenOn(false);
            VlcLog.trace("LIFECYCLE", "paused for host background reason=" + reason);
        }
    }


    /**
     * The single route from a resize mode to the player. Measures once, decides once,
     * applies once.
     */
    private void applyResizeModeInternal(int viewWidth, int viewHeight) {
        GeometrySpec spec = computeGeometry(
                resizeMode, viewWidth, viewHeight,
                getEffectiveVideoWidth(), getEffectiveVideoHeight(),
                mSarNum, mSarDen, mBestFitUsingCover);

        if (spec.bestFitUsingCover != null) {
            mBestFitUsingCover = spec.bestFitUsingCover;
        }

        resetTextureViewTransform();
        mMediaPlayer.getVLCVout().setWindowSize(viewWidth, viewHeight);
        mMediaPlayer.setAspectRatio(spec.aspectRatio);
        mMediaPlayer.setScale(spec.scale);

        if (VlcLog.tracing()) {
            VlcLog.trace("RESIZE", "mode=" + resizeMode
                    + " view=" + viewWidth + "x" + viewHeight
                    + " video=" + getEffectiveVideoWidth() + "x" + getEffectiveVideoHeight()
                    + " sar=" + mSarNum + ":" + mSarDen
                    + " ar=" + spec.aspectRatio + " scale=" + spec.scale);
        }
    }

    private void resetTextureViewTransform() {
        setTransform(new android.graphics.Matrix());
    }

    private int getEffectiveVideoWidth() {
        return mVideoVisibleWidth > 0 ? mVideoVisibleWidth : mVideoWidth;
    }

    private int getEffectiveVideoHeight() {
        return mVideoVisibleHeight > 0 ? mVideoVisibleHeight : mVideoHeight;
    }

    /**
     * The geometry decision for one resize mode, as data.
     *
     * Every mode used to mutate the MediaPlayer directly from its own helper, and each
     * helper re-read getWidth()/getHeight() and recomputed SAR for itself. Producing a
     * value instead means the whole decision is one readable function, the view is
     * measured exactly once per application, and the modes cannot drift apart.
     */
    private static final class GeometrySpec {
        /** Display aspect ratio for LibVLC, or null to let it decide. */
        final String aspectRatio;
        /** Zoom factor, or 0 to let LibVLC fit the window. */
        final float scale;
        /** New best-fit hysteresis state; null for every other mode. */
        final Boolean bestFitUsingCover;

        GeometrySpec(String aspectRatio, float scale, Boolean bestFitUsingCover) {
            this.aspectRatio = aspectRatio;
            this.scale = scale;
            this.bestFitUsingCover = bestFitUsingCover;
        }
    }

    /**
     * Pure geometry decision. No view access and no player mutation, so the arithmetic
     * for every mode sits in one place and can be reasoned about without a device.
     *
     * @param bestFitUsingCover previous best-fit state, for hysteresis; null if unset.
     */
    private static GeometrySpec computeGeometry(
            String mode, int viewW, int viewH, int videoW, int videoH,
            int sarNum, int sarDen, Boolean bestFitUsingCover) {

        // Source width corrected for non-square pixels. Everything below compares the
        // view against this, never against the raw frame width.
        final float sar = (sarNum > 0 && sarDen > 0) ? (float) sarNum / sarDen : 1f;
        final float displayW = videoW * sar;

        if ("fill".equals(mode) || "stretch".equals(mode)) {
            return new GeometrySpec(viewW + ":" + viewH, 0f, null);
        }

        if ("none".equals(mode)) {
            // Null aspect, not an explicit one: VLC already applies the stream's own display
            // aspect ratio, SAR included. Forcing a ratio here deformed the picture.
            return new GeometrySpec(null, 1f, null);
        }

        // Every mode below scales against the view, so it needs both to be measurable.
        if (viewW <= 0 || viewH <= 0 || displayW <= 0 || videoH <= 0) {
            // Not enough information to scale; contain is the safe default.
            return new GeometrySpec(null, 0f, null);
        }

        final float scaleX = viewW / displayW;
        final float scaleY = viewH / (float) videoH;

        if ("cover".equals(mode)) {
            return new GeometrySpec(null, Math.max(scaleX, scaleY), null);
        }

        if ("scale-down".equals(mode)) {
            // Native size unless the source overflows the view, and never a forced aspect:
            // shrinking must not change the shape. displayW already accounts for SAR.
            boolean overflows = displayW > viewW || videoH > viewH;
            return new GeometrySpec(null, overflows ? Math.min(scaleX, scaleY) : 1f, null);
        }

        if ("best-fit".equals(mode)) {
            final float containScale = Math.min(scaleX, scaleY);
            final float coverScale = Math.max(scaleX, scaleY);
            final float containW = displayW * containScale;
            final float containH = videoH * containScale;
            final float coverW = displayW * coverScale;
            final float coverH = videoH * coverScale;
            final float viewArea = (float) viewW * viewH;

            // How much of the frame cover would crop away, and how much letterboxing
            // contain would leave. Cover is only worth it when it crops very little.
            final float cropRatio = (coverW > 0 && coverH > 0)
                    ? (1f - (viewArea / (coverW * coverH)))
                    : 1f;
            final float maxBar = Math.max(
                    Math.max(0f, (viewW - containW) / viewW),
                    Math.max(0f, (viewH - containH) / viewH));

            // Asymmetric thresholds: once cover is chosen it takes a larger change to
            // leave it, so a slowly resizing window cannot oscillate between the two.
            final boolean useCover;
            if (Boolean.TRUE.equals(bestFitUsingCover)) {
                useCover = cropRatio <= BEST_FIT_EXIT_CROP_RATIO && maxBar <= BEST_FIT_EXIT_BAR_RATIO;
            } else {
                // cropRatio cannot be negative: cover always covers at least the view.
                useCover = cropRatio <= BEST_FIT_ENTER_CROP_RATIO
                        && maxBar <= BEST_FIT_ENTER_BAR_RATIO
                        && (containW * containH) / viewArea < 0.999f;
            }
            return new GeometrySpec(null, useCover ? coverScale : 0f, useCover);
        }

        // "contain" and anything unrecognised: let LibVLC fit the window itself.
        return new GeometrySpec(null, 0f, null);
    }


    // =========================================================================
    // Video Enhancement Lifecycle
    // =========================================================================

    /**
     * Build effective init options from srcMap + explicit target enhancement state.
     * NEVER reads mRequestedEnhancement — each recreate is bound to the target it
     * was started for (avoids TOCTOU if mRequestedEnhancement changes mid-flight).
     * srcMap is NOT mutated.
     */
    private ArrayList<String> buildEffectiveInitOptions(boolean targetEnhancement) {
        ArrayList<String> options = new ArrayList<>();
        final boolean useEnhancementCompatiblePipeline = shouldUseEnhancementCompatiblePipeline(targetEnhancement);

        // Pull base initOptions from srcMap if present
        if (srcMap != null && srcMap.hasKey("initOptions")) {
            ReadableArray initOptions = srcMap.getArray("initOptions");
            if (initOptions != null) {
                ArrayList srcOptions = initOptions.toArrayList();
                for (Object opt : srcOptions) {
                    String optStr = (String) opt;
                    // Filter out any enhancement-related options that JS may still send
                    if (optStr.startsWith("--video-filter=adjust")
                            || optStr.startsWith("--brightness=")
                            || optStr.startsWith("--contrast=")
                            || optStr.startsWith("--saturation=")
                            || optStr.startsWith("--gamma=")
                            || optStr.equals("--no-mediacodec-dr")
                            || optStr.equals("--no-omxil-dr")) {
                        continue; // Skip — managed by native enhancement state
                    }
                    options.add(optStr);
                }
            }
        }

        // Add fallback options if srcMap had no initOptions
        if (options.isEmpty()) {
            options.add("--network-caching=600");
            options.add("--file-caching=600");
            options.add("--live-caching=600");
        }

        // Always add audio time-stretch
        options.add("--audio-time-stretch");
        options.add("--audio-filter=scaletempo");
        options.add("--scaletempo-overlap=0.30");
        options.add("--scaletempo-search=15");
        options.add("--audio-desync=100");

        // Enhancement-specific options
        if (targetEnhancement) {
            options.add("--video-filter=adjust");
            options.add("--brightness=1.03");
            options.add("--contrast=1.08");
            options.add("--saturation=1.30");
            options.add("--gamma=0.95");
        }

        if (useEnhancementCompatiblePipeline) {
            options.add("--no-mediacodec-dr");
            options.add("--no-omxil-dr");
        }

        return options;
    }

    /**
     * Capture a snapshot of all current playback state.
     * Returns null if no valid player/media is loaded.
     */
    private PlaybackSnapshot capturePlaybackSnapshot() {
        if (mMediaPlayer == null) {
            VlcLog.warn("ENHANCE", "capturePlaybackSnapshot: no player loaded");
            return null;
        }

        long timeMs;
        boolean nativePlaying;
        float rate;
        try {
            timeMs = mMediaPlayer.getTime();
            nativePlaying = mMediaPlayer.isPlaying();
            rate = mMediaPlayer.getRate();
        } catch (Exception e) {
            VlcLog.warn("ENHANCE", "capturePlaybackSnapshot: error reading state: " + e.getMessage());
            return null;
        }

        PlaybackSnapshot snapshot = new PlaybackSnapshot(
                timeMs,
                isPaused,          // user intent
                nativePlaying,
                rate,
                _audioTrack,
                _textTrack,
                mAudioDelay,
                _subtitleUri,
                _subtitleUri != null && !_subtitleUri.isEmpty(),
                mMuted
        );

        return snapshot;
    }

    /**
     * Entry point from React prop. Coalesces rapid toggles via debounce.
     */
    public void setVideoEnhancement(boolean enabled) {
        mRequestedEnhancement = enabled;

        // Prefer the live LibVLC adjust path to avoid player recreation and the
        // black-frame gap. Recreate remains as a fallback if the bridge is unavailable.
        if (!mEnhancementRecreateInFlight && applyVideoEnhancementLive(enabled)) {
            clearPendingEnhancementRunnable();
            invalidatePendingEnhancementCallbacks();
            mAppliedEnhancement = enabled;
            return;
        }

        // If a recreate is already in flight, let it finish and reconcile against
        // the latest requested state rather than invalidating its generation.
        if (mEnhancementRecreateInFlight) {
            clearPendingEnhancementRunnable();
            return;
        }

        // No-op if already applied
        if (mRequestedEnhancement == mAppliedEnhancement) {
            clearPendingEnhancementRunnable();
            return;
        }

        clearPendingEnhancementRunnable();

        // Increment generation (invalidates any stale callbacks from previous attempts)
        mEnhancementGeneration++;
        final long generation = mEnhancementGeneration;

        // Debounce: coalesce to final requested state
        mPendingEnhancementRunnable = () -> {
            mPendingEnhancementRunnable = null;
            scheduleEnhancementApply(generation);
        };
        mEnhancementHandler.postDelayed(mPendingEnhancementRunnable, ENHANCEMENT_DEBOUNCE_MS);
    }

    /**
     * Called after debounce settles. Performs the actual enhancement recreate.
     */
    private void scheduleEnhancementApply(long generation) {
        // Stale generation check
        if (generation != mEnhancementGeneration) {
            return;
        }

        if (mEnhancementRecreateInFlight) {
            return;
        }

        // Re-check if still needed
        if (mRequestedEnhancement == mAppliedEnhancement) {
            return;
        }

        // Capture current state
        PlaybackSnapshot snapshot = capturePlaybackSnapshot();

        if (snapshot == null) {
            // No player loaded — enhancement will be applied on next createPlayer
            return;
        }

        // Mark in-flight
        mEnhancementRecreateInFlight = true;
        mEnhancementRestoreCompleted = false;
        mPendingEnhancementSnapshot = snapshot;
        mPendingEnhancementTarget = mRequestedEnhancement;

        applyEnhancementWithRecreate(mRequestedEnhancement, generation, snapshot);
    }

    /**
     * Perform the enhancement recreate with a specific target state and generation.
     */
    private void applyEnhancementWithRecreate(boolean targetEnhancement, long generation,
                                               PlaybackSnapshot snapshot) {
        // Build new init options with explicit target (not mRequestedEnhancement)
        ArrayList<String> effectiveOptions = buildEffectiveInitOptions(targetEnhancement);

        // Save position for createPlayer's built-in restore
        if (snapshot.timeMs > 0 && mMediaPlayer != null) {
            try {
                long lengthMs = mMediaPlayer.getLength();
                if (lengthMs > 0) {
                    mSavedPosition = (float) snapshot.timeMs / lengthMs;
                }
            } catch (Exception e) {
                VlcLog.warn("ENHANCE", "error calculating position: " + e.getMessage());
            }
        }

        // Set paused intent before recreate so createPlayer respects it
        isPaused = snapshot.userPausedIntent;

        // Release and recreate with new options
        // We override the init options by temporarily adjusting how createPlayer reads them
        releasePlayer();

        // Create player with effective options — we override the initOptions that
        // createPlayer normally reads from srcMap by using a wrapper approach.
        // Since createPlayer reads initOptions from srcMap, we need to build cOptions
        // with our effective options. We achieve this by storing them and using them
        // in createPlayer when it checks initOptions.
        mEffectiveInitOptionsOverride = effectiveOptions;
        createPlayer(!snapshot.userPausedIntent, true);
        mEffectiveInitOptionsOverride = null;

        // Safety timer fallback
        final long restoreGeneration = generation;
        mEnhancementHandler.postDelayed(() -> {
            if (mEnhancementGeneration == restoreGeneration && !mEnhancementRestoreCompleted) {
                restorePlaybackSnapshot(snapshot, restoreGeneration, targetEnhancement);
            }
        }, 500);
    }

    /**
     * Restore playback state after enhancement recreate.
     * Idempotent via mEnhancementRestoreCompleted — will only run once per generation.
     * Restore order: mute → subtitle → delay → rate → tracks → seek → play/pause intent
     */
    private void restorePlaybackSnapshot(PlaybackSnapshot snapshot, long generation,
                                          boolean targetEnhancement) {
        // Stale generation check
        if (generation != mEnhancementGeneration) {
            return;
        }

        // Idempotent guard
        if (mEnhancementRestoreCompleted) {
            return;
        }

        if (mMediaPlayer == null) {
            VlcLog.warn("ENHANCE", "restorePlaybackSnapshot: no player, skipping");
            return;
        }

        mEnhancementRestoreCompleted = true;

        // 1. Mute state
        setMutedModifier(snapshot.muted);

        // 2. External subtitle slave attachment
        if (snapshot.externalSubAttached && snapshot.subtitleUri != null) {
            mMediaPlayer.addSlave(Media.Slave.Type.Subtitle, snapshot.subtitleUri, true);
        }

        // 3. Audio delay
        if (snapshot.audioDelayMs != 0) {
            mMediaPlayer.setAudioDelay(snapshot.audioDelayMs * 1000);
        }

        // 4. Rate
        if (snapshot.rate != 1.0f) {
            mMediaPlayer.setRate(snapshot.rate);
            mLastAppliedRate = snapshot.rate;
        }

        // 5. Track selections
        if (snapshot.audioTrack != -1) {
            mMediaPlayer.setAudioTrack(snapshot.audioTrack);
        }
        if (snapshot.textTrack != -1) {
            mMediaPlayer.setSpuTrack(snapshot.textTrack);
        } else {
            // Explicitly disable subtitles
            if (mMediaPlayer.getSpuTracksCount() > 0) {
                mMediaPlayer.setSpuTrack(-1);
            }
        }

        // 6. Position seek (handled by createPlayer's mSavedPosition mechanism)
        // Already applied via mSavedPosition before createPlayer was called

        // 7. Last: paused/playing intent
        // Already set via isPaused before createPlayer, and createPlayer respects it

        // Mark enhancement as applied
        mAppliedEnhancement = targetEnhancement;
        mEnhancementRecreateInFlight = false;
        mPendingEnhancementSnapshot = null;

        // Reconcile: if mRequestedEnhancement changed again during recreate
        if (mRequestedEnhancement != mAppliedEnhancement) {
            // Re-trigger with new request
            mEnhancementGeneration++;
            final long newGen = mEnhancementGeneration;
            mEnhancementHandler.post(() -> scheduleEnhancementApply(newGen));
        }
    }

    /**
     * Cancel any pending enhancement work. Called from cleanup, setSrc, releasePlayer.
     */
    private void cancelPendingEnhancement() {
        clearPendingEnhancementRunnable();
        invalidatePendingEnhancementCallbacks();
    }

    private void clearPendingEnhancementRunnable() {
        if (mPendingEnhancementRunnable != null) {
            mEnhancementHandler.removeCallbacks(mPendingEnhancementRunnable);
            mPendingEnhancementRunnable = null;
        }
    }

    private void invalidatePendingEnhancementCallbacks() {
        mEnhancementGeneration++;
        mEnhancementRecreateInFlight = false;
        mEnhancementRestoreCompleted = false;
        mPendingEnhancementSnapshot = null;
        mPendingEnhancementTarget = mRequestedEnhancement;
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    public void cleanUpResources() {
        // FIX S7: prevent double-cleanup (called from both onDetachedFromWindow
        // and onHostDestroy)
        if (mCleaned)
            return;
        mCleaned = true;

        // The Activity outlives this view, so a retained observer would leak it.
        stopObservingActivityLifecycle();

        // The service holds a strong reference to this view as its host.
        VlcPlaybackHost.clear(getContext(), this);

        // Cancel pending enhancement work
        cancelPendingEnhancement();

        clearPendingResizeRequest();
        cancelPendingSeek();

        if (seekExecutor != null && !seekExecutor.isShutdown()) {
            seekExecutor.shutdownNow();
            seekExecutor = null;
        }
        this.removeOnLayoutChangeListener(onLayoutChangeListener);
        if (themedReactContext != null) {
            themedReactContext.removeLifecycleEventListener(this);
        }
        stopPlayback();
        if (surfaceVideo != null) {
            surfaceVideo.release();
            surfaceVideo = null;
        }
    }

    // =========================================================================
    // TextureView callbacks
    // =========================================================================

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
        VlcLog.trace("SURFACE", "onSurfaceTextureAvailable " + width + "x" + height);
        surfaceVideo = new Surface(surface);

        if (mMediaPlayer != null) {
            VlcLog.trace("SURFACE", "restoring surface to existing player");
            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            if (!vlcOut.areViewsAttached()) {
                vlcOut.setVideoSurface(surface);
                vlcOut.attachViews(onNewVideoLayoutListener);
                vlcOut.setWindowSize(width, height);
                requestResizeMode();
            }
        } else {
            createPlayer(true, false);
        }
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        VlcLog.trace("SURFACE", "buffer size changed " + width + "x" + height);
        invalidateAndRefitGeometry();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w != oldw || h != oldh) {
            invalidateAndRefitGeometry();
        }
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        VlcLog.trace("SURFACE", "destroyed");
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture surface) {
        // Frame rendered — no-op
    }

    // =========================================================================
    // Media event listener
    // =========================================================================

    private final Media.EventListener mMediaListener = new Media.EventListener() {
        @Override
        public void onEvent(Media.Event event) {
            switch (event.type) {
                case Media.Event.MetaChanged:
                    VlcLog.trace("MEDIA_EVENT", "MetaChanged id=" + event.getMetaId());
                    break;
                case Media.Event.ParsedChanged:
                    VlcLog.trace("MEDIA_EVENT", "ParsedChanged status=" + event.getParsedStatus());
                    break;
                case Media.Event.StateChanged:
                    VlcLog.trace("MEDIA_EVENT", "StateChanged meta=" + event.getMetaId());
                    break;
                default:
                    VlcLog.trace("MEDIA_EVENT", "type=" + event.type);
                    break;
            }
        }
    };

    // =========================================================================
    // Video info
    // =========================================================================

    private void updateVideoInfo() {
        if (mMediaPlayer == null)
            return;

        // Build a hash of the info we intend to emit so we can skip unchanged events
        StringBuilder hash = new StringBuilder();
        hash.append("duration:").append(mMediaPlayer.getLength()).append(";");
        if (mMediaPlayer.getAudioTracksCount() > 0) {
            MediaPlayer.TrackDescription[] at = mMediaPlayer.getAudioTracks();
            hash.append("audio:");
            for (MediaPlayer.TrackDescription t : at)
                hash.append(t.id).append(":").append(t.name).append(",");
            hash.append(";");
        }
        if (mMediaPlayer.getSpuTracksCount() > 0) {
            MediaPlayer.TrackDescription[] st = mMediaPlayer.getSpuTracks();
            hash.append("spu:");
            for (MediaPlayer.TrackDescription t : st)
                hash.append(t.id).append(":").append(t.name).append(",");
            hash.append(";");
        }
        Media.VideoTrack vt = mMediaPlayer.getCurrentVideoTrack();
        if (vt != null)
            hash.append("video:").append(vt.width).append("x").append(vt.height).append(";");

        String current = hash.toString();
        if (mVideoInfoHash != null && mVideoInfoHash.equals(current))
            return;

        long duration = mMediaPlayer.getLength();
        if (duration <= 1) {
            VlcLog.trace("VIDEO_INFO", "skipping — junk duration=" + duration);
            return;
        }

        maybeRestorePendingEnhancementSnapshot();
        maybeMarkEnhancementAppliedFromNormalCreate();

        WritableMap info = Arguments.createMap();
        info.putDouble("duration", duration);

        if (mMediaPlayer.getAudioTracksCount() > 0) {
            MediaPlayer.TrackDescription[] tracks = mMediaPlayer.getAudioTracks();
            WritableArray arr = new WritableNativeArray();
            for (MediaPlayer.TrackDescription t : tracks) {
                WritableMap m = Arguments.createMap();
                m.putInt("id", t.id);
                m.putString("name", t.name);
                arr.pushMap(m);
            }
            info.putArray("audioTracks", arr);
            VlcLog.trace("VIDEO_INFO", "audioTracks=" + tracks.length);
        }
        if (mMediaPlayer.getSpuTracksCount() > 0) {
            MediaPlayer.TrackDescription[] tracks = mMediaPlayer.getSpuTracks();
            WritableArray arr = new WritableNativeArray();
            for (MediaPlayer.TrackDescription t : tracks) {
                WritableMap m = Arguments.createMap();
                m.putInt("id", t.id);
                m.putString("name", t.name);
                arr.pushMap(m);
            }
            info.putArray("textTracks", arr);
            VlcLog.trace("VIDEO_INFO", "textTracks=" + tracks.length);
        }
        if (vt != null) {
            WritableMap sz = Arguments.createMap();
            sz.putInt("width", vt.width);
            sz.putInt("height", vt.height);
            info.putMap("videoSize", sz);
        }

        VlcLog.trace("VIDEO_INFO", "emitting load event duration=" + duration + "ms");
        eventEmitter.sendEvent(info, VideoEventEmitter.EVENT_ON_LOAD);
        mVideoInfoHash = current;
    }

    // =========================================================================
    // Media Session & Notification
    // =========================================================================

    // =========================================================================
    // Media metadata
    // =========================================================================

    public void setVideoTitle(String title) {
        mVideoTitle = title;
        // The session builds its notification from metadata(), so nudge it to re-read.
        notifyMediaSession();
    }

    public void setVideoArtist(String artist) {
        mVideoArtist = artist;
        notifyMediaSession();
    }

    // =========================================================================
    // Equalizer
    // =========================================================================

    public void setAudioEqualizer(ReadableArray bands) {
        if (bands == null || bands.size() == 0) {
            mEqualizerBands = null;
            if (mEqualizer != null) {
                if (mMediaPlayer != null)
                    mMediaPlayer.setEqualizer(null);
                mEqualizer = null;
            }
            return;
        }
        try {
            mEqualizerBands = new float[bands.size()];
            for (int i = 0; i < bands.size(); i++)
                mEqualizerBands[i] = (float) bands.getDouble(i);
            if (mMediaPlayer != null)
                applyEqualizer();
        } catch (Exception e) {
            VlcLog.error("EQ", "error: " + e.getMessage());
        }
    }

    /**
     * FIX S6: cache the Equalizer instance and update bands in-place rather than
     * allocating a new native object on every call.
     */
    private void applyEqualizer() {
        if (mMediaPlayer == null)
            return;

        if (mEqualizerBands != null) {
            try {
                if (mEqualizer == null) {
                    mEqualizer = MediaPlayer.Equalizer.create();
                }
                int n = mEqualizer.getBandCount();
                for (int i = 0; i < n && i < mEqualizerBands.length; i++) {
                    mEqualizer.setAmp(i, mEqualizerBands[i]);
                }
                mEqualizer.setPreAmp(12f);
                mMediaPlayer.setEqualizer(mEqualizer);
                VlcLog.trace("EQ", "applied " + mEqualizerBands.length + " bands");
            } catch (Exception e) {
                VlcLog.error("EQ", "failed: " + e.getMessage());
            }
        } else {
            mMediaPlayer.setEqualizer(null);
        }
    }

    private void scheduleAudioTrackApply(boolean allowRetryWhenPlaying) {
        if (mPendingAudioTrackRunnable != null) {
            mAudioTrackHandler.removeCallbacks(mPendingAudioTrackRunnable);
        }

        final Runnable applyRunnable = new Runnable() {
            @Override
            public void run() {
                applyRequestedAudioTrack("prop", allowRetryWhenPlaying);
                if (mPendingAudioTrackRunnable == this) {
                    mPendingAudioTrackRunnable = null;
                }
            }
        };

        mPendingAudioTrackRunnable = applyRunnable;
        mAudioTrackHandler.post(applyRunnable);
    }

    private boolean applyRequestedAudioTrack(String reason, boolean allowRetryWhenPlaying) {
        if (mMediaPlayer == null || _audioTrack == -1) {
            return false;
        }

        if (_audioTrack == currentlyAppliedAudioTrack) {
            return true;
        }

        final int requestedTrack = _audioTrack;
        boolean applied = mMediaPlayer.setAudioTrack(requestedTrack);
        if (applied) {
            currentlyAppliedAudioTrack = requestedTrack;
            VlcLog.trace("AUDIO_TRACK", "applied track=" + requestedTrack + " reason=" + reason);
            return true;
        }

        VlcLog.warn("AUDIO_TRACK", "apply failed for track=" + requestedTrack + " reason=" + reason);

        if (allowRetryWhenPlaying && mMediaPlayer.isPlaying()) {
            final Runnable retryRunnable = new Runnable() {
                @Override
                public void run() {
                    if (mMediaPlayer == null || _audioTrack != requestedTrack || currentlyAppliedAudioTrack == requestedTrack) {
                        if (mPendingAudioTrackRunnable == this) {
                            mPendingAudioTrackRunnable = null;
                        }
                        return;
                    }

                    boolean retryApplied = mMediaPlayer.setAudioTrack(requestedTrack);
                    if (retryApplied) {
                        currentlyAppliedAudioTrack = requestedTrack;
                        VlcLog.trace("AUDIO_TRACK", "retry applied track=" + requestedTrack);
                    } else {
                        VlcLog.warn("AUDIO_TRACK", "retry failed for track=" + requestedTrack);
                    }

                    if (mPendingAudioTrackRunnable == this) {
                        mPendingAudioTrackRunnable = null;
                    }
                }
            };

            mPendingAudioTrackRunnable = retryRunnable;
            mAudioTrackHandler.postDelayed(retryRunnable, 150);
        }

        return false;
    }
    // =========================================================================
    // Media session host — see VlcMedia3Player
    // =========================================================================

    /**
     * The service reads playback through this rather than owning it. The view still drives
     * LibVLC; these methods only report what it is doing and accept transport commands
     * coming back from the notification, lock screen or a headset button.
     */

    @Override
    public MediaPlayer player() {
        return mMediaPlayer;
    }

    @Override
    public boolean playWhenReady() {
        // Not user intent alone. The notification describes what playback is doing, so an
        // involuntary pause — the Activity stopping, audio focus lost, headphones pulled —
        // has to read as not playing. Reporting intent here left the notification showing
        // a play state after closing PiP, because a lifecycle pause never sets isPaused.
        return !isPaused
                && !mPausedForHostStop
                && !mPausedForAudioFocus
                && !mPausedForNoisyEvent;
    }

    @Override
    public boolean buffering() {
        return mIsBuffering;
    }

    @Override
    public boolean ended() {
        return mNativeStopped;
    }

    @Override
    public androidx.media3.common.MediaMetadata metadata() {
        return new androidx.media3.common.MediaMetadata.Builder()
                .setTitle(mVideoTitle)
                .setArtist(mVideoArtist)
                .build();
    }

    @Override
    public void onTransportPlayWhenReady(boolean playWhenReady) {
        VlcLog.trace("SESSION", "transport playWhenReady=" + playWhenReady);
        if (playWhenReady) {
            // Pressing play from the notification or a headset overrides whatever paused
            // playback. Without clearing these, playWhenReady() would keep reporting not
            // playing while audio ran — the same lie as before, inverted.
            mPausedForHostStop = false;
            mPausedForAudioFocus = false;
            mPausedForNoisyEvent = false;
        }
        setPausedModifier(!playWhenReady);
    }

    @Override
    public void onTransportSeek(long positionMs) {
        VlcLog.trace("SESSION", "transport seek=" + positionMs + "ms");
        if (mMediaPlayer == null) {
            return;
        }
        try {
            mMediaPlayer.setTime(positionMs);
        } catch (IllegalStateException e) {
            // The player was released between the session sending this and it arriving.
            VlcLog.warn("SESSION", "seek dropped, player released");
        }
    }

    @Override
    public void onTransportStop() {
        VlcLog.trace("SESSION", "transport stop");
        stopPlayer();
    }

    @Override
    public void onTransportSpeed(float speed) {
        VlcLog.trace("SESSION", "transport speed=" + speed);
        setRateModifier(speed);
    }

    /** Tell the session that LibVLC's state moved, so the notification follows it. */
    private void notifyMediaSession() {
        final VlcMedia3Player sessionPlayer = VlcPlaybackHost.player();
        if (sessionPlayer != null) {
            sessionPlayer.notifyStateChanged();
        }
    }
}
