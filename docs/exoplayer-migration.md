# ExoPlayer migration and the FFmpeg build

**Created:** 2026-09-06
**Status:** planning. No migration code written yet.
**Decision recorded in:** master tracker section 11.6.

This document plans the replacement of LibVLC with Media3/ExoPlayer, and the FFmpeg work
that has to land first. It exists because the tracker section would otherwise double in
size; section 11.6 remains the decision of record and this is the detail behind it.

Everything below rests on device measurements taken 2026-09-06, not on reasoning. Where a
claim is unverified it says so.

---

## 1. Why, in one paragraph

LibVLC 3.x cannot render HDR on Android 16: its `gles2` vout opens at 8-bit `I420` and
swscales 10-bit away, and `android_display` never tags the surface as BT.2020/PQ. ExoPlayer
plays the same file on the same device with `colorSpace=6` (BT.2020) and `colorTransfer=6`
(ST2084), correct on screen. It also parses embedded subtitles natively and instantly,
against 1.5-3.0 s per track through the current `ffmpeg-kit` extraction path, and it can
apply colour adjustment as GPU shaders without giving up hardware decoding — which is what
the current enhancement feature does, catastrophically. Removing LibVLC also removes
`libvlc.so`: **43 MB, 53% of the APK**.

## 2. Two FFmpeg builds, deliberately

It is tempting to unify these. Do not. They have opposite shapes and the "one FFmpeg"
instinct produces a worse result than keeping both.

| | Media3 decoder extension (**new**) | `ffmpeg-kit-https` (**existing**) |
|---|---|---|
| Purpose | audio **decoding** during playback | **extraction** — subtitles, audio, thumbnails |
| Needs demuxers | no | yes |
| Build flags | `--disable-everything --disable-avformat`, decoders only | full `avformat` |
| Consumer | `libffmpegJN.so`, linked by ExoPlayer | JS via `react-native-ffmpeg-kit` |
| Size | small — decoders and `swresample` only | ~2.5 MB of `libav*` |

The Media3 extension explicitly **disables `avformat`**, so it cannot demux anything and
cannot serve extraction. Conversely `ffmpeg-kit` cannot be handed to ExoPlayer as a decoder
without writing the JNI bridge that the extension already is. Sharing one shared-library
FFmpeg between them is possible but means abandoning `--disable-everything`, hand-porting
`build_ffmpeg.sh`, and maintaining a fork — to save a couple of megabytes against the 43 MB
being removed. Revisit only if measurement shows the duplication is material.

### 2.1 Subtitle extraction stays — haptics depends on it

`useHapticFeedback` consumes `subtitleCues` (falling back to `hapticCues`), and
`ContextAnalyzer` reads cue *text* — `[Heavy breathing]` and similar — to choose a haptic
pattern. That needs the **entire cue list upfront**, with timings.

ExoPlayer's `Player.Listener.onCues()` streams cues for the *selected* track as playback
reaches them. That is the right shape for displaying subtitles and the wrong shape for
haptics, which looks ahead. So:

- **display** subtitles can move to ExoPlayer's cues and drop the 1.5-3.0 s extraction wait;
- **haptics** keeps the `ffmpeg-kit` extraction path for its pre-loaded cue list.

`[unverified]` Whether Media3's `SubtitleParser` / `CuesWithTiming` API can produce a full
cue list from a track without playing it. If it can, haptics could drop `ffmpeg-kit` too —
worth one spike before committing to keeping both paths.

## 3. The Media3 FFmpeg extension build

### 3.1 What it is

`build_ffmpeg.sh` in `libraries/decoder_ffmpeg` configures FFmpeg with
`--disable-everything`, re-enables only the decoders named in `ENABLED_DECODERS`, plus
`--enable-swresample`, and builds `--enable-static --disable-shared` for `armeabi-v7a`,
`arm64-v8a`, `x86` and `x86_64`. Gradle then compiles `libffmpegJN.so` against those.

### 3.2 Decoders to enable

    ENABLED_DECODERS=(ac3 eac3 dca mlp truehd)

Justified by device measurement, not guesswork: `/vendor/etc/media_codecs*.xml` on the test
device (Nothing AIN065, Android 16) declares **no** `ac3`, `eac3`, `ac4`, `dts` or `truehd`
decoder — the full audio list is 3gpp, alac, amr-wb, amr-wb-plus, dsd, evrc, flac, g711,
gsm, mp4a-latm, mpeg, opus, qcelp, raw, vorbis, x-ape, x-ms-wma. A DUAL E-AC-3 file reports
`SUPPORTED=false SELECTED=false` on both audio tracks and **plays silently with no error**.

