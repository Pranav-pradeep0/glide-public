package com.yuanzhou.vlc.vlcplayer;

import android.annotation.SuppressLint;
import android.content.Context;
import android.Manifest;
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
import android.util.DisplayMetrics;
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
import java.util.concurrent.atomic.AtomicBoolean;
import android.os.ParcelFileDescriptor;

import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.support.v4.media.MediaMetadataCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.media.session.MediaButtonReceiver;
import android.app.PendingIntent;
import android.content.Intent;
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
    private boolean netStrTag;
    private ReadableMap srcMap;
    private int mVideoHeight = 0;
    private TextureView surfaceView;
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
    private String resizeMode = "contain";
    private boolean isResizeModeApplied = false;
    private long mAudioDelay = 0;

    private float mProgressUpdateInterval = 0;
    private Handler mProgressUpdateHandler = new Handler(Looper.getMainLooper());
    private Runnable mProgressUpdateRunnable = null;

    // Executor for background seeking to prevent UI thread blocking
    private final ExecutorService seekExecutor = Executors.newSingleThreadExecutor();

    private final ThemedReactContext themedReactContext;
    private final AudioManager audioManager;
    private AudioFocusRequest mAudioFocusRequest; // For API 26+ audio focus management
    private boolean mHasAudioFocus = false;

    private WritableMap mVideoInfo = null;
    private String mVideoInfoHash = null;
    private ParcelFileDescriptor currentPfd = null;

    // Media Session & Notification
    private MediaSessionCompat mMediaSession;
    private NotificationManagerCompat mNotificationManager;
    private String mVideoTitle = "Video";
    private String mVideoArtist = "Glide";
    private static final String NOTIFICATION_CHANNEL_ID = "vlc_media_player_channel";
    private static final int NOTIFICATION_ID = 1001;
    private PlaybackStateCompat.Builder mStateBuilder;

    // Buffering debounce
    private static final int BUFFERING_DEBOUNCE_MS = 200;
    private Handler bufferingHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingBufferingEvent = null;

    // Resize debounce logic
    private Handler resizeDebounceHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingResize = null;
    private static final int RESIZE_DEBOUNCE_MS = 100;

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
        stopPlayback();
    }

    // LifecycleEventListener implementation

    @Override
    public void onHostResume() {
        if (mMediaPlayer != null && isSurfaceViewDestory && isHostPaused) {
            IVLCVout vlcOut = mMediaPlayer.getVLCVout();
            if (!vlcOut.areViewsAttached()) {
                vlcOut.attachViews(onNewVideoLayoutListener);
                isSurfaceViewDestory = false;
                isPaused = false;
                requestAudioFocusInternal();
                mMediaPlayer.play();
            }
        }
    }

    @Override
    public void onHostPause() {
        boolean isInPipMode = false;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            try {
                android.app.Activity activity = themedReactContext.getCurrentActivity();
                if (activity != null) {
                    isInPipMode = activity.isInPictureInPictureMode();
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to check PIP mode: " + e.getMessage());
            }
        }

        if (!playInBackground && !isInPipMode && !isPaused && mMediaPlayer != null) {
            isPaused = true;
            isHostPaused = true;
            mMediaPlayer.pause();
            WritableMap map = Arguments.createMap();
            map.putString("type", "Paused");
            eventEmitter.onVideoStateChange(map);
        }
        Log.i(TAG, "onHostPause: playInBackground=" + playInBackground + ", isInPipMode=" + isInPipMode);
    }

    @Override
    public void onHostDestroy() {
        stopPlayback();
    }

    // AudioManager.OnAudioFocusChangeListener implementation
    @Override
    public void onAudioFocusChange(int focusChange) {
        Log.d(TAG, "onAudioFocusChange: " + focusChange);

        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_GAIN:
                // Regained focus - resume playback at normal volume
                mHasAudioFocus = true;
                if (mMediaPlayer != null) {
                    // Restore volume if we were ducking
                    setVolumeModifier(preVolume);
                    // Resume if we were playing before losing focus
                    if (!isPaused && !mMediaPlayer.isPlaying()) {
                        mMediaPlayer.play();
                        Log.i(TAG, "Resumed playback after regaining audio focus");
                    }
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS:
                // Permanent loss - pause and release focus
                mHasAudioFocus = false;
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    isPaused = true;
                    mMediaPlayer.pause();
                    setKeepScreenOn(false);

                    // Notify JS side
                    WritableMap map = Arguments.createMap();
                    map.putString("type", "Paused");
                    eventEmitter.onVideoStateChange(map);
                    Log.i(TAG, "Paused playback due to permanent audio focus loss");
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // Temporary loss (e.g., phone call) - pause but keep resources
                if (mMediaPlayer != null && mMediaPlayer.isPlaying()) {
                    mMediaPlayer.pause();
                    Log.i(TAG, "Paused playback due to transient audio focus loss");
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // Can duck - lower volume temporarily
                if (mMediaPlayer != null) {
                    mMediaPlayer.setVolume(30); // Duck to 30%
                    Log.i(TAG, "Ducking audio due to transient focus loss");
                }
                break;
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

            mHasAudioFocus = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
            Log.i(TAG, "requestAudioFocus result: " + (mHasAudioFocus ? "GRANTED" : "DENIED"));
        }

        // Force re-apply volume when we have focus.
        // This ensures the AudioTrack is active and volume is correct.
        // CHECK mMuted: If muted, we should not unmute just because we got focus.
        if (mHasAudioFocus && mMediaPlayer != null && !mMuted) {
            mMediaPlayer.setVolume(preVolume);
            Log.d(TAG, "Enforced volume " + preVolume + " after focus check");
        }

        return mHasAudioFocus;
    }

    /**
     * Abandon audio focus when stopping playback.
     * Uses modern API for Android 8.0+.
     */
    private void abandonAudioFocusInternal() {
        if (!mHasAudioFocus) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mAudioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(mAudioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(this);
        }

        mHasAudioFocus = false;
        Log.i(TAG, "Abandoned audio focus");
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
        return mVideoWidth > 0 && mVideoHeight > 0
                && getWidth() > 0 && getHeight() > 0
                && !isSurfaceViewDestory;
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

    private void requestResizeMode() {
        if (!areDimensionsStable()) {
            return;
        }

        if (pendingResize != null) {
            resizeDebounceHandler.removeCallbacks(pendingResize);
        }

        pendingResize = new Runnable() {
            @Override
            public void run() {
                if (areDimensionsStable()) {
                    applyResizeModeInternal(getWidth(), getHeight());
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
                    // CRITICAL: When EndReached is triggered, the VLC player enters a final state.
                    // We call stop() to transition it back to Stopped state, which is reactive to
                    // play/seek.
                    if (mMediaPlayer != null) {
                        mMediaPlayer.stop();
                    }
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_END);
                    break;
                }
                case MediaPlayer.Event.Playing: {
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

                    // Apply stored audio track if set
                    if (_audioTrack != -1) {
                        mMediaPlayer.setAudioTrack(_audioTrack);
                        Log.i(TAG, "Applied audio track " + _audioTrack + " in Playing event");
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

                    map.putString("type", "Playing");
                    setKeepScreenOn(true); // Acquire wake lock
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_IS_PLAYING);

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
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Paused");
                    setKeepScreenOn(false); // Release wake lock
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_PAUSED);
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
                    WritableMap map = createEventMap();
                    if (map == null)
                        return;
                    map.putString("type", "Stopped");
                    setKeepScreenOn(false); // Release wake lock
                    eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_ON_VIDEO_STOPPED);
                    updatePlayPauseState(PlaybackStateCompat.STATE_STOPPED);
                    break;
                }
                case MediaPlayer.Event.EncounteredError: {
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

    IVLCVout.Callback callback = new IVLCVout.Callback() {
        @Override
        public void onSurfacesCreated(IVLCVout ivlcVout) {
            isSurfaceViewDestory = false;
        }

        @Override
        public void onSurfacesDestroyed(IVLCVout ivlcVout) {
            isSurfaceViewDestory = true;
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
        try {
            final ArrayList<String> cOptions = new ArrayList<>();
            String uriString = srcMap.hasKey("uri") ? srcMap.getString("uri") : null;
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

            DisplayMetrics dm = getResources().getDisplayMetrics();
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

            mVideoInfo = null;
            mVideoInfoHash = null;
            isResizeModeApplied = false;

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

            if (isResume) {
                if (autoplayResume) {
                    requestAudioFocusInternal();
                    mMediaPlayer.play();
                }
            } else {
                if (autoplay) {
                    isPaused = false;
                    requestAudioFocusInternal();
                    mMediaPlayer.play();
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
        // Clean up buffering handler
        if (pendingBufferingEvent != null) {
            bufferingHandler.removeCallbacks(pendingBufferingEvent);
            pendingBufferingEvent = null;
        }

        if (mProgressUpdateRunnable != null) {
            mProgressUpdateHandler.removeCallbacks(mProgressUpdateRunnable);
        }

        if (mMediaPlayer != null) {
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

        releaseMediaSession();

        isResizeModeApplied = false;
    }

    // Track last seek to prevent identical repeated seeks
    private float lastSeekPosition = -1f;
    // Minimal threshold: 0.01% - only blocks truly duplicate seeks
    // For 1hr video: 0.01% = 0.36 seconds
    // For 30min video: 0.01% = 0.18 seconds
    private static final float SEEK_THRESHOLD = 0.0001f;

    /**
     * 视频进度调整
     *
     * @param position
     */
    public void setPosition(final float position) {
        if (mMediaPlayer != null) {
            if (position >= 0 && position <= 1) {
                // Submit seek to background thread to avoid blocking UI
                seekExecutor.submit(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            // Skip only if seeking to nearly identical position
                            if (Math.abs(position - lastSeekPosition) < SEEK_THRESHOLD) {
                                return;
                            }

                            lastSeekPosition = position;

                            // Handle 'revival' from Ended/Stopped states
                            if (mMediaPlayer != null) {
                                if (!mMediaPlayer.isPlaying() && !isPaused) {
                                    mMediaPlayer.setPosition(position);
                                    // Need to post to main thread for audio focus?
                                    // LibVLC calls are thread safe, but audio focus should be main thread typically
                                    // But requestAudioFocusInternal is just Android AudioManager, which is thread
                                    // safe.
                                    requestAudioFocusInternal();
                                    mMediaPlayer.play();

                                    // Only update state if we actually changed play state
                                    // We can post this back to main thread or skip during rapid scrubbing
                                    // updatePlayPauseState(...) - SKIPPED for performance during seek
                                } else {
                                    mMediaPlayer.setPosition(position);
                                }
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error in background seek: " + e.getMessage());
                        }
                    }
                });
            }
        }
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
        this.netStrTag = isNetStr;
        createPlayer(autoplay, false);
    }

    public void setSrc(ReadableMap src) {
        this.srcMap = src;
        createPlayer(true, false);
    }

    /**
     * 改变播放速率
     *
     * @param rateModifier
     */
    public void setRateModifier(float rateModifier) {
        if (mMediaPlayer != null) {
            mMediaPlayer.setRate(rateModifier);
            updatePlayPauseState(
                    mMediaPlayer.isPlaying() ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED);
        }
    }

    public void setmProgressUpdateInterval(float interval) {
        mProgressUpdateInterval = interval;
        createPlayer(true, false);
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
                mMediaPlayer.pause();
            } else {
                isPaused = false;
                // If we are at the very end and user clicks play, restart from beginning
                if (mMediaPlayer.getPosition() >= 0.99f || !mMediaPlayer.isPlaying()) {
                    if (mMediaPlayer.getPosition() >= 0.99f) {
                        mMediaPlayer.setPosition(0);
                    }
                    requestAudioFocusInternal();
                    mMediaPlayer.play();
                } else {
                    requestAudioFocusInternal();
                    mMediaPlayer.play();
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
        autoAspectRatio = auto;
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
     * Set the resize mode for video display
     * 
     * @param resizeMode The resize mode: "contain", "cover", "fill", "none", or
     *                   "scale-down"
     */
    public void setResizeMode(String resizeMode) {
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
                    this.resizeMode = resizeMode;
                    break;
                default:
                    Log.w(TAG, "Invalid resizeMode: " + resizeMode + ", defaulting to 'contain'");
                    this.resizeMode = "contain";
                    break;
            }
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

        // Wait until we have valid video dimensions
        if (mVideoWidth <= 0 || mVideoHeight <= 0) {
            Log.d(TAG, "Video dimensions not available yet, deferring resize mode application");
            return;
        }

        // Use view dimensions instead of screen dimensions
        int viewWidth = getWidth();
        int viewHeight = getHeight();

        if (viewWidth <= 0 || viewHeight <= 0) {
            Log.d(TAG, "View dimensions not available yet, deferring resize mode application");
            return;
        }

        // Don't apply if auto aspect ratio is enabled
        if (autoAspectRatio) {
            Log.d(TAG, "Auto aspect ratio is enabled, skipping resize mode application");
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

        // Calculate SAR-corrected display dimensions
        float sarFactor = (mSarNum > 0 && mSarDen > 0) ? (float) mSarNum / mSarDen : 1.0f;
        float videoDisplayWidth = mVideoWidth * sarFactor;
        float videoDisplayHeight = mVideoHeight; // Height is not affected by SAR

        // Calculate scale factors based on DISPLAY dimensions (not pixel dimensions)
        // This ensures SAR is properly accounted for in the zoom calculation
        float scaleX = (float) viewWidth / videoDisplayWidth;
        float scaleY = (float) viewHeight / videoDisplayHeight;

        // Cover mode: use the LARGER scale to ensure video fills the view completely
        // This will cause cropping on the dimension that doesn't match
        float coverScale = Math.max(scaleX, scaleY);

        mMediaPlayer.setScale(coverScale);
        Log.i(TAG, String.format("Cover mode: scale=%.3f (SAR=%.2f, videoDisplay=%.0fx%.0f, view=%dx%d)",
                coverScale, sarFactor, videoDisplayWidth, videoDisplayHeight, viewWidth, viewHeight));
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
        if (mSarNum > 0 && mSarDen > 0) {
            String ar = (mVideoWidth * mSarNum) + ":" + (mVideoHeight * mSarDen);
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
        if (mSarNum > 0 && mSarDen > 0) {
            String ar = (mVideoWidth * mSarNum) + ":" + (mVideoHeight * mSarDen);
            mMediaPlayer.setAspectRatio(ar);
            sarFactor = (float) mSarNum / mSarDen;
        } else {
            mMediaPlayer.setAspectRatio(null);
        }

        int viewWidth = getWidth();
        int viewHeight = getHeight();

        // Calculate Display Dimensions
        float displayWidth = mVideoWidth * sarFactor;
        float displayHeight = mVideoHeight;

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
        // Shutdown executor
        if (seekExecutor != null && !seekExecutor.isShutdown()) {
            seekExecutor.shutdownNow();
        }

        if (surfaceView != null) {
            surfaceView.removeOnLayoutChangeListener(onLayoutChangeListener);
        }
        // Unregister lifecycle listener
        if (themedReactContext != null) {
            themedReactContext.removeLifecycleEventListener(this);
        }
        stopPlayback();

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
        if (mMediaPlayer != null && mVideoWidth > 0 && mVideoHeight > 0) {
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
        // Called frequently, avoid logging here
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
            mVideoInfo = info;
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
