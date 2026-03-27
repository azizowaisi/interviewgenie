const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  authSession: () => ipcRenderer.invoke('auth-session'),
  authLogin: () => ipcRenderer.invoke('auth-login'),
  authLogout: () => ipcRenderer.invoke('auth-logout'),
  sendAudio: (url, audioBytes) => ipcRenderer.invoke('send-audio', url, audioBytes),
  startAudioSession: (url, cvId, topicId) => ipcRenderer.invoke('start-audio-session', url, cvId, topicId),
  sendAudioSegment: (audioBytes) => ipcRenderer.invoke('send-audio-segment', audioBytes),
  sendAudioChunk: (audioBytes) => ipcRenderer.invoke('send-audio-chunk', audioBytes),
  endAudioSession: () => ipcRenderer.invoke('end-audio-session'),
  onAudioStatus: (cb) => {
    ipcRenderer.on('audio-status', (_e, msg) => cb(msg));
  },
  onAudioTranscript: (cb) => {
    ipcRenderer.on('audio-transcript', (_e, text) => cb(text));
  },
  onAudioAnswerChunk: (cb) => {
    ipcRenderer.on('audio-answer-chunk', (_e, token) => cb(token));
  },
  sendTextQuestion: (url, text, cvId, topicId) => ipcRenderer.invoke('send-text-question', url, text, cvId, topicId),
  sendMockQuestion: (question) => ipcRenderer.invoke('send-mock-question', question),
  saveHistory: (apiBase, question, answer, topicId, source, feedback) => ipcRenderer.invoke('save-history', apiBase, question, answer, topicId, source, feedback),
  saveMockFeedback: (apiBase, entryId, feedback) => ipcRenderer.invoke('save-mock-feedback', apiBase, entryId, feedback),
  getMockAnswerFeedback: (audioBase, question, answer) => ipcRenderer.invoke('get-mock-answer-feedback', audioBase, question, answer),
  getHistory: (apiBase, limit, topicId) => ipcRenderer.invoke('get-history', apiBase, limit, topicId),
  getCvList: (apiBase) => ipcRenderer.invoke('get-cv-list', apiBase),
  getCv: (apiBase, cvId) => ipcRenderer.invoke('get-cv', apiBase, cvId),
  uploadCv: (apiBase, filename, fileBuffer) => ipcRenderer.invoke('upload-cv', apiBase, filename, fileBuffer),
  uploadTopicCv: (apiBase, topicId, filename, fileBuffer) => ipcRenderer.invoke('upload-topic-cv', apiBase, topicId, filename, fileBuffer),
  getTopics: (apiBase) => ipcRenderer.invoke('get-topics', apiBase),
  createTopic: (apiBase, topic, jobDescription) => ipcRenderer.invoke('create-topic', apiBase, topic, jobDescription),
  updateTopic: (apiBase, topicId, interviewType, durationMinutes) => ipcRenderer.invoke('update-topic', apiBase, topicId, interviewType, durationMinutes),
  analyzeAts: (apiBase, cvId, topicId, jobDescriptionRaw) => ipcRenderer.invoke('ats-analyze', apiBase, cvId, topicId, jobDescriptionRaw),
  getAts: (apiBase, topicId) => ipcRenderer.invoke('get-ats', apiBase, topicId),
  getTopicAttempts: (apiBase, topicId) => ipcRenderer.invoke('get-topic-attempts', apiBase, topicId),
  createAttempt: (apiBase, topicId) => ipcRenderer.invoke('create-attempt', apiBase, topicId),
  getAttempt: (apiBase, attemptId) => ipcRenderer.invoke('get-attempt', apiBase, attemptId),
  addAttemptQuestion: (apiBase, attemptId, question, answer, orderIndex) => ipcRenderer.invoke('add-attempt-question', apiBase, attemptId, question, answer, orderIndex),
  updateAttemptQuestionAnswer: (apiBase, attemptId, questionId, answer) => ipcRenderer.invoke('update-attempt-question-answer', apiBase, attemptId, questionId, answer),
  completeAttempt: (apiBase, attemptId, score, evaluationSummary) => ipcRenderer.invoke('complete-attempt', apiBase, attemptId, score, evaluationSummary),
  generateQuestions: (audioBase, jobDescription, cvText, previousQuestions, interviewType, numQuestions) => ipcRenderer.invoke('generate-questions', audioBase, jobDescription, cvText, previousQuestions, interviewType, numQuestions),
  evaluateAttempt: (audioBase, questionsAndAnswers) => ipcRenderer.invoke('evaluate-attempt', audioBase, questionsAndAnswers),
  compareAttempts: (audioBase, attempt1Data, attempt2Data) => ipcRenderer.invoke('compare-attempts', audioBase, attempt1Data, attempt2Data),
  onDesktopUpdateAvailable: (cb) => {
    ipcRenderer.on('desktop-update-available', (_e, payload) => cb(payload));
  },
  dismissDesktopUpdate: (latestVersion) => ipcRenderer.invoke('dismiss-desktop-update', latestVersion),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
});
