# Player engine migration — audit and plan

**Created:** 2026-09-06
**Prerequisite reading:** `docs/exoplayer-migration.md` (why), tracker §11.5–11.6 (decision).
**Status:** complete. Phases 0-4 done and verified on device; LibVLC removed. Outstanding by
decision: B9 (bitmap subtitles) and A7 (subtitle cue display).

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
| B9 | Bitmap subtitles (PGS/VobSub) | VLC SPU | `Cue.bitmap` drawn by our own overlay — D3 |
| B10 | PiP | `VlcPipController` (624) | mostly unchanged; bounds hack may simplify |
| B11 | Background playback + notification | `GlidePlaybackService` + adapter | `MediaSession` + real ExoPlayer |
| B12 | Bookmarks, playlist, resume, settings | JS | unchanged |
| B13 | Audio delay | `--audio-desync` / `setAudioDelay` | **dropped** — D1 |
| B14 | Subtitle delay | VLC SPU delay | offset in `SubtitleOverlay` — free |
| B15 | Thumbnails | `ffmpeg-kit` | unchanged |

All settled; see §3.2. The only one carrying residual risk is **B1**, the six resize modes,
which is why Phase 3 is the risk peak.

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

#### Phase 1 as built — 2026-09-06

Three Kotlin files, ~500 lines, in `android/app/src/main/java/com/glide/app/player/`:
`GlidePlayerView` (the view), `GlidePlayerViewManager`, `GlidePlayerPackage`. It speaks the
**same props and the same event names** as `RCTVLCPlayer`, so `usePlayerCore`,
`VideoPlayerScreen` and the hooks are untouched and the two engines run the same JS on the
same actions. `VLCPlayer.tsx` picks the native component from an `engine` prop;
`AnimatedVideoView` reads `settings.playerEngine` straight from the store and puts the engine
in the React key, so switching rebuilds the native view. Flag lives in Settings → Playback →
*Experimental Player Engine*, default `vlc`.

`media3-exoplayer` moved from `debugImplementation` to `implementation`. The FFmpeg decoder
AAR stays `debugImplementation` — `DefaultRenderersFactory` loads
`androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer` by `Class.forName`, so a build without
it compiles and runs, just with no FFmpeg fallback. Verified on device:
`DefaultRenderersFactory: Loaded FfmpegAudioRenderer.`

Deleted-on-arrival, as planned: A1, A2, A3, A6, A8. The view holds **9 fields** against 81
and **one** Handler — the progress ticker, which is unavoidable because ExoPlayer has no
position-push API.

Not implemented on purpose, so the phase boundary stays honest: tracks (`[LOAD]` reports
`audioTracks=0`), subtitles, enhancement, equalizer, audio delay, the six resize modes
(letterbox only), title/artist, media session, PiP (command id 6 registered but inert, so
`dispatchViewManagerCommand` cannot throw). Playback rate *is* wired — one line, and its
absence would have muddied the comparison.

#### Phase 1 measurements — device AIN065 / Android 16, 2026-09-06

Baseline recorded on the VLC path first, same file, same scripted actions, `am force-stop`
before each capture, per §3.1.

| Check | VLC baseline | ExoPlayer |
|---|---|---|
| Duration | 3948456 ms | 3948456 ms — identical |
| Resume at offset | `target=873274ms actual=873265ms delta=9ms` | opened at `startPositionMs=2394720`, no correction pass, no seek |
| Seek accuracy | `SEEK: requested position=0.1994` → settles | `seek to 787279ms` → `landed at 787279ms`, **delta 0** |
| Rapid seek (4 drags in ~600 ms) | all applied | all applied, every one landing exactly |
| `SEEK_VERIFY`-class drift | n/a | **none** — `onPositionDiscontinuity` reports the landing directly |
| EOF | — | `load duration=8600ms` → `state=ENDED` at +8.6 s → JS `[END] video ended` |
| Our own audio-focus code | `AUDIO_FOCUS: requested → GRANTED` | **0 lines** |

Audio focus is held by Media3 on our behalf, which is A1 working as designed:

    Audio Focus stack: pack: com.glide.app
      client: androidx.media3.common.audio.AudioFocusManager
      gain: GAIN -- attr: usage=USAGE_MEDIA content=CONTENT_TYPE_MOVIE

4K HDR renders at the correct 3840x1600 aspect, letterboxed, resuming at the saved position.

**Unexplained/uncomfortable, recorded rather than assumed benign (§3.1 step 5):**

1. A `handleResumeModalAction('restart')` fires that nobody knowingly pressed, ~2 s after
   the media opens, on **both** engines. It does *not* reproduce on a launch with no input
   at all, so something in the touch path reaches it — but the timestamps do not line up
   with any scripted tap either, and there are 1.1 s of complete log silence before it.
   `onRestart` on `ResumeModal` is its only caller, and `resumeModalVisible` starts from
   `useState(shouldResume)` which is false at mount because `resumePosition` loads async.
   That does not add up yet; it is written down rather than explained away.
   On VLC it is harmless only by accident: `commitSeek(0)` is
   refused with `commitSeek refused — no duration yet`, because VLC has not published a
   length yet. ExoPlayer knows the duration in ~870 ms, so the same call lands and resume is
   destroyed — `seek to 0ms` right after `resume position=2378.52s`. The app itself notices:
   `Skipping save: Player at start but resume expected at 2378.517`. **Restart has been
   quietly broken on the VLC path**, and the duration-guard was hiding it. Not a Phase 1
   regression — a clean run with no input resumes correctly on ExoPlayer — but it must be
   traced before the default flips. Find the phantom caller.
