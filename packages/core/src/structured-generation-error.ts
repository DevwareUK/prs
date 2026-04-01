export type StructuredGenerationErrorKind =
  | "json_parse"
  | "schema_validation";

export type StructuredGenerationValidationIssue = {
  path: string;
  message: string;
  code: string;
};

type StructuredGenerationErrorOptions = {
  kind: StructuredGenerationErrorKind;
  message: string;
  rawResponse: string;
  parsedJson?: unknown;
  normalizedJson?: unknown;
  validationIssues?: StructuredGenerationValidationIssue[];
};

export class StructuredGenerationError extends Error {
  readonly kind: StructuredGenerationErrorKind;
  readonly rawResponse: string;
  readonly parsedJson?: unknown;
  readonly normalizedJson?: unknown;
  readonly validationIssues?: StructuredGenerationValidationIssue[];

  constructor(options: StructuredGenerationErrorOptions) {
    super(options.message);
    this.name = "StructuredGenerationError";
    this.kind = options.kind;
    this.rawResponse = options.rawResponse;
    this.parsedJson = options.parsedJson;
    this.normalizedJson = options.normalizedJson;
    this.validationIssues = options.validationIssues;
  }
}
