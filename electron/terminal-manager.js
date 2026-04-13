const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const pty = require("@homebridge/node-pty-prebuilt-multiarch");

function isWSLEnvironment() {
  return (
    process.platform === "linux" &&
    (Boolean(process.env.WSL_DISTRO_NAME) || os.release().toLowerCase().includes("microsoft"))
  );
}

function commandExists(command) {
  if (!command) {
    return false;
  }

  if (path.isAbsolute(command)) {
    return fs.existsSync(command);
  }

  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], {
    stdio: "ignore"
  });

  return result.status === 0;
}

function safeDirectory(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    return targetPath;
  }

  return os.homedir();
}

function toWslPath(inputPath) {
  if (!inputPath) {
    return null;
  }

  const normalized = inputPath.replaceAll("\\", "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);

  if (!match) {
    return normalized;
  }

  const drive = match[1].toLowerCase();
  const rest = match[2];
  return `/mnt/${drive}/${rest}`;
}

function shortPath(targetPath) {
  const home = os.homedir();

  if (targetPath.startsWith(home)) {
    return `~${targetPath.slice(home.length).replaceAll("\\", "/") || ""}`;
  }

  return targetPath.replaceAll("\\", "/");
}

function detectProfiles() {
  if (process.platform === "win32") {
    const profiles = [];

    if (commandExists("pwsh.exe")) {
      profiles.push({
        id: "pwsh",
        label: "PowerShell 7",
        executable: "pwsh.exe",
        args: ["-NoLogo"],
        kind: "powershell"
      });
    }

    profiles.push({
      id: "powershell",
      label: "Windows PowerShell",
      executable: "powershell.exe",
      args: ["-NoLogo"],
      kind: "powershell"
    });

    if (commandExists("wsl.exe")) {
      profiles.push({
        id: "wsl",
        label: "WSL",
        executable: "wsl.exe",
        args: [],
        kind: "wsl"
      });
    }

    if (commandExists("cmd.exe")) {
      profiles.push({
        id: "cmd",
        label: "Command Prompt",
        executable: "cmd.exe",
        args: [],
        kind: "cmd"
      });
    }

    return profiles;
  }

  if (isWSLEnvironment()) {
    const profiles = [];

    if (commandExists("bash")) {
      profiles.push({
        id: "wsl-bash",
        label: `WSL ${process.env.WSL_DISTRO_NAME || "bash"}`,
        executable: "bash",
        args: ["-l"],
        kind: "wsl"
      });
    }

    if (commandExists("pwsh.exe")) {
      profiles.push({
        id: "pwsh",
        label: "PowerShell 7",
        executable: "pwsh.exe",
        args: ["-NoLogo"],
        kind: "powershell"
      });
    }

    if (commandExists("powershell.exe")) {
      profiles.push({
        id: "powershell",
        label: "Windows PowerShell",
        executable: "powershell.exe",
        args: ["-NoLogo"],
        kind: "powershell"
      });
    }

    if (commandExists("cmd.exe")) {
      profiles.push({
        id: "cmd",
        label: "Command Prompt",
        executable: "cmd.exe",
        args: [],
        kind: "cmd"
      });
    }

    if (!profiles.length && commandExists("sh")) {
      profiles.push({
        id: "sh",
        label: "sh",
        executable: "sh",
        args: ["-l"],
        kind: "shell"
      });
    }

    return profiles;
  }

  if (process.platform === "darwin") {
    return [
      {
        id: "zsh",
        label: "zsh",
        executable: commandExists("zsh") ? "zsh" : "/bin/zsh",
        args: ["-l"],
        kind: "shell"
      },
      {
        id: "bash",
        label: "bash",
        executable: commandExists("bash") ? "bash" : "/bin/bash",
        args: ["-l"],
        kind: "shell"
      }
    ];
  }

  const profiles = [];

  if (commandExists("bash")) {
    profiles.push({
      id: "bash",
      label: "bash",
      executable: "bash",
      args: ["-l"],
      kind: "shell"
    });
  }

  if (!profiles.length) {
    profiles.push({
      id: "sh",
      label: "sh",
      executable: commandExists("sh") ? "sh" : "/bin/sh",
      args: ["-l"],
      kind: "shell"
    });
  }

  return profiles;
}

class TerminalManager {
  constructor({ sendToRenderer, getDefaultCwd }) {
    this._sendToRenderer = sendToRenderer;
    this._getDefaultCwd = getDefaultCwd;
    this._profiles = detectProfiles();
    this._sessions = new Map();
  }

  listProfiles() {
    return this._profiles.map(profile => ({
      id: profile.id,
      label: profile.label,
      kind: profile.kind
    }));
  }

  createSession(options = {}) {
    const profile = this._profiles.find(item => item.id === options.profileId) || this._profiles[0];

    if (!profile) {
      throw new Error("No terminal profiles available on this system.");
    }

    const nativeCwd = safeDirectory(options.cwd || this._getDefaultCwd());
    const launch = this._buildLaunch(profile, nativeCwd);
    const id = randomUUID();

    const shell = pty.spawn(launch.executable, launch.args, {
      name: "xterm-256color",
      cols: options.cols || 120,
      rows: options.rows || 32,
      cwd: launch.spawnCwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...launch.env
      },
      useConpty: process.platform === "win32"
    });

    shell.onData(data => {
      this._sendToRenderer("terminal:data", { id, data });
    });

    shell.onExit(event => {
      this._sessions.delete(id);
      this._sendToRenderer("terminal:exit", {
        id,
        exitCode: event.exitCode,
        signal: event.signal
      });
    });

    this._sessions.set(id, { shell });

    return {
      id,
      profileId: profile.id,
      label: profile.label,
      cwd: nativeCwd,
      title: `${shortPath(nativeCwd)} • ${profile.label}`
    };
  }

  write(id, data) {
    const session = this._sessions.get(id);

    if (session) {
      session.shell.write(data);
    }
  }

  resize(id, cols, rows) {
    const session = this._sessions.get(id);

    if (session && cols > 0 && rows > 0) {
      session.shell.resize(cols, rows);
    }
  }

  close(id) {
    const session = this._sessions.get(id);

    if (!session) {
      return;
    }

    session.shell.kill();
    this._sessions.delete(id);
  }

  dispose() {
    for (const [id, session] of this._sessions.entries()) {
      session.shell.kill();
      this._sessions.delete(id);
    }
  }

  _buildLaunch(profile, nativeCwd) {
    if (profile.executable.toLowerCase() === "wsl.exe") {
      const translated = toWslPath(nativeCwd);

      return {
        executable: profile.executable,
        args: translated ? ["--cd", translated] : [],
        spawnCwd: safeDirectory(nativeCwd)
      };
    }

    return {
      executable: profile.executable,
      args: profile.args,
      spawnCwd: safeDirectory(nativeCwd)
    };
  }
}

module.exports = {
  TerminalManager
};