2. `FfmpegLibrary: No aac decoder available` is expected (§3.2 of the migration doc enables
   only ac3/eac3/dca/mlp/truehd) but confirms ExoPlayer probes the extension for codecs the
   hardware already has. Harmless; noted so it is not re-investigated.

**Phase 1 exit met.** Audio confirmed audible on the E-AC-3 file by hand, 2026-09-06.

**Still open, deferred to Phase 4's manual matrix:** focus behaviour across a real phone
call and another app taking focus. The mechanism is verified — Media3's `AudioFocusManager`
holds `GAIN` — but the interruption itself has not been exercised.

### Phase 2 — Tracks, subtitles, speed, effects

Audio/subtitle selection via `TrackSelectionParameters`; display cues from `onCues`; speed
via `setPlaybackParameters`; colour enhancement via `setVideoEffects`; equalizer via
`AudioEffect`.

Deletes: A4, A7 (display path), A9.

**Verify:** switch audio tracks ten times; E-AC-3 selected and audible; subtitles appear
with no extraction delay; speed 0.25→4.0 with pitch preserved **on an E-AC-3 track**;
enhancement on/off with **hardware decode retained** — the specific defect being fixed;
haptics still fire (extraction path untouched).

#### Phase 2 progress — 2026-09-06

**Done: audio tracks.** Enumerated in `onTracksChanged`, reported in the load event, selected
with a `TrackSelectionOverride`. The index *is* the id JS sees, since the JS layer only ever
round-trips the id and displays the name. The name keeps the language in it on purpose —
`findMatchingAudioTrack` picks the preferred-language track by substring-matching the name.
No retry loop and no coalescing Handler (A6): `TrackSelectionParameters` is accepted at any
time, unlike VLC's `setAudioTrack`. Measured:

    audio track 0 codec=audio/mp4a-latm lang=en channels=6 SUPPORTED=true
    audio track 1 codec=audio/eac3   lang=hi channels=6 SUPPORTED=true SELECTED=true
    audio track select id=0  ->  track 0 SELECTED=true, track 1 SELECTED=false

E-AC-3 reports `SUPPORTED=true`, which is the Phase 0 FFmpeg work holding. Switching
confirmed by hand in the real UI.

**Done: colour enhancement (A4), and the plan was wrong about how.** §1.3 proposed
`HslAdjustment` + `Contrast`. On device that kills playback outright:

    IllegalArgumentException: HDR is not yet supported
        at androidx.media3.effect.HslShaderProgram.<init>(HslShaderProgram.java:47)
    -> ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED, player drops to STATE_IDLE

`HslAdjustment` refuses HDR in media3 1.11.0 — on exactly the content this migration exists
to fix. `RgbMatrix` has no such restriction and works in *linear* RGB (BT.2020 for HDR,
BT.709 for SDR), so enhancement is now a single custom `RgbMatrix` doing luminance-preserving
saturation plus gain. Contrast is dropped: it needs a pivot, and a 0.5 pivot is meaningless
in linear light where HDR values exceed 1.0. VLC's contrast was 1.08 — small enough that
dropping it beats shipping something wrong on HDR.

**A4 was wrong about the recreate, and finding out cost us the whole migration for an hour.**
The plan said enhancement would need "no player recreate". The obvious way to get that is to
call `setVideoEffects` unconditionally before `prepare()` — with an empty list when disabled —
since the pipeline is only set up if it has been called at least once beforehand. That was
done, and it silently destroyed HDR on every playback.

Calling `setVideoEffects` **at all**, even with an empty list, arms
`DefaultVideoFrameProcessor`, and that GL path tone-maps HDR to 8-bit sRGB. It reported no
error. It showed up as a slightly washed-out picture with visible grain in dark scenes, on
HDR content only, and it corrected itself for a moment on any rotation or window change —
which is what a user notices and no log does. Measured with `dumpsys SurfaceFlinger`, same
file and same ExoPlayer, against the Phase 0 spike as a control:

| | display colorMode | video layer dataspace |
|---|---|---|
| Phase 0 spike (never calls setVideoEffects) | `DISPLAY_P3` | **`BT2020_ITU_PQ`** |
| effects armed with an empty list | `SRGB` | `V0_SRGB` — no BT2020 layer at all |
| after the fix | `DISPLAY_P3` | **`BT2020_ITU_PQ`** |

So `setVideoEffects` is now called **only when enhancement is actually on**, and toggling it
re-opens the media at the current position, because arming the frame processor is a
prepare-time decision. A toggle therefore costs a re-prepare — worse than the plan hoped,
still far better than VLC, which dropped the device to software 4K decode for the rest of the
session. **Never call `setVideoEffects` speculatively.**

Two lessons worth carrying into phases 3 and 4. First, "it plays and there are no errors in
the log" is not evidence that video is correct; the HDR path has to be asserted directly, and
`dumpsys SurfaceFlinger`'s layer dataspace is the assertion. Second, keeping the spike in the
debug build paid for itself — a minimal known-good control on the same device and file turned
a vague "it looks a bit washed out" into a settled cause in two commands. **Do not delete the
spike before Phase 4.**

Measured with enhancement on:

