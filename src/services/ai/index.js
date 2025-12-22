/**
 * AI Services Index
 * 
 * Central export for all AI-related services.
 * 
 * @module services/ai
 */

const geminiService = require('./gemini.service');
const schemaExtractionService = require('./schemaExtraction.service');
const imageAnalysisService = require('./imageAnalysis.service');
const reportGenerationService = require('./reportGeneration.service');

module.exports = {
  geminiService,
  schemaExtractionService,
  imageAnalysisService,
  reportGenerationService,
};

