# Glide — Independent Status Review & Hardening Plan

Author: fresh review, 2026-08-22. Supersedes `current-context-2026-08-22.md` where they disagree.
Everything below was verified against this working tree and against upstream sources on 2026-08-22.
Where I could not verify something, it says so.

---

## 0. TL;DR

- **The tree is healthier than you think.** It typechecks clean, lints with 0 errors, and the Android
  debug Kotlin+Java compile passes. Roughly **two thirds of your uncommitted diff is good work that
  should be committed as-is.**
- **The PiP work is the part that is wrong**, and it is wrong *architecturally*, not in detail. It
  cannot be patched into correctness. It needs ~250 lines deleted and ~150 written in a different
  place. I know exactly which place, and I verified the APIs exist in the versions you already ship.
- **Four distinct PiP bugs are visible in your screenshots, and I found the specific cause of each
  in the code.** They are not the same bug.
- **You are not on a deadline.** The context doc treats the Google Play API-36 cutoff (Aug 31, 2026)
  as urgent. You ship APKs from GitHub Releases + Stallion OTA — Play does not gate you. That frees
  the ordering: fix PiP first, migrate the toolchain second. The context doc had this backwards.
- **Two production bugs nobody has noticed yet:** background-playback media controls are dead on
  every Android 13+ device (permission never declared), and your entire test suite has been red
  for a while (it cannot even load).

---

## 1. Verified current state

Run today, against the dirty tree:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `npx eslint .` | **0 errors**, 353 warnings (unused vars, useless escapes) |
| `npx jest` | **FAILS** — 1 suite, 0 tests run. `react-native-mmkv` is ESM and not in `transformIgnorePatterns` |
| `gradlew :app:compileDebugKotlin :app:compileDebugJavaWithJavac` | **exit 0** |
| `git diff --stat` | 27 files, +1448 / −378 — matches the context doc exactly |

CI (`.github/workflows/android-ci.yml`): builds and publishes APKs. **No lint step, no typecheck
step, no test step.** Uses Node 20 (RN 0.87 will require >= 22.13). Installs with
`npm ci --legacy-peer-deps`, which is hiding whatever peer conflicts exist.

Distribution: GitHub Releases APK, per-ABI, selected at runtime by `UpdateService`, installed by
`ApkInstallerModule`, plus `react-native-stallion` OTA. **Not Google Play.**

---

## 2. Corrections to the context doc

Things it got right (verified): RN 0.87.0 is latest stable and wants React `^19.2.3` and Node
`^22.13.0 || ^24.3.0 || >=26`; compileSdk/buildTools 37 and Kotlin >= 2.0 (2.2.0 bundled); LibVLC
stable really does top out at **3.7.5** (latest published is `4.0.0-eap29` — do not ship it);
`InteractionManager` really is removed in 0.87; the `react-native/Libraries/Image/resolveAssetSource`
deep import really is a hard type error now.

Things it got wrong or missed:

1. **The Play API-36 deadline does not apply to you.** New apps and updates on Play must target 36
   from Aug 31, 2026, extendable to Nov 1. You self-distribute. targetSdk 34 is a quality debt item,
   not an emergency. This changes the whole execution order.
2. **RN 0.82 removed the legacy architecture but kept the interop layers.** Your `SimpleViewManager`
   VLC view and your `ReactContextBaseJavaModule` native modules keep working on 0.87 unmodified —
   you already run `newArchEnabled=true` today, so you are already on that path. The doc implies a
   scarier migration than this is. There is **no forced Fabric/TurboModule rewrite.**
3. **`androidx.core:core-pip` is still `1.0.0-alpha03`** (three alphas total, latest Jul 1 2026).
   `VideoPlaybackPictureInPicture` lives there, not in stable `androidx.core` 1.19.0. My
   recommendation: **do not adopt it.** You do not need it — see §4. Revisit when it hits beta.
4. **You do not need any new Activity plumbing at all.** The doc proposes an "Activity-owned PiP
   controller" wired through both Activities. `androidx.activity:activity:1.8.0` is already in your
   resolved dependency graph, and `ComponentActivity` there exposes
   `addOnPictureInPictureModeChangedListener(...)` plus `Lifecycle` (`ON_START`/`ON_STOP`). I checked
   the AAR in your Gradle cache with `javap`. That means the **video view can own its own PiP and its
   own lifecycle, with zero Activity code and zero host-name bookkeeping.** This is a much smaller
   diff than the doc's plan and it deletes more than it adds.
