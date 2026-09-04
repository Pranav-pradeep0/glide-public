package com.yuanzhou.vlc.vlcplayer;

import static com.yuanzhou.vlc.vlcplayer.SeekVerifier.Verdict;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * The numbers here are taken from device traces, not invented.
 *
 * <p>Most of these rows are regression tests for a diagnostic that shipped wrong three
 * times. The supersession rows are the ones that matter: they carry the transposed
 * target/actual pairs that an earlier version reported as 19-35 s of drift during rapid
 * scrubbing, while every seek was in fact landing where it was asked to.
 */
public class SeekVerifierTest {

    private static final long TOLERANCE_MS = 500L;
    private static final long CURRENT_VERSION = 7L;

    private Verdict evaluate(long targetMs, long actualMs, long verifyVersion) {
        return SeekVerifier.evaluate(targetMs, actualMs, CURRENT_VERSION, verifyVersion,
                TOLERANCE_MS);
    }

    /** The common case: a live seek, not superseded. */
    private Verdict evaluate(long targetMs, long actualMs) {
        return evaluate(targetMs, actualMs, CURRENT_VERSION);
    }

    // ── Nothing outstanding ──────────────────────────────────────────────────

    @Test
    public void noOutstandingSeekIsNotVerified() {
        // -1 is the "no seek pending" sentinel. It must never be compared against a
        // position, which is how the first version came to verify one seek's landing
        // against the previous seek's target.
        assertEquals(Verdict.NOTHING_TO_VERIFY, evaluate(-1L, 6_753_522L));
    }

    // ── Landed ───────────────────────────────────────────────────────────────

    @Test
    public void landingOnTheTargetIsOnTarget() {
        // Observed after --input-fast-seek was removed: seeks land where requested.
        assertEquals(Verdict.ON_TARGET, evaluate(6_753_522L, 6_753_522L));
        assertEquals(Verdict.ON_TARGET, evaluate(6_807_945L, 6_807_945L));
        assertEquals(Verdict.ON_TARGET, evaluate(6_869_694L, 6_869_694L));
    }

    @Test
    public void landingInsideToleranceIsOnTarget() {
        assertEquals(Verdict.ON_TARGET, evaluate(5_535_978L, 5_535_978L - 500L));
        assertEquals(Verdict.ON_TARGET, evaluate(5_535_978L, 5_535_978L + 499L));
    }

    @Test
    public void toleranceIsInclusiveAtTheBoundary() {
        // Exactly at the tolerance is still on target; one past it is drift. Pinned
        // because an off-by-one here turns every boundary landing into a warning.
        assertEquals(Verdict.ON_TARGET, evaluate(1_000_000L, 1_000_500L));
        assertEquals(Verdict.DRIFTED, evaluate(1_000_000L, 1_000_501L));
    }

    // ── Genuine drift ────────────────────────────────────────────────────────

    @Test
    public void landingOutsideToleranceIsDrift() {
        // The pre-fix traces, when they were genuine: --input-fast-seek degraded the
        // demuxer's precision for the life of the input.
        assertEquals(Verdict.DRIFTED, evaluate(5_535_978L, 5_516_562L)); // 19416 ms
        assertEquals(Verdict.DRIFTED, evaluate(5_606_632L, 5_571_138L)); // 35494 ms
    }

    @Test
    public void driftIsSymmetric() {
        // Overshoot warns exactly as undershoot does. The old inline check compared
        // signed values in one of its three wrong versions.
        assertEquals(Verdict.DRIFTED, evaluate(1_000_000L, 990_000L));
        assertEquals(Verdict.DRIFTED, evaluate(1_000_000L, 1_010_000L));
    }

    // ── Supersession: the failure that produced confident nonsense ───────────

    @Test
    public void supersededSeekIsDroppedNotReportedAsDrift() {
        // Rapid scrubbing. The position belongs to a later seek, so the only honest
        // answer is to say nothing. Against the version that ignored supersession these
        // rows produced "drift: delta=19416ms" warnings about seeks that were correct.
        assertEquals(Verdict.SUPERSEDED, evaluate(5_535_978L, 5_516_562L, CURRENT_VERSION - 1L));
        assertEquals(Verdict.SUPERSEDED, evaluate(5_606_632L, 5_571_138L, CURRENT_VERSION - 3L));
    }

    @Test
    public void supersessionIsCheckedBeforeThePosition() {
        // An unreadable position on a superseded seek is still SUPERSEDED, never WAIT.
        // Ordering matters: WAIT keeps the seek outstanding, so a superseded seek that
        // returned WAIT would linger and later be judged against a newer position --
        // exactly the mis-attribution this check exists to prevent.
        assertEquals(Verdict.SUPERSEDED, evaluate(5_535_978L, -1L, CURRENT_VERSION - 1L));
    }

    @Test
    public void aSeekLandingCorrectlyIsStillDroppedOnceSuperseded() {
        // Supersession is not about whether the seek worked. It is about whether this
        // position can be attributed to it.
        assertEquals(Verdict.SUPERSEDED, evaluate(6_753_522L, 6_753_522L, CURRENT_VERSION - 1L));
    }

    // ── Position not yet readable ────────────────────────────────────────────

    @Test
    public void unreadablePositionWaitsRatherThanJudging() {
        // getTime() returns -1 before the demuxer has a position. Judging there is how
        // the check came to report a landing at 0 as multi-minute drift.
        assertEquals(Verdict.WAIT, evaluate(6_753_522L, -1L));
    }

    @Test
    public void positionZeroIsJudgedNormally() {
        // Zero is a real position, unlike -1. A seek to the start lands on target; a
        // seek far into the media that reports zero is genuine drift.
        assertEquals(Verdict.ON_TARGET, evaluate(0L, 0L));
        assertEquals(Verdict.DRIFTED, evaluate(6_753_522L, 0L));
    }
}
