/**
 * PDF Export Service
 * 
 * Generates branded PDF reports with watermark support for different subscription tiers.
 * 
 * @module services/pdf/pdfExport
 */

const PDFDocument = require('pdfkit');
const { Readable } = require('stream');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const httpStatus = require('http-status');
const htmlReportService = require('./htmlReport.service');

/**
 * @typedef {Object} BrandingOptions
 * @property {string} [logoUrl] - URL or path to company logo
 * @property {Buffer} [logoBuffer] - Logo as buffer (alternative to URL)
 * @property {string} [primaryColor] - Primary brand color (hex)
 * @property {string} [secondaryColor] - Secondary brand color (hex)
 * @property {string} [fontFamily] - Font family name
 * @property {string} [companyName] - Company name for header
 * @property {string} [headerStyle] - 'centered' | 'left-aligned'
 */

/**
 * @typedef {Object} WatermarkOptions
 * @property {boolean} enabled - Whether to show watermark
 * @property {string} [text] - Watermark text (default: 'TRIAL - Sitewise')
 * @property {number} [opacity] - Watermark opacity (0-1)
 * @property {string} [color] - Watermark color (hex)
 */

/**
 * @typedef {Object} ReportSection
 * @property {string} title - Section title
 * @property {Array<ReportField>} fields - Fields in the section
 * @property {boolean} [pageBreakBefore] - Start section on new page
 */

/**
 * @typedef {Object} ReportField
 * @property {string} label - Field label
 * @property {string|number|boolean} value - Field value
 * @property {'text'|'date'|'rating'|'image'|'list'|'table'} [type] - Field type
 * @property {Buffer} [imageBuffer] - Image data if type is 'image'
 */

/**
 * @typedef {Object} PDFExportOptions
 * @property {BrandingOptions} [branding] - Branding customization
 * @property {WatermarkOptions} [watermark] - Watermark settings
 * @property {string} title - Report title
 * @property {string} [subtitle] - Report subtitle
 * @property {Array<ReportSection>} sections - Report sections
 * @property {Object} [metadata] - PDF metadata
 * @property {string} [footer] - Footer text
 */

// Default colors
const COLORS = {
  primary: '#1a365d',
  secondary: '#2d3748',
  accent: '#3182ce',
  muted: '#718096',
  border: '#e2e8f0',
  background: '#f7fafc',
  white: '#ffffff',
  black: '#000000',
  watermark: '#94a3b8',
};

// Font sizes
const FONT_SIZES = {
  title: 24,
  subtitle: 14,
  sectionTitle: 16,
  body: 11,
  small: 9,
  footer: 8,
};

/**
 * Convert hex color to RGB array
 * @param {string} hex - Hex color string
 * @returns {number[]} RGB array
 */
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0];
};

/**
 * Add watermark to page
 * @param {PDFDocument} doc - PDF document
 * @param {WatermarkOptions} watermark - Watermark options
 */
const addWatermark = (doc, watermark) => {
  if (!watermark?.enabled) return;

  const text = watermark.text || 'TRIAL - Sitewise';
  const opacity = watermark.opacity || 0.15;
  const color = watermark.color || COLORS.watermark;

  doc.save();
  
  // Set watermark properties
  doc.opacity(opacity);
  doc.fillColor(color);
  doc.fontSize(60);
  
  // Rotate and position watermark diagonally across the page
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  
  doc.rotate(-45, { origin: [pageWidth / 2, pageHeight / 2] });
  
  // Draw watermark text multiple times for coverage
  const textWidth = doc.widthOfString(text);
  const startX = (pageWidth - textWidth) / 2;
  const startY = pageHeight / 2;
  
  doc.text(text, startX, startY - 100, { align: 'center' });
  doc.text(text, startX, startY + 100, { align: 'center' });
  
  doc.restore();
};

/**
 * Add header with branding
 * @param {PDFDocument} doc - PDF document
 * @param {BrandingOptions} branding - Branding options
 * @param {string} title - Report title
 * @param {string} [subtitle] - Report subtitle
 */
