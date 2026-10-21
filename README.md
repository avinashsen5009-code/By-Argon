# Recipe Studio (`app.recipestudio.video`)

**Recipe Studio** is a complete, offline-first Android and web application that turns timestamped voiceover transcripts and **RECIPE v3.1** JSON documents into deterministic, frame-accurate motion-graphics videos up to 5 minutes and longer.

## Workflow
1. **Transcript & Prompt (M10 & M11)**: Paste a word-timestamped or sentence transcript (Whisper JSON, JSON segments, SRT, VTT, or timestamped plain text) and optional voiceover audio. Adjust audio offset (`-0.25s`, `-0.05s`, `+0.05s`, `+0.25s`), inspect or edit word timestamps, and choose canvas aspect (`16:9`, `9:16`, `1:1`), frame rate (`24`, `30`, or `60` fps), visual style pack (`neon`, `light`, `paper`, `comic`, `retro`, or custom), and palette (`1–5` or custom hex with live token swatch preview). Tap **Copy Prompt** to copy the exact SPEC Part A prompt pack + `INPUT` block.
2. **Paste, Auto-Repair & Validate Recipe JSON (M12)**: Paste the AI's JSON response into the app. Recipe Studio automatically repairs common LLM formatting issues (markdown fences, trailing commas, smart quotes, truncated JSON detection with continuation prompt), validates every layer against the 9-stage RECIPE v3.1 validator (including active style pack contrast, no-glow policy, and font width checks), and generates a snippet-trimmed **Copy Fix Prompt** (Part B) if any errors remain. If only unknown vocabulary names exist, **Play Lenient Preview** renders with safe fallback defaults.
3. **Long Videos & Targeted Re-Prompting (M11)**: Videos over 45 seconds are automatically split into 30–40 second parts at sentence boundaries. Each part carries forward persistent layers (`carry.persist`) and recent scene constructions (`carry.last`), then merges into a single continuous master timeline. Includes **Change Scene N** and **Tap-to-Select Layer Change Note** helpers.
4. **Deterministic Stage Preview & Instant Restyle (M8, M9, M13 & v3.2)**: Scrub frame-accurately using the custom touch timeline bar (`TouchTimelineBar`, zero `<input type="range">` sliders) and frame steppers (`-10f`, `-1f`, `+1f`, `+10f`), toggle Safe Area (`2.5%` margin), Layer Bounds, Captions, Loop Scene, live Frame-Time Meter (`ms/frame` + top 3 heaviest layers), and tap **Style** in the toolbar to re-render the entire video in another visual style pack with zero AI calls.
5. **Offline WebCodecs Export (M14 & M15)**: Export offline to MP4 (`H.264 + AAC` via WebCodecs & `mp4-muxer`) or WebM (`VP9` or transparent `VP9 + alpha` via `webm-muxer`) through a random-access `StreamingSink` (native Android `RandomAccessFile` plugin, OPFS, or growable chunked buffer), followed by post-export `<video>` metadata duration verification.
6. **IndexedDB Storage & `.recipestudio` Backup (M17)**: Persists `projects`, `transcripts`, `parts`, `assets`, `audio`, `exports`, `meta`, and custom `stylepacks` in IndexedDB with debounced autosave, plus single-file `.recipestudio` ZIP archive export/import (`project.json` + binary asset/audio blobs).

## Styles (Style Packs — Recipe v3.2)

### What Style Packs Are
A **Style Pack** is a declarative JSON/TypeScript configuration that controls how Recipe Studio turns abstract semantic tokens (`@bg`, `@acc`, `@ink`, `@cardHi`, etc.) and the five surface tokens (`card`, `hero`, `disc`, `hdisc`, `warnp`) into pixels and motion:
- **5 Built-In Style Packs**:
  - `neon` (**Neon Glass** · dark mode): Dark glass cards with bevel and light sweep, neon accent glow, Sora 800 + Inter 700 typography, smooth camera drift. Byte-for-byte identical to legacy v3.1 when `theme.style` is omitted or `"neon"`.
  - `light` (**Light Clean** · light mode): Airy white cards, thin borders, soft tinted shadows (`glow: "soften"`), Sora 800 + Inter 700, calm overshoot (`0.7`) and gentle camera (`0.6`).
  - `paper` (**Paper Cutout** · light mode): Warm cut-paper surfaces with procedural bilinear value-noise grain (`paper` texture), hard offset drop shadows, deterministic stop-motion time quantisation (`12 fps`), and synchronized edge wobble (`wobble: 2.5, boil: 8`), paired with Baloo 2 800 + Nunito 800.
  - `comic` (**Comic Pop** · light mode): Thick `#111111` ink outlines (`5 px`), solid black hard offset shadows (`+8, +8`), 45° halftone dot grids, uppercase Bangers 400 display headlines with `6 px` outlines, snappy overshoot (`1.5`), and deterministic camera `slamShake`.
  - `retro` (**Retro Terminal** · dark mode): CRT phosphor scanlines, square corners (`4 px`), uppercase JetBrains Mono 800/700 typography with a blinking block cursor after `typeOn` entrances, `glitch` default exits, and subtle CRT flicker + chromatic aberration.

