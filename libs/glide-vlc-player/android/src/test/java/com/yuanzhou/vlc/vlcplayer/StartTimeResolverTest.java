package com.yuanzhou.vlc.vlcplayer;

import static com.yuanzhou.vlc.vlcplayer.StartTimeResolver.Verdict;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * The numbers here are taken from device traces, not invented.
 *
 * <p>Two of these cases are regression tests for judgements that shipped wrong. The
 * "landed early" rows are the ones that matter most: an earlier version of this logic used
 * a 2 s tolerance and treated any position past 4 s as proof the offset had been dropped,
 * so it returned CORRECT_DROPPED for them and issued a pointless seek on every successful
 * resume. It took two device sessions to notice. These rows fail instantly against that
 * version.
 */
public class StartTimeResolverTest {

    private static final long PRECISION_MS = 1_500L;
    private static final long DROPPED_EVIDENCE_MS = 4_000L;

    private Verdict evaluate(long targetMs, long actualMs, boolean correctionIssued) {
        return StartTimeResolver.evaluate(targetMs, actualMs, correctionIssued,
                PRECISION_MS, DROPPED_EVIDENCE_MS);
    }

    // ── Honoured exactly ─────────────────────────────────────────────────────

    @Test
    public void landingOnTheTargetIsApplied() {
        // Observed after removing --input-fast-seek: deltas of 0-10 ms.
        assertEquals(Verdict.APPLIED, evaluate(105_901L, 105_892L, false));
        assertEquals(Verdict.APPLIED, evaluate(3_346_734L, 3_346_734L, false));
        assertEquals(Verdict.APPLIED, evaluate(7_020_401L, 7_020_401L, false));
    }

    @Test
    public void landingWithinThePrecisionWindowIsApplied() {
        assertEquals(Verdict.APPLIED, evaluate(3_005_193L, 3_003_699L, false)); // 1494 ms
        assertEquals(Verdict.APPLIED, evaluate(1_962_367L, 1_961_703L, false)); // 664 ms
    }

    // ── Honoured but short: the case a fixed tolerance got wrong ─────────────

    @Test
    public void landingEarlyIsCorrectedNotTreatedAsDropped() {
        // Real keyframe undershoots seen while --input-fast-seek was still set.
        assertEquals(Verdict.CORRECT_PRECISION, evaluate(48_444L, 39_621L, false));    // 8.8 s
        assertEquals(Verdict.CORRECT_PRECISION, evaluate(2_402_613L, 2_399_699L, false)); // 2.9 s
        assertEquals(Verdict.CORRECT_PRECISION, evaluate(2_431_442L, 2_426_192L, false)); // 5.2 s
    }

    @Test
    public void landingEarlyIsAcceptedOnceCorrectionWasAlreadyTried() {
        // Bounds the work: one corrective seek, then live with the result.
        assertEquals(Verdict.APPLIED, evaluate(48_444L, 39_621L, true));
    }

    // ── Still queued ─────────────────────────────────────────────────────────

    @Test
    public void positionStillNearTheBeginningWaits() {
        // VLC pushes INPUT_CONTROL_SET_TIME asynchronously, so this is the normal state
        // for the first events after Playing. Reporting failure here was the first bug.
        assertEquals(Verdict.WAIT, evaluate(3_346_734L, 0L, false));
        assertEquals(Verdict.WAIT, evaluate(3_346_734L, 500L, false));
        assertEquals(Verdict.WAIT, evaluate(3_346_734L, 3_999L, false));
    }

    // ── Genuinely dropped ────────────────────────────────────────────────────

    @Test
    public void playingOnFromTheBeginningIsDropped() {
        assertEquals(Verdict.CORRECT_DROPPED, evaluate(3_346_734L, 4_000L, false));
        assertEquals(Verdict.CORRECT_DROPPED, evaluate(3_346_734L, 30_000L, false));
    }

    @Test
    public void dropAfterACorrectionIsAbandonedRatherThanLooped() {
        assertEquals(Verdict.ABANDON, evaluate(3_346_734L, 30_000L, true));
    }

    // ── Degenerate input ─────────────────────────────────────────────────────

    @Test
    public void noTargetOrUnreadablePositionWaits() {
        assertEquals(Verdict.WAIT, evaluate(0L, 5_000L, false));
        assertEquals(Verdict.WAIT, evaluate(-1L, 5_000L, false));
        assertEquals(Verdict.WAIT, evaluate(3_346_734L, -1L, false));
    }

    @Test
    public void aSmallTargetIsNotConfusedWithTheBeginning() {
        // Resuming a few seconds in: the position is close to both the target and zero,
        // and the comparative rule has to prefer the target.
        assertEquals(Verdict.APPLIED, evaluate(7_733L, 7_734L, false));
        assertEquals(Verdict.APPLIED, evaluate(29_069L, 29_060L, false));
    }
}
