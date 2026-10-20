export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    androidScheme?: string;
  };
  plugins?: Record<string, Record<string, unknown>>;
}

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