Do **not** add `aac`, `mp3`, `flac`, `vorbis`, `opus` — the device has all of those in
hardware, and duplicating them costs size for nothing.

`ac4` is not in FFmpeg. Dolby AC-4 stays unsupported; it is rare outside broadcast.

### 3.3 Licensing

The script does **not** pass `--enable-gpl`, so the build is LGPL. Every decoder above
(`ac3`, `eac3`, `dca`, `mlp`, `truehd`) is a native FFmpeg decoder under LGPL — no GPL
component is pulled in, and no `--enable-nonfree`.

`[todo]` **LGPL linking — this one is a real change.** Extracted from the shipped
`ffmpeg-kit-minimal.aar`, today's build is `--disable-static`: FFmpeg ships as separate
`libavcodec.so`, `libavformat.so` and friends. A user can replace those, which is what LGPL
asks for, so the app is already in the compliant shape without anyone having had to think
about it.

Media3's extension links FFmpeg **statically** into `libffmpegJN.so`, fusing LGPL code into a
binary that cannot be swapped. That moves the app from "compliant by construction" to "owes a
relink path". Options, in order of preference:

1. modify `build_ffmpeg.sh` to emit shared libraries and link `libffmpegJN.so` against them,
   matching what the app already does;
2. publish the object files and exact build inputs so a third party could relink;
3. accept the risk, which is what most apps shipping this extension do.

Tracker 11.3 already carries "review LGPL/GPL configuration, source-offer/notice
obligations"; this is that item, now concrete.

### 3.4 Patents — posture unchanged

AC-3/E-AC-3, DTS and TrueHD are patent-encumbered, and a software decoder is a different
posture from calling a hardware decoder the OEM licensed. But this app **already ships
software decoders for all four**. From the configure line embedded in the shipped
`libavutil.so`:

    --enable-decoder='aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,
                      pcm_s32le,alac,dts,truehd,wmav1,wmav2'

Adding them to the Media3 extension therefore changes nothing about the app's exposure. It
does not improve it either. Recorded so this is not re-opened as a blocker later.

That configure line is also the best evidence for §3.2: it is this project's own prior
judgement about which decoders are worth shipping, and all four are on it.

## 4. CI: private repo, GitHub Actions

Yes, this works, and it is the right shape: the build is slow, needs Linux, and its output
is a versioned binary artifact.

### 4.1 Repository

A **private** repo, `glide-ffmpeg-decoder` or similar, containing only:

- a pinned Media3 version and FFmpeg version,
- the `ENABLED_DECODERS` list,
- the workflow,
- a short README stating why each decoder is enabled.

It must not vendor FFmpeg source; clone it at a pinned tag in CI so the build inputs are
reproducible and the repo stays small.

### 4.2 Workflow shape

    runs-on: ubuntu-latest        # build_ffmpeg.sh is not supported on Windows
    steps:
      - checkout this repo
      - checkout androidx/media at a pinned tag
      - install NDK r26b explicitly; do not rely on the runner's default
      - clone FFmpeg at release/6.0 (pinned; the extension recommends 6.0)
      - cache the FFmpeg build per (ffmpeg tag, ndk, decoder list) hash
      - run build_ffmpeg.sh with ENABLED_DECODERS
      - gradle :lib-decoder-ffmpeg:assembleRelease
      - publish the AAR

Trigger on `workflow_dispatch` and on tag. Not on push: this output is a dependency, and it
should change only when someone decides it changes.

The cache key matters. A cold FFmpeg build across four ABIs is slow; keying the cache on the
inputs makes ordinary runs fast while guaranteeing a real rebuild when a decoder is
added.

### 4.3 Getting the artifact into Glide

Preferred: **publish to GitHub Packages Maven** from the private repo, and consume it in
Glide with a read-only PAT. This keeps Glide's dependency declaration ordinary:

    implementation "com.glide:media3-decoder-ffmpeg:<version>"

Rejected: committing the AAR into Glide. Tracker 12.3 is actively trying to remove
`flatDir` and vendored AARs, and adding another one moves that backwards. The existing
`android/ffmpeg-lib/ffmpeg-kit-minimal.aar` is the pattern to stop repeating, not to copy.

`[todo]` Glide's release workflow will need the PAT as a secret, and the release job's
`.env` step must not log it. Note that a Maven credential is a *build-time* secret, unlike
the packaged values in section 3 — it never enters the APK.

