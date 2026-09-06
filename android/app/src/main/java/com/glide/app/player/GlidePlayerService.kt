package com.glide.app.player

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Where the player view and the session service find each other.
 *
 * They live in one process but are created independently by the system, and an Intent
 * cannot carry an object reference. Glide plays one video at a time, so one slot is enough.
 *
 * Main thread only, which is where both the view and the service are created.
 */
@UnstableApi
internal object GlidePlayerHolder {

    @JvmStatic
    var player: ExoPlayer? = null
        private set

    private var service: GlidePlayerService? = null

    fun attachService(value: GlidePlayerService?) {
        service = value
    }

    fun start(context: Context, value: ExoPlayer) {
        player = value
        try {
            context.applicationContext.startService(
                Intent(context.applicationContext, GlidePlayerService::class.java)
            )
        } catch (e: IllegalStateException) {
            // A background start can be refused. Playback still works; only the session and
            // its notification are missing.
            Log.w(GlidePlayerView.TAG, "could not start playback service: ${e.message}")
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
        service?.releaseSession()
        player = null
        try {
            context.applicationContext.stopService(
                Intent(context.applicationContext, GlidePlayerService::class.java)
            )
        } catch (e: IllegalStateException) {
            Log.w(GlidePlayerView.TAG, "could not stop playback service: ${e.message}")
        }
    }
}

/**
 * Foreground service owning the media session and its notification.
 *
 * This is A5: ExoPlayer *is* a Media3 `Player`, so it is handed to `MediaSession` directly.
 * There is no adapter — no `SimpleBasePlayer` subclass mirroring engine state, and so none
 * of the divergence bugs that came with mirroring it.
 */
@UnstableApi
class GlidePlayerService : MediaSessionService() {

    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        GlidePlayerHolder.attachService(this)

        val player = GlidePlayerHolder.player
        if (player == null) {
            // Nothing is playing; there is no state for a session to describe.
            Log.w(GlidePlayerView.TAG, "session service started with no player, stopping")
            stopSelf()
            return
        }

        // Registering explicitly matters: building a session does not hand it to the
        // service. onGetSession only fires when a MediaController connects, and Glide's UI
        // drives the player directly, so with no controller the service would never adopt
        // the session, never observe the player, and never post a notification.
        session = MediaSession.Builder(this, player).build().also { addSession(it) }
        Log.w(GlidePlayerView.TAG, "media session created")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    fun releaseSession() {
        session?.release()
        session = null
    }

    /**
     * Media3 returns START_STICKY, which suits a service that owns its media and can
     * rebuild after the process dies. This one cannot: the player lives in the React view
     * and the holder is static, so both die with the process. Left sticky, the platform
     * restarts it, the restart finds no player, and the service is killed for never going
     * foreground — forever. A sticky restart is recognisable by its null intent.
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null || GlidePlayerHolder.player == null) {
            Log.w(GlidePlayerView.TAG, "session service start with no player, stopping")
            stopSelf()
            return START_NOT_STICKY
        }
        super.onStartCommand(intent, flags, startId)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseSession()
        GlidePlayerHolder.attachService(null)
        super.onDestroy()
    }
}
