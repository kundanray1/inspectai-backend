const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const config = require('../../config/config');
const logger = require('../../config/logger');

const TEMPLATE_PATH = path.join(__dirname, '../../templates/report.html.hbs');

let compiledTemplate = null;

const loadTemplate = () => {
  if (!compiledTemplate) {
    const source = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    compiledTemplate = handlebars.compile(source);
  }
  return compiledTemplate;
};

const normalizeValue = (value) => {
  if (value === null || typeof value === 'undefined') return '';
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const buildHeaderMeta = ({ inspection, reportMeta }) => {
  const property = inspection?.propertyId;
  const address = property?.address?.line1 || property?.name || 'Property';
  const inspectionDate = inspection?.createdAt
    ? new Date(inspection.createdAt).toLocaleDateString()
    : 'N/A';
  const versionLabel = reportMeta?.version ? `v${reportMeta.version}` : 'N/A';

  return [
    { label: 'Property', value: address },
    { label: 'Inspection Date', value: inspectionDate },
    { label: 'Report Version', value: versionLabel },
    { label: 'Status', value: inspection?.status || 'N/A' },
  ];
};

const buildSections = ({ reportContent }) => {
  const sections = Array.isArray(reportContent?.sections) ? reportContent.sections : [];

  return sections
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((section) => {
      const isTable = Boolean(section.repeatable) || section.layout?.type === 'table';
      const columns = Array.isArray(section.layout?.columns) && section.layout.columns.length > 0
        ? section.layout.columns
        : (section.fields || []).map((field) => ({
            key: field.key,
            label: field.label || field.key,
          }));
      const columnCount = Math.max(columns.length, 1);
      const normalizedColumns = columns.map((column) => ({
        key: column.key,
        label: column.label || column.key,
        width: column.width ? Math.round(column.width * 100) : Math.round(100 / columnCount),
      }));

      if (isTable) {
        const rows = Array.isArray(section.rows) ? section.rows : [];
        const normalizedRows = rows.map((row) => {
          const normalizedRow = {};
          normalizedColumns.forEach((column) => {
            normalizedRow[column.key] = normalizeValue(row?.[column.key]);
          });
          return normalizedRow;
        });

        return {
          id: section.sectionId || section.id,
          name: section.name,
          description: section.description,
          order: section.order,
          repeatable: Boolean(section.repeatable),
          isTable: true,
          layout: {
            type: 'table',
            columns: normalizedColumns,
          },
          rows: normalizedRows,
          data: {},
          fields: section.fields || [],
        };
      }

      const fields = Array.isArray(section.fields) ? section.fields : [];
      const data = section.data || {};
      const normalizedFields = fields.map((field) => ({
        label: field.label || field.key,
        value: normalizeValue(data[field.key]),
      }));

      return {
        id: section.sectionId || section.id,
        name: section.name,
        description: section.description,
        order: section.order,
        repeatable: Boolean(section.repeatable),
        isTable: false,
        layout: {
          type: 'list',
        },
        rows: [],
        data,
        fields: normalizedFields,
      };
    });
};

const buildSectionsById = (sections) => {
  return sections.reduce((acc, section) => {
    if (section.id) {
      acc[section.id] = section;
    }
    return acc;
  }, {});
};

const buildStyling = (schema) => {
  const primaryColor = schema?.styling?.primaryColor || '#1a365d';
  const headerLineColor = schema?.styling?.headerLine?.color || primaryColor;
  const headerLineThickness = schema?.styling?.headerLine?.thickness || 2;
  const fontFamily = schema?.styling?.fontFamily || 'Arial';

  return {
    primaryColor,
    headerLineColor,
    headerLineThickness,
    fontFamily,
  };
};

const buildTemplateDocument = ({ templateHtml, templateCss }) => {
  if (!templateHtml) return null;

  const cssBlock = `<style>${templateCss || ''}</style>`;

  if (templateHtml.includes('<html')) {
    if (templateHtml.includes('{{{css}}}')) {
      return templateHtml.replace('{{{css}}}', templateCss || '');
    }
    if (templateHtml.includes('</head>')) {
      return templateHtml.replace('</head>', `${cssBlock}</head>`);
    }
    return `${cssBlock}${templateHtml}`;
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${cssBlock}
  </head>
  <body>
    ${templateHtml}
  </body>
</html>`;
};

const renderReportToPdf = async ({
  schema,
  reportContent,
  inspection,
  organization,
  reportMeta,
  templateHtml,
  templateCss,
}) => {
  const styling = buildStyling(schema);
  const sections = buildSections({ reportContent });
  const sectionsById = buildSectionsById(sections);
  const data = {
    title: reportContent?.title || schema?.title || 'Inspection Report',
    organizationName: organization?.name || 'InspectAI',
    headerMeta: buildHeaderMeta({ inspection, reportMeta }),
    sections,
    sectionsById,
    styling,
    css: templateCss || '',
    meta: {
      organization: organization?.name || 'InspectAI',
      project: reportMeta?.project || '',
      team: reportMeta?.team || '',
      templateId: reportMeta?.templateId || '',
      templateVersion: reportMeta?.templateVersion || '',
      reportVersion: reportMeta?.version || '',
      createdAt: reportMeta?.createdAt || '',
      propertyAddress: inspection?.propertyId?.address?.line1 || '',
      inspectionDate: inspection?.createdAt ? new Date(inspection.createdAt).toLocaleDateString() : '',
    },
  };

  const templateDoc = buildTemplateDocument({ templateHtml, templateCss });
  const compiled = templateDoc ? handlebars.compile(templateDoc) : loadTemplate();
  const html = compiled(data);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: config.pdf?.puppeteerExecutablePath || undefined,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '110px', bottom: '70px', left: '40px', right: '40px' },
    });
  } finally {
    await browser.close();
  }
};

module.exports = {
  renderReportToPdf,
};
