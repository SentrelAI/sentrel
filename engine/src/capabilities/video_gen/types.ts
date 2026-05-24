export interface GenerateVideoInput {
  prompt: string;
  /** Seconds, provider may clamp to the closest supported value. */
  duration?: number;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  /** Optional reference image (workspace path or URL) for image-to-video. */
  image?: string;
  model?: string;
}

export interface GenerateVideoOutput {
  filePath: string;
  bytes: number;
  model: string;
  /** Provider-reported duration of the produced clip. */
  durationSeconds?: number;
}