### How to Switch Styles & Restyle Without a New AI Call
- **During Prompt Setup (`02. Prompt`)**: Scroll the horizontal **Visual Style Pack & Theme Palette** picker row to select any built-in or custom pack and one of its 5 accent swatches (or a custom `#RRGGBB` hex). The generated prompt automatically includes `STYLE: <id> (<name>)` and `STYLE GUIDE:` lines so the AI writes a recipe tailored to that style.
- **Instant Restyle (`04. Stage Preview`)**: Tap the **Style** button in the preview stage toolbar to open the Restyle sheet. Selecting a new style updates only `theme.style` / `palette` / `hex` and `project.styleId` — never touching scenes, layers, timings, or component definitions — and immediately recompiles, re-renders the current frame, and re-runs the validator with **no AI call and no network request**. If font metric changes introduce new warnings, a non-blocking banner (`"N new warnings — open Doctor"`) appears alongside an 8-second **Undo** button.

### How to Import, Export, or Create a Custom Pack
1. Tap **Projects** (top right) or **Styles (`<active>`)** in the project bar and select the **Styles** tab.
2. Tap **Copy Style Pack Maker Prompt** to copy `src/assets/style-pack-maker.txt` and paste it into any LLM with a 1–2 sentence description of your desired look.
3. Paste the returned JSON into **Import Custom Style Pack (JSON)** (or pick a `.json` file) and tap **Validate & Import Pack**.
4. `validateStylePack` checks all required fields, bundled OFL font families, numeric ranges, and WCAG 2.1 contrast ratios across all 5 accents. If any check fails, tapping an error in the list highlights the offending JSON path in the editor.
5. Valid custom packs are stored in the IndexedDB `stylepacks` store and embedded into `project.embeddedStylePack` so projects using custom styles open seamlessly on another device (prompting `"This project uses the custom style X. Save it to Styles?"`).

### How to Add a Sixth Built-In Pack (One File + One Register Call)
1. Create `src/core/styles/<id>.ts` exporting a `StylePack` constant (e.g., `export const MY_PACK: StylePack = { id: 'my-pack', ... }`).
2. Import `MY_PACK` in `src/core/styles/index.ts` and append it to `BUILT_IN_STYLE_PACKS` (and `BUILT_IN_STYLE_IDS` in `src/core/styles.ts`, which automatically calls `registerStylePack(pack)` at startup).

## Measured Performance Benchmarks
| Target | Requirement | Measured Result | Notes & Mitigations |
| :--- | :--- | :--- | :--- |
| **300 KB Recipe Validation** | `< 400 ms` | **~67.2 ms** (318 KB, 280 scenes, 1,680 layers) | Single-pass ID collection + linear interval sweep |
| **60-Layer Compile Time with Style Pack** | `<= neon + 10 ms` | **`neon`: 2.56 ms · `light`: 4.09 ms · `paper`: 3.62 ms · `comic`: 3.90 ms · `retro`: 2.71 ms** (`max Δ = +1.53 ms`) | Memoised token resolution (`resolveTokens`) + compile-time macro expansion |
| **Per-Frame Cost by Style Pack (`surface-zoo`)** | `paper <= 1.6×` · `comic <= 1.3×` · `retro <= 1.4×` `neon` | **`paper`: 1.22× · `comic`: 0.91× · `retro`: 1.18× `neon`** | 300-entry wobbled `Path2D` LRU cache, cached procedural texture tiles, and static backdrop buffer cache |
| **Style Picker Open Latency** | `< 300 ms` cached · `< 1.2 s` cold | **0.67 ms warm cached · 154.23 ms cold** | Lazy per-card mini-render with in-memory + IndexedDB (`mini:{packId}:{palette}:{packVersionHash}`) caching |
| **Added Font / APK Asset Size** | `< ~6 MB` | **+280,484 bytes (+273.9 KB)** across 10 subsetted `.woff2` files + `OFL.txt` | Subsetted SIL OFL 1.1 `.woff2` faces (`Baloo 2`, `Nunito`, `Bangers`, `Comic Neue`, `Kalam`, `JetBrains Mono`, `VT323`, `Poppins`) |

## Development, Testing & APK Build
```bash
npm install
npm run dev                        # Start Vite dev server on port 3000
npm run build                      # Build production bundle to dist/
npm test                           # Run all unit, golden PNG & style-pack test suites
```