5. **LibVLC 3.6.5 already has everything needed to delete your custom geometry code.** Verified by
   `javap` against the AAR in your Gradle cache: `VLCVideoLayout`, `MediaPlayer.attachViews(...)`,
   `updateVideoSurfaces()`, `setVideoScale(ScaleType)`, and a 12-member `ScaleType` enum including
   `SURFACE_BEST_FIT`, `SURFACE_FIT_SCREEN`, `SURFACE_FILL`, `SURFACE_ORIGINAL`. Your six resize
   modes map onto it almost 1:1. You do not need to upgrade LibVLC first to do this.
6. **Missed: `POST_NOTIFICATIONS` is never declared.** `ReactVlcPlayerView.showNotification()`
   checks the permission at line ~3089 and bails, but the permission appears in neither
   `android/app/src/main/AndroidManifest.xml` nor the library manifest, and nothing requests it.
   On API 33+ (i.e. every current device) **background-play media/lockscreen controls never appear.**
7. **Missed: background playback has no foreground service.** Audio continues from a stopped
   Activity. It works until the OS decides otherwise. This is the real reason background playback
   feels flaky, and it is a separate piece of work from PiP.
8. **Missed: the 16 KB page-size gradle block is a no-op.** `defaultConfig.externalNativeBuild.cmake
   { arguments "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON" }` in `app/build.gradle` does nothing —
   the app module has no CMake project. Real 16 KB compliance depends on the prebuilt `.so` files
   inside libvlc and the ffmpeg AAR, and must be checked with `zipalign -c -P 16`.
9. **Missed: the doc's "verified compile" proves less than it sounds.** The compile check passes, but
   there is no runtime coverage of anything, because (see §1) jest cannot even load.

---

## 3. Verdict on the uncommitted diff

### 3a. Commit as-is — this is good work (~600 lines)

| File | Why it's right |
|---|---|
| `src/store/appStore.ts` | Canonical `DEFAULT_APP_SETTINGS` extraction. Correct. |
| `src/hooks/useSettings.ts` | Migration merges persisted settings **over** canonical defaults, including nested haptics. Fixes the whole class of "new setting is undefined after update". |
| `src/hooks/video-player/useZoomGesture.ts` | Real bug fix: pan clamp used `min(w,h)` for both axes, so horizontal pan was over-clamped in landscape. Now per-axis. |
| `src/hooks/video-player/usePlayerCore.ts` + `types.ts` + native `isBuffering` payload | The native side now sends `isBuffering`, and JS stops inferring it from a missing field. Correct pairing. |
| `src/hooks/video-player/usePlayerSettings.ts` | Deletes the "disable EQ for 50 ms to force re-apply" hack. Exactly the right instinct. |
| `ReactVlcPlayerView.java`: `mRateHandler.post` instead of `postDelayed(…, 80)` | Deletes a magic delay. |
| `ReactVlcPlayerView.java`: `mPausedForHostPause` / `mPausedForAudioFocus` / `mPausedForNoisyEvent` | Separating "user paused" from "system paused" is the correct model and fixes the resume-after-focus-loss class of bugs. **Keep the flags, delete the timers around them** (§3c). |
| `src/services/OMDBService.ts`, `UpdateService.ts`, `subdlApi.ts` (timeout parts) | Every network call now has a timeout and typed timeout handling. Keep. |
| `src/components/TrackSelector.tsx`, `src/screens/PlayerDetailScreen.tsx` | Abort on unmount / on new request, and `isAbortError` early-returns so cancellation stops looking like failure. Also fixes a duplicated `setSearchResults` and two wrong `useCallback` dep arrays. Keep. |
| `src/components/UpdateModal.tsx` | `react-native-markdown-display` wants style *objects*, not arrays. Real fix. |
| `libs/glide-vlc-player/index.d.ts`, `package.json`, `project.pbxproj` | Version bumps / prop typing. Fine. |

Two with a caveat:

- **`android/app/build.gradle` signing fallback.** `signingConfig hasReleaseSigningConfig ?
  signingConfigs.release : signingConfigs.debug` means a release build with no keystore configured
  **silently produces a debug-signed APK**. Your updater installs APKs as signature-compatible
  upgrades; a debug-signed release will fail to install over a real one, or worse, ship. Change it to
  fail the build unless an explicit `-PallowDebugSigning=true` is passed.
