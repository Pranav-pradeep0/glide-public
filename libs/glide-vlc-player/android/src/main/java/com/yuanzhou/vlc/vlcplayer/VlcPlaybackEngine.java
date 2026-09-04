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
        /**
         * Where playback should begin, in seconds. 0 to start at the beginning.
         *
         * <p>This is how resume works. VLC opens the demuxer at this offset, so there is
         * no seek to race: the alternative was seeking shortly after playback started,
         * and LibVLC drops a {@code setTime} issued during its startup ramp even though
         * {@code isSeekable()} and {@code getLength()} already report ready.
         */
        final double startTimeSec;

        Source(String uri, boolean isNetwork, int initType, List<String> initOptions,
                List<String> mediaOptions, boolean hwDecoderEnabled, boolean hwDecoderForced,
                long audioDesyncMs, double startTimeSec) {
            this.uri = uri;
            this.isNetwork = isNetwork;
            this.initType = initType;
            this.initOptions = initOptions != null ? initOptions : new ArrayList<String>();
            this.mediaOptions = mediaOptions;
            this.hwDecoderEnabled = hwDecoderEnabled;
            this.hwDecoderForced = hwDecoderForced;
            this.audioDesyncMs = audioDesyncMs;
            this.startTimeSec = startTimeSec;
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

            final List<String> applied = new ArrayList<>();
            if (source.mediaOptions != null) {
                for (String option : source.mediaOptions) {
                    media.addOption(option);
                    applied.add(option);
                }
            }
            if (source.audioDesyncMs != 0) {
                final String option = ":audio-desync=" + source.audioDesyncMs;
                media.addOption(option);
                applied.add(option);
            }
            if (source.startTimeSec > 0d) {
                // VLC declares start-time with add_float, so a fractional value is valid;
                // this is deliberately not rounded to whole seconds. VLC's own Android app
                // uses the same media option for resume, so this is the supported route
                // rather than a seek issued after playback starts.
                //
                // Note that input.c applies it by pushing INPUT_CONTROL_SET_TIME, which is
                // asynchronous: the position is not in effect when the Playing event
                // fires. The view's confirmation logic depends on that fact.
                final String option = ":start-time=" + source.startTimeSec;
                media.addOption(option);
                applied.add(option);
            }
            // input-fast-seek is deliberately NOT set. VLC reads it once per input
            // (priv->b_fast_seek = var_GetBool(p_input, "input-fast-seek")) and then passes
            // !b_fast_seek as the precision argument to every DEMUX_SET_TIME and
            // DEMUX_SET_POSITION, so it degrades every seek for the life of the input.
            // A per-call precise request cannot override it: MediaPlayer.setTime(long)
            // already asks for a precise seek, and device traces still showed user seeks
            // landing 19-35 s from the requested time and resume landing 2-9 s early.
            // Precision matters more here than seek latency, which is also VLC's own
            // default -- its Android app treats fast seek as an opt-in setting.

            mediaPlayer.setMedia(media);
            media.release();
            // Journalled, not traced. This is the line that proves what actually reached
            // VLC, and resume cannot be diagnosed without it: the previous count reported
            // only the JavaScript-supplied options, omitting the engine's own
            // :start-time, and that misleading zero was read as proof the offset was
            // never sent. describe() carries no media identity, so it satisfies the
            // journal's rule and can be read from a release build with nothing enabled.
            VlcLog.event("ENGINE", "opened " + describe(source)
                    + " appliedMediaOptions=" + applied);
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
                + " jsMediaOptions=" + (source.mediaOptions == null ? 0 : source.mediaOptions.size())
                + " hw=" + source.hwDecoderEnabled + "/" + source.hwDecoderForced
                + " desync=" + source.audioDesyncMs
                + " startTime=" + source.startTimeSec;
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
            // Detach before releasing, for a concrete reason: setEventListener calls
            // removeCallbacksAndMessages on the handler it was dispatching through, so
            // this discards events already queued for the main thread. Without it, an
            // event posted just before release runs afterwards against a freed player,
            // which surfaces as "IllegalStateException: can't get VLCObject instance" --
            // the same failure the Media3 adapter was hardened against in section 9.
            //
            // Not a data race. Events are delivered on the main thread (see the note on
            // the view's listener), so they cannot overlap this call, only queue behind it.
            mediaPlayer.setEventListener(null);
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
