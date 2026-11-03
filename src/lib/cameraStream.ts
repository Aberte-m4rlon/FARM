import { supabase } from './supabase';

const MAX_CAMERA_FRAME_BYTES = 1_200_000;

export interface FarmCameraStatus {
  active: boolean;
  camera_reachable: boolean;
  stream_connected: boolean;
  frames_received: number;
  last_frame_at: string | null;
  gateway_online: boolean;
  gateway_last_seen_at: string | null;
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Mag-sign in muli para buksan ang camera.');
  return data.session.access_token;
}

async function cameraRequest(path: string, method: 'GET' | 'POST'): Promise<Response> {
  const token = await getAccessToken();
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    const message = typeof payload.error === 'string' ? payload.error : 'Hindi mabuksan ang camera ngayon.';
    if (response.status === 403) throw new Error('Hindi naka-enable ang camera para sa account na ito.');
    if (response.status === 503) throw new Error('Camera offline — Pakicheck ang camera connection.');
    throw new Error(message);
  }
  return response;
}

export async function createFarmCameraStreamTicket(): Promise<void> {
  await cameraRequest('/api/camera/stream-ticket', 'POST');
}

export async function refreshFarmCameraStreamTicket(): Promise<void> {
  await cameraRequest('/api/camera/stream-ticket', 'POST');
}

export async function isFarmCameraActive(): Promise<boolean> {
  try {
    const status = await getFarmCameraStatus();
    return status.stream_connected;
  } catch {
    return false;
  }
}

export async function getFarmCameraStatus(): Promise<FarmCameraStatus> {
  const response = await cameraRequest('/api/camera/status', 'GET');
  const status = await response.json() as Partial<FarmCameraStatus>;
  if (typeof status.active !== 'boolean' || typeof status.camera_reachable !== 'boolean'
    || typeof status.stream_connected !== 'boolean' || !Number.isSafeInteger(status.frames_received)
    || (status.frames_received as number) < 0
    || !(status.last_frame_at === null || (typeof status.last_frame_at === 'string' && Number.isFinite(Date.parse(status.last_frame_at))))
    || typeof status.gateway_online !== 'boolean'
    || !(status.gateway_last_seen_at === null || (typeof status.gateway_last_seen_at === 'string' && Number.isFinite(Date.parse(status.gateway_last_seen_at))))) {
    throw new Error('Hindi wastong status ang ibinalik ng camera gateway.');
  }
  return status as FarmCameraStatus;
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array, startAt = 0): number {
  if (!needle.length) return startAt;
  for (let start = startAt; start <= haystack.length - needle.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return -1;
}

function bytesEqualAt(value: Uint8Array, expected: Uint8Array, offset: number): boolean {
  return offset >= 0 && offset + expected.length <= value.length &&
    expected.every((byte, index) => value[offset + index] === byte);
}

export async function streamFarmCameraFrames(
  signal: AbortSignal,
  onFrame: (frame: Blob) => Promise<void> | void,
): Promise<void> {
  const response = await fetch('/api/camera/stream', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    if (response.status === 401) throw new Error('Mag-sign in muli para buksan ang camera.');
    if (response.status === 403) throw new Error('Hindi naka-enable ang camera para sa account na ito.');
    if (response.status === 503) throw new Error('Camera offline — Pakicheck ang camera connection.');
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Hindi mabuksan ang camera stream.');
  }

  const boundaryMatch = response.headers.get('content-type')?.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary || !response.body) throw new Error('Hindi mabasa ang live stream mula sa camera gateway.');

  const reader = response.body.getReader();
  const encoder = new TextEncoder();
  const marker = encoder.encode(`--${boundary}`);
  const headerBreak = encoder.encode('\r\n\r\n');
  const lineBreak = encoder.encode('\r\n');
  const headerDecoder = new TextDecoder('ascii');
  let buffered = new Uint8Array(0);

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        if (!signal.aborted) throw new Error('Natapos ang live stream ng camera.');
        return;
      }
      if (!value?.length) continue;
      buffered = appendBytes(buffered, value);

      let parsedFrame = true;
      while (parsedFrame && !signal.aborted) {
        parsedFrame = false;
        const markerAt = findBytes(buffered, marker);
        if (markerAt < 0) {
          if (buffered.length > MAX_CAMERA_FRAME_BYTES + 8_192) {
            throw new Error('Sobra ang laki ng camera stream frame.');
          }
          break;
        }
        if (markerAt > 0) {
          if (buffered.subarray(0, markerAt).some((byte) => byte !== 13 && byte !== 10)) {
            throw new Error('Hindi wastong format ang camera stream.');
          }
          buffered = buffered.slice(markerAt);
        }
        if (buffered.length < marker.length + 2) break;
        if (buffered[marker.length] === 45 && buffered[marker.length + 1] === 45) return;
        if (!bytesEqualAt(buffered, lineBreak, marker.length)) {
          throw new Error('Hindi wastong format ang camera stream.');
        }

        const headersStart = marker.length + lineBreak.length;
        const headersEnd = findBytes(buffered, headerBreak, headersStart);
        if (headersEnd < 0) break;
        const headers = headerDecoder.decode(buffered.subarray(headersStart, headersEnd));
        const frameLengthMatch = headers.match(/(?:^|\r\n)content-length:\s*(\d+)(?:\r\n|$)/i);
        const contentType = headers.match(/(?:^|\r\n)content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase();
        const frameLength = Number(frameLengthMatch?.[1]);
        if (!Number.isSafeInteger(frameLength) || frameLength < 4 || frameLength > MAX_CAMERA_FRAME_BYTES || contentType !== 'image/jpeg') {
          throw new Error('Hindi wastong JPEG frame ang ipinadala ng camera gateway.');
        }

        const frameStart = headersEnd + headerBreak.length;
        const frameEnd = frameStart + frameLength;
        if (buffered.length < frameEnd + lineBreak.length) break;
        if (!bytesEqualAt(buffered, lineBreak, frameEnd)) {
          throw new Error('Hindi kumpleto ang camera stream frame.');
        }
        const frameBytes = buffered.slice(frameStart, frameEnd);
        if (frameBytes[0] !== 0xff || frameBytes[1] !== 0xd8 ||
          frameBytes[frameBytes.length - 2] !== 0xff || frameBytes[frameBytes.length - 1] !== 0xd9) {
          throw new Error('Hindi wastong JPEG frame ang ipinadala ng camera gateway.');
        }
        buffered = buffered.slice(frameEnd + lineBreak.length);
        await onFrame(new Blob([frameBytes], { type: 'image/jpeg' }));
        parsedFrame = true;
      }

      if (buffered.length > MAX_CAMERA_FRAME_BYTES + 8_192) {
        throw new Error('Sobra ang laki ng camera stream frame.');
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    reader.releaseLock();
  }
}
