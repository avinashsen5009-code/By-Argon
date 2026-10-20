import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.recipestudio.video',
  appName: 'Recipe Studio',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    VideoSink: {
      chunkSize: 1048576,
    },
  },
};

export default config;
