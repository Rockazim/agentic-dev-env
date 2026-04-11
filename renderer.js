import { Terminal } from "./node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "./node_modules/@xterm/addon-fit/lib/addon-fit.mjs";

const TONES = ["green", "cyan", "orange", "purple", "red"];
const VOICE_CLEANUP_STORAGE_KEY = "ade.voiceCleanupEnabled";
const GRID_LAYOUTS = {
  2: { cols: 2, rows: 1 },
  3: { cols: 3, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  8: { cols: 4, rows: 2 },
  9: { cols: 3, rows: 3 }
};

const TERM_THEME = {
  background: "#090d16",
  foreground: "#e8ecf4",
  cursor: "#e8ecf4",
  cursorAccent: "#090d16",
  selectionBackground: "rgba(120,140,175,.32)",
  black: "#090d16",
  red: "#e06070",
  green: "#45d88a",
  yellow: "#e0c87a",
  blue: "#6ac8e0",
  magenta: "#a87af0",
  cyan: "#6ac8e0",
  white: "#e8ecf4",
  brightBlack: "#7a8599",
  brightRed: "#f08090",
  brightGreen: "#70e8a8",
  brightYellow: "#f0d890",
  brightBlue: "#90d8f0",
  brightMagenta: "#c0a0f8",
  brightCyan: "#90e0f0",
  brightWhite: "#f5f7fb"
};

// ── State ──────────────────────────────────────────

let profiles = [];
let workspaces = [];       // { id, name, tone, cwd, paneCount, panes: [] }
let activeWorkspaceId = null;
let toneIndex = 0;
let activePaneRef = null;
let voiceAvailable = false;
let voicePrimed = false;
let runtimeInfo = null;
let defaultProfileId = null;
let voiceLastErrorState = null;
let voiceRecording = false;
let voiceTranscribing = false;
let voiceMediaStream = null;
let voiceMediaRecorder = null;
let voiceChunks = [];
let voiceWarmupPromise = null;
let voiceBackendReady = false;
let decodeAudioContext = null;
let voiceCleanupEnabled = loadVoiceCleanupPreference();

// ── DOM refs ───────────────────────────────────────

const tabBar = document.getElementById("tab-bar");
const addTabBtn = document.getElementById("add-tab-btn");
const grid = document.getElementById("grid");
const dialog = document.getElementById("new-ws-dialog");
const dialogName = document.getElementById("ws-name");
const dialogPath = document.getElementById("ws-path");
const dialogPanes = document.getElementById("ws-panes");
const dialogProfile = document.getElementById("ws-profile");
const dialogCreate = document.getElementById("ws-create");
const dialogCancel = document.getElementById("ws-cancel");
const dialogBrowse = document.getElementById("ws-browse");
const voiceToggle = document.getElementById("voice-toggle");
const voiceCleanToggle = document.getElementById("voice-clean-toggle");
const voiceStatus = document.getElementById("voice-status");

// ── Terminal helpers ───────────────────────────────

function createTermInstance() {
  const term = new Terminal({
    fontFamily: '"SFMono-Regular","Cascadia Mono","JetBrains Mono","Menlo","Consolas",monospace',
    fontSize: 12,
    lineHeight: 1.2,
    cursorBlink: true,
    allowTransparency: true,
    theme: TERM_THEME
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  return { term, fitAddon };
}

function getProfileById(profileId) {
  return profiles.find(profile => profile.id === profileId) || null;
}

function chooseDefaultProfileId() {
  const isWSL =
    runtimeInfo?.platform === "linux" &&
    typeof runtimeInfo?.osRelease === "string" &&
    runtimeInfo.osRelease.toLowerCase().includes("microsoft");

  if (runtimeInfo?.platform === "win32") {
    return (
      profiles.find(profile => profile.id === "pwsh")?.id ||
      profiles.find(profile => profile.id === "powershell")?.id ||
      profiles.find(profile => profile.kind === "powershell")?.id ||
      profiles.find(profile => profile.id === "cmd")?.id ||
      profiles.find(profile => profile.kind === "wsl")?.id ||
      profiles[0]?.id ||
      null
    );
  }

  if (isWSL) {
    return (
      profiles.find(profile => profile.kind === "wsl")?.id ||
      profiles.find(profile => profile.kind === "shell")?.id ||
      profiles[0]?.id ||
      null
    );
  }

  return (
    profiles.find(profile => profile.kind === "shell")?.id ||
    profiles.find(profile => profile.kind === "powershell")?.id ||
    profiles.find(profile => profile.kind === "cmd")?.id ||
    profiles[0]?.id ||
    null
  );
}

function setSelectValue(selectEl, profileId) {
  if (!selectEl) {
    return;
  }

  const valid = Array.from(selectEl.options).some(option => option.value === profileId);
  selectEl.value = valid ? profileId : selectEl.options[0]?.value || "";
}

function buildProfileOptions(selectedId) {
  return profiles
    .map(profile => {
      const selected = profile.id === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(profile.id)}"${selected}>${escapeHtml(profile.label)}</option>`;
    })
    .join("");
}

function populateWorkspaceProfileSelect(selectedId = defaultProfileId) {
  dialogProfile.innerHTML = buildProfileOptions(selectedId);
  setSelectValue(dialogProfile, selectedId);
}

function updatePaneRuntime(pane) {
  const profile = getProfileById(pane.profileId);

  pane.runtimeSelect.innerHTML = buildProfileOptions(pane.profileId);
  setSelectValue(pane.runtimeSelect, pane.profileId);
  pane.runtimeSelect.title = profile ? `Shell profile: ${profile.label}` : "Shell profile";
}

function getActivePaneRecord() {
  if (!activePaneRef) {
    return null;
  }

  for (const ws of workspaces) {
    const pane = ws.panes.find(item => item.paneEl === activePaneRef);

    if (pane) {
      return pane;
    }
  }

  return null;
}

function loadVoiceCleanupPreference() {
  try {
    const saved = window.localStorage.getItem(VOICE_CLEANUP_STORAGE_KEY);

    if (saved == null) {
      return true;
    }

    return saved !== "false";
  } catch {
    return true;
  }
}

function saveVoiceCleanupPreference() {
  try {
    window.localStorage.setItem(VOICE_CLEANUP_STORAGE_KEY, String(voiceCleanupEnabled));
  } catch {
    // Ignore localStorage failures in restricted runtimes.
  }
}

function refreshVoiceCleanupToggle() {
  if (!voiceCleanToggle) {
    return;
  }

  voiceCleanToggle.classList.toggle("active", voiceCleanupEnabled);
  voiceCleanToggle.setAttribute("aria-pressed", voiceCleanupEnabled ? "true" : "false");
  voiceCleanToggle.textContent = voiceCleanupEnabled ? "clean" : "raw";
  voiceCleanToggle.title = voiceCleanupEnabled
    ? "Transcript cleanup is on"
    : "Transcript cleanup is off";
}

function normalizeTranscriptForLLM(text) {
  let normalized = String(text || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const leadingFillers = [
    /^(?:um+|uh+|erm|hmm+)\b[\s,.-]*/i,
    /^(?:okay|ok|alright|all right|well|so)\b[\s,.-]*/i,
    /^(?:you know|i mean)\b[\s,.-]*/i
  ];

  let strippedLeading = true;

  while (strippedLeading) {
    strippedLeading = false;

    for (const pattern of leadingFillers) {
      if (pattern.test(normalized)) {
        normalized = normalized.replace(pattern, "").trim();
        strippedLeading = true;
      }
    }
  }

  const replacements = [
    [/\bquestion mark\b/gi, "?"],
    [/\bexclamation(?: point| mark)?\b/gi, "!"],
    [/\bfull stop\b/gi, "."],
    [/\bperiod\b/gi, "."],
    [/\bcomma\b/gi, ","],
    [/\bcolon\b/gi, ":"],
    [/\bsemicolon\b/gi, ";"],
    [/\bopen paren(?:thesis)?\b/gi, "("],
    [/\bclose paren(?:thesis)?\b/gi, ")"]
  ];

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized
    .replace(/\b(?:um+|uh+|erm|hmm+)\b/gi, "")
    .replace(/\b(?:you know|i mean)\b/gi, "")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/([,.;:!?])([^\s)\]}])/g, "$1 $2")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const canonicalTerms = [
    [/\bopen\s*ai\b/gi, "OpenAI"],
    [/\bpower\s*shell\b/gi, "PowerShell"],
    [/\bw\s*s\s*l\s*(?:2|two)\b/gi, "WSL 2"],
    [/\bw\s*s\s*l\b/gi, "WSL"],
    [/\bl\s*l\s*m\b/gi, "LLM"],
    [/\bg\s*p\s*t\b/gi, "GPT"],
    [/\ba\s*p\s*i\b/gi, "API"],
    [/\bjava\s*script\b/gi, "JavaScript"],
    [/\btype\s*script\b/gi, "TypeScript"],
    [/\bnode\s*js\b/gi, "Node.js"],
    [/\bvs\s*code\b/gi, "VS Code"],
    [/\bgit\s*hub\b/gi, "GitHub"]
  ];

  for (const [pattern, replacement] of canonicalTerms) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