const addHeader = async (doc, branding, title, subtitle) => {
  const primaryColor = branding?.primaryColor || COLORS.primary;
  const headerStyle = branding?.headerStyle || 'centered';
  const companyName = branding?.companyName || '';
  
  const margin = 50;
  const headerHeight = 80;
  
  // Header background
  doc.rect(0, 0, doc.page.width, headerHeight)
    .fill(primaryColor);
  
  // Logo
  if (branding?.logoBuffer) {
    try {
      const logoX = headerStyle === 'centered' 
        ? (doc.page.width - 60) / 2 
        : margin;
      doc.image(branding.logoBuffer, logoX, 15, { height: 50 });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to add logo to PDF');
    }
  }
  
  // Title
  doc.fillColor(COLORS.white);
  doc.fontSize(FONT_SIZES.title);
  
  const titleY = branding?.logoBuffer ? 70 : 25;
  
  if (headerStyle === 'centered') {
    doc.text(title, margin, titleY, { 
      align: 'center',
      width: doc.page.width - margin * 2 
    });
  } else {
    doc.text(title, margin, titleY);
  }
  
  // Subtitle
  if (subtitle) {
    doc.fontSize(FONT_SIZES.subtitle);
    doc.fillColor(COLORS.white);
    doc.opacity(0.8);
    doc.text(subtitle, margin, titleY + 30, { 
      align: headerStyle === 'centered' ? 'center' : 'left',
      width: doc.page.width - margin * 2 
    });
    doc.opacity(1);
  }
  
  // Company name on right side
  if (companyName && headerStyle !== 'centered') {
    doc.fontSize(FONT_SIZES.small);
    doc.text(companyName, doc.page.width - margin - 150, 30, { 
      align: 'right',
      width: 150 
    });
  }
  
  // Reset position after header
  doc.fillColor(COLORS.black);
  doc.y = headerHeight + 30;
};

/**
 * Add a section to the document
 * @param {PDFDocument} doc - PDF document
 * @param {ReportSection} section - Section data
 * @param {BrandingOptions} branding - Branding options
 */
const addSection = async (doc, section, branding) => {
  const primaryColor = branding?.primaryColor || COLORS.primary;
  const margin = 50;
  
  // Page break if needed
  if (section.pageBreakBefore) {
    doc.addPage();
  }
  
  // Check if we need a new page
  if (doc.y > doc.page.height - 150) {
    doc.addPage();
  }
  
  // Section title with accent bar
  doc.rect(margin, doc.y, 4, 20).fill(primaryColor);
  doc.fillColor(COLORS.secondary);
  doc.fontSize(FONT_SIZES.sectionTitle);
  doc.text(section.title, margin + 12, doc.y, { continued: false });
  doc.moveDown(0.5);
  
  // Section fields
  for (const field of section.fields || []) {
    await addField(doc, field, margin);
  }
  
  doc.moveDown(1);
};

/**
 * Add a field to the document
 * @param {PDFDocument} doc - PDF document
 * @param {ReportField} field - Field data
 * @param {number} margin - Page margin
 */
const addField = async (doc, field, margin) => {
  // Check for page break
  if (doc.y > doc.page.height - 100) {
    doc.addPage();
  }
  
  doc.fontSize(FONT_SIZES.body);
  
  switch (field.type) {
    case 'image':
      if (field.imageBuffer) {
        try {
          doc.fillColor(COLORS.muted);
          doc.text(`${field.label}:`, margin);
          doc.image(field.imageBuffer, margin, doc.y, { 
            width: Math.min(200, doc.page.width - margin * 2),
            align: 'left'
          });
          doc.moveDown(0.5);
        } catch (error) {
          logger.warn({ err: error, label: field.label }, 'Failed to add image to PDF');
          doc.fillColor(COLORS.muted);
          doc.text(`${field.label}: [Image unavailable]`, margin);
        }
      }
      break;
      
    case 'list':
      doc.fillColor(COLORS.muted);
      doc.text(`${field.label}:`, margin);
      if (Array.isArray(field.value)) {
        doc.fillColor(COLORS.black);
        field.value.forEach((item, index) => {
          doc.text(`  • ${item}`, margin + 10);
        });
      }
      break;
      
    case 'table':
      doc.fillColor(COLORS.muted);
      doc.text(`${field.label}:`, margin);
      // Simple table rendering
      if (Array.isArray(field.value) && field.value.length > 0) {
        const tableTop = doc.y;
        const colWidth = (doc.page.width - margin * 2) / Object.keys(field.value[0]).length;
        
        // Header row
        doc.fillColor(COLORS.secondary);
        Object.keys(field.value[0]).forEach((key, i) => {
          doc.text(key, margin + i * colWidth, tableTop, { width: colWidth });
        });
        doc.moveDown(0.5);
        
        // Data rows
        doc.fillColor(COLORS.black);
        field.value.forEach(row => {
          const rowY = doc.y;
          Object.values(row).forEach((val, i) => {
            doc.text(String(val), margin + i * colWidth, rowY, { width: colWidth });
          });
          doc.moveDown(0.3);
        });
      }
      break;
      
    case 'rating':
      doc.fillColor(COLORS.muted);
      let ratingValue = 0;
      let ratingDisplay = '';
      
      if (typeof field.value === 'number') {
        ratingValue = Math.min(5, Math.max(0, field.value));
        ratingDisplay = '★'.repeat(ratingValue) + '☆'.repeat(5 - ratingValue);
      } else if (typeof field.value === 'string') {
        // Handle text ratings
        const ratingMap = { excellent: 5, good: 4, fair: 3, poor: 2, critical: 1, needs_maintenance: 2, unrated: 0 };
        ratingValue = ratingMap[field.value.toLowerCase()] || 0;
        ratingDisplay = field.value.charAt(0).toUpperCase() + field.value.slice(1).replace(/_/g, ' ');
        if (ratingValue > 0) {
          ratingDisplay += ` (${'★'.repeat(ratingValue)}${'☆'.repeat(5 - ratingValue)})`;
        }
      }
      
      doc.text(`${field.label}: `, margin, doc.y, { continued: true });
      doc.fillColor(COLORS.accent);
      doc.text(ratingDisplay || 'N/A');
      break;
      
    case 'date':
      doc.fillColor(COLORS.muted);
      doc.text(`${field.label}: `, margin, doc.y, { continued: true });
      doc.fillColor(COLORS.black);
      const dateValue = field.value instanceof Date 
        ? field.value.toLocaleDateString() 
        : String(field.value);
      doc.text(dateValue);
      break;
      
    default:
      // Standard text field
      doc.fillColor(COLORS.muted);
      // Handle empty labels (for paragraph content)
      if (field.label && field.label.length > 0) {
        doc.text(`${field.label}: `, margin, doc.y, { continued: true });
        doc.fillColor(COLORS.black);
        doc.text(String(field.value || '—'));
      } else {
        // Just the value as a paragraph
        doc.fillColor(COLORS.black);
        doc.text(String(field.value || ''), margin);
      }
  }
  
  doc.moveDown(0.3);
};

