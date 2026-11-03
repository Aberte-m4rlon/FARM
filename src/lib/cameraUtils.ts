/**
 * cameraUtils.ts — Lightweight Canvas & Camera Utilities for AlpasFarm
 *
 * Provides pure browser-based frame capture, image resizing, and Blob conversion
 * without any heavy ML / TensorFlow / ONNX dependencies.
 */

/**
 * Capture current frame from a running HTML5 video element into an HTMLCanvasElement
 */
export function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(video, 0, 0, width, height);
  }
  return canvas;
}

/**
 * Load an uploaded File/Blob into an HTMLCanvasElement
 */
export async function fileToCanvas(file: File | Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
      }
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Convert HTMLCanvasElement to JPEG Blob
 */
export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number = 0.85
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Nabigo ang pag-convert ng canvas sa image blob.'));
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Downscale and optimize an image/canvas before local image processing
 * Default 1280px max dimension, 0.85 quality JPEG
 */
export async function optimizeImageForAI(
  input: HTMLCanvasElement | HTMLImageElement | string,
  maxDimension: number = 1280,
  quality: number = 0.85
): Promise<string> {
  if (typeof input === 'string' && input.startsWith('data:image/')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width <= maxDimension && height <= maxDimension && input.length < 500000) {
          resolve(input);
          return;
        }

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(input);
        }
      };
      img.onerror = () => resolve(input);
      img.src = input;
    });
  }

  let srcCanvas: HTMLCanvasElement;
  if (input instanceof HTMLCanvasElement) {
    srcCanvas = input;
  } else if (input instanceof HTMLImageElement) {
    const c = document.createElement('canvas');
    c.width = input.naturalWidth || input.width;
    c.height = input.naturalHeight || input.height;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(input, 0, 0);
    srcCanvas = c;
  } else {
    return String(input);
  }

  let width = srcCanvas.width;
  let height = srcCanvas.height;

  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }

    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = width;
    scaledCanvas.height = height;
    const ctx = scaledCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(srcCanvas, 0, 0, width, height);
      return scaledCanvas.toDataURL('image/jpeg', quality);
    }
  }

  return srcCanvas.toDataURL('image/jpeg', quality);
}

/**
 * Convert bounding box between video frame space and object-fit: cover viewport space,
 * or vice versa.
 */
export function mapBoundingBoxWithObjectFitCover(
  box: BoundingBox,
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  containerHeight: number,
  from: 'video_to_container' | 'container_to_video' = 'video_to_container'
): BoundingBox {
  if (!videoWidth || !videoHeight || !containerWidth || !containerHeight) {
    return { ...box };
  }

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (containerWidth / containerHeight > videoWidth / videoHeight) {
    scale = containerWidth / videoWidth;
    offsetY = (containerHeight - videoHeight * scale) / 2;
  } else {
    scale = containerHeight / videoHeight;
    offsetX = (containerWidth - videoWidth * scale) / 2;
  }

  if (from === 'video_to_container') {
    const vidX = box.x * videoWidth;
    const vidY = box.y * videoHeight;
    const vidW = box.width * videoWidth;
    const vidH = box.height * videoHeight;

    const cx = vidX * scale + offsetX;
    const cy = vidY * scale + offsetY;
    const cw = vidW * scale;
    const ch = vidH * scale;

    return {
      x: cx / containerWidth,
      y: cy / containerHeight,
      width: cw / containerWidth,
      height: ch / containerHeight,
    };
  } else {
    const cx = box.x * containerWidth;
    const cy = box.y * containerHeight;
    const cw = box.width * containerWidth;
    const ch = box.height * containerHeight;

    const vidX = (cx - offsetX) / scale;
    const vidY = (cy - offsetY) / scale;
    const vidW = cw / scale;
    const vidH = ch / scale;

    return {
      x: Math.max(0, Math.min(1, vidX / videoWidth)),
      y: Math.max(0, Math.min(1, vidY / videoHeight)),
      width: Math.max(0, Math.min(1, vidW / videoWidth)),
      height: Math.max(0, Math.min(1, vidH / videoHeight)),
    };
  }
}

export interface CropBoundingBoxOptions {
  paddingFactor?: number;
  videoWidth?: number;
  videoHeight?: number;
  containerWidth?: number;
  containerHeight?: number;
  isContainerCoords?: boolean;
  minDimension?: number;
}