function setVoiceStatus(text, state = "") {
  voiceStatus.textContent = text;
  voiceStatus.classList.toggle("live", state === "live");
  voiceToggle.classList.toggle("live", state === "live");
  voiceToggle.classList.toggle("unsupported", state === "unsupported");
  voiceLastErrorState = state === "unsupported" ? text : null;
  refreshVoiceToggle();
}

function setVoiceIdleStatus() {
  setVoiceStatus("voice ready");
}

function refreshVoiceToggle() {
  const unsupported =
    voiceStatus.classList.contains("unsupported") &&
    !voiceStatus.textContent.startsWith("typed:");

  if (voiceTranscribing) {
    voiceToggle.textContent = "wait";
    voiceToggle.title = "Transcribing recorded audio";
    voiceToggle.disabled = true;
    return;
  }

  if (voiceRecording) {
    voiceToggle.textContent = "stop";
    voiceToggle.title = "Stop recording and transcribe";
    voiceToggle.disabled = false;
    return;
  }

  voiceToggle.textContent = "mic";
  voiceToggle.title = "Start push-to-talk recording";
  voiceToggle.disabled = !voiceAvailable || unsupported;
}

function logApp(category, message, details) {
  if (window.adeDesktop?.logApp) {
    window.adeDesktop.logApp(category, message, details);
  }
}

