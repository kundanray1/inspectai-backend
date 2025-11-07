/* eslint-disable security/detect-non-literal-fs-filename */
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { AbortController } = require('abort-controller');
const fetchImpl = require('node-fetch');
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const logger = require('../config/logger');

const generateSchemaPrompt = (reportText) => `You are an expert technical writer.

Analyze the provided sample property inspection report and infer a reusable JSON schema for future inspection outputs.

Return **only** valid JSON with the following shape:
{
  "title": string,
  "sections": [
    {
      "name": string,
      "description": string,
      "fields": [
        {
          "key": string,
          "label": string,
          "dataType": "string" | "number" | "boolean" | "array" | "object",
          "description": string,
          "required": boolean
        }
      ]
    }
  ],
  "metadata": {
    "derivedFrom": "sample-report",
    "version": 1
  }
}

Guidelines:
- Identify major sections (e.g. Overview, Rooms, Issues, Recommendations) from the sample report.
- Create concise field labels and keys (snake_case).
- Use arrays/objects when repeated structures (rooms, issues) are present.
- Keep descriptions short but informative.
- Mark fields as required only if they always appear in the sample.
- If the sample contains tables or nested lists, model them as arrays of objects.

Sample report:
"""
${reportText}
"""`;

const callOllama = async ({ prompt, model }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollama.timeoutMs);

  try {
    const response = await fetchImpl(`${config.ollama.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(httpStatus.BAD_GATEWAY, `Ollama request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(httpStatus.GATEWAY_TIMEOUT, 'Ollama request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const extractTextFromPdf = async (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  return result.text;
};

const generateSchemaFromSampleReport = async ({ filePath }) => {
  const reportText = await extractTextFromPdf(filePath);

  const rawResponse = await callOllama({
    prompt: generateSchemaPrompt(reportText),
    model: config.ollama.schemaModel,
  });

  let schema;
  try {
    schema = JSON.parse(rawResponse);
  } catch (error) {
    logger.error({ err: error, rawResponse }, 'Failed to parse schema JSON from Ollama');
    throw new ApiError(httpStatus.BAD_GATEWAY, 'Ollama returned invalid JSON for schema');
  }

  return schema;
};

module.exports = {
  generateSchemaFromSampleReport,
};
