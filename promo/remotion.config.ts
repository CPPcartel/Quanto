import { Config } from "@remotion/cli/config";

/**
 * The city is drawn as many small absolutely-positioned divs with blur and
 * blend modes stacked over them. JPEG banding shows badly in the sky gradient
 * and the glow falloff, so frames are handed to the encoder as PNG.
 */
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
