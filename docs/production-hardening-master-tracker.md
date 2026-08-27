# Glide Production Hardening Master Tracker

**Created:** 2026-08-23  
**Repository baseline:** `6b7f2c7`  
**Source/public version at baseline:** `1.8.1` / `v1.8.1-build.54`  
**Primary platform today:** Android  
**Distribution today:** GitHub Releases APKs and Stallion OTA  
**Purpose:** the single, file-level source of truth for all verified production work known at this baseline.

This document supersedes `docs/hardening-plan.md`,
`docs/current-context-2026-08-22.md`, and
`docs/production-fix-tracker.md` where status, ordering, or advice differs.
Those files remain useful as history until they are archived after this tracker is accepted.

This tracker is exhaustive in a precise sense: it records every concrete defect,
cleanup, migration, test, decision, and release check verified in the repository at
the baseline above. It does not claim that unknown future bugs cannot exist, and it
does not turn speculative features into work. New findings must be appended here.

## 1. How to use this tracker

Status:

- `[todo]` — verified work not started.
- `[doing]` — actively being changed; record the branch/commit beside it.
- `[done]` — implemented and acceptance checks passed; record the commit.
- `[blocked]` — cannot proceed; state the exact external blocker.
- `[decision]` — product choice required before implementation.
- `[keep]` — reviewed and intentionally retained; do not reopen without new evidence.

Priority:

- **R0 — incident/release freeze:** act before another public build can be produced.
- **R1 — next-release blocker:** must be complete before the next public APK.
- **P1 — production correctness:** complete before calling the affected feature production-ready.
- **P2 — migration/maintenance:** scheduled work with a verified reason.
- **P3 — cleanup/guardrail:** lowers future cost but does not block a release by itself.

Completion rule: changing code is not enough. An item becomes `[done]` only when its
listed automated and manual acceptance checks pass.

## 2. Verified baseline

### 2.1 Work already completed — do not redo

- `[done]` Phase 0 commits `7adb033..48ae9f3`:
  - separated several host/system pause paths from user pause intent;
  - fixed buffering payload/React interpretation;
  - kept controls mounted to prevent the progress flash;
  - hardened persisted-settings migration;
  - added subtitle/network cancellation and timeouts;
  - required explicit opt-in for debug-signed release builds;
  - added TypeScript, ESLint, and Jest gates to CI;
  - removed the old subtitle cache service and unused player UI.
- `[done]` Phase 1 commits `30a6512`, `498cff1`, `ebc93bf`, and `8747dab`, in
  chronological order:
  - PiP eligibility, aspect ratio, source bounds, and auto-enter moved into the native video view;
  - tested entry without a corrective drag and fixed resize after PiP window changes;
  - stopped auto-enter leaking onto non-player screens;
  - stopped the non-`contain` render loop;
  - stopped the gesture tree rebuilding about twice per second by narrowing callback
    dependencies from the whole changing `player` object to stable
    `setIsSeeking`, `previewSeek`, `commitSeek`, and `currentTimeRef` members;
  - added three `hudReducer UPDATE_ZOOM` tests that require unchanged/repeated scale
    updates to retain object identity while genuine scale changes produce new state;
  - confirmed that Fabric pauses mount dispatch for the entire time the Activity is in PiP.
- `[keep]` `VlcPipController`'s native PiP subtree bounds override and native sibling hiding.
  React-managed bounds cannot update while Fabric is paused in PiP. The `ponytail:`
  marker at `VlcPipController.java:439` records this deliberate ownership exception.
- `[keep]` the event-driven `AppState.addEventListener` PiP state reconciliation.
  The removed one-second interval was polling; the current AppState event is not.
- `[keep]` the small `MainActivity` and `VideoPlayerActivity` PiP mode relays unless a
  measured bug justifies replacing them. A static registry would be more code.
- `[keep]` `createCoalescedRequest` for now. It has two live SubDL consumers. Simplify
  only after a concurrency test proves coalescing is unnecessary or a smaller equivalent replaces it.

### 2.2 Checks run at this baseline

- `[done]` `npx tsc --noEmit` — clean.
- `[done]` `npx jest --ci --runInBand` — 2 suites, 10 tests passed.
- `[done]` `gradlew :app:compileDebugKotlin :app:compileDebugJavaWithJavac` — passed.
- `[todo]` ESLint — 0 errors but 262 warnings at audit time; warnings are not yet a useful gate.
- `[todo]` `npm audit --omit=dev` — 23 advisories at audit time: 1 critical,
  19 high, 2 moderate, 1 low. Triage by reachable runtime impact, not count alone.
- `[done]` ELF inspection of the vendored AARs:
  - ARM64 LibVLC 3.6.5 libraries use 16 KB LOAD alignment;
  - ARM64 FFmpeg libraries use 16 KB LOAD alignment;
  - ARM64 `libffmpegkit.so` and `libffmpegkit_abidetect.so` use 4 KB LOAD alignment;
  - 32-bit FFmpegKit libraries use 4 KB alignment, but Android's 16 KB device concern is ARM64.
- `[todo]` no signed release APK has yet passed the complete release checklist in section 16.
- `[blocked]` iOS cannot be compiled or visually verified on the current Windows host.

### 2.3 Release state

