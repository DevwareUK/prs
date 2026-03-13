const { writeFileSync } = require("node:fs");

global.fetch = async (url, options = {}) => {
  const capturePath = process.env.GIT_AI_FETCH_CAPTURE_PATH;
  if (capturePath) {
    const body =
      typeof options.body === "string" && options.body.length > 0
        ? JSON.parse(options.body)
        : options.body;

    writeFileSync(
      capturePath,
      JSON.stringify(
        {
          url,
          options: {
            ...options,
            body,
          },
        },
        null,
        2
      ),
      "utf8"
    );
  }

  const status = Number(process.env.GIT_AI_FETCH_STATUS || "200");
  if (status < 200 || status >= 300) {
    return new Response(process.env.GIT_AI_FETCH_ERROR_BODY || "mock error", {
      status,
    });
  }

  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: process.env.GIT_AI_FETCH_RESPONSE_CONTENT || "",
          },
        },
      ],
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  );
};
