/**
 * AI Service Type Definitions
 * 
 * JSDoc type definitions for AI-related services.
 * These provide type hints for IDE support and documentation.
 * 
 * @module services/ai/types
 */

/**
 * @typedef {'low' | 'medium' | 'high'} IssueSeverity
 */

/**
 * @typedef {Object} BoundingBox
 * @property {number} x - X coordinate (0-1 normalized)
 * @property {number} y - Y coordinate (0-1 normalized)
 * @property {number} width - Width (0-1 normalized)
 * @property {number} height - Height (0-1 normalized)
 */

/**
 * @typedef {Object} DetectedIssue
 * @property {string} label - Human-readable issue label
 * @property {IssueSeverity} severity - Issue severity level
 * @property {number} confidence - Confidence score (0-1)
 * @property {string} [description] - Detailed description
 * @property {BoundingBox} [boundingBox] - Location in image
 * @property {string} [recommendation] - Suggested action
 */

/**
 * @typedef {Object} PhotoAnalysisResult
 * @property {string} roomClassification - Detected room type
 * @property {number} classificationConfidence - Room classification confidence
 * @property {DetectedIssue[]} issues - Detected issues
 * @property {string[]} qualityWarnings - Image quality warnings
 * @property {string} aiSummary - AI-generated summary
 * @property {'excellent' | 'good' | 'fair' | 'needs_maintenance'} conditionRating
 */

/**
 * @typedef {Object} SchemaField
 * @property {string} key - Field key (snake_case)
 * @property {string} label - Display label
 * @property {'text' | 'textarea' | 'date' | 'select' | 'checkbox' | 'number' | 'image_gallery' | 'issue_list' | 'condition_rating' | 'signature'} type
 * @property {string} [description] - Field description
 * @property {boolean} [required] - Whether field is required
 * @property {string[]} [options] - Options for select fields
 */

/**
 * @typedef {Object} SchemaSection
 * @property {string} id - Section identifier
 * @property {string} name - Section display name
 * @property {string} [description] - Section description
 * @property {number} order - Display order
 * @property {boolean} [repeatable] - Whether section can repeat
 * @property {SchemaField[]} fields - Section fields
 */

/**
 * @typedef {Object} ReportSchema
 * @property {string} title - Report title
 * @property {SchemaSection[]} sections - Report sections
 * @property {Object} [styling] - Report styling options
 * @property {string} [styling.logo] - Logo URL
 * @property {string} [styling.primaryColor] - Primary color hex
 * @property {string} [styling.fontFamily] - Font family
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} SchemaExtractionResult
 * @property {ReportSchema} schema - Extracted schema
 * @property {number} confidence - Extraction confidence (0-1)
 * @property {string[]} suggestions - Improvement suggestions
 * @property {string[]} warnings - Extraction warnings
 */

/**
 * @typedef {Object} ReportGenerationInput
 * @property {ReportSchema} schema - Template schema
 * @property {Object} propertyData - Property information
 * @property {Object[]} rooms - Room data with photos and issues
 * @property {string} [agentNotes] - Additional agent notes
 * @property {string} [organizationName] - Organization/company name
 */

/**
 * @typedef {Object} GeneratedReportSection
 * @property {string} sectionId - Section identifier
 * @property {string} name - Section name
 * @property {Object} data - Section data keyed by field key
 * @property {string} [aiNarrative] - AI-generated narrative
 */

/**
 * @typedef {Object} GeneratedReport
 * @property {string} title - Report title
 * @property {string} introduction - Report introduction
 * @property {GeneratedReportSection[]} sections - Report sections
 * @property {string} conclusion - Report conclusion
 * @property {string} overallSummary - Executive summary
 * @property {DetectedIssue[]} priorityIssues - Top priority issues
 * @property {string} generatedAt - ISO timestamp
 */

module.exports = {
  // Export empty object - types are just for JSDoc
};