| | enhancement off | enhancement on |
|---|---|---|
| video decoder | `c2.qti.hevc.decoder` | `c2.qti.hevc.decoder` — **hardware retained** |
| display brightness reason | `[ hdr ]` | `[ hdr ]` — **HDR retained** |
| frame-processing errors | 0 | 0 |

That is the A4 defect fixed and verified, not argued.

#### The enhancement constants were wrong three times, and only the third was taste

Worth recording in full, because each wrong answer looked reasonable.

**First: VLC's numbers ported verbatim.** `--saturation=1.30 --brightness=1.03` applied to
*linear* light rather than the gamma-encoded values VLC fed them to. Visible grain, worst in
dark scenes. A uniform gain in linear light is an exposure lift, and lifting the blacks is
exactly what makes compression noise visible.

**Second, and the serious one: a contrast pivot correct for SDR and ~50x wrong for PQ.**
Contrast needs a pivot, and mid-grey is 0.18 *of diffuse white* — but "diffuse white" is not
1.0 in every space. From media3's own shader,
`fragment_shader_transformation_external_yuv_es3.glsl`:

    // Applies the appropriate EOTF ... Input and output are both normalized to [0, 1].
    const float pqMaxLuminance = 10000.0;
    linearRgbBt2020 = linearRgbBt2020 * pqMaxLuminance;  // Scale luminance.

Under PQ, linear 1.0 is **10,000 nits**. A pivot of 0.18 therefore means 1800 nits, about
nine times diffuse white, and the resulting offset `0.18 * (1 - c)` = -0.0063 was larger
than the entire value of every midtone:

| | linear | with pivot 0.18 | with the correct pivot |
|---|---|---|---|
| mid-grey (36.5 nits) | 0.003654 | **-0.0025, clamped to pure black** | unchanged |
| diffuse white (203 nits) | 0.0203 | 147 nits, darkened 27% | ~215 nits |

Everything below roughly 61 nits crushed to black — most of the frame. SDR was unaffected
because 0.18 is right there, which is exactly why the report was "SDR okayish, HDR very
bad": the same code, two colour spaces, one of them silently destroyed.

Mid-grey is 18% of diffuse white, and diffuse white is:

| space | diffuse white (linear) | pivot | source |
|---|---|---|---|
| SDR | 1.0 | 0.18 | by definition |
| PQ | 203/10000 = 0.0203 | 0.003654 | ITU-R BT.2408 HDR Reference White, 203 cd/m² |
| HLG | 0.264963 | 0.047693 | BT.2100 inverse OETF at signal 0.75 |

`useHdr` cannot distinguish PQ from HLG and their pivots differ by 13x, so the transfer
function is read from the selected video `Format.colorInfo.colorTransfer`.

