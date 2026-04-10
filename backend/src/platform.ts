import os from "node:os";
import path from "node:path";

import type { HostCapabilities, PlatformId, ShellDescriptor } from "./contracts";

function detectPlatform(platform: NodeJS.Platform = process.platform): PlatformId {
  if (platform === "win32") {
    return "windows";
  }

  if (platform === "darwin") {
    return "macos";
  }

  return "linux";
}

function getWindowsBuildNumber(release: string): number | null {
  const parts = release.split(".");
  const build = Number(parts[2]);

  return Number.isFinite(build) ? build : null;
}

export function getPreferredShell(
  platform: PlatformId = detectPlatform(),
  env: NodeJS.ProcessEnv = process.env,
): ShellDescriptor {
  if (platform === "windows") {
    if (env.PWSH_PATH) {
      return {
        kind: "pwsh",
        executable: env.PWSH_PATH,
        args: ["-NoLogo"],
      };
    }

    return {
      kind: "powershell",
      executable: "powershell.exe",
      args: ["-NoLogo"],
    };
  }

  if (platform === "macos") {
    return {
      kind: "zsh",
      executable: env.SHELL || "/bin/zsh",
      args: ["-l"],
    };
  }

  return {
    kind: "bash",
    executable: env.SHELL || "/bin/bash",
    args: ["-l"],
  };
}

export function normalizeWorkspacePath(
  inputPath: string,
  platform: PlatformId = detectPlatform(),
): string {
  const resolved = path.resolve(inputPath);

  if (platform !== "windows") {
    return resolved;
  }

  const withForwardSlashes = resolved.replaceAll("\\", "/");

  return withForwardSlashes.replace(/^([A-Z]):/, (_, drive: string) => {
    return `${drive.toLowerCase()}:`;
  });
}

export function detectHostCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): HostCapabilities {
  const platform = detectPlatform();
  const platformVersion = os.release();
  const preferredShell = getPreferredShell(platform, env);
  const supportsVoiceCapture = platform === "windows" || platform === "macos";

  const supportsPty =
    platform !== "windows" ||
    (getWindowsBuildNumber(platformVersion) ?? 0) >= 17763;

  const gitExecutableCandidates =
    platform === "windows"
      ? ["git.exe", "git.cmd", "git"]
      : ["git", "/usr/bin/git"];

  return {
    platform,
    platformVersion,
    preferredShell,
    supportsPty,
    supportsVoiceCapture,
    gitExecutableCandidates,
  };
}
