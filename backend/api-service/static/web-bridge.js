/**
 * Browser implementation of window.electronAPI (mirrors clients/electron-app/preload.js).
 * Loaded before the Interview Genie UI script on /app.
 */
(function () {
  if (window.electronAPI) return;

  const USER_HDR = { 'X-User-Id': 'default' };
  const SEGMENT_TIMEOUT_MS = 300000;

  function baseUrl(u) {
    return String(u || '').replace(/\/$/, '');
  }

  async function parseJsonResponse(res) {
    const text = await res.text();
    try {
      if (!res.ok) return { error: res.status, body: text };
      return text ? JSON.parse(text) : {};
    } catch (e) {
      return { error: 'parse', message: e.message, body: text };
    }
  }

  async function jget(url) {
    const res = await fetch(url, { headers: { ...USER_HDR } });
    return parseJsonResponse(res);
  }

  async function jpost(url, body, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...USER_HDR, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      return await parseJsonResponse(res);
    } catch (e) {
      if (e.name === 'AbortError') return { error: 'timeout' };
      return { error: 'network', message: e.message };
    } finally {
      clearTimeout(t);
    }
  }

  async function jpatch(url, body, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...USER_HDR, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      return await parseJsonResponse(res);
    } catch (e) {
      if (e.name === 'AbortError') return { error: 'timeout' };
      return { error: 'network', message: e.message };
    } finally {
      clearTimeout(t);
    }
  }

  async function uploadMultipart(url, filename, fileBuffer) {
    const fd = new FormData();
    const blob = fileBuffer instanceof Blob ? fileBuffer : new Blob([fileBuffer]);
    fd.append('file', blob, filename || 'cv.pdf');
    try {
      const res = await fetch(url, { method: 'POST', headers: { ...USER_HDR }, body: fd });
      return parseJsonResponse(res);
    } catch (e) {
      return { error: 'network', message: e.message };
    }
  }

  const statusCbs = [];
  const transcriptCbs = [];
  const chunkCbs = [];

  function emitStatus(msg) {
    statusCbs.forEach((cb) => {
      try {
        cb(msg);
      } catch (_) {}
    });
  }
  function emitTranscript(t) {
    transcriptCbs.forEach((cb) => {
      try {
        cb(t);
      } catch (_) {}
    });
  }
  function emitChunk(tok) {
    chunkCbs.forEach((cb) => {
      try {
        cb(tok);
      } catch (_) {}
    });
  }

  let audioSession = null;

  function closeAudioSession() {
    if (!audioSession) return;
    const { ws, pending } = audioSession;
    audioSession = null;
    try {
      ws.close();
    } catch (_) {}
    const result = { error: 'Session ended' };
    pending.forEach((entry) => {
      try {
        clearTimeout(entry.timeout);
        entry.resolve(result);
      } catch (_) {}
    });
  }

  function routeMessage(json) {
    if (json.status) {
      emitStatus(json.status);
      return;
    }
    if (json.transcript) {
      emitTranscript(json.transcript);
      return;
    }
    if (json.answer_chunk) {
      emitChunk(json.answer_chunk);
      return;
    }
    const pending = audioSession && audioSession.pending;
    if (!pending) return;

    if (json.answer_done && json.situation !== undefined) {
      const next = pending.shift();
      if (next) {
        clearTimeout(next.timeout);
        next.resolve({
          situation: json.situation,
          task: json.task,
          action: json.action,
          result: json.result,
        });
      }
      return;
    }
    if (json.answer_done && json.error) {
      const next = pending.shift();
      if (next) {
        clearTimeout(next.timeout);
        next.resolve({ error: json.error });
      }
      return;
    }
    if (json.answer_done && json.answer_transcript !== undefined) {
      const next = pending.shift();
      if (next) {
        clearTimeout(next.timeout);
        next.resolve({
          answer_transcript: json.answer_transcript,
          question: json.question,
        });
      }
      return;
    }
    if (json.error || json.situation !== undefined || json.result !== undefined) {
      const next = pending.shift();
      if (next) {
        clearTimeout(next.timeout);
        next.resolve(json);
      }
    }
  }

  window.electronAPI = {
    sendAudio(url, audioBytes) {
      return new Promise((resolve, reject) => {
        const buf = audioBytes instanceof ArrayBuffer ? new Uint8Array(audioBytes) : new Uint8Array(audioBytes);
        const ws = new WebSocket(url);
        let resolved = false;
        const TIMEOUT_MS = 90000;
        const timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          ws.close();
          reject(new Error('Timeout'));
        }, TIMEOUT_MS);

        function done(json) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          try {
            ws.close();
          } catch (_) {}
          resolve(json);
        }

        ws.onopen = () => {
          ws.send(buf);
          ws.send(JSON.stringify({ done: true }));
        };
        ws.onmessage = async (ev) => {
          try {
            let text = typeof ev.data === 'string' ? ev.data : '';
            if (!text && ev.data && typeof ev.data.arrayBuffer === 'function') {
              text = new TextDecoder().decode(await ev.data.arrayBuffer());
            }
            const json = JSON.parse(text);
            if (json.status) emitStatus(json.status);
            if (json.error || json.situation !== undefined || json.result !== undefined) done(json);
          } catch (_) {}
        };
        ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(new Error('WebSocket error'));
          }
        };
        ws.onclose = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(new Error('Connection closed'));
          }
        };
      });
    },

    startAudioSession(url, cvId, topicId) {
      if (audioSession) closeAudioSession();
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const pending = [];
        let opened = false;
        audioSession = { ws, pending };

        ws.onopen = () => {
          opened = true;
          const msg = { user_id: 'default' };
          if (cvId && String(cvId).trim()) msg.cv_id = String(cvId).trim();
          if (topicId && String(topicId).trim()) msg.topic_id = String(topicId).trim();
          try {
            ws.send(JSON.stringify(msg));
          } catch (_) {}
          resolve({ ok: true });
        };

        ws.onmessage = (ev) => {
          try {
            const text = typeof ev.data === 'string' ? ev.data : '';
            const json = JSON.parse(text);
            routeMessage(json);
          } catch (_) {}
        };

        ws.onerror = () => {
          if (!opened) reject(new Error('WebSocket error'));
          if (audioSession && audioSession.ws === ws) closeAudioSession();
        };

        ws.onclose = () => {
          if (audioSession && audioSession.ws === ws) {
            audioSession = null;
            pending.forEach((entry) => {
              try {
                clearTimeout(entry.timeout);
                entry.resolve({ error: 'Connection closed' });
              } catch (_) {}
            });
          }
        };
      });
    },

    sendAudioSegment(audioBytes) {
      if (!audioSession || audioSession.ws.readyState !== WebSocket.OPEN) {
        return Promise.resolve({ error: 'No active session. Click Start recording first.' });
      }
      const { ws, pending } = audioSession;
      const buf = audioBytes instanceof ArrayBuffer ? new Uint8Array(audioBytes) : new Uint8Array(audioBytes);
      return new Promise((resolve) => {
        const entry = { resolve, timeout: null };
        entry.timeout = setTimeout(() => {
          const i = pending.indexOf(entry);
          if (i !== -1) pending.splice(i, 1);
          resolve({
            error:
              'Backend took too long. Check that Whisper and Ollama are running. Try again.',
          });
        }, SEGMENT_TIMEOUT_MS);
        pending.push(entry);
        ws.send(JSON.stringify({ chunk: true }));
        ws.send(buf);
        ws.send(JSON.stringify({ process: true }));
      });
    },

    sendAudioChunk(audioBytes) {
      if (!audioSession || audioSession.ws.readyState !== WebSocket.OPEN) return;
      const buf = audioBytes instanceof ArrayBuffer ? audioBytes : new Uint8Array(audioBytes);
      audioSession.ws.send(buf);
    },

    sendMockQuestion(question) {
      if (!audioSession || audioSession.ws.readyState !== WebSocket.OPEN) return;
      try {
        audioSession.ws.send(JSON.stringify({ mock_question: question || '' }));
      } catch (_) {}
    },

    endAudioSession() {
      closeAudioSession();
    },

    sendTextQuestion(url, text, cvId, topicId) {
      return new Promise((resolve) => {
        const ws = new WebSocket(url);
        const TIMEOUT_MS = 120000;
        let resolved = false;
        const timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          try {
            ws.close();
          } catch (_) {}
          resolve({ error: 'Timeout waiting for answer. Try again.' });
        }, TIMEOUT_MS);

        function done(json) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          try {
            ws.close();
          } catch (_) {}
          if (json.error) resolve({ error: json.error });
          else
            resolve({
              situation: json.situation,
              task: json.task,
              action: json.action,
              result: json.result,
            });
        }

        ws.onopen = () => {
          const sessionMsg = { user_id: 'default' };
          if (cvId && String(cvId).trim()) sessionMsg.cv_id = String(cvId).trim();
          if (topicId && String(topicId).trim()) sessionMsg.topic_id = String(topicId).trim();
          ws.send(JSON.stringify(sessionMsg));
          ws.send(JSON.stringify({ text: String(text || '').trim() }));
        };

        ws.onmessage = (ev) => {
          try {
            const raw = typeof ev.data === 'string' ? ev.data : '';
            const json = JSON.parse(raw);
            if (json.status) emitStatus(json.status);
            if (json.transcript) emitTranscript(json.transcript);
            if (json.answer_chunk) emitChunk(json.answer_chunk);
            if (json.answer_done && (json.situation !== undefined || json.error)) done(json);
            if (json.error && !json.answer_done) done(json);
          } catch (_) {}
        };

        ws.onerror = () => {
          if (!resolved)
            done({
              error:
                'Connection failed. Check network and WebSocket URL (wss://…/ws/audio).',
            });
        };
        ws.onclose = () => {
          if (!resolved) done({ error: 'Connection closed' });
        };
      });
    },

    onAudioStatus(cb) {
      statusCbs.push(cb);
    },
    onAudioTranscript(cb) {
      transcriptCbs.push(cb);
    },
    onAudioAnswerChunk(cb) {
      chunkCbs.push(cb);
    },

    saveHistory(apiBase, question, answer, topicId, source, feedback) {
      const b = baseUrl(apiBase);
      const body = { question: question || '', answer: answer || '', topic_id: topicId || undefined };
      if (source === 'mock' || source === 'live') body.source = source;
      if (feedback !== undefined && feedback !== null) body.feedback = String(feedback);
      return jpost(`${b}/history`, body);
    },

    saveMockFeedback(apiBase, entryId, feedback) {
      const b = baseUrl(apiBase);
      return jpatch(`${b}/history/${encodeURIComponent(entryId)}`, { feedback: feedback || '' });
    },

    getMockAnswerFeedback(audioBase, question, answer) {
      const b = baseUrl(audioBase);
      return jpost(
        `${b}/mock/analyze`,
        { question: question || '', answer: answer || '' },
        120000,
      );
    },

    getHistory(apiBase, limit, topicId) {
      const b = baseUrl(apiBase);
      let u = `${b}/history?limit=${Math.min(Number(limit) || 50, 100)}`;
      if (topicId) u += `&topic_id=${encodeURIComponent(topicId)}`;
      return jget(u);
    },

    getCvList(apiBase) {
      return jget(`${baseUrl(apiBase)}/cv`);
    },

    getCv(apiBase, cvId) {
      return jget(`${baseUrl(apiBase)}/cv/${encodeURIComponent(cvId)}`);
    },

    uploadCv(apiBase, filename, fileBuffer) {
      return uploadMultipart(`${baseUrl(apiBase)}/cv/upload`, filename, fileBuffer);
    },

    uploadTopicCv(apiBase, topicId, filename, fileBuffer) {
      return uploadMultipart(
        `${baseUrl(apiBase)}/topics/${encodeURIComponent(topicId)}/cv`,
        filename,
        fileBuffer,
      );
    },

    getTopics(apiBase) {
      return jget(`${baseUrl(apiBase)}/topics`);
    },

    createTopic(apiBase, topic, jobDescription) {
      const b = baseUrl(apiBase);
      return jpost(`${b}/topics`, {
        topic: topic || '',
        job_description: jobDescription || '',
        interview_type: 'technical',
        duration_minutes: 30,
      });
    },

    updateTopic(apiBase, topicId, interviewType, durationMinutes) {
      const b = baseUrl(apiBase);
      const body = {};
      if (interviewType != null) body.interview_type = interviewType;
      if (durationMinutes != null) body.duration_minutes = durationMinutes;
      return jpatch(`${b}/topics/${encodeURIComponent(topicId)}`, body);
    },

    analyzeAts(apiBase, cvId, topicId, jobDescriptionRaw) {
      const b = baseUrl(apiBase);
      const body = {};
      if (topicId) body.topic_id = topicId;
      if (cvId) body.cv_id = cvId;
      if (jobDescriptionRaw) body.job_description = jobDescriptionRaw;
      return jpost(`${b}/ats/analyze`, body);
    },

    getAts(apiBase, topicId) {
      const b = baseUrl(apiBase);
      const p = topicId ? `/ats?topic_id=${encodeURIComponent(topicId)}` : '/ats';
      return jget(`${b}${p}`);
    },

    getTopicAttempts(apiBase, topicId) {
      return jget(`${baseUrl(apiBase)}/topics/${encodeURIComponent(topicId)}/attempts`);
    },

    createAttempt(apiBase, topicId) {
      return jpost(`${baseUrl(apiBase)}/topics/${encodeURIComponent(topicId)}/attempts`, {});
    },

    getAttempt(apiBase, attemptId) {
      return jget(`${baseUrl(apiBase)}/attempts/${encodeURIComponent(attemptId)}`);
    },

    addAttemptQuestion(apiBase, attemptId, question, answer, orderIndex) {
      const b = baseUrl(apiBase);
      const body = { question: question || '' };
      if (answer != null) body.answer = answer;
      if (orderIndex != null) body.order_index = orderIndex;
      return jpost(`${b}/attempts/${encodeURIComponent(attemptId)}/questions`, body);
    },

    updateAttemptQuestionAnswer(apiBase, attemptId, questionId, answer) {
      const b = baseUrl(apiBase);
      return jpatch(`${b}/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}`, {
        answer: answer ?? '',
      });
    },

    completeAttempt(apiBase, attemptId, score, evaluationSummary) {
      const b = baseUrl(apiBase);
      return jpatch(`${b}/attempts/${encodeURIComponent(attemptId)}/complete`, {
        score: score ?? 0,
        evaluation_summary: evaluationSummary ?? '',
      });
    },

    generateQuestions(audioBase, jobDescription, cvText, previousQuestions, interviewType, numQuestions) {
      const b = baseUrl(audioBase);
      return jpost(
        `${b}/mock/generate-questions`,
        {
          job_description: jobDescription || '',
          cv_text: cvText || '',
          previous_questions: Array.isArray(previousQuestions) ? previousQuestions : [],
          interview_type: interviewType || 'technical',
          num_questions: numQuestions || 5,
        },
        120000,
      );
    },

    evaluateAttempt(audioBase, questionsAndAnswers) {
      const b = baseUrl(audioBase);
      return jpost(
        `${b}/mock/evaluate-attempt`,
        {
          questions_and_answers: Array.isArray(questionsAndAnswers)
            ? questionsAndAnswers.map((qa) => ({ question: qa.question || '', answer: qa.answer || '' }))
            : [],
        },
        120000,
      );
    },

    compareAttempts(audioBase, attempt1Data, attempt2Data) {
      const b = baseUrl(audioBase);
      const a1 = attempt1Data || {};
      const a2 = attempt2Data || {};
      return jpost(
        `${b}/mock/compare-attempts`,
        {
          attempt_1: {
            score: a1.score,
            evaluation_summary: a1.evaluation_summary || '',
            questions_and_answers: Array.isArray(a1.questions_and_answers)
              ? a1.questions_and_answers.map((qa) => ({ question: qa.question || '', answer: qa.answer || '' }))
              : [],
          },
          attempt_2: {
            score: a2.score,
            evaluation_summary: a2.evaluation_summary || '',
            questions_and_answers: Array.isArray(a2.questions_and_answers)
              ? a2.questions_and_answers.map((qa) => ({ question: qa.question || '', answer: qa.answer || '' }))
              : [],
          },
        },
        120000,
      );
    },
  };
})();
