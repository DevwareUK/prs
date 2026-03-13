const { spawn } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const REPO_ROOT = resolve(__dirname, "..");

async function runNodeScript(scriptPath, args = [], env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...env,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({
        code,
        stdout,
        stderr,
      });
    });
  });
}

function createTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function parseGitHubOutput(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const outputs = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    const multilineMatch = line.match(/^([^=]+)<<(.+)$/);
    if (multilineMatch) {
      const [, name, delimiter] = multilineMatch;
      const valueLines = [];
      index += 1;

      while (index < lines.length && lines[index] !== delimiter) {
        valueLines.push(lines[index]);
        index += 1;
      }

      outputs[name] = valueLines.join("\n");
      continue;
    }

    const singleLineMatch = line.match(/^([^=]+)=(.*)$/);
    if (singleLineMatch) {
      outputs[singleLineMatch[1]] = singleLineMatch[2];
    }
  }

  return outputs;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

module.exports = {
  createTempDir,
  parseGitHubOutput,
  readJsonFile,
  runNodeScript,
};
