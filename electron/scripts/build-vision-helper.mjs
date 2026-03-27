import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const sourcePath = path.join(repoRoot, "electron", "helpers", "StrictVisionCapture.swift");
const outputDir = path.join(repoRoot, "electron", "bin");
const outputPath = path.join(outputDir, "strict-vision-capture");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  if (process.platform !== "darwin") {
    console.log("Skipping strict vision helper build: macOS only.");
    return;
  }

  try {
    await access("/usr/bin/swiftc");
  } catch {
    console.warn("Skipping strict vision helper build: swiftc not found.");
    return;
  }

  await mkdir(outputDir, { recursive: true });
  await run("/usr/bin/swiftc", [
    sourcePath,
    "-O",
    "-o",
    outputPath,
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-framework",
    "CoreGraphics",
    "-framework",
    "ImageIO",
    "-framework",
    "UniformTypeIdentifiers",
  ]);
  console.log(`Built strict vision helper at ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to build strict vision helper.");
  console.error(error);
  process.exitCode = 1;
});
