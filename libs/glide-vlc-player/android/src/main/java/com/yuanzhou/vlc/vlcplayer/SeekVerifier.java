package com.yuanzhou.vlc.vlcplayer;

/**
 * Decides whether a committed seek can be judged yet, and whether it landed.
 *
 * <p>Deliberately free of the player, of Android, and of logging: longs in, verdict out —
 * the same shape as {@link StartTimeResolver}, and for the same reason. This judgement was
 * wrong three separate times while it lived inline in the event handler, and every wrong
 * version produced confident warnings about seeks that were working correctly:
 *
 * <ul>
 *   <li>it verified on the {@code Playing} event, which can arrive before the seek has
 *       been honoured, so it compared the live position against the previous seek;</li>
 *   <li>it cleared the target it needed to compare against before the comparison;</li>
 *   <li>it ignored supersession, attributing a position to a seek that a later seek had
 *       already replaced. During rapid scrubbing this reported transposed target/actual
 *       pairs as 19-35 s of drift while every seek was in fact landing correctly.</li>
 * </ul>
 *
 * <p>A check that cannot be trusted is worse than no check: the drift warnings sent two
 * device sessions looking for a seek bug that did not exist, while the real defect
 * ({@code --input-fast-seek}, degrading demuxer precision for the life of the input) sat
 * in the media options untouched.
 */
final class SeekVerifier {

    /** What the caller should report about a committed seek. */
    enum Verdict {
        /** No seek is outstanding, or the player could not be read. Say nothing. */
        NOTHING_TO_VERIFY,
        /** A later seek was dispatched. This one can no longer be attributed. Drop it. */
        SUPERSEDED,
        /** The position is not yet usable. Keep the seek outstanding and re-check. */
        WAIT,
        /** Landed within tolerance. Trace it. */
        ON_TARGET,
        /** Landed outside tolerance. This is the only case worth warning about. */
        DRIFTED
    }

    private SeekVerifier() {
    }

    /**
     * @param targetMs        where the seek asked to land, or negative when none is
     *                        outstanding.
     * @param actualMs        the player's current position, or negative when it could not
     *                        be read.
     * @param seekVersion     the version counter at the time of this call.
     * @param verifyVersion   the version captured when the outstanding seek was dispatched.
     * @param toleranceMs     how far from the target still counts as landing on it.
     */
    static Verdict evaluate(long targetMs, long actualMs, long seekVersion, long verifyVersion,
            long toleranceMs) {
        if (targetMs < 0L) {
            return Verdict.NOTHING_TO_VERIFY;
        }
        // Supersession is checked before the position is read, not after. A newer seek
        // makes the position meaningless regardless of what it says.
        if (verifyVersion != seekVersion) {
            return Verdict.SUPERSEDED;
        }
        if (actualMs < 0L) {
            return Verdict.WAIT;
        }
        return Math.abs(actualMs - targetMs) > toleranceMs ? Verdict.DRIFTED : Verdict.ON_TARGET;
    }
}
