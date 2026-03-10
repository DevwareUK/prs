function asOptionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid ${fieldName}: expected string`);
  }

  return value;
}

const PRDescriptionInput = {
  parse(value) {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid PRDescriptionInput: expected object");
    }

    if (typeof value.diff !== "string" || value.diff.length === 0) {
      throw new Error("Invalid PRDescriptionInput.diff: expected non-empty string");
    }

    return {
      diff: value.diff,
      issueTitle: asOptionalString(value.issueTitle, "issueTitle"),
      issueBody: asOptionalString(value.issueBody, "issueBody"),
    };
  },
};

const PRDescriptionOutput = {
  parse(value) {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid PRDescriptionOutput: expected object");
    }

    if (typeof value.title !== "string" || value.title.length === 0) {
      throw new Error("Invalid PRDescriptionOutput.title: expected non-empty string");
    }

    if (typeof value.body !== "string" || value.body.length === 0) {
      throw new Error("Invalid PRDescriptionOutput.body: expected non-empty string");
    }

    return {
      title: value.title,
      body: value.body,
      testingNotes: asOptionalString(value.testingNotes, "testingNotes"),
      riskNotes: asOptionalString(value.riskNotes, "riskNotes"),
    };
  },
};

module.exports = {
  PRDescriptionInput,
  PRDescriptionOutput,
};
