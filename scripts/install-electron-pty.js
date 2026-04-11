const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MARKER_FILE = ".ade-electron-pty.json";

function resolveInstalledElectronVersion() {
  try {
    return require("electron/package.json").version;
  } catch {
    const spec = require("../package.json").devDependencies?.electron || "";
    return spec.replace(/^[^\d]*/, "");
  }
}

function getExpectedFiles(platform) {
  if (platform === "win32") {
    return [
      "pty.node",
      "conpty.node",
      "conpty_console_list.node",
      "winpty-agent.exe",
      "winpty.dll"
    ];
  }

  return ["pty.node"];
}

function getInstallState(moduleDir) {
  const releaseDir = path.join(moduleDir, "build", "Release");
  const markerPath = path.join(moduleDir, MARKER_FILE);
  let marker = null;

  if (fs.existsSync(markerPath)) {
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    } catch {
      marker = null;
    }
  }

  return { releaseDir, markerPath, marker };
}

function hasExpectedFiles(releaseDir, platform) {
  return getExpectedFiles(platform).every(file => fs.existsSync(path.join(releaseDir, file)));
}

function writeMarker(markerPath, data) {
  fs.writeFileSync(markerPath, JSON.stringify(data, null, 2));
}

function main() {
  const electronVersion = resolveInstalledElectronVersion();

  if (!electronVersion) {
    throw new Error("Could not determine the installed Electron version.");
  }

  const moduleDir = path.dirname(
    require.resolve("@homebridge/node-pty-prebuilt-multiarch/package.json")
  );
  const moduleVersion = require("@homebridge/node-pty-prebuilt-multiarch/package.json").version;
  const prebuildInstallBin = require.resolve("prebuild-install/bin.js");
  const { releaseDir, markerPath, marker } = getInstallState(moduleDir);
  const targetState = {
    electronVersion,
    moduleVersion,
    platform: process.platform,
    arch: process.arch
  };

  if (
    marker &&
    marker.electronVersion === targetState.electronVersion &&
    marker.moduleVersion === targetState.moduleVersion &&
    marker.platform === targetState.platform &&
    marker.arch === targetState.arch &&
    hasExpectedFiles(releaseDir, process.platform)
  ) {
    console.log(
      `Reusing installed Electron PTY prebuild for ${process.platform}-${process.arch} (Electron ${electronVersion})`
    );
    return;
  }

  console.log(
    `Installing Electron PTY prebuild for ${process.platform}-${process.arch} (Electron ${electronVersion})`
  );

  try {
    execFileSync(
      process.execPath,
      [
        prebuildInstallBin,
        "--verbose",
        "--runtime",
        "electron",
        "--target",
        electronVersion,
        "--arch",
        process.arch,
        "--platform",
        process.platform
      ],
      {
        cwd: moduleDir,
        stdio: "inherit"
      }
    );
    writeMarker(markerPath, targetState);
  } catch (error) {
    if (hasExpectedFiles(releaseDir, process.platform)) {
      console.warn(
        "PTY prebuild install could not overwrite existing files; reusing current installation instead."
      );
      writeMarker(markerPath, targetState);
      return;
    }

    throw error;
  }
}

main();
