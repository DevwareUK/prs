import { readFileSync } from "node:fs";

function toEnvName(name: string): string {
  return `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
}

function normalizeInputValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readFileInput(name: string, filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${name} at ${filePath}: ${message}`);
  }
}

export function getOptionalInput(name: string): string | undefined {
  return normalizeInputValue(process.env[toEnvName(name)]);
}

export function getRequiredInput(name: string): string {
  const value = getOptionalInput(name);
  if (!value) {
    throw new Error(`Missing required input: ${name}`);
  }

  return value;
}

export function getOptionalInlineOrFileInput(
  inputName: string,
  fileInputName: string
): string | undefined {
  const filePath = getOptionalInput(fileInputName);
  if (filePath) {
    const value = readFileInput(fileInputName, filePath);
    return value.trim() ? value : undefined;
  }

  return getOptionalInput(inputName);
}

export function getRequiredInlineOrFileInput(
  inputName: string,
  fileInputName: string
): string {
  const value = getOptionalInlineOrFileInput(inputName, fileInputName);
  if (!value) {
    throw new Error(`Missing required input: ${inputName} or ${fileInputName}`);
  }

  return value;
}