- **`PlayerControls.tsx` always-mounted with `opacity: 0`.** Right fix for the one-frame zero
  progress bar. But the Reanimated worklets keep writing the time text while it is invisible. Add a
  `showControls` guard inside the worklets so they early-return when hidden.

### 3b. Delete outright

- **`src/services/SubtitleCacheService.ts` — the whole file, including the +168 lines just added to
  it.** Repo-wide grep: **zero importers.** The live subtitle cache is `FileService`. The atomic
  write/backup/sanitise work you just did is careful, correct, and completely unreachable.
- **`createCoalescedRequest` in `src/utils/network.ts`** (~70 of its 176 lines). Consumer-counted
  request coalescing with a shared `AbortController`, for a case that does not occur: every screen
  already cancels its own stale work. Keep `fetchWithTimeout` / `NetworkTimeoutError` /
  `isAbortError` — those earn their place today, because RN 0.78 gets `AbortSignal` from the
  `abort-controller` polyfill, which has no `AbortSignal.timeout()`.
- **`libs/glide-vlc-player/playerView/*`** (5 files, ~1400 lines) and the lib's `react-native-slider`
  + `react-native-vector-icons@9` dependencies. Only reachable through the unused `VlCPlayerView`
  export in `libs/glide-vlc-player/index.js`.
- **`libs/glide-vlc-player/expo/`, `app.plugin.js`, `@expo/config-plugins`** — Expo config-plugin
  machinery in a bare-RN local package.
- **All `Build.VERSION.SDK_INT < Build.VERSION_CODES.O` branches** in `PipModule.kt`. `minSdkVersion`
  is 26. They are unreachable.
- **`axios`** — one caller (`RecapService`), and you now have `fetchWithTimeout`.
- **`baseline-browser-mapping`** — declared in devDependencies, referenced by nothing but lockfiles.

### 3c. Revert and rebuild — this is the part that is wrong

All of it is timer-and-retry compensation for ownership sitting in the wrong layer:

| What | Where | Why it must go |
|---|---|---|
| Host-activity name matching (`activeHostActivityName`, `pipStateByActivity`, `hostMatches`, `activityMatchesConfiguredHost`, `clearHostOwnership`) | `PipModule.kt` | Solving "which Activity owns PiP" from JS by passing string class names. The view already knows its own Activity. |
| `onPictureInPictureModeChanged` forwarding + `onDestroy` notification | `MainActivity.kt`, `VideoPlayerActivity.kt` | Replaced by one `addOnPictureInPictureModeChangedListener` inside the view. |
| JS `measureInWindow` source-rect ownership, `pipSourceRectRef`, `refreshPipSourceRect`, `onLayout` hook | `VideoPlayerScreen.tsx` | Also a **live bug**: `measureInWindow` returns **dp**, `Rect`/`setSourceRectHint` expects **px**. On a 3x device the hint is a third of the correct size. |
| `pipPreparing` + double `requestAnimationFrame` before entering PiP | `VideoPlayerScreen.tsx` | Guessing at frame timing. Nothing can make a JS render deterministically precede a system window animation. |
| `AppState`-driven `checkPipStatus` re-polling | `src/native/PipModule.ts` | The native callback is authoritative. |
| 800 ms `PIP_HOST_PAUSE_GRACE_MS` timer + `mAwaitingPipAutoEnter` | `ReactVlcPlayerView.java` | Compensating for reading PiP state at `onPause`. `onStop` is the correct signal and needs no timer. |
| `schedulePipResizeSync` 4-step retry ladder (0/48/128/320 ms) + `forceResizeMode` + `mLastApplied*` dedup cache | `ReactVlcPlayerView.java` | Four callbacks (view layout, config change, TextureView size, View size) racing to reapply geometry, plus a dedup cache to suppress the resulting storm. Replaced by one `updateVideoSurfaces()` path. |
| 150 ms audio-track retry (`scheduleAudioTrackApply`, `applyRequestedAudioTrack` retry arm) | `ReactVlcPlayerView.java` | Retry on a real VLC track/state event or not at all. |

---

## 4. The PiP bugs — one cause each

Your four screenshots are four different failures. Mapped to code:

**Screenshot 1 — video slightly letterboxed inside the PiP window.**
`VideoPlayerScreen.handleEnterPip` derives the PiP aspect ratio from the **video surface rect**
(i.e. the screen), not from the **video**:

