// Image generation provider shape. Returns saved file paths inside
// /data/workspace/generated/ that the agent can hand to send_image.

export interface GenerateImageInput {
  prompt: string;
  /** "1024x1024" | "1024x1792" | "1792x1024" | "auto". Provider-specific. */
  size?: string;
  /** Aspect ratio shorthand. Used by FLUX (Replicate/fal). e.g. "1:1", "16:9". */
  aspect_ratio?: string;
  /** How many images to generate. Default 1, max 4. */
  n?: number;
  /** Provider-specific model override. */
  model?: string;
}

export interface GenerateImageOutput {
  files: Array<{
    filePath: string;
    bytes: number;
    model: string;
  }>;
}
