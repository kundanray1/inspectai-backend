/**
 * Report Generation Service
 * 
 * Uses Gemini to generate professional inspection reports
 * based on templates, photos, and analysis data.
 * 
 * @module services/ai/reportGeneration
 */

const httpStatus = require('http-status');
const geminiService = require('./gemini.service');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

/**
 * Report generation prompt template
 */
const REPORT_GENERATION_PROMPT = `You are a professional property inspector writing an inspection report.

Based on the provided data, generate a professional, detailed inspection report following this schema:
{schema}

Property Information:
{propertyData}

Room Inspection Data:
{roomData}

Additional Notes from Inspector:
{agentNotes}

Generate a complete report with:
1. Professional language suitable for clients
2. Clear descriptions of conditions and issues
3. Specific recommendations for each issue
4. An executive summary
5. Appropriate section narratives

Return ONLY valid JSON matching the schema structure with all sections filled in.`;

/**
 * Section narrative prompt
 */
const SECTION_NARRATIVE_PROMPT = `Write a professional narrative for this inspection report section.

Section: {sectionName}
Data: {sectionData}

Write 2-3 paragraphs in professional inspection report language.
Be specific about conditions observed and any issues found.
Include recommendations where appropriate.`;

/**
 * Executive summary prompt
 */
const EXECUTIVE_SUMMARY_PROMPT = `Write an executive summary for this property inspection report.

Property: {propertyAddress}
Overall Condition: {overallCondition}
Total Issues Found: {totalIssues}
High Priority Issues: {highPriorityIssues}

Room Summary:
{roomSummary}

Write a professional 2-3 paragraph executive summary that:
1. States the overall condition of the property
2. Highlights key concerns
3. Provides a brief overview of recommendations
4. Is suitable for property buyers/owners`;

/**
 * Generate a complete inspection report
 * @param {Object} params - Generation parameters
 * @param {Object} params.schema - Report template schema
 * @param {Object} params.propertyData - Property information
 * @param {Array} params.rooms - Room data with photos and issues
 * @param {string} [params.agentNotes] - Additional inspector notes
 * @param {string} [params.organizationName] - Organization name for branding
 * @returns {Promise<Object>}
 */
const generateReport = async ({ schema, propertyData, rooms, agentNotes, organizationName }) => {
  if (!schema || !propertyData || !rooms) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Schema, propertyData, and rooms are required');
  }

  logger.info(
    { roomCount: rooms.length, hasNotes: !!agentNotes },
    'Generating inspection report'
  );

  // Build the prompt
  const prompt = REPORT_GENERATION_PROMPT
    .replace('{schema}', JSON.stringify(schema, null, 2))
    .replace('{propertyData}', JSON.stringify(propertyData, null, 2))
    .replace('{roomData}', JSON.stringify(rooms, null, 2))
    .replace('{agentNotes}', agentNotes || 'No additional notes provided.');

  // Generate the report
  const result = await geminiService.generateJSON({ prompt });

  // Post-process and validate
  const processedReport = await postProcessReport(result, schema, rooms, organizationName);

  logger.info({ sectionCount: processedReport.sections?.length }, 'Report generated successfully');

  return processedReport;
};

/**
 * Post-process a generated report
 * @param {Object} rawReport - Raw generated report
 * @param {Object} schema - Original schema
 * @param {Array} rooms - Room data
 * @param {string} [organizationName] - Organization name
 * @returns {Promise<Object>}
 */
const postProcessReport = async (rawReport, schema, rooms, organizationName) => {
  // Ensure all schema sections are present
  const processedSections = schema.sections.map((schemaSection) => {
    const generatedSection = rawReport.sections?.find(
      (s) => s.id === schemaSection.id || s.name === schemaSection.name
    );

    return {
      sectionId: schemaSection.id,
      name: schemaSection.name,
      order: schemaSection.order,
      data: generatedSection?.data || {},
      aiNarrative: generatedSection?.aiNarrative || generatedSection?.narrative || '',
    };
  });

  // Calculate overall statistics
  const allIssues = rooms.flatMap((room) => room.issues || []);
  const highPriorityIssues = allIssues.filter((issue) => issue.severity === 'high');
  const mediumPriorityIssues = allIssues.filter((issue) => issue.severity === 'medium');

  // Determine overall condition
  let overallCondition = 'excellent';
  if (highPriorityIssues.length > 0) {
    overallCondition = 'needs_maintenance';
  } else if (mediumPriorityIssues.length > 2) {
    overallCondition = 'fair';
  } else if (allIssues.length > 0) {
    overallCondition = 'good';
  }

  // Generate executive summary if not provided
  let executiveSummary = rawReport.executiveSummary || rawReport.summary || '';
  if (!executiveSummary || executiveSummary.length < 100) {
    executiveSummary = await generateExecutiveSummary({
      propertyAddress: rawReport.propertyData?.address || 'Property',
      overallCondition,
      totalIssues: allIssues.length,
      highPriorityIssues: highPriorityIssues.length,
      rooms,
    });
  }

  return {
    title: rawReport.title || schema.title || 'Property Inspection Report',
    generatedAt: new Date().toISOString(),
    organizationName: organizationName || '',
    introduction: rawReport.introduction || generateDefaultIntroduction(rooms.length),
    sections: processedSections,
    conclusion: rawReport.conclusion || generateDefaultConclusion(overallCondition),
    executiveSummary,
    overallCondition,
    statistics: {
      totalRooms: rooms.length,
      totalIssues: allIssues.length,
      highPriorityIssues: highPriorityIssues.length,
      mediumPriorityIssues: mediumPriorityIssues.length,
      lowPriorityIssues: allIssues.filter((i) => i.severity === 'low').length,
    },
    priorityIssues: highPriorityIssues.slice(0, 5).map((issue) => ({
      label: issue.label,
      description: issue.description,
      severity: issue.severity,
      recommendation: issue.recommendation,
    })),
  };
};

