# Player engine migration — audit and plan

**Created:** 2026-09-06
**Prerequisite reading:** `docs/exoplayer-migration.md` (why), tracker §11.5–11.6 (decision).
**Status:** planning. Phase 0 complete; nothing else started.

This is the working document for replacing LibVLC with Media3/ExoPlayer. It is written to
be picked up cold, in a new session, without the conversation that produced it.

---

# Part 1 — Audit

## 1.1 The numbers

| Layer | Lines |
|---|---|
| `ReactVlcPlayerView.java` | **3,538** |
| `VlcPipController.java` | 624 |
| Rest of the native module | 1,719 |
| `VideoPlayerScreen.tsx` | 1,585 |
| Player hooks (`src/hooks/video-player`) | ~4,300 |
| Player components (`src/components/VideoPlayer`) | ~5,000 |
| `VLCPlayer.tsx` bridge | 322 |
| **Total** | **~17,000** |

`ReactVlcPlayerView` alone holds **81 state fields** and **40 Handler references**.

That is the shape of the problem. It is not that the features are many — it is that a large
fraction of the code exists to compensate for LibVLC, and every compensation added state,
and every piece of state added a way to be wrong. Three separate device-only defects this
week came from that state, not from the features.

## 1.2 The test applied

For each piece of code: **would this exist if the engine did its job?**

- **Category A — engine compensation.** Deletes itself. No port, no replacement.
- **Category B — real feature.** Must survive, on a simpler substrate.
- **Category C — bloat.** Should go regardless of engine; the migration is the excuse.

## 1.3 Category A — deletes itself

Ordered by size of the win.

### A1. The entire audio-focus subsystem

`requestAudioFocusInternal`, `abandonAudioFocusInternal`, `onAudioFocusChange` and its five
branches, the noisy-device `BroadcastReceiver`, and the fields `mHasAudioFocus`,
`mResumeOnFocusGain`, `mPausedForAudioFocus`, `mPausedForNoisyEvent`, `mVolumeBeforeDuck`,
`mAudioFocusRequest`.

Replaced by two builder calls:

```kotlin
ExoPlayer.Builder(context)
    .setAudioAttributes(audioAttributes, /* handleAudioFocus = */ true)
    .setHandleAudioBecomingNoisy(true)
```

Android's guidance is explicit: with `handleAudioFocus = true` the app "shouldn't include
any code for requesting or responding to audio focus changes". Ducking, transient loss and
resume-on-gain are handled.

**This is also where three of this week's bugs lived**: the leaked focus registration, the
`change=-1` that took four attempts to explain, and the callback reaching a torn-down view.
All of it is deleted rather than fixed.

*Caveat:* `handleAudioFocus` only accepts `USAGE_MEDIA` / `USAGE_GAME`. Glide uses
`USAGE_MEDIA`. Fine.

### A2. Resume-offset machinery

`mPendingStartTimeSec`, `setPendingStartTime`, `mStartTimeCorrectionIssued`,
`StartTimeResolver` (+ its 9 tests), `resolvePendingStartTime`,
`seekForStartTimeCorrection`, `:start-time` media-option plumbing, and the
`START_TIME_PRECISION_MS` / `START_TIME_IGNORED_EVIDENCE_MS` constants.

Replaced by:

```kotlin
player.setMediaItem(mediaItem, startPositionMs)
```

An entire subsystem — built over three device sessions, wrong three times — becomes an
argument. Keep `StartTimeResolverTest` in git history as a record; delete the code.

### A3. Seek verification and settle windows

Native: `SeekVerifier` (+ 11 tests), `mSeekVersion`, `mSeekVerifyVersion`,
`mLastSeekTargetMs`, `logSeekVerification`, `SEEK_BUFFER_TIMEOUT_MS` and its safety timer,
the `pendingSeekPlay` sentinel and the pause→setTime→play dance for seeking a stopped
player.

JS: `pendingCommittedSeekRef`, `seekSettledUntilRef`, `SEEK_SETTLE_WINDOW_MS`.

ExoPlayer's `seekTo` is reliable and reports `onPositionDiscontinuity`, so stale-progress
filtering is unnecessary. Seeking works in any state, so the stopped-player dance goes.

### A4. Video enhancement recreate

`mRequestedEnhancement`, `mEnhancementGeneration`, `mEnhancementRecreateInFlight`,
`mPendingEnhancementTarget`, `mPendingEnhancementRunnable`,
`mPendingEnhancementRestoreRunnable`, `mEnhancementCompatiblePipeline`,
`shouldUseEnhancementCompatiblePipeline`, `buildEnhancementInitOptions`,
`applyEnhancementWithRecreate`, `VlcAdjustBridge` and its JNI `.so`.

Replaced by:

```kotlin
player.setVideoEffects(listOf(HslAdjustment.Builder()…build(), Contrast(…)))
```

No player recreate, no `--no-mediacodec-dr`, no software-decode fallback, no RGB565, no
sticky pipeline flag. **This also fixes the defect** where enabling enhancement dropped the
device to software 4K decode and stayed there for the session.