function logVoice(message, details) {
  logApp("voice", message, details);
}

function getAudioContextCtor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function getDecodeAudioContext() {
  if (!decodeAudioContext) {
    const AudioContextCtor = getAudioContextCtor();

    if (!AudioContextCtor) {
      throw new Error("AudioContext is not available in this runtime.");
    }

    decodeAudioContext = new AudioContextCtor();
  }

  return decodeAudioContext;
}

async function ensureMicrophoneAccess() {
  if (voiceMediaStream?.active && voicePrimed) {
    logVoice("microphone priming skipped", {
      primed: voicePrimed,
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      streamActive: true
    });
    return voiceMediaStream;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia is not available in this runtime.");
  }

  logVoice("requesting microphone access");
  voiceMediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  voicePrimed = true;
  logVoice("microphone access granted");
  return voiceMediaStream;
}

function initVoiceTyping() {
  const AudioContextCtor = getAudioContextCtor();

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !AudioContextCtor) {
    logVoice("local voice backend unavailable in renderer", {
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      hasMediaRecorder: Boolean(window.MediaRecorder),
      hasAudioContext: Boolean(AudioContextCtor)
    });
    setVoiceStatus("voice unavailable", "unsupported");
    voiceToggle.disabled = true;
    return;
  }

  logVoice("local voice backend initialized", {
    runtime: runtimeInfo,
    hasMediaRecorder: true,
    hasAudioContext: true
  });
  voiceAvailable = true;
  refreshVoiceCleanupToggle();
  setVoiceStatus("loading voice model…");
  void ensureVoiceBackendReady();
}

async function ensureVoiceBackendReady() {
  if (voiceBackendReady) {
    return;
  }

  if (!voiceWarmupPromise) {
    logVoice("warming transcription backend");
    voiceWarmupPromise = window.adeDesktop
      .warmVoiceTranscriber()
      .then(() => {
        voiceBackendReady = true;
        logVoice("transcription backend ready");

        if (!voiceRecording && !voiceTranscribing && !voiceLastErrorState) {
          setVoiceIdleStatus();
        }
      })
      .catch(error => {
        voiceWarmupPromise = null;
        voiceBackendReady = false;
        logVoice("transcription backend failed to load", {
          message: error?.message || String(error)
        });
        setVoiceStatus("voice model failed", "unsupported");
        throw error;
      });
  }

  return voiceWarmupPromise;
}

function mixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const mono = new Float32Array(audioBuffer.length);

  for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex);

    for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
      mono[sampleIndex] += channel[sampleIndex];
    }
  }

  const scale = 1 / audioBuffer.numberOfChannels;

  for (let sampleIndex = 0; sampleIndex < mono.length; sampleIndex += 1) {
    mono[sampleIndex] *= scale;
  }

  return mono;
}

async function decodeBlobToSamples(blob, targetSampleRate = 16000) {
  const audioContext = getDecodeAudioContext();
  const sourceBuffer = await blob.arrayBuffer();
  const decoded = await audioContext.decodeAudioData(sourceBuffer.slice(0));
  const mono = mixToMono(decoded);

  if (decoded.sampleRate === targetSampleRate) {
    return mono;
  }

  const offlineContext = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * targetSampleRate),
    targetSampleRate
  );
  const monoBuffer = offlineContext.createBuffer(1, mono.length, decoded.sampleRate);
  monoBuffer.copyToChannel(mono, 0);

  const bufferSource = offlineContext.createBufferSource();
  bufferSource.buffer = monoBuffer;
  bufferSource.connect(offlineContext.destination);
  bufferSource.start(0);

  const rendered = await offlineContext.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

function getPreferredRecorderMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ];

  return candidates.find(type => window.MediaRecorder.isTypeSupported(type)) || "";
}

async function startVoiceRecording() {
  if (voiceRecording || voiceTranscribing) {
    return;
  }

  const pane = getActivePaneRecord();

  if (!pane) {
    setVoiceStatus("no active pane", "unsupported");
    logVoice("recording blocked because there is no active pane");
    return;
  }

  await ensureVoiceBackendReady();
  const stream = await ensureMicrophoneAccess();
  const mimeType = getPreferredRecorderMimeType();

  voiceChunks = [];
  voiceMediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  voiceMediaRecorder.addEventListener("dataavailable", event => {
    if (event.data?.size) {
      voiceChunks.push(event.data);
      logVoice("recorded audio chunk", { bytes: event.data.size });
    }
  });

  voiceMediaRecorder.addEventListener("error", event => {
    const error = event.error || new Error("Unknown MediaRecorder error");
    logVoice("recording error", { message: error.message || String(error) });
    setVoiceStatus("recording failed", "unsupported");
  });

  voiceRecording = true;
  voiceLastErrorState = null;
  logVoice("recording started", {
    mimeType: voiceMediaRecorder.mimeType || mimeType || "default"
  });
  setVoiceStatus("recording… click stop to transcribe", "live");
  voiceMediaRecorder.start(750);
}

async function stopVoiceRecording() {
  if (!voiceMediaRecorder || !voiceRecording) {
    return null;
  }

  const recorder = voiceMediaRecorder;

  const blobPromise = new Promise((resolve, reject) => {
    recorder.addEventListener(
      "stop",
      () => {
        const blob = new Blob(voiceChunks, {
          type: recorder.mimeType || "audio/webm"
        });
        resolve(blob);
      },
      { once: true }
    );
    recorder.addEventListener(
      "error",
      event => {
        reject(event.error || new Error("Unknown MediaRecorder stop error"));
      },
      { once: true }
    );
  });

  voiceRecording = false;
  voiceMediaRecorder = null;
  logVoice("recording stopping");
  setVoiceStatus("processing audio…");
  recorder.stop();
  return blobPromise;
}

async function transcribeRecordedAudio(blob) {
  if (!blob || !blob.size) {
    logVoice("transcription skipped because no audio was captured");
    setVoiceStatus("no audio captured", "unsupported");
    return;
  }

  const pane = getActivePaneRecord();

  if (!pane) {
    setVoiceStatus("no active pane", "unsupported");
    logVoice("transcription blocked because there is no active pane");
    return;
  }

  voiceTranscribing = true;
  refreshVoiceToggle();

  try {
    logVoice("decoding recorded audio", { bytes: blob.size });
    setVoiceStatus("transcribing…");
    const samples = await decodeBlobToSamples(blob);
    logVoice("decoded audio samples", {
      sampleCount: samples.length,
      durationSeconds: Number((samples.length / 16000).toFixed(2))
    });

    const result = await window.adeDesktop.transcribeVoice(samples);
    const rawText = result?.text?.replace(/\s+/g, " ").trim() || "";
    const text = voiceCleanupEnabled ? normalizeTranscriptForLLM(rawText) : rawText;

    if (!text) {
      logVoice("transcription finished with empty text");
      setVoiceStatus("no speech detected", "unsupported");
      return;
    }

    if (text !== rawText) {
      logVoice("cleaned transcript", { rawText, cleanedText: text });
    } else {
      logVoice("final transcript", { text });
    }

    window.adeDesktop.writeTerminal(pane.sessionId, `${text} `);
    setVoiceStatus(`typed: ${text.slice(0, 28)}`, "live");
  } catch (error) {
    console.error(error);
    logVoice("local transcription failed", {
      message: error?.message || String(error)
    });
    setVoiceStatus("voice transcription failed", "unsupported");
  } finally {
    voiceTranscribing = false;
    refreshVoiceToggle();
  }
}

