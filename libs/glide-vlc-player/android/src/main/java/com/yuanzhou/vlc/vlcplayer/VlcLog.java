package com.yuanzhou.vlc.vlcplayer;

import android.util.Log;

/**
 * Logging for the player, with one tag and a runtime switch.
 *
 * <p>Playback is a long-running loop, so anything logged per frame, per progress tick or
 * per window resize floods logcat and costs real work in release builds. At the same time
 * a player that says nothing is impossible to diagnose on a user's device. This splits the
 * difference the way the platform intends:
 *
 * <ul>
 *   <li>{@link #trace} is off by default and carries the play-by-play — events, geometry,
 *       seeks, surface changes.</li>
 *   <li>{@link #warn} and {@link #error} are always on and carry only things a developer
 *       would act on.</li>
 * </ul>
 *
 * <p>Turn tracing on against an installed build, with no rebuild and no code change:
 *
 * <pre>adb shell setprop log.tag.GlideVLC VERBOSE</pre>
 *
 * <p>The property is read once, when this class is first loaded, so set it and relaunch.
 *
 * <p>Java evaluates arguments before the call, so a {@code trace} whose message is built
 * by string concatenation still does that work even when tracing is off. On the few paths
 * that run continuously, guard the call with {@link #tracing()}.
 */
final class VlcLog {

    static final String TAG = "GlideVLC";

    private static final boolean TRACING = Log.isLoggable(TAG, Log.VERBOSE);

    private VlcLog() {
    }

    /** True when the play-by-play is being recorded. Guard hot-path messages with this. */
    static boolean tracing() {
        return TRACING;
    }

    /**
     * A discrete record of what the player was asked to do, or what it decided.
     *
     * <p>Deliberately logged at warning level so a session can be reconstructed from
     * {@code adb logcat -s GlideVLC:W} with no property to set and no rebuild. That is a
     * departure from the split between {@link #trace} and {@link #warn}, so it comes with
     * two rules that keep it honest:
     *
     * <ul>
     *   <li><b>One line per discrete event.</b> Never per frame, per progress tick, per
     *       buffering sample or per layout pass — those stay in {@link #trace}. A whole
     *       viewing session should produce a couple of dozen lines.</li>
     *   <li><b>No media identity.</b> No path, filename, title or URI. The journal records
     *       that a local file was opened, not which one.</li>
     * </ul>
     *
     * <p>Prefixed {@code EVT} so it can be separated from real warnings:
     * {@code adb logcat -s GlideVLC:W | grep EVT}.
     */
    static void event(String section, String message) {
        Log.w(TAG, "[EVT] " + section + ": " + message);
    }

    /** Play-by-play. Silent unless tracing is enabled. */
    static void trace(String section, String message) {
        if (TRACING) {
            Log.d(TAG, "[" + section + "] " + message);
        }
    }

    /** Something unexpected that playback recovered from. Always logged. */
    static void warn(String section, String message) {
        Log.w(TAG, "[" + section + "] " + message);
    }

    /** Something that broke. Always logged. */
    static void error(String section, String message) {
        Log.e(TAG, "[" + section + "] " + message);
    }

    /** Something that broke, with the throwable that proves it. Always logged. */
    static void error(String section, String message, Throwable cause) {
        Log.e(TAG, "[" + section + "] " + message, cause);
    }
}
