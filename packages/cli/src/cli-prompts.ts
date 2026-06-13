import { createInterface } from "node:readline/promises";

export async function promptForLine(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

export async function promptForRequiredLine(prompt: string): Promise<string> {
  while (true) {
    const answer = (await promptForLine(prompt)).trim();
    if (answer) {
      return answer;
    }

    console.log("A response is required.");
  }
}

export async function promptForYesNoDefaultNo(prompt: string): Promise<boolean> {
  while (true) {
    const answer = (await promptForLine(prompt)).trim().toLowerCase();

    if (!answer || answer === "n" || answer === "no") {
      return false;
    }

    if (answer === "y" || answer === "yes") {
      return true;
    }

    console.log("Choose yes or no.");
  }
}

export async function promptForYesNoDefaultYes(prompt: string): Promise<boolean> {
  while (true) {
    const answer = (await promptForLine(prompt)).trim().toLowerCase();

    if (!answer || answer === "y" || answer === "yes") {
      return true;
    }

    if (answer === "n" || answer === "no") {
      return false;
    }

    console.log("Choose yes or no.");
  }
}