**Third: strength.** Saturation is gentler on HDR (1.10 against SDR's 1.18) because BT.2020
is a far wider gamut, so an equal boost pushes colours past what the panel can show, where
they clip and shift hue. These are genuinely a knob; the two above were not.

The arithmetic now lives in `ColorEnhancement.kt`, pure and separate from the view, with 8
JVM tests: mid-grey pivots exactly in all three spaces, PQ midtones stay positive, 5-nit
shadows survive, the HLG constant is re-derived from the BT.2100 formula, and the three
pivots must stay on different scales. The second bug would have been caught in
milliseconds by any one of them.

**The ceiling.** `RgbMatrix` is a linear operation, so no value of these constants can give
a tone-curve shoulder, hue-selective saturation (skin tones), or luminance-weighted
saturation (less boost where chroma noise lives). Those need a custom
`BaseGlShaderProgram`. Built for HDR on 2026-09-24 — see *HDR enhancement moved to an
ICtCp shader* below.

**HDR survives enhancement too** — measured, because the reasonable expectation was that it
would not. With the frame processor armed *and* an effect in it, the display stays
`colorMode=DISPLAY_P3` and the layer is `dataspace=BT2020_PQ`. `RgbMatrix` declares HDR
support and it carries through to the output surface, so no SDR gating is needed and the
toggle is safe on HDR content. The empty-list case was broken not because the pipeline
cannot do HDR, but because arming it for nothing still inserted a converter.

The toggle's re-open preserves position: `enhancement=true` then
`open ... startPositionMs=2657167`, the same offset it was at.

**Also fixed: event dispatch.** `getJSModule(RCTEventEmitter)` — what the VLC view still
uses — logs an "Unhandled SoftException" per event under the New Architecture saying it will
stop working once interop is disabled. Events did arrive, but one stack trace per progress
tick is intolerable in a migration whose method is reading device logs. Now dispatched via
`UIManagerHelper.getEventDispatcherForReactTag` and a small `Event` subclass.

**Done: equalizer (A9).** `android.media.audiofx.Equalizer` on the player's own audio
session, rebuilt from `Player.Listener.onAudioSessionIdChanged` because the session id does
not exist until the audio renderer initialises and changes across media. The UI's ten fixed
bands (60Hz-16kHz) are mapped onto however many the device implements — five, typically — by
nearest centre frequency. A device refusing the effect, or another app holding it at higher
priority, is caught: losing the equalizer must not take playback down with it.
`MODIFY_AUDIO_SETTINGS` added to the manifest (normal permission, no prompt). Verified
`audioSessionId=28761` arrives and the effect applies; **proper A/B still needs headphones**.

**Deferred: A7's display path — and A7 as written conflicts with D1.** Investigated and not
built, deliberately.

`FloatingSyncPanel` calls `onChange(value - 50)` unbounded, so subtitle delay goes negative —
subtitles *earlier*. D1 settled that this "stays and is free… an offset in JavaScript", which
is true only while JS holds the **whole** cue list. `onCues` streams cues as playback reaches
them, so a negative offset is not implementable on it at any price.

Worse, A7 retires nothing. Three consumers need the full list upfront regardless:
haptics (B7, explicitly kept), the negative delay offset, and `FloatingSyncPanel`, which is
handed `subtitleCues` to build its reference-point picker. So moving *display* to `onCues`
would leave the extraction running and cost a shipped feature to save 1.5-3.0 s on a cold
cache — the cue store caches per (path, track), so it is a first-open cost only.

Where `onCues` is a genuine gain is **bitmap** subtitles: ExoPlayer decodes PGS/VobSub to
`Cue.bitmap`, which the ffmpeg text path cannot represent at all, and that is what keeps
VLC's SPU renderer (`vlcTextTrackId`) alive. That is B9, and it is the piece worth building.
Note it is not free either: an Android `Bitmap` has to reach a JS overlay, which means PNG
plus base64 per cue.

**Decision 2026-09-06: skip the text-cue swap, keep extraction, and revisit bitmap cues as
B9.** Phase 3 is the risk peak and is worth more than the subtitle latency win.

**Not measured:** playback speed is wired but pitch preservation at 0.25-4.0x on an E-AC-3
track has not been checked.

#### HDR enhancement moved to an ICtCp shader — 2026-09-24

**Every PQ nit figure above is 10x off.** The HDR working space is **1.0 = 1000 nits**, not
10,000. media3's input pass (`scaleHdrLuminance`) multiplies PQ light by 10000/1000, and its
final pass (`fragment_shader_oetf_es3.glsl`, `normalizeHdrLuminance`) divides it back before
the OETF. That was confirmed in the 1.11.0 AAR's shaders and bytecode: the working transfer
is forced to `LINEAR`, and the final program is `createApplyingOetf`. The `* pqMaxLuminance`
quoted above belongs to the HDR-to-SDR tone-map branch, which does not run for HDR output.
Two consequences:

- The shipped "1 nit" pivot was really 0.1 nit, so the offset was -0.006 nits, not -0.06.
  Everything under 0.0057 nits went to pure black and 0.01 nits lost 54%. The defect was
  real, just deeper in the shadows than stated.
- HLG is also normalised to 1.0 = its 1000-nit peak, so PQ and HLG diffuse white differ by
  1.3x, not 13x. `videoColorTransfer` existed only for that distinction and was deleted.

**What replaced the HDR matrix.** `HdrColorEnhancement`, a `GlEffect` +
`BaseGlShaderProgram`, per BT.2390: working BT.2020 → LMS → PQ → ICtCp, then
`I + 0.08·I²·(1 − I/I₁₀₀₀)` on I and ×1.10 on Ct/Cp, then back. Maths and GLSL sit side by
side in `ColorEnhancement.kt`. The Kotlin copy is what the tests exercise.

| nits | 0.01 | 0.1 | 1 | 9 | 81 | 203 | 1000 | 4000 |
|---|---|---|---|---|---|---|---|---|
| old matrix | -54% | 0% | +5.4% | +5.9% | +6.0% | +6.0% | +6.0% | +6% |
| ICtCp curve | +0.3% | +1.1% | +2.9% | +5.5% | +7.0% | +6.0% | 0% | -11% |

**SDR is unchanged, by construction (reasoned from the bytecode, not measured).** The effect list is `[HdrColorEnhancement, RgbMatrix]`. For SDR the
first is `PassthroughShaderProgram`, which forwards the texture without drawing, and the
matrix still folds into the final pass because it is trailing. For HDR the matrix returns
identity. A golden test pins the SDR matrix values.

**Cost, HDR only, estimated and not measured:** one extra full-frame RGBA16F pass (the
pipeline goes from two passes to three) and 12 more `pow` per pixel (from 12 to 24).

**The real cause of crushed HDR blacks was media3, not the matrix** — measured 2026-09-25 on
AIN065, The Boys S05E04 (HDR10+/DV, PQ), with a temporary readback of the texture this
shader receives. Both media3 passes that surround every effect,
`fragment_shader_transformation_external_yuv_es3.glsl` and `fragment_shader_oetf_es3.glsl`,
declare `precision mediump float`. That is fp16 on this GPU, and fp16 arithmetic flushes
denormals. The input pass holds PQ light on the 0..10,000-nit scale before its x10, so
everything under 6.1e-5 x 10,000 = **0.61 nits became exactly 0**:

| media3 input texture, dark scene | stock shaders | `highp` overrides |
|---|---|---|
| pixels exactly 0 | **89.9%** | **0.0%** |
| 0.006–0.061 nits | 0.0% | 26.4% |
| 0.061–0.5 nits | 0.5% | 54.1% |
| smallest non-zero channel | 6.1e-4 (a hard floor) | 7.0e-6 |

The two readings are 17 s apart in the same dark scene. In same-frame screenshot pairs
against enhancement off, the wall was -99% with stock shaders (45:23) and -12% with the
overrides (47:13).

So the "leave HDR alone" fallback would not have helped: arming *any* effect ran these
passes. Fixed by copying both shaders into `android/app/src/main/res/raw/`, changed only to
`precision highp float`. An app resource overrides a library resource of the same name. A
test fails if media3 is upgraded without re-copying them.

**Verified on device:** the shader compiles and runs with 0 frame-processing errors. HDR is
retained with it on (`DISPLAY_P3`, layer `RGBA_1010102` at `BT2020_PQ`). The toggle
reopens at the same position.

**Still open:**
- Screenshots of the same frame are ~13% darker, evenly, with enhancement on, although the GL
  output has no zeros. The likely cause is HDR10+ dynamic metadata reaching the display only
  on the direct decoder path, so the display tone-maps the two buffers differently.
  Unverified; judge by eye on the panel, not from screenshots.
- GPU busy and thermals have not been measured.

#### Enhancement v2: one adaptive shader for SDR and HDR — 2026-09-25

`ColorEnhancementEffect` replaces both the SDR `RgbMatrix` and `HdrColorEnhancement`. The
maths, the GLSL generated from the same constants, and the tests all live around
`ColorEnhancement.kt`. Per frame, the effect makes three draws: a 256-column luma downsample
that is then mipmapped, a 1x1 pass that eases the scene key, and the enhancement. Everything
stays on the GPU, with no readback stall.

| | SDR (gamma working values) | HDR (ICtCp) |
|---|---|---|
| Tone | contrast pivot follows the scene: 0.18 on typical keys, down to 0.06 on dark ones | the lift above, plus up to +14% for 1–30 nits on dark scenes and less lift on bright ones; toe ≤ +2.2% in every scene |
| Colour | saturation weighted by skin hue (138°), shadow and vibrance | the same, with skin at 142° in CtCp |
| Clarity | local contrast against the 1/32-scale mip, gated and capped | the same, on I |
| Extra | deband + one-step dither | mastering metadata (SMPTE 2086 / CTA-861.3) set on the output EGL surface |
| Strength | 0–150% slider, plus Subtle / Natural / Vivid presets in Quick Settings; live, no re-open | same |

**SDR is still the confirmed matrix at neutral settings.** That's a typical scene, strength
100%, and colours the protections leave alone. A test pins it to 2e-4. The GL ES 2 fallback
is the exact matrix.

**Researched and not built:**
- **SDR→HDR expansion:** media3 throws *"SDR to HDR tonemapping is not supported"* (except for
  Ultra HDR images), so it would mean forking media3.
- **AI upscaling and frame interpolation:** too heavy for 4K on battery, and interpolation
  gives the soap-opera look.

**Verified off-device:** 36 JVM tests and 35 JS tests pass; `tsc` is clean; ESLint has 0
errors. All six generated shaders compile with the NDK's `glslc` (as ES 3.10, a superset of
the 3.00 they declare). The release APK builds.