### A5. The Media3 adapter

`VlcMedia3Player` (221 lines of `SimpleBasePlayer` mirroring VLC state) and
`VlcPlaybackHost` (73). ExoPlayer *is* a Media3 `Player`; hand it to `MediaSession`
directly. Deletes the position-supplier-outliving-a-released-player bug, the
session-never-registered bug, and the PiP-close state divergence.

### A6. Retry and coalescing for calls VLC rejects when early

`mPendingAudioTrackRunnable`, `scheduleAudioTrackApply`, the `applied track=N via es|prop`
retry path, and the progress-polling Handler.

Track selection is `TrackSelectionParameters`; position is `player.currentPosition`.

### A7. Subtitle extraction for *display*

ExoPlayer parses embedded subtitles natively — 7 tracks, instantly, versus 1.5–3.0 s per
track through `ffmpeg-kit`. Display cues come from `Player.Listener.onCues`.

**Haptics keeps the extraction path** (§1.4 B7).

### A8. Init-option plumbing

`getOptimizedInitOptions`, `buildEffectiveInitOptions`, `mEffectiveInitOptionsOverride`,
`initType`, `mediaOptions`, the `hwDecoderEnabled`/`hwDecoderForced` props, the decoder-mode
setting. ExoPlayer needs none of it.

### A9. Equalizer via VLC

`applyEqualizer`, the `MediaPlayer.Equalizer` plumbing. Replaced by
`android.media.audiofx.Equalizer` on `player.audioSessionId` — a system effect rather than
an engine-specific one.

**Category A total: an estimated 2,000–2,400 native lines and ~300 JS lines, plus roughly
40 of the 81 state fields.**

## 1.4 Category B — real features to port

| # | Feature | Where it lives now | Substrate after |
|---|---|---|---|
| B1 | Six resize modes | native `computeGeometry` + `setScale`/`setAspectRatio` | `AspectRatioFrameLayout`, or keep `computeGeometry` and drive layout |
| B2 | Zoom / pan | JS worklets → View transform | unchanged |
| B3 | Seek / brightness / volume / speed gestures | JS worklets | unchanged |
| B4 | HUD | JS + Reanimated | unchanged |
| B5 | Playback speed 0.25–4.0× | `setRate` + `scaletempo` | `setPlaybackParameters` (Sonic) |
| B6 | Audio / subtitle track selection | native + retry | `TrackSelectionParameters` |
| B7 | Haptic cues | `ffmpeg-kit` extraction → `ContextAnalyzer` | **unchanged** — needs the whole cue list upfront |
| B8 | Subtitle rendering & styling | `SubtitleOverlay` | unchanged; cues now from ExoPlayer |
| B9 | Bitmap subtitles (PGS/VobSub) | VLC SPU | ExoPlayer PGS — **unverified** |
| B10 | PiP | `VlcPipController` (624) | mostly unchanged; bounds hack may simplify |
| B11 | Background playback + notification | `GlidePlaybackService` + adapter | `MediaSession` + real ExoPlayer |
| B12 | Bookmarks, playlist, resume, settings | JS | unchanged |
| B13 | Audio delay | `--audio-desync` / `setAudioDelay` | **no ExoPlayer equivalent** — custom `AudioProcessor`, or drop |
| B14 | Subtitle delay | VLC SPU delay | offset in `SubtitleOverlay` — free |
| B15 | Thumbnails | `ffmpeg-kit` | unchanged |

Only **B13** has no clean answer. Decide it early: a custom `AudioProcessor` is real work
for a feature whose usage is unmeasured.

## 1.5 Category C — bloat to delete regardless

- **`VideoPlayerScreen.tsx` is 1,585 lines.** It wires ten hooks and owns the resume modal,
  recap, playlist, bookmarks and navigation. Splitting it is not the point; deleting the
  props that vanish with Category A is, and that removes a large share of it.
- **`types.ts` is 554 lines** for one screen's types, much of it VLC event shapes that no
  longer exist.
- **Three seek entry points** — `previewSeek` (throttled), `commitSeek`, and the
  gesture path — plus interpolation refs. Interpolation stays (a 60 fps scrubber needs it);
  the settle/dedup machinery does not.
- **Twelve `volatile` fields** flagged in tracker §8.3 as resting on assumptions never
  audited. Most are Category A anyway.
- **`--audio-desync=100`** is in the init options with no recorded reason. Do not port a
  constant nobody can justify.
- **The decoder-mode setting** (hardware / software / hardware_plus) is a VLC concept
  exposed in the UI. ExoPlayer chooses per device. Remove the setting.

---

# Part 2 — Target architecture

The current design puts everything in one View. The replacement puts almost nothing there.