/**
 * Add footer to page
 * @param {PDFDocument} doc - PDF document
 * @param {string} footerText - Footer text
 * @param {number} pageNumber - Current page number
 */
const addFooter = (doc, footerText, pageNumber) => {
  const margin = 50;
  const footerY = doc.page.height - 40;
  
  doc.save();
  
  // Footer line
  doc.strokeColor(COLORS.border);
  doc.lineWidth(0.5);
  doc.moveTo(margin, footerY - 10)
    .lineTo(doc.page.width - margin, footerY - 10)
    .stroke();
  
  // Footer text
  doc.fontSize(FONT_SIZES.footer);
  doc.fillColor(COLORS.muted);
  
  if (footerText) {
    doc.text(footerText, margin, footerY, { 
      width: doc.page.width - margin * 2 - 50,
      align: 'left'
    });
  }
  
  // Page number
  doc.text(`Page ${pageNumber}`, doc.page.width - margin - 50, footerY, {
    width: 50,
    align: 'right'
  });
  
  doc.restore();
};

/**
 * Generate PDF report
 * @param {PDFExportOptions} options - Export options
 * @returns {Promise<Buffer>} PDF buffer
 */
const generatePDF = async (options) => {
  const {
    branding = {},
    watermark = { enabled: false },
    title,
    subtitle,
    sections = [],
    metadata = {},
    footer = 'Generated by Sitewise',
  } = options;

  try {
    // Create PDF document
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: title,
        Author: metadata.author || 'Sitewise',
        Subject: metadata.subject || 'Property Inspection Report',
        Keywords: metadata.keywords || 'inspection, property, report',
        Creator: 'Sitewise PDF Generator',
        Producer: 'PDFKit',
        CreationDate: new Date(),
      },
      autoFirstPage: true,
      bufferPages: true,
    });

    // Collect PDF into buffer
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Add header
    await addHeader(doc, branding, title, subtitle);

    // Add sections
    for (const section of sections) {
      await addSection(doc, section, branding);
    }

    // Add watermark to all pages if enabled
    if (watermark.enabled) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        addWatermark(doc, watermark);
      }
    }

    // Add footers to all pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      addFooter(doc, footer, i + 1);
    }

    // Finalize PDF
    doc.end();

    return pdfPromise;
  } catch (error) {
    logger.error({ err: error }, 'Failed to generate PDF');
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to generate PDF report');
  }
};

/**
 * Generate inspection report PDF
 * @param {Object} options
 * @param {Object} options.inspection - Inspection data
 * @param {Object} options.reportData - Generated report data
 * @param {Object} options.preset - Report preset with schema
 * @param {Object} options.organization - Organization for branding
 * @param {boolean} options.isTrialUser - Whether user is on trial (adds watermark)
 * @returns {Promise<Buffer>} PDF buffer
 */
