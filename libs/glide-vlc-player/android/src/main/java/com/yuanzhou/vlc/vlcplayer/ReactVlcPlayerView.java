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
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Objects;
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
import android.os.Build;

@SuppressLint("ViewConstructor")
class ReactVlcPlayerView extends TextureView implements
        LifecycleEventListener,
        TextureView.SurfaceTextureListener,
        AudioManager.OnAudioFocusChangeListener {

    // =========================================================================
    // Constants
    // =========================================================================

    private static final String TAG = "ReactVlcPlayerView";

    private static final String NOTIFICATION_CHANNEL_ID = "vlc_media_player_channel";
    private static final int NOTIFICATION_ID = 1001;

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
    private static final int RESIZE_DEBOUNCE_MS = 100;

    // Best-fit thresholds (hysteresis)
    private static final float BEST_FIT_ENTER_CROP_RATIO = 0.06f;
    private static final float BEST_FIT_EXIT_CROP_RATIO = 0.10f;
    private static final float BEST_FIT_ENTER_BAR_RATIO = 0.05f;
    private static final float BEST_FIT_EXIT_BAR_RATIO = 0.08f;

    // =========================================================================
    // Fields — all VLC-thread-accessible fields must be volatile
    // =========================================================================

    private final VideoEventEmitter eventEmitter;
    private final ThemedReactContext themedReactContext;
    private final AudioManager audioManager;

    // Player instances
    private LibVLC libvlc;
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
    private String resizeMode = "contain";
    private long mAudioDelay = 0;

    // Video dimensions
    private int mVideoHeight = 0;
    private int mVideoWidth = 0;
    private int mVideoVisibleHeight = 0;
    private int mVideoVisibleWidth = 0;
    private int mSarNum = 0;
    private int mSarDen = 0;
    private int mLastViewWidth = 0;
    private int mLastViewHeight = 0;
    private Boolean mBestFitUsingCover = null;

    // Playback state — volatile because VLC events arrive on VLC's internal thread
    private volatile boolean isPaused = true;
    private volatile boolean mNativeStopped = true;
    private boolean isHostPaused = false;
    private boolean isInPipMode = false;
    private boolean wasPlayingBeforeHostPause = false;
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
    private ParcelFileDescriptor currentPfd = null;

    // Cached equalizer instance — reused rather than re-allocated on every call
    private MediaPlayer.Equalizer mEqualizer = null;
    private float[] mEqualizerBands = null;
    private float mLastAppliedRate = Float.NaN;

    // Guard against concurrent createPlayer() calls
    private volatile boolean mCreatingPlayer = false;

    // Guard against double cleanUpResources()
    private boolean mCleaned = false;

    // When non-null, createPlayer uses these instead of reading initOptions from srcMap.
    // Set temporarily by applyEnhancementWithRecreate().
    private ArrayList<String> mEffectiveInitOptionsOverride = null;

    // ─── MEDIA SESSION ───────────────────────────────────────────────────────

    private MediaSessionCompat mMediaSession;
    private NotificationManagerCompat mNotificationManager;
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
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        cleanUpResources();
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    @Override
    public void onHostResume() {
        Log.d(TAG, "[LIFECYCLE] onHostResume | isSurfaceViewDestroyed=" + isSurfaceViewDestroyed
                + " wasPlayingBeforeHostPause=" + wasPlayingBeforeHostPause
                + " isHostPaused=" + isHostPaused
                + " isPaused=" + isPaused);

        if (mMediaPlayer != null && (isSurfaceViewDestroyed || wasPlayingBeforeHostPause) && isHostPaused) {
            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            if (!vlcOut.areViewsAttached()) {
                vlcOut.attachViews(onNewVideoLayoutListener);
                isSurfaceViewDestroyed = false;
                Log.d(TAG, "[LIFECYCLE] onHostResume: re-attached VLC views");
            }
            // FIX C2: only resume if user intent is to play (isPaused tracks explicit user
            // intent)
            if (wasPlayingBeforeHostPause && !isPaused) {
                if (requestAudioFocusInternal()) {
                    mMediaPlayer.play();
                    Log.i(TAG, "[LIFECYCLE] onHostResume: resumed playback");
                }
            }
        }
        isHostPaused = false;
    }

    @Override
    public void onHostPause() {
        wasPlayingBeforeHostPause = (mMediaPlayer != null && mMediaPlayer.isPlaying()) || !isPaused;
        isHostPaused = true;

        Log.d(TAG, "[LIFECYCLE] onHostPause | wasPlaying=" + wasPlayingBeforeHostPause
                + " playInBackground=" + playInBackground);

        boolean currentIsInPipMode = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                android.app.Activity activity = themedReactContext.getCurrentActivity();
                if (activity != null)
                    currentIsInPipMode = activity.isInPictureInPictureMode();
            } catch (Exception e) {
                Log.w(TAG, "[LIFECYCLE] Failed to check PIP mode: " + e.getMessage());
            }
        }
        this.isInPipMode = currentIsInPipMode;

        if (!playInBackground && !currentIsInPipMode) {
            if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                isPaused = true;
                mMediaPlayer.pause();
                emitPausedEvent(Arguments.createMap());
                Log.i(TAG, "[LIFECYCLE] onHostPause: paused (background)");
            }
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean newIsInPipMode = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                android.app.Activity activity = themedReactContext.getCurrentActivity();
                if (activity != null)
                    newIsInPipMode = activity.isInPictureInPictureMode();
            } catch (Exception ignored) {
            }
        }
        if (this.isInPipMode && !newIsInPipMode) {
            if (isHostPaused && !playInBackground) {
                Log.i(TAG, "[LIFECYCLE] PiP exit → background → pausing");
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

    // =========================================================================
    // Surface callbacks
    // =========================================================================

    IVLCVout.Callback callback = new IVLCVout.Callback() {
        @Override
        public void onSurfacesCreated(IVLCVout ivlcVout) {
            isSurfaceViewDestroyed = false;
            Log.d(TAG, "[SURFACE] onSurfacesCreated");
        }

        @Override
        public void onSurfacesDestroyed(IVLCVout ivlcVout) {
            isSurfaceViewDestroyed = true;
            Log.d(TAG, "[SURFACE] onSurfacesDestroyed | isHostPaused=" + isHostPaused + " playInBackground="
                    + playInBackground);

            if (isHostPaused && !playInBackground) {
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    isPaused = true;
                    mMediaPlayer.pause();
                    emitPausedEvent(Arguments.createMap());
                    Log.i(TAG, "[SURFACE] paused playback on surface destroy");
                }
            }
        }
    };

    // =========================================================================
    // Audio Focus
    // =========================================================================

    @Override
    public void onAudioFocusChange(int focusChange) {
        Log.d(TAG, "[AUDIO_FOCUS] change=" + focusChange);
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_GAIN:
                mHasAudioFocus = true;
                registerNoisyReceiver();
                if (mMediaPlayer != null) {
                    if (mVolumeBeforeDuck >= 0) {
                        mMediaPlayer.setVolume(mVolumeBeforeDuck);
                        mVolumeBeforeDuck = -1;
                    }
                    if (mResumeOnFocusGain) {
                        boolean allowResume = !isHostPaused || playInBackground || isInPipMode;
                        if (allowResume) {
                            isPaused = false;
                            mMediaPlayer.play();
                            setKeepScreenOn(true);
                            Log.i(TAG, "[AUDIO_FOCUS] GAIN → resumed playback");
                            WritableMap map = createEventMap();
                            if (map != null)
                                emitPlayingEvent(map);
                        } else {
                            Log.i(TAG, "[AUDIO_FOCUS] GAIN -> host paused, background disabled; skip resume");
                        }
                    }
                }
                mResumeOnFocusGain = false;
                break;

            case AudioManager.AUDIOFOCUS_LOSS:
                mHasAudioFocus = false;
                mResumeOnFocusGain = false;
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    isPaused = true;
                    mMediaPlayer.pause();
                    setKeepScreenOn(false);
                    Log.i(TAG, "[AUDIO_FOCUS] LOSS → paused");
                    WritableMap map = createEventMap();
                    if (map != null)
                        emitPausedEvent(map);
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if (mMediaPlayer != null) {
                    mResumeOnFocusGain = mMediaPlayer.isPlaying();
                    if (mMediaPlayer.isPlaying()) {
                        isPaused = true;
                        mMediaPlayer.pause();
                        setKeepScreenOn(false);
                        Log.i(TAG, "[AUDIO_FOCUS] LOSS_TRANSIENT → paused");
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
                    Log.d(TAG, "[AUDIO_FOCUS] DUCK → volume set to 30%");
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
                            isPaused = true;
                            mResumeOnFocusGain = false;
                            mMediaPlayer.pause();
                            setKeepScreenOn(false);
                            Log.i(TAG, "[NOISY] headphones disconnected → paused");
                            WritableMap map = createEventMap();
                            if (map != null)
                                emitPausedEvent(map);
                        }
                    }
                }
            };
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            themedReactContext.registerReceiver(mNoisyReceiver, filter);
            Log.d(TAG, "[NOISY] receiver registered");
        } catch (Exception e) {
            Log.e(TAG, "[NOISY] register error: " + e.getMessage());
        }
    }

    private void unregisterNoisyReceiver() {
        if (mNoisyReceiver != null) {
            try {
                themedReactContext.unregisterReceiver(mNoisyReceiver);
                mNoisyReceiver = null;
                Log.d(TAG, "[NOISY] receiver unregistered");
            } catch (Exception e) {
                Log.e(TAG, "[NOISY] unregister error: " + e.getMessage());
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
                Log.d(TAG, "[AUDIO_FOCUS] request GRANTED");
            } else if (result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED) {
                mHasAudioFocus = false;
                mResumeOnFocusGain = true;
                Log.i(TAG, "[AUDIO_FOCUS] request DELAYED — will resume on gain");
                return false;
            } else {
                mHasAudioFocus = false;
                mResumeOnFocusGain = false;
                Log.w(TAG, "[AUDIO_FOCUS] request FAILED result=" + result);
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
        Log.d(TAG, "[AUDIO_FOCUS] abandoned");
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
                    Log.d(TAG, "[LAYOUT] size changed → " + width + "x" + height);
                    mLastViewWidth = width;
                    mLastViewHeight = height;
                    if (mMediaPlayer != null)
                        requestResizeMode();
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
        Log.d(TAG, "[EVENT] → Paused");
        eventEmitter.sendEvent(eventMap, VideoEventEmitter.EVENT_ON_PAUSED);
    }

    private void emitPlayingEvent(WritableMap map) {
        WritableMap eventMap = map != null ? map : Arguments.createMap();
        eventMap.putString("type", "Playing");
        if (isPaused) {
            Log.d(TAG, "[EVENT] Playing suppressed — isPaused=true (user intent)");
            return;
        }
        Log.d(TAG, "[EVENT] → Playing");
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
            Log.w(TAG, "[ENHANCE] live apply failed: " + e.getMessage());
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

            switch (event.type) {

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Playing: {
                    mNativeStopped = false;

                    // FIX: clear seek suppression sentinel — VLC has confirmed
                    // actual playback at the new position.
                    if (pendingSeekPlay != null) {
                        pendingSeekPlay = null;
                        Log.d(TAG, "[VLC_EVENT] Playing: cleared seek suppression sentinel");
                    }
                    mLastSeekPlayTimestampMs = -1L;

                    Log.i(TAG, "[VLC_EVENT] Playing | isPaused=" + isPaused + " pos=" + mMediaPlayer.getPosition()
                            + " time=" + mMediaPlayer.getTime() + " duration=" + mMediaPlayer.getLength());

                    // If user intent is paused, suppress this transient Playing and re-pause.
                    if (isPaused) {
                        Log.w(TAG, "[VLC_EVENT] Playing suppressed (user intent=paused) → re-pausing");
                        try {
                            if (mMediaPlayer.isPlaying())
                                mMediaPlayer.pause();
                        } catch (Exception ignored) {
                        }
                        setKeepScreenOn(false);
                        updatePlayPauseState(PlaybackStateCompat.STATE_PAUSED);
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

                    // Apply audio track only if changed (avoids decoder re-init silence)
                    if (_audioTrack != -1 && _audioTrack != currentlyAppliedAudioTrack) {
                        mMediaPlayer.setAudioTrack(_audioTrack);
                        currentlyAppliedAudioTrack = _audioTrack;
                        Log.d(TAG, "[VLC_EVENT] Playing: set audio track=" + _audioTrack);
                    }

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
                            Log.i(TAG, "[VLC_EVENT] Playing: fallback dimensions=" + mVideoWidth + "x" + mVideoHeight);
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
                    updateMediaMetadata();
                    updatePlayPauseState(PlaybackStateCompat.STATE_PLAYING);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Paused: {
                    mNativeStopped = false;

                    // Suppress Paused events during a codec-flush seek cycle.
                    // pendingSeekPlay (non-null sentinel) means we are between
                    // pause()+setTime() and the subsequent play() call.
                    if (pendingSeekPlay != null) {
                        Log.d(TAG, "[VLC_EVENT] Paused suppressed — codec flush in progress");
                        break;
                    }

                    // FIX S1/Bug2: suppress stale Paused events that can arrive
                    // shortly after the seek-triggered play() call fires.
                    if (mLastSeekPlayTimestampMs > 0 && System.currentTimeMillis()
                            - mLastSeekPlayTimestampMs < POST_SEEK_PAUSED_SUPPRESSION_MS) {
                        Log.d(TAG, "[VLC_EVENT] Paused suppressed — post-seek suppression window");
                        break;
                    }
                    mLastSeekPlayTimestampMs = -1L;

                    Log.i(TAG, "[VLC_EVENT] Paused | isPaused=" + isPaused + " pos=" + mMediaPlayer.getPosition()
                            + " time=" + mMediaPlayer.getTime());

                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    setKeepScreenOn(false);
                    emitPausedEvent(map);
                    updatePlayPauseState(PlaybackStateCompat.STATE_PAUSED);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.Buffering: {
                    final float bufferRate = event.getBuffering();
                    Log.d(TAG, "[VLC_EVENT] Buffering rate=" + bufferRate + "%");

                    // FIX (primary seek freeze): trigger play() when the buffer
                    // fills after a codec-flush seek, instead of using a fixed timer.
                    if (bufferRate >= 100f && mPlayAfterBufferComplete && !isPaused) {
                        final long capturedVersion = mSeekVersion;
                        mPlayAfterBufferComplete = false;

                        // Post to main thread so VLC's state fully settles before play()
                        mSeekHandler.post(() -> {
                            if (mMediaPlayer != null && !isPaused && mSeekVersion == capturedVersion) {
                                Log.i(TAG, "[SEEK] buffer=100% → resuming play");
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
                    Log.d(TAG, "[VLC_EVENT] Opening");
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Opening");
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_OPEN);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.EndReached: {
                    Log.i(TAG, "[VLC_EVENT] EndReached | pos=" + mMediaPlayer.getPosition());
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
                    Log.i(TAG, "[VLC_EVENT] Stopped | isPaused=" + isPaused);
                    isPaused = true;
                    mNativeStopped = true;
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Stopped");
                    setKeepScreenOn(false);
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_VIDEO_STOPPED);
                    updatePlayPauseState(PlaybackStateCompat.STATE_STOPPED);
                    break;
                }

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.EncounteredError: {
                    Log.e(TAG, "[VLC_EVENT] EncounteredError");
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

                // ─────────────────────────────────────────────────────────────
                case MediaPlayer.Event.RecordChanged: {
                    Log.d(TAG, "[VLC_EVENT] RecordChanged isRecording=" + event.getRecording());
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "RecordingPath");
                    map.putBoolean("isRecording", event.getRecording());
                    if (!event.getRecording() && event.getRecordPath() != null) {
                        map.putString("recordPath", event.getRecordPath());
                    }
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_RECORDING_STATE);
                    break;
                }

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
            mSarNum = sarNum;
            mSarDen = sarDen;

            Log.d(TAG, "[VIDEO_LAYOUT] " + width + "x" + height + " visible=" + visibleWidth + "x" + visibleHeight
                    + " SAR=" + sarNum + ":" + sarDen);

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
        if (mLastSeekTargetMs >= 0 && mMediaPlayer != null) {
            long actualMs = mMediaPlayer.getTime();
            long delta = Math.abs(actualMs - mLastSeekTargetMs);
            if (delta > 500) {
                Log.w(TAG, "[SEEK_VERIFY] ⚠ drift: target=" + mLastSeekTargetMs
                        + "ms actual=" + actualMs + "ms delta=" + delta + "ms");
            } else {
                Log.d(TAG, "[SEEK_VERIFY] ✓ target=" + mLastSeekTargetMs
                        + "ms actual=" + actualMs + "ms delta=" + delta + "ms");
            }
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

    private void createPlayer(boolean autoplayResume, boolean isResume) {
        if (mCreatingPlayer) {
            Log.w(TAG, "[CREATE_PLAYER] already in progress, ignoring concurrent call");
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
                Log.i(TAG, "[CREATE_PLAYER] override savedPos=" + mSavedPosition
                        + " from stopped revive");
            }

            if (this.getSurfaceTexture() == null) {
                Log.w(TAG, "[CREATE_PLAYER] no surface texture yet, aborting");
                return;
            }
            if (srcMap == null) {
                Log.w(TAG, "[CREATE_PLAYER] srcMap is null, aborting");
                return;
            }

            final ArrayList<String> cOptions = new ArrayList<>();
            String uriString = srcMap.hasKey("uri") ? srcMap.getString("uri") : null;
            if (TextUtils.isEmpty(uriString)) {
                Log.w(TAG, "[CREATE_PLAYER] URI is empty, aborting");
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

            Log.i(TAG, "[CREATE_PLAYER] uri=" + uriString
                    + " autoplay=" + autoplay + " isNetwork=" + isNetwork
                    + " initType=" + initType + " hw=" + hwDecoderEnabled + "/" + hwDecoderForced
                    + " savedPos=" + mSavedPosition);

            // Enhancement is always composed natively. Explicit overrides are only
            // used for a specific in-flight enhancement recreate target.
            if (mEffectiveInitOptionsOverride != null) {
                cOptions.addAll(mEffectiveInitOptionsOverride);
                Log.i(TAG, "[CREATE_PLAYER] using enhancement init options override (" + cOptions.size() + " options)");
            } else {
                cOptions.addAll(buildEffectiveInitOptions(mRequestedEnhancement));
            }
            mEnhancementCompatiblePipeline = shouldUseEnhancementCompatiblePipeline(mRequestedEnhancement);

            libvlc = (initType == 1) ? new LibVLC(getContext()) : new LibVLC(getContext(), cOptions);
            mMediaPlayer = new MediaPlayer(libvlc);
            setMutedModifier(mMuted);
            mMediaPlayer.setEventListener(mPlayerListener);

            Dialog.setCallbacks(libvlc, new Dialog.Callbacks() {
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

            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            int viewWidth = getWidth();
            int viewHeight = getHeight();
            if (viewWidth > 0 && viewHeight > 0) {
                vlcOut.setWindowSize(viewWidth, viewHeight);
                if (autoAspectRatio)
                    mMediaPlayer.setAspectRatio(viewWidth + ":" + viewHeight);
            }

            // Build media object
            Media m;
            if (isNetwork) {
                m = new Media(libvlc, Uri.parse(uriString));
            } else if (uriString.startsWith("content://")) {
                try {
                    Uri uri = Uri.parse(uriString);
                    ParcelFileDescriptor pfd = getContext().getContentResolver()
                            .openFileDescriptor(uri, "r");
                    if (pfd != null) {
                        if (currentPfd != null) {
                            try {
                                currentPfd.close();
                            } catch (Exception ignored) {
                            }
                        }
                        currentPfd = pfd;
                        m = new Media(libvlc, pfd.getFileDescriptor());
                    } else {
                        throw new Exception("null PFD for " + uriString);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "[CREATE_PLAYER] content:// FD failed: " + e.getMessage()
                            + " — falling back to URI");
                    m = new Media(libvlc, Uri.parse(uriString));
                }
            } else {
                m = new Media(libvlc, uriString);
            }

            m.setEventListener(mMediaListener);
            boolean hmEnabled = (hwDecoderEnabled >= 1);
            boolean hmForced = (hwDecoderForced >= 1);
            m.setHWDecoderEnabled(hmEnabled, hmForced);
            Log.i(TAG, "[CREATE_PLAYER] HW decoder enabled=" + hmEnabled + " forced=" + hmForced);

            if (mediaOptions != null) {
                ArrayList options = mediaOptions.toArrayList();
                for (Object option : options)
                    m.addOption((String) option);
            }

            if (mAudioDelay != 0) {
                m.addOption(":audio-desync=" + mAudioDelay);
            }

            if (!isNetwork) {
                m.addOption(":input-fast-seek");
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

            mMediaPlayer.setMedia(m);
            m.release();
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
                Log.i(TAG, "[CREATE_PLAYER] restoring saved position=" + positionToRestore);

                if (shouldPlay) {
                    isPaused = false;
                    if (requestAudioFocusInternal())
                        mMediaPlayer.play();
                }

                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (mMediaPlayer != null) {
                        long lengthMs = mMediaPlayer.getLength();
                        long targetMs = lengthMs > 0 ? (long) (positionToRestore * lengthMs) : -1L;
                        Log.i(TAG, "[SEEK] restoring position=" + positionToRestore
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
            Log.e(TAG, "[CREATE_PLAYER] Error: " + e.getMessage(), e);
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
                    Log.d(TAG, "[RELEASE] saved position=" + mSavedPosition);
                } else {
                    // Respect caller's explicit zero — don't overwrite with EOF position
                    Log.d(TAG, "[RELEASE] NOT saving position=" + currentPos
                            + " mNativeStopped=" + mNativeStopped
                            + " (keeping mSavedPosition=" + mSavedPosition + ")");
                }
            } catch (Exception e) {
                mSavedPosition = 0f;
            }

            final IVLCVout vout = mMediaPlayer.getVLCVout();
            vout.removeCallback(callback);
            vout.detachViews();

            // FIX C4: clear dialog callbacks before releasing to avoid
            // dangling closure references to this view instance.
            if (libvlc != null) {
                Dialog.setCallbacks(libvlc, null);
            }

            mMediaPlayer.release();
            mMediaPlayer = null;
            Log.d(TAG, "[RELEASE] MediaPlayer released");
        }

        if (libvlc != null) {
            libvlc.release();
            libvlc = null;
        }

        if (currentPfd != null) {
            try {
                currentPfd.close();
            } catch (Exception ignored) {
            }
            currentPfd = null;
        }

        // Reset per-player state (but NOT mLastBridgeSeekValue / mLastSeekTargetMs —
        // those are managed by callers to prevent React stale-prop re-sends).
        isResizeModeApplied = false;
        mVideoWidth = 0;
        mVideoHeight = 0;
        mVideoVisibleWidth = 0;
        mVideoVisibleHeight = 0;
        mSarNum = 0;
        mSarDen = 0;
        currentlyAppliedAudioTrack = -1;
        mBestFitUsingCover = null;
        mPlayAfterBufferComplete = false;
        mLastSeekPlayTimestampMs = -1L;
        mLastAppliedRate = Float.NaN;
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
            Log.d(TAG, "[SEEK_FILTER] seek < 0, skip");
            return true;
        }
        if (seek == mLastBridgeSeekValue) {
            Log.d(TAG, "[SEEK_FILTER] identical bridge value=" + seek + ", skip");
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
            Log.w(TAG, "[SEEK] setPosition(" + position + ") — player is null, ignoring");
            return;
        }
        if (position < 0 || position > 1) {
            Log.w(TAG, "[SEEK] setPosition(" + position + ") — out of range, ignoring");
            return;
        }

        mSeekHandler.post(() -> {
            if (mMediaPlayer == null) {
                Log.w(TAG, "[SEEK] player gone before seek executed");
                return;
            }

            final long lengthMs = mMediaPlayer.getLength();
            final long targetMs = lengthMs > 0 ? (long) (position * lengthMs) : -1L;
            final boolean nativePlaying = mMediaPlayer.isPlaying();

            // ── Duplicate check ───────────────────────────────────────────────
            if (targetMs >= 0) {
                if (mLastSeekTargetMs >= 0
                        && Math.abs(targetMs - mLastSeekTargetMs) < SEEK_TIME_EPSILON_MS) {
                    Log.d(TAG, "[SEEK] duplicate (delta < " + SEEK_TIME_EPSILON_MS + "ms), skipping"
                            + " targetMs=" + targetMs + " lastMs=" + mLastSeekTargetMs);
                    return;
                }
                mLastSeekTargetMs = targetMs;
            }

            Log.i(TAG, "[SEEK] ► position=" + position
                    + " targetMs=" + targetMs
                    + " lengthMs=" + lengthMs
                    + " nativePlaying=" + nativePlaying
                    + " isPaused=" + isPaused
                    + " mNativeStopped=" + mNativeStopped);

            // ── Case 1: Native player stopped/ended ───────────────────────────
            if (mNativeStopped) {
                Log.i(TAG, "[SEEK] native stopped — restarting via createPlayer."
                        + " position=" + position + " isPaused=" + isPaused);
                isPaused = false;
                mForceSeekOnCreate = position;
                mSavedPosition = 0f;
                createPlayer(true, true);
                mLastBridgeSeekValue = position;
                mLastSeekTargetMs = targetMs;
                Log.i(TAG, "[SEEK] createPlayer dispatched with forceSeek=" + position);
                emitSeekEvent();
                return;
            }

            // ── Case 2: Normal seek — buffer-completion approach ───────────────
            //
            // Cancel any previous in-flight seek so its Buffering=100% callback
            // can't fire after this seek has taken over.
            cancelPendingSeek();

            // Increment version BEFORE everything else so any concurrent
            // Buffering callback from the cancelled seek self-discards.
            final long thisSeekVersion = ++mSeekVersion;

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
                Log.i(TAG, "[SEEK] playing seek — pausing to flush codec drain");
                mMediaPlayer.pause();
            }

            if (targetMs >= 0) {
                Log.i(TAG, "[SEEK] setTime(" + targetMs + "ms)");
                mMediaPlayer.setTime(targetMs);
            } else {
                Log.i(TAG, "[SEEK] setPosition(" + position + ") [no duration]");
                mMediaPlayer.setPosition(position);
            }

            Log.i(TAG, "[SEEK] seek dispatched | isPaused=" + isPaused
                    + " codecFlush=" + needsCodecFlush);

            if (!isPaused) {
                // Safety fallback: if Buffering=100% never fires (e.g. network hiccup,
                // decoder quirk), force play() after timeout to prevent a permanent stall.
                mSeekHandler.postDelayed(() -> {
                    if (mSeekVersion == thisSeekVersion && mPlayAfterBufferComplete
                            && mMediaPlayer != null && !isPaused) {
                        Log.w(TAG, "[SEEK] buffer timeout (" + SEEK_BUFFER_TIMEOUT_MS
                                + "ms) — forcing play()");
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
            Log.i(TAG, "[SET_SRC] URI unchanged, skipping recreation: " + newUri);
            this.srcMap = src;
            return;
        }

        // Cancel any pending enhancement work for the old source
        cancelPendingEnhancement();
        mAppliedEnhancement = false;
        mEnhancementCompatiblePipeline = false;

        Log.i(TAG, "[SET_SRC] new URI: " + newUri);
        this.src = newUri;
        this.srcMap = src;
        releasePlayer();
        mSavedPosition = 0f;
        createPlayer(true, false);
    }

    public void setRateModifier(float rateModifier) {
        Log.d(TAG, "[RATE] setRate=" + rateModifier);
        if (mMediaPlayer != null) {
            if (!Float.isNaN(mLastAppliedRate) && Math.abs(mLastAppliedRate - rateModifier) < 0.01f) {
                return;
            }
            mMediaPlayer.setRate(rateModifier);
            mLastAppliedRate = rateModifier;
            updatePlayPauseState(mMediaPlayer.isPlaying()
                    ? PlaybackStateCompat.STATE_PLAYING
                    : PlaybackStateCompat.STATE_PAUSED);
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
        Log.i(TAG, "[AUDIO_DELAY] set=" + delayMs + "ms");
        if (mMediaPlayer != null) {
            final long delayUs = mAudioDelay * 1000;
            boolean ok = mMediaPlayer.setAudioDelay(delayUs);
            Log.i(TAG, "[AUDIO_DELAY] applied " + delayMs + "ms (" + delayUs + "μs) ok=" + ok);

            if (mMediaPlayer.isPlaying()) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (mMediaPlayer != null) {
                        boolean retryOk = mMediaPlayer.setAudioDelay(delayUs);
                        Log.d(TAG, "[AUDIO_DELAY] retry ok=" + retryOk);
                    }
                }, 150);
            }
        } else {
            Log.w(TAG, "[AUDIO_DELAY] player null — will apply on createPlayer");
        }
    }

    public void setVolumeModifier(int volumeModifier) {
        int clamped = Math.max(0, Math.min(200, volumeModifier));
        this.preVolume = clamped;
        // Log.d(TAG, "[VOLUME] set=" + clamped);
        if (mMediaPlayer != null)
            mMediaPlayer.setVolume(clamped);
    }

    public void setMutedModifier(boolean muted) {
        mMuted = muted;
        Log.d(TAG, "[MUTE] muted=" + muted);
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
        Log.i(TAG, "[PAUSE_MOD] paused=" + paused
                + " | current isPaused=" + isPaused
                + " nativePlaying=" + (mMediaPlayer != null && mMediaPlayer.isPlaying())
                + " mNativeStopped=" + mNativeStopped);

        isPaused = paused;

        if (mMediaPlayer == null) {
            Log.i(TAG, "[PAUSE_MOD] no player → createPlayer(autoplay=" + !paused + ")");
            createPlayer(!paused, false);
            return;
        }

        if (paused) {
            mMediaPlayer.pause();
            Log.i(TAG, "[PAUSE_MOD] pause() called");
        } else {
            if (mNativeStopped) {
                Log.i(TAG, "[PAUSE_MOD] mNativeStopped=true → createPlayer(restart from 0)");
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
                    Log.i(TAG, "[PAUSE_MOD] play() called");
                } else {
                    Log.i(TAG, "[PAUSE_MOD] play() skipped — already playing (redundant call)");
                }
            }
        }
    }

    public boolean doSnapshot(String path) {
        // NOTE: getBitmap() reads the GPU framebuffer synchronously on the main thread.
        // For production use, consider dispatching to a background thread and
        // delivering
        // the result via a callback to avoid frame drops on high-DPI devices.
        if (mMediaPlayer == null) {
            sendSnapshotEvent(false, null, "MediaPlayer is null");
            return false;
        }
        Bitmap bitmap = null;
        try {
            bitmap = getBitmap();
            if (bitmap == null) {
                sendSnapshotEvent(false, null, "Failed to capture bitmap");
                return false;
            }
            File file = new File(path);
            File parent = file.getParentFile();
            if (parent != null)
                parent.mkdirs();
            FileOutputStream out = new FileOutputStream(file);
            String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
            if (extension.equals("png")) {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
            } else {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 100, out);
            }
            out.flush();
            out.close();
            sendSnapshotEvent(true, path, null);
            return true;
        } catch (Exception e) {
            sendSnapshotEvent(false, null, e.getMessage());
            return false;
        } finally {
            if (bitmap != null)
                bitmap.recycle();
        }
    }

    private void sendSnapshotEvent(boolean success, String path, String error) {
        WritableMap event = Arguments.createMap();
        event.putBoolean("success", success);
        if (path != null)
            event.putString("path", path);
        if (error != null)
            event.putString("error", error);
        eventEmitter.sendEvent(event, VideoEventEmitter.EVENT_ON_SNAPSHOT);
    }

    public void doResume(boolean autoplay) {
        Log.i(TAG, "[RESUME] doResume autoplay=" + autoplay);
        createPlayer(autoplay, true);
    }

    /**
     * Repeat is implemented via the :input-repeat=65535 media option, which is
     * added to mediaOptions in JS before createPlayer() is called. This Java
     * method is intentionally a no-op; repeat cannot be toggled mid-playback
     * without recreating the player.
     */
    public void setRepeatModifier(boolean repeat) {
        Log.d(TAG, "[REPEAT] repeat=" + repeat + " (applied via mediaOptions at createPlayer time)");
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
        Log.d(TAG, "[AUDIO_TRACK] set=" + track);
        _audioTrack = track;
        if (mMediaPlayer != null)
            mMediaPlayer.setAudioTrack(track);
    }

    public void setTextTrack(int track) {
        Log.d(TAG, "[TEXT_TRACK] set=" + track);
        _textTrack = track;
        if (mMediaPlayer != null)
            mMediaPlayer.setSpuTrack(track);
    }

    public void startRecording(String recordingPath) {
        if (mMediaPlayer == null || recordingPath == null)
            return;
        mMediaPlayer.record(recordingPath);
    }

    public void stopRecording() {
        if (mMediaPlayer == null)
            return;
        mMediaPlayer.record(null);
    }

    public void stopPlayer() {
        if (mMediaPlayer == null)
            return;
        Log.i(TAG, "[STOP] stopPlayer()");
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
            Log.i(TAG, "[STOP] pausePlayer()");
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
            Log.i(TAG, "[CERT] auto-accepted (acceptInvalidCertificates=true)");
        } else {
            dialog.postAction(2); // Reject / "No"
            Log.i(TAG, "[CERT] rejected (acceptInvalidCertificates=false)");
        }
    }

    public void setAcceptInvalidCertificates(boolean accept) {
        this.acceptInvalidCertificates = accept;
        Log.i(TAG, "[CONFIG] acceptInvalidCertificates=" + accept);
    }

    public void setPlayInBackground(boolean playInBackground) {
        this.playInBackground = playInBackground;
        Log.i(TAG, "[CONFIG] playInBackground=" + playInBackground);
    }

    public void setIsInPipMode(boolean isInPipMode) {
        boolean was = this.isInPipMode;
        this.isInPipMode = isInPipMode;
        Log.d(TAG, "[PIP] isInPipMode=" + isInPipMode + " was=" + was);
        if (was && !isInPipMode && !playInBackground && isHostPaused) {
            Log.i(TAG, "[PIP] PiP closed, host paused, not background → pausing");
            if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                isPaused = true;
                mMediaPlayer.pause();
                setKeepScreenOn(false);
                emitPausedEvent(Arguments.createMap());
            }
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
                    Log.w(TAG, "[RESIZE] invalid mode: " + mode + " → contain");
                    this.resizeMode = "contain";
                    break;
            }
        }

        // FIX Q2: reset best-fit state ONLY when transitioning AWAY from best-fit.
        // Old code used OR logic which reset on almost every call.
        if ("best-fit".equals(prev) && !"best-fit".equals(this.resizeMode)) {
            mBestFitUsingCover = null;
        }

        Log.d(TAG, "[RESIZE] mode=" + this.resizeMode);
        requestResizeMode();
    }

    // =========================================================================
    // Resize implementation
    // =========================================================================

    private void applyResizeMode() {
        if (mMediaPlayer == null)
            return;
        int viewWidth = getWidth();
        int viewHeight = getHeight();
        if (viewWidth <= 0 || viewHeight <= 0)
            return;

        if (autoAspectRatio) {
            try {
                mMediaPlayer.setAspectRatio(viewWidth + ":" + viewHeight);
                mMediaPlayer.setScale(0);
                mLastViewWidth = viewWidth;
                mLastViewHeight = viewHeight;
                isResizeModeApplied = true;
                Log.d(TAG, "[RESIZE] autoAR applied " + viewWidth + ":" + viewHeight);
            } catch (Exception e) {
                Log.e(TAG, "[RESIZE] autoAR error: " + e.getMessage());
            }
            return;
        }

        if (mVideoWidth <= 0 || mVideoHeight <= 0)
            return;

        mLastViewWidth = viewWidth;
        mLastViewHeight = viewHeight;

        try {
            Log.d(TAG, "[RESIZE] applying mode=" + resizeMode
                    + " view=" + viewWidth + "x" + viewHeight
                    + " video=" + mVideoWidth + "x" + mVideoHeight);
            applyResizeModeInternal(viewWidth, viewHeight);
            isResizeModeApplied = true;
        } catch (Exception e) {
            Log.e(TAG, "[RESIZE] error: " + e.getMessage(), e);
        }
    }

    private void applyResizeModeInternal(int viewWidth, int viewHeight) {
        IVLCVout vlcOut = mMediaPlayer.getVLCVout();
        resetTextureViewTransform();
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
            default:
                applyContainMode();
                break;
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

    private void applyCoverMode() {
        mMediaPlayer.setAspectRatio(null);
        int vw = getWidth(), vh = getHeight();
        int evw = getEffectiveVideoWidth(), evh = getEffectiveVideoHeight();
        float sar = (mSarNum > 0 && mSarDen > 0) ? (float) mSarNum / mSarDen : 1f;
        float dispW = evw * sar;
        float coverScale = Math.max((float) vw / dispW, (float) vh / evh);
        mMediaPlayer.setScale(coverScale);
        Log.d(TAG, "[RESIZE] cover scale=" + coverScale);
    }

    private void applyBestFitMode() {
        mMediaPlayer.setAspectRatio(null);
        int vw = getWidth(), vh = getHeight();
        int evw = getEffectiveVideoWidth(), evh = getEffectiveVideoHeight();
        if (vw <= 0 || vh <= 0 || evw <= 0 || evh <= 0) {
            applyContainMode();
            return;
        }
        float sar = (mSarNum > 0 && mSarDen > 0) ? (float) mSarNum / mSarDen : 1f;
        float dispW = evw * sar;
        float scaleX = (float) vw / dispW;
        float scaleY = (float) vh / evh;
        float containScale = Math.min(scaleX, scaleY);
        float coverScale = Math.max(scaleX, scaleY);
        float containW = dispW * containScale;
        float containH = evh * containScale;
        float coverW = dispW * coverScale;
        float coverH = evh * coverScale;
        float viewArea = (float) vw * vh;
        float cropRatio = (coverW > 0 && coverH > 0)
                ? (1f - (viewArea / (coverW * coverH)))
                : 1f;
        float hBar = Math.max(0f, (vw - containW) / vw);
        float vBar = Math.max(0f, (vh - containH) / vh);
        float maxBar = Math.max(hBar, vBar);

        boolean useCover;
        if (Boolean.TRUE.equals(mBestFitUsingCover)) {
            // Currently using cover — exit only if crop/bar exceed EXIT thresholds
            useCover = cropRatio <= BEST_FIT_EXIT_CROP_RATIO
                    && maxBar <= BEST_FIT_EXIT_BAR_RATIO;
        } else {
            // Currently using contain — enter cover only if well within ENTER thresholds
            useCover = cropRatio >= 0f
                    && cropRatio <= BEST_FIT_ENTER_CROP_RATIO
                    && maxBar <= BEST_FIT_ENTER_BAR_RATIO
                    && (containW * containH) / viewArea < 0.999f;
        }
        mBestFitUsingCover = useCover;

        if (useCover) {
            mMediaPlayer.setScale(coverScale);
            Log.d(TAG, "[RESIZE] best-fit=cover scale=" + coverScale + " crop=" + cropRatio);
        } else {
            mMediaPlayer.setScale(0f);
            Log.d(TAG, "[RESIZE] best-fit=contain crop=" + cropRatio);
        }
    }

    private void applyFillMode(int vw, int vh) {
        mMediaPlayer.setAspectRatio(vw + ":" + vh);
        mMediaPlayer.setScale(0);
        Log.d(TAG, "[RESIZE] fill AR=" + vw + ":" + vh);
    }

    private void applyNoneMode() {
        int evw = getEffectiveVideoWidth(), evh = getEffectiveVideoHeight();
        if (mSarNum > 0 && mSarDen > 0) {
            mMediaPlayer.setAspectRatio((evw * mSarNum) + ":" + (evh * mSarDen));
        } else {
            mMediaPlayer.setAspectRatio(null);
        }
        mMediaPlayer.setScale(1f);
        Log.d(TAG, "[RESIZE] none 1:1");
    }

    private void applyContainMode() {
        mMediaPlayer.setAspectRatio(null);
        mMediaPlayer.setScale(0);
        Log.d(TAG, "[RESIZE] contain (VLC auto)");
    }

    private void applyScaleDownMode() {
        int evw = getEffectiveVideoWidth(), evh = getEffectiveVideoHeight();
        float sar = 1f;
        if (mSarNum > 0 && mSarDen > 0) {
            mMediaPlayer.setAspectRatio((evw * mSarNum) + ":" + (evh * mSarDen));
            sar = (float) mSarNum / mSarDen;
        } else {
            mMediaPlayer.setAspectRatio(null);
        }
        int vw = getWidth(), vh = getHeight();
        float dispW = evw * sar;
        if (dispW > vw || evh > vh) {
            float scale = Math.min((float) vw / dispW, (float) vh / evh);
            mMediaPlayer.setScale(scale);
            Log.d(TAG, "[RESIZE] scale-down shrink scale=" + scale);
        } else {
            mMediaPlayer.setScale(1f);
            Log.d(TAG, "[RESIZE] scale-down 1:1 (fits)");
        }
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
            Log.w(TAG, "[ENHANCE] capturePlaybackSnapshot: no player loaded");
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
            Log.w(TAG, "[ENHANCE] capturePlaybackSnapshot: error reading state: " + e.getMessage());
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
                Log.w(TAG, "[ENHANCE] error calculating position: " + e.getMessage());
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
            Log.w(TAG, "[ENHANCE] restorePlaybackSnapshot: no player, skipping");
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
        releaseMediaSession();
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
        Log.d(TAG, "[SURFACE] onSurfaceTextureAvailable " + width + "x" + height);
        surfaceVideo = new Surface(surface);

        if (mMediaPlayer != null && libvlc != null) {
            Log.i(TAG, "[SURFACE] restoring surface to existing player");
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
        Log.d(TAG, "[SURFACE] size changed " + width + "x" + height);
        if (mMediaPlayer != null && (autoAspectRatio || (mVideoWidth > 0 && mVideoHeight > 0))) {
            applyResizeMode();
        }
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        Log.d(TAG, "[SURFACE] destroyed");
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
                    Log.d(TAG, "[MEDIA_EVENT] MetaChanged id=" + event.getMetaId());
                    break;
                case Media.Event.ParsedChanged:
                    Log.d(TAG, "[MEDIA_EVENT] ParsedChanged status=" + event.getParsedStatus());
                    break;
                case Media.Event.StateChanged:
                    Log.d(TAG, "[MEDIA_EVENT] StateChanged meta=" + event.getMetaId());
                    break;
                default:
                    Log.d(TAG, "[MEDIA_EVENT] type=" + event.type);
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
            Log.d(TAG, "[VIDEO_INFO] skipping — junk duration=" + duration);
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
            Log.d(TAG, "[VIDEO_INFO] audioTracks=" + tracks.length);
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
            Log.d(TAG, "[VIDEO_INFO] textTracks=" + tracks.length);
        }
        if (vt != null) {
            WritableMap sz = Arguments.createMap();
            sz.putInt("width", vt.width);
            sz.putInt("height", vt.height);
            info.putMap("videoSize", sz);
        }

        Log.i(TAG, "[VIDEO_INFO] emitting load event duration=" + duration + "ms");
        eventEmitter.sendEvent(info, VideoEventEmitter.EVENT_ON_LOAD);
        mVideoInfoHash = current;
    }

    // =========================================================================
    // Media Session & Notification
    // =========================================================================

    private void initMediaSession() {
        mMediaSession = new MediaSessionCompat(getContext(), TAG);
        mMediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
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
                    Log.d(TAG, "[MEDIA_SESSION] onSeekTo pos=" + pos);
                    setPosition((float) pos / mMediaPlayer.getLength());
                }
            }
        });
        mMediaSession.setActive(true);
        mNotificationManager = NotificationManagerCompat.from(getContext());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    NOTIFICATION_CHANNEL_ID, "Media Playback",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Media playback controls");
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            if (nm != null)
                nm.createNotificationChannel(ch);
        }
    }

    private void releaseMediaSession() {
        if (mMediaSession != null) {
            mMediaSession.setActive(false);
            mMediaSession.release();
            mMediaSession = null;
        }
        if (mNotificationManager != null)
            mNotificationManager.cancel(NOTIFICATION_ID);
    }

    private void updateMediaMetadata() {
        if (mMediaSession == null)
            return;
        MediaMetadataCompat.Builder b = new MediaMetadataCompat.Builder();
        b.putString(MediaMetadataCompat.METADATA_KEY_TITLE, mVideoTitle);
        b.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, mVideoArtist);
        if (mMediaPlayer != null)
            b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, mMediaPlayer.getLength());
        mMediaSession.setMetadata(b.build());
        // FIX S4: only show notification when appropriate
        if (mMediaPlayer != null && mMediaPlayer.isPlaying()
                && (playInBackground || isHostPaused)) {
            showNotification(PlaybackStateCompat.STATE_PLAYING);
        }
    }

    public void setVideoTitle(String title) {
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
        long position = mMediaPlayer != null ? mMediaPlayer.getTime() : 0;
        float speed = mMediaPlayer != null ? mMediaPlayer.getRate() : 1f;
        PlaybackStateCompat.Builder sb = new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY
                        | PlaybackStateCompat.ACTION_PAUSE
                        | PlaybackStateCompat.ACTION_PLAY_PAUSE
                        | PlaybackStateCompat.ACTION_SEEK_TO)
                .setState(state, position, speed);
        mMediaSession.setPlaybackState(sb.build());

        // FIX S4: only show notification when in background or background-play mode
        if (playInBackground || isHostPaused) {
            if (state == PlaybackStateCompat.STATE_PLAYING
                    || state == PlaybackStateCompat.STATE_PAUSED) {
                showNotification(state);
            } else {
                mNotificationManager.cancel(NOTIFICATION_ID);
            }
        } else {
            // Foreground with no background play — dismiss any lingering notification
            mNotificationManager.cancel(NOTIFICATION_ID);
        }
    }

    private void showNotification(int state) {
        if (mMediaSession == null)
            return;
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(),
                    Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "[NOTIF] POST_NOTIFICATIONS not granted, skipping");
                return;
            }
        }

        int icon = (state == PlaybackStateCompat.STATE_PLAYING)
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;
        String label = (state == PlaybackStateCompat.STATE_PLAYING) ? "Pause" : "Play";
        long actionCode = (state == PlaybackStateCompat.STATE_PLAYING)
                ? PlaybackStateCompat.ACTION_PAUSE
                : PlaybackStateCompat.ACTION_PLAY;

        Intent launchIntent = getContext().getPackageManager()
                .getLaunchIntentForPackage(getContext().getPackageName());
        PendingIntent ci = PendingIntent.getActivity(
                getContext(), 0, launchIntent, PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(
                getContext(), NOTIFICATION_CHANNEL_ID)
                .addAction(new NotificationCompat.Action(icon, label,
                        MediaButtonReceiver.buildMediaButtonPendingIntent(getContext(), actionCode)))
                .setContentTitle(mVideoTitle)
                .setContentText(mVideoArtist)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(ci)
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(mMediaSession.getSessionToken())
                        .setShowActionsInCompactView(0))
                .setPriority(NotificationCompat.PRIORITY_LOW);

        mNotificationManager.notify(NOTIFICATION_ID, b.build());
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
            Log.e(TAG, "[EQ] error: " + e.getMessage());
        }
    }

    /**
     * FIX S6: cache the Equalizer instance and update bands in-place rather than
     * allocating a new native object on every call.
     */
    private void applyEqualizer() {
        if (mMediaPlayer == null || libvlc == null)
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
                Log.d(TAG, "[EQ] applied " + mEqualizerBands.length + " bands");
            } catch (Exception e) {
                Log.e(TAG, "[EQ] failed: " + e.getMessage());
            }
        } else {
            mMediaPlayer.setEqualizer(null);
        }
    }
}