**To verify on device, all at once:**
1. **HDR:** logcat shows `HDR mastering metadata on output surface: ok=true`. Does the ~13%
   even darkening against enhancement off disappear? `dumpsys SurfaceFlinger` should still
   show `DISPLAY_P3` and `BT2020_PQ`.
2. **The Boys at 45:23:** the dark scene opens up, and the probe has no zeros.
3. **Skin:** faces don't go orange at 150%. Muted colours gain more than neon ones.
4. **Clarity:** no halos at high-contrast edges at 150%; no blockiness in smooth gradients
   (the blur comes from a box-filtered mip, smoothed with a tent filter).
5. **Scene changes:** no pumping within a shot; adapts at cuts; no flash after a seek.
6. **SDR:** bands in skies and dark gradients are gone, and the dither isn't visible as a
   pattern. A bright typical scene looks as it did before.
7. **Slider:** changes apply live, with no re-open; 0% looks like enhancement off.
8. **Cost:** GPU busy % and thermals over 10 minutes of 4K HDR and 1080p SDR, against
   enhancement off. SDR now pays a full-resolution pass that the old matrix got free inside
   media3's final pass.

### Phase 3 — Surface, geometry, PiP, session

SurfaceView geometry and the six resize modes; PiP; `MediaSession` with the real ExoPlayer.

Deletes: A5.

**Verify:** all six modes on 16:9, 2.39:1, portrait, rotated-metadata and SAR≠1 fixtures
(tracker §8.5); zoom/pan; PiP enter/exit/resize; notification transport controls; lock
screen; task dismissal.

#### Phase 3 progress — 2026-09-06

**Done: B1, the six resize modes — and it was not the risk peak after all.**
`computeGeometry` was already a pure function, so it was **ported verbatim** into
`Geometry.kt` rather than re-derived against `AspectRatioFrameLayout`: same arithmetic, same
best-fit hysteresis thresholds, so the modes cannot drift from the behaviour users have.
Only the output is translated — VLC took an aspect-ratio string plus a `setScale` factor,
whereas we lay out the SurfaceView ourselves, so the answer is a scale on the SAR-corrected
source size, or `fill`.

SAR comes free: `VideoSize.pixelWidthHeightRatio` is exactly the pixel aspect ratio, and
rotation needs no handling at all — media3 applies it internally and
`unappliedRotationDegrees` is deprecated and always zero. That covers two of §8.5's five
fixtures without code.

Because the function is pure, the modes are checked on the JVM with no device and no
Robolectric: `GeometryTest`, 12 cases across 16:9, 2.39:1, portrait, SAR≠1, degenerate
zero-size input, and both directions of the best-fit hysteresis. Writing it caught two wrong
assumptions of mine before the device did — cover on 16:9 into a 2.23:1 view crops ~20%, so
best-fit correctly refuses it, and for a source narrower than the view `cropRatio` and
`maxBar` are algebraically the same quantity, making the real gate 0.05 enter / 0.08 exit.

