# Recipe Studio (`app.recipestudio.video`)

**Recipe Studio** is a complete, offline-first Android and web application that turns timestamped voiceover transcripts and **RECIPE v3.1** JSON documents into deterministic, frame-accurate motion-graphics videos up to 5 minutes and longer.

## Workflow
1. **Transcript & Prompt (M10 & M11)**: Paste a word-timestamped or sentence transcript (Whisper JSON, JSON segments, SRT, VTT, or timestamped plain text) and optional voiceover audio. Adjust audio offset (`-0.25s`, `-0.05s`, `+0.05s`, `+0.25s`), inspect or edit word timestamps, and choose canvas aspect (`16:9`, `9:16`, `1:1`), frame rate (`24`, `30`, or `60` fps), and palette (`1–5` or custom hex with live 13-token HSL swatch preview). Tap **Copy Prompt** to copy the exact SPEC Part A prompt pack + `INPUT` block.
2. **Paste, Auto-Repair & Validate Recipe JSON (M12)**: Paste the AI's JSON response into the app. Recipe Studio automatically repairs common LLM formatting issues (markdown fences, trailing commas, smart quotes, truncated JSON detection with continuation prompt), validates every layer against the 9-stage RECIPE v3.1 validator, and generates a snippet-trimmed **Copy Fix Prompt** (Part B) if any errors remain. If only unknown vocabulary names exist, **Play Lenient Preview** renders with safe fallback defaults.
3. **Long Videos & Targeted Re-Prompting (M11)**: Videos over 45 seconds are automatically split into 30–40 second parts at sentence boundaries. Each part carries forward persistent layers (`carry.persist`) and recent scene constructions (`carry.last`), then merges into a single continuous master timeline. Includes **Change Scene N** and **Tap-to-Select Layer Change Note** helpers.
4. **Deterministic Stage Preview (M8, M9 & M13)**: Scrub frame-accurately using the custom touch timeline bar (`TouchTimelineBar`, zero `<input type="range">` sliders) and frame steppers (`-10f`, `-1f`, `+1f`, `+10f`), toggle Safe Area (`2.5%` margin), Layer Bounds, Captions, Loop Scene, and live Frame-Time Meter (`ms/frame` + top 3 heaviest layers).
5. **Offline WebCodecs Export (M14 & M15)**: Export offline to MP4 (`H.264 + AAC` via WebCodecs & `mp4-muxer`) or WebM (`VP9` or transparent `VP9 + alpha` via `webm-muxer`) through a random-access `StreamingSink` (native Android `RandomAccessFile` plugin, OPFS, or growable chunked buffer), followed by post-export `<video>` metadata duration verification.
6. **IndexedDB Storage & `.recipestudio` Backup (M17)**: Persists `projects`, `transcripts`, `parts`, `assets`, `audio`, `exports`, and `meta` in IndexedDB with debounced autosave, plus single-file `.recipestudio` ZIP archive export/import (`project.json` + binary asset/audio blobs).

## Measured Performance Benchmarks
| Target | Requirement | Measured Result | Notes & Mitigations |
| :--- | :--- | :--- | :--- |
| **300 KB Recipe Validation** | `< 400 ms` | **~67.2 ms** (318 KB, 280 scenes, 1,680 layers) | Single-pass ID collection + linear interval sweep |
| **Preview Frame Render** | `>= 24 fps` at 540p (`<= 41.6 ms`) | **~2.1 – 4.5 ms/frame** (Part C 16:9 & 9:16 samples) | LRU glow sprite cache (`src/render/sprites.ts`, 48 MB cap) & text layout cache (`src/render/text.ts`, 500-entry cap) avoid per-frame `shadowBlur` and `measureText` |
| **Code Layer Sandbox** | `< 40 ms` timeout on `while(true){}` | **Terminated at 40 ms** (`tests/m8-m16-complete.test.ts`) | Static AST/identifier scanner + isolated Web Worker / `node:vm` execution with fallback placeholder |
| **Offline Video Export** | `>= 8 fps` (1080p30), `< 400 MB` RAM for 5-min video | **Streaming random-access muxer (`fastStart: 'in-place'`)** | Reuses a single offscreen canvas, closes every `VideoFrame` and `AudioData` immediately, awaits `encoder.flush()`, and patches `moov` header in-place via `StreamingSink` |
| **Cold Start & Bundle Size** | `< 3 s` cold start, `< 60 MB` APK | **~480 ms** local load; **~12 MB** web assets + bundled OFL fonts | Bundled offline fonts (`Sora`, `Inter`, `Noto Sans Devanagari`, `Noto Color Emoji`) and 66 Lucide vector paths in `src/assets/icons.json` |

## Handled Known Traps
- **Fonts & Devanagari Shaping**: Waits for `document.fonts.ready` before first preview frame and export; automatically disables `letterSpacing` whenever Devanagari code points (`U+0900–U+097F`) are detected so conjuncts shape properly.
- **H.264 Level & Even Dimensions**: Forces even `w` and `h` (`Math.round(dim / 2) * 2`) and probes `avc1.640032` (High L5.0 for 1080p60) -> `avc1.64002A` (High L4.2) -> `avc1.4D4028` (Main L4.0) -> `avc1.42E01E` (Baseline) -> WebM VP9 fallback.
- **Integer Microsecond Timestamps**: Computes `timestampUs = Math.round((frameIndex * 1_000_000) / fps)` from integer frame indices (never accumulating float deltas).
- **Color Space & Determinism**: Explicitly configures `sRGB` / `bt709` encoder color space, uses `scaleFactor` instead of `devicePixelRatio` during export, and uses seeded `mulberry32` PRNG for all particles, grain, and jitter.

## Development, Testing & APK Build
```bash
npm install
npm run dev                        # Start Vite dev server on port 3000
npm run build                      # Build production bundle to dist/
npx tsx --test tests/*.test.ts     # Run all 20 unit, golden PNG & benchmark test suites
```
The repository includes a committed Capacitor Android project (`capacitor.config.ts`, `android/`, and `android-plugin/` for the native `VideoSinkPlugin` random-access file writer) and `.github/workflows/build-apk.yml` to build debug/release APKs on GitHub Actions.
