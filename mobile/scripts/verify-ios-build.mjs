import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const appleTeamId = process.env.EXPO_APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      EXPO_APPLE_TEAM_ID: appleTeamId,
    },
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (os.platform() !== "darwin") {
  fail("iOS native build verification requires macOS with Xcode.");
}

if (!appleTeamId) {
  fail("Set EXPO_APPLE_TEAM_ID or APPLE_TEAM_ID before verifying iOS native build.");
}

const xcodeSelect = spawnSync("xcode-select", ["-p"], { encoding: "utf8" });
if (xcodeSelect.status !== 0 || !xcodeSelect.stdout.trim()) {
  fail("Install Xcode and select it with xcode-select before verifying iOS native build.");
}

run("bun", ["run", "verify:ios-prebuild"]);

const projectPath = path.join(root, "ios", "Klarkey.xcodeproj");
if (!fs.existsSync(projectPath)) {
  fail("Missing generated iOS project at ios/Klarkey.xcodeproj.");
}

run("xcodebuild", [
  "-project",
  projectPath,
  "-scheme",
  "Klarkey",
  "-configuration",
  "Debug",
  "-sdk",
  "iphonesimulator",
  "-destination",
  "generic/platform=iOS Simulator",
  "CODE_SIGNING_ALLOWED=NO",
  "build",
]);

console.log("ok - iOS app and Credential Provider target compile for Simulator");
