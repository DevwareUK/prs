export interface AIProvider {
  generate(prompt: string): Promise<string>;
}

