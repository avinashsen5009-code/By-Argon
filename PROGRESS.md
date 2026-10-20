# Recipe Studio — Build Progress

- [x] M0. Extract `src/assets/prompt-pack.txt` (exact SPEC Part A text) and `samples/part-c-demo.json`
- [x] M0. Bundle OFL fonts (`Sora`, `Inter`, `Noto Sans Devanagari`, `Noto Color Emoji`) and 66 Lucide icons (`src/assets/icons.json`)
- [x] M1. Core types (`src/core/types.ts`) and scene compiler (`src/core/layout.ts`)
- [x] M2. Anchor time resolver and frame clock (`src/core/time.ts`)
- [x] M3. Extensible Registry Pattern (`src/core/registry.ts`, `src/core/vocab.ts`)
- [x] M4. Easings, Keyframes, and Pure Expression Evaluator (`src/core/ease.ts`, `src/core/keyframes.ts`, `src/core/expr.ts`)
- [x] M5. Motion Macros (`src/core/macros.ts`)
- [x] M6. Theme Palettes 1–5, Custom Hex HSL Expansion & Style Tokens (`src/core/palette.ts`, `src/core/styles.ts`)
- [x] M7. All 16 Built-in Components & Custom `defs` (`src/core/components/index.ts`)
- [x] M8. 9-Stage Validator, Auto-Repair & Part B Fix Prompt (`src/core/validate.ts`, `src/core/repair.ts`)
- [x] M9. Transcript Parser, Prompt Builder, Part Splitter & Multi-Part Merger (`src/core/transcript.ts`, `src/core/promptbuilder.ts`, `src/core/parts.ts`, `src/core/merge.ts`)
- [x] M10. Pure Deterministic Canvas 2D Renderer (`src/render/*`)
- [x] M11. Offline WebCodecs MP4/WebM Exporter & Native Sink Bridge (`src/export/*`, `src/native/bridge.ts`)
- [x] M12. IndexedDB Project & Part Persistence (`src/store/db.ts`, `src/store/projects.ts`)
- [x] M13. Mobile-First Touch UI (Zero Sliders, 48dp Targets, Custom Touch Timeline) (`src/ui/*`)
- [x] M14. Capacitor Android Project, Kotlin `VideoSinkPlugin` & GitHub Actions APK Workflow (`capacitor.config.ts`, `android/`, `android-plugin/`, `.github/workflows/build-apk.yml`)
- [x] M15. Unit Test Suite & Browser Verification
