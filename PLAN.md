# Recipe Studio — Engineering Plan

## Architecture Overview
Recipe Studio (`app.recipestudio.video`) is an offline-first, deterministic motion-graphics studio and MP4 video exporter built for Android (via Capacitor 6+) and modern mobile/desktop browsers. It implements the authoritative **RECIPE v3.1** specification.

### Core Design Principles
1. **100% Offline & Self-Contained**: All fonts (`Sora`, `Inter`, `Noto Sans Devanagari`, `Noto Color Emoji`), 66 Lucide vector icons, prompt templates, and muxing libraries are bundled locally. Zero network calls at runtime.
2. **Pure Deterministic Rendering**: `renderFrame(ctx, compiledScene, t)` is a pure function of the compiled recipe and timestamp `t = frameIndex / fps`. All random effects (particles, blob wobble, wiggle, noise) use a deterministic seeded PRNG (`mulberry32`) and seeded value noise.
3. **Extensibility via Registries**: All vocabulary items (`layerType`, `shapeKind`, `icon`, `macro`, `component`, `fx`, `transition`, `chartKind`, `background`, `pose`, `enterPreset`, `exitPreset`, `easing`) are registered through `src/core/registry.ts` and exported as canonical lists in `src/core/vocab.ts`.
4. **Touch-First Ergonomics (Zero Sliders)**: All controls use 48dp minimum touch targets, steppers, segmented choices, and a custom canvas-backed touch timeline bar with frame-stepping (`-1f`, `+1f`) and scene jump pills.
5. **Long Video Part Orchestrator (5+ Minutes)**: Splits transcripts at sentence boundaries into 30–40s parts, generates part-specific prompts with `CARRY` state, validates and auto-repairs each part, and merges continuation shapes (`carry.persist`, `patch`) into a unified timeline.

## Module Breakdown
- **M1. Types & Compiler (`src/core/types.ts`, `src/core/layout.ts`)**: Full v3.1 AST and compiled scene graph with resolved anchors, expanded components/macros, flattened parent/group hierarchy, `z`-index sort, and `t0` interval index.
- **M2. Time & Anchors (`src/core/time.ts`)**: Resolves `wN`, `wNe`, `sN`, `sNe` with `+x`/`-x` offsets against global transcript indices; integer frame clock.
- **M3. Registries & Vocabulary (`src/core/registry.ts`, `src/core/vocab.ts`)**: Central registration and SPEC Part A vocabulary verification.
- **M4. Easings, Keyframes & Expressions (`src/core/ease.ts`, `src/core/keyframes.ts`, `src/core/expr.ts`)**: All 21 easings including cubic-bezier and spring physics, compact & array keyframe parser, and safe recursive-descent expression evaluator.
- **M5. Motion Macros (`src/core/macros.ts`)**: Pure macro-to-keyframe/delta evaluation for all 21 SPEC motion macros (`pop`, `slam`, `drop`, `slide`, `rise`, `bump`, `shake`, `grow`, `to`, `orbit`, `arc`, `hop`, `merge`, `burst`, `press`, `pulse`, `breathe`, `float`, `sway`, `wiggle`, `blink`).
- **M6. Theme Palettes & Styles (`src/core/palette.ts`, `src/core/styles.ts`)**: Palettes 1–5 and custom HSL hex expansion into `@token` colors and `card`/`hero`/`disc`/`hdisc`/`warnp` styles.
- **M7. Built-in Components (`src/core/components/index.ts`)**: Expansion of all 16 built-in components (`chip`, `disc`, `badge`, `stamp`, `button`, `cursor`, `meter`, `bubble`, `chat`, `phone`, `browser`, `toast`, `kpi`, `timeline`, `logo`, `photo`) and user `defs`.
- **M8. Validator & Auto-Repair (`src/core/validate.ts`, `src/core/repair.ts`)**: 9-stage structural, vocabulary, safe-area, beat-gap, and code-sandbox validator plus non-destructive JSON repair and Part B fix prompt generator.
- **M9. Transcript, Prompt Builder, Parts & Merge (`src/core/transcript.ts`, `src/core/promptbuilder.ts`, `src/core/parts.ts`, `src/core/merge.ts`)**: Multi-format transcript parser, 30–40s sentence splitter, prompt assembler, and multi-part merger.
- **M10. Deterministic Canvas 2D Renderer (`src/render/*`)**: Camera with parallax depth, scene transitions, text engine with shrink/wrap/plate/highlights/split-anim, 22 shapes, SVG paths with trim & morph, 66 icons, stick-figure rig with 17 poses, stateless particles, 9 chart kinds, 13 layer FX, and sandboxed `code` layers.
- **M11. Offline Exporter & Android Native Plugin (`src/export/*`, `src/native/bridge.ts`, `android-plugin/`)**: WebCodecs `VideoEncoder`/`AudioEncoder` + `mp4-muxer` / `webm-muxer`, segmented streaming sink, and Kotlin `VideoSinkPlugin` for Android.
