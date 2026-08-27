package com.yuanzhou.vlc.vlcplayer;

import android.content.Context;
import android.content.Intent;

import androidx.annotation.Nullable;

/**
 * Where the player view and the playback service find each other.
 *
 * <p>They live in one process but are created independently by the system, and an Intent
 * cannot carry an object reference. Glide plays one video at a time, so a single slot is
 * enough — a list would imply a second concurrent player that cannot exist.
 *
 * <p>The reference is strong, so clearing it matters: {@link #clear} must be called when
 * the view is torn down, or the service keeps a dead view and its Activity alive. Main
 * thread only, which is where both the view and the service are created.
 */
final class VlcPlaybackHost {

    @Nullable
    private static VlcMedia3Player.Host host;
    @Nullable
    private static VlcMedia3Player player;

    private VlcPlaybackHost() {
    }

    @Nullable
    static VlcMedia3Player.Host get() {
        return host;
    }

    /** The live adapter, once the service has built one. Null when no session exists. */
    @Nullable
    static VlcMedia3Player player() {
        return player;
    }

    static void setPlayer(@Nullable VlcMedia3Player value) {
        player = value;
    }

    /** Publish the host and start the session service. */
    static void start(Context context, VlcMedia3Player.Host value) {
        host = value;
        final Intent intent = new Intent(context.getApplicationContext(), GlidePlaybackService.class);
        try {
            context.getApplicationContext().startService(intent);
            VlcLog.trace("SERVICE", "start requested");
        } catch (Exception e) {
            // A background start can be refused; playback still works, only the session
            // and its notification are missing.
            VlcLog.warn("SERVICE", "could not start playback service: " + e.getMessage());
        }
    }

    /** Drop the host and stop the session service. Safe to call more than once. */
    static void clear(Context context, VlcMedia3Player.Host value) {
        if (host != value) {
            // A newer view already took over; leave its registration alone.
            return;
        }
        host = null;
        try {
            context.getApplicationContext()
                    .stopService(new Intent(context.getApplicationContext(), GlidePlaybackService.class));
            VlcLog.trace("SERVICE", "stop requested");
        } catch (Exception e) {
            VlcLog.warn("SERVICE", "could not stop playback service: " + e.getMessage());
        }
    }
}
