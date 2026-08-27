package com.yuanzhou.vlc.vlcplayer;

import android.content.Intent;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Foreground service that owns the media session and its notification.
 *
 * <p>Two things make this necessary rather than decorative. Android refuses audio focus to
 * a background app from target SDK 35, and refuses background audio outright from target
 * SDK 37 unless a while-in-use foreground service is running — so an Activity-owned player
 * cannot honestly claim background playback. And the session notification, media buttons
 * and lock-screen controls were all hand-written inside the player view, where every bug
 * had to be found and fixed by hand. Media3 derives all of it from the player's state.
 *
 * <p>The service and the player view are separate objects in one process that have to find
 * each other, and object references cannot travel through an Intent. {@link VlcPlaybackHost}
 * is that meeting point. It holds a single host and is cleared when the view goes away, so
 * the service never keeps a destroyed view alive.
 */
public final class GlidePlaybackService extends MediaSessionService {

    @Nullable
    private MediaSession session;
    @Nullable
    private VlcMedia3Player player;

    @Override
    public void onCreate() {
        super.onCreate();

        final VlcMedia3Player.Host host = VlcPlaybackHost.get();
        if (host == null) {
            // Nothing is playing; there is no state for a session to describe.
            VlcLog.warn("SERVICE", "started with no playback host, stopping");
            stopSelf();
            return;
        }

        player = new VlcMedia3Player(Looper.getMainLooper(), host);
        session = new MediaSession.Builder(this, player).build();

        // Register the session with the service explicitly. Building a session does not
        // hand it to the service: onGetSession only fires when a MediaController connects,
        // and Glide's UI drives the player directly rather than through a controller. With
        // no controller ever connecting, the service would never adopt the session, never
        // observe the player, and so never post a notification or go foreground.
        addSession(session);

        VlcPlaybackHost.setPlayer(player);
        VlcLog.trace("SERVICE", "session created and registered");
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    /**
     * Media3 calls this when it wants the notification shown or refreshed. Logged because
     * a foreground-service notification cannot be hidden by the user, so if none appears
     * the question is always whether this was reached and whether foreground was asked
     * for — not whether the device chose to suppress it.
     */
    @Override
    public void onUpdateNotification(MediaSession callingSession, boolean startInForegroundRequired) {
        VlcLog.trace("SERVICE", "onUpdateNotification startInForeground=" + startInForegroundRequired
                + " playbackOngoing=" + isPlaybackOngoing());
        super.onUpdateNotification(callingSession, startInForegroundRequired);
    }

    /**
     * Dismissing the task stops playback. This is a video player: audio that outlives the
     * task the user just swiped away is audio they cannot find their way back to. The
     * product copy has to keep saying the same thing.
     */
    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        final VlcMedia3Player.Host host = VlcPlaybackHost.get();
        if (host != null) {
            host.onTransportStop();
        }
        VlcLog.trace("SERVICE", "task removed, stopping playback");
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        VlcPlaybackHost.setPlayer(null);
        if (session != null) {
            removeSession(session);
            session.release();
            session = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        VlcLog.trace("SERVICE", "destroyed");
        super.onDestroy();
    }
}
