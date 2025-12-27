/**
 * Template Extraction Service
 *
 * Uses Gemini Vision to extract:
 * - a reusable schema
 * - a layout-accurate HTML template with Handlebars placeholders
 * - a CSS stylesheet
 *
 * @module services/ai/templateExtraction
 */

const httpStatus = require('http-status');
const geminiService = require('./gemini.service');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const { pdfToImages, validateAndNormalizeSchema, extractSchemaFromPdf } = require('./schemaExtraction.service');

const TEMPLATE_EXTRACTION_PROMPT = `You are an expert document engineer. Analyze the provided inspection report PDF and return:
1) A reusable JSON schema for report generation.
2) A layout-accurate HTML template with Handlebars placeholders (no inline data).
3) A CSS stylesheet that matches the visual style.

Return ONLY valid JSON with this structure:
{
  "schema": { ... },
  "templateHtml": "<main>...</main>",
  "templateCss": "body { ... }",
  "templateMeta": {
    "confidence": 0.0,
    "warnings": [],
    "notes": []
  }
}

Template rules:
- Use Handlebars placeholders ONLY (e.g., {{meta.organization}}, {{meta.reportVersion}}).
- DO NOT hardcode any sample values from the PDF.
- Use loops for tables: {{#each sections}} and {{#each this.rows}}.
- Preserve the exact table headers and section titles as they appear.
- The HTML must be a single body fragment (no <html>, <head>, or <style> tags).
- CSS should be standalone and include table styles, header/footer styles, and typography.

Data contract available to the template:
{
  "meta": {
    "organization": "",
    "project": "",
    "team": "",
    "templateId": "",
    "templateVersion": "",
    "reportVersion": "",
    "createdAt": "",
    "propertyAddress": "",
    "inspectionDate": ""
  },
  "sections": [
    {
      "id": "section_id",
      "name": "Section Name",
      "description": "Section description",
      "order": 1,
      "repeatable": false,
      "layout": {
        "type": "table|list",
        "columns": [
          { "key": "field_key", "label": "Column Header", "width": 0.25 }
        ]
      },
      "rows": [ { "field_key": "value" } ],
      "data": { "field_key": "value" }
    }
  ],
  "sectionsById": { "section_id": { ...same shape... } }
}

Ensure column widths sum to 1.0 for tables. Use semantic HTML elements (header, section, table, footer).
`;

const extractCssFromHtml = (html) => {
  if (!html) return { html, css: '' };
  const styleMatch = html.match(/<style[^>]*>([\\s\\S]*?)<\\/style>/i);
  if (!styleMatch) return { html, css: '' };
  const css = styleMatch[1].trim();
  const cleanedHtml = html.replace(styleMatch[0], '').trim();
  return { html: cleanedHtml, css };
};

const validateTemplate = (templateHtml) => {
  if (!templateHtml) return false;
  if (!templateHtml.includes('{{')) return false;
  return true;
};

const extractTemplateFromPdf = async ({ filePath, buffer, options = {} }) => {
  if (!filePath && !buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either filePath or buffer must be provided');
  }

  const images = await pdfToImages(filePath || buffer, {
    maxPages: options.maxPages || 5,
  });

  if (images.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'PDF has no pages or could not be processed');
  }

  const result = await geminiService.generateJSON({
    prompt: TEMPLATE_EXTRACTION_PROMPT,
    images,
  });

  const rawSchema = result.schema || result;
  const validatedSchema = validateAndNormalizeSchema(rawSchema);

  let templateHtml = result.templateHtml || '';
  let templateCss = result.templateCss || '';

  if (templateHtml) {
    const extracted = extractCssFromHtml(templateHtml);
    templateHtml = extracted.html;
    if (!templateCss && extracted.css) {
      templateCss = extracted.css;
    }
  }

  const templateValid = validateTemplate(templateHtml);
  const warnings = Array.isArray(result.templateMeta?.warnings) ? result.templateMeta.warnings : [];
  if (!templateValid) {
    warnings.push('Template HTML is missing or invalid, falling back to default layout');
  }

  return {
    schema: validatedSchema.schema,
    templateHtml: templateValid ? templateHtml : null,
    templateCss: templateValid ? templateCss : null,
    confidence: result.templateMeta?.confidence || validatedSchema.confidence,
    warnings: [...validatedSchema.warnings, ...warnings],
    suggestions: validatedSchema.suggestions,
  };
};

const extractTemplateWithFallback = async ({ filePath, buffer, options = {} }) => {
  try {
    return await extractTemplateFromPdf({ filePath, buffer, options });
  } catch (error) {
    logger.warn({ err: error }, 'Template extraction failed, falling back to schema only');
    const schemaResult = await extractSchemaFromPdf({ filePath, buffer, options });
    return {
      schema: schemaResult.schema,
      templateHtml: null,
      templateCss: null,
      confidence: schemaResult.confidence,
      warnings: schemaResult.warnings,
      suggestions: schemaResult.suggestions,
    };
  }
};

module.exports = {
  extractTemplateFromPdf,
  extractTemplateWithFallback,
};
