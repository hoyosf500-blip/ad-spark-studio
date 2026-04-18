// Client-side frame extraction. 1 fps, max 1024x1820, JPEG q=0.92.
export type ExtractedFrame = {
  time: number;        // seconds (integer)
  dataUrl: string;     // image/jpeg;base64,...
  width: number;
  height: number;
};

const MAX_W = 768;
const MAX_H = 1366;
const QUALITY = 0.75;
const MAX_FRAMES = 12;

function fitWithin(srcW: number, srcH: number) {
  const ratio = Math.min(MAX_W / srcW, MAX_H / srcH, 1);
  return { w: Math.round(srcW * ratio), h: Math.round(srcH * ratio) };
}

export async function extractFrames(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<{ frames: ExtractedFrame[]; durationSec: number; videoUrl: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.crossOrigin = "anonymous";
  video.src = url;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video metadata"));
  });

  const duration = Math.max(1, Math.floor(video.duration || 0));
  const { w, h } = fitWithin(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");

  // Cap to MAX_FRAMES sampling evenly across the timeline.
  const totalSamples = Math.min(duration, MAX_FRAMES);
  const step = duration / totalSamples;
  const times: number[] = [];
  for (let i = 0; i < totalSamples; i++) times.push(Math.min(duration - 0.01, Math.round(i * step)));

  const frames: ExtractedFrame[] = [];
  for (const t of times) {
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error(`Seek error at ${t}s`)),
        { once: true },
      );
      video.currentTime = t;
    });
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
    frames.push({ time: t, dataUrl, width: w, height: h });
    onProgress?.(frames.length, totalSamples);
  }

  return { frames, durationSec: duration, videoUrl: url };
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
