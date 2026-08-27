package com.yuanzhou.vlc.vlcplayer;

import android.os.Looper;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.videolan.libvlc.MediaPlayer;

/**
 * Presents LibVLC playback as a Media3 {@link Player}, so a {@code MediaSessionService}
 * can own the media session, its notification, and media button handling.
 *
 * <p><b>This mirrors LibVLC rather than replacing it.</b> The React view still drives the
 * LibVLC player directly, as it always has; this adapter reports that player's state and
 * forwards transport commands back to it. Making React drive Media3 instead would mean
 * rewriting every call site in the view for no gain — the session only needs a truthful
 * view of playback and a way to send play, pause, seek and stop.
 *
 * <p>Position is exposed as a {@link PositionSupplier}, so the session reads the live
 * value rather than extrapolating from a position and a speed. That is what makes the
 * notification clock correct by construction: there is no speed to get wrong, and a
 * paused player simply keeps returning the same number.
 */
final class VlcMedia3Player extends SimpleBasePlayer {

    /** What the adapter needs from whoever owns the LibVLC player. */
    interface Host {
        /** The live player, or null when nothing is open. */
        MediaPlayer player();

        /** True when the user wants playback, regardless of what LibVLC is doing. */
        boolean playWhenReady();

        /** True while LibVLC is buffering. */
        boolean buffering();

        /** True once playback has run to the end. */
        boolean ended();

        /** Title and artist for the notification. */
        MediaMetadata metadata();

        void onTransportPlayWhenReady(boolean playWhenReady);

        void onTransportSeek(long positionMs);

        void onTransportStop();

        void onTransportSpeed(float speed);
    }

    private static final Player.Commands COMMANDS = new Player.Commands.Builder()
            .addAll(
                    Player.COMMAND_PLAY_PAUSE,
                    Player.COMMAND_PREPARE,
                    Player.COMMAND_STOP,
                    Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_BACK,
                    Player.COMMAND_SEEK_FORWARD,
                    Player.COMMAND_SET_SPEED_AND_PITCH,
                    Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_GET_TIMELINE,
                    Player.COMMAND_GET_METADATA)
            .build();

    /** Stable id for the single item; Glide plays one source at a time. */
    private static final String ITEM_UID = "glide-media";

    private final Host host;

    /**
     * Last position read successfully. A released LibVLC player throws rather than
     * returning anything, and Media3 keeps position suppliers from previous states alive
     * to detect discontinuities — so a supplier can outlive the player it was built for.
     * Returning the last good value keeps that from looking like a seek to zero.
     */
    private long lastKnownPositionMs;

    VlcMedia3Player(Looper looper, Host host) {
        super(looper);
        this.host = host;
    }

    /**
     * Every read of the native player goes through here.
     *
     * <p>LibVLC throws {@link IllegalStateException} once an object is released, and the
     * player is released and rebuilt whenever the decoder or video enhancement changes.
     * A null check is not enough: the reference is not null, it is dead. Callers get the
     * fallback rather than a crash.
     */
    private long readPlayer(PlayerRead read, long fallback) {
        final MediaPlayer player = host.player();
        if (player == null) {
            return fallback;
        }
        try {
            return read.from(player);
        } catch (IllegalStateException e) {
            // Released underneath us between the null check and the call.
            return fallback;
        }
    }

    private interface PlayerRead {
        long from(MediaPlayer player);
    }

    /** Live position, resilient to the player being swapped out underneath the session. */
    private long currentPositionMs() {
        // LibVLC reports -1 before a media is opened; a negative content position is not
        // meaningful to Media3, so it starts at the beginning instead.
        lastKnownPositionMs = Math.max(0L, readPlayer(MediaPlayer::getTime, lastKnownPositionMs));
        return lastKnownPositionMs;
    }

    /** Call whenever LibVLC's state changes, so the session and notification follow. */
    void notifyStateChanged() {
        invalidateState();
    }

    @Override
    protected State getState() {
        final MediaPlayer player = host.player();
        final State.Builder state = new State.Builder().setAvailableCommands(COMMANDS);

        if (player == null) {
            return state
                    .setPlaybackState(Player.STATE_IDLE)
                    .setPlayWhenReady(false, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
                    .build();
        }

        final long durationMs = readPlayer(MediaPlayer::getLength, 0L);
        final boolean seekable = readPlayer(p -> p.isSeekable() ? 1L : 0L, 0L) == 1L;
        final MediaItemData item = new MediaItemData.Builder(ITEM_UID)
                .setMediaItem(new MediaItem.Builder()
                        .setMediaId(ITEM_UID)
                        .setMediaMetadata(host.metadata())
                        .build())
                .setIsSeekable(seekable)
                .setIsDynamic(false)
                .setDurationUs(durationMs > 0 ? durationMs * 1000L : C.TIME_UNSET)
                .build();

        final int playbackState = playbackState(durationMs);
        VlcLog.trace("SESSION", "state=" + playbackState
                + " playWhenReady=" + host.playWhenReady()
                + " buffering=" + host.buffering()
                + " ended=" + host.ended()
                + " durationMs=" + durationMs
                + " positionMs=" + currentPositionMs());

        return state
                .setPlaybackState(playbackState)
                .setPlayWhenReady(host.playWhenReady(),
                        Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
                .setPlaylist(ImmutableList.of(item))
                .setCurrentMediaItemIndex(0)
                // Read through the host, never bound to one player instance: Media3 keeps
                // this supplier past the state it came from, and the player gets rebuilt.
                .setContentPositionMs(this::currentPositionMs)
                .build();
    }

    private int playbackState(long durationMs) {
        if (host.ended()) {
            return Player.STATE_ENDED;
        }
        if (host.buffering()) {
            return Player.STATE_BUFFERING;
        }
        // A player with no length yet has not finished opening the source.
        return durationMs > 0 ? Player.STATE_READY : Player.STATE_BUFFERING;
    }

    @Override
    protected ListenableFuture<?> handleSetPlayWhenReady(boolean playWhenReady) {
        host.onTransportPlayWhenReady(playWhenReady);
        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleSeek(int mediaItemIndex, long positionMs, int seekCommand) {
        host.onTransportSeek(positionMs);
        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleStop() {
        host.onTransportStop();
        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleRelease() {
        host.onTransportStop();
        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleSetPlaybackParameters(PlaybackParameters parameters) {
        host.onTransportSpeed(parameters.speed);
        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handlePrepare() {
        // The view opens the source; there is nothing to prepare from the session side.
        return Futures.immediateVoidFuture();
    }
}
