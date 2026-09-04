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

import org.videolan.libvlc.interfaces.IMedia;
import org.videolan.libvlc.interfaces.IVLCVout;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.Dialog;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

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

    // If Buffering=100% never fires after a codec-flush seek, force play() after this
    // many milliseconds to prevent a permanent stall.
    //
    // Sized as an escape from a stuck seek, deliberately not as a latency target. Precise
    // seeking -- see the note on input-fast-seek in VlcPlaybackEngine -- decodes from the
    // keyframe to the requested frame, and a device trace measured ordinary jumps taking
    // 909 ms and 1019 ms. The former 200 ms therefore fired before almost every seek
    // completed, forcing play() while the seek was still in flight.
    private static final long SEEK_BUFFER_TIMEOUT_MS = 3_000L;
    /**
     * How far a committed seek may land from its target before it is worth reporting.
     *
     * <p>Not a correctness threshold and not enforced: nothing corrects a drifted seek,
     * because auto-correction loops. It is only the line above which a landing is worth a
     * journal line. Sized against post-fix device traces, where seeks land within a
     * handful of milliseconds; before {@code --input-fast-seek} was removed the same
     * traces showed 19-35 s.
     */
    private static final long SEEK_VERIFY_TOLERANCE_MS = 500L;
    /**
     * How far playback may advance from the beginning before an unconfirmed start offset
     * is treated as dropped rather than merely pending.
     *
     * <p>VLC applies {@code :start-time} by pushing INPUT_CONTROL_SET_TIME from
     * {@code StartTitle()}, which is asynchronous, so the offset is legitimately absent
     * for the first events after Playing.
     */
    private static final long START_TIME_IGNORED_EVIDENCE_MS = 4_000L;

    /**
     * How far from the requested offset playback may land before it is corrected.
     *
     * <p>VLC seeks to a keyframe at or before the requested time, and
     * {@code --input-fast-seek} makes that granularity coarse: device traces showed
     * arrivals 2.9 s, 5.2 s and 8.8 s early. That is a real amount of re-watched video, so
     * the residual is corrected once, precisely, after playback is confirmed running.
     */
    private static final long START_TIME_PRECISION_MS = 1_500L;
    /** Match the JavaScript history boundary: the opening/final second is not resumable. */
    private static final long RESUME_EDGE_GUARD_MS = 1_000L;

    /** Backstop for enhancement-recreate completion. See applyEnhancementWithRecreate. */
    private static final long ENHANCEMENT_RESTORE_TIMEOUT_MS = 500L;

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
    // Fields — player events and React prop setters both run on the main looper
    // =========================================================================

    private final VideoEventEmitter eventEmitter;
    private final ThemedReactContext themedReactContext;
    /** Owns the native LibVLC objects; this view only borrows the player. */
    private final VlcPlaybackEngine mEngine = new VlcPlaybackEngine();
    private Lifecycle mObservedLifecycle = null;
    private final AudioManager audioManager;

    // Player instances. onEvent captures this into a local for legibility, and the
    // engine detaches the main-looper listener before releasing queued events.
    private MediaPlayer mMediaPlayer = null;

    // Surface
    private Surface surfaceVideo;
    private volatile boolean isSurfaceViewDestroyed = false;

    // Config / props
    private String src;
    private String _subtitleUri;
    private int _textTrack = -1;
    // Desired audio track; read by event handlers and prop setters on the main looper.
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
    // What VLC currently holds, in microseconds, or MIN_VALUE for "unknown". VLC drops
    // the delay across a track change, so a successful track change resets this to
    // unknown rather than assuming the value survived.
    private long currentlyAppliedAudioDelayUs = Long.MIN_VALUE;
    // Last buffering state written to the log, so only transitions are recorded.
    private boolean mLastLoggedBuffering = false;

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

    // Playback state. Some volatile modifiers predate the verified main-looper model.
    private volatile boolean isPaused = true;
    private volatile boolean mNativeStopped = true;
    /** Only EndReached means the next play is an intentional replay from zero. */
    private boolean mEnded = false;
    private boolean isHostStopped = false;
    private boolean wasPlayingBeforeHostStop = false;
    private boolean mPausedForHostStop = false;
    private boolean mPausedForAudioFocus = false;
    private boolean mPausedForNoisyEvent = false;
    private boolean isResizeModeApplied = false;

    /**
     * Unconfirmed start intent for the current source, in seconds. 0 means none.
     *
     * <p>Seconds, not a fraction, and applied as VLC's {@code :start-time} media option
     * rather than as a seek after playback starts. Both parts of that matter:
     *
     * <ul>
     *   <li>A fraction cannot be turned into a time without the length, and the length
     *       belongs to the player being released. Saving seconds removes the round trip.</li>
     *   <li>LibVLC drops a {@code setTime} issued during its startup ramp even though
     *       {@code isSeekable()} and {@code getLength()} already report ready, which is
     *       why every timing-based restore here failed. Opening the demuxer at the offset
     *       has no window to miss.</li>
     * </ul>
     *
     * <p>Set from the source, from a release that saved a position, from an enhancement
     * recreate, and from reviving a stopped player. It survives construction and opening
     * errors, and is cleared only after VLC reports playback near the requested time or an
     * explicit user seek supersedes it.
     */
    private double mPendingStartTimeSec = 0d;

    /**
     * The seek version the pending verification belongs to.
     *
     * <p>A position can only be attributed to a seek if no later seek has been dispatched
     * since. Without this the verifier compared one seek's target against the next seek's
     * position during rapid seeking and reported transposed pairs — target and actual
     * swapped between consecutive lines — as multi-minute drift.
     */
    private long mSeekVerifyVersion = -1L;

    /** Set once a corrective seek has been issued for the current pending offset. */
    private boolean mStartTimeCorrectionIssued = false;

    /**
     * The single way to change where the next created player should begin.
     *
     * <p>Exists because the offset has a companion flag: seven call sites used to assign
     * the field directly, and any one of them forgetting the flag would make the *next*
     * offset abandon itself on first evidence instead of correcting. Routing every change
     * through here also puts every change of intent in the trace, which is what the device
     * runs actually need.
     */
    private void setPendingStartTime(double seconds, String reason) {
        final double next = seconds > 0d && !Double.isNaN(seconds) && !Double.isInfinite(seconds)
                ? seconds
                : 0d;
        if (next != mPendingStartTimeSec || mStartTimeCorrectionIssued) {
            VlcLog.trace("START_TIME", "pending=" + next + "s reason=" + reason
                    + " (was " + mPendingStartTimeSec + "s)");
        }
        mPendingStartTimeSec = next;
        mStartTimeCorrectionIssued = false;
    }

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

    private String mVideoInfoHash = null;

    // Cached equalizer instance — reused rather than re-allocated on every call
    private MediaPlayer.Equalizer mEqualizer = null;
    private float[] mEqualizerBands = null;
    /**
     * The rate the app has asked for, as opposed to the one currently applied.
     *
     * <p>Survives a player recreate. A newly playing player always receives this live
     * value; no issued-command cache is treated as proof that VLC accepted it.
     */
    private float mRequestedRate = 1.0f;
    private final Handler mRateHandler = new Handler(Looper.getMainLooper());
    private Runnable mPendingRateRunnable = null;
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

    private boolean  mRequestedEnhancement = false;   // What React wants
    private boolean  mAppliedEnhancement = false;      // What's actually applied
    private boolean  mEnhancementCompatiblePipeline = false;
    private long     mEnhancementGeneration = 0;       // Gates all callbacks + restore
    private boolean  mEnhancementRecreateInFlight = false;
    private Runnable mPendingEnhancementRunnable = null;
    private boolean  mPendingEnhancementTarget = false;

    private static final long ENHANCEMENT_DEBOUNCE_MS = 75L;
    private final Handler mEnhancementHandler = new Handler(Looper.getMainLooper());
    /**
     * The enhancement-completion backstop, held so it can be removed rather than merely
     * ignored. Bumping the generation stops it acting, but the message stays queued and
     * retains this view until it fires.
     */
    private Runnable mPendingEnhancementRestoreRunnable = null;

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
        VlcLog.event("LIFECYCLE", "foreground (ON_START)");
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

        VlcLog.event("LIFECYCLE", "background (ON_STOP)");
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
        VlcLog.event("AUDIO_FOCUS", "change=" + focusChange
                + (focusChange == AudioManager.AUDIOFOCUS_LOSS ? " (lost)"
                    : focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ? " (lost transient)"
                    : focusChange == AudioManager.AUDIOFOCUS_GAIN ? " (gained)" : ""));
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
                            VlcLog.event("NOISY", "audio route became noisy — paused");
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

    private void maybeCompletePendingEnhancementRecreate() {
        if (!mEnhancementRecreateInFlight) {
            return;
        }
        completeEnhancementRecreate(mEnhancementGeneration, mPendingEnhancementTarget);
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
            // NOTE: this runs on the MAIN thread, despite what this comment used to say.
            // Verified against the LibVLC 3.6.5 bytecode: VLCObject.dispatchEventFromNative
            // is called on a native thread but always hands the event to
            // Handler.post(EventRunnable), and setEventListener(listener) constructs that
            // Handler with Looper.getMainLooper() when no handler is supplied. So event
            // handling cannot interleave with releasePlayer or a prop setter, which also
            // run on the main thread, and fields shared with them need no volatile for
            // that reason. Nothing in this class touches the player off the main thread:
            // the seek path posts to a main-looper Handler.
            //
            // Several fields above are still volatile. They predate this correction and
            // are harmless; do not read them as evidence of concurrency here.
            // One read per event rather than seventeen, so the null check and every use
            // below refer to the same object. This is for legibility, not for safety
            // against a race: see the threading note above.
            final MediaPlayer player = mMediaPlayer;
            if (player == null)
                return;

            // Auto-enter must only ever be armed while media is actually playing.
            switch (event.type) {
                case MediaPlayer.Event.Playing:
                case MediaPlayer.Event.Paused:
                case MediaPlayer.Event.Stopped:
                case MediaPlayer.Event.EndReached:
                    mPipController.setPlaying(
                            player != null && player.isPlaying());
                    break;
                default:
                    break;
            }

            switch (event.type) {

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Playing: {
                    mNativeStopped = false;
                    mEnded = false;

                    // FIX: clear seek suppression sentinel — VLC has confirmed
                    // actual playback at the new position.
                    if (pendingSeekPlay != null) {
                        pendingSeekPlay = null;
                        VlcLog.trace("VLC_EVENT", "Playing: cleared seek suppression sentinel");
                    }
                    mLastSeekPlayTimestampMs = -1L;
                    mPausedForAudioFocus = false;
                    mPausedForNoisyEvent = false;

                    VlcLog.trace("VLC_EVENT", "Playing | isPaused=" + isPaused + " pos=" + player.getPosition()
                            + " time=" + player.getTime() + " duration=" + player.getLength());
                    VlcLog.event("STATE", "playing at " + player.getTime() + "ms of "
                            + player.getLength() + "ms");
                    // Not resolved here: VLC pushes the start offset as an asynchronous
                    // input control, so the position at Playing is legitimately still 0.
                    // TimeChanged is where the answer actually becomes visible.


                    // If user intent is paused, suppress this transient Playing and re-pause.
                    if (isPaused) {
                        VlcLog.warn("VLC_EVENT", "Playing suppressed (user intent=paused) → re-pausing");
                        try {
                            if (player.isPlaying())
                                player.pause();
                        } catch (Exception ignored) {
                        }
                        setKeepScreenOn(false);
                        notifyMediaSession();
                        break;
                    }




                    // Force subtitle state
                    if (_textTrack == -1 && player.getSpuTracksCount() > 0) {
                        player.setSpuTrack(-1);
                    } else if (_textTrack != -1) {
                        player.setSpuTrack(_textTrack);
                    }

                    // Apply pending audio-track change after the player is in a stable playing state.
                    applyRequestedAudioTrack("playing");

                    // Re-apply audio delay. VLC drops it across a track change, so this
                    // and the ES handler are the two real reapplication points.
                    reapplyAudioDelay("playing");
                    applyRequestedRate("playing");

                    // Fallback: get video dimensions if onNewVideoLayout hasn't fired yet
                    if (mVideoWidth <= 0 || mVideoHeight <= 0) {
                        Media.VideoTrack videoTrack = player.getCurrentVideoTrack();
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
                    maybeCompletePendingEnhancementRecreate();
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

                    VlcLog.trace("VLC_EVENT", "Paused | isPaused=" + isPaused + " pos=" + player.getPosition()
                            + " time=" + player.getTime());

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
                    // Transitions only. VLC emits this continuously -- hundreds of samples
                    // a second -- which floods logcat and truncated the first device
                    // capture. Start and finish are what anyone reads it for.
                    final boolean bufferingNow = bufferRate < 100f;
                    if (VlcLog.tracing() && bufferingNow != mLastLoggedBuffering) {
                        mLastLoggedBuffering = bufferingNow;
                        VlcLog.trace("VLC_EVENT", bufferingNow
                                ? "Buffering started rate=" + bufferRate + "%"
                                : "Buffering complete");
                    }

                    // FIX (primary seek freeze): trigger play() when the buffer
                    // fills after a codec-flush seek, instead of using a fixed timer.
                    mIsBuffering = bufferRate < 100f;
                    if (bufferRate >= 100f && mPlayAfterBufferComplete && !isPaused) {
                        final long capturedVersion = mSeekVersion;
                        mPlayAfterBufferComplete = false;

                        // Post to main thread so VLC's state fully settles before play()
                        mSeekHandler.post(() -> {
                            // Re-reads the field instead of using the captured local. Not a
                            // threading matter: this body is posted, so it runs after the
                            // event has returned, and releasePlayer can have run in between.
                            // The version guard below would usually catch that, but relying
                            // on it alone would leave a released-player crash one refactor
                            // away.
                            final MediaPlayer current = mMediaPlayer;
                            if (current != null && !isPaused && mSeekVersion == capturedVersion) {
                                VlcLog.trace("SEEK", "buffer=100% -> resuming play");
                                mLastSeekPlayTimestampMs = System.currentTimeMillis();
                                requestAudioFocusInternal();
                                current.play();
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
                    VlcLog.event("STATE", "reached end");
                    VlcLog.trace("VLC_EVENT", "EndReached | pos=" + player.getPosition());
                    mNativeStopped = true;
                    mEnded = true;

                    // Emit final 100% progress so UI snaps to end
                    WritableMap progressMap = Arguments.createMap();
                    progressMap.putBoolean("isPlaying", false);
                    progressMap.putDouble("position", 1.0);
                    progressMap.putDouble("currentTime", player.getLength());
                    progressMap.putDouble("duration", player.getLength());
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
                    VlcLog.event("STATE", "error");
                    VlcLog.error("VLC_EVENT", "EncounteredError");
                    mNativeStopped = true;
                    mEnded = false;
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Error");
                    setKeepScreenOn(false);
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_ERROR);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                // Kept as trace only. These used to drive the position restore; resume
                // is now applied as VLC's :start-time when the media is opened, so
                // nothing waits on them. They remain useful when diagnosing a source
                // that reports itself unseekable or never publishes a length.
                case MediaPlayer.Event.SeekableChanged: {
                    VlcLog.trace("VLC_EVENT", "SeekableChanged seekable=" + event.getSeekable());
                    break;
                }

                case MediaPlayer.Event.LengthChanged: {
                    VlcLog.trace("VLC_EVENT", "LengthChanged length=" + event.getLengthChanged());
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                // An audio elementary stream appearing or being selected is the real
                // signal that the audio pipeline can accept a track choice and a delay.
                // This is what replaced the fixed 150 ms retries: changing a track
                // mid-playback produces no new Playing event, so before this the retry
                // was the only recovery path.
                case MediaPlayer.Event.ESAdded:
                case MediaPlayer.Event.ESSelected: {
                    if (event.getEsChangedType() == IMedia.Track.Type.Audio) {
                        VlcLog.trace("VLC_EVENT", (event.type == MediaPlayer.Event.ESAdded
                                ? "ESAdded" : "ESSelected")
                                + " audio id=" + event.getEsChangedID());

                        if (event.type == MediaPlayer.Event.ESSelected) {
                            // Observe the selection rather than trusting the cache. VLC
                            // also changes tracks on its own, and a stale cache would make
                            // the reconciliation below short-circuit against a track that
                            // is no longer selected. Any real change also means the audio
                            // delay was dropped, so that cache is invalidated with it.
                            try {
                                final int actualTrack = player.getAudioTrack();
                                if (actualTrack != currentlyAppliedAudioTrack) {
                                    VlcLog.trace("AUDIO_TRACK", "observed track=" + actualTrack
                                            + " (cache said " + currentlyAppliedAudioTrack + ")");
                                    currentlyAppliedAudioTrack = actualTrack;
                                    currentlyAppliedAudioDelayUs = Long.MIN_VALUE;
                                }
                            } catch (IllegalStateException e) {
                                VlcLog.warn("AUDIO_TRACK", "player released while observing selection");
                            }
                        }

                        applyRequestedAudioTrack("es");
                        reapplyAudioDelay("es");
                    }
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.TimeChanged:
                    // Progress is polled, but this is the cheapest reliable place to see
                    // whether a pending :start-time or a committed seek actually landed.
                    resolvePendingStartTime(player);
                    logSeekVerification();
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

    /**
     * Reports whether the last committed seek landed where it was asked to.
     *
     * <p>Called from TimeChanged rather than Playing, because Playing can arrive before the
     * seek has been honoured and verifying there compared the live position against the
     * previous seek's target.
     *
     * <p>Only verifies a seek that was not superseded. A position cannot be attributed to a
     * seek once a later one has been dispatched, and pretending otherwise is how this check
     * came to report transposed target/actual pairs as minutes of drift while every seek
     * was in fact landing correctly. A superseded seek is dropped silently: the newer one
     * is the only question worth answering.
     *
     * <p>Read, decide, act. The decision lives in {@link SeekVerifier} so it can be
     * exercised without a device; only the reading and the reporting need a player.
     */
    private void logSeekVerification() {
        final long targetMs = mLastSeekTargetMs;
        if (mMediaPlayer == null) {
            return;
        }

        long actualMs = -1L;
        try {
            actualMs = mMediaPlayer.getTime();
        } catch (IllegalStateException e) {
            // Leave actualMs negative; the verdict below decides what that means.
            VlcLog.trace("SEEK_VERIFY", "player unreadable while verifying");
        }

        switch (SeekVerifier.evaluate(targetMs, actualMs, mSeekVersion, mSeekVerifyVersion,
                SEEK_VERIFY_TOLERANCE_MS)) {
            case NOTHING_TO_VERIFY:
                return;

            case WAIT:
                // Keep the seek outstanding and judge it on a later position.
                return;

            case SUPERSEDED:
                clearSeekVerification();
                return;

            case ON_TARGET:
                clearSeekVerification();
                VlcLog.trace("SEEK_VERIFY", seekVerifyDetail(targetMs, actualMs));
                return;

            case DRIFTED:
                clearSeekVerification();
                VlcLog.event("SEEK_VERIFY", "drift: " + seekVerifyDetail(targetMs, actualMs));
                return;
        }
    }

    private void clearSeekVerification() {
        mLastSeekTargetMs = -1L;
        mSeekVerifyVersion = -1L;
    }

    private static String seekVerifyDetail(long targetMs, long actualMs) {
        return "target=" + targetMs + "ms actual=" + actualMs
                + "ms delta=" + Math.abs(actualMs - targetMs) + "ms";
    }

    /**
     * Resolves a pending {@code :start-time} against what VLC is actually playing.
     *
     * <p>Grounded in how VLC 3.x implements the option: {@code StartTitle()} reads it and
     * pushes INPUT_CONTROL_SET_TIME, so the offset arrives *after* the input has started.
     * A position of zero immediately after Playing therefore proves nothing, which is why
     * this deliberately does not report a failure there — an earlier version warned on
     * exactly that reading and the warning fired on every successful resume.
     *
     * <p>Three outcomes:
     * <ul>
     *   <li>within tolerance of the target — applied, stop tracking;</li>
     *   <li>still near the start — the control has not landed yet, keep waiting;</li>
     *   <li>played well past the start without ever approaching the target — the control
     *       was dropped, so issue one corrective seek. Playback is demonstrably running
     *       at this point, which is a real readiness signal rather than the elapsed-time
     *       guesses this code used to rely on.</li>
     * </ul>
     */
    private void resolvePendingStartTime(MediaPlayer player) {
        if (mPendingStartTimeSec <= 0d) {
            return;
        }

        final long actualMs;
        try {
            actualMs = player.getTime();
        } catch (IllegalStateException e) {
            VlcLog.warn("START_TIME", "player released before the offset resolved");
            return;
        }

        final long targetMs = Math.round(mPendingStartTimeSec * 1000d);
        final long deltaMs = Math.abs(actualMs - targetMs);
        final String detail = "target=" + targetMs + "ms actual=" + actualMs
                + "ms delta=" + deltaMs + "ms";

        // Read, decide, act. The decision lives in StartTimeResolver so it can be tested
        // without a device; only the reading and the acting need a player.
        switch (StartTimeResolver.evaluate(targetMs, actualMs, mStartTimeCorrectionIssued,
                START_TIME_PRECISION_MS, START_TIME_IGNORED_EVIDENCE_MS)) {
            case WAIT:
                return;

            case APPLIED:
                VlcLog.event("START_TIME", "applied " + detail
                        + " corrected=" + mStartTimeCorrectionIssued);
                setPendingStartTime(0d, "applied");
                return;

            case CORRECT_PRECISION:
                // Honoured but short of the target. Playback is demonstrably running, so a
                // seek is safe here in a way it never was during startup.
                VlcLog.event("START_TIME", "landed " + deltaMs + "ms early (" + detail
                        + "); correcting once");
                mStartTimeCorrectionIssued = true;
                seekForStartTimeCorrection(player, targetMs, "precision");
                return;

            case CORRECT_DROPPED:
                VlcLog.warn("START_TIME", ":start-time was dropped by VLC (" + detail
                        + "); correcting with one seek");
                mStartTimeCorrectionIssued = true;
                seekForStartTimeCorrection(player, targetMs, "dropped");
                return;

            case ABANDON:
                VlcLog.warn("START_TIME", "abandoned after corrective seek; " + detail);
                setPendingStartTime(0d, "abandoned");
                return;
        }
    }

    private void seekForStartTimeCorrection(MediaPlayer player, long targetMs, String reason) {
        try {
            player.setTime(targetMs);
        } catch (IllegalStateException e) {
            VlcLog.warn("START_TIME", "player released during " + reason + " correction");
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

    private static double readStartTime(ReadableMap source) {
        if (source == null || !source.hasKey("startTime") || source.isNull("startTime")) {
            return 0d;
        }
        final double value = source.getDouble("startTime");
        return value > 0d && !Double.isInfinite(value) && !Double.isNaN(value) ? value : 0d;
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
                    + " startTime=" + mPendingStartTimeSec + "s");

            // Enhancement is always composed natively. Explicit overrides are only
            // used for a specific in-flight enhancement recreate target.
            if (mEffectiveInitOptionsOverride != null) {
                cOptions.addAll(mEffectiveInitOptionsOverride);
                VlcLog.trace("CREATE_PLAYER", "using enhancement init options override (" + cOptions.size() + " options)");
            } else {
                cOptions.addAll(buildEffectiveInitOptions(mRequestedEnhancement));
            }
            mEnhancementCompatiblePipeline = shouldUseEnhancementCompatiblePipeline(mRequestedEnhancement);

            // The source setter, a release, an enhancement recreate, or a stopped seek
            // owns this single pending intent. Creating a Java player does not prove that
            // VLC opened the media at the offset, so it remains pending until an event
            // confirms the actual time.
            final double startTimeSec = mPendingStartTimeSec;
            if (startTimeSec > 0d) {
                VlcLog.trace("CREATE_PLAYER", "opening at startTime=" + startTimeSec + "s");
            }
            VlcPlaybackEngine.Source engineSource = new VlcPlaybackEngine.Source(
                    uriString, isNetwork, initType, cOptions,
                    mediaOptions != null ? toStringList(mediaOptions) : null,
                    hwDecoderEnabled >= 1, hwDecoderForced >= 1, mAudioDelay, startTimeSec);

            final MediaPlayer openedPlayer = mEngine.open(getContext(), engineSource, mPlayerListener, mMediaListener,
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

            if (openedPlayer == null) {
                // The pending offset is deliberately left intact so a retry still resumes.
                VlcLog.event("PLAYER", "open FAILED (offset retained)");
                VlcLog.error("CREATE_PLAYER", "engine could not open " + uriString
                        + " (startTime=" + startTimeSec + "s retained for retry)");
                return;
            }
            mMediaPlayer = openedPlayer;
            VlcLog.event("PLAYER", "created autoplay=" + autoplay + " isResume=" + isResume
                    + " startTime=" + startTimeSec + "s");

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
            // Reset terminal state only after releasePlayer has had the opportunity to
            // distinguish EOF (discard) from an ordinary stop/error (retain).
            mNativeStopped = false;
            mEnded = false;

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

            reapplyAudioDelay("create-player");

            if (!vlcOut.areViewsAttached()) {
                vlcOut.addCallback(callback);
                vlcOut.setVideoSurface(this.getSurfaceTexture());
                vlcOut.attachViews(onNewVideoLayoutListener);
            }

            boolean shouldPlay = isResume ? autoplayResume : autoplay;

            if (shouldPlay) {
                isPaused = false;
                if (requestAudioFocusInternal())
                    mMediaPlayer.play();
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
        if (mMediaPlayer != null) {
            VlcLog.event("PLAYER", "releasing");
        }
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
                // Saved in seconds while the length is still available. The fraction this
                // used to store had to be multiplied by a length the next player did not
                // have yet.
                final float currentPos = mMediaPlayer.getPosition();
                final long currentTimeMs = mMediaPlayer.getTime();
                final long durationMs = mMediaPlayer.getLength();
                // An unconfirmed start is newer than VLC's reported time and must survive
                // errors/recreates. Once confirmed, save a real mid-media position. Only
                // EOF intentionally discards the outgoing position.
                if (mPendingStartTimeSec > 0d) {
                    VlcLog.trace("RELEASE", "retaining unconfirmed startTime="
                            + mPendingStartTimeSec + "s");
                } else if (!mEnded
                        && currentTimeMs > RESUME_EDGE_GUARD_MS
                        && (durationMs <= 0L
                            || currentTimeMs < durationMs - RESUME_EDGE_GUARD_MS)) {
                    setPendingStartTime(currentTimeMs / 1000d, "release-save");
                } else {
                    VlcLog.trace("RELEASE", "NOT saving position=" + currentPos
                            + " timeMs=" + currentTimeMs
                            + " durationMs=" + durationMs
                            + " ended=" + mEnded
                            + " (keeping startTime=" + mPendingStartTimeSec + "s)");
                }
            } catch (Exception e) {
                VlcLog.warn("RELEASE", "could not read position; retaining startTime="
                        + mPendingStartTimeSec + "s");
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
        currentlyAppliedAudioDelayUs = Long.MIN_VALUE;
        mBestFitUsingCover = null;
        mPlayAfterBufferComplete = false;
        mLastSeekPlayTimestampMs = -1L;
        if (mPendingAudioTrackRunnable != null) {
            mAudioTrackHandler.removeCallbacks(mPendingAudioTrackRunnable);
            mPendingAudioTrackRunnable = null;
        }
        if (mPendingRateRunnable != null) {
            mRateHandler.removeCallbacks(mPendingRateRunnable);
            mPendingRateRunnable = null;
        }
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
     * target in mPendingStartTimeSec so createPlayer() opens the new media at that offset.
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
        if (position < 0 || position > 1) {
            VlcLog.warn("SEEK", "setPosition(" + position + ") — out of range, ignoring");
            return;
        }

        VlcLog.event("SEEK", "requested position=" + String.format(java.util.Locale.US, "%.4f", position));
        // Explicit user intent supersedes any watch-history or retry offset immediately.
        setPendingStartTime(0d, "user-seek");
        mEnded = false;
        if (mMediaPlayer == null) {
            VlcLog.warn("SEEK", "setPosition(" + position
                    + ") — player is null; pending source resume cleared");
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
                // targetMs is already resolved here, so hand createPlayer seconds rather
                // than a fraction it would have to re-multiply by a length it has not got.
                setPendingStartTime(targetMs > 0 ? targetMs / 1000d : 0d, "stopped-revive");
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

            mSeekVerifyVersion = thisSeekVersion;
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
        // A different string source starts at its own beginning.
        setPendingStartTime(0d, "new-string-source");
        mEnded = false;
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
        final boolean srcIsNetwork = newUri != null
                && (newUri.startsWith("http") || newUri.startsWith("rtsp"));
        VlcLog.event("SOURCE", "opened kind="
                + (srcIsNetwork ? "network" : newUri != null && newUri.startsWith("content://")
                        ? "content" : "file")
                + " resumeFrom=" + readStartTime(src) + "s");
        this.src = newUri;
        this.srcMap = src;
        releasePlayer();
        // Copy the source offset into native-owned pending intent once. Recreates never
        // re-read srcMap, so confirmed history cannot reappear later in the session.
        setPendingStartTime(readStartTime(src), "source");
        mEnded = false;
        createPlayer(true, false);
    }

    public void setRateModifier(float rateModifier) {
        if (Math.abs(rateModifier - mRequestedRate) > 0.001f) {
            VlcLog.event("RATE", "requested " + rateModifier + "x (was " + mRequestedRate + "x)");
        }
        mRequestedRate = rateModifier;
        if (mMediaPlayer != null) {
            if (mPendingRateRunnable != null) {
                mRateHandler.removeCallbacks(mPendingRateRunnable);
            }
            mPendingRateRunnable = () -> {
                mPendingRateRunnable = null;
                applyRequestedRate("prop");
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
        if (delayMs != mAudioDelay) {
            VlcLog.event("AUDIO_DELAY", "changed to " + delayMs + "ms (was " + mAudioDelay + "ms)");
        }
        mAudioDelay = delayMs;
        VlcLog.trace("AUDIO_DELAY", "set=" + delayMs + "ms");
        if (mMediaPlayer == null) {
            VlcLog.trace("AUDIO_DELAY", "no player yet — applied on createPlayer");
            return;
        }
        // One application. The former second call 150 ms later re-sent the same value
        // unconditionally, ignored both its own result and the first one, and stacked an
        // uncancellable Handler per change. Anything that can actually invalidate the
        // delay -- a track change or a player recreate -- now reasserts it on the real
        // event instead of being guessed at.
        // A newly requested value must always reach VLC, so drop the applied marker.
        currentlyAppliedAudioDelayUs = Long.MIN_VALUE;
        reapplyAudioDelay("prop");
    }

    public void setVolumeModifier(int volumeModifier) {
        int clamped = Math.max(0, Math.min(200, volumeModifier));
        this.preVolume = clamped;
        // VlcLog.trace("VOLUME", "set=" + clamped);
        if (mMediaPlayer != null)
            mMediaPlayer.setVolume(clamped);
    }

    public void setMutedModifier(boolean muted) {
        if (muted != mMuted) {
            VlcLog.event("MUTE", muted ? "muted" : "unmuted");
        }
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
     * paused=false + ended → createPlayer from the beginning
     * paused=false + another stopped state → createPlayer from the pending/current offset
     * paused=false + player exists → mMediaPlayer.play()
     * paused=false + no player → createPlayer
     */
    public void setPausedModifier(boolean paused) {
        if (paused != isPaused) {
            VlcLog.event("INTENT", (paused ? "pause" : "play")
                    + " (was " + (isPaused ? "paused" : "playing")
                    + ", hasPlayer=" + (mMediaPlayer != null) + ")");
        }
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
            if (mNativeStopped || mEnded) {
                VlcLog.trace("PAUSE_MOD", "terminal player → createPlayer ended=" + mEnded
                        + " pendingStart=" + mPendingStartTimeSec + "s");
                isPaused = false;
                // EOF alone means replay. Errors and explicit stops keep their retry
                // position; releasePlayer also knows not to save an EOF position.
                if (mEnded) {
                    setPendingStartTime(0d, "replay-from-end");
                }
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
        VlcLog.event("LIFECYCLE", "doResume autoplay=" + autoplay);
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
        if (track != _audioTrack) {
            VlcLog.event("AUDIO_TRACK", "requested track=" + track + " (was " + _audioTrack + ")");
        }
        VlcLog.trace("AUDIO_TRACK", "set=" + track);
        _audioTrack = track;
        scheduleAudioTrackApply();
    }

    public void setTextTrack(int track) {
        if (track != _textTrack) {
            VlcLog.event("SUBTITLE", "track=" + (track == -1 ? "off" : String.valueOf(track))
                    + " (was " + (_textTrack == -1 ? "off" : String.valueOf(_textTrack)) + ")");
        }
        VlcLog.trace("TEXT_TRACK", "set=" + track);
        _textTrack = track;
        if (mMediaPlayer != null)
            mMediaPlayer.setSpuTrack(track);
    }

    /**
     * Stop playback. Idempotent.
     *
     * <p>Leaving a player screen runs three stop paths in JavaScript — the back handler,
     * navigation's {@code beforeRemove}, and unmount cleanup — which is why every stop was
     * journalled twice. Guarding here rather than deleting one of those callers is
     * deliberate: they are not redundant with each other (an external-open Activity
     * finishes without a navigation transition), and the guard covers callers that are not
     * JavaScript at all, such as the media session.
     */
    public void stopPlayer() {
        if (mMediaPlayer == null)
            return;
        // Unconditional: focus abandonment is idempotent on its own and must not be
        // skipped for a player already in a terminal state after EOF.
        abandonAudioFocusInternal();
        if (mNativeStopped) {
            VlcLog.trace("STOP", "stopPlayer() ignored — already stopped");
            return;
        }
        VlcLog.event("INTENT", "stop");
        VlcLog.trace("STOP", "stopPlayer()");
        mNativeStopped = true;
        mEnded = false;
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
        if (pipEnabled != this.mPipEnabled) {
            VlcLog.event("PIP", "eligibility " + (pipEnabled ? "enabled" : "disabled"));
        }
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
        VlcLog.event("PIP", inPipMode ? "entered PiP window" : "left PiP window");
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

        if (!Objects.equals(prev, this.resizeMode)) {
            VlcLog.event("RESIZE", "mode=" + this.resizeMode + " (was " + prev + ")");
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

    /** Capture the only recreate state not already owned by a live field. */
    private long capturePlaybackTimeMs() {
        if (mMediaPlayer == null) {
            VlcLog.warn("ENHANCE", "capturePlaybackTimeMs: no player loaded");
            return -1L;
        }

        try {
            return mMediaPlayer.getTime();
        } catch (Exception e) {
            VlcLog.warn("ENHANCE", "capturePlaybackTimeMs: " + e.getMessage());
            return -1L;
        }
    }

    /**
     * Entry point from React prop. Coalesces rapid toggles via debounce.
     */
    public void setVideoEnhancement(boolean enabled) {
        if (enabled != mRequestedEnhancement) {
            VlcLog.event("ENHANCE", "requested " + (enabled ? "on" : "off"));
        }
        mRequestedEnhancement = enabled;

        // Prefer the live LibVLC adjust path to avoid player recreation and the
        // black-frame gap. Recreate remains as a fallback if the bridge is unavailable.
        if (!mEnhancementRecreateInFlight && applyVideoEnhancementLive(enabled)) {
            // Only when it changed something: React re-sends this prop, and the live adjust
            // is idempotent, so an unguarded line logged the same application twice.
            if (enabled != mAppliedEnhancement) {
                VlcLog.event("ENHANCE", "applied live (no recreate), enhancement="
                        + (enabled ? "on" : "off"));
            }
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

        final long timeMs = capturePlaybackTimeMs();
        if (timeMs < 0L) {
            // No player loaded — enhancement will be applied on next createPlayer
            return;
        }

        // Mark in-flight
        mEnhancementRecreateInFlight = true;
        mPendingEnhancementTarget = mRequestedEnhancement;

        applyEnhancementWithRecreate(mRequestedEnhancement, generation, timeMs);
    }

    /**
     * Perform the enhancement recreate with a specific target state and generation.
     */
    private void applyEnhancementWithRecreate(boolean targetEnhancement, long generation,
                                               long timeMs) {
        // Build new init options with explicit target (not mRequestedEnhancement)
        ArrayList<String> effectiveOptions = buildEffectiveInitOptions(targetEnhancement);

        // The captured value already holds the position in milliseconds, so the old
        // divide-by-length-then-multiply-by-length round trip is gone, along with its
        // dependence on the outgoing player still reporting a length.
        if (timeMs > 0) {
            setPendingStartTime(timeMs / 1000d, "enhance-recreate");
        }

        final boolean autoplay = !isPaused;

        // Release and recreate with new options
        // We override the init options by temporarily adjusting how createPlayer reads them
        releasePlayer();

        // Create player with effective options — we override the initOptions that
        // createPlayer normally reads from srcMap by using a wrapper approach.
        // Since createPlayer reads initOptions from srcMap, we need to build cOptions
        // with our effective options. We achieve this by storing them and using them
        // in createPlayer when it checks initOptions.
        mEffectiveInitOptionsOverride = effectiveOptions;
        createPlayer(autoplay, true);
        mEffectiveInitOptionsOverride = null;

        // Safety net behind the real path, which is the Playing event calling
        // maybeCompletePendingEnhancementRecreate(). Logged as a warning because if it
        // ever fires the event path did not, and this timer is load-bearing after all --
        // which is the measurement tracker section 8.3 asks for before removing it.
        final long restoreGeneration = generation;
        clearPendingEnhancementRestoreRunnable();
        mPendingEnhancementRestoreRunnable = new Runnable() {
            @Override
            public void run() {
                if (mPendingEnhancementRestoreRunnable == this) {
                    mPendingEnhancementRestoreRunnable = null;
                }
                if (mEnhancementGeneration == restoreGeneration && mEnhancementRecreateInFlight) {
                    VlcLog.warn("ENHANCE", "restore fell through to the "
                            + ENHANCEMENT_RESTORE_TIMEOUT_MS + "ms safety timer — the Playing"
                            + " event did not arrive, so this timer is still required");
                    completeEnhancementRecreate(restoreGeneration, targetEnhancement);
                }
            }
        };
        mEnhancementHandler.postDelayed(mPendingEnhancementRestoreRunnable,
                ENHANCEMENT_RESTORE_TIMEOUT_MS);
    }

    /** Finish bookkeeping after createPlayer and the normal event-owned restoration paths. */
    private void completeEnhancementRecreate(long generation, boolean targetEnhancement) {
        // Stale generation check
        if (generation != mEnhancementGeneration) {
            return;
        }

        if (!mEnhancementRecreateInFlight) {
            return;
        }

        if (mMediaPlayer == null) {
            VlcLog.warn("ENHANCE", "completeEnhancementRecreate: no player, skipping");
            return;
        }

        // createPlayer owns mute, subtitle slave and equalizer. Playing/ES events own
        // rate, tracks and audio delay. Reapplying any of them here used to duplicate
        // work and, for external subtitles, create a second slave track.
        clearPendingEnhancementRestoreRunnable();

        // Mark enhancement as applied
        VlcLog.event("ENHANCE", "recreate complete, enhancement="
                + (targetEnhancement ? "on" : "off"));
        mAppliedEnhancement = targetEnhancement;
        mEnhancementRecreateInFlight = false;

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
        clearPendingEnhancementRestoreRunnable();
        invalidatePendingEnhancementCallbacks();
    }

    private void clearPendingEnhancementRestoreRunnable() {
        if (mPendingEnhancementRestoreRunnable != null) {
            mEnhancementHandler.removeCallbacks(mPendingEnhancementRestoreRunnable);
            mPendingEnhancementRestoreRunnable = null;
        }
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

        maybeCompletePendingEnhancementRecreate();
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

    private void scheduleAudioTrackApply() {
        if (mPendingAudioTrackRunnable != null) {
            mAudioTrackHandler.removeCallbacks(mPendingAudioTrackRunnable);
        }

        final Runnable applyRunnable = new Runnable() {
            @Override
            public void run() {
                applyRequestedAudioTrack("prop");
                if (mPendingAudioTrackRunnable == this) {
                    mPendingAudioTrackRunnable = null;
                }
            }
        };

        mPendingAudioTrackRunnable = applyRunnable;
        mAudioTrackHandler.post(applyRunnable);
    }

    /**
     * Applies the requested audio track if it is not already applied.
     *
     * Idempotent and safe to call from any thread that VLC delivers events on. There is
     * no retry: a failure leaves the request pending in _audioTrack, and the next real
     * ESAdded/ESSelected or Playing event calls this again. That is the whole point of
     * the change -- a fixed 150 ms retry guessed when the audio pipeline would be ready,
     * ignored its own result, and had no answer if 150 ms was not enough.
     */
    private boolean applyRequestedAudioTrack(String reason) {
        final MediaPlayer player = mMediaPlayer;
        final int requestedTrack = _audioTrack;

        if (player == null || requestedTrack == -1) {
            return false;
        }

        if (requestedTrack == currentlyAppliedAudioTrack) {
            return true;
        }

        // Claim the track before asking VLC for it. setAudioTrack makes VLC emit
        // ESSelected, which routes straight back here on the main thread; without the
        // claim that event would see an unapplied track and select it again, forever.
        currentlyAppliedAudioTrack = requestedTrack;
        boolean applied;
        try {
            applied = player.setAudioTrack(requestedTrack);
        } catch (IllegalStateException e) {
            // The player was released underneath us; the request stays pending.
            currentlyAppliedAudioTrack = -1;
            VlcLog.warn("AUDIO_TRACK", "player released during apply, reason=" + reason);
            return false;
        }

        if (applied) {
            VlcLog.event("AUDIO_TRACK", "applied track=" + requestedTrack + " via " + reason);
            VlcLog.trace("AUDIO_TRACK", "applied track=" + requestedTrack + " reason=" + reason);
            // VLC resets the audio delay when the track changes, so it must be
            // reasserted against the new track rather than assumed to survive.
            currentlyAppliedAudioDelayUs = Long.MIN_VALUE;
            reapplyAudioDelay("audio-track");
            return true;
        }

        // Release the claim so the next real event retries instead of short-circuiting.
        currentlyAppliedAudioTrack = -1;
        VlcLog.warn("AUDIO_TRACK", "apply failed for track=" + requestedTrack
                + " reason=" + reason + " — will retry on the next ES/Playing event");
        return false;
    }

    /**
     * Reasserts the requested playback rate on the current player.
     *
     * <p>Called from Playing, when VLC has an active input. Calling this while merely
     * constructing a player and then caching the issued command made the Playing fallback
     * skip even though LibVLC's void setter provided no evidence that the rate stuck.
     */
    private void applyRequestedRate(String reason) {
        final MediaPlayer player = mMediaPlayer;
        if (player == null || Float.isNaN(mRequestedRate) || mRequestedRate <= 0f) {
            return;
        }
        try {
            player.setRate(mRequestedRate);
            VlcLog.trace("RATE", "requested=" + mRequestedRate + "x actual=" + player.getRate()
                    + " reason=" + reason);
            notifyMediaSession();
        } catch (IllegalStateException e) {
            VlcLog.warn("RATE", "player released during apply, reason=" + reason);
        }
    }

    /**
     * Reasserts the configured audio delay. VLC drops it across a track change and a
     * player recreate, so it is reapplied on the events where that can have happened
     * rather than a fixed time after the request.
     */
    private void reapplyAudioDelay(String reason) {
        final MediaPlayer player = mMediaPlayer;
        if (player == null) {
            return;
        }
        final long delayUs = mAudioDelay * 1000;
        // Idempotent. A single source start delivers one ESSelected and several ESAdded
        // within a few milliseconds, and without this guard each one re-sent the same
        // value -- the device trace showed eight setAudioDelay calls in 60 ms.
        if (delayUs == currentlyAppliedAudioDelayUs) {
            return;
        }
        try {
            boolean ok = player.setAudioDelay(delayUs);
            if (ok) {
                // Recorded only when VLC accepted it. At createPlayer time there is no
                // media yet and this returns false, which is exactly why the ES events
                // are the real application point.
                currentlyAppliedAudioDelayUs = delayUs;
            }
            VlcLog.trace("AUDIO_DELAY", "reapplied " + mAudioDelay + "ms reason=" + reason + " ok=" + ok);
        } catch (IllegalStateException e) {
            VlcLog.warn("AUDIO_DELAY", "player released during reapply, reason=" + reason);
        }
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