/**
 * Crop a canvas to a specific normalized bounding box with padding.
 * Isolates the selected animal from background animals/objects for focused health screening.
 * 
 * Complies with:
 * - Convert normalized coordinates to actual canvas coordinates
 * - Account for object-fit: cover
 * - Add a small safe padding around the box (default 15%)
 * - Clamp coordinates to image boundaries
 * - Crop the selected animal
 * - Preserve enough context (head, ears, body, hooves) to identify the animal
 */
export function cropCanvasToBoundingBox(
  sourceCanvas: HTMLCanvasElement,
  bbox: { x: number; y: number; width: number; height: number },
  paddingOrOptions: number | CropBoundingBoxOptions = 0.15,
  legacyOptions?: CropBoundingBoxOptions
): HTMLCanvasElement {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;

  const options: CropBoundingBoxOptions =
    typeof paddingOrOptions === 'number'
      ? { paddingFactor: paddingOrOptions, ...(legacyOptions || {}) }
      : paddingOrOptions || {};

  const paddingFactor = options.paddingFactor ?? 0.15;
  const minDimension = options.minDimension ?? 50;

  let effectiveBox: BoundingBox = {
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
  };

  // Normalize if coordinates are on 0..1000 scale
  if (effectiveBox.x > 1 || effectiveBox.y > 1 || effectiveBox.width > 1 || effectiveBox.height > 1) {
    effectiveBox.x = effectiveBox.x / 1000;
    effectiveBox.y = effectiveBox.y / 1000;
    effectiveBox.width = effectiveBox.width / 1000;
    effectiveBox.height = effectiveBox.height / 1000;
  }

  // Account for object-fit: cover if coordinates originated from container overlay
  if (
    options.isContainerCoords &&
    options.videoWidth &&
    options.videoHeight &&
    options.containerWidth &&
    options.containerHeight
  ) {
    effectiveBox = mapBoundingBoxWithObjectFitCover(
      effectiveBox,
      options.videoWidth,
      options.videoHeight,
      options.containerWidth,
      options.containerHeight,
      'container_to_video'
    );
  }

  // Convert normalized coordinates to actual canvas pixel coordinates
  const rawX = effectiveBox.x * sw;
  const rawY = effectiveBox.y * sh;
  const rawW = effectiveBox.width * sw;
  const rawH = effectiveBox.height * sh;

  // Add safe padding margin around the animal to retain context
  const padX = rawW * paddingFactor;
  const padY = rawH * paddingFactor;

  // Clamp coordinates firmly to image boundaries
  const cropX = Math.max(0, Math.floor(rawX - padX));
  const cropY = Math.max(0, Math.floor(rawY - padY));
  const cropW = Math.min(sw - cropX, Math.ceil(rawW + padX * 2));
  const cropH = Math.min(sh - cropY, Math.ceil(rawH + padY * 2));

  // If crop is too small or degenerate, return original canvas safely
  if (cropW < minDimension || cropH < minDimension) {
    return sourceCanvas;
  }

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = cropW;
  croppedCanvas.height = cropH;
  const ctx = croppedCanvas.getContext('2d');
  if (!ctx) return sourceCanvas;

  ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return croppedCanvas;
}

// ── Live Object Detection & Bounding Box Types ───────────────────────────────

export interface BoundingBox {
  x: number;       // 0.0 to 1.0 (left percentage)
  y: number;       // 0.0 to 1.0 (top percentage)
  width: number;   // 0.0 to 1.0 (width percentage)
  height: number;  // 0.0 to 1.0 (height percentage)
}

export type LiveTargetType = 'GOAT' | 'SHEEP' | 'PERSON' | 'OTHER' | 'OTHER_ANIMAL' | 'OBJECT' | 'UNCERTAIN';
export type LiveTargetLabel =
  | 'Kambing'
  | 'Tupa'
  | 'Tao'
  | 'Ibang Bagay'
  | 'Hindi Malinaw'
  | 'KAMBING'
  | 'TUPA'
  | 'TAO'
  | 'IBANG BAGAY'
  | string;

export interface LiveDetectedObject {
  id?: string;
  species?: string;
  confidence?: number;
  type: LiveTargetType;
  label: LiveTargetLabel;
  boundingBox: BoundingBox;
}

export interface LiveObjectDetectionResult {
  success: boolean;
  detections: LiveDetectedObject[];
  count_goats: number;
  count_sheep: number;
  multiple_targets: boolean;
  status_message: string;
  error?: string;
}

export interface FrameLuminanceCheck {
  isAvailable: boolean;
  meanLuminance: number;
  maxLuminance: number;
  isBlackOrDark: boolean;
  reason?: 'empty_frame' | 'black_or_dark' | 'read_error';
}

