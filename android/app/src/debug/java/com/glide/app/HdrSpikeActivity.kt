package com.glide.app

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer

/**
 * Phase 2 spike — does ExoPlayer render this HDR10 file correctly on this device?
 *
 * Debug source set only, so it cannot reach a release build. It exists to answer one
 * question and then be deleted.
 *
 * LibVLC 3.x demonstrably cannot: its `gles2` vout opens at 8-bit I420 and swscales 10-bit
 * away, and `android_display` never tags the surface as BT2020/PQ. Android's own HDR
 * guidance says a SurfaceView plus a MediaCodec configured against it needs "no special
 * handling" and recommends ExoPlayer, which "supports HDR by default". This checks that
 * claim against the exact file and device rather than trusting it.
 *
 * Deliberately minimal: no controls, no session, no React. A SurfaceView and a player.
 * Anything else added here weakens what the result proves.
 *
 *   adb shell am start -n com.glide.app/.HdrSpikeActivity \
 *       -e path "/storage/emulated/0/Download/your-hdr-file.mkv"
 */
class HdrSpikeActivity : Activity() {

    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val path = intent.getStringExtra("path")
        if (path.isNullOrBlank()) {
            Log.e(TAG, "no -e path supplied; nothing to play")
            finish()
            return
        }

        // SurfaceView, not TextureView. This is the whole point: TextureView transcodes
        // HDR to SDR on Android 13+, which is the washout we are trying to escape.
        val surfaceView = SurfaceView(this)
        val root = FrameLayout(this)
        root.addView(
            surfaceView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        // The FFmpeg extension is inert unless the renderer is registered. MODE_ON keeps
        // platform decoders first and falls back to FFmpeg only where the device has none
        // -- which on this device is every one of AC-3, E-AC-3, DTS and TrueHD. MODE_PREFER
        // would force software decoding even where hardware exists; never use it here.
        val renderersFactory = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

        Log.w(TAG, "ffmpeg extension available=${FfmpegLibrary.isAvailable()} " +
            "version=${FfmpegLibrary.getVersion()} " +
            "eac3=${FfmpegLibrary.supportsFormat(MimeTypes.AUDIO_E_AC3)} " +
            "ac3=${FfmpegLibrary.supportsFormat(MimeTypes.AUDIO_AC3)} " +
            "dts=${FfmpegLibrary.supportsFormat(MimeTypes.AUDIO_DTS)} " +
            "truehd=${FfmpegLibrary.supportsFormat(MimeTypes.AUDIO_TRUEHD)}")

        player = ExoPlayer.Builder(this, renderersFactory).build().apply {
            setVideoSurfaceView(surfaceView)
            addListener(object : Player.Listener {
                override fun onVideoSizeChanged(videoSize: VideoSize) {
                    Log.w(TAG, "video ${videoSize.width}x${videoSize.height}")
                }

                override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                    // Every track, not just the ones with colour info. An unsupported
                    // audio track is the quiet failure mode here: ExoPlayer's selector
                    // simply does not pick a track it has no decoder for, and playback
                    // continues video-only with no error at all. isTrackSupported is the
                    // only thing that states it outright.
                    for (group in tracks.groups) {
                        for (i in 0 until group.length) {
                            val format = group.getTrackFormat(i)
                            val supported = group.isTrackSupported(i)
                            val selected = group.isTrackSelected(i)
                            val colorInfo = format.colorInfo
                            val color = if (colorInfo == null) {
                                "color=none"
                            } else {
                                "colorSpace=${colorInfo.colorSpace} " +
                                    "colorTransfer=${colorInfo.colorTransfer} " +
                                    "colorRange=${colorInfo.colorRange} " +
                                    "hdrStaticInfo=${colorInfo.hdrStaticInfo != null}"
                            }
                            Log.w(
                                TAG,
                                "track codec=${format.sampleMimeType} " +
                                    "lang=${format.language} " +
                                    "channels=${format.channelCount} " +
                                    "SUPPORTED=$supported SELECTED=$selected " + color
                            )
                        }
                    }
                }

                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    // An audio failure here is a result, not a crash to work around: it
                    // would mean this device has no E-AC-3 decoder and the FFmpeg
                    // extension is mandatory rather than optional.
                    Log.e(TAG, "player error: ${error.errorCodeName}", error)
                }
            })
            setMediaItem(MediaItem.fromUri(path))
            prepare()
            playWhenReady = true
        }

        Log.w(TAG, "spike started for $path")
    }

    override fun onDestroy() {
        super.onDestroy()
        player?.release()
        player = null
    }

    private companion object {
        const val TAG = "HdrSpike"
    }
}