Device agrees with the tests, all six within ~1 ms of the mode change:

| mode | child for 3840x1600 in 2412x1080 |
|---|---|
| contain | 2412x1005 |
| cover | 2592x1080 (overflows width, crops sides) |
| fill | 2412x1080 |
| scale-down | 2412x1005 (4K overflows, so identical to contain) |
| none | 3840x1600 (native, overflowing) |
| best-fit | 2412x1005 — crop would be 6.9%, past the 6% enter threshold |

**`requestLayout()` does not work in a React Native view.** Found by measurement: six
`resizeMode=` lines in a row with not one `layout` line between them, then a layout only
when rotation forced a real pass. RN drives layout from its own shadow tree and does not
re-measure an Android view on request, so the new mode sat in the field doing nothing — on
screen, "changing the resize mode does nothing until you rotate". The child layout is now
re-run directly via `relayoutSurface()`. Worth remembering for anything else in this view
that changes geometry outside a layout pass.

**Done: A5, the media session.** `GlidePlayerService` is a `MediaSessionService` that builds
`MediaSession.Builder(this, exoPlayer)` — **directly on the player**. That is A5: no
`SimpleBasePlayer` subclass mirroring engine state, and therefore none of the divergence bugs
that came with mirroring it. `GlidePlayerHolder` is the meeting point, mirroring the existing
`VlcPlaybackHost` pattern including its non-sticky restart reasoning (the player lives in the
React view and dies with the process, so a sticky restart finds nothing and is killed for
never going foreground).

One deliberate difference from the VLC version: `clear()` releases the session
**synchronously** via a held service reference before the player is released. `stopService`
is asynchronous, so relying on it alone leaves the session holding a released player — the
exact defect class §1.3 A5 lists. `media3-session` had to be added to the app module:
the player module declares it `implementation`, which is not transitive.

Title and artist now feed `MediaMetadata` for the notification and lock screen, applied with
`replaceMediaItem` rather than `setMediaItem` — the latter would restart playback from the
beginning just to relabel a notification.

**Done: PiP, by moving rather than rewriting.** `VlcPipController` turned out to be coupled to
the VLC view through exactly two non-`View` methods, so it was ported verbatim to
`GlidePipController`. Its aspect clamping, PiP bounds enforcement and ancestor-transform
neutralisation were all earned against real device behaviour; re-deriving them would have
thrown that away for no gain. The VLC copy dies with its module in phase 4. `VideoSize`
reports SAR as a float, so it is passed to PiP as a rational over a fixed denominator.

`onHostPause` now ignores backgrounding while in PiP — a PiP window is a foreground
presentation even though the Activity reports paused.

#### Phase 3 verified on device — 2026-09-06, AIN065 / Android 16

Run with `scripts/verify-player-engine.sh`, which states for each check the line that would
appear if it were broken. **Zero errors, zero crashes across the whole matrix.**

| Check | Result |
|---|---|
| Open, resume, load | `startPositionMs=1867559` honoured, no seek to 0, `load duration=3948456ms` |
| Media session | `media session created` — A5 live, no adapter |
| HDR | `colorMode=DISPLAY_P3`, `dataspace=BT2020_ITU_PQ` |
| Decoders | `c2.qti.hevc.decoder` (hardware) + `Loaded FfmpegAudioRenderer`; E-AC-3 `SUPPORTED=true` |
| Six resize modes | all six correct in **both** orientations, each within ~1 ms of the mode change |
| Enhancement | HDR retained (`BT2020_PQ`), position preserved across the re-open |
| PiP | enter/exit/resize clean; bounds re-assertion firing (`re-laid out to 243x156, re-asserting 769x323`); aspect clamped 2.4 -> 119/50 |
| Notification, lock screen, background playback | confirmed by hand |

Portrait `cover` is worth recording as evidence the geometry port is real: 3840x1600 into
1080x2412 needs scale 1.5075, giving a 5789x2412 child — a deliberate 5x overflow that the
parent clips, which is exactly what cover means.

**Two reports from the device session, both investigated:**

1. *"The 'enabled' toast reappears when returning to the player from PiP or the
   notification."* Real bug, and **engine-independent** — the VLC path has it too.
   `BookmarkToast` owned its own auto-hide timer, but `showToast` lives in
   `usePlayerBookmarks`, and `VideoPlayerScreen` unmounts the toast whenever
   `pipPresentationActive` is true. Unmounting cancels the animation, `onHide` never fires,
   `showToast` stays true forever, and the toast replays on the next mount. Fixed at the
   root: the hook that owns visibility now owns the timeout that ends it.
2. *"Entering the player from the notification is slow."* Measured, and **not the engine**.
   Warm re-entry is `Displayed ... +190ms` with no player recreation at all — the Activity is
   `singleTask` and simply comes forward. Cold start is `+1s447ms` to Displayed and then
   **7.8 s** before the React root mounts. That is JS startup in a **debug build pulling from
   Metro**; a release build ships precompiled Hermes bytecode. The React tree is identical on
   both engines, so VLC is equally slow. Re-measure on release before treating it as a defect.

### Phase 4 — done 2026-09-06

The release-cycle gap was dropped deliberately: the app has three users, so "ship one release
with VLC as an escape hatch" bought nothing. The **two-step structure was kept**, because that
part was never about time — it is what makes the flip and the deletion revertible separately.