```
aspectRatioWidth  = pipRect ? (pipRect.right - pipRect.left) : width
aspectRatioHeight = pipRect ? (pipRect.bottom - pipRect.top) : height
```

So the PiP window gets the phone's aspect ratio and the media stays letterboxed inside it.
Fix: aspect ratio must be the video's display aspect ratio,
`(videoVisibleWidth * sarNum / sarDen) / videoVisibleHeight`, clamped to Android's legal
`[0.4184, 2.39]`. Nothing outside the native view knows those numbers, which is the tell that
ownership is in the wrong layer. Unclamped is also a latent failure: an ultrawide source makes
`setAspectRatio` throw, `enterPipMode` rejects, and PiP silently does nothing.

**Screenshot 2 — video drawn offset/cropped in the corner of the PiP window; dragging the window
fixes it.**
The surface got the new size but the geometry was recomputed from stale values, and the leftover
`TextureView` transform matrix was never neutralised for the new bounds. `applyResizeMode()` is
additionally gated by `isResizeConfigurationAlreadyApplied(...)`, so the correcting pass can be
suppressed as a duplicate. Dragging forces another layout pass, which is the one that finally lands.
That is what the 4-step retry ladder exists to paper over.

**Screenshot 3 — the HUD, time readouts and transport buttons render *inside* the PiP window.**
The overlay tree is hidden by a React render (`pipPresentationActive`), which happens some frames
*after* the system has already started the PiP animation. No amount of `requestAnimationFrame` fixes
that ordering, and on auto-enter (swipe-to-home) JS gets no warning at all. On API 35+ the platform
offers `onPictureInPictureUiStateChanged` / `isTransitioningToPip()` for exactly this, but the robust
answer is to not depend on JS timing: hide siblings natively in the PiP callback, on the main thread,
in the same frame batch as the resize.

**Screenshot 4 — the PiP window shows the *movie detail screen*, poster and back button.**
This is the sharpest one. `clearPipModeConfig` resets the module's Kotlin fields and **never calls
`activity.setPictureInPictureParams(...)`**, so `autoEnterEnabled = true` stays live on the Activity
forever. Navigate off the player (external-open flow: `VideoPlayerActivity` -> back to
`PlayerDetail`), press Home, and Android auto-enters PiP on a screen that has no video in it. The
`!isScreenFocused` effect *does* push `autoEnterEnabled: false`, but the unmount path
(`clearPipModeConfig`) does not, and unmount-vs-blur ordering is not guaranteed. Fix: auto-enter is
owned natively and derived from "video surface attached AND playing". Then no JS ordering can leak it.

---

## 5. Plan

Ordering rationale, since it differs from the context doc: PiP comes before the toolchain migration
because (a) nothing external forces the SDK bump, (b) PiP is the defect that makes the app feel
broken, and (c) debugging native surface geometry on a freshly migrated RN/AGP/Kotlin/LibVLC stack
means debugging two unknowns at once. Migrate onto code you trust, not the reverse.

### Phase 0 — Commit the good work and stop the bleeding (~half a day)

1. Commit §3a as two or three focused commits (`fix(settings)`, `fix(player)`, `fix(net)`), so the
   PiP rebuild has a clean base to revert against.
2. Delete everything in §3b.
3. Declare `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` and request it
   the first time background play or PiP is enabled. **This alone restores media/lockscreen controls
   on every Android 13+ device.**
4. Make the signing fallback explicit (`-PallowDebugSigning=true`), so a release can never be
   quietly debug-signed.
5. Fix jest: add `react-native-mmkv` (and any other ESM deps) to `transformIgnorePatterns`, get the
   one existing suite green.
6. Add `tsc --noEmit`, `eslint .` and `jest` as CI steps **before** the build step.

Exit check: `tsc` + `eslint` + `jest` green in CI; release build fails loudly with no keystore;
notification appears on an Android 14 device with background play on.

### Phase 1 — Rebuild PiP where it belongs (2–3 days)

Move PiP ownership **into `ReactVlcPlayerView`**, because that class is the only place that knows all
four inputs PiP needs: its own Activity, the video's real dimensions and SAR, its own on-screen
bounds, and whether playback is live.

Delete: §3c rows 1–5 (PipModule host bookkeeping, both Activities' PiP overrides, JS source-rect
ownership, `pipPreparing`, the double rAF, the AppState polling).

Add, inside the library module:

