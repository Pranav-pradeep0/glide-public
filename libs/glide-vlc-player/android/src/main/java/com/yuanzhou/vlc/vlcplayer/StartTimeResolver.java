package com.yuanzhou.vlc.vlcplayer;

/**
 * Decides what a pending {@code :start-time} offset means, given where playback actually is.
 *
 * <p>Deliberately free of the player, of Android, and of logging: longs in, verdict out.
 * That is the whole point of it existing separately. The judgement below was wrong three
 * times while it lived inside the event handler, and each wrong version was only
 * discoverable by installing a build and reading logcat:
 *
 * <ul>
 *   <li>it compared the position at the {@code Playing} event, where VLC has not yet
 *       applied the offset — {@code StartTitle()} pushes INPUT_CONTROL_SET_TIME
 *       asynchronously — so a correct resume looked like a failure;</li>
 *   <li>it then used a fixed 2 s tolerance and treated "playback advanced past 4 s from
 *       the beginning" as proof the offset was dropped. VLC seeks to a keyframe at or
 *       before the request, so a device trace showed arrivals 2.9 s, 5.2 s and 8.8 s
 *       early — near the target, nowhere near the beginning — and every successful resume
 *       was reported as ignored and pointlessly corrected.</li>
 * </ul>
 *
 * <p>The rule that survives is comparative and needs no tolerance at all: the offset was
 * honoured if playback is nearer the requested time than it is to the beginning, because
 * nothing else could have put the playhead there.
 */
final class StartTimeResolver {

    /** What the caller should do about a pending offset. */
    enum Verdict {
        /** Nothing observable yet; the queued control may still land. */
        WAIT,
        /** Playback is at the requested position. Stop tracking it. */
        APPLIED,
        /** Honoured but short of the target by more than the caller cares to lose. */
        CORRECT_PRECISION,
        /** Playback ran on from the beginning; the offset never took effect. */
        CORRECT_DROPPED,
        /** A correction was already issued and did not help. Give up rather than loop. */
        ABANDON
    }

    private StartTimeResolver() {
    }

    /**
     * @param targetMs          where playback was asked to start, in milliseconds.
     * @param actualMs          where playback actually is, in milliseconds.
     * @param correctionIssued  whether a corrective seek has already been made for this
     *                          offset. It bounds the work: a second failure abandons
     *                          rather than seeking for the rest of the session.
     * @param precisionMs       how far short of the target is tolerated without correcting.
     * @param droppedEvidenceMs how far playback must have advanced from the beginning
     *                          before an absent offset counts as dropped rather than
     *                          merely still queued.
     */
    static Verdict evaluate(long targetMs, long actualMs, boolean correctionIssued,
            long precisionMs, long droppedEvidenceMs) {
        if (targetMs <= 0L || actualMs < 0L) {
            return Verdict.WAIT;
        }

        final long deltaMs = Math.abs(actualMs - targetMs);

        // Nearer the target than the beginning: the offset was honoured.
        if (deltaMs < actualMs) {
            if (deltaMs <= precisionMs) {
                return Verdict.APPLIED;
            }
            // Short of the target. Correct once, then accept whatever the second attempt
            // produced rather than seeking repeatedly.
            return correctionIssued ? Verdict.APPLIED : Verdict.CORRECT_PRECISION;
        }

        // Nearer the beginning. Either the control is still queued, or it never arrived.
        if (actualMs < droppedEvidenceMs) {
            return Verdict.WAIT;
        }
        return correctionIssued ? Verdict.ABANDON : Verdict.CORRECT_DROPPED;
    }
}
