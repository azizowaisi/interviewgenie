/** Utilities to capture tab / system audio (Meet, Teams, etc.) and build WAV for STT. */

const TARGET_SAMPLE_RATE = 16000;

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const x0 = Math.floor(x);
    const x1 = Math.min(x0 + 1, input.length - 1);
    const t = x - x0;
    out[i] = input[x0] * (1 - t) + input[x1] * t;
  }
  return out;
}

export function floatTo16BitPcm(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function encodeWavPcm16Mono(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    dv.setInt16(o, samples[i], true);
    o += 2;
  }
  return buf;
}

export function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export type MeetingCaptureSession = {
  stopAndTranscribe: () => Promise<ArrayBuffer>;
  dispose: () => void;
};

/**
 * Captures audio from a display/tab share stream (user must enable "Share tab audio" for browser Meet/Teams).
 * Video track is included only because browsers require it for tab capture; caller should stop tracks in dispose().
 */
export async function startMeetingAudioCapture(
  onChunkMaxSamples?: (totalSamples: number) => void
): Promise<MeetingCaptureSession> {
  const md = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (constraints: { video: boolean; audio: boolean }) => Promise<MediaStream>;
  };
  if (!md.getDisplayMedia) {
    throw new Error("Screen/tab sharing is not supported in this browser.");
  }

  const stream = await md.getDisplayMedia({ video: true, audio: true });

  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      "No audio in the shared source. Pick your Meet/Teams browser tab and turn on “Share tab audio” (Chrome)."
    );
  }

  const audioContext = new AudioContext();
  const inputSampleRate = audioContext.sampleRate;
  const source = audioContext.createMediaStreamSource(stream);
  const channels = Math.min(2, source.channelCount || 2);
  const processor = audioContext.createScriptProcessor(4096, channels, 1);
  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  const maxSamples = inputSampleRate * 120;
  let acceptingAudio = true;

  processor.onaudioprocess = (e) => {
    if (!acceptingAudio) return;
    const buf = e.inputBuffer;
    const n = buf.length;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) * 0.5;
    chunks.push(mono);
    totalSamples += n;
    onChunkMaxSamples?.(totalSamples);
    if (totalSamples >= maxSamples) {
      acceptingAudio = false;
    }
  };

  source.connect(processor);
  const silent = audioContext.createGain();
  silent.gain.value = 0;
  processor.connect(silent);
  silent.connect(audioContext.destination);

  let stopped = false;

  const stopInternal = async () => {
    if (stopped) return;
    stopped = true;
    acceptingAudio = false;
    try {
      source.disconnect();
      processor.disconnect();
      silent.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    await audioContext.close().catch(() => undefined);
  };

  const stopAndTranscribe = async (): Promise<ArrayBuffer> => {
    const merged = mergeFloat32Chunks(chunks);
    chunks.length = 0;
    await stopInternal();
    const resampled = resampleLinear(merged, inputSampleRate, TARGET_SAMPLE_RATE);
    const pcm = floatTo16BitPcm(resampled);
    return encodeWavPcm16Mono(pcm, TARGET_SAMPLE_RATE);
  };

  const dispose = () => {
    void stopInternal();
  };

  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.addEventListener("ended", () => {
      acceptingAudio = false;
      void stopInternal();
    });
  }

  return { stopAndTranscribe, dispose };
}