- On attach: `(activity as ComponentActivity).addOnPictureInPictureModeChangedListener { … }`.
  Verified present in `androidx.activity:activity:1.8.0`, already on your compile classpath. Remove
  the listener on detach. This is the entire Activity integration.
- `setPipEnabled(boolean)` prop — JS says only *"PiP is allowed right now"* (screen focused, no modal
  open). It never says how, when, or with what geometry.
- One `updatePipParams()` that builds `PictureInPictureParams` from:
  - aspect ratio = clamped video DAR (see §4),
  - `sourceRectHint` = `getGlobalVisibleRect()` on the view itself — **px, correct by construction**,
  - `setAutoEnterEnabled(pipEnabled && videoAttached && isPlaying)` on API 31+,
  - `setSeamlessResizeEnabled(true)` (correct for video content).

  Called from one `OnLayoutChangeListener` on the view plus the video-size event. Not from six places.
- In the PiP-mode-changed callback (main thread, same frame batch as the resize): walk from this view
  up to `android.R.id.content`, set sibling visibility `GONE`, neutralise any inherited transform,
  and restore on exit. ~25 lines, and it makes the PiP presentation independent of JS render timing —
  which is what kills screenshot 3 on every API level, not just 35+.
- Keep JS `isInPipMode` as the steady-state signal for the React tree. Native handles the transition;
  JS handles the seconds after it.

`PipModule.kt` shrinks to two methods: `isPipSupported()` and `enterPictureInPicture()`. Better: drop
the second one too and add an `enterPictureInPicture` entry to the ViewManager's existing
`getCommandsMap()` (which already has 5 commands and a matching `dispatchViewManagerCommand` path in
`VLCPlayer.tsx`), so PiP entry goes to the view that owns PiP rather than to a module that has to
guess which view meant it.

Exit check: manual PiP and swipe-to-home auto PiP, on a 16:9, a 2.39:1 and a portrait source; pinch
the PiP window without dragging it; navigate to the detail screen and press Home (must **not** enter
PiP); expand and dismiss.

### Phase 2 — Geometry and lifecycle, timer-free (2–3 days)

**Geometry.** Replace the hand-rolled contain/cover/fill/original/scale-down/best-fit math
(`applyResizeModeInternal` and its six helpers, ~200 lines) plus `forceResizeMode`, the retry ladder,
and the `mLastApplied*` dedup cache with LibVLC's own path — verified present in the 3.6.5 AAR you
already ship:

```
contain    -> ScaleType.SURFACE_BEST_FIT
cover      -> ScaleType.SURFACE_FIT_SCREEN
fill       -> ScaleType.SURFACE_FILL
none       -> ScaleType.SURFACE_ORIGINAL
scale-down -> SURFACE_ORIGINAL, clamped to BEST_FIT when the source exceeds the view
best-fit   -> your hysteresis heuristic, choosing between BEST_FIT and FIT_SCREEN only
```

with a single `updateVideoSurfaces()` on layout change. SAR, letterboxing and rotation then become
VLC's problem, handled by the same code VLC-Android ships. This is where "dragging the PiP window
fixes it" stops being possible. JS keeps *only* user pinch-zoom/pan, forced off in PiP and in
non-`contain` modes — which the current diff already does correctly in
`usePlayerGestures`/`useZoomGesture`.

Note: `attachViews(VLCVideoLayout, …)` implies the view becomes a container rather than being a
`TextureView` itself. Pass `useTextureView = true` to keep `getBitmap()` working for snapshots. If
that migration turns out to fight RN's view management, the fallback is to keep the current
TextureView but collapse the six resize callbacks into one and route all of them through
`setVideoScale`. Decide this with a spike before committing to it.

**Lifecycle.** Delete the 800 ms grace timer. Observe the Activity's `Lifecycle` (`ON_START` /
`ON_STOP`) instead of RN's `onHostPause`/`onHostResume`. Entering PiP produces `onPause` but **not**
`onStop`; leaving PiP to the background produces `onStop`. That single change makes the correct
behaviour fall out with no timing guess, and it is the reason the timer exists at all.

**Audio track.** Delete the fixed 150 ms retry. Keep the requested track in a field, apply it on the
real `MediaPlayer.Event` (`Playing` / `ESAdded`), and stop. Then measure with real fixtures (MKV with
3 audio tracks, AC3, EAC3, HEVC) to see what is bridge churn and what is unavoidable decoder
reconfiguration — right now nobody knows which is which.