/**
 * Generate executive summary
 * @param {Object} params - Summary parameters
 * @returns {Promise<string>}
 */
const generateExecutiveSummary = async ({
  propertyAddress,
  overallCondition,
  totalIssues,
  highPriorityIssues,
  rooms,
}) => {
  const roomSummary = rooms
    .map((room) => `- ${room.name}: ${room.conditionRating || 'assessed'}`)
    .join('\n');

  const prompt = EXECUTIVE_SUMMARY_PROMPT
    .replace('{propertyAddress}', propertyAddress)
    .replace('{overallCondition}', overallCondition)
    .replace('{totalIssues}', totalIssues.toString())
    .replace('{highPriorityIssues}', highPriorityIssues.toString())
    .replace('{roomSummary}', roomSummary);

  try {
    const result = await geminiService.generateText({ prompt });
    return result.text;
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to generate executive summary');
    return generateDefaultSummary(overallCondition, totalIssues);
  }
};

/**
 * Generate a narrative for a specific section
 * @param {Object} params - Narrative parameters
 * @param {string} params.sectionName - Section name
 * @param {Object} params.sectionData - Section data
 * @returns {Promise<string>}
 */
const generateSectionNarrative = async ({ sectionName, sectionData }) => {
  const prompt = SECTION_NARRATIVE_PROMPT
    .replace('{sectionName}', sectionName)
    .replace('{sectionData}', JSON.stringify(sectionData, null, 2));

  try {
    const result = await geminiService.generateText({ prompt });
    return result.text;
  } catch (error) {
    logger.warn({ error: error.message, sectionName }, 'Failed to generate section narrative');
    return '';
  }
};

/**
 * Generate room-specific report content
 * @param {Object} params - Room parameters
 * @param {Object} params.room - Room data
 * @param {Object} params.analysisResults - Photo analysis results
 * @returns {Promise<Object>}
 */
const generateRoomReport = async ({ room, analysisResults }) => {
  const prompt = `Generate a detailed inspection report section for this room.

Room: ${room.name}
Condition: ${analysisResults.conditionRating || 'Not assessed'}
Issues Found: ${JSON.stringify(analysisResults.issues || [], null, 2)}
Photo Analysis: ${analysisResults.aiSummary || 'No analysis available'}
Inspector Notes: ${room.notes || 'None'}

Write:
1. A professional narrative describing the room's condition
2. Specific details about any issues found
3. Recommendations for addressing issues
4. Overall assessment

Return JSON:
{
  "narrative": "Detailed professional narrative...",
  "issueDescriptions": ["Description for each issue..."],
  "recommendations": ["Specific recommendations..."],
  "conditionSummary": "Brief condition summary"
}`;

  try {
    const result = await geminiService.generateJSON({ prompt });
    return {
      name: room.name,
      narrative: result.narrative || '',
      issueDescriptions: result.issueDescriptions || [],
      recommendations: result.recommendations || [],
      conditionSummary: result.conditionSummary || '',
      conditionRating: analysisResults.conditionRating,
      issues: analysisResults.issues,
    };
  } catch (error) {
    logger.warn({ error: error.message, roomName: room.name }, 'Failed to generate room report');
    return {
      name: room.name,
      narrative: `Inspection of ${room.name} completed.`,
      conditionRating: analysisResults.conditionRating || 'good',
      issues: analysisResults.issues || [],
    };
  }
};

/**
 * Generate default introduction
 * @param {number} roomCount - Number of rooms
 * @returns {string}
 */
const generateDefaultIntroduction = (roomCount) =>
  `This inspection report provides a comprehensive assessment of the property, covering ${roomCount} areas. ` +
  'All findings are documented with condition ratings and recommendations where applicable. ' +
  'This report is intended to inform property stakeholders of the current condition and any areas requiring attention.';

/**
 * Generate default conclusion
 * @param {string} overallCondition - Overall condition
 * @returns {string}
 */
const generateDefaultConclusion = (overallCondition) => {
  const conditionText = {
    excellent: 'in excellent condition with no significant issues identified',
    good: 'in good condition with minor items noted for attention',
    fair: 'in fair condition with several items requiring attention',
    needs_maintenance: 'requiring maintenance attention with priority items identified',
  };

  return (
    `Based on this inspection, the property is ${conditionText[overallCondition] || 'assessed as described'}. ` +
    'We recommend reviewing the detailed findings and addressing any high-priority items promptly. ' +
    'Regular maintenance will help preserve the property\'s condition.'
  );
};

/**
 * Generate default summary
 * @param {string} overallCondition - Overall condition
 * @param {number} totalIssues - Total issues found
 * @returns {string}
 */
const generateDefaultSummary = (overallCondition, totalIssues) =>
  `The property inspection identified ${totalIssues} item(s) for attention. ` +
  `Overall, the property is in ${overallCondition.replace('_', ' ')} condition. ` +
  'Please review the detailed findings in this report for specific recommendations.';

module.exports = {
  generateReport,
  generateExecutiveSummary,
  generateSectionNarrative,
  generateRoomReport,
  generateDefaultIntroduction,
  generateDefaultConclusion,
};

