// Hidden Voice window: wake word ("Hey Odyssync") + ElevenLabs voice agent.
// Libraries come in as plain scripts from index.html:
//   ElevenLabsClient (@elevenlabs/client), WebVoiceProcessor, PorcupineWeb.
(function () {
  const api = window.odyssyncVoice;
  const { Conversation } = window.ElevenLabsClient;
  const { WebVoiceProcessor } = window.WebVoiceProcessor;
  const { PorcupineWorker } = window.PorcupineWeb;

  const TOOLS = ['list_members', 'set_mode', 'send_current', 'show_send_menu', 'send_items'];
  const SILENCE_MS = 8000;      // end the chat after 8 s of quiet once the agent has spoken
  const VAD_SPEECH = 0.5;       // voice-activity score that counts as "the user is talking"

  let config = { agentId: '', accessKey: '', keywordPath: '', modelPath: '' };
  let porcupine = null;         // wake-word engine, or null when not set up
  let session = null;           // { conversation, ended, endWanted } while a chat is running
  let silenceTimer = null;

  // ---- wake word ----

  async function setupWakeWord() {
    const { accessKey, keywordPath, modelPath } = config;
    if (!accessKey || !keywordPath || !modelPath) {
      console.log('Wake word off: missing',
        [!accessKey && 'Picovoice AccessKey', !keywordPath && 'hey-odyssync.ppn', !modelPath && 'porcupine_params.pv']
          .filter(Boolean).join(', '), '- the hotkey still works.');
      return;
    }
    try {
      porcupine = await PorcupineWorker.create(
        accessKey,
        [{ publicPath: keywordPath, label: 'Hey Odyssync', forceWrite: true }],
        () => { if (!session) startSession(); },
        { publicPath: modelPath, forceWrite: true },
        { processErrorCallback: (err) => console.log('Wake word error:', err && err.message) },
      );
      await resumeWakeWord();
    } catch (err) {
      porcupine = null;
      console.log('Wake word off:', err && err.message);
    }
  }

  async function pauseWakeWord() {
    if (!porcupine) return;
    try { await WebVoiceProcessor.unsubscribe(porcupine); } catch (err) { console.log('Wake word pause:', err && err.message); }
  }

  async function resumeWakeWord() {
    if (!porcupine) return;
    try { await WebVoiceProcessor.subscribe(porcupine); } catch (err) { console.log('Wake word listen:', err && err.message); }
  }

  // ---- silence timer ----

  function startSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => endSession(), SILENCE_MS);
  }

  function clearSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  // ---- errors ----

  function isMicError(err) {
    const name = err && err.name;
    const text = String((err && err.message) || err || '').toLowerCase();
    return ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError', 'OverconstrainedError'].includes(name)
      || text.includes('permission') || text.includes('microphone');
  }

  // ---- voice session ----

  function clientTools() {
    const tools = {};
    for (const name of TOOLS) {
      tools[name] = async (params) => {
        try {
          const result = await api.tool(name, params || {});
          return typeof result === 'string' ? result : JSON.stringify(result === undefined ? null : result);
        } catch (err) {
          return JSON.stringify({ ok: false, error: (err && err.message) || 'Something went wrong' });
        }
      };
    }
    return tools;
  }

  async function startSession() {
    if (session) return;
    if (!config.agentId) {
      api.notice('Voice is not set up yet: add the ElevenLabs agent ID');
      return;
    }
    const s = { conversation: null, ended: false, endWanted: false };
    session = s;
    await pauseWakeWord();                  // free the microphone for the agent
    api.setState('thinking');               // connecting

    // Check the microphone first so we can tell "no mic" apart from "no internet".
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.log('Microphone check failed:', err && err.name, err && err.message);
      api.notice('Microphone is not available');
      return finish(s);
    }
    if (!navigator.onLine) {
      api.notice('Voice needs an internet connection');
      return finish(s);
    }

    try {
      s.conversation = await Conversation.startSession({
        agentId: config.agentId,
        clientTools: clientTools(),
        onModeChange: ({ mode }) => {
          if (s.ended) return;
          if (mode === 'speaking') { clearSilenceTimer(); api.setState('speaking'); }
          else { api.setState('listening'); startSilenceTimer(); }
        },
        onMessage: ({ source, role }) => {
          if (s.ended) return;
          if ((role || source) === 'user') { clearSilenceTimer(); api.setState('thinking'); }
        },
        onVadScore: ({ vadScore }) => {
          if (!s.ended && silenceTimer && vadScore > VAD_SPEECH) startSilenceTimer();
        },
        onError: (message) => console.log('Voice agent error:', message),
        onDisconnect: (details) => {
          if (s.ended) return;
          if (details && details.reason === 'error') {
            console.log('Voice disconnected:', details.message);
            api.notice('Voice needs an internet connection');
          }
          finish(s);
        },
      });
    } catch (err) {
      console.log('Voice session failed:', err && err.message);
      api.notice(isMicError(err) ? 'Microphone is not available' : 'Voice needs an internet connection');
      return finish(s);
    }
    if (s.endWanted) return endSession();   // hotkey pressed again while connecting
    if (!s.ended) { api.setState('listening'); startSilenceTimer(); }
  }

  async function endSession() {
    const s = session;
    if (!s) return;
    if (!s.conversation) { s.endWanted = true; return; }   // still connecting
    const conversation = s.conversation;
    finish(s);
    try { await conversation.endSession(); } catch (err) { console.log('End session:', err && err.message); }
  }

  function finish(s) {
    if (s.ended) return;
    s.ended = true;
    clearSilenceTimer();
    if (session === s) session = null;
    api.setState('idle');
    resumeWakeWord();
  }

  // ---- start ----

  api.onStart(() => { if (session) endSession(); else startSession(); });

  api.getConfig().then((cfg) => {
    config = Object.assign(config, cfg || {});
    if (!config.agentId) console.log('Voice agent off: no ElevenLabs agent ID yet.');
    return setupWakeWord();
  }).catch((err) => console.log('Voice config failed:', err && err.message));
})();