- `[done]` GitHub Actions run `32650137072` completed successfully for `6b7f2c7`.
- `[done]` [GitHub Release `v1.8.1-build.54`](https://github.com/Pranav-pradeep0/glide-public/releases/tag/v1.8.1-build.54),
  “Glide 1.8.1 (Build 54),” was published on 2026-08-23 with
  `Glide-v1.8.1-arm.apk` and `Glide-v1.8.1-arm64.apk`.
- `[keep]` Treat 1.8.1 as installed in the wild. Never reuse version `1.8.1`, even if
  download counts are zero or the release is later hidden/deleted.
- Never assume “pushed,” “workflow succeeded,” “GitHub Release published,” and “users
  can update” are the same state. Record all four in each release entry.

## 3. R0 — contain the release and credential incidents

### 3.1 Stop further accidental publication

- `[done]` Do not attempt to cancel or replace 1.8.1; it is already public.
- `[todo]` Until section 4 is complete, do not push another commit to `main` or `develop`.
  The current workflow publishes after ordinary pushes to either branch.
- `[todo]` Implement the workflow correction on a branch the old publish trigger does
  not watch, validate it in a pull request, and merge only after confirming the merged
  workflow definition makes the `main` push verification-only.
- `[todo]` Inventory GitHub Releases and tags created from both `main` and `develop`:
  - record tag, commit, branch, `versionName`, `versionCode`, signer, and assets;
  - identify any non-prerelease built from `develop`;
  - do not delete historical releases merely to hide the embedded key; deletion does
    not revoke a credential already downloaded.
- `[todo]` Record 1.8.1 asset download counts when the incident inventory is taken, but
  do not use a low count as evidence that the embedded credential was not extracted.

Files: `.github/workflows/android-ci.yml`, `package.json`, GitHub Releases settings.

Exit check: ordinary branch pushes can run verification but cannot create a tag,
GitHub Release, or release asset.

### 3.2 Contain the exposed Groq key

Verified exposure path:

1. `.github/workflows/android-ci.yml` writes `GROQ_API_KEY` to `.env`.
2. `react-native-config` compiles it into the mobile application.
3. `src/utils/constants.ts` exposes it to JavaScript.
4. `RecapService.ts` uses it for chat completions.
5. `SpeechToTextService.ts` uses it for transcription and translation.

`react-native-config` does not encrypt packaged values. Rotating the key and embedding
the replacement in another APK creates the same exposure again.

- `[todo]` Revoke/rotate the currently exposed Groq key in the Groq console. If done
  before a replacement architecture exists, recap and speech-to-text in already
  installed APKs will fail; that is an explicit availability-versus-abuse decision.
- `[todo]` Review Groq usage, rate, and billing logs from the earliest release that
  contained the key. Record any unexpected usage and the revocation timestamp.
- `[todo]` Remove `GROQ_API_KEY` from the production `.env` generation step.
- `[todo]` Remove the production assumption that a build-time environment variable is secret.
- `[done]` `[decision]` Restoration model selected: **backend proxy**. `proxy/` is a
  Cloudflare Worker holding `GROQ_API_KEY` as a Worker secret and exposing only
  `/v1/recap` and `/v1/transcribe`. It caps body and audio size, pins the models and
  upstream endpoints, times out, and logs route plus status only — never dialogue,
  audio, headers, or upstream bodies. The rejected alternatives were shipping the
  features disabled, and bring-your-own-key.
- `[todo]` The proxy has no client authentication, and its URL is packaged in the APK
  by `react-native-config`, so it is extractable exactly as the Groq key was. A shared
  app token would be equally extractable; do not mistake one for authentication. The
  per-IP and global rate-limit bindings are per-colo burst gates, not a budget, so the
  binding cost ceiling must be a spending limit set in the Groq console. Record that
  limit here once set.
- `[todo]` Until a restoration model is selected, make UI availability derive from a
  production feature flag/capability, not from whether an embedded string is nonempty.
- `[todo]` A Stallion OTA may disable the 1.8.1 recap/STT UI promptly, but record that
  it cannot remove the key from already-downloaded APK bytes. Do not postpone key
  revocation while waiting for OTA adoption.
- `[todo]` Ensure disabled recap/STT paths show a clear, non-error explanation and do
  not offer a button that can only fail.
- `[todo]` Remove secrets and response bodies from logs. Never log audio, dialogue,
  authorization headers, or raw provider errors that may contain request content.
- `[todo]` Add privacy copy before uploading subtitle dialogue or audio. State what is
  sent, to whom, why, and whether the provider retains it.

Files: `.github/workflows/android-ci.yml`, `.env.example`, `src/utils/constants.ts`,
`src/services/RecapService.ts`, `src/services/SpeechToTextService.ts`, recap/STT UI,
README/privacy documentation.

Exit check: decompile/search a signed production APK and confirm no project-owned Groq
credential exists. Exercise both disabled and restored product paths.

### 3.3 Audit other packaged credentials

- `[todo]` Treat `SUBDL_API_KEY`, `OMDB_API_KEY`, Stallion project ID, and Stallion app
  token as packaged client values until provider documentation proves otherwise.
- `[todo]` For each value, record whether the provider intends it to be public,
  available key restrictions, quotas, rotation procedure, and abuse owner.
- `[todo]` If a value is not safe in a client, use the same proxy/disable/BYOK decision
  as Groq. Do not rely on GitHub Actions secrets to protect an APK-embedded value.
- `[todo]` Remove the word “secret” from CI/config documentation for intentionally
  public client identifiers so future maintainers do not mistake storage location for security.

### 3.4 Correct 1.8.1 with a new release identity

- `[todo]` The corrective native release must be `1.8.2` or later with a new monotonically
  higher Android `versionCode`; never replace the 1.8.1 assets in place.
- `[todo]` At minimum, it must contain the section 3 credential removal/feature decision,
  section 4 release guards/version identity, and every R1 item whose unsafe behavior is
  already present in 1.8.1.
- `[todo]` After publication, install it over both public 1.8.1 ABI APKs, verify the
  updater sees it as newer, and search the signed binaries/bundle for the revoked key.
- `[todo]` Leave the 1.8.1 release record intact unless the owner explicitly chooses to
  hide it. Hiding reduces new downloads but is not credential revocation or user remediation.

## 4. R1 — rebuild CI, releases, and version identity

### 4.1 Separate verification from publishing

Keep one workflow unless splitting materially improves maintenance.

Reconciled 2026-08-27. Most of this section was implemented in the 1.9.x workflow rebuild
but never marked; the entries below are verified against the workflow file, not memory.

- `[done]` Run typecheck, lint, tests, and debug **and release** compilation on pull
  requests and pushes to `main`/`develop`, with `contents: read` only. The release build
  was added 2026-08-27 and is the reason this item was still open: before it, the release
  variant was first compiled by the tag-gated job, where a failure burns a version
  number. That is exactly how 1.9.1 was spent. It is debug-signed via the project's
  `-PallowDebugSigning=true` opt-in so it needs no keystore secret (fork pull requests
  cannot read one), builds `arm64-v8a` only because AAR-metadata and R8 failures are not
  ABI-specific, and has no upload step so it cannot publish.
- `[done]` Trigger publication only from a strict final tag. The `release` job is gated on
  `startsWith(github.ref, 'refs/tags/v')` and the tag must match `^v[0-9]+\.[0-9]+\.[0-9]+$`.
  An ordinary branch push runs `verify` only.
- `[done]` Refuse to publish a tag whose commit is not an ancestor of `origin/main`.
  Tag-gating alone still allows a `develop` commit to be tagged and released.
- `[done]` Add a release concurrency group so only one production release can run.
  `group: production-release`, `cancel-in-progress: false`.
- `[done]` Set `contents: write` on the release job only, not globally. The workflow
  default is `contents: read`.
- `[done]` Validate that the tag version exactly equals `package.json` version.
- `[done]` Reject prerelease/build suffixes. The tag regex is anchored, so `-build.N`
  and prerelease suffixes fail validation.
- `[done]` Fail if the tag or GitHub Release already exists, via `gh release view`.
- `[done]` Remove the unused "Get commit message" step.
- `[done]` Replace `actions/create-release@v1` and `actions/upload-release-asset@v1` with
  `gh release create`, called once with both APKs and both checksums after all
  validations pass.
- `[done]` Generate the changelog from the previous **published release**, not the newest
  tag. Corrects this entry's original wording, which said "previous final release tag":
  a tag is the wrong source, not merely the wrong tag. A tag whose release build failed
  leaves an orphan behind, and ranging from it drops every commit between the last real
  release and that tag. Verified against history: the shipped 1.9.2 notes ranged from the
  orphan `v1.9.1` and listed one fix; ranging from the published `v1.9.0` lists three,
  including both crash fixes. Now reads `/releases/latest`, the same endpoint the in-app
  updater uses, so the notes describe exactly the jump users are taking.
- `[todo]` The published 1.9.2 release notes still carry the truncated list. The workflow
  fix only affects future releases; those notes need editing by hand or not at all.
- `[done]` Keep commit-subject filtering aligned with `AGENTS.md`: only `feat`, `fix`,
  and `perf` become release notes.
- `[done]` Remove `npm ci --legacy-peer-deps`. Both jobs use a plain `npm ci`.
- `[done]` Upgrade the CI Node version with the React Native migration. Node 22 in both
  jobs, matching the `>=22.11.0` engine.
- `[done]` Do not publish a release before both ABI assets and checksum files exist. The
  release step `test -f`s both APKs before calling `gh release create`.
- `[todo]` Provenance metadata is still not produced. Build attestation or an SBOM is the
  remaining half of the item above; section 15.2 tracks the dependency/license inventory.

### 4.2 Make version identity monotonic and single-source

Current severity: `android/app/build.gradle` hardcodes app `versionCode 1`, and the
public 1.8.1 Build 54 APKs shipped with that value. The local VLC Android library also
contains an irrelevant `versionCode 1`, handled separately in section 10.3. This is not
general tidiness: the next APK needs a greater app version code for a reliable upgrade
contract, while the current updater also discards `-build.N` from tag comparisons.

- `[todo]` Keep `package.json` as the human-facing `versionName` source.
- `[done]` Derive Android `versionCode` from validated `package.json` SemVer as
  `major * 1,000,000 + minor * 1,000 + patch`; minor and patch must each be below
  1,000 and the result must fit Android's `2,100,000,000` limit. The device upgrade
  proof in this section's exit check is still outstanding.
- `[todo]` Enforce: every public APK has a greater `versionCode` and a unique
  `versionName`. Same-version public rebuilds are forbidden.
- `[todo]` Set iOS `MARKETING_VERSION` from the same source and increment
  `CURRENT_PROJECT_VERSION` for every submitted build.
- `[todo]` Ensure Stallion release targeting uses the native app version and never
  crosses incompatible native binaries.
- `[todo]` Rename final tags from `vX.Y.Z-build.N` to `vX.Y.Z` after the updater and
  workflow switch. Keep old tags as history unless there is a specific reason to remove them.
- `[todo]` Add CI assertions for version/tag match, positive `versionCode`, monotonicity
  relative to the latest final release, and expected APK manifest values.

Files: `package.json`, `android/app/build.gradle`, iOS project build settings,
`.github/workflows/android-ci.yml`, updater version utilities.

Exit check: install the new APK over the latest public APK without `adb` downgrade or
debug flags; the system reports the expected version name/code.

## 5. R1 — correct Android notification and media permissions

### 5.1 Remove the unnecessary media-notification permission path

The player creates a `MediaStyle` notification with a media-session token. Android
exempts media-session notifications from `POST_NOTIFICATIONS`. The current permission
gate suppresses a notification that Android allows.

- `[done]` Baseline project-source search found exactly one notification builder/
  `notify()` producer: `ReactVlcPlayerView.showNotification()`. It sets
  `androidx.media.app.NotificationCompat.MediaStyle` with the active media-session token;
  no project-owned non-media notification exists at this baseline.

- `[done]` Delete the `POST_NOTIFICATIONS` declaration from
  `android/app/src/main/AndroidManifest.xml`.
- `[done]` Delete `PermissionService.hasNotificationPermission()` and its comments.
- `[done]` Delete the call from `usePlayerSettings.toggleBackgroundPlay()`, and the
  now-unused `PermissionService` import with it.
- `[done]` Delete the native `checkSelfPermission(POST_NOTIFICATIONS)` gate and the
  `Manifest`, `PackageManager`, and `ContextCompat` imports it was the only user of.
- `[done]` Confirm no merged dependency manifest reintroduces the permission. The
  release merged manifest was regenerated and contains no `POST_NOTIFICATIONS`.
- `[todo]` Add an Android 13+ manual test with notifications denied at the OS level:
  media controls must still appear while the media session is active.
- `[todo]` Do not re-add this permission for the future playback service unless Glide
  introduces a separate non-exempt notification feature.

### 5.2 Request only the media collection Glide reads

Current CameraRoll reads use `assetType: 'Videos'`; deletion passes video content URIs.

- `[done]` Remove `READ_MEDIA_IMAGES`, `READ_MEDIA_AUDIO`, and
  `ACCESS_MEDIA_LOCATION` from the manifest.
- `[done]` On API 33+, request only `READ_MEDIA_VIDEO` and base success only on it.
  Public 1.8.1 required `READ_MEDIA_IMAGES` *and* `READ_MEDIA_VIDEO` to both be granted,
  so denying photo access to a video-only app made the library fail to load.
- `[done]` On Android 14+, rely on compatibility mode rather than declaring
  `READ_MEDIA_VISUAL_USER_SELECTED`; Glide does not own re-selection UI. The limitation
  is written next to the request in `PermissionService`. Still needs the device check below.
- `[keep]` Keep `READ_EXTERNAL_STORAGE` with `maxSdkVersion=32` for older devices.

New finding, present in public 1.8.1: the release merged manifest ships two permissions
Glide never declared. `READ_PHONE_STATE`, a dangerous runtime permission, is injected by
`react-native-share` and `react-native-stallion`; `WRITE_EXTERNAL_STORAGE` is injected
unbounded by `@dr.pogodin/react-native-fs`. Both appear on the user-visible permission
list of a video player that reads neither.

- `[done]` Strip `READ_PHONE_STATE` with `tools:node="remove"`.
- `[done]` Re-declare `WRITE_EXTERNAL_STORAGE` with `android:maxSdkVersion="28"` and
  `tools:node="replace"`. It is inert from API 29 under scoped storage, but
  `CameraRoll.deletePhotos` still needs the storage group on API 26-28.
- `[todo]` Device-test that stripping `READ_PHONE_STATE` does not break the
  `react-native-share` sheet or the Stallion OTA check. If either library reads phone
  state at runtime it will now raise `SecurityException`.
- `[todo]` Re-run the merged-manifest permission diff after every dependency upgrade;
  direct-manifest review does not catch an injected permission.
- `[todo]` Verify library, albums, search index, thumbnails, playback, and video deletion
  on Android 13, 14, 15, and 16.
- `[todo]` Verify denial behavior: explain why video access is needed, allow retry from
  Settings, and never show an empty library as though the device has no videos.
- `[todo]` If Google Play distribution is added, review the current broad video-access
  policy and determine whether Glide qualifies or must use a picker.

### 5.3 Review special permissions

- `[decision]` `WRITE_SETTINGS`: decide whether “global brightness” is worth a special
  system permission. The smaller product is per-window brightness; if selected, remove
  global mode, permission, settings UI, and native write-settings path.
- `[keep]` `REQUEST_INSTALL_PACKAGES` only while GitHub APK self-update remains a
  supported distribution path. Reassess before Google Play distribution because the
  permission is policy-sensitive.
- `[keep]` `VIBRATE` for haptics and `INTERNET` for metadata, subtitles, updates, and streams.

## 6. R1 — network and exported-input security

### 6.1 Remove accidental cleartext for app APIs without breaking intentional streams

Glide intentionally accepts `http://`, `https://`, and `rtsp://` playback sources.

Implemented 2026-08-27. The `[decision]` below is resolved by making it unnecessary
rather than by choosing a side: a Network Security Config permits cleartext in its
`base-config`, so arbitrary user streams are untouched, and forbids it per-domain for
every app-owned API. No product capability is given up, so no insecurity warning is owed.

- `[done]` `[decision]` **Retain HTTP stream support; pin app-owned APIs to HTTPS.** The
  second listed option, minus the in-product warning, which was only owed if a
  user-facing feature had to be degraded. It did not.
- `[done]` Replace blanket `usesCleartextTraffic="true"` with
  `android:networkSecurityConfig="@xml/network_security_config"`. Domains pinned to
  HTTPS: `github.com`, `githubusercontent.com`, `subdl.com`, `omdbapi.com`,
  `stalliontech.io`, `workers.dev`, each with `includeSubdomains`. Verified in the
  regenerated release merged manifest.
- `[done]` Keep the debug override. `app/src/debug/res/xml/network_security_config.xml`
  shadows the production file by resource merging, so no manifest override and no
  `tools:replace` is needed. The now-ignored `usesCleartextTraffic` was deleted from the
  debug manifest rather than left behind as a no-op attribute.
- `[keep]` Stallion's bundle CDN (`cloudfront.net`) is deliberately **not** pinned.
  Pinning all of CloudFront would also block a user stream hosted there, which is exactly
  the case `base-config` exists to permit. The control plane on `stalliontech.io` is pinned.
- `[done]` Reject non-HTTPS custom update endpoints. `buildLatestReleaseUrl()` returned
  `GITHUB_RELEASES_URL` verbatim; a cleartext override would have let the network choose
  which release the updater offers. It now fails closed to `noUpdate`.
- `[keep]` APK asset URLs were already covered by `isTrustedAssetUrl`, which requires
  HTTPS plus a GitHub release-asset host. Nothing to add.
- `[keep]` The proxy URL needs no config entry: `constants.ts` already refuses any
  `AI_PROXY_URL` not starting with `https://`, and static XML cannot know a custom proxy
  domain chosen at build time. `workers.dev` covers the default Workers domain.
- `[todo]` Device-test an arbitrary HTTP LibVLC stream. Expected unaffected — LibVLC uses
  its own native network stack, so the config should never reach it — but "expected to be
  unaffected" is the claim that needs the device, not the one that gets to skip it.
- `[todo]` Device-test that the update check, subtitle search/download, OMDb lookup, and
  the Stallion OTA check all still succeed over the pinned domains.
- `[todo]` Enforce expected *hosts*, not only HTTPS, in OMDb and SubDL code. The config
  now covers the transport; the code still trusts whatever host `.env` supplies.
- `[todo]` Never allow "accept invalid certificate" for app APIs. If LibVLC exposes it
  for user streams, keep it off by default and make the risk explicit. The
  `acceptInvalidCertificates` native prop exists and is unused by this app (section 10.5).

### 6.2 Validate external intents and deep links

Implemented 2026-08-27. `VideoPlayerActivity` is `exported="true"`, so any installed app
can start it with an **explicit** intent and bypass all eight manifest intent filters.
Before this change `intent.data.toString()` reached JavaScript and LibVLC unvalidated, and
LibVLC natively resolves `smb`, `ftp`, `nfs`, `sftp`, `dvd`, `screen` and more.

- `[done]` Accept only `content`, `file`, `http`, `https`, `rtsp`. One
  `resolveExternalVideoUri()` covers both ACTION_VIEW and ACTION_SEND, so the two entry
  points cannot drift apart.
- `[done]` Reject empty and oversized URIs before LibVLC initialises: blank
  `schemeSpecificPart`, and a length cap of 8,192.
- `[done]` Validate in `onCreate` rather than in `getLaunchOptions`, so a rejected intent
  can `finish()`. Necessary, not stylistic: `VideoPlayerRoot` renders an indefinite
  spinner when `videoUri` is absent, so merely dropping the prop would have left a black
  screen with no error and no way out.
- `[done]` Keep external-open exit scoped to `finish()`. Exiting the process would also
  take `MainActivity`, which may be showing the user their own library.
- `[done]` Take a persistable `content://` grant only when the sender offered
  `FLAG_GRANT_PERSISTABLE_URI_PERMISSION`. Taking one that was not offered throws, and
  most file managers offer a call-scoped grant instead.
- `[keep]` **No MIME assertion on ACTION_VIEW.** The manifest already requires `video/*`
  for every implicit VIEW except extension-matched http(s) links, and an explicit intent
  can declare `video/mp4` for anything — so the check buys nothing against an attacker
  while rejecting file managers that send `application/octet-stream` for a real video.
  ACTION_SEND keeps its MIME check, where the sender chooses the type and the stream
  extra carries no scheme guarantee of its own.
- `[todo]` A `content://` URI arriving with no read grant is still accepted, and fails
  downstream as a decode error rather than a clear message. Rejecting on a missing
  `FLAG_GRANT_READ_URI_PERMISSION` would also reject world-readable exported providers
  that legitimately need no grant, so this needs the device matrix first. Marked with a
  `ponytail:` comment at the return site.
- `[todo]` `onNewIntent` is unvalidated but currently inert: `launchMode="singleTask"`
  means a second intent never re-runs `getLaunchOptions`, so no new URI reaches
  JavaScript. That is a UX gap — opening a second video while the player is open does
  nothing — not a hole. Validate it whenever that UX is fixed.
- `[keep]` `RootNavigator`'s `Linking` handler calls `DeepLinkService.isVideoUri` only to
  decide whether to log, and `MainActivity` declares no VIEW filter, so no external URL
  reaches it. It is not an input boundary; do not harden it as though it were one.
- `[todo]` Add tests for ACTION_VIEW, ACTION_SEND, malformed URLs, missing grants, and
  unsupported schemes. **Not done, and deliberately not faked:** the logic uses
  `android.net.Uri`, so a JVM unit test needs Robolectric or a hand-rolled URI parser, and
  hand-rolling URI parsing to test URI validation reintroduces the bug class the check
  exists to prevent. Section 15.2 already tracks the instrumentation test that covers this.
- `[done]` Verified: `compileDebugKotlin` passes, release merged manifest regenerated and
  inspected, `tsc --noEmit` clean, 25/25 Jest, ESLint unchanged at 0 errors/262 warnings.

## 7. R1/P1 — harden GitHub APK updates

### 7.1 Release discovery and version parsing

- `[todo]` Replace permissive `normalizeVersion`/`compareVersions` behavior with strict
  accepted input. Invalid components must fail, not disappear through `parseInt` filtering.
Verified defect, present in public 1.8.1: `getPreferredAbi()` read
`NativeModules.PlatformConstants.supportedAbis`, which React Native does not define on
any platform — the Android `PlatformConstants` spec exposes only `Version`, `Release`,
`Serial`, `Fingerprint`, `Model`, `Brand`, `Manufacturer`, `ServerHost`, `uiMode`,
`isTesting`, and `reactNativeVersion`. Both ABI branches were therefore unreachable and
every device fell through to the ARM64 fallback, so armeabi-v7a users were handed an
incompatible APK and the installer failed silently because `ApkInstallerModule.install()`
resolves as soon as `startActivity` returns. This is the reason the corrective release
must ship the fix below: without it, 32-bit users cannot install the build that revokes
the exposed credential.

- `[done]` Export `selectApkForDevice` as a pure tested function; ABIs are injectable so
  the selector is testable without a device.
- `[done]` Read the real ABI list. `ApkInstallerModule` now exports
  `Build.SUPPORTED_ABIS`; there is no React Native API for this.
- `[done]` Match ABI asset names exactly against the release workflow's `-arm.apk` and
  `-arm64.apk` suffixes. The old `includes('arm')` search also matched `arm64`.
- `[done]` For unknown ABI, return no direct APK and offer the release page; never
  silently choose ARM64. `UpdateActionButton` already degrades to “Open Release”.
- `[done]` Validate the asset URL and asset name. `isTrustedAssetUrl` requires HTTPS and a
  GitHub release-asset host, and the checksum asset must be the APK's name plus `.sha256`.
- `[todo]` Validate the remaining GitHub response shape: final tag and release URL.
- `[keep]` Ignore draft/prerelease releases. `/releases/latest` already returns "the most
  recent non-prerelease, non-draft release," so the client check only guards a custom
  `GITHUB_RELEASES_URL`. A prerelease channel would be new product scope, not a fix.
- `[done]` Cap release-note length before rendering Markdown, at 8,000 characters.
- `[todo]` Update `markdown-it`/`react-native-markdown-display` through a compatible
  package update. Split from the cap above; it belongs with the dependency work.
- `[todo]` Send the update check through the Cloudflare Worker with a short cache.
  Unauthenticated GitHub REST is 60 requests/hour keyed to the originating IP, so users
  behind carrier NAT share one budget and silently stop being offered updates.

Tests: strict versions, leading `v`, malformed input, missing patch component if allowed,
greater/less/equal, every supported ABI, asset reordering, no asset, and malicious URLs.

### 7.2 Download and cache integrity

- `[done]` Restrict downloads to HTTPS and trusted GitHub release-asset hosts. The host
  check only constrains the starting URL; redirects are not re-checked, which is
  acceptable because the SHA-256 comparison is the real integrity control.
- `[done]` Publish SHA-256 files beside both APKs and verify before invoking the installer.
  A release with no checksum asset is now browser-only: `canDownload` is false rather than
  installing bytes that cannot be checked.
- `[done]` Download to a `.part` file, then rename only after status, size, and hash pass.
- `[done]` Add cancellation on component unmount/new download and delete partial files.
  `RNFS.downloadFile` returns the `jobId`; `stopDownload` cancels it.
- `[done]` Add a stall timeout and a maximum APK size: `connectionTimeout` 15 s,
  `readTimeout` 60 s, and a 300 MB cap enforced from `contentLength` during progress and
  from `bytesWritten` afterwards.
- `[done]` Use a constant cache name plus metadata. `glide-update.apk` and its `.part`
  are fixed strings, so no release-supplied text ever reaches a file path and the
  sanitation problem stops existing rather than being solved.
- `[done]` Ensure paths resolve inside `CachesDirectoryPath`. The native module compares
  the canonical APK path against the canonical cache directory before opening a session.
- `[done]` Clean obsolete cached APKs. `useUpdateInstaller` runs from the always-mounted
  `UpdateModal`, so the stale-cache sweep happens at app start.
- `[done]` Store cache metadata only after verification, and make MMKV access synchronous.
  `updateStorage` no longer returns Promises for work that had already completed.
- `[done]` Distinguish network, storage, integrity, installer, unknown-source,
  cancellation, and unsupported-device errors in the UI, as a typed `UpdateError`.
- `[done]` Do not turn every error into “open browser.” Only an error whose
  `canOpenRelease` is true switches the button to that fallback; cancellation and a
  missing unknown-sources grant keep the retry action.

### 7.2b Update UI state, reported from device use

Verified defect, present in public 1.8.1: the update UI exists in two places — the
app-level `UpdateModal` mounted for the whole session in `App.tsx`, and the Settings
update card — and each called `useUpdateInstaller`, so each owned its own `useState`.
Two independent state machines drove one shared download and one shared cache file, so
progress, download status, and cached-APK state disagreed between the two surfaces.
Settings also never rendered the changelog at all.

- `[done]` Move download progress, status, error, and cached-APK state into the existing
  zustand store as an `updateInstall` slice. Both surfaces now read one source of truth.
  No new dependency and no context provider: zustand already holds `updateStatus`.
- `[done]` Move the whole checksum/download/install operation, download job id, and
  cancellation flag to module scope. The operation promise is the atomic owner, so stale
  component state cannot let two consumers write the same destination file.
- `[done]` Run the stale-cache sweep once per distinct `latestVersion` rather than once
  per mounted component. A once-per-session flag would have skipped the re-check after
  the update request resolves, leaving a cached APK for a superseded version installable.
- `[done]` Share one `UpdateNotes` renderer between the modal and Settings, so the
  Settings card shows the same changelog with the same Markdown styling.
- `[done]` Give the user a way to cancel a running download, on both surfaces, and report
  a cancellation as cancelled rather than as a network failure.
- `[done]` Explain why an in-app download is unavailable instead of silently degrading to
  a browser button.
- `[done]` Clear a stale error when the modal reopens.
- `[todo]` Device-test both surfaces at once: start a download in Settings, open the
  modal, and confirm one progress figure, one cancel, and one resulting install.

### 7.3 Installer behavior

Replaced `ACTION_VIEW` on a FileProvider URI with a `PackageInstaller` session.
`ACTION_INSTALL_PACKAGE` has been deprecated since API 29, and the intent path cannot
report an install result at all: it resolved success as soon as the installer Activity
started, which is why the ABI defect in section 7.1 was invisible in production.

- `[done]` Before launch, call `PackageManager.canRequestPackageInstalls()`. minSdk is 26,
  so no version guard is needed.
- `[done]` If false, explain the permission and open `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES`.
  Retry is the user pressing the button again rather than an Activity-result listener;
  revisit only if device testing shows the extra tap is a real problem.
- `[done]` Verify the install can proceed before committing. No longer intent resolution:
  a session either opens or fails with a status.
- `[done]` Validate that the requested file is an existing regular `.apk` inside Glide's
  cache directory, by canonical path, before opening the session.
- `[done]` Map every `PackageInstaller` terminal status to a distinct error code:
  aborted, blocked, conflict, incompatible, invalid, and storage.
- `[done]` Set `setRequestUpdateOwnership(true)` on API 34+ so no other installer can
  replace Glide without explicit user approval, and `INSTALL_REASON_USER`.
- `[done]` Remove the now-unused `${applicationId}.fileprovider` provider and
  `res/xml/file_paths.xml`. A search proved `ApkInstallerModule` was the only consumer;
  `react-native-share` declares its own `com.glide.app.rnshare.fileprovider`, which the
  regenerated release manifest confirms is still present.
- `[todo]` Test denied/allowed unknown sources, corrupt APK, wrong signer, lower/equal/
  higher versionCode, cancelling the system prompt, and a successful upgrade preserving data.
- `[todo]` Consider `requestUserPreapproval()` on API 34+ so the install is approved
  before a ~60 MB download rather than after it.

## 8. P1 — complete timer-free player geometry and lifecycle

### 8.1 Replace hand-written resize geometry

**Correction, verified against the LibVLC 3.6.5 bytecode on 2026-08-27.** The plan below
originally routed resize modes through `MediaPlayer.setVideoScale(ScaleType)`. That method
cannot work here:

```java
public void setVideoScale(ScaleType st) {
    if (mVideoHelper != null) { mVideoHelper.setVideoScale(st); }
    return;   // silent no-op otherwise
}
```

`mVideoHelper` is constructed *only* inside `attachViews(VLCVideoLayout, DisplayManager,
boolean, boolean)`. Glide attaches through the raw
`IVLCVout.attachViews(OnNewVideoLayoutListener)` path, so `setVideoScale` and
`updateVideoSurfaces` are both no-ops in this codebase. The former fallback — "keep the
TextureView but collapse geometry into one `setVideoScale` path" — was self-contradictory.

Adopting `VLCVideoLayout` to obtain `ScaleType` was rejected against two verified facts:
`VlcPipController` overrides bounds on this view's subtree, and Fabric manages the view as
the TextureView. A third blocker, `doSnapshot()` needing `TextureView.getBitmap()`, was
removed when the screenshot feature was deleted as unused — so the case is weaker than it
was, but the PiP bounds override remains the hard one. LibVLC 4 changes this API surface,
and section 11.1 already forbids shipping its EAP, so revisit only when LibVLC 4 is stable.

The goal is unchanged — one geometry route, correct SAR, no forced retries — but it is met
with app-owned math against the TextureView rather than with LibVLC's scaler.

- `[keep]` Stay on `TextureView` with `IVLCVout.attachViews(listener)`. Do not spike
  `VLCVideoLayout` while snapshots, PiP bounds override, and Fabric depend on the
  TextureView identity.
- `[done]` Collapse the resize entry points onto one route. `invalidateAndRefitGeometry()`
  is now the only way to request a refit, used by configuration change, PiP mode change,
  surface-buffer resize and view resize. Eight sites became five, and the four that remain
  are player-state resets rather than entry points: two clear geometry as part of a larger
  create/release reset, one is the route itself, and one is the deliberate PiP path that
  must re-apply on every window resize.
- `[done]` Delete the six mutating mode helpers. Each re-read `getWidth()`/`getHeight()`
  and recomputed SAR for itself; they are replaced by one pure `computeGeometry()` that
  returns an aspect ratio and a scale, so the view is measured once per application and
  the modes cannot drift apart. `onSurfaceTextureSizeChanged` also published an ad-hoc
  `setWindowSize` with buffer dimensions that `applyResizeMode` immediately overwrote with
  view dimensions; that call is gone.
- `[keep]` The applied-state cache fields. They prevent redundant native calls on every
  layout pass, and the cache is keyed on every input the geometry depends on.
- `[done]` Correct video size/SAR handling. Verified defect: the Playing-event fallback
  set `mVideoWidth`/`mVideoHeight` from the video track and passed the track SAR to the PiP
  controller, but never assigned `mSarNum`/`mSarDen`. On the many files where
  `onNewVideoLayout` never fires, anamorphic sources were therefore treated as square-pixel
  and rendered at the wrong shape in cover, best-fit, none and scale-down. The fallback now
  takes the SAR too. The area-like values were the unreduced `width*sarNum : height*sarDen`
  strings; `displayAspectRatio()` reduces them by GCD, which is the same ratio and readable.
- `[done]` Preserve user pinch zoom/pan only in `contain`, and disable transforms in PiP.
  Already satisfied by `allowVideoTransform` in `usePlayerGestures`: it disables the pinch
  gesture, resets zoom on mode change, and collapses the transform to identity.
- `[done]` Stop forcing an explicit aspect ratio in `none` and `scale-down`. Found by
  device test 2026-08-27: both rendered an extreme horizontal stretch while every other
  mode was correct. They were the only two modes passing a non-null aspect string, and in
  the failing case both also had scale fixed at 1, so the string was the only variable.
  VLC already applies the stream's display aspect ratio including SAR, so forcing one was
  redundant as well as wrong; `fill` is now the only mode that sets an aspect, which is
  correct because it is defined as stretching to the view. The `displayAspectRatio` and
  `greatestCommonDivisor` helpers went with it.
- Note on cause: the aspect forcing is older than this refactor, but it sat behind an
  `if (mSarNum > 0 && mSarDen > 0)` guard. On files where `onNewVideoLayout` never fires,
  SAR stayed 0:0 and the guard fell through to `setAspectRatio(null)` — accidentally
  correct. Populating SAR from the video track put those files on the broken branch for the
  first time, so the SAR fix did not create this bug but did expose it.
- `[todo]` Re-test all six modes after this fix, then the rest of the section 8.5 fixture
  set. The math is verifiable by reading, the rendering is not.

### 8.2 Replace lifecycle timing guesses with Activity lifecycle

The platform documentation is explicit about this: "In Android 7.0 and later, you should
pause and resume video playback when the system calls your activity's `onStop()` and
`onStart()`. By doing this, you can avoid having to check if your app is in PiP mode in
`onPause()`." The 800 ms grace period existed only because the view listened on the wrong
callback — `onPause` fires for both backgrounding and entering PiP, `onStop` for neither
but the first.

- `[done]` Observe Activity lifecycle `ON_START`/`ON_STOP` in the native player view.
  Both host Activities extend `ReactActivity`, so both are `LifecycleOwner`s, and
  `androidx.lifecycle` was already on the compile classpath — no new dependency.
- `[done]` Delete `PIP_HOST_PAUSE_GRACE_MS`, `mAwaitingPipAutoEnter`, the pending PiP
  background-pause runnable, its `Handler`, and all cancellation plumbing. The handler
  existed only for this timer, so this also satisfies part of section 8.4.
- `[done]` Pause normal foreground-only playback on `ON_STOP`. `onHostPause` and
  `onHostResume` are now explicitly empty with a comment saying why.
- `[done]` Rename the state to match the signal: `isHostPaused` → `isHostStopped`,
  `mPausedForHostPause` → `mPausedForHostStop`, `wasPlayingBeforeHostPause` →
  `wasPlayingBeforeHostStop`, `shouldKeepPlayingWhileHostPaused` →
  `shouldKeepPlayingWhileHostStopped`. The old names encoded the wrong model.
- `[done]` Keep user pause, host stop, audio-focus loss, noisy-device pause, ended state,
  and background-play intent as separate state. No flags were merged.
- `[done]` Verify teardown removes lifecycle listeners and all pending callbacks.
  `cleanUpResources` and `onDetachedFromWindow` both detach the observer, and the detach
  is idempotent.
- `[todo]` Device-test: background and return during playback, enter PiP and return,
  dismiss the PiP window, lock the screen, and the same set with background play enabled,
  on Android 8, 12 and 16. This replaces a timing heuristic, so behavior differences show
  up only on real transitions.

### 8.3 Replace fixed player retries with real events

- `[todo]` Audio track: keep requested track in a field and apply on real VLC Playing/
  elementary-stream-added events. Delete the fixed 150 ms retry.
- `[todo]` Audio delay: delete the second fixed 150 ms application; apply on the same
  real ready/track event if VLC requires reapplication.
- `[todo]` Saved-position restore: replace the unconditional 200 ms delay with a
  seekable/length/Playing event. Keep a bounded failure path only if fixtures prove an event is missing.
- `[todo]` Enhancement recreation: restore the snapshot on real player readiness. The
  500 ms callback may remain only as a measured, logged safety timeout after the event path exists.
- `[todo]` Seek buffer timeout: keep as a safety mechanism for now, but measure 200 ms
  against local/network/slow-decoder fixtures. It must be cancellable and versioned;
  do not remove a deadlock escape without equivalent evidence.
- `[keep]` UI auto-hide, debounce, sleep, and animation timers where the timer itself
  represents the intended UX. Ensure each has cleanup; do not label every timer a bug.

### 8.4 Collapse native scheduling ownership

- `[todo]` Replace per-feature main-loop Handlers with one main-thread Handler where
  cancellation semantics permit it; retain the seek executor.
- `[todo]` Stop constructing anonymous `new Handler(...)` instances for delayed work.
- `[todo]` Give every retained delayed callback an owner, cancellation point, and release cleanup.
- `[todo]` In `AudioControlModule`, cancel/replace route-debounce and volume-flag
  callbacks rather than stacking them during rapid changes.

### 8.5 Player fixture/device acceptance

- `[todo]` Build a small legal fixture set: 16:9, 2.39:1, portrait, rotated metadata,
  SAR != 1, MKV with three audio tracks, embedded/external subtitles, AC3, EAC3,
  HEVC, short file, long file, HTTP stream, HTTPS stream, and RTSP stream.
- `[todo]` Exercise every resize mode, rotate, seek rapidly, switch audio tracks ten
  times, change delay, enable/disable enhancement, enter/resize/exit PiP, lock screen,
  receive a call, disconnect Bluetooth, and background/foreground.
- `[todo]` Run both `MainActivity` and external-open `VideoPlayerActivity` paths.

### 8.6 Audio controls already simplified, still requiring runtime proof

- `[done]` Audio delay defaults are neutral: `usePlayerSettings` and the native prop
  both default to zero. Preserve per-video restored delay only when history contains one.
- `[done]` Playback-rate application no longer waits an arbitrary 80 ms; rapid updates
  coalesce onto the native main loop.
- `[done]` Equalizer preset, band values, and enabled state now change in one React state
  update; the prior JS timeout-toggle workaround is gone.
- `[todo]` Device-test delay persistence/reset on multiple videos and confirm no old
  non-zero history value is presented as a new default.
- `[todo]` Device-test repeated rate changes across pause/play, PiP, audio-only media,
  enhancement recreation, and save/restore; verify no duplicate native application.
- `[todo]` Device-test every equalizer preset, flat/off, custom bands, rapid switching,
  player recreation, and source change. Confirm the native cached equalizer is released
  and no preset from the previous source leaks into the next one.

### 8.7 P2 — remove the measured progress-driven whole-screen render

On-device measurement and source tracing agree: idle playback renders
`VideoPlayerScreen` about twice per second because `handleProgress` copies current time
into React state every `DISPLAY_TIME_UPDATE_INTERVAL = 500` ms. Smooth playback time is
already maintained by `currentTimeShared`, while `currentTimeRef` holds an immediate JS
snapshot. The recurring React state update currently reaches these paths:

- `PlayerControls.currentTimeSeconds`, used only to build `ReanimatedText` fallback strings;
- `BookmarkPanel.currentTime`, used to highlight bookmarks near the playhead;
- `FloatingSyncPanel.currentTime`, which is passed from `currentTimeRef.current` but only
  receives a new prop because its parent happens to render on the state tick;
- `AnimatedVideoView.currentTime`, ignored by its memo comparison during progress but
  sampled when `playerKey` changes to resume decoder/enhancement recreation.

- `[done]` Remove recurring `currentTime` updates from the whole `PlayerCoreState`. The
  field is gone from `PlayerState` entirely, with a comment on the type recording why, so
  it cannot be reintroduced by habit. Continuous progress stays in `currentTimeShared`
  and `currentTimeRef`; no timer, store, event bus, or state framework was added.
  `DISPLAY_TIME_UPDATE_INTERVAL` and its throttle ref are deleted with it.
- `[done]` `handleProgress` and `handleSeek` now touch React state only through one
  `syncDuration` helper, which ignores anything within a second of the known duration.
  Both keep `durationShared` in step, which `handleSeek` previously did not.
- `[done]` Delete the dead `displayTime`, `formattedTime`, and `formattedDuration`
  derived values. Nothing consumed them, and all three recomputed on every tick.
- `[done]` Make `PlayerControls` fallbacks initialization/remount fallbacks only. They now
  read `currentTimeRef.current`, which is evaluated only on a real render. The visible
  time, remaining time, and scrub position already came from Reanimated derived values,
  so no display path depended on the React cadence.
- `[done]` Update bookmark highlighting from the shared value, on the UI thread, and only
  while the panel is visible. Crossing into or out of a bookmark's window is the only
  thing that renders, and it renders the panel rather than the screen.
- `[done]` Give `FloatingSyncPanel` the time ref. Manual search captures the live position
  when the query changes; auto-listen captures it once before extraction and preserves
  that same reference through matching and offset application, so transcription/user
  latency cannot become subtitle delay.
- `[done]` Preserve `AnimatedVideoView` resume behavior. It now takes the ref and samples
  `currentTimeRef.current` inside the `playerKey`-keyed memo, so resume no longer depends
  on the parent having re-rendered recently.
- `[done]` Fix the `BookmarkPanel` memo comparator, which compared `bookmarks.length` and
  so ignored an edited timestamp. It compares the array reference now.
- `[done]` Cover the highlight decision with tests: outside the window, both edges, the
  excluded boundary, overlapping bookmarks resolving to the nearest, and an empty list.
- `[todo]` Confirm with the React DevTools Profiler that idle playback renders
  `VideoPlayerScreen` zero times with controls both visible and hidden, and that opening
  bookmarks or the sync panel updates only that panel. No always-on render counter was
  added: the Profiler already measures this, and shipping diagnostic scaffolding to do it
  again is the kind of code this tracker exists to remove.
- `[todo]` Device-test time labels, rapid seek/scrub, bookmark activation, subtitle/audio
  sync matching, pause/resume, PiP, rate changes, source change, and enhancement recreation.

## 9. P1 — make background playback honest before target SDK 35+

Verified defect, present in public 1.8.1, reported from device use: the notification's
playback clock kept advancing after pausing, stopping, or closing PiP, while actual
playback position stayed correct. `updatePlayPauseState` passed `mMediaPlayer.getRate()`
as the `PlaybackStateCompat` playback speed. That is the rate *setting*, which stays at
1.0 while paused; LibVLC never reports 0 for it. The system extrapolates the position it
displays as `position + elapsed * speed`, so any non-playing state published with a
non-zero speed produces a clock that runs on its own, client-side, forever.

- `[done]` Publish speed 0 for every non-playing state. One guard in `updatePlayPauseState`,
  which all five call sites already route through.
- `[todo]` Device-test the notification and lock-screen clock across pause, stop, closing
  PiP, and background play left enabled, on Android 13 through 16.
- `[todo]` The session position also goes stale after seeking while paused, because
  nothing republishes the state on a seek. Media3 removes the whole class of bug by
  deriving session state from the player, so fix it there rather than adding another
  publish call to the legacy path.

Decisions taken 2026-08-27:

- `[done]` `[decision]` **Media3 owns the session and notification.** A `SimpleBasePlayer`
  adapter over LibVLC, with `MediaSessionService` providing the notification, media
  buttons, lock-screen controls, and a `MediaController` API. All four of those exist
  today as hand-written code inside the 3,247-line `ReactVlcPlayerView`, so the adapter
  is close to line-neutral while replacing the deprecated `androidx.media` session APIs.
- `[done]` `[decision]` **Dismissing the task stops playback.** `onTaskRemoved` stops the
  service and clears the notification, and the UI copy must say so. Rejected leaving
  audio alive: it is music-app behavior, it costs process-death state handling, and it
  strands users with audio they cannot find.
- `[done]` `[decision]` **Section 8.2 lands before this phase.** `shouldShowBackgroundNotification()`
  reads `isHostPaused && !isInPipMode() && !mAwaitingPipAutoEnter`, which are exactly the
  timing guesses 8.2 deletes. Building service lifecycle on them means writing it twice.

- `[decision]` Until this phase is complete, either label background playback
  experimental or disable its production toggle. Activity-owned playback is not a
  reliable background architecture.
Implemented 2026-08-27. Five new files in the player module; `ReactVlcPlayerView` came
out 58 lines shorter despite gaining the integration, because the hand-written session went.

- `[done]` Move player ownership out of the view. `VlcPlaybackEngine` owns the `LibVLC`
  instance, its `MediaPlayer`, and the file descriptor behind a `content://` source. The
  view holds no native handles at all now; it borrows a player and gives it back. The 198
  `mMediaPlayer` call sites were deliberately left alone — moving them would be a
  3,000-line diff for no benefit.
- `[done]` Media3 `MediaSessionService`. `GlidePlaybackService` declares
  `foregroundServiceType="mediaPlayback"` with `FOREGROUND_SERVICE` and
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, all confirmed present in the release merged manifest.
- `[done]` The smallest LibVLC-backed `Player`: `VlcMedia3Player extends SimpleBasePlayer`,
  about 170 lines. Only `getState()` is abstract; the rest are optional handlers.
  **It mirrors LibVLC rather than replacing it** — React still drives the LibVLC player
  directly, and the adapter reports that state and forwards transport commands back.
  Making React drive Media3 would mean rewriting every call site in the view to gain
  nothing the session needs.
- `[done]` Media3 owns the notification; the view-owned legacy implementation is deleted.
  `MediaSessionCompat`, `showNotification`, `updatePlayPauseState`, `updateMediaMetadata`,
  the notification channel and `NOTIFICATION_ID` are all gone.
- `[done]` This deletes the notification-clock fix made earlier the same day, which is the
  correct end for it. The adapter exposes position as a `PositionSupplier`, so the session
  reads the live value instead of extrapolating from a position and a speed. There is no
  longer a speed to get wrong.
- `[done]` `onTaskRemoved` stops playback and the service, matching the decision above.
- `[done]` `POST_NOTIFICATIONS` was **not** reintroduced by Media3, so section 5.1's removal
  still holds: the Media3 notification is MediaStyle carrying a session token, which
  Android exempts. Verified against the release merged manifest.

Corrections to earlier assumptions in this section:

- `[keep]` **Audio focus stays in the view.** Media3 does not manage focus for a
  `SimpleBasePlayer`: `handleSetAudioAttributes(attributes, handleAudioFocus)` is a handler
  the implementer fills in, and `AudioFocusManager` is a utility ExoPlayer wires up, not
  something `SimpleBasePlayer` runs. The existing request/abandon, ducking, transient-loss
  and noisy-device handling works; rewriting it onto `AudioFocusManager` would be churn
  carrying real regression risk for no functional gain.
- `[keep]` **PiP needs no service work.** The requirement was that PiP must not create a
  second player. There is exactly one, owned by the engine, and PiP is the same Activity
  and the same view entering PiP mode. Already satisfied.
- `[decision]` **Media3 is pinned to 1.7.1, not 1.11.0.** Verified by building both: 1.11.0
  requires `compileSdk 36` *and* Kotlin 2.x — it pulls `kotlin-stdlib 2.2.10` against this
  project's 1.9.24 and fails with an incompatible-metadata error. Both are exactly the
  AGP 9 / Kotlin 2.2 work in section 10.2. So this phase is coupled to that one after all,
  which was not previously recorded. 1.7.1 has `SimpleBasePlayer`, `MediaSessionService` and
  `PositionSupplier`, so nothing above depends on the newer release.
- `[todo]` Media3 injects `ACCESS_NETWORK_STATE` into the merged manifest. It is a normal
  permission so it does not prompt, and it is left in place: only `media3-session` and
  `media3-common` are used, so it is probably unreachable, but removing a permission a
  library declares without proving it unused risks a `SecurityException` in code this
  project does not control. Confirm before stripping it.
- `[done]` Fixed a crash found on the first device run: toggling video enhancement while
  playing killed the process with `IllegalStateException: can't get VLCObject instance`
  from `MediaPlayer.getTime`. The position supplier was written as `player::getTime`, a
  method reference bound to whichever `MediaPlayer` existed when `getState()` ran. Media3
  keeps suppliers from previous states alive to detect position discontinuities, and the
  enhancement toggle releases and rebuilds the player, so the supplier outlived its
  player. A null check cannot catch this: the reference is not null, it is released.
  Every native read in the adapter now goes through one guarded helper that resolves the
  player from the host each time and catches `IllegalStateException`, and position falls
  back to the last good value so a dead player does not read as a seek to zero.
- `[done]` Fixed no notification appearing at all, found on the second device run. The
  adapter was reporting correct state — `state=READY playWhenReady=true` with real duration
  and position — but `onUpdateNotification` was never called even once. Building a
  `MediaSession` does not hand it to the `MediaSessionService`: `onGetSession` only fires
  when a `MediaController` connects, and Glide's UI drives the player directly rather than
  through a controller, so no controller ever connected. The service therefore never
  adopted the session, never observed the player, and never posted a notification or went
  foreground. `addSession` is now called explicitly in `onCreate` and `removeSession` in
  `onDestroy`.
- Correction: this section previously reasoned that a `MediaController` was optional
  because the session alone would drive the notification. That was wrong about the
  mechanism. A controller is still not required — `addSession` covers it — but the
  registration it would have performed as a side effect is not optional.
- `[done]` Confirmed on device: `isForeground=true foregroundId=1001 types=0x00000002`
  (mediaPlayback), one active session, and transport controls from the notification drive
  playback.
- `[done]` Fixed the notification showing a play state after closing PiP while playing.
  Two causes. The host-lifecycle pause path suppresses the VLC `Paused` event so React does
  not mistake it for a user pause, and that `break` skipped the session too. And
  `playWhenReady()` returned `!isPaused`, which is user intent — a lifecycle pause never
  sets `isPaused`, so the session would have reported playing even once told. The session
  now reports what playback is doing rather than what the user asked for: not playing when
  paused for host stop, audio-focus loss, or a noisy device. Section 8.2 keeps those as
  separate flags precisely so this distinction is expressible.
- `[done]` Closed the inverse: `setPausedModifier` clears the involuntary pause flags only
  on pause, never on play, so pressing play from the notification while backgrounded would
  have left the notification reading paused while audio ran. An explicit transport play
  clears them.
- `[todo]` Device-test the corrected states: close PiP while playing, lose audio focus to a
  call, and unplug headphones — the notification must show paused in all three, and pressing
  play from it must resume and show playing. `[SERVICE] onUpdateNotification startInForeground=true` in the
  trace is the confirmation; `[SERVICE] session created and registered` alone is not.

- `[todo]` Move player and media-session ownership into a foreground playback service.
- `[todo]` Prefer Media3 1.11.0 `MediaSessionService`; implement the smallest LibVLC-backed
  `Player` adapter needed by Glide rather than recreating ExoPlayer features.
- `[todo]` Add `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions
  and declare `foregroundServiceType="mediaPlayback"`.
- `[todo]` Let Media3 own the media notification and session controls; remove the
  view-owned legacy `MediaSessionCompat`/notification implementation afterward.
- `[todo]` Use a `MediaController` from the React/native UI; the Activity must not own
  the only live player instance.
- `[todo]` Transfer media URI, metadata, playback position, tracks, rate, repeat, delays,
  and user pause intent across UI/service connection without duplicate players.
- `[todo]` Handle audio focus, noisy devices, media buttons, headset/Bluetooth controls,
  task removal, process death, service stop, and explicit user stop.
- `[todo]` Define PiP/service interaction: PiP displays the service-owned playback
  surface/controller state without creating another player.
- `[todo]` Decide whether dismissing the task stops playback or leaves ongoing playback
  alive; make UI copy and `onTaskRemoved` match.
- `[todo]` After this service exists, raise target SDK. Android target 35+ rejects audio
  focus requests from a background app without a foreground service.

Exit check: lock screen, Home, task dismissal, process pressure, Bluetooth disconnect,
incoming call, notification controls, and reopening the UI all preserve explicit user intent.

## 10. P2 — coordinated React Native and Android toolchain migration

Do not update these independently. Use the RN Upgrade Helper/template diff as the source of truth.

### 9.1 Foreground service crash loop (found on device, 2026-08-27)

`ForegroundServiceDidNotStartInTimeException` on `GlidePlaybackService`, twice in 23
seconds across two PIDs: `Context.startForegroundService() did not then call
Service.startForeground()`.

- `[done]` Return `START_NOT_STICKY` from `onStartCommand`. Media3's `MediaSessionService`
  returns `START_STICKY` (confirmed from the 1.7.1 bytecode: a null intent returns 1),
  which suits a player that owns its media and can rebuild itself. This one cannot: the
  LibVLC player lives in the React view and `VlcPlaybackHost` is static, so both die with
  the process. A restarted service has nothing to describe.
- `[done]` Never leave a started service without settling its foreground state. `onCreate`
  bailed with a bare `stopSelf()` when no host was registered, *after* `super.onCreate()`.
  If the start required foreground promotion, that is this exact exception. The bail path
  now posts a placeholder notification and withdraws it immediately, which satisfies the
  contract whether or not the start required it.
- These two compounded into a loop that cannot exit: the process dies for any reason, the
  platform restarts the service sticky, the restart finds no host, it stops without going
  foreground, and the platform kills the process for it. Which matches the log exactly —
  same exception, same service, two PIDs, 23 seconds apart.
- `[todo]` The trigger for the *first* death is not in the captured log, which begins at
  the crash. `ApplicationExitInfo` reports `pss=488MB rss=627MB`, so a low-memory kill of
  a large video process is the likely entry into the loop. Worth watching memory
  independently; the fix above breaks the loop regardless of what starts it.
- `[todo]` Retest: play, background, PiP, swipe the task away, and force-stop, confirming
  no `AndroidRuntime` crash and that the notification still appears and controls playback.

### 10.1 JavaScript/runtime alignment

- `[done]` React Native `0.78.3` → `0.87.1`, the `latest` dist-tag at migration time.
- `[done]` React `19.0.0` → `19.2.3`, read from the RN 0.87.1 template rather than from
  npm `latest`. Both core packages are pinned exactly, as the template pins them.
- `[done]` Align `@react-native/babel-preset`, `metro-config`, `eslint-config`, and
  `typescript-config` to `0.87.1`. They had been pinned at `0.76.0` against a `0.78.3`
  runtime, so they were already two versions adrift before this migration started.
- `[done]` Replace the `15.0.0-alpha.2` CLI packages with stable `20.2.0`.
  `cli-platform-ios` is dropped rather than bumped: no iOS release is planned.
- `[done]` Node engine set to `>=22.11.0`. Corrects this entry's earlier `22.13.0`,
  which was not sourced from the template; `@react-native-community/template` for 0.87
  declares `>= 22.11.0`.
- `[done]` Fix the `VLCPlayer.tsx` deep import into
  `react-native/Libraries/Image/resolveAssetSource` by using `Image.resolveAssetSource`.
  The result is typed as a local `ResolvedVlcSource`, because the player passes plain
  objects carrying VLC-only fields (`mainVer`, `patchVer`, `initOptions`) straight
  through, and those are not part of React Native's resolved-asset shape.
- `[done]` Replace `InteractionManager` in `OnboardingScreen` with `requestIdleCallback`.
  This was not optional in the end: 0.87 removed `InteractionManager` from both the
  runtime and the type surface. React Native installs `requestIdleCallback` and
  `cancelIdleCallback` as globals in `setUpTimers.js` but ships no types for them, so
  `src/types/globals.d.ts` declares them.
- `[done]` The RN 0.87 Strict TypeScript API is active and the legacy deep-import opt-out
  is not in use. Verified by resolution rather than by assumption: `tsc --traceResolution`
  resolves `react-native` to `types_generated/index.d.ts`, and the package's export map
  offers the legacy surface only under the `react-native-legacy-deep-imports` condition,
  which nothing here sets. This is what produced most of the 52 type errors this migration
  had to fix, so it is load-bearing rather than nominal.
- `[done]` Add `@react-native/jest-preset@0.87.1` and point `jest.config.js` at it
  instead of the removed implicit `react-native` preset path. The existing
  `transformIgnorePatterns` is kept as-is; it already covers the untranspiled ESM deps.
  No React test renderer was added: all four suites are plain logic tests over
  `@jest/globals` and none render a component, so `@types/react-test-renderer` was
  removed rather than upgraded. 25/25 pass.
- `[done]` Regenerate the lockfile with a plain `npm install`; no `--legacy-peer-deps`.
  Two separate conflicts had to go first, and the second was the real one:
  `react-native-fast-image` declares `react@"^17 || ^18"` against this app's React 19,
  and `@react-native-documents/picker@11` requires `react-native >=0.79` while the app
  was on `0.78.3`. The flag had been masking a genuinely unsupported combination, not
  merely a cosmetic peer warning.

- `[done]` Remove `react-native-fast-image` entirely. It had not been published since
  October 2022, has no Fabric support, and its React 19 peer conflict was one of the two
  reasons the tree needed `--legacy-peer-deps`. All ten call sites were plain
  `<Image>` equivalents: eight local thumbnails and two OMDB posters, and its caching and
  priority queue only ever applied to remote images, which Android already caches natively.
- `[done]` Drop four dependencies `@glide/vlc-player` declared but never imported
  (`react-native-slider`, `react-native-vector-icons`, `@expo/config-plugins`, and
  `@types/react@~18.2.14`). The last was pulling React 18 types into a React 19 tree, and
  the vector-icons one was the only reason three app files could import the legacy icon
  package at all; they now use the scoped `@react-native-vector-icons/feather` like the
  rest of the app.
- `[done]` Reanimated `3.19.3` → `4.6.0` with the new `react-native-worklets` peer, and
  the Babel plugin moved from `react-native-reanimated/plugin` to
  `react-native-worklets/plugin`. Verified the app's Reanimated surface survives v4:
  `useAnimatedGestureHandler`, the one API v4 removes, has zero uses here.
- `[done]` Drop `baseUrl` from `tsconfig.json`, deprecated in TypeScript 6 and removed in
  7, rather than silencing it with `ignoreDeprecations`. `paths` resolve relative to the
  config file without it. This surfaced two imports that only ever resolved through
  `baseUrl` (`from 'ErrorBoundary'` in `App.tsx` and `VideoPlayerRoot.tsx`).
- `[done]` Fix the 0.87 type-surface changes: `StyleSheet.absoluteFillObject` is gone and
  `absoluteFill` is now that same raw object; `SharedValue` moved off the Reanimated
  `Animated` namespace to the package root; refs hold `TextInputInstance` rather than the
  component type; `Dimensions` change payloads are all-optional; `AppState.currentState`
  is nullable; `Linking.getInitialURL` can resolve `undefined`; and `TextStyle` members
  are readonly, so `SubtitleHtmlParser`'s two style builders assemble through a writable
  view of the same shape.

### 10.2 Android template alignment

- `[done]` Move to the RN 0.87.1 template toolchain: AGP 9.2.1 and Kotlin 2.2.0 (both read
  from `@react-native/gradle-plugin`'s own version catalogue), build tools 37.0.0,
  compileSdk 37, targetSdk 36. `minSdk` stays at 26; the template's 24 is lower than what
  this app already requires. AGP is not pinned anywhere: the root uses versionless
  classpaths, so React Native's Gradle plugin supplies it and the RN version governs.
- `[done]` Add `android.builtInKotlin=false` and `android.newDsl=false`, exactly as the
  0.87 template ships them. `[todo]` Remove both when moving to AGP 10, which drops the
  opt-outs; the build currently logs obsolete-variant-API warnings that are the deferred
  work, not a defect.
- `[done]` Gradle wrapper `8.11.1` → `9.4.1`, the version the 0.87.1 template pins.
- `[done]` Reconcile the split NDK versions. The root declared `26.1.10909125` and the app
  overrode it with `27.0.12077973`; both now resolve to the template's `27.1.12297006`
  from `rootProject.ext`.
- `[done]` Delete the app's `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON` CMake arguments.
  Corrects this entry's original premise, and my first justification for acting on it: the
  block was **not** a no-op. The app module ships no `CMakeLists.txt` of its own, but React
  Native's Gradle plugin configures `externalNativeBuild` for `:app` against its own CMake
  and generated autolinking, so the argument was reaching a real native build. Removing it
  is still right, for a different reason: `NdkConfiguratorUtils` adds
  `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON` itself unless a build already specifies it, so
  the manual copy was redundant rather than dead. This matters because NDK r27 treats 16 KB
  page support as opt-in (r28 makes it the default), so deleting the flag without checking
  who else sets it would have silently regressed 16 KB alignment.
- `[done]` Confirm 16 KB alignment on the built APKs rather than trusting the plugin
  read: `zipalign -c -P 16 4` passes on both `arm64-v8a` and `armeabi-v7a`.
  `scripts/glide-trace.ps1 -Verify` now runs exactly this check, alongside the device page
  size and the installed build, so it is repeatable before each release.
- `[done]` New Architecture and Hermes stay on, and every local native module compiles
  under Kotlin 2.2/AGP 9.
- `[done]` The app `splits` block no longer hardcodes its ABI list; it reads the same
  `rootProject.ext.nativeArchitectures` the local modules use, so all three cannot drift.
  `[todo]` Some third-party modules (`react-native-stallion`, `react-native-mmkv`) still
  configure x86/x86_64 CMake targets regardless of `reactNativeArchitectures`. It costs
  build time only, since the APK splits exclude them, but it is worth revisiting.
- `[todo]` Re-run Android 15/16 behavior-change checklists, predictive back, edge-to-edge,
  exported components, foreground service, permissions, and 16 KB tests.

- `[done]` Migrate `MainApplication` from `reactNativeHost` to `reactHost`. This was not
  cosmetic: in 0.87 `ReactApplication.reactNativeHost` *throws* under the New Architecture.
  Stallion's OTA bundle, previously supplied by overriding `getJSBundleFile()`, is now
  passed as `getDefaultReactHost(jsBundleFilePath = ...)`, which keeps the same
  null-means-use-the-packaged-bundle behaviour. `SoLoader.init` plus the New Architecture
  entry point are replaced by `loadReactNative(this)`.
- `[done]` Fix two silent runtime regressions the compiler could not catch:
  `MainActivity` and `VideoPlayerActivity` reached the React context through
  `reactNativeHost.reactInstanceManager`, inside a `try/catch`. That still compiles, but
  now throws at runtime and would have been swallowed, leaving picture-in-picture mode
  changes silently never reaching JavaScript. Both now use `reactHost.currentReactContext`.
- `[done]` Replace `currentActivity` with `reactApplicationContext.currentActivity` across
  the Splash, orientation, and PiP modules. 0.87 converted `ReactContextBaseJavaModule` to
  Kotlin, so `getCurrentActivity()` is no longer synthesised into a property; this is the
  replacement its own deprecation names.
- `[done]` Switch both `getDefaultProguardFile('proguard-android.txt')` call sites to
  `proguard-android-optimize.txt`. AGP 9 refuses the former outright because it carries
  `-dontoptimize`, which suppresses many R8 optimisations.
- `[done]` CI moves to Node 22 (0.87 requires >= 22.11, CI was pinned at 20) and installs
  with a plain `npm ci`. JDK 17 is unchanged and satisfies AGP 9.

### 10.5 Clean sweep review (2026-08-27)

A deliberate re-read of everything changed in sections 9 and 10, against the shipped APIs
rather than against memory. Findings, including against my own work:

- `[done]` **A codemod silently corrupted an import.** `OnboardingScreen` ended up with
  `FlatList,<CR>    useWindowDimensions,` on one line: in JavaScript, `^` under the `m`
  flag matches after a lone `CR` as well as after `LF`, so a `/^\s*X,\r?\n/m` edit on a
  CRLF file anchored *between* the CR and the LF and the greedy `\s*` then ate the LF.
  It compiled and typechecked, because the result is still valid TypeScript. Repaired, and
  every changed file was swept for lone CRs — this was the only one.
- `[done]` **The crash fix created a second notification channel.** A channel is
  permanently visible in the app's notification settings once created, so the placeholder
  would have left the user a "Playback handoff" category for a notification that exists
  only between posting and withdrawing it. It now reuses
  `DefaultMediaNotificationProvider.DEFAULT_CHANNEL_ID` and `DEFAULT_NOTIFICATION_ID`,
  so nothing new appears.
- `[done]` The same bail path could run twice — `onCreate` calls it, then the pending start
  command arrives and calls it again. Guarded.
- `[done]` Delete the recording feature: `startRecording`, `stopRecording` and
  `onRecordingState` across the view, the view manager, the event emitter, `VLCPlayer.tsx`
  and `index.d.ts`, with zero callers anywhere in `src/`. About 70 lines. Command ids in
  the manager are explicit (1, 2, 4, 5, 6) and JavaScript dispatches by name, so removing
  1 and 2 needed no renumbering.
- `[done]` Move `@types/sentiment` from `dependencies` to `devDependencies`.
- `[done]` `-Verify` no longer demands a connected device. Checking a build's 16 KB
  alignment is a local operation and had no business requiring a phone.
- `[done]` Remove a stray blank line the `DimensionsPayload` import edit left in
  `RecapModal`.

Deliberately **not** done, with reasons:

- `[keep]` The module declares 50 props and the app passes 29. Most of the difference is
  not dead: the eleven `onVideoX` callbacks are the native event names that
  `VLCPlayer.tsx` maps to the short names the app uses, and `subtitleUri` and
  `acceptInvalidCertificates` are real native features this app happens not to use. Only
  `disableFocus` and `playWhenInactive` are genuinely inert, which is not worth churning
  a file that was just validated on device. Checked before cutting, not after.
- `[keep]` `autoAspectRatio` is never passed from JavaScript but is load-bearing in the
  native geometry code from section 8.1. Removing the prop would have stranded live
  branches; removing the machinery is a geometry refactor, not a sweep.
- `[todo]` **`ios/` is a stale pre-0.80 template.** Old-style `AppDelegate.mm`, no
  `Podfile.lock`, and last touched only by a version bump. It cannot build on RN 0.87,
  where the AppDelegate moved to Swift. With no iOS release planned it is dead weight that
  implies support that does not exist. Deleting it is a product call, not a cleanup.

### 10.3 Local VLC module Gradle cleanup

- `[done]` Remove `androidx.media:media:1.6.0`. Section 9 deleted the last
  `MediaSessionCompat` and `MediaButtonReceiver` use when Media3 took over the session,
  leaving the dependency behind with no consumer.

- `[done]` Remove nested AGP 4.0.2 `buildscript`. It pinned a toolchain five majors
  behind the root and would have fought any AGP bump.
- `[done]` Replace `com.facebook.react:react-native:+` with `com.facebook.react:react-android`
  and no version. Verified the old coordinate was already being substituted to
  `react-android:0.78.3` with a `strictly` constraint from React Native's Gradle plugin,
  so the version comes from the plugin and the `+` selector is simply gone.
- `[done]` Remove the `mvnrepository.com` repository. That host is a search website, not
  a Maven repository; every lookup against it was wasted.
- `[done]` Align compile/target/min SDK with the app by reading `rootProject.ext`, so a
  toolchain bump moves one file instead of three.
- `[done]` Align ABI filters with the app. The module built `x86` and `x86_64` on every
  native compile and shipped them nowhere; a root `nativeArchitectures` list now derives
  from the same `reactNativeArchitectures` property the app uses. Verified by clearing the
  native intermediates and rebuilding: only `armeabi-v7a` and `arm64-v8a` are produced.
- `[done]` Remove library `versionCode`/`versionName`. An Android library does not carry
  app identity, and the stray `versionCode 1` invited confusion with section 4.2's work.
- `[todo]` Update `androidx.activity` through dependency alignment rather than a stale hard pin.

### 10.4 Local simple-thumbnail module cleanup

This Android-only module is manually included in `android/settings.gradle`, linked in
`android/app/build.gradle`, and registered in `MainApplication.kt`; it is not a normal
root-package dependency and therefore needs its own migration checklist.

- `[done]` Add `namespace "com.reactnativesimplethumbnail"` and remove the manifest
  `package` attribute. Done before the template migration rather than after: AGP 9 removes
  the attribute outright, so this had to land first or the bump could not even configure.
- `[done]` Remove the nested AGP 7.3.1 / Kotlin 1.7.20 `buildscript`; the module inherits
  the root plugins.
- `[done]` Align compile/min/target SDK with the app; the 33/21/33 fallbacks are gone.
- `[done]` Remove `lintOptions { abortOnError false }`. The block is also renamed in AGP 8
  and removed in 9, so it was a migration blocker as well as a silenced signal.
- `[done]` Remove `mavenLocal()` and the obsolete `node_modules/react-native/android`
  repository path, which has not been how React Native is consumed for several releases.
- `[done]` Replace `com.facebook.react:react-native:+` with `react-android`, and remove
  the hard-pinned `kotlin-stdlib:1.7.20`. That pin would have put a second, older stdlib
  against the Kotlin 2.2 everything else compiles with.
- `[todo]` Replace the `compileOnly` path to `ffmpeg-kit-minimal.aar` with the single
  app-owned FFmpeg module/dependency so compile and runtime APIs cannot drift.
- `[todo]` Decide whether to keep the legacy `NativeModules`/`ReactPackage` bridge or
  migrate it to a typed TurboModule. The minimum acceptable RN 0.87 result is a tested,
  explicitly registered legacy module with no New Architecture warnings.
- `[todo]` Add unit/instrumentation coverage for thumbnail generation, media metadata,
  FFprobe subtitle discovery, extraction, invalid content URIs, cancellation, and cleanup.
- `[todo]` Keep its Android implementation and section 14's iOS support decision tied
  together; do not claim cross-platform behavior from this package metadata.

## 11. P2 — native media dependencies and 16 KB support

### 11.1 LibVLC

- `[todo]` Complete geometry fixtures first, then upgrade LibVLC `3.6.5` → stable `3.7.5`.
- `[todo]` Do not ship LibVLC 4 EAP.
- `[todo]` Re-run resize, SAR, tracks, snapshots, PiP, codecs, streams, and native ELF checks.

### 11.2 Focused FFmpegKit wrapper repair

- `[todo]` Attempt the smallest compatibility repair first: rebuild ARM64
  `libffmpegkit.so` and `libffmpegkit_abidetect.so` from the matching FFmpegKit 6 source
  with 16 KB linker alignment, against the existing aligned FFmpeg libraries.
- `[todo]` Do not mix FFmpegKitNext 8 wrappers with FFmpegKit 6 libraries; ABI compatibility
  must be exact.
- `[todo]` Replace the two AAR entries, then repeat ELF inspection and functional tests
  for probe, thumbnail, subtitle extraction, audio extraction, HTTPS input, and cancellation.
- `[todo]` If a focused rebuild cannot be reproduced safely, move directly to the full migration below.

### 11.3 Full FFmpegKitNext maintenance migration

- `[todo]` Build a pinned FFmpegKitNext release locally/CI using its recommended Nix
  environment; it is not a normal npm/Maven drop-in.
- `[todo]` Enable only libraries/codecs Glide actually uses. Record configure flags and hashes.
- `[todo]` Produce reproducible AAR/XCFramework artifacts for supported platforms/ABIs.
- `[todo]` Review LGPL/GPL configuration, source-offer/notice obligations, and codec patent considerations.
- `[todo]` Replace retired `react-native-ffmpeg-kit`, the vendored AAR, five global
  dependency substitutions, and duplicate app-level FFmpeg/smart-exception dependencies.
- `[todo]` Keep the focused wrapper repair and full migration as separate commits/phases.

### 11.4 Final native package validation

- `[todo]` Run `zipalign -c -P 16 -v 4` on each signed APK.
- `[todo]` Inspect every packaged `.so` PT_LOAD alignment for ARM64.
- `[todo]` Test on a real/emulated 16 KB ARM64 Android image with compatibility mode disabled.
- `[todo]` Record APK sizes and confirm each ABI APK contains only its intended ABI.

## 12. P2/P3 — dependency and code simplification

### 12.1 Remove dependencies with proven replacements

- `[done]` Replace the single Axios caller with existing `fetchWithTimeout`; remove Axios.
- `[done]` Replace the `react-native-fast-image` call sites with RN `Image` and remove the
  dependency. Ten sites, not seven: eight local thumbnails and two remote OMDB posters.
  No caching UX was lost, because the caching only ever applied to the remote images and
  Android caches those natively anyway.
- `[todo]` After RN 0.87, use built-in `edgeToEdgeEnabled=true`; replace only required
  navigation-bar styling and remove `react-native-edge-to-edge`.
- `[done]` Remove direct `baseline-browser-mapping`; it had no source or config consumer.
- `[done]` Remove the stale local VLC package dependencies: `react-native-slider`,
  `react-native-vector-icons`, `@expo/config-plugins`, and the React 18 types. None were
  imported anywhere in the module. The vector-icons one was load-bearing by accident:
  three app files could only resolve the legacy icon package because this module happened
  to depend on it, and they now use the scoped package like the rest of the app.
- `[done]` Remove `@types/react-test-renderer`. There is no consumer: all four suites are
  plain logic tests over `@jest/globals` and none renders a component.
- `[todo]` Upgrade `react-native-config` only as part of RN compatibility; never use it for secrets.
- `[todo]` Upgrade Stallion SDK `2.2.0` and CLI `2.3.1` to compatible current stable
  versions, then test production bundle download, restart, phased rollout, and rollback.
- `[todo]` Upgrade navigation/screens/gesture/reanimated/MMKV/Nitro packages in compatible
  groups after RN migration. Do not run a blanket `npm update`.
- `[todo]` Re-run `npm audit --omit=dev`; document which remaining advisories are build-only,
  unreachable, accepted, or fixed, with expiry dates for accepted risk.

### 12.2 Delete proven dead source

- `[done]` Screenshot capture, removed 2026-08-27 on the owner's confirmation that it is
  unused. `doSnapshot`/`sendSnapshotEvent` in the view, the `snapshot` command and its
  dispatch case in the ViewManager, `EVENT_ON_SNAPSHOT` in `VideoEventEmitter`, and the
  `snapshot()` method and `onSnapshot` prop in `VLCPlayer.tsx` and `index.d.ts`. Nothing in
  `src/` ever called it. Note this is unrelated to `PlaybackSnapshot`, which carries
  enhancement-recreate state and stays.
- `[decision]` Video **recording** is in exactly the same position: `startRecording`,
  `stopRecording`, and `onRecordingState` are referenced only inside the player wrapper,
  with no consumer anywhere in `src/`. Confirm whether it is wanted before deleting; unlike
  the files above it is a feature, not a stray helper.

Re-run references immediately before deletion, then remove:

- `[done]` All five deleted, 388 lines, after re-running references immediately before
  removal and confirming none is re-exported from a barrel file. Typecheck, lint, tests
  and a full debug build pass without them.

### 12.3 Remove stale configuration and build plumbing

- `[done]` `react-native.config.js` pointed at a nonexistent `./assets/fonts`. The entry
  is deleted: the fonts are committed directly to `android/app/src/main/assets/fonts`,
  so there was never anything for `react-native-asset` to link.
- `[todo]` Review the bundled `NetflixSans-*` font files. Record license/provenance or
  replace them with a redistributable font; do not publish unverified branded font assets.
- `[todo]` Remove global Gradle `flatDir`; keep one explicit local AAR module only while
  the FFmpeg wrapper remains vendored.
- `[todo]` Resolve Gradle warnings owned by this repository, including duplicate/stale
  namespace declarations, after the RN template migration.
- `[todo]` Decide the lone `SearchScreen` TODO: implement the options sheet because a
  reachable control promises it, or remove the control/TODO. Do not ship a dead affordance.

### 12.4 Reduce noise without abstraction churn

- `[todo]` Fix all real `react-hooks/exhaustive-deps` warnings first; each can be a stale-state bug.
- `[todo]` Remove unused variables/imports and useless escapes; then set CI ESLint
  `--max-warnings 0`.
- `[todo]` Audit 352 `console.*` calls in `src`:
  - remove diagnostic spam from hot paths;
  - gate useful development diagnostics with `__DEV__`;
  - keep actionable production errors without media paths, content, or credentials;
  - enforce the rule in ESLint.
- `[done]` Give the player a logging facility, 2026-08-27. `VlcLog` replaces every raw
  `Log.*` call in `ReactVlcPlayerView` and `VlcPipController` — 134 of them — with one tag
  (`GlideVLC`) and two levels. `trace` carries the play-by-play and is silent unless
  `adb shell setprop log.tag.GlideVLC VERBOSE` is set, so a release build no longer floods
  logcat during playback and PiP resize, while a developer can still get the full trace
  from an installed build without a rebuild. `warn` and `error` stay always-on and carry
  only what someone would act on. `Log.i` was folded into `trace`: during normal playback
  info is noise, and anything warranting production visibility is already a warning.
  The two continuously-running messages, `[PIP_RESIZE]` and `[RESIZE]`, are additionally
  wrapped in `if (VlcLog.tracing())` because Java builds their strings — and `[PIP_RESIZE]`
  walks to the Activity decor view — before the call regardless of level.
- `[todo]` Apply the same treatment to the remaining project-owned Android `Log.*` calls
  outside the player, and audit the original baseline of 208:
  85 debug, 63 info, 30 warning, and 30 error. Remove hot-path diagnostics, including
  production `Log.i` noise from `[PIP_RESIZE]`/`[PIP_BOUNDS]`; retain actionable warnings
  and errors without media URIs, titles, device content, or credentials. Development-only
  geometry/event traces must be build-gated or stripped from release builds, and the
  release check must confirm they do not flood logcat during playback/PiP resize.
- `[keep]` Large files are not split only for line count. Split after behavior is frozen
  only when ownership/test boundaries become clearer. `ReactVlcPlayerView` is the first
  justified candidate after geometry/lifecycle simplification.
- `[decision]` Review `ThumbnailService`'s LIFO queue/dedupe/worker cache only with a
  measured scroll/thumbnail benchmark. Do not replace working backpressure speculatively.

### 12.5 Direct JavaScript dependency disposition ledger

Every direct entry in the baseline `package.json` is accounted for below. “Keep/align”
means retain only if its current source consumer still exists and its RN 0.87 peer/native
matrix passes; it is not permission to update it independently.

Registry evidence captured with `npm outdated --json --long` on 2026-08-23 follows.
These are installed-lockfile → npm `latest` values for entries npm reported as outdated;
an omitted package was registry-current at that instant, local, or not reported. Registry
`latest` does **not** prove RN compatibility, maintenance quality, or that a major upgrade
belongs in Glide.

| Runtime package reported outdated | Installed → npm latest |
|---|---|
| `@dr.pogodin/react-native-fs` | `2.36.2` → `2.40.0` |
| `@react-native-community/slider` | `5.1.0` → `5.2.1` |
| `@react-native-documents/picker` | `11.0.3` → `12.0.2` |
| `@react-native-vector-icons/feather` | `12.4.0` → `13.1.3` |
| `@react-navigation/bottom-tabs` | `7.6.0` → `7.18.17` |
| `@react-navigation/native` | `7.1.19` → `7.3.17` |
| `@react-navigation/native-stack` | `7.6.0` → `7.18.9` |
| `@shopify/flash-list` | `2.2.0` → `2.3.2` |
| `axios` | `1.12.2` → `1.19.0` |
| `compromise` | `14.14.5` → `14.16.0` |
| `react` | `19.0.0` → `19.2.8` |
| `react-native` | `0.78.3` → `0.87.0` |
| `react-native-config` | `1.5.6` → `1.6.1` |
| `react-native-edge-to-edge` | `1.7.0` → `1.8.1` |
| `react-native-gesture-handler` | `2.29.0` → `3.2.1` |
| `react-native-mmkv` | `4.0.0` → `4.3.2` |
| `react-native-nitro-modules` | `0.33.2` → `0.37.0` |
| `react-native-reanimated` | `3.19.3` → `4.6.0` |
| `react-native-safe-area-context` | `5.6.1` → `5.9.1` |
| `react-native-screens` | `4.18.0` → `4.27.0` |
| `react-native-share` | `12.1.0` → `12.3.1` |
| `react-native-stallion` | `2.2.0` → `2.4.2` |
| `react-native-svg` | `15.14.0` → `15.15.5` |
| `react-native-zip-archive` | `7.0.2` → `9.4.0` |
| `zustand` | `5.0.8` → `5.0.15` |

| Development package reported outdated | Installed → npm latest |
|---|---|
| `@babel/core` | `7.28.5` → `8.0.1` |
| `@babel/preset-env` | `7.28.5` → `8.0.2` |
| `@babel/runtime` | `7.28.4` → `8.0.0` |
| `@react-native-community/cli` | `15.0.0-alpha.2` → `20.2.0` |
| `@react-native-community/cli-platform-android` | `15.0.0-alpha.2` → `20.2.0` |
| `@react-native-community/cli-platform-ios` | `15.0.0-alpha.2` → `20.2.0` |
| `@react-native/babel-preset` | `0.76.0` → `0.87.0` |
| `@react-native/eslint-config` | `0.76.0` → `0.87.0` |
| `@react-native/metro-config` | `0.76.0` → `0.87.0` |
| `@react-native/typescript-config` | `0.76.0` → `0.87.0` |
| `@types/react` | `19.2.2` → `19.2.18` |
| `@types/react-test-renderer` | `18.3.1` → `19.1.0` |
| `babel-jest` | `29.7.0` → `30.4.1` |
| `babel-plugin-module-resolver` | `5.0.2` → `5.0.3` |
| `baseline-browser-mapping` | `2.9.11` → `2.11.18` |
| `eslint` | `8.57.1` → `10.9.0` |
| `jest` | `29.7.0` → `30.4.2` |
| `prettier` | `2.8.8` → `3.9.6` |
| `stallion-cli` | `2.3.1` → `2.5.1` |
| `typescript` | `5.0.4` → `7.0.2` |

| Direct dependency | Required action |
|---|---|
| `@dr.pogodin/react-native-fs` | Keep/align; updater and file operations depend on it. Test scoped-storage/content-URI behavior. |
| `@react-native-camera-roll/camera-roll` | Keep/align for the video library; verify Android partial-video grants and remove unrelated permissions. |
| `@react-native-community/blur` | Keep/align only for verified blur call sites; test Android rendering/fallback. |
| `@react-native-community/slider` | Keep/align the root slider used by the app; remove only the stale slider dependency inside local VLC. |
| `@react-native-documents/picker` | Keep/align; test picker grants, persisted access, cancellation, and invalid results. |
| `@react-native-vector-icons/feather` | Keep/align scoped Feather package; remove stale umbrella vector-icons/type packages. |
| `@react-navigation/bottom-tabs` | Keep and update with the navigation group. |
| `@react-navigation/native` | Keep and update with bottom-tabs/native-stack/screens/safe-area. |
| `@react-navigation/native-stack` | Keep and update with the navigation group. |
| `@shopify/flash-list` | Keep/align while the library list uses it; regression-test item recycling and thumbnails. |
| `@types/sentiment` | Move to `devDependencies`; it is compile-time only. Remove if `sentiment` ships sufficient types. |
| `axios` | Remove after its one caller uses `fetchWithTimeout`. |
| `compromise` | Keep only while recap/NLP source consumers remain; test bundle cost and remove with the feature if unused. |
| `react` | Align exactly to the RN template; never independently. |
| `react-native` | Coordinated migration in section 10. |
| `react-native-config` | Keep/align only for non-secret build configuration; remove packaged credential use. |
| `react-native-edge-to-edge` | Remove after RN 0.87 built-in edge-to-edge replacement is verified. |
| `react-native-fast-image` | Replace seven call sites with RN `Image`, verify UX, then remove. |
| `react-native-ffmpeg-kit` | Retired dependency; remove through section 11's focused repair/full migration, not by itself. |
| `react-native-gesture-handler` | Keep and align with navigation/reanimated/RN. |
| `react-native-linear-gradient` | Keep only for verified UI consumers; visually regression-test before considering removal. |
| `react-native-mmkv` | Keep/align for synchronous persisted state; remove fake async wrappers around it. |
| `react-native-nitro-modules` | Keep only as required by MMKV/other verified Nitro consumers; align as one native group. |
| `react-native-markdown-display` | Keep/align for bounded release notes; audit its Markdown dependency chain. |
| `react-native-reanimated` | Keep and align with RN/gesture/navigation; run worklet and release-build tests. |
| `react-native-safe-area-context` | Keep and align with RN/navigation. |
| `react-native-screens` | Keep and align with RN/navigation; retest PiP/navigation lifecycle. |
| `react-native-share` | Keep only for reachable share UI; test Android URI grants and iOS if supported. |
| `react-native-stallion` | Keep only if section 13's OTA contract is accepted; otherwise remove SDK and channel UI. |
| `react-native-svg` | Keep/align for verified SVG/icon consumers. |
| `@glide/vlc-player` | Keep as the core local player; execute sections 8, 9, 10.3, and 11. |
| `react-native-zip-archive` | Keep only for the verified subtitle/archive flow; enforce archive size/path traversal limits. |
| `sentiment` | Keep only while recap/NLP analysis consumes it; remove with unused feature paths. |
| `zustand` | Keep for current stores; do not add a second state framework. |

| Direct development dependency | Required action |
|---|---|
| `@babel/core`, `@babel/preset-env`, `@babel/runtime` | Align to the RN 0.87 template and Metro; keep runtime in the template-selected dependency section. |
| `@react-native-community/cli` | Replace alpha 15 with the exact stable CLI selected by the RN template. |
| `@react-native-community/cli-platform-android` | Align exactly with the template CLI/core package. |
| `@react-native-community/cli-platform-ios` | Align exactly with the template CLI/core package. |
| `@react-native/babel-preset` | Align exactly to the RN runtime/template. |
| `@react-native/eslint-config` | Align exactly to the RN runtime, then enforce zero warnings. |
| `@react-native/metro-config` | Align exactly to the RN runtime/template. |
| `@react-native/typescript-config` | Align exactly to the RN runtime and Strict TypeScript API. |
| `@types/react` | Align exactly to template React. |
| `@types/react-native-vector-icons` | Remove after scoped Feather types pass TypeScript; it targets the old umbrella package. |
| `@types/react-test-renderer` | Remove if there is no renderer consumer; otherwise align renderer and types to React 19. |
| `babel-jest`, `jest` | Align with the RN template/preset and retain the existing tests. |
| `babel-plugin-module-resolver` | Keep only while Babel config uses aliases that TypeScript/Metro also resolve; otherwise remove. |
| `baseline-browser-mapping` | Remove; no source/config consumer exists. |
| `eslint` | Migrate with RN config, resolve all warnings, and enforce zero warnings. |
| `prettier` | Keep as the single formatter; upgrade only with one formatting decision, not incidental dependency work. |
| `stallion-cli` | Align with the retained Stallion SDK or remove both if OTA is dropped. |
| `typescript` | Align to the RN template/Strict TypeScript API and keep `tsc --noEmit` in CI. |

Native dependency ownership must also stay singular:

- `[todo]` Keep one FFmpeg provider. Remove the app's direct
  `com.arthenica:ffmpeg-kit-https:6.0-2`, duplicate smart-exception artifacts, five
  global substitutions, local AAR path, and wrapper package only as the selected
  section 11 migration makes each redundant.
- `[todo]` Keep one React Android dependency per module; no `react-native:+` selectors.
- `[todo]` Align `androidx.activity`, legacy `androidx.media`, and future Media3 versions
  from one root catalog/constraint set; delete legacy media only after service migration.
- `[todo]` Generate and review the resolved npm and Gradle dependency trees after each
  migration group; direct-entry accounting alone does not catch vulnerable transitives.

### 12.6 Bridge, cache, and network contracts

- `[todo]` Define one typed event map shared by `VLCPlayer.tsx` and `index.d.ts` for every
  native player callback. Remove `any` from `onBuffering`/`NativeSyntheticEvent` and make
  the buffering declaration include both `isBuffering` and `bufferRate`.
- `[todo]` Compare `VideoEventEmitter.java`, the ViewManager event export, the TypeScript
  wrapper, and every JS consumer. Add a contract test/fixture for names, required fields,
  units, nullability, and Android/iOS parity; delete stale declared events.
- `[todo]` Document subtitle storage layers and invalidation separately:
  - online search results live only for the requesting screen/in-flight coalescer;
  - downloaded ZIP and extraction directories are removed on success, error, abort, and timeout;
  - parsed cue cache keys include video and subtitle identity and are evicted on source/subtitle change;
  - app-start/final cleanup removes orphan temporary subtitle/audio files;
  - a user-visible “clear cache” action reports what it deleted and never removes user originals.
- `[todo]` Add bounded archive extraction: reject absolute paths, `..` traversal,
  symlinks if exposed by the archive library, excessive entry count, and excessive
  compressed/uncompressed size before reading subtitle content.
- `[todo]` Verify `SubtitleCueStore` cache and track LRU limits with long playback and
  repeated subtitle switching; make eviction deterministic and cover it with tests.
- `[todo]` After the RN/Hermes migration, check runtime support for
  `AbortSignal.timeout()` and `AbortSignal.any()`. If both cover the required abort-reason
  behavior, simplify `network.ts`; otherwise keep the tested helper rather than polyfilling
  merely for fewer lines.
- `[todo]` Keep every external request's timeout, caller cancellation, HTTP-status check,
  response-size/schema validation, and user-safe error mapping when simplifying networking.

## 13. P1/P2 — Stallion OTA contract

- `[todo]` Document that OTA may change JavaScript and compatible assets only. Native
  modules, permissions, Gradle/Pod changes, RN runtime changes, codecs, and binary API
  changes require a new APK/IPA.
- `[todo]` Target Stallion releases to the exact compatible native app version/channel.
- `[todo]` Never use OTA to work around the monotonic APK version/release process.
- `[todo]` Enable and verify signed updates/integrity features supported by the selected SDK plan.
- `[todo]` Use staged production rollout; define pause and rollback owners.
- `[todo]` Test automatic rollback from a deliberately crashing test bundle.
- `[todo]` Surface pending-restart state consistently with the APK update UI so two
  update systems do not issue contradictory prompts.
- `[todo]` Record currently running native version, OTA bundle version, and rollback
  state in a diagnostics screen/log without identifiers or secrets.

## 14. P2 — decide and correct iOS scope

The repository advertises/builds iOS source, but current production proof is Android-only.

- `[decision]` Choose one:
  - **Android-only:** state it in README/package scripts and remove unmaintained iOS
    product code rather than implying parity.
  - **iOS supported:** complete every item below on macOS hardware/CI.

If iOS remains supported:

- `[todo]` Add accurate photo/video library usage descriptions required by CameraRoll.
- `[todo]` Remove the empty, apparently unused location permission description.
- `[todo]` Implement or replace Android-only `react-native-simple-thumbnail` calls on iOS.
- `[todo]` Align local VLC podspec version (`1.0.38`) with the package (`1.0.96`) or remove
  meaningless independent versions for a path dependency.
- `[todo]` Raise obsolete iOS deployment target 8.4 to the RN 0.87 template minimum.
- `[todo]` Upgrade MobileVLCKit 3.5.1 to a maintained compatible version and test the
  complete player feature matrix.
- `[todo]` Remove stale `MobileVLCKit-unstable` project search paths if CocoaPods/SPM owns linkage.
- `[todo]` Align `CURRENT_PROJECT_VERSION` and `MARKETING_VERSION` with section 4.
- `[todo]` Register only licensed custom fonts in iOS or use system fonts consistently.
- `[todo]` Implement/verify iOS PiP, background audio/session, interruptions, route
  changes, lock-screen controls, AirPlay if claimed, and app lifecycle.
- `[todo]` Verify ATS behavior for HTTPS and intentional user-entered streams.
- `[todo]` Build, test, archive, sign, install, and upgrade on supported iOS versions.
- `[todo]` Verify `PrivacyInfo.xcprivacy` accurately covers app and dependency API usage.

## 15. P3 — tests and guardrails

### 15.1 Fast automated tests

- `[done]` Baseline `hudReducer.test.ts`: three tests pin identical-state return for
  unchanged/repeated `UPDATE_ZOOM` and a new state for a real scale change. These are
  regression protection for the former non-`contain` render loop.
- `[done]` Baseline `version.test.ts`: seven tests describe the current normalizer/
  comparator, including its build-suffix stripping. Replace the problematic expectations
  when strict final-tag semantics land; do not mistake tests of current behavior for proof
  that the current release contract is correct.
- `[todo]` Strict version parser/comparator and release-tag validation.
- `[todo]` `selectApkForDevice`, trusted URL validation, checksum parsing, file-name sanitation.
- `[todo]` Settings migration and corrupt MMKV payload behavior.
- `[todo]` Filename parser on representative movie/show names and malformed input.
- `[todo]` Subtitle parser for SRT/VTT/ASS/SSA, malformed cues, encodings, and SDH cases.
- `[todo]` SubDL request coalescing: two consumers, one cancellation, all cancellation,
  timeout, retry, and no leaked in-flight entry.
- `[todo]` Player pure state reducers: user pause vs host stop vs focus loss vs PiP vs ended.
- `[todo]` DAR/SAR and resize-mode pure decisions extracted from native geometry where practical.
- `[todo]` Permission decision tests by Android API level.
- `[todo]` OTA/native-version compatibility policy tests if Stallion exposes a pure selector.

Test rule: test non-obvious logic, not implementation trivia. No snapshot suite for static styling.

### 15.2 Android/native automation

- `[todo]` Add a minimal instrumentation test for exported intent validation and installer path validation.
- `[todo]` Add a CI task that inspects final APK manifest version/permissions/cleartext state.
- `[todo]` Add automated ARM64 ELF and APK zip-alignment checks.
- `[todo]` Add dependency/license inventory output to release artifacts.
- `[todo]` Keep release signing failure test: absent upload credentials must fail unless
  the explicit local debug-signing opt-in is supplied.

### 15.3 Manual release matrix

Every release:

- `[todo]` clean install and upgrade over latest public version;
- `[todo]` first-run permission grant/deny/retry;
- `[todo]` local library load, folders, search, recents, deletion;
- `[todo]` playback, seek, pause/resume, rotate, subtitles, tracks, delay, rate, enhancement;
- `[todo]` manual and auto PiP on 16:9 and 2.39:1; resize without dragging afterward;
- `[todo]` navigate away then Home: no PiP leak;
- `[todo]` MainActivity and external-open Activity;
- `[todo]` notification/lockscreen/headset/Bluetooth controls;
- `[todo]` background behavior according to the currently advertised support level;
- `[todo]` APK update check/download/hash/install and unknown-sources flow;
- `[todo]` Stallion update/restart/rollback if enabled;
- `[todo]` airplane mode, slow network, API timeout, and cancellation;
- `[todo]` no production secret visible in APK strings/resources/bundle;
- `[todo]` ARM64 16 KB device launch and media-feature smoke test.

When native/player code changes, additionally run Android 8/9 manual PiP, Android
12+ auto-enter, Android 15/16 behavior, portrait/rotated/SAR media, AC3/EAC3/HEVC,
HTTP/HTTPS/RTSP, audio focus, calls, screen lock, and process pressure.

## 16. Release checklist — no exceptions

- `[todo]` All R0/R1 items relevant to the release are `[done]`.
- `[todo]` Working tree and staged changes are understood; no user work is overwritten.
- `[todo]` Version/tag/changelog/versionCode/build number agree.
- `[todo]` CI uses the expected commit and release signing key.
- `[todo]` TypeScript, zero-warning ESLint, Jest, Android build, and required native checks pass.
- `[todo]` Dependency audit and accepted risks are recorded.
- `[todo]` APKs contain only intended ABIs and pass signature/hash/zipalign/ELF checks.
- `[todo]` Upgrade installs over the latest public APK and app data remains intact.
- `[todo]` Manual matrix is signed off with device/API versions.
- `[todo]` Release is created only after assets are ready.
- `[todo]` `/releases/latest` returns the intended production release, never a develop build.
- `[todo]` In-app updater selects the correct asset on ARM and ARM64.
- `[todo]` Stallion production channel targets the correct native version.
- `[todo]` Rollback owner and previous known-good release are recorded.
- `[todo]` Post-release smoke test downloads through the same public URLs users receive.

## 17. Documentation and ownership cleanup

- `[todo]` After this tracker is reviewed, add a short banner to the three older docs
  pointing here, or move them to `docs/archive/`. Do not maintain four active plans.
- `[todo]` Update README architecture, supported platforms, permissions, update channels,
  background-play support level, network-stream security, and Groq availability.
- `[todo]` Add a release runbook containing external actions that an agent must never
  perform implicitly: credential revocation, workflow cancellation, release publication,
  release deletion, Stallion promotion, and rollback.
- `[todo]` Assign an owner for releases, credentials/provider abuse, Android player,
  OTA, and privacy disclosures—even if all roles currently name the same person.
- `[todo]` Record completion commits beside each tracker item. Periodically remove
  completed implementation detail into a concise changelog so the active list stays usable.

## 18. Explicit do-nots

- Do not rotate Groq and embed the replacement key in another APK.
- Do not publish from ordinary `main` or `develop` pushes.
- Do not rebuild a public SemVer in place; bump the patch version.
- Do not raise target SDK to 35/36 while advertising Activity-owned background playback.
- Do not re-add `POST_NOTIFICATIONS` solely for a media-session notification.
- Do not request image/audio/location media permissions for a video-only library.
- Do not remove the native PiP bounds override while Fabric remains paused in PiP.
- Do not call event-driven AppState reconciliation “polling” or replace ten-line relays
  with a larger registry without a bug.
- Do not delete `createCoalescedRequest` while its concurrent consumers remain untested.
- Do not migrate to LibVLC 4 EAP.
- Do not mix FFmpegKitNext wrappers with FFmpegKit 6 binaries.
- Do not combine RN, background-service, geometry, and FFmpeg migrations in one commit.
- Do not update every dependency to latest independently.
- Do not split large files merely to improve line counts.
- Do not treat CI secret storage as mobile secret storage.
- Do not claim iOS support without an iOS build/device matrix.

## 19. Intended execution order

1. **R0:** stop accidental publication; contain Groq and inventory releases.
2. **R1:** release/version contract; notification/media permissions; updater/security fixes.
3. **P1:** geometry/lifecycle/audio event rebuild.
4. **P1:** foreground playback service or remove the production background-play claim.
5. **P2:** coordinated RN 0.87/AGP 9/Kotlin 2.2/SDK migration.
6. **P2:** LibVLC 3.7.5 and focused FFmpeg wrapper repair; full FFmpegKitNext separately.
7. **P2/P3:** dependency/dead-code/config cleanup.
8. **P2:** iOS completion or explicit Android-only reduction.
9. **P3:** finish tests, zero-warning CI, documentation, and recurring release checks.

Security/release containment can interrupt this order. Otherwise, do not start a later
phase merely because it is more interesting than the current exit criteria.

## 20. Primary references checked

- React Native 0.87 release and requirements:
  <https://reactnative.dev/blog/2026/08/11/react-native-0.87>
- React Native support policy/status:
  <https://reactnative.dev/releases/overview>
- Android PiP lifecycle:
  <https://developer.android.com/develop/ui/views/picture-in-picture>
- Android notification permission and media-session exemption:
  <https://developer.android.com/develop/ui/compose/notifications/notification-permission>
- Android Media3 background playback:
  <https://developer.android.com/media/media3/session/background-playback>
- Android audio focus, including target API 35 behavior:
  <https://developer.android.com/media/optimize/audio-focus>
- Android shared-media permissions:
  <https://developer.android.com/training/data-storage/shared/media>
- Android 14 selected photo/video access:
  <https://developer.android.com/about/versions/14/changes/partial-photo-video-access>
- Android cleartext risk and network security config:
  <https://developer.android.com/privacy-and-security/risks/cleartext-communications>
- Android app versioning:
  <https://developer.android.com/studio/publish/versioning>
- Android unknown-source install APIs:
  <https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()>
  and <https://developer.android.com/reference/android/provider/Settings#ACTION_MANAGE_UNKNOWN_APP_SOURCES>
- Android 16 KB page-size guidance and zipalign:
  <https://developer.android.com/guide/practices/page-sizes> and
  <https://developer.android.com/tools/zipalign>
- Media3 releases:
  <https://developer.android.com/jetpack/androidx/releases/media3>
- FFmpegKitNext:
  <https://github.com/arthenica/ffmpeg-kit-next>
- RN built-in edge-to-edge migration note:
  <https://github.com/zoontek/react-native-edge-to-edge>
- `react-native-config` packaged-value warning:
  <https://github.com/react-native-config/react-native-config/blob/master/README.md>
- Groq production key guidance:
  <https://console.groq.com/docs/production-readiness/security-onboarding>
- Stallion production rollout/rollback guidance:
  <https://stalliontech.io/learn/docs/sdk/production-usage>
