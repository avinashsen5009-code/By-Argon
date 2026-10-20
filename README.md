# Recipe Studio (`app.recipestudio.video`)

**Recipe Studio** is a complete, offline-first Android and web application that turns timestamped voiceover transcripts and **RECIPE v3.1** JSON documents into deterministic, frame-accurate motion-graphics videos up to 5 minutes and longer.

## Workflow
1. **Transcript & Prompt**: Paste a word-timestamped or sentence transcript (Whisper JSON, SRT, VTT, or timestamped text) and optional voiceover audio. Choose canvas aspect (`16:9` or `9:16`), frame rate (`30` or `60` fps), and palette (`1–5` or custom hex). Tap **Copy Prompt** to copy the complete SPEC Part A prompt pack + `INPUT` block.
2. **Paste & Validate Recipe JSON**: Paste the AI's JSON response into the app. Recipe Studio automatically repairs common formatting issues (markdown fences, trailing commas, default properties), validates every layer against the RECIPE v3.1 specification, and offers a 1-tap **Copy Fix Prompt** (Part B) if any errors remain.
3. **Long Videos (Part-by-Part Orchestrator)**: Videos over 45 seconds are automatically split into 30–40 second parts at sentence boundaries. Each part carries forward persistent layers (`carry.persist`) and recent scene constructions (`carry.last`), then merges into a single continuous video.
4. **Deterministic Stage Preview & Export**: Scrub frame-accurately using the custom touch timeline bar and frame steppers (`-1f`, `+1f`). Export offline to MP4 (H.264 + AAC via WebCodecs & `mp4-muxer`) or WebM (`VP9` via `webm-muxer`).

## Development & Build
```bash
npm install
npm run dev      # Start Vite dev server on port 3000
npm run build    # Build production web bundle to dist/
node --test      # Run unit test suite
```

## Android APK Build
The repository includes a committed Capacitor Android configuration (`capacitor.config.ts`, `android/`, and `android-plugin/` for the native `VideoSink` streaming file writer) and `.github/workflows/build-apk.yml` to build signed/debug APKs on GitHub Actions without Android Studio.
