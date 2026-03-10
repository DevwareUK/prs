class OpenAIProvider {
  constructor(options) {
    if (!options || typeof options.apiKey !== "string" || options.apiKey.length === 0) {
      throw new Error("OpenAIProvider requires apiKey");
    }

    this.apiKey = options.apiKey;
    this.model = options.model || "gpt-4o-mini";
    this.baseUrl = options.baseUrl || "https://api.openai.com/v1";
  }

  async generate(prompt) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You generate high quality GitHub PR titles and descriptions.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI request failed with status ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("OpenAI response did not include message content");
    }

    return content;
  }
}

module.exports = {
  OpenAIProvider,
};
