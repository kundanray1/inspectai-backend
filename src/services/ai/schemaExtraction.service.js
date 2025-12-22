/**
 * Schema Extraction Service
 * 
 * Uses Gemini Vision to extract report schemas from PDF templates.
 * Analyzes the structure of existing inspection reports to create
 * reusable JSON schemas for report generation.
 * 
 * @module services/ai/schemaExtraction
 */

/* eslint-disable security/detect-non-literal-fs-filename */
const fs = require('fs').promises;
const path = require('path');
const httpStatus = require('http-status');
const { pdf } = require('pdf-to-img');
const geminiService = require('./gemini.service');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

/**
 * Schema extraction prompt template
 */
const SCHEMA_EXTRACTION_PROMPT = `You are an expert at analyzing property inspection reports and extracting their structure.

Analyze the provided sample property inspection report page(s) and infer a reusable JSON schema for generating similar reports.

Return ONLY valid JSON with the following structure:
{
  "title": "Report title inferred from the document",
  "sections": [
    {
      "id": "unique_section_id",
      "name": "Section Display Name",
      "description": "What this section contains",
      "order": 1,
      "repeatable": false,
      "fields": [
        {
          "key": "field_key_snake_case",
          "label": "Field Display Label",
          "type": "text|textarea|date|select|checkbox|number|image_gallery|issue_list|condition_rating|signature",
          "description": "What this field captures",
          "required": true,
          "options": ["Option1", "Option2"]
        }
      ]
    }
  ],
  "styling": {
    "headerStyle": "centered|left|right",
    "primaryColor": "#hex_color_from_document",
    "fontFamily": "detected_font_name"
  },
  "metadata": {
    "documentType": "property_inspection|building_inspection|pre_purchase|rental",
    "confidence": 0.85,
    "warnings": ["Any issues or ambiguities found"]
  }
}

Guidelines:
- Identify major sections (e.g., Property Overview, Room Inspections, Issues, Recommendations)
- Use snake_case for field keys and section IDs
- Set "repeatable": true for sections that can have multiple instances (like rooms)
- Use appropriate field types based on the content:
  - "text" for short text entries
  - "textarea" for longer descriptions
  - "date" for dates
  - "select" for choices with predefined options
  - "image_gallery" for photo collections
  - "issue_list" for detected issues
  - "condition_rating" for condition assessments
  - "signature" for signature fields
- Extract any visible styling (colors, fonts) from the document
- Set confidence based on how clear the structure is
- Add warnings for any ambiguous elements

Analyze the following report page(s):`;

/**
 * Convert PDF to images for Gemini Vision
 * @param {string|Buffer} pdfInput - PDF file path or buffer
 * @param {Object} [options] - Conversion options
 * @param {number} [options.maxPages=5] - Maximum pages to process
 * @returns {Promise<Array<{mimeType: string, data: string}>>}
 */
const pdfToImages = async (pdfInput, options = {}) => {
  const maxPages = options.maxPages || 5;
  const images = [];

  try {
    let pdfBuffer;
    if (typeof pdfInput === 'string') {
      pdfBuffer = await fs.readFile(pdfInput);
    } else {
      pdfBuffer = pdfInput;
    }

    const document = await pdf(pdfBuffer, { scale: 2 });
    let pageCount = 0;

    for await (const image of document) {
      if (pageCount >= maxPages) break;
      
      images.push({
        mimeType: 'image/png',
        data: image.toString('base64'),
      });
      pageCount++;
    }

    logger.debug({ pageCount: images.length }, 'PDF converted to images');
    return images;
  } catch (error) {
    logger.error({ error }, 'Failed to convert PDF to images');
    throw new ApiError(httpStatus.BAD_REQUEST, `Failed to process PDF: ${error.message}`);
  }
};

/**
 * Extract schema from a PDF report template
 * @param {Object} params - Extraction parameters
 * @param {string} [params.filePath] - Path to PDF file
 * @param {Buffer} [params.buffer] - PDF file buffer
 * @param {Object} [params.options] - Extraction options
 * @returns {Promise<Object>} Extracted schema
 */