**Handlers.** Nine `Handler`/`Executor` instances in one class. Collapse to one main-thread `Handler`
plus the seek executor. Fewer objects, and one place to cancel everything on release.

Exit check: rotate during playback; switch resize modes in every mode; pinch-zoom then enter PiP
(transform must be gone); switch audio tracks 10x on an MKV; lock screen, Bluetooth disconnect, and
an incoming call, each with and without background play.

### Phase 3 — Toolchain migration, as one coordinated change (3–5 days)

Do this as a single template-aligned migration, not as independent bumps. The RN upgrade-helper diff
for 0.78.3 -> 0.87.0 is the source of truth for the template files.

- `react-native` 0.78.3 -> **0.87.0**; `react` 19.0.0 -> **19.2.3**; `@types/react` -> ^19.1.1
- `@react-native/{babel-preset,metro-config,eslint-config,typescript-config}` 0.76.0 -> **0.87.0**
  (these being 11 minors behind the runtime is its own latent bug source)
- `@react-native-community/cli*` `15.0.0-alpha.2` -> current stable
- Node: engines `>=18` -> `>=22.13`; CI `node-version: 20` -> 22
- Android: compileSdk 35 -> **37**, buildTools -> **37**, targetSdk 34 -> **36**, Kotlin 1.9.24 ->
  **2.2.0**, AGP -> 9 (opt out of the new DSL first with `android.builtInKotlin=false` /
  `android.newDsl=false`, then remove the opt-outs deliberately)
- Reconcile the NDK version — root declares `26.1.10909125`, `app/build.gradle` overrides with
  `27.0.12077973`. Pick one. Delete the no-op CMake block while you are there.
- LibVLC 3.6.5 -> **3.7.5** (stable). Not 4.0.0-eap.
- `libs/glide-vlc-player/android/build.gradle`: replace `com.facebook.react:react-native:+` with a
  pinned version, delete the nested `buildscript` pinning AGP 4.0.2, drop the dead
  `mvnrepository.com` repo, align `compileSdk`/`abiFilters` with the app (the module builds
  x86/x86_64 the app never packages).
- Known blockers, both confirmed present: `libs/glide-vlc-player/VLCPlayer.tsx:13` deep-imports
  `react-native/Libraries/Image/resolveAssetSource` -> use `Image.resolveAssetSource`;
  `src/screens/OnboardingScreen.tsx:13,151` uses removed `InteractionManager` ->
  `requestIdleCallback`.
- `react-native-fast-image` (7 call sites) declares React 17/18 peers and is unmaintained. It only
  loads posters and thumbnails. Move to RN's own `Image` and drop the dependency.
- Revisit `src/utils/network.ts` **after** the upgrade: if `AbortSignal.timeout()` /
  `AbortSignal.any()` are available on the new Hermes, the file collapses to about 20 lines.
- Leave alone in this phase: `react-native-ffmpeg-kit` and the vendored `ffmpeg-kit-minimal.aar`.
  Upstream ffmpeg-kit is archived; your local AAR plus the five dependency substitutions is the
  correct mitigation for now. Clean up the duplicate app-level `com.arthenica:ffmpeg-kit-https:6.0-2`
  and `smart-exception-java` declarations, but do not attempt a successor migration in the same phase
  as an RN major.
- Also leave alone: `androidx.media` -> Media3. It is real debt (`MediaSessionCompat`,
  `PlaybackStateCompat`, `MediaButtonReceiver` are all legacy support-library), but a LibVLC-backed
  Media3 `Player` adapter is its own architectural project. It belongs with Phase 4, not here.

Exit check: clean build from a wiped `node_modules` and Gradle cache; APK installs over a previous
release; `zipalign -c -P 16` on the release APK to confirm 16 KB page alignment of the bundled `.so`
files; full device matrix (§6).

### Phase 4 — Background playback done properly (2–3 days)

Today audio continues from a stopped Activity with no foreground service. That is the actual cause of
"background play sometimes just stops". Move playback ownership into a foreground service with
`foregroundServiceType="mediaPlayback"` and a `MediaSession` the notification is built from. This is
also the natural moment for `androidx.media` -> **Media3 1.11.0**, because Media3's
`MediaSessionService` is the thing you would otherwise hand-roll.

Sequence this **after** Phase 3, and treat it as optional if background play is not a headline
feature for you — but do not call background playback production-ready before it.

### Phase 5 — Guardrails (ongoing)