**Step 1 — default flipped.** `playerEngine` defaulted to `exoplayer`, with the Settings row
reworded from "Experimental" to a "Legacy Player Engine" escape hatch. That row is now gone
too (step 2), along with the setting: with one engine there is no choice to present.

**Step 2 — LibVLC deleted.** `libs/glide-vlc-player/` and its package.json entry are gone.
`VLCPlayer.tsx` is replaced by `src/components/VideoPlayer/GlidePlayer.tsx`, which carries
only the props the native view implements — no init options, decoder mode, media options,
`initType`, network/asset classification, forced aspect ratios or subtitle-slave path. Only
four ref methods survived, because only four were ever called: `seek`, `previewSeek`,
`stopPlayer`, `enterPictureInPicture`.

**Measured, release APK arm64:**

| | before | after |
|---|---|---|
| APK | 73.5 MB | **33.6 MB** |
| `libvlc.so` | 41.1 MB (56% of the APK) | absent |

The plan's "43 MB, 53%" estimate was close: 41.1 MB and 56%. Note it is *stored
uncompressed* — `.so` files are, so the APK drop is the full library size. The debug APK
tells you nothing here (123 -> 120 MB) because dev tooling dominates it; measure release.

**Cleanups that fell out, mostly because they had nothing left to do:**

- The decoder-mode setting (D4) and its UI. It was the only thing bumping `playerKey`, so
  the remount mechanism went with it — and with no remounts, `AnimatedVideoView`'s
  live-position resume branch (and its `currentTimeRef`/`duration` props) became dead too.
  Resume is now one expression.
- `getOptimizedInitOptions` and the whole VLC init-option table.
- `vlcTextTrackId` and the bitmap/text branch in `usePlayerTracks`.
- `audioDelay` reaching native (D1: dropped).
- `.wmv` and `rtmp://` claims in `VIDEO_EXTENSIONS`, `DeepLinkService`, `NavigationService`
  and `VideoPlayerScreen`. `rtsp://` is still claimed, so `media3-exoplayer-rtsp` was added
  — `DefaultMediaSourceFactory` finds `RtspMediaSource` by `Class.forName`, so the
  dependency is the whole wiring.

**Two things deleting VLC broke, both caught by measurement, both fixed:**

1. **The release APK shipped no `libffmpegJNI.so`.** The decoder AAR was still
   `debugImplementation` — correct while VLC was the default and could cover for it. With
   VLC gone, a release build would have played AC-3/E-AC-3/DTS/TrueHD **silently with no
   error**, which is precisely the phase 0 blocking failure, with nothing to fall back on.
   Now `implementation`. It is still a local file, so a machine without it fails the build
   loudly — the right failure, but §4.3's GitHub Packages coordinate is now overdue.
2. **`ForegroundServiceDidNotStartInTimeException`, ~30 s into playback.**
   `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `POST_NOTIFICATIONS`
   were declared in the *VLC module's* manifest and arrived by merge. Deleting the module
   took them with it, so Media3's `MediaNotificationManager` called
   `startForegroundService()` on a service the system would not let go foreground. Declared
   on the app now. Verified: 55 s of playback, zero crashes, all three granted.

**Third thing deleting VLC broke: network streams never recovered.** Reported as "seeking a
stream doesn't work — a double-tap seek was fine but a long seek wasn't". It was not a seek
bug. The log:

    seek to 1347123ms of 9349090ms exact=true   -> landed
    seek to 1358653ms of 9349090ms exact=true   -> landed
    player error ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
    Caused by: java.net.ConnectException: Failed to connect to /127.0.0.1:11470
    state=IDLE

Port 11470 is Stremio's local streaming server. Confirmed on device: Stremio's **process is
alive** but it holds **no LISTEN socket on any port** — every socket on 11470 is state `06`
(TIME_WAIT), the remains of connections it served earlier and then stopped accepting. The
short double-tap seeks landed because they stayed **inside the already-buffered range** and
needed no HTTP request; the long seek jumped outside the buffer, forced a fresh range
request, and there was nothing to connect to. Short-works/long-fails is the signature of a
buffer boundary, not of seeking.

**This is not a Glide bug and it reproduced on LibVLC**, which is the clearest evidence that
the engine is not involved: no player can fetch from a server that is not listening. If it
recurs, check `cat /proc/net/tcp6 | awk '$4=="0A"'` for a listener before suspecting the
player. Nothing in Glide can keep another app's server alive.

The external cause was Stremio's server being gone, but investigating it exposed a genuine
regression we had introduced: an IO error leaves ExoPlayer in `STATE_IDLE` permanently, so playback is dead
until the video is reopened. LibVLC hid this with `--http-reconnect`, and deleting the VLC
init options deleted that safety net with it. `GlidePlayerView` now retries recoverable IO
errors (the `2000` block) up to three times, 1.5 s apart, and only reports the error to JS
once they are exhausted; `prepare()` resumes from the stopped position, and the counter
resets on `STATE_READY` so a long session is not killed by three unrelated hiccups.

### B9 — bitmap subtitles, built 2026-09-06

Accepted as a regression when VLC was deleted, then built straight afterwards. Implements D3:
ExoPlayer decodes PGS/VobSub to `Cue.bitmap`, and **our existing overlay draws them**, so
there is one rendering path instead of VLC's separate SPU surface.

**The mapping is the part worth remembering.** JS identifies a subtitle by
`SubtitleTrack.index`, which is ffmpeg's **absolute stream index** — it counts video and
audio streams too, so a file with 1 video + 2 audio gives subtitle indices 3, 4, 5.
ExoPlayer numbers text tracks separately from 0. Passing ffmpeg's index straight through
would address the wrong track or none at all. JS therefore sends the **ordinal among
subtitle streams** (`findIndex` over the subtitle list) and native selects its Nth text
track. Both sides log codec and language so a mismatch is visible rather than mysterious —
the ordinal assumes both enumerate the container in the same order, which is true for MKV
but is an assumption, not a guarantee.

**Text subtitles deliberately did not move.** Only *bitmap* tracks set `textTrack`; text
still comes from ffmpeg extraction, because haptics and negative subtitle delay both need
the whole cue list upfront and `onCues` cannot provide it (see the A7 note above). So the
split is: pictures from the engine, text from extraction, both drawn by the same overlay.

Bitmap cues bypass the overlay's drag-to-reposition and all its text styling — a PGS cue is
a picture with the position baked in by the authoring, so font, colour, outline and dragging
are all meaningless for it. Geometry comes through as media3's viewport fractions, with
`DIMEN_UNSET` sent as -1 and the overlay falling back to bottom-centre.

ponytail: cues cross the bridge as base64 PNG rather than as files. A PGS cue is mostly
transparent, compresses to tens of KB, and changes every few seconds, so there is nothing to
clean up. If a source ever produces large or rapid cues, write PNGs to `cacheDir` and send
`file://` URIs instead. Cues repeat every frame while one is on screen, so native only emits
when the set actually changes.

