import { Terminal } from "./node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "./node_modules/@xterm/addon-fit/lib/addon-fit.mjs";
import { SearchAddon } from "./node_modules/@xterm/addon-search/lib/addon-search.mjs";

const TONES = ["green", "cyan", "orange", "purple", "red"];
const VOICE_CLEANUP_STORAGE_KEY = "ade.voiceCleanupEnabled";
const HOTKEYS_STORAGE_KEY = "ade.hotkeys";
const HOTKEY_CAPTURE_HELP =
  "Press a row to record a new shortcut. Plain keys are allowed, but only fire outside terminal focus. Esc cancels capture.";
const HOTKEY_ACTIONS = {
  voiceToggle: {
    label: "voice transcription",
    description: "Start or stop push-to-talk transcription for the active pane.",
    defaultBinding: { code: "KeyV", primary: true, alt: false, shift: true }
  },
  findTerminal: {
    label: "find terminal",
    description: "Search within the active terminal pane.",
    defaultBinding: { code: "KeyF", primary: true, alt: false, shift: false }
  },
  nextWorkspace: {
    label: "next workspace",
    description: "Switch to the next workspace tab.",
    defaultBinding: { code: "Tab", primary: true, alt: false, shift: false }
  },
  addPane: {
    label: "add pane",
    description: "Create another terminal pane inside the current workspace.",
    defaultBinding: { code: "KeyT", primary: true, alt: false, shift: true }
  },
  removePane: {
    label: "close pane",
    description: "Close the active terminal pane. If it is the last pane, the workspace closes.",
    defaultBinding: { code: "Backspace", primary: true, alt: false, shift: true }
  }
};
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
const SEARCH_DECORATIONS = {
  matchBackground: "#223050",
  matchBorder: "#31527a",
  matchOverviewRuler: "#31527a",
  activeMatchBackground: "#4a2b0d",
  activeMatchBorder: "#d06a1f",
  activeMatchColorOverviewRuler: "#d06a1f"
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
let hotkeys = loadHotkeys();
let hotkeyCaptureActionId = null;

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
const keysToggle = document.getElementById("keys-toggle");
const voiceToggle = document.getElementById("voice-toggle");
const voiceCleanToggle = document.getElementById("voice-clean-toggle");
const voiceStatus = document.getElementById("voice-status");
const hotkeysDialog = document.getElementById("hotkeys-dialog");
const hotkeysHelp = document.getElementById("hotkeys-help");
const hotkeysList = document.getElementById("hotkey-list");
const hotkeysReset = document.getElementById("hotkeys-reset");
const hotkeysClose = document.getElementById("hotkeys-close");

// ── Terminal helpers ───────────────────────────────

function createTermInstance() {
  const term = new Terminal({
    // SearchAddon relies on terminal decorations, which require proposed API opt-in.
    allowProposedApi: true,
    fontFamily: '"SFMono-Regular","Cascadia Mono","JetBrains Mono","Menlo","Consolas",monospace',
    fontSize: 12,
    lineHeight: 1.2,
    cursorBlink: true,
    allowTransparency: true,
    scrollback: 10000,
    windowsPty: getWindowsPtyOptions(),
    theme: TERM_THEME
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  return { term, fitAddon };
}

function getWindowsPtyOptions() {
  if (runtimeInfo?.platform !== "win32") {
    return undefined;
  }

  const buildNumber = Number.parseInt(runtimeInfo?.osRelease?.split(".").at(-1) || "", 10);

  return {
    backend: "conpty",
    buildNumber: Number.isFinite(buildNumber) ? buildNumber : undefined
  };
}

function terminalMouseModeCapturesWheel(term) {
  return ["vt200", "drag", "any"].includes(term.modes.mouseTrackingMode);
}

function getWheelScrollLineCount(event) {
  if (!event.deltaY) {
    return 0;
  }

  const wheelLineHeight =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 1
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 12
        : 40;
  const rawAmount = event.deltaY / wheelLineHeight;
  const magnitude = Math.max(1, Math.round(Math.abs(rawAmount)));
  return magnitude * Math.sign(rawAmount);
}

function installTerminalWheelScroll(pane) {
  const { term } = pane;

  term.attachCustomWheelEventHandler(event => {
    const buffer = term.buffer.active;
    const hasNormalScrollback = buffer.type === "normal" && buffer.baseY > 0;
    const lineCount = getWheelScrollLineCount(event);

    if (!lineCount) {
      return true;
    }

    if (hasNormalScrollback && terminalMouseModeCapturesWheel(term)) {
      event.preventDefault();
      event.stopPropagation();
      term.scrollLines(lineCount);
      return false;
    }

    return true;
  });
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

function getWorkspaceById(id) {
  return workspaces.find(workspace => workspace.id === id) || null;
}

function getActiveWorkspace() {
  return getWorkspaceById(activeWorkspaceId);
}

function getGridLayout(paneCount) {
  if (GRID_LAYOUTS[paneCount]) {
    return GRID_LAYOUTS[paneCount];
  }

  const rows = Math.max(1, Math.ceil(Math.sqrt(paneCount / 1.8)));
  const cols = Math.max(1, Math.ceil(paneCount / rows));
  return { cols, rows };
}

function setActivePane(pane, { focusTerminal = true } = {}) {
  document.querySelectorAll(".pane.active").forEach(activePane => {
    activePane.classList.remove("active");
  });

  if (!pane) {
    activePaneRef = null;
    return;
  }

  pane.paneEl.classList.add("active");
  activePaneRef = pane.paneEl;

  if (focusTerminal) {
    pane.term.focus();
  }
}

function cloneBinding(binding) {
  return binding ? { ...binding } : null;
}

function isModifierCode(code) {
  return [
    "ControlLeft",
    "ControlRight",
    "MetaLeft",
    "MetaRight",
    "AltLeft",
    "AltRight",
    "ShiftLeft",
    "ShiftRight"
  ].includes(code);
}

function normalizeHotkeyBinding(binding) {
  if (binding == null) {
    return null;
  }

  if (typeof binding !== "object" || typeof binding.code !== "string" || !binding.code) {
    return null;
  }

  return {
    code: binding.code,
    primary: Boolean(binding.primary),
    alt: Boolean(binding.alt),
    shift: Boolean(binding.shift)
  };
}

function getDefaultHotkeys() {
  return Object.fromEntries(
    Object.entries(HOTKEY_ACTIONS).map(([actionId, action]) => [
      actionId,
      cloneBinding(action.defaultBinding)
    ])
  );
}

function loadHotkeys() {
  const defaults = getDefaultHotkeys();

  try {
    const raw = window.localStorage.getItem(HOTKEYS_STORAGE_KEY);

    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }

    const loaded = { ...defaults };

    for (const actionId of Object.keys(HOTKEY_ACTIONS)) {
      if (Object.prototype.hasOwnProperty.call(parsed, actionId)) {
        loaded[actionId] = normalizeHotkeyBinding(parsed[actionId]);
      }
    }

    return loaded;
  } catch {
    return defaults;
  }
}

function saveHotkeys() {
  try {
    window.localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(hotkeys));
  } catch {
    // Ignore localStorage failures in restricted runtimes.
  }

  void syncReservedHotkeys();
}

function getHotkeyBinding(actionId) {
  return hotkeys[actionId] ?? cloneBinding(HOTKEY_ACTIONS[actionId]?.defaultBinding) ?? null;
}

function isReservedHotkeyEligible(binding) {
  return Boolean(binding) && (binding.primary || binding.alt);
}

function syncReservedHotkeys() {
  if (!window.adeDesktop?.setReservedHotkeys) {
    return Promise.resolve();
  }

  return window.adeDesktop.setReservedHotkeys({
    nextWorkspace: isReservedHotkeyEligible(getHotkeyBinding("nextWorkspace"))
      ? getHotkeyBinding("nextWorkspace")
      : null,
    findTerminal: isReservedHotkeyEligible(getHotkeyBinding("findTerminal"))
      ? getHotkeyBinding("findTerminal")
      : null
  });
}

function getPrimaryModifierLabel() {
  return runtimeInfo?.platform === "darwin" ? "Cmd" : "Ctrl";
}

function getAltModifierLabel() {
  return runtimeInfo?.platform === "darwin" ? "Option" : "Alt";
}

function formatHotkeyCode(code) {
  const keyMap = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Space: "Space",
    Escape: "Esc",
    Backspace: "Backspace",
    Enter: "Enter",
    Tab: "Tab",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "Page Up",
    PageDown: "Page Down",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
  };

  if (keyMap[code]) {
    return keyMap[code];
  }

  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  if (/^F\d{1,2}$/.test(code)) {
    return code;
  }

  return code;
}

function formatHotkeyLabel(binding) {
  if (!binding) {
    return "unassigned";
  }

  const parts = [];

  if (binding.primary) {
    parts.push(getPrimaryModifierLabel());
  }

  if (binding.alt) {
    parts.push(getAltModifierLabel());
  }

  if (binding.shift) {
    parts.push("Shift");
  }

  parts.push(formatHotkeyCode(binding.code));
  return parts.join("+");
}

function bindingsEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  return (
    a.code === b.code &&
    a.primary === b.primary &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

function findHotkeyConflict(actionId, binding) {
  for (const otherActionId of Object.keys(HOTKEY_ACTIONS)) {
    if (otherActionId === actionId) {
      continue;
    }

    if (bindingsEqual(getHotkeyBinding(otherActionId), binding)) {
      return otherActionId;
    }
  }

  return null;
}

function hotkeyMatchesEvent(binding, event) {
  if (!binding || event.code !== binding.code) {
    return false;
  }

  const primaryPressed = event.ctrlKey || event.metaKey;
  return (
    primaryPressed === binding.primary &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift
  );
}

function bindingNeedsSafeFocus(binding) {
  return Boolean(binding) && !binding.primary && !binding.alt;
}

function isTerminalFocusTarget(target) {
  return (
    target instanceof Element &&
    Boolean(target.closest(".terminal-host, .xterm, .xterm-helper-textarea"))
  );
}

function isEditableFocusTarget(target) {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function shouldBlockBindingForFocus(binding, event) {
  if (!bindingNeedsSafeFocus(binding)) {
    return false;
  }

  const eventTarget = event.target;
  const activeElement = document.activeElement;

  return (
    isEditableFocusTarget(eventTarget) ||
    isEditableFocusTarget(activeElement) ||
    isTerminalFocusTarget(eventTarget) ||
    isTerminalFocusTarget(activeElement)
  );
}

function hotkeyFromEvent(event) {
  if (isModifierCode(event.code)) {
    return null;
  }

  const binding = {
    code: event.code,
    primary: event.ctrlKey || event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey
  };
  return binding;
}

function getHotkeyLabel(actionId) {
  return formatHotkeyLabel(getHotkeyBinding(actionId));
}

function setHotkeysHelp(text = HOTKEY_CAPTURE_HELP) {
  if (hotkeysHelp) {
    hotkeysHelp.textContent = text;
  }
}

function refreshHotkeyUi() {
  if (keysToggle) {
    keysToggle.title = "adjust hotkeys";
  }

  refreshVoiceToggle();

  if (hotkeysDialog?.classList.contains("open")) {
    renderHotkeyList();
  }
}

function updatePaneSearchResults(pane, results = null) {
  if (!pane?.searchCountEl) {
    return;
  }

  if (!pane.searchInput?.value) {
    pane.searchCountEl.textContent = "";
    return;
  }

  if (!results || !results.resultCount) {
    pane.searchCountEl.textContent = "0/0";
    return;
  }

  if (results.resultIndex >= 0) {
    pane.searchCountEl.textContent = `${results.resultIndex + 1}/${results.resultCount}`;
    return;
  }

  pane.searchCountEl.textContent = `${results.resultCount}+`;
}

function runPaneSearch(pane, direction = "next", { incremental = false } = {}) {
  if (!pane?.searchAddon || !pane.searchInput) {
    return false;
  }

  const term = pane.searchInput.value;

  if (!term) {
    pane.searchAddon.clearDecorations();
    updatePaneSearchResults(pane);
    return false;
  }

  const searchOptions = {
    incremental: direction === "next" ? incremental : false,
    decorations: SEARCH_DECORATIONS
  };

  try {
    return direction === "previous"
      ? pane.searchAddon.findPrevious(term, searchOptions)
      : pane.searchAddon.findNext(term, searchOptions);
  } catch (error) {
    logApp("terminal-search", "search failed", {
      message: error?.message || String(error),
      direction,
      term
    });
    pane.searchCountEl.textContent = "err";
    return false;
  }
}

function closePaneSearch(pane, { focusTerminal = true } = {}) {
  if (!pane?.searchEl) {
    return;
  }

  pane.searchEl.classList.remove("open");
  pane.searchAddon?.clearDecorations();
  updatePaneSearchResults(pane);

  if (focusTerminal) {
    setActivePane(pane);
  }
}

function openPaneSearch(pane) {
  if (!pane?.searchEl || !pane.searchInput) {
    return false;
  }

  pane.searchEl.classList.add("open");
  setActivePane(pane, { focusTerminal: false });

  if (pane.searchInput.value) {
    runPaneSearch(pane, "next", { incremental: true });
  } else {
    updatePaneSearchResults(pane);
  }

  requestAnimationFrame(() => {
    pane.searchInput.focus();
    pane.searchInput.select();
  });

  return true;
}

function openActivePaneSearch() {
  const activePane = getActivePaneRecord();
  const pane = activePane || getActiveWorkspace()?.panes[0] || null;

  if (!pane) {
    return false;
  }

  return openPaneSearch(pane);
}

function installTerminalSearchHotkey(term, pane) {
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== "keydown" || dialog.classList.contains("open") || hotkeysDialog?.classList.contains("open")) {
      return true;
    }

    const binding = getHotkeyBinding("findTerminal");

    if (!hotkeyMatchesEvent(binding, event) || shouldBlockBindingForFocus(binding, event)) {
      return true;
    }

    event.preventDefault();
    openPaneSearch(pane);
    return false;
  });
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
  const voiceShortcutLabel = getHotkeyLabel("voiceToggle");
  const waitingForModel =
    !voiceBackendReady &&
    voiceStatus.textContent.startsWith("loading voice");

  if (voiceTranscribing) {
    voiceToggle.textContent = "wait";
    voiceToggle.title = `Transcribing recorded audio (${voiceShortcutLabel})`;
    voiceToggle.disabled = true;
    return;
  }

  if (voiceRecording) {
    voiceToggle.textContent = "stop";
    voiceToggle.title = `Stop recording and transcribe (${voiceShortcutLabel})`;
    voiceToggle.disabled = false;
    return;
  }

  voiceToggle.textContent = "mic";
  voiceToggle.title = `Start push-to-talk recording (${voiceShortcutLabel})`;
  voiceToggle.disabled = !voiceAvailable || unsupported || waitingForModel;
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

async function createWorkspacePane(ws, { cwd = ws.cwd, profileId = ws.profileId } = {}) {
  const startingProfileId = getProfileById(profileId)?.id || ws.profileId || defaultProfileId || profiles[0]?.id || null;
  const { term, fitAddon } = createTermInstance();
  const searchAddon = new SearchAddon();
  const pane = {
    paneEl: document.createElement("section"),
    term,
    fitAddon,
    searchAddon,
    searchResultsDisposable: null,
    resizeObserver: null,
    sessionId: null,
    host: null,
    pathEl: null,
    runtimeSelect: null,
    searchEl: null,
    searchInput: null,
    searchCountEl: null,
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
    <div class="pane-search">
      <input class="pane-search-input" type="text" placeholder="find in terminal" spellcheck="false">
      <span class="pane-search-count"></span>
      <button class="pane-search-btn" type="button" data-search-nav="previous" title="previous match">prev</button>
      <button class="pane-search-btn" type="button" data-search-nav="next" title="next match">next</button>
      <button class="pane-search-btn" type="button" data-search-close title="close search">done</button>
    </div>
    <div class="terminal-host"></div>
  `;

  pane.host = pane.paneEl.querySelector(".terminal-host");
  pane.pathEl = pane.paneEl.querySelector(".pane-path");
  pane.runtimeSelect = pane.paneEl.querySelector(".pane-profile-select");
  pane.searchEl = pane.paneEl.querySelector(".pane-search");
  pane.searchInput = pane.paneEl.querySelector(".pane-search-input");
  pane.searchCountEl = pane.paneEl.querySelector(".pane-search-count");
  pane.runtimeSelect.innerHTML = buildProfileOptions(startingProfileId);
  pane.runtimeSelect.addEventListener("mousedown", () => {
    setActivePane(pane, { focusTerminal: false });
  });
  pane.runtimeSelect.addEventListener("click", event => {
    event.stopPropagation();
  });
  pane.runtimeSelect.addEventListener("change", () => {
    switchPaneProfile(pane, pane.runtimeSelect.value);
  });
  term.open(pane.host);
  term.loadAddon(searchAddon);
  installTerminalWheelScroll(pane);
  installTerminalSearchHotkey(term, pane);

  pane.searchResultsDisposable = searchAddon.onDidChangeResults(results => {
    updatePaneSearchResults(pane, results);
  });
  pane.searchEl.addEventListener("mousedown", () => {
    setActivePane(pane, { focusTerminal: false });
  });
  pane.searchEl.addEventListener("click", event => {
    event.stopPropagation();
  });
  pane.searchInput.addEventListener("focus", () => {
    setActivePane(pane, { focusTerminal: false });
  });
  pane.searchInput.addEventListener("input", () => {
    runPaneSearch(pane, "next", { incremental: true });
  });
  pane.searchInput.addEventListener("keydown", event => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      closePaneSearch(pane);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      runPaneSearch(pane, event.shiftKey ? "previous" : "next");
    }
  });
  pane.searchEl.querySelector('[data-search-nav="previous"]')?.addEventListener("click", () => {
    runPaneSearch(pane, "previous");
  });
  pane.searchEl.querySelector('[data-search-nav="next"]')?.addEventListener("click", () => {
    runPaneSearch(pane, "next");
  });
  pane.searchEl.querySelector("[data-search-close]")?.addEventListener("click", () => {
    closePaneSearch(pane);
  });

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

  pane.paneEl.addEventListener("click", event => {
    if (event.target.closest(".pane-runtime, .pane-search")) {
      setActivePane(pane, { focusTerminal: false });
      return;
    }

    setActivePane(pane);
  });

  await startPaneSession(pane, startingProfileId);
  pane.paneEl.dataset.sessionId = pane.sessionId;
  ws.panes.push(pane);
  ws.paneCount = ws.panes.length;
  return pane;
}

function renderWorkspaceGrid(ws, focusPane = null) {
  const previousWorkspace = getActiveWorkspace();

  if (previousWorkspace) {
    for (const pane of previousWorkspace.panes) {
      pane.resizeObserver.disconnect();
    }
  }

  grid.innerHTML = "";
  activeWorkspaceId = ws.id;

  const layout = getGridLayout(ws.panes.length || ws.paneCount || 1);
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0,1fr))`;
  grid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0,1fr))`;

  for (const pane of ws.panes) {
    grid.appendChild(pane.paneEl);
    pane.resizeObserver.observe(pane.host);
    pane.fitAddon.fit();
  }

  const paneToFocus =
    (focusPane && ws.panes.includes(focusPane) && focusPane) ||
    ws.panes[0] ||
    null;

  setActivePane(paneToFocus);
  renderTabs();
}

async function createWorkspace({ name, cwd, paneCount, profileId }) {
  const id = crypto.randomUUID();
  const tone = TONES[toneIndex % TONES.length];
  toneIndex++;

  const startingProfileId = getProfileById(profileId)?.id || defaultProfileId || profiles[0]?.id || null;
  const ws = { id, name, tone, cwd, paneCount, profileId: startingProfileId, panes: [] };
  workspaces.push(ws);

  for (let i = 0; i < paneCount; i++) {
    await createWorkspacePane(ws, { cwd, profileId: startingProfileId });
  }

  renderTabs();
  switchToWorkspace(id);
  return ws;
}

async function addPaneToActiveWorkspace() {
  const ws = getActiveWorkspace();

  if (!ws) {
    logApp("workspace", "add pane ignored", { reason: "no active workspace" });
    return null;
  }

  const activePane = getActivePaneRecord();
  const paneContext =
    activePane && ws.panes.includes(activePane)
      ? { cwd: activePane.cwd || ws.cwd, profileId: activePane.profileId || ws.profileId }
      : { cwd: ws.cwd, profileId: ws.profileId };

  const pane = await createWorkspacePane(ws, paneContext);
  renderWorkspaceGrid(ws, pane);
  logApp("workspace", "pane added", {
    workspaceId: ws.id,
    paneCount: ws.panes.length,
    profileId: pane.profileId
  });
  return pane;
}

function destroyPane(pane) {
  if (!pane) {
    return;
  }

  pane.resizeObserver.disconnect();
  pane.searchResultsDisposable?.dispose?.();
  pane.term.dispose();

  if (pane.sessionId) {
    window.adeDesktop.closeTerminal(pane.sessionId);
  }
}

function removePaneFromWorkspace(ws, pane) {
  const paneIndex = ws.panes.indexOf(pane);

  if (paneIndex === -1) {
    return null;
  }

  const nextFocusPane = ws.panes[paneIndex + 1] || ws.panes[paneIndex - 1] || null;
  ws.panes.splice(paneIndex, 1);
  ws.paneCount = ws.panes.length;
  destroyPane(pane);
  return nextFocusPane;
}

function removeActivePaneFromWorkspace() {
  const ws = getActiveWorkspace();

  if (!ws) {
    logApp("workspace", "remove pane ignored", { reason: "no active workspace" });
    return false;
  }

  const pane = getActivePaneRecord() || ws.panes[0] || null;

  if (!pane) {
    logApp("workspace", "remove pane ignored", { reason: "no active pane" });
    return false;
  }

  if (ws.panes.length === 1) {
    logApp("workspace", "last pane removed; closing workspace", {
      workspaceId: ws.id
    });
    closeWorkspace(ws.id);
    return true;
  }

  const nextFocusPane = removePaneFromWorkspace(ws, pane);
  renderWorkspaceGrid(ws, nextFocusPane);
  logApp("workspace", "pane removed", {
    workspaceId: ws.id,
    paneCount: ws.panes.length
  });
  return true;
}

function switchToWorkspace(id, { focusPane = null } = {}) {
  const ws = getWorkspaceById(id);

  if (!ws) {
    return;
  }

  renderWorkspaceGrid(ws, focusPane);
}

function cycleWorkspace() {
  if (!workspaces.length) {
    return false;
  }

  const currentIndex = workspaces.findIndex(workspace => workspace.id === activeWorkspaceId);

  if (currentIndex === -1) {
    switchToWorkspace(workspaces[0].id);
    return true;
  }

  if (workspaces.length === 1) {
    return false;
  }

  const nextIndex = (currentIndex + 1) % workspaces.length;
  switchToWorkspace(workspaces[nextIndex].id);
  return true;
}

function closeWorkspace(id) {
  const ws = getWorkspaceById(id);

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
      activePaneRef = null;
      grid.innerHTML = `<div class="empty-state">press + to create a workspace</div>`;
      grid.style.gridTemplateColumns = "1fr";
      grid.style.gridTemplateRows = "1fr";
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

function renderHotkeyList() {
  if (!hotkeysList) {
    return;
  }

  hotkeysList.innerHTML = Object.entries(HOTKEY_ACTIONS)
    .map(([actionId, action]) => {
      const binding = getHotkeyBinding(actionId);
      const isCapturing = hotkeyCaptureActionId === actionId;
      const captureLabel = isCapturing ? "press keys..." : getHotkeyLabel(actionId);
      const clearDisabled = binding ? "" : " disabled";
      const listeningClass = isCapturing ? " listening" : "";

      return `
        <div class="hotkey-row" data-action-id="${escapeHtml(actionId)}">
          <div class="hotkey-meta">
            <div class="hotkey-name">${escapeHtml(action.label)}</div>
            <div class="hotkey-desc">${escapeHtml(action.description)}</div>
          </div>
          <div class="hotkey-controls">
            <button class="hotkey-capture${listeningClass}" data-hotkey-action="${escapeHtml(actionId)}" type="button">${escapeHtml(captureLabel)}</button>
            <button class="hotkey-clear" data-hotkey-clear="${escapeHtml(actionId)}" type="button"${clearDisabled}>clear</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function focusHotkeyCaptureButton(actionId) {
  hotkeysList
    ?.querySelector(`[data-hotkey-action="${actionId}"]`)
    ?.focus();
}

function startHotkeyCapture(actionId) {
  hotkeyCaptureActionId = actionId;
  renderHotkeyList();
  focusHotkeyCaptureButton(actionId);
  setHotkeysHelp(
    `Recording ${HOTKEY_ACTIONS[actionId].label}. Plain keys only fire outside terminal focus. Press a shortcut or Esc to cancel.`
  );
}

function stopHotkeyCapture({ keepMessage = false } = {}) {
  hotkeyCaptureActionId = null;
  renderHotkeyList();

  if (!keepMessage) {
    setHotkeysHelp();
  }
}

function openHotkeysDialog() {
  if (dialog.classList.contains("open")) {
    closeDialog();
  }

  stopHotkeyCapture();
  setHotkeysHelp();
  renderHotkeyList();
  hotkeysDialog.classList.add("open");
  hotkeysList.querySelector(".hotkey-capture")?.focus();
}

function closeHotkeysDialog() {
  stopHotkeyCapture();
  hotkeysDialog.classList.remove("open");
  keysToggle?.focus();
}

function clearHotkey(actionId) {
  hotkeys[actionId] = null;
  saveHotkeys();
  stopHotkeyCapture({
    keepMessage: true
  });
  setHotkeysHelp(`${HOTKEY_ACTIONS[actionId].label} is now unassigned.`);
  refreshHotkeyUi();
}

function resetHotkeysToDefaults() {
  hotkeys = getDefaultHotkeys();
  saveHotkeys();
  stopHotkeyCapture({
    keepMessage: true
  });
  setHotkeysHelp("Hotkeys reset to defaults.");
  refreshHotkeyUi();
}

function applyCapturedHotkey(actionId, binding) {
  const conflictActionId = findHotkeyConflict(actionId, binding);

  if (conflictActionId) {
    setHotkeysHelp(
      `${formatHotkeyLabel(binding)} is already used by ${HOTKEY_ACTIONS[conflictActionId].label}.`
    );
    return;
  }

  hotkeys[actionId] = binding;
  saveHotkeys();
  stopHotkeyCapture({
    keepMessage: true
  });
  setHotkeysHelp(`${HOTKEY_ACTIONS[actionId].label} set to ${formatHotkeyLabel(binding)}.`);
  refreshHotkeyUi();
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
  if (hotkeysDialog.classList.contains("open")) {
    closeHotkeysDialog();
  }

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
keysToggle?.addEventListener("click", openHotkeysDialog);

dialogCancel.addEventListener("click", closeDialog);
hotkeysClose?.addEventListener("click", closeHotkeysDialog);
hotkeysReset?.addEventListener("click", resetHotkeysToDefaults);

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

hotkeysDialog?.addEventListener("click", event => {
  if (event.target === hotkeysDialog) {
    closeHotkeysDialog();
    return;
  }

  const captureButton = event.target.closest("[data-hotkey-action]");

  if (captureButton) {
    startHotkeyCapture(captureButton.dataset.hotkeyAction);
    return;
  }

  const clearButton = event.target.closest("[data-hotkey-clear]");

  if (clearButton) {
    clearHotkey(clearButton.dataset.hotkeyClear);
  }
});

hotkeysDialog?.addEventListener("keydown", event => {
  if (!hotkeysDialog.classList.contains("open")) {
    return;
  }

  if (!hotkeyCaptureActionId) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeHotkeysDialog();
    }

    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    stopHotkeyCapture({
      keepMessage: true
    });
    setHotkeysHelp(`Canceled recording for ${HOTKEY_ACTIONS[hotkeyCaptureActionId].label}.`);
    return;
  }

  const binding = hotkeyFromEvent(event);

  if (!binding) {
    setHotkeysHelp("Modifier-only keys are not valid shortcuts.");
    return;
  }

  applyCapturedHotkey(hotkeyCaptureActionId, binding);
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
  if (event.repeat || dialog.classList.contains("open") || hotkeysDialog?.classList.contains("open")) {
    return;
  }

  if (hotkeyMatchesEvent(getHotkeyBinding("findTerminal"), event)) {
    if (shouldBlockBindingForFocus(getHotkeyBinding("findTerminal"), event)) {
      return;
    }

    event.preventDefault();
    openActivePaneSearch();
    return;
  }

  if (hotkeyMatchesEvent(getHotkeyBinding("nextWorkspace"), event)) {
    if (shouldBlockBindingForFocus(getHotkeyBinding("nextWorkspace"), event)) {
      return;
    }

    event.preventDefault();
    cycleWorkspace();
    return;
  }

  if (hotkeyMatchesEvent(getHotkeyBinding("voiceToggle"), event)) {
    if (shouldBlockBindingForFocus(getHotkeyBinding("voiceToggle"), event)) {
      return;
    }

    event.preventDefault();
    toggleVoiceTyping();
    return;
  }

  if (hotkeyMatchesEvent(getHotkeyBinding("addPane"), event)) {
    if (shouldBlockBindingForFocus(getHotkeyBinding("addPane"), event)) {
      return;
    }

    event.preventDefault();
    void addPaneToActiveWorkspace();
    return;
  }

  if (hotkeyMatchesEvent(getHotkeyBinding("removePane"), event)) {
    if (shouldBlockBindingForFocus(getHotkeyBinding("removePane"), event)) {
      return;
    }

    event.preventDefault();
    removeActivePaneFromWorkspace();
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

window.adeDesktop.onCycleWorkspaceNext(() => {
  if (dialog.classList.contains("open") || hotkeysDialog?.classList.contains("open")) {
    return;
  }

  cycleWorkspace();
});

window.adeDesktop.onOpenTerminalSearch(() => {
  if (dialog.classList.contains("open") || hotkeysDialog?.classList.contains("open")) {
    return;
  }

  openActivePaneSearch();
});

window.adeDesktop.onVoiceStatus(({ status, details }) => {
  logVoice(`backend ${status}`, details);

  if (status === "loading-model" && !voiceRecording && !voiceTranscribing) {
    setVoiceStatus("loading voice model…");
    return;
  }

  if (status === "loading-progress" && !voiceRecording && !voiceTranscribing) {
    const percent =
      typeof details?.progress === "number" ? Math.round(details.progress) : null;
    setVoiceStatus(percent != null ? `loading voice ${percent}%` : "loading voice model…");
    return;
  }

  if (status === "ready") {
    voiceBackendReady = true;

    if (!voiceRecording && !voiceTranscribing && !voiceLastErrorState) {
      setVoiceIdleStatus();
    }
    return;
  }

  if (status === "error") {
    voiceBackendReady = false;
    const message = details?.message ? `voice error: ${details.message}` : "voice model failed";
    setVoiceStatus(message, "unsupported");
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
  await syncReservedHotkeys();
  setHotkeysHelp();
  renderHotkeyList();
  refreshHotkeyUi();
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
