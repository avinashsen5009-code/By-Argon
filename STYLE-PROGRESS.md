# STYLE-PROGRESS.md — Style Packs (Recipe v3.2) Progress & Metrics

## Milestone Status

- [x] **S0** Discovery (`STYLE-PLAN.md`), determinism audit, baseline neon goldens + macro-track snapshots, `tests/samples/surface-zoo.json`. *Gate: goldens reproducible twice in a row.*
- [x] **S1** Types, registry, `resolveTokens`, `checkContrast`, the five pack files, legacy shim. Tests 1–5 & 20. *Gate: neon goldens still green.*
- [x] **S2** Extract `drawSurface` from the existing code with neon's values, route every surface and every component through it. *Gate: neon goldens byte-identical.*
- [x] **S3** Renderer hooks: textures, edge wobble, default stroke, corner policy, glow policy, text case/outline/shadow/letterSpacing/cursor, backgrounds, post. Wire all five packs. Tests 10–15.
- [x] **S4** Motion modifiers in the macro/preset expander + camera scaling + slam shake. Tests 6–7.
- [x] **S5** Fonts bundled, subsetted, lazy-loaded per pack; export font gate. Test 19.
- [x] **S6** Validator additions + `validateStylePack` + custom pack storage + embedded pack on project open. Tests 8–9, 16, 18.
- [x] **S7** Prompt-pack asset patch + prompt builder + fix/scene prompts + `src/assets/style-pack-maker.txt`. Test 17.
- [x] **S8** UI: style picker with mini renders, Restyle sheet & Undo banner, Settings → Styles, Dev Preview row. Test 23.
- [x] **S9** Hardening: performance pass (Tests 21–24), new samples (`samples/part-c-comic.json`, `samples/part-c-paper.json`, `samples/vertical-retro.json`), README section, final acceptance run.

## Measured Performance & Size Metrics (§13 Items 21–24)

| Metric | Target Budget | Measured Value | Status |
| :--- | :--- | :--- | :--- |
| **21. Compile Time (60-layer scene)** | `<= neon + 10 ms` | `neon`: **2.56 ms** · `light`: **4.09 ms** (+1.53 ms) · `paper`: **3.62 ms** (+1.06 ms) · `comic`: **3.90 ms** (+1.34 ms) · `retro`: **2.71 ms** (+0.15 ms) | PASS |
| **22. Per-Frame Render Cost (`surface-zoo` warm)** | `paper <= 1.6×` · `comic <= 1.3×` · `retro <= 1.4×` `neon` | `paper`: **1.22×** · `comic`: **0.91×** · `retro`: **1.18×** `neon` | PASS |
| **23. Style Picker Open Time (5 mini-renders)** | `< 300 ms` cached · `< 1.2 s` cold | **0.67 ms** cached · **154.23 ms** cold | PASS |
| **24. Added Font / APK Asset Size** | `< ~6 MB` | **280,484 bytes (273.9 KB)** across 10 subsetted `.woff2` files + `OFL.txt` | PASS |

### Added Subsetted `.woff2` Font Breakdown (`public/fonts/` & `src/assets/fonts/`)
- `Baloo2-800.woff2`: `53,840` bytes (`latin, latin-ext, devanagari`)
- `Nunito-800.woff2`: `24,336` bytes (`latin, latin-ext`)
- `Bangers-400.woff2`: `14,860` bytes (`latin, latin-ext`)
- `ComicNeue-700.woff2`: `24,348` bytes (`latin, latin-ext`)
- `Kalam-700.woff2`: `53,884` bytes (`devanagari, latin`)
- `JetBrainsMono-700.woff2`: `27,696` bytes (`latin, latin-ext`)
- `JetBrainsMono-800.woff2`: `27,672` bytes (`latin, latin-ext`)
- `VT323-400.woff2`: `23,868` bytes (`latin`)
- `Poppins-700.woff2`: `15,120` bytes (`latin, latin-ext`)
- `Poppins-800.woff2`: `14,860` bytes (`latin, latin-ext`)
- **Total Added Font Bytes**: **`280,484` bytes (`273.9 KB`)**

## Appendix B — Invariant Checklist (Verified at Every Milestone S0–S9)

- [x] `recipe` id is still `"v3.1"`; no document is migrated on disk.
- [x] Every existing validator rule, message and severity is unchanged.
- [x] Every existing macro's numeric behaviour under neon is unchanged.
- [x] Every existing component's geometry is unchanged in all packs (only paint changes).
- [x] Layout grid, safe-area logic, beat-gap check: untouched.
- [x] The export pipeline, muxer, native plugin, foreground service, MediaStore path: untouched.
- [x] The part orchestrator, carry/persist/patch, merge: untouched.
- [x] The transcript importer: untouched.
- [x] No new runtime network calls. No new permissions.
- [x] Neon baseline goldens: byte-identical.