- CI gates from Phase 0 stay mandatory.
- One real test per non-obvious pure function you actually rely on: `compareVersions`,
  `FilenameParser`, `SubtitleParser`, `selectApkForDevice`. Small, fast, no fixtures, no framework
  beyond the jest you already have. These are the functions where a silent regression ships broken
  updates or unplayable subtitles.
- A written device-test script (§6) run before each release, since no automated test can cover PiP.
- Turn the 353 eslint warnings into either fixes or explicit disables, then set `--max-warnings 0`,
  so the next real warning is visible.
- 371 `console.*` calls in `src/`. Most are `__DEV__`-gated; make that a lint rule rather than a habit.

---

## 6. Device matrix that actually pays

The context doc's matrix is thorough but too big to run every release. This is the subset where the
failures actually live:

**Must run every release:** Android 12+ auto-enter PiP (swipe home) and manual PiP, on 16:9 and on
2.39:1 sources; pinch-resize the PiP window **without** dragging afterwards (this is the geometry
regression detector); navigate to the detail screen then press Home (must not enter PiP); in-app
playback in `MainActivity` **and** external-open in `VideoPlayerActivity`; screen lock and Bluetooth
disconnect during playback; MKV with multiple audio tracks, track-switch 5x; APK update install over
the previous release.

**Run when native code changed:** Android 8/9 manual PiP (no auto-enter path); Android 15 PiP
transition callback; Android 16 / API 36 back navigation; portrait, rotated, and non-square-pixel
(SAR != 1) sources; AC3/EAC3; network stream.

---

## 7. Explicit do-nots

- Do not extend the existing PiP or resize implementation. Every additional retry step or grace
  window makes the next bug harder to see. Replace the ownership.
- Do not adopt `androidx.core:core-pip` while it is alpha. Platform `PictureInPictureParams` plus the
  `androidx.activity` listener you already have on the classpath covers all of it.
- Do not move to LibVLC 4.0.0-eap.
- Do not combine the `androidx.media` -> Media3 migration with the RN upgrade or with the PiP rebuild.
- Do not add a new subtitle cache index. `FileService` owns that path; design keys around the actual
  callers first.
- Do not `git reset`/`checkout` the dirty tree. Two thirds of it is worth keeping (§3a).

---

## 8. Rough shape

| Phase | Work | Net code |
|---|---|---|
| 0 — commit good work, permissions, CI gates | ~0.5 day | -600 |
| 1 — PiP ownership rebuild | 2–3 days | -250 / +150 |
| 2 — geometry + lifecycle + audio, timer-free | 2–3 days | -400 / +120 |
| 3 — RN 0.87 / SDK 36 / Kotlin 2.2 / LibVLC 3.7.5 | 3–5 days | ~flat |
| 4 — foreground service + Media3 (optional) | 2–3 days | +300 |
| 5 — guardrails | ongoing | +150 |

Phases 0–2 are what make the app feel fixed. Phase 3 is what keeps it alive. Phase 4 is what makes
background playback honest.

---

## 9. Sources checked (2026-08-22)

- <https://registry.npmjs.org/react-native/latest> — 0.87.0, react `^19.2.3`, node `^22.13.0 || ^24.3.0 || >=26`
- <https://reactnative.dev/blog/2026/08/11/react-native-0.87> — removals (InteractionManager, deep imports), compileSdk 37, Kotlin 2.2, AGP 9
- <https://reactnative.dev/versions> — 0.87 latest stable
- <https://reactnative.dev/blog/2025/10/08/react-native-0.82> + reactwg discussion #290/#309 — legacy arch removed, interop layers retained
- <https://developer.android.com/google/play/requirements/target-sdk> — API 36 from Aug 31 2026 (Play only)
- <https://developer.android.com/develop/ui/views/picture-in-picture> — autoEnter, sourceRectHint, `isTransitioningToPip`, pause on `onStop` not `onPause`
- <https://developer.android.com/develop/ui/compose/system/pip-jetpack> + <https://developer.android.com/jetpack/androidx/releases/core> — core-pip 1.0.0-alpha03, core 1.19.0 stable
- `maven-metadata.xml` for `org.videolan.android:libvlc-all` — 3.7.5 latest stable, 4.0.0-eap29 latest overall
- `javap` on `libvlc-all-3.6.5.aar` and `activity-1.8.0.aar` from the local Gradle cache — API surface confirmed firsthand