async function toggleVoiceTyping() {
  if (!voiceAvailable) {
    logVoice("toggle ignored", {
      voiceAvailable,
      hasMediaRecorder: Boolean(window.MediaRecorder)
    });
    return;
  }

  if (voiceTranscribing) {
    logVoice("toggle ignored while transcription is already in progress");
    return;
  }

  try {
    if (!voiceRecording) {
      await startVoiceRecording();
      return;
    }

    const blob = await stopVoiceRecording();
    await transcribeRecordedAudio(blob);
  } catch (error) {
    console.error(error);
    const reason = error?.name || "blocked";
    logVoice("toggle failed", {
      reason,
      message: error?.message || null
    });
    setVoiceStatus(`mic ${reason}`, "unsupported");
  }
}

async function startPaneSession(pane, profileId) {
  const nextProfile = getProfileById(profileId) || getProfileById(defaultProfileId) || profiles[0];

  if (!nextProfile) {
    throw new Error("No shell profiles available on this system.");
  }

  const session = await window.adeDesktop.createTerminal({
    profileId: nextProfile.id,
    cwd: pane.cwd,
    cols: pane.term.cols,
    rows: pane.term.rows
  });

  pane.sessionId = session.id;
  pane.profileId = session.profileId;
  pane.pathEl.textContent = session.title;
  updatePaneRuntime(pane);
}

async function switchPaneProfile(pane, profileId) {
  if (!pane || profileId === pane.profileId) {
    return;
  }

  const previousSessionId = pane.sessionId;
  pane.runtimeSelect.disabled = true;
  pane.suppressedExitId = previousSessionId;
  pane.sessionId = null;

  if (previousSessionId) {
    window.adeDesktop.closeTerminal(previousSessionId);
  }

  pane.term.reset();
  pane.pathEl.textContent = "starting...";

  try {
    await startPaneSession(pane, profileId);
  } catch (error) {
    console.error(error);
    pane.pathEl.textContent = "[failed to start shell]";
  } finally {
    pane.runtimeSelect.disabled = false;
    updatePaneRuntime(pane);
    pane.paneEl.dataset.sessionId = pane.sessionId || "";
    pane.fitAddon.fit();

    if (pane.sessionId) {
      window.adeDesktop.resizeTerminal(pane.sessionId, pane.term.cols, pane.term.rows);
    }
  }
}

// ── Workspace management ───────────────────────────

