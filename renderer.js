import { Terminal } from "./node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "./node_modules/@xterm/addon-fit/lib/addon-fit.mjs";

const TONES = ["green", "cyan", "orange", "purple", "red"];
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
  foreground: "#d8deea",
  cursor: "#d8deea",
  cursorAccent: "#090d16",
  selectionBackground: "rgba(97,110,138,.32)",
  black: "#090d16",
  red: "#c04d5b",
  green: "#2bc168",
  yellow: "#cba95c",
  blue: "#4fbad6",
  magenta: "#8a4fe0",
  cyan: "#4fbad6",
  white: "#d8deea",
  brightBlack: "#5e6878",
  brightRed: "#dd6b79",
  brightGreen: "#59d98a",
  brightYellow: "#e0bf73",
  brightBlue: "#72c9df",
  brightMagenta: "#a171e8",
  brightCyan: "#78d5e7",
  brightWhite: "#eef2f8"
};

// ── State ──────────────────────────────────────────

let profiles = [];
let workspaces = [];       // { id, name, tone, cwd, paneCount, panes: [] }
let activeWorkspaceId = null;
let toneIndex = 0;

// ── DOM refs ───────────────────────────────────────

const tabBar = document.getElementById("tab-bar");
const addTabBtn = document.getElementById("add-tab-btn");
const grid = document.getElementById("grid");
const dialog = document.getElementById("new-ws-dialog");
const dialogName = document.getElementById("ws-name");
const dialogPath = document.getElementById("ws-path");
const dialogPanes = document.getElementById("ws-panes");
const dialogCreate = document.getElementById("ws-create");
const dialogCancel = document.getElementById("ws-cancel");
const dialogBrowse = document.getElementById("ws-browse");

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

function chooseProfile() {
  // prefer wsl on windows, first shell otherwise
  return profiles.find(p => p.kind === "wsl") || profiles[0];
}

// ── Workspace management ───────────────────────────

async function createWorkspace({ name, cwd, paneCount }) {
  const id = crypto.randomUUID();
  const tone = TONES[toneIndex % TONES.length];
  toneIndex++;

  const ws = { id, name, tone, cwd, paneCount, panes: [] };
  workspaces.push(ws);

  // spawn terminals
  const profile = chooseProfile();

  for (let i = 0; i < paneCount; i++) {
    const { term, fitAddon } = createTermInstance();

    // create a detached DOM node for this pane
    const paneEl = document.createElement("section");
    paneEl.className = "pane";
    paneEl.innerHTML = `
      <div class="pane-titlebar">
        <div class="traffic"><span></span><span></span><span></span></div>
        <div class="pane-path">starting...</div>
        <div class="pane-runtime">${profile.label}</div>
      </div>
      <div class="terminal-host"></div>
    `;

    const host = paneEl.querySelector(".terminal-host");
    term.open(host);

    const session = await window.adeDesktop.createTerminal({
      profileId: profile.id,
      cwd,
      cols: term.cols,
      rows: term.rows
    });

    paneEl.dataset.sessionId = session.id;
    paneEl.querySelector(".pane-path").textContent = session.title;

    term.onData(data => {
      window.adeDesktop.writeTerminal(session.id, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.adeDesktop.resizeTerminal(session.id, term.cols, term.rows);
    });

    paneEl.addEventListener("click", () => {
      document.querySelectorAll(".pane").forEach(p => p.classList.remove("active"));
      paneEl.classList.add("active");
      term.focus();
    });

    ws.panes.push({ paneEl, term, fitAddon, resizeObserver, sessionId: session.id, host });
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

  closeDialog();
  await createWorkspace({ name, cwd, paneCount });
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
});

// ── Init ───────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

async function init() {
  profiles = await window.adeDesktop.listProfiles();

  if (!profiles.length) {
    grid.innerHTML = `<div class="empty-state">No shell profiles found.</div>`;
    return;
  }

  // create a default workspace in the current directory
  await createWorkspace({ name: "workspace 1", cwd: null, paneCount: 6 });
}

init().catch(error => {
  console.error(error);
  grid.innerHTML = `<div class="empty-state">Failed to start: ${error.message}</div>`;
});