const extractSchemaFromPdf = async ({ filePath, buffer, options = {} }) => {
  if (!filePath && !buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either filePath or buffer must be provided');
  }

  logger.info({ filePath, hasBuffer: !!buffer }, 'Starting schema extraction from PDF');

  // Convert PDF to images
  const images = await pdfToImages(filePath || buffer, {
    maxPages: options.maxPages || 5,
  });

  if (images.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'PDF has no pages or could not be processed');
  }

  // Call Gemini Vision for schema extraction
  const result = await geminiService.generateJSON({
    prompt: SCHEMA_EXTRACTION_PROMPT,
    images,
  });

  // Validate the extracted schema
  const validatedSchema = validateAndNormalizeSchema(result);

  logger.info(
    { 
      sectionCount: validatedSchema.schema.sections.length,
      confidence: validatedSchema.confidence,
    },
    'Schema extracted successfully'
  );

  return validatedSchema;
};

/**
 * Validate and normalize an extracted schema
 * @param {Object} rawSchema - Raw schema from Gemini
 * @returns {Object} Validated schema with suggestions
 */
const validateAndNormalizeSchema = (rawSchema) => {
  const warnings = [];
  const suggestions = [];

  // Ensure required top-level fields
  if (!rawSchema.title) {
    rawSchema.title = 'Inspection Report';
    warnings.push('No title detected, using default');
  }

  if (!rawSchema.sections || !Array.isArray(rawSchema.sections)) {
    rawSchema.sections = [];
    warnings.push('No sections detected');
  }

  // Normalize sections
  rawSchema.sections = rawSchema.sections.map((section, index) => {
    // Ensure section has required fields
    if (!section.id) {
      section.id = `section_${index + 1}`;
    }
    if (!section.name) {
      section.name = `Section ${index + 1}`;
    }
    if (typeof section.order !== 'number') {
      section.order = index + 1;
    }
    if (typeof section.repeatable !== 'boolean') {
      section.repeatable = false;
    }

    // Normalize fields
    if (!section.fields || !Array.isArray(section.fields)) {
      section.fields = [];
      warnings.push(`Section "${section.name}" has no fields`);
    }

    section.fields = section.fields.map((field, fieldIndex) => {
      if (!field.key) {
        field.key = `field_${fieldIndex + 1}`;
      }
      if (!field.label) {
        field.label = field.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
      if (!field.type) {
        field.type = 'text';
      }
      if (typeof field.required !== 'boolean') {
        field.required = false;
      }

      // Validate field type
      const validTypes = [
        'text', 'textarea', 'date', 'select', 'checkbox',
        'number', 'image_gallery', 'issue_list', 'condition_rating', 'signature',
      ];
      if (!validTypes.includes(field.type)) {
        field.type = 'text';
        warnings.push(`Invalid field type for "${field.label}", defaulting to text`);
      }

      // Ensure options for select fields
      if (field.type === 'select' && (!field.options || !Array.isArray(field.options))) {
        field.options = ['Option 1', 'Option 2', 'Option 3'];
        suggestions.push(`Add options for select field "${field.label}"`);
      }

      return field;
    });

    return section;
  });

  // Ensure styling
  if (!rawSchema.styling) {
    rawSchema.styling = {};
  }
  if (!rawSchema.styling.headerStyle) {
    rawSchema.styling.headerStyle = 'centered';
  }
  if (!rawSchema.styling.primaryColor) {
    rawSchema.styling.primaryColor = '#1a365d';
  }
  if (!rawSchema.styling.fontFamily) {
    rawSchema.styling.fontFamily = 'Arial';
  }

  // Extract confidence
  const confidence = rawSchema.metadata?.confidence || 0.7;

  // Combine warnings
  if (rawSchema.metadata?.warnings) {
    warnings.push(...rawSchema.metadata.warnings);
  }

  // Add default sections if empty
  if (rawSchema.sections.length === 0) {
    rawSchema.sections = getDefaultSections();
    suggestions.push('Using default section template. Please customize for your needs.');
  }

  return {
    schema: {
      title: rawSchema.title,
      sections: rawSchema.sections,
      styling: rawSchema.styling,
    },
    confidence,
    warnings,
    suggestions,
    documentType: rawSchema.metadata?.documentType || 'property_inspection',
  };
};

/**
 * Get default sections for a property inspection report
 * @returns {Array}
 */
const getDefaultSections = () => [
  {
    id: 'property_overview',
    name: 'Property Overview',
    description: 'Basic property information',
    order: 1,
    repeatable: false,
    fields: [
      { key: 'property_address', label: 'Property Address', type: 'text', required: true },
      { key: 'inspection_date', label: 'Inspection Date', type: 'date', required: true },
      { key: 'inspector_name', label: 'Inspector Name', type: 'text', required: true },
      { key: 'property_type', label: 'Property Type', type: 'select', options: ['House', 'Apartment', 'Townhouse', 'Commercial'] },
    ],
  },
  {
    id: 'room_inspection',
    name: 'Room Inspection',
    description: 'Individual room inspections',
    order: 2,
    repeatable: true,
    fields: [
      { key: 'room_name', label: 'Room Name', type: 'text', required: true },
      { key: 'condition_rating', label: 'Condition', type: 'condition_rating', required: true },
      { key: 'photos', label: 'Photos', type: 'image_gallery' },
      { key: 'issues', label: 'Issues Found', type: 'issue_list' },
      { key: 'notes', label: 'Inspector Notes', type: 'textarea' },
    ],
  },
  {
    id: 'summary',
    name: 'Summary & Recommendations',
    description: 'Overall assessment and recommendations',
    order: 3,
    repeatable: false,
    fields: [
      { key: 'overall_condition', label: 'Overall Condition', type: 'condition_rating', required: true },
      { key: 'summary', label: 'Executive Summary', type: 'textarea', required: true },
      { key: 'recommendations', label: 'Recommendations', type: 'textarea' },
      { key: 'signature', label: 'Inspector Signature', type: 'signature' },
    ],
  },
];

/**
 * Enhance an existing schema with additional context
 * @param {Object} schema - Existing schema
 * @param {string} prompt - Enhancement prompt
 * @returns {Promise<Object>}
 */
const enhanceSchema = async (schema, prompt) => {
  const enhancePrompt = `Given this existing report schema:
${JSON.stringify(schema, null, 2)}

${prompt}

Return the updated schema as valid JSON.`;

  const result = await geminiService.generateJSON({ prompt: enhancePrompt });
  return validateAndNormalizeSchema(result);
};

/**
 * Generate a schema from text description
 * @param {string} description - Description of the report type
 * @returns {Promise<Object>}
 */
const generateSchemaFromDescription = async (description) => {
  const prompt = `Create a property inspection report schema based on this description:

${description}

Return a JSON schema following this structure:
{
  "title": "Report title",
  "sections": [
    {
      "id": "section_id",
      "name": "Section Name",
      "description": "Section description",
      "order": 1,
      "repeatable": false,
      "fields": [
        {
          "key": "field_key",
          "label": "Field Label",
          "type": "text|textarea|date|select|checkbox|number|image_gallery|issue_list|condition_rating|signature",
          "required": true,
          "options": ["Option1", "Option2"]
        }
      ]
    }
  ],
  "styling": {
    "headerStyle": "centered",
    "primaryColor": "#1a365d",
    "fontFamily": "Arial"
  }
}`;

  const result = await geminiService.generateJSON({ prompt });
  return validateAndNormalizeSchema(result);
};

module.exports = {
  extractSchemaFromPdf,
  validateAndNormalizeSchema,
  getDefaultSections,
  enhanceSchema,
  generateSchemaFromDescription,
  pdfToImages,
};