async function createWorkspace({ name, cwd, paneCount, profileId }) {
  const id = crypto.randomUUID();
  const tone = TONES[toneIndex % TONES.length];
  toneIndex++;

  const startingProfileId = getProfileById(profileId)?.id || defaultProfileId || profiles[0]?.id || null;
  const ws = { id, name, tone, cwd, paneCount, profileId: startingProfileId, panes: [] };
  workspaces.push(ws);

  for (let i = 0; i < paneCount; i++) {
    const { term, fitAddon } = createTermInstance();
    const pane = {
      paneEl: document.createElement("section"),
      term,
      fitAddon,
      resizeObserver: null,
      sessionId: null,
      host: null,
      pathEl: null,
      runtimeSelect: null,
      cwd,
      profileId: startingProfileId,
      suppressedExitId: null
    };

    pane.paneEl.className = "pane";
    pane.paneEl.innerHTML = `
      <div class="pane-titlebar">
        <div class="traffic"><span></span><span></span><span></span></div>
        <div class="pane-path">starting...</div>
        <div class="pane-runtime">
          <select class="pane-profile-select" aria-label="terminal shell"></select>
        </div>
      </div>
      <div class="terminal-host"></div>
    `;

    pane.host = pane.paneEl.querySelector(".terminal-host");
    pane.pathEl = pane.paneEl.querySelector(".pane-path");
    pane.runtimeSelect = pane.paneEl.querySelector(".pane-profile-select");
    pane.runtimeSelect.innerHTML = buildProfileOptions(startingProfileId);
    pane.runtimeSelect.addEventListener("change", () => {
      switchPaneProfile(pane, pane.runtimeSelect.value);
    });
    term.open(pane.host);

    term.onData(data => {
      if (pane.sessionId) {
        window.adeDesktop.writeTerminal(pane.sessionId, data);
      }
    });

    pane.resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (pane.sessionId) {
        window.adeDesktop.resizeTerminal(pane.sessionId, term.cols, term.rows);
      }
    });

    pane.paneEl.addEventListener("click", () => {
      document.querySelectorAll(".pane").forEach(p => p.classList.remove("active"));
      pane.paneEl.classList.add("active");
      activePaneRef = pane.paneEl;
      term.focus();
    });

    await startPaneSession(pane, startingProfileId);
    pane.paneEl.dataset.sessionId = pane.sessionId;
    ws.panes.push(pane);
  }

  renderTabs();
  switchToWorkspace(id);
  return ws;
}

function switchToWorkspace(id) {
  const ws = workspaces.find(w => w.id === id);

  if (!ws) {
    return;
  }

  // detach current panes from DOM (don't destroy)
  grid.innerHTML = "";

  activeWorkspaceId = id;

  // set grid layout
  const layout = GRID_LAYOUTS[ws.paneCount] || GRID_LAYOUTS[6];
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0,1fr))`;
  grid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0,1fr))`;

  // attach panes
  for (const pane of ws.panes) {
    grid.appendChild(pane.paneEl);
    pane.resizeObserver.observe(pane.host);
    pane.fitAddon.fit();
  }

  // focus first pane
  if (ws.panes.length) {
    ws.panes[0].paneEl.classList.add("active");
    activePaneRef = ws.panes[0].paneEl;
    ws.panes[0].term.focus();
  }

  renderTabs();
}

function closeWorkspace(id) {
  const ws = workspaces.find(w => w.id === id);

  if (!ws) {
    return;
  }

  // kill all terminals in this workspace
  for (const pane of ws.panes) {
    pane.resizeObserver.disconnect();
    pane.term.dispose();
    window.adeDesktop.closeTerminal(pane.sessionId);
  }

  workspaces = workspaces.filter(w => w.id !== id);

  if (activeWorkspaceId === id) {
    if (workspaces.length) {
      switchToWorkspace(workspaces[workspaces.length - 1].id);
    } else {
      activeWorkspaceId = null;
      grid.innerHTML = `<div class="empty-state">press + to create a workspace</div>`;
      grid.style.gridTemplateColumns = "1fr";
      grid.style.gridTemplateRows = "1fr";
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

// ── Tab rendering ──────────────────────────────────

function renderTabs() {
  // remove old tabs (keep add button)
  tabBar.querySelectorAll(".workspace-tab").forEach(t => t.remove());

  for (const ws of workspaces) {
    const btn = document.createElement("button");
    btn.className = "workspace-tab" + (ws.id === activeWorkspaceId ? " active" : "");
    btn.type = "button";
    btn.dataset.tone = ws.tone;
    btn.innerHTML = `
      <span class="dot"></span>
      <span class="label">${escapeHtml(ws.name)}</span>
      <span class="count">${ws.panes.length}</span>
      <span class="tab-close" title="close workspace">&times;</span>
    `;

    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close")) {
        closeWorkspace(ws.id);
      } else {
        switchToWorkspace(ws.id);
      }
    });

    tabBar.insertBefore(btn, addTabBtn);
  }
}

// ── Dialog ─────────────────────────────────────────

function openDialog() {
  dialogName.value = "";
  dialogPath.value = "";
  dialogPanes.value = "6";
  populateWorkspaceProfileSelect();
  dialog.classList.add("open");
  dialogName.focus();
}

function closeDialog() {
  dialog.classList.remove("open");
}

addTabBtn.addEventListener("click", openDialog);

