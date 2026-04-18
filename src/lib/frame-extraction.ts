// Client-side frame extraction. 1 fps, max 1024x1820, JPEG q=0.92.
export type ExtractedFrame = {
  time: number;        // seconds (integer)
  dataUrl: string;     // image/jpeg;base64,...
  width: number;
  height: number;
};

const MAX_W = 1024;
const MAX_H = 1820;
const QUALITY = 0.92;
const MAX_FRAMES = 60; // safety ceiling — 1 minute of video at 1 fps

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

  // 1 frame per second + final tail frame, capped at MAX_FRAMES.
  const times: number[] = [];
  for (let t = 0; t < duration; t += 1) times.push(t);
  const tail = Math.max(0, video.duration - 0.2);
  if (!times.length || times[times.length - 1] < tail - 0.3) times.push(tail);
  if (times.length > MAX_FRAMES) {
    const step = (times.length - 1) / (MAX_FRAMES - 1);
    const picked: number[] = [];
    for (let i = 0; i < MAX_FRAMES; i++) picked.push(times[Math.round(i * step)]);
    times.length = 0;
    times.push(...picked);
  }
  const totalSamples = times.length;

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
