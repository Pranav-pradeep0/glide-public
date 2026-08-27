package com.yuanzhou.vlc.vlcplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.media3.session.DefaultMediaNotificationProvider;
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

    /**
     * Set once the service has begun stopping, so the settle-then-stop below runs at most
     * once. A start command is still delivered after {@link #onCreate} calls it, which
     * would otherwise post and withdraw a second notification and log the same warning
     * twice.
     */
    private boolean stopping;

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
            stopWithoutStrandingForeground();
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
     * Media3 returns {@code START_STICKY}, which is right for a player that owns its own
     * media and can rebuild after the process dies. This one cannot. The LibVLC player
     * lives in the React view and {@link VlcPlaybackHost} is static, so both die with the
     * process; a restarted service would have no player to describe and no session to
     * rebuild. Left sticky, the platform restarts it, the restart lands in the no-host
     * path, and the service is killed for never going foreground — forever.
     *
     * <p>A sticky restart is recognisable by its null intent.
     */
    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null || VlcPlaybackHost.get() == null) {
            VlcLog.warn("SERVICE", "start with no playback state (intent="
                    + (intent == null ? "null/restart" : "present") + "), stopping");
            stopWithoutStrandingForeground();
            return Service.START_NOT_STICKY;
        }
        super.onStartCommand(intent, flags, startId);
        return Service.START_NOT_STICKY;
    }

    /**
     * Stop in a way the platform accepts.
     *
     * <p>If this service was started with {@code startForegroundService()} — which Media3
     * does itself, and which the platform does when restarting a service that had been in
     * the foreground — then returning without a {@code startForeground()} call is a
     * {@code ForegroundServiceDidNotStartInTimeException}, and the whole process is killed.
     * Posting a notification and immediately withdrawing it settles that debt. When the
     * start did not require foreground, this costs one notification the user never sees.
     */
    private void stopWithoutStrandingForeground() {
        if (stopping) {
            return;
        }
        stopping = true;
        try {
            startForeground(DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID,
                    buildHandoffNotification());
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (Exception e) {
            // Android 12+ can refuse a foreground start from the background. Nothing more
            // can be done here, and crashing on the way out helps no one.
            VlcLog.warn("SERVICE", "could not settle foreground state: " + e);
        }
        stopSelf();
    }

    /**
     * Deliberately Media3's own channel and notification id rather than a second set.
     * A channel is permanently visible in the app's notification settings once created, so
     * inventing one here would leave the user a category for a notification that only ever
     * exists for the microseconds between posting and withdrawing it. Reusing Media3's
     * means nothing new appears, and there is no session posting under this id in the only
     * path that reaches here.
     */
    private Notification buildHandoffNotification() {
        final NotificationManager manager = getSystemService(NotificationManager.class);
        final String channelId = DefaultMediaNotificationProvider.DEFAULT_CHANNEL_ID;
        if (manager != null && manager.getNotificationChannel(channelId) == null) {
            final NotificationChannel channel = new NotificationChannel(channelId,
                    getString(DefaultMediaNotificationProvider.DEFAULT_CHANNEL_NAME_RESOURCE_ID),
                    NotificationManager.IMPORTANCE_LOW);
            manager.createNotificationChannel(channel);
        }
        return new Notification.Builder(this, channelId)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(false)
                .build();
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
