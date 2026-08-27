package com.yuanzhou.vlc.vlcplayer;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import org.videolan.libvlc.Dialog;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;

import java.util.ArrayList;
import java.util.List;

/**
 * Owns the native playback objects: the {@link LibVLC} instance, its {@link MediaPlayer},
 * and the file descriptor behind a {@code content://} source.
 *
 * <p>These used to be constructed and destroyed inside the player view, which tied the
 * decoder's lifetime to a React view's lifetime. Playback that has to survive the view —
 * a foreground service, or the view being recreated for a decoder change — cannot work
 * that way. Holding them here does not by itself change when they are released; it moves
 * the decision to one place so it can be changed once.
 *
 * <p>Deliberately knows nothing about surfaces, geometry, React props or events. Callers
 * supply the listeners and attach their own video output. All methods are main-thread
 * only, which is where the view already drives creation and release.
 */
final class VlcPlaybackEngine {

    /** Everything needed to open a source, resolved from React props by the caller. */
    static final class Source {
        final String uri;
        final boolean isNetwork;
        /** LibVLC init mode: 1 constructs the instance with no options at all. */
        final int initType;
        final List<String> initOptions;
        final List<String> mediaOptions;
        final boolean hwDecoderEnabled;
        final boolean hwDecoderForced;
        /** Audio desync in milliseconds, applied as a media option. 0 to omit. */
        final long audioDesyncMs;

        Source(String uri, boolean isNetwork, int initType, List<String> initOptions,
                List<String> mediaOptions, boolean hwDecoderEnabled, boolean hwDecoderForced,
                long audioDesyncMs) {
            this.uri = uri;
            this.isNetwork = isNetwork;
            this.initType = initType;
            this.initOptions = initOptions != null ? initOptions : new ArrayList<String>();
            this.mediaOptions = mediaOptions;
            this.hwDecoderEnabled = hwDecoderEnabled;
            this.hwDecoderForced = hwDecoderForced;
            this.audioDesyncMs = audioDesyncMs;
        }
    }

    private LibVLC libvlc;
    private MediaPlayer mediaPlayer;
    private ParcelFileDescriptor currentPfd;

    /** The live player, or null when nothing is open. */
    MediaPlayer player() {
        return mediaPlayer;
    }

    boolean isOpen() {
        return mediaPlayer != null;
    }

    /**
     * Build a LibVLC instance, a player, and a media for {@code source}, and hand back the
     * player with the media already set. Any previously open player is closed first.
     *
     * @return the new player, or null if construction failed.
     */
    MediaPlayer open(Context context, Source source,
            MediaPlayer.EventListener playerListener,
            Media.EventListener mediaListener,
            Dialog.Callbacks dialogCallbacks) {

        close();

        try {
            // initType 1 means "defaults only" — passing an empty option list is not the
            // same thing to LibVLC, so the two constructors are kept distinct.
            libvlc = (source.initType == 1)
                    ? new LibVLC(context)
                    : new LibVLC(context, new ArrayList<>(source.initOptions));
            mediaPlayer = new MediaPlayer(libvlc);
            mediaPlayer.setEventListener(playerListener);
            Dialog.setCallbacks(libvlc, dialogCallbacks);

            Media media = openMedia(context, source);
            media.setEventListener(mediaListener);
            media.setHWDecoderEnabled(source.hwDecoderEnabled, source.hwDecoderForced);
            VlcLog.trace("ENGINE", "HW decoder enabled=" + source.hwDecoderEnabled
                    + " forced=" + source.hwDecoderForced);

            if (source.mediaOptions != null) {
                for (String option : source.mediaOptions) {
                    media.addOption(option);
                }
            }
            if (source.audioDesyncMs != 0) {
                media.addOption(":audio-desync=" + source.audioDesyncMs);
            }
            if (!source.isNetwork) {
                media.addOption(":input-fast-seek");
            }

            mediaPlayer.setMedia(media);
            media.release();
            VlcLog.trace("ENGINE", "opened " + describe(source));
            return mediaPlayer;
        } catch (Exception e) {
            VlcLog.error("ENGINE", "open failed: " + e.getMessage(), e);
            close();
            return null;
        }
    }

    /** Enough to identify a failing source without putting its full path in the log. */
    private static String describe(Source source) {
        final String kind = source.isNetwork
                ? "network"
                : source.uri.startsWith("content://") ? "content" : "file";
        return kind
                + " initType=" + source.initType
                + " initOptions=" + source.initOptions.size()
                + " mediaOptions=" + (source.mediaOptions == null ? 0 : source.mediaOptions.size())
                + " hw=" + source.hwDecoderEnabled + "/" + source.hwDecoderForced
                + " desync=" + source.audioDesyncMs;
    }

    /**
     * A {@code content://} source is opened through a file descriptor rather than handed
     * to LibVLC as a URI, because LibVLC cannot resolve Android content providers. The
     * descriptor has to outlive this call, so the engine holds it until close.
     */
    private Media openMedia(Context context, Source source) throws Exception {
        if (source.isNetwork) {
            return new Media(libvlc, Uri.parse(source.uri));
        }
        if (!source.uri.startsWith("content://")) {
            return new Media(libvlc, source.uri);
        }
        try {
            ParcelFileDescriptor pfd = context.getContentResolver()
                    .openFileDescriptor(Uri.parse(source.uri), "r");
            if (pfd == null) {
                throw new Exception("null file descriptor for " + source.uri);
            }
            closePfd();
            currentPfd = pfd;
            return new Media(libvlc, pfd.getFileDescriptor());
        } catch (Exception e) {
            // Better a URI LibVLC may not resolve than no playback attempt at all.
            VlcLog.error("ENGINE", "content:// descriptor failed, falling back to URI: "
                    + e.getMessage());
            return new Media(libvlc, Uri.parse(source.uri));
        }
    }

    /**
     * Release the player, the LibVLC instance and any open descriptor. Safe to call when
     * nothing is open. Callers must detach their video output first: the engine does not
     * know which views are attached.
     */
    void close() {
        if (mediaPlayer != null) {
            if (libvlc != null) {
                // Drop dialog callbacks before release; they close over the caller.
                Dialog.setCallbacks(libvlc, null);
            }
            mediaPlayer.release();
            mediaPlayer = null;
            VlcLog.trace("ENGINE", "player released");
        }
        if (libvlc != null) {
            libvlc.release();
            libvlc = null;
        }
        closePfd();
    }

    private void closePfd() {
        if (currentPfd != null) {
            try {
                currentPfd.close();
            } catch (Exception ignored) {
                // Nothing useful to do; the descriptor is going away regardless.
            }
            currentPfd = null;
        }
    }
}