/**
 * Rapidly evaluate whether a captured video frame is visually available and usable.
 * Checks for pitch black, blocked, or covered camera lens using grid-sampled luminance.
 * 2586.mp4 regression protection: Prevents sending black frames and rejects detections when camera is dark.
 */
export function evaluateFrameAvailability(canvas: HTMLCanvasElement): FrameLuminanceCheck {
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    return { isAvailable: false, meanLuminance: 0, maxLuminance: 0, isBlackOrDark: true, reason: 'empty_frame' };
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { isAvailable: false, meanLuminance: 0, maxLuminance: 0, isBlackOrDark: true, reason: 'empty_frame' };
  }

  // Fast grid sampling across 10x10 = 100 sample points
  const sampleCols = 10;
  const sampleRows = 10;
  const stepX = Math.max(1, Math.floor(canvas.width / sampleCols));
  const stepY = Math.max(1, Math.floor(canvas.height / sampleRows));

  let totalLuminance = 0;
  let maxLuminance = 0;
  let count = 0;

  try {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const stride = canvas.width * 4;

    for (let r = 0; r < sampleRows; r++) {
      const y = Math.min(canvas.height - 1, r * stepY);
      const rowOffset = y * stride;
      for (let c = 0; c < sampleCols; c++) {
        const x = Math.min(canvas.width - 1, c * stepX);
        const idx = rowOffset + x * 4;
        const red = data[idx];
        const green = data[idx + 1];
        const blue = data[idx + 2];
        // Standard perceived luminance formula (ITU-R BT.601)
        const lum = 0.299 * red + 0.587 * green + 0.114 * blue;
        totalLuminance += lum;
        if (lum > maxLuminance) maxLuminance = lum;
        count++;
      }
    }
  } catch {
    // Return safe fallback if canvas getImageData throws (e.g. tainted context)
    return { isAvailable: false, meanLuminance: 0, maxLuminance: 0, isBlackOrDark: true, reason: 'read_error' };
  }

  const meanLuminance = count > 0 ? totalLuminance / count : 0;
  // If average luminance < 12 and maximum luminance < 35, the camera is pitch black / covered
  const isBlackOrDark = meanLuminance < 12 && maxLuminance < 35;

  return {
    isAvailable: !isBlackOrDark,
    meanLuminance,
    maxLuminance,
    isBlackOrDark,
    reason: isBlackOrDark ? 'black_or_dark' : undefined,
  };
}

/**
 * Capture a lightweight downscaled frame (default max 480px)
 * for rapid sampling during live object detection.
 */
export function captureLowResFrame(
  video: HTMLVideoElement,
  maxDimension: number = 480
): HTMLCanvasElement {
  const vWidth = video.videoWidth || 640;
  const vHeight = video.videoHeight || 480;

  let width = vWidth;
  let height = vHeight;

  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(video, 0, 0, width, height);
  }
  return canvas;
}

/**
 * Render real-time high-contrast bounding boxes & labels to the camera overlay canvas
 */