const generateInspectionReportPDF = async ({
  inspection,
  reportData,
  preset,
  organization,
  isTrialUser = false,
  reportContent,
  reportMeta,
}) => {
  // Defensive null checks
  if (!inspection) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Inspection data is required for PDF generation');
  }

  if (preset?.schema && reportContent) {
    return htmlReportService.renderReportToPdf({
      schema: preset.schema,
      templateHtml: preset.templateHtml,
      templateCss: preset.templateCss,
      reportContent,
      inspection,
      organization,
      reportMeta,
    });
  }

  // Build branding from organization and preset
  const branding = {
    companyName: organization?.name || 'Sitewise',
    primaryColor: preset?.schema?.styling?.primaryColor || COLORS.primary,
    headerStyle: preset?.schema?.styling?.headerStyle || 'centered',
    // logoBuffer would need to be fetched from storage
  };

  // Build watermark options
  const watermark = {
    enabled: isTrialUser,
    text: 'TRIAL VERSION - sitewise.pages.dev',
    opacity: 0.1,
  };

  // Build sections from report data
  const sections = [];

  // Get property address - handle both property and propertyId (populated)
  const propertyAddress = inspection.property?.address || inspection.propertyId?.address || 'N/A';
  const propertyName = inspection.property?.name || inspection.propertyId?.name || propertyAddress;

  // Property Overview section
  sections.push({
    title: 'Property Overview',
    fields: [
      { label: 'Property Address', value: propertyAddress },
      { label: 'Inspection Date', value: inspection.createdAt || new Date(), type: 'date' },
      { label: 'Inspector', value: inspection.inspector?.name || 'N/A' },
      { label: 'Status', value: inspection.status || 'N/A' },
    ],
  });

  // Introduction section (if provided)
  if (reportData?.introduction) {
    sections.push({
      title: 'Introduction',
      fields: [
        { label: '', value: reportData.introduction },
      ],
    });
  }

  // Room sections
  if (inspection.rooms && inspection.rooms.length > 0) {
    sections.push({
      title: 'Room Inspections',
      pageBreakBefore: true,
      fields: [],
    });

    for (const room of inspection.rooms) {
      // Collect all issues from room photos
      const roomIssues = [];
      for (const photo of (room.photos || [])) {
        for (const issue of (photo.issues || [])) {
          roomIssues.push(`${issue.label} (${issue.severity})`);
        }
      }
      
      sections.push({
        title: room.name || 'Unknown Room',
        fields: [
          { label: 'Condition Rating', value: room.conditionRating || 'Not rated' },
          { label: 'Photos', value: `${room.photos?.length || 0} photos captured` },
          { 
            label: 'Issues Found', 
            value: roomIssues.length > 0 ? roomIssues : ['None detected'],
            type: 'list'
          },
          { label: 'AI Summary', value: room.aiSummary || 'No AI summary available' },
          { label: 'Notes', value: room.notes || 'No additional notes' },
        ],
      });
    }
  }

  // Report Summary section
  if (reportData?.summary) {
    sections.push({
      title: 'Summary',
      pageBreakBefore: true,
      fields: [
        { label: '', value: reportData.summary },
      ],
    });
  }

  // Conclusion section (if provided)
  if (reportData?.conclusion) {
    sections.push({
      title: 'Conclusion & Recommendations',
      fields: [
        { label: '', value: reportData.conclusion },
      ],
    });
  }

  // Generate PDF
  const pdfPropertyAddress = inspection.property?.address || inspection.propertyId?.address || 'Property';
  
  return generatePDF({
    title: `Inspection Report - ${pdfPropertyAddress}`,
    subtitle: `Generated on ${new Date().toLocaleDateString()}`,
    branding,
    watermark,
    sections,
    footer: isTrialUser 
      ? 'Trial Version - Upgrade at sitewise.pages.dev for branded reports'
      : `© ${new Date().getFullYear()} ${organization?.name || 'Sitewise'} - Powered by Sitewise`,
    metadata: {
      author: inspection.inspector?.name || 'Sitewise',
      subject: `Property Inspection Report for ${pdfPropertyAddress}`,
    },
  });
};

module.exports = {
  generatePDF,
  generateInspectionReportPDF,
  // Export utilities for custom PDF generation
  addWatermark,
  addHeader,
  addSection,
  addField,
  addFooter,
  COLORS,
  FONT_SIZES,
  hexToRgb,
};