### 4.4 Version pinning

Pin FFmpeg tag, NDK version, Media3 version and the decoder list, and put all four in the
artifact version string. A build whose inputs are not identifiable is not reproducible, and
tracker 4.1 already treats provenance as a release requirement.

## 5. Feature port matrix

| Feature | Today (LibVLC) | After | Risk |
|---|---|---|---|
| HDR10 / DV | broken | native | none — measured |
| Hardware decode | MediaCodec | MediaCodec | none |
| AC-3 / E-AC-3 / DTS / TrueHD | VLC's bundled FFmpeg | **FFmpeg extension** | **blocking** — silent without it |
| Resize modes | `setScale` / `setAspectRatio` | `AspectRatioFrameLayout` or custom layout | medium — section 8.1 rework |
| Zoom / pan | View transforms on SurfaceView | unchanged | none |
| Playback rate | `scaletempo` | `setPlaybackParameters` (Sonic, pitch-preserving) | low |
| Colour enhancement | `--video-filter=adjust` + `--no-mediacodec-dr` | `setVideoEffects` GPU shaders | low — and it fixes the defect |
| Equalizer | VLC 10-band | `android.media.audiofx.Equalizer` on the audio session id | medium |
| Audio delay | `--audio-desync` | custom `AudioProcessor`, or drop | medium |
| Subtitle delay | VLC SPU delay | offset in `SubtitleOverlay` | none — already ours |
| Text subtitles | ffmpeg-kit extraction | ExoPlayer cues | low, and much faster |
| Bitmap subtitles (PGS/VobSub) | VLC SPU | ExoPlayer PGS support | `[unverified]` |
| Haptic cues | ffmpeg-kit extraction | unchanged | none |
| Thumbnails | ffmpeg-kit | unchanged | none |
| Media session | `VlcMedia3Player` adapter | real `ExoPlayer` | **negative risk** — deletes ~170 lines and three known defects |
| PiP | Activity-level | unchanged | low |
| `.avi` | VLC | `AviExtractor` | low |
| `.wmv` / ASF | VLC | **dropped** | accepted |
| `rtmp://` | VLC | **dropped** | accepted |
| `rtsp://` | VLC | `media3-exoplayer-rtsp` | low |

## 5a. Verified 2026-09-06: the FFmpeg extension works

Built by the private repo, consumed as a local AAR, renderer registered with
`EXTENSION_RENDERER_MODE_ON`, same file and same activity as the failing measurement:

    ffmpeg extension available=true version=Lavc60.3.100
        eac3=true ac3=true dts=true truehd=true

    before:  track codec=audio/eac3 channels=6 SUPPORTED=false SELECTED=false   (silent)
    after:   track codec=audio/eac3 channels=6 SUPPORTED=true  SELECTED=true

`Lavc60.3.100` is libavcodec 60.3.100, i.e. FFmpeg 6.0 — the pin held. The AAR is 2.2 MB
across four ABIs; `libffmpegJNI.so` is **1.17 MB** in the arm64 APK, against `libvlc.so`
at 43 MB.

Steps 1 and 2 of the sequence below are therefore done. The blocking item is cleared and
the migration is unblocked.

## 6. Sequence

1. **FFmpeg extension in CI**, consumable from Glide. Nothing else can be verified without
   it, because audio is silent.
2. **Prove it**: the E-AC-3 file plays with sound through the spike activity. Same
   measurement as before, one field different.
3. **ExoPlayer behind a flag**, VLC still present and default. Port the surface, keeping the
   existing gesture/HUD layer.
4. **Port features** in the matrix order above, cheapest first.
5. **Run a real library through it** — the whole section 8.5 fixture matrix plus actual
   user content.
6. **Flip the default**, keep VLC one release as an escape hatch.
7. **Delete LibVLC** in its own commit, so the 43 MB drop is attributable and revertible.

Steps 6 and 7 are deliberately separate. "Delete 43 MB" and "prove the replacement works"
must not land together.

## 7. What would make this the wrong plan

Recorded now, while it is still cheap to change course:

- ExoPlayer cannot play a significant share of a real user library. Mitigated by step 5,
  which must use real content rather than fixtures.
- Bitmap subtitle support turns out to be worse than VLC's. `[unverified]`.
- The FFmpeg extension's decoders underperform the hardware ones badly enough to matter on
  low-end devices. Measure before assuming; software E-AC-3 is cheap, software DTS-HD less
  so.
- The LGPL relink obligation cannot be satisfied in a way the owner accepts.
