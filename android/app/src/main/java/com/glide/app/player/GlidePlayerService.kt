package com.glide.app.player

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.glide.app.MainActivity

/**
 * Where the player view, audio player, and the session service find each other.
 *
 * They live in one process but are created independently by the system, and an Intent
 * cannot carry an object reference.
 *
 * Main thread only, which is where both the views and the service are created.
 */
@UnstableApi
object GlidePlayerHolder {

    @JvmStatic
    var player: ExoPlayer? = null
        private set

    @JvmStatic
    var audioPlayer: ExoPlayer? = null
        private set

    private var service: GlidePlayerService? = null

    fun attachService(value: GlidePlayerService?) {
        service = value
    }

    @Synchronized
    fun getOrCreateAudioPlayer(context: Context): ExoPlayer {
        audioPlayer?.let { return it }
        val appContext = context.applicationContext
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val newPlayer = ExoPlayer.Builder(appContext)
            .setAudioAttributes(audioAttributes, /* handleAudioFocus = */ true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()

        audioPlayer = newPlayer
        return newPlayer
    }

    fun start(context: Context, value: ExoPlayer) {
        player?.takeIf { it !== value }?.pause()
        player = value
        if (service != null) {
            service?.updatePlayer(value)
        } else {
            try {
                val intent = Intent(context.applicationContext, GlidePlayerService::class.java)
                ContextCompat.startForegroundService(context.applicationContext, intent)
            } catch (e: Exception) {
                try {
                    context.applicationContext.startService(
                        Intent(context.applicationContext, GlidePlayerService::class.java)
                    )
                } catch (e2: Exception) {
                    Log.w(GlidePlayerView.TAG, "could not start playback service: ${e2.message}")
                }
            }
        }
    }

    /**
     * Must be called *before* the player is released. `stopService` is asynchronous, so
     * relying on it alone leaves the session holding a released player -- the class of bug
     * the VLC adapter kept producing. The session is therefore torn down synchronously here
     * and the service stop is only the tidy-up that follows.
     */
    fun clear(context: Context, value: ExoPlayer) {
        if (player !== value) {
            // A newer view already took over; leave its registration alone.
            return
        }
        player = null
        val audio = audioPlayer
        if (audio != null && (audio.isPlaying || audio.playWhenReady) && audio.mediaItemCount > 0) {
            // Audio is still active in the background; hand the session back to audio
            service?.updatePlayer(audio)
            return
        }
        service?.releaseSession()
        try {
            context.applicationContext.stopService(
                Intent(context.applicationContext, GlidePlayerService::class.java)
            )
        } catch (e: IllegalStateException) {
            Log.w(GlidePlayerView.TAG, "could not stop playback service: ${e.message}")
        }
    }

    fun clearAudio(context: Context) {
        val a = audioPlayer
        audioPlayer = null
        if (a != null) {
            a.stop()
            a.clearMediaItems()
            a.release()
        }
        if (player == null || player === a) {
            player = null
            service?.releaseSession()
            try {
                context.applicationContext.stopService(
                    Intent(context.applicationContext, GlidePlayerService::class.java)
                )
            } catch (e: IllegalStateException) {
                Log.w(GlidePlayerView.TAG, "could not stop playback service: ${e.message}")
            }
        }
    }
}

/**
 * Foreground service owning the media session and its notification.
 *
 * ExoPlayer *is* a Media3 `Player`, so it is handed to `MediaSession` directly.
 * There is no adapter — no `SimpleBasePlayer` subclass mirroring engine state, and so none
 * of the divergence bugs that came with mirroring it.
 */
@UnstableApi
class GlidePlayerService : MediaSessionService() {

    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        GlidePlayerHolder.attachService(this)

        val activePlayer = GlidePlayerHolder.player ?: GlidePlayerHolder.audioPlayer
        if (activePlayer == null) {
            // Nothing is playing; there is no state for a session to describe.
            Log.w(GlidePlayerView.TAG, "session service started with no player, stopping")
            stopSelf()
            return
        }

        buildAndAddSession(activePlayer)
        Log.w(GlidePlayerView.TAG, "media session created")
    }

    private fun buildAndAddSession(player: ExoPlayer) {
        if (session != null) {
            session?.player = player
            return
        }
        val sessionActivityIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Registering explicitly matters: building a session does not hand it to the
        // service. onGetSession only fires when a MediaController connects, and Glide's UI
        // drives the player directly, so with no controller the service would never adopt
        // the session, never observe the player, and never post a notification.
        session = MediaSession.Builder(this, player)
            .setSessionActivity(sessionActivityIntent)
            .build()
            .also { addSession(it) }
    }

    fun updatePlayer(newPlayer: ExoPlayer) {
        if (session == null) {
            buildAndAddSession(newPlayer)
        } else {
            session?.player = newPlayer
        }
        Log.w(GlidePlayerView.TAG, "media session updated with new player")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    fun releaseSession() {
        session?.let {
            removeSession(it)
            it.release()
        }
        session = null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val activePlayer = GlidePlayerHolder.player ?: GlidePlayerHolder.audioPlayer
        if (activePlayer == null) {
            Log.w(GlidePlayerView.TAG, "session service start with no player, stopping")
            stopSelf()
            return START_NOT_STICKY
        }
        if (session == null) {
            buildAndAddSession(activePlayer)
        }
        super.onStartCommand(intent, flags, startId)
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val activePlayer = GlidePlayerHolder.player ?: GlidePlayerHolder.audioPlayer
        if (activePlayer == null || !activePlayer.playWhenReady || activePlayer.mediaItemCount == 0) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        releaseSession()
        GlidePlayerHolder.attachService(null)
        super.onDestroy()
    }
}