dialogCancel.addEventListener("click", closeDialog);

dialogBrowse.addEventListener("click", async () => {
  const dir = await window.adeDesktop.pickDirectory();

  if (dir) {
    dialogPath.value = dir;

    if (!dialogName.value) {
      // auto-fill name from folder name
      const parts = dir.replace(/\\/g, "/").split("/");
      dialogName.value = parts[parts.length - 1] || dir;
    }
  }
});

dialogCreate.addEventListener("click", async () => {
  const name = dialogName.value.trim() || "workspace";
  const cwd = dialogPath.value.trim() || null;
  const paneCount = parseInt(dialogPanes.value, 10) || 6;
  const profileId = dialogProfile.value || defaultProfileId;

  closeDialog();
  await createWorkspace({ name, cwd, paneCount, profileId });
});

// allow Enter to submit from name or path fields
[dialogName, dialogPath].forEach(input => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      dialogCreate.click();
    } else if (e.key === "Escape") {
      closeDialog();
    }
  });
});

dialog.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDialog();
  }
});

voiceToggle.addEventListener("click", () => {
  toggleVoiceTyping();
});

if (voiceCleanToggle) {
  voiceCleanToggle.addEventListener("click", () => {
    voiceCleanupEnabled = !voiceCleanupEnabled;
    saveVoiceCleanupPreference();
    refreshVoiceCleanupToggle();
    logVoice("transcript cleanup toggled", { enabled: voiceCleanupEnabled });
  });
}

window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
    event.preventDefault();
    toggleVoiceTyping();
  }
});

// ── Terminal data/exit listeners ───────────────────

window.adeDesktop.onTerminalData(({ id, data }) => {
  for (const ws of workspaces) {
    const pane = ws.panes.find(p => p.sessionId === id);

    if (pane) {
      pane.term.write(data);
      break;
    }
  }
});

window.adeDesktop.onTerminalExit(({ id, exitCode }) => {
  for (const ws of workspaces) {
    const pane = ws.panes.find(p => p.sessionId === id);

    if (pane) {
      pane.term.writeln("");
      pane.term.writeln(`\x1b[90m[process exited with code ${exitCode}]\x1b[0m`);
      break;
    }

    const suppressedPane = ws.panes.find(p => p.suppressedExitId === id);

    if (suppressedPane) {
      suppressedPane.suppressedExitId = null;
      break;
    }
  }
});

window.adeDesktop.onVoiceStatus(({ status, details }) => {
  logVoice(`backend ${status}`, details);

  if (status === "loading-model" && !voiceRecording && !voiceTranscribing) {
    setVoiceStatus("loading voice model…");
    return;
  }

  if (status === "loading-progress" && !voiceRecording && !voiceTranscribing) {
    const percent =
      typeof details?.progress === "number" ? Math.round(details.progress * 100) : null;
    setVoiceStatus(percent != null ? `loading voice ${percent}%` : "loading voice model…");
    return;
  }

  if (status === "ready") {
    voiceBackendReady = true;

    if (!voiceRecording && !voiceTranscribing && !voiceLastErrorState) {
      setVoiceIdleStatus();
    }
  }
});

// ── Cleanup ────────────────────────────────────────

window.addEventListener("beforeunload", () => {
  for (const ws of workspaces) {
    for (const pane of ws.panes) {
      pane.resizeObserver.disconnect();
      window.adeDesktop.closeTerminal(pane.sessionId);
    }
  }

  if (voiceMediaStream) {
    voiceMediaStream.getTracks().forEach(track => track.stop());
    voiceMediaStream = null;
  }
});

// ── Init ───────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

async function init() {
  runtimeInfo = await window.adeDesktop.getRuntimeInfo();
  profiles = await window.adeDesktop.listProfiles();
  defaultProfileId = chooseDefaultProfileId();
  refreshVoiceCleanupToggle();
  initVoiceTyping();

  if (!profiles.length) {
    grid.innerHTML = `<div class="empty-state">No shell profiles found.</div>`;
    return;
  }

  populateWorkspaceProfileSelect();
  await createWorkspace({
    name: "workspace 1",
    cwd: null,
    paneCount: 6,
    profileId: defaultProfileId
  });
}

init().catch(error => {
  console.error(error);
  grid.innerHTML = `<div class="empty-state">Failed to start: ${error.message}</div>`;
});
