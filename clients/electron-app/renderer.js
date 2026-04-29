(function () {
  window.onerror = function (msg, url, line, col, err) {
    const el = document.getElementById('errorSection');
    const text = document.getElementById('errorText');
    if (el && text) {
      el.hidden = false;
      text.textContent = msg || (err && err.message) || 'Something went wrong.';
    }
    return true;
  };

  const DEFAULT_WS_URL = 'wss://interviewgenie.example.com/ws/audio';
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');
  const answerSection = document.getElementById('answerSection');
  const errorSection = document.getElementById('errorSection');
  const errorText = document.getElementById('errorText');

  const situationEl = document.getElementById('situation');
  const taskEl = document.getElementById('task');
  const actionEl = document.getElementById('action');
  const resultEl = document.getElementById('result');

  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let source = null;
  let wavChunks = [];
  const SAMPLE_RATE = 16000;

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function showError(msg) {
    errorSection.hidden = false;
    errorText.textContent = msg;
  }

  function hideError() {
    errorSection.hidden = true;
  }

  function showAnswer(star) {
    answerSection.hidden = false;
    situationEl.textContent = star.situation || '—';
    taskEl.textContent = star.task || '—';
    actionEl.textContent = star.action || '—';
    resultEl.textContent = star.result || '—';
  }

  function encodeWAV(samples, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true);  // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  async function startRecording() {
    hideError();
    answerSection.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('Microphone not supported in this context.');
      return;
    }
    try {
      setStatus('Requesting microphone…');
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      const bufferSize = 4096;
      source = audioContext.createMediaStreamSource(mediaStream);
      if (!audioContext.createScriptProcessor) {
        showError('Audio recording not supported in this environment.');
        return;
      }
      processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      wavChunks = [];
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        wavChunks.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      setStatus('Recording… Speak your interview question, then click Stop.');
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } catch (err) {
      showError('Microphone access failed: ' + (err.message || String(err)));
      setStatus('');
    }
  }

  function stopRecording() {
    if (!processor || !source) return;
    processor.disconnect();
    source.disconnect();
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    processor = null;
    source = null;

    const totalLength = wavChunks.reduce((acc, c) => acc + c.length, 0);
    const samples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of wavChunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const wavBuffer = encodeWAV(samples, audioContext?.sampleRate || SAMPLE_RATE);
    audioContext = null;
    wavChunks = [];

    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus('Sending and processing…');

    const url = DEFAULT_WS_URL;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(new Uint8Array(wavBuffer));
      ws.send(JSON.stringify({ done: true }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            showError(data.error);
            setStatus('');
            return;
          }
          if (data.status === 'processing') {
            setStatus('Generating STAR answer…');
            return;
          }
          if (data.situation !== undefined) {
            showAnswer(data);
            setStatus('Done.');
          }
        } catch (_) {}
      }
    };

    ws.onerror = () => {
      showError('WebSocket error. Is the server running at ' + url + '?');
      setStatus('');
    };

    ws.onclose = () => {
      if (!document.getElementById('situation').textContent) setStatus('');
    };
  }

  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
})();