export function renderLiveDetectionsToCanvas(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  detections: LiveDetectedObject[],
  selectedTargetIndex: number = 0
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Sync canvas internal resolution with display size
  if (canvas.clientWidth > 0 && canvas.clientHeight > 0 &&
      (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight)) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }

  const W = canvas.width;
  const H = canvas.height;

  // Clear canvas before rendering every frame
  ctx.clearRect(0, 0, W, H);

  // If no detections or video not ready, leave canvas completely clear
  if (!detections || detections.length === 0 || !video || video.videoWidth === 0) {
    return;
  }

  const vW = video.videoWidth;
  const vH = video.videoHeight;

  // Calculate object-fit: cover scaling & cropping offset
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (W / H > vW / vH) {
    scale = W / vW;
    offsetY = (H - vH * scale) / 2;
  } else {
    scale = H / vH;
    offsetX = (W - vW * scale) / 2;
  }

  let targetCounter = 0;

  for (const d of detections) {
    const rawBox = d.boundingBox;
    if (!rawBox) continue;

    // Convert video-normalized box [0, 1] to video pixels, then scale to canvas
    const vidX = rawBox.x * vW;
    const vidY = rawBox.y * vH;
    const vidW = rawBox.width * vW;
    const vidH = rawBox.height * vH;

    const bx = vidX * scale + offsetX;
    const by = vidY * scale + offsetY;
    const bw = Math.max(30, vidW * scale);
    const bh = Math.max(30, vidH * scale);

    // Keep box bounded within canvas
    const drawX = Math.max(2, Math.min(W - bw - 2, bx));
    const drawY = Math.max(2, Math.min(H - bh - 2, by));

    const isGoat = d.type === 'GOAT';
    const isSheep = d.type === 'SHEEP';
    const isTarget = isGoat || isSheep;
    const isUncertain = d.type === 'UNCERTAIN';
    const isPerson = d.type === 'PERSON';

    let isSelectedTarget = false;
    if (isTarget) {
      isSelectedTarget = (targetCounter === selectedTargetIndex);
      targetCounter++;
    }

    // High-contrast color palette
    let strokeColor = '#94A3B8';
    let fillColor = 'rgba(148, 163, 184, 0.08)';
    let badgeBg = '#475569';
    let accentColor = '#CBD5E1';
    let labelText = 'Ibang Bagay';

    if (isTarget) {
      if (isSelectedTarget) {
        strokeColor = '#22C55E';
        fillColor = 'rgba(34, 197, 94, 0.20)';
        badgeBg = '#16A34A';
        accentColor = '#4ADE80';
        labelText = isGoat ? 'Napiling Kambing' : 'Napiling Tupa';
      } else {
        strokeColor = 'rgba(22, 163, 74, 0.85)';
        fillColor = 'rgba(22, 163, 74, 0.10)';
        badgeBg = '#15803D';
        accentColor = '#22C55E';
        labelText = isGoat ? 'Kambing' : 'Tupa';
      }
    } else if (isUncertain) {
      strokeColor = '#D97706';
      fillColor = 'rgba(217, 119, 6, 0.15)';
      badgeBg = '#D97706';
      accentColor = '#FBBF24';
      labelText = 'Hindi Malinaw';
    } else if (isPerson) {
      strokeColor = '#2563EB';
      fillColor = 'rgba(37, 99, 235, 0.12)';
      badgeBg = '#2563EB';
      accentColor = '#60A5FA';
      labelText = 'Tao';
    } else {
      // All other items (Cat, Dog, Cow, Car, Door, Furniture, etc.) -> "Ibang Bagay"
      strokeColor = '#94A3B8';
      fillColor = 'rgba(148, 163, 184, 0.10)';
      badgeBg = '#475569';
      accentColor = '#CBD5E1';
      labelText = 'Ibang Bagay';
    }

    // 1. Draw Bounding Box Fill
    ctx.fillStyle = fillColor;
    ctx.fillRect(drawX, drawY, bw, bh);

    // 2. Draw Bounding Box Border
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isSelectedTarget ? 4 : (isTarget || isUncertain ? 3 : 2);
    ctx.setLineDash([]);
    ctx.strokeRect(drawX, drawY, bw, bh);

    // 3. Draw Corner Accents
    const cornerSize = Math.min(20, bw * 0.25, bh * 0.25);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = isSelectedTarget ? 4.5 : 3.5;
    ctx.lineCap = 'round';

    // Top-left
    ctx.beginPath();
    ctx.moveTo(drawX, drawY + cornerSize);
    ctx.lineTo(drawX, drawY);
    ctx.lineTo(drawX + cornerSize, drawY);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(drawX + bw - cornerSize, drawY);
    ctx.lineTo(drawX + bw, drawY);
    ctx.lineTo(drawX + bw, drawY + cornerSize);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(drawX, drawY + bh - cornerSize);
    ctx.lineTo(drawX, drawY + bh);
    ctx.lineTo(drawX + cornerSize, drawY + bh);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(drawX + bw - cornerSize, drawY + bh);
    ctx.lineTo(drawX + bw, drawY + bh);
    ctx.lineTo(drawX + bw, drawY + bh - cornerSize);
    ctx.stroke();

    // 4. Draw Label Badge (Directly above box or inside top if near top)
    ctx.font = 'bold 12px Plus Jakarta Sans, Inter, system-ui, -apple-system, sans-serif';
    const textMetrics = ctx.measureText(labelText);
    const badgePadX = 10;
    const badgeH = 24;
    const badgeW = textMetrics.width + badgePadX * 2;

    let labelX = Math.max(4, Math.min(W - badgeW - 4, drawX));
    let labelY = drawY - badgeH - 4;
    if (labelY < 4) {
      labelY = drawY + 4;
    }

    // Badge Shadow & Rounded Pill
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = badgeBg;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(labelX, labelY, badgeW, badgeH, 6);
    } else {
      ctx.rect(labelX, labelY, badgeW, badgeH);
    }
    ctx.fill();
    ctx.restore();

    // Badge Text
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(labelText, labelX + badgePadX, labelY + 16);
  }
}