```
VideoPlayerScreen.tsx          screen composition, unchanged in shape
  └── hooks (gestures, HUD, bookmarks, settings)   ← engine-agnostic, keep
  └── <GlidePlayerView/>       thin RN view
        └── GlidePlayerView.kt (target ≈400 lines)
              ├── SurfaceView
              ├── ExoPlayer  ← owns focus, tracks, rate, effects, position, state
              ├── MediaSession ← notification, media buttons
              └── PipController (kept, trimmed)
```

**Rules for the native view:**

1. **No state that ExoPlayer already holds.** No mirrored paused/ended/position/rate flags.
   If ExoPlayer can answer it, ask ExoPlayer.
2. **No Handler unless it coalesces user input.** Rate during a drag qualifies. Nothing else
   should.
3. **No retry loops.** If a call fails, it is a bug to find, not a timer to add.
4. **Events out, props in, nothing clever between.**

Target: **≈400 native lines against 3,538**, and roughly 10 state fields against 81.

**Pause-reason flags stay.** `mPausedForHostStop` and friends exist because "paused by the
user" and "paused by lifecycle" are genuinely different, and the media session must report
the difference. That is a real distinction, not compensation — keep it, in one small enum.

---

# Part 3 — Phases

Broad phases, each independently verifiable and independently revertible. Every phase ends
with a device capture, JS **and** native, compared against a recorded baseline. This project
has repeatedly shown that plausible reasoning loses to measurement.

**Phase 0 — done.** ExoPlayer renders HDR (`colorSpace=6`, `colorTransfer=6`); the FFmpeg
extension restores E-AC-3 (`SUPPORTED=false→true`); CI builds it reproducibly.

### Phase 1 — Playback core behind a flag

New `GlidePlayerView` alongside the VLC one, selected by a setting. Media loading, play /
pause / seek / resume, progress, duration, state events, buffering. Nothing else.

Deletes on arrival: A1, A2, A3, A6, A8.

**Verify:** open, resume at offset, seek (short and long), rapid seek, pause/play, EOF.
Position accuracy within tolerance; **no** `SEEK_VERIFY`-class drift; audio focus behaviour
across a phone call and another app — with **no focus code of our own**.

**Exit:** a video plays start to finish, correctly, with the flag on.

### Phase 2 — Tracks, subtitles, speed, effects

Audio/subtitle selection via `TrackSelectionParameters`; display cues from `onCues`; speed
via `setPlaybackParameters`; colour enhancement via `setVideoEffects`; equalizer via
`AudioEffect`.

Deletes: A4, A7 (display path), A9.

**Verify:** switch audio tracks ten times; E-AC-3 selected and audible; subtitles appear
with no extraction delay; speed 0.25→4.0 with pitch preserved **on an E-AC-3 track**;
enhancement on/off with **hardware decode retained** — the specific defect being fixed;
haptics still fire (extraction path untouched).

### Phase 3 — Surface, geometry, PiP, session

SurfaceView geometry and the six resize modes; PiP; `MediaSession` with the real ExoPlayer.

Deletes: A5.

**Verify:** all six modes on 16:9, 2.39:1, portrait, rotated-metadata and SAR≠1 fixtures
(tracker §8.5); zoom/pan; PiP enter/exit/resize; notification transport controls; lock
screen; task dismissal.

### Phase 4 — Default flip and cleanup

ExoPlayer default, VLC still present as an escape hatch. Ship one release. Then, and only
then, delete the VLC module, `libvlc.so`, the spike, and the `.wmv` / `rtmp://` claims in
`VIDEO_EXTENSIONS`, `DeepLinkService`, `NavigationService` and `VideoPlayerScreen`.

**Deliberately two steps.** "Delete 43 MB" and "prove the replacement works" must not land
together.

**Verify:** APK size before and after; full §15.3 manual matrix; a real user library, not
fixtures.

## 3.1 Verification protocol

Every phase, without exception:

1. Record the **baseline** on the VLC path first — same file, same actions.
2. `adb shell am force-stop` before each capture; process-scoped state has produced false
   results here before.
3. Capture **both** sides: `adb logcat -v time -s GlideVLC:W ReactNativeJS:V`, plus `-s VLC:V`
   or ExoPlayer's own logging when engine internals are in question.
4. **Before reading, name the line that would appear if the behaviour were broken.** A check
   that cannot fail is not a check.
5. Anything unexplained gets written down, not assumed benign.

## 3.2 Open decisions

| # | Decision | Needed by |
|---|---|---|
| D1 | Audio delay: custom `AudioProcessor` or drop? | Phase 2 |
| D2 | LGPL: shared-library FFmpeg build, or accept static linking? | before any public release |
| D3 | Bitmap subtitles: acceptable if ExoPlayer's PGS is weaker? | Phase 2 |
| D4 | Keep the decoder-mode setting, or remove it? (recommend remove) | Phase 1 |

## 3.3 What would make this plan wrong

- ExoPlayer cannot play a meaningful share of a real library → Phase 4 verification must use
  real content.
- The six resize modes cannot be reproduced on the new surface → Phase 3 is the risk peak.
- Audio delay turns out to be widely used → D1 becomes expensive.

The flag exists so any of these can stop the migration without a revert.