**`[unverified]` — no PGS content to test with.** The test file's five subtitle tracks are
all `subrip`. This compiles, typechecks and installs, but not one bitmap cue has been drawn
on a device. The ordinal mapping in particular is the thing most likely to be wrong. Play a
Blu-ray remux with a PGS track before believing any of it, and check the native
`text track N codec=... lang=...` lines line up with the JS subtitle list.

**The phase 0 spike is deliberately kept**, against this plan's own instruction to delete it.
It is debug-only, so it costs nothing in a release build, and as a minimal known-good control
on the same device and file it identified the HDR tone-mapping regression in two commands.
Delete it when there is no longer anything to compare against.

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

## 3.2 Decisions — all four settled 2026-09-06

### D1. Audio delay — **drop it**

There is no ExoPlayer equivalent, so keeping it means writing a custom `AudioProcessor`
that buffers and re-times PCM. That is real work for a feature whose usage nobody has
measured, and it would be the only piece of the migration built on speculation.

Note that `--audio-desync=100` was baked into the VLC init options with no recorded reason
— most likely compensating for something in VLC's own pipeline. Do not port a constant
nobody can justify into an engine that may not need it.

**Subtitle delay stays** and is free: cues are rendered by our overlay, so it is an offset in
JavaScript. That is also the delay users actually reach for.

Revisit only if audio sync complaints appear against real content. Adding it later is a
contained change; building it now is not.

### D2. LGPL — **keep static linking; make the decoder repo public**

Shared libraries were the instinctive answer and are the wrong one here: FFmpeg built shared
would produce `libavcodec.so`, `libavformat.so` and friends, and the app **already ships
those names** from `ffmpeg-kit`. Two different `libavcodec.so` cannot coexist in
`lib/arm64-v8a/`. Working around that means `--build-suffix`, which forks the build script
for every media3 upgrade.

Static linking has no collision, is what upstream ships, and the LGPL obligation is
satisfiable without touching the build at all:

- the code that links FFmpeg is media3's `decoder_ffmpeg`, which is **Apache-2.0 and
  public** — Glide itself never links FFmpeg;
- so make `glide-ffmpeg-decoder` **public**, and attach the FFmpeg static libraries and
  `build.properties` to each release.

Anyone can then modify FFmpeg and relink `libffmpegJNI.so` from published inputs and public
source. That is what §6 asks for, achieved by publishing rather than by re-engineering.

Cheaper, no fork, no name collision, and it makes the build auditable — which tracker §4.1
wants of anything reaching a release anyway.

### D3. Subtitles — **keep the custom overlay, and render bitmaps in it too**

The overlay stays exactly as it is. `androidx.media3.common.text.Cue` carries **both**
`text` and `bitmap`, so PGS and VobSub arrive through the same `onCues` callback as text
cues, as bitmaps to draw.

This removes the dependency on ExoPlayer's subtitle *rendering* entirely — we consume cues
and draw everything ourselves, which is what we already do — and it retires VLC's SPU path
along with `setSpuTrack`, `vlcTextTrackId` and the bitmap/text branch in
`usePlayerTracks`. One rendering path instead of two.

Also settles the earlier open question about android_display refusing to load without a
subtitles surface: irrelevant, because VLC is going.

### D4. Decoder mode — **remove the setting**

Hardware / software / hardware_plus is a VLC concept exposed in the UI. ExoPlayer selects
per device and falls back to the FFmpeg extension automatically. Remove the setting, the
`playerKey` remount it forces, and the `hwDecoderEnabled`/`hwDecoderForced` props.

## 3.3 What would make this plan wrong

- ExoPlayer cannot play a meaningful share of a real library → Phase 4 verification must use
  real content.
- The six resize modes cannot be reproduced on the new surface → Phase 3 is the risk peak.
- Audio delay turns out to be widely used → D1 becomes expensive.

The flag exists so any of these can stop the migration without a revert.
