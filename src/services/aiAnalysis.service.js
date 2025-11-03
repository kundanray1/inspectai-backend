const defaultIssueCatalogue = {
  scuff: { label: 'Scuff mark', severity: 'low', confidence: 0.85 },
  crack: { label: 'Crack detected', severity: 'high', confidence: 0.92 },
  mould: { label: 'Possible mould', severity: 'medium', confidence: 0.88 },
};

const generateRoomAnalysis = async ({ roomName, observations = [], existingIssues = [] }) => {
  const issues = [...existingIssues];

  observations.forEach((obs) => {
    const key = obs.toLowerCase();
    if (key.includes('scuff')) issues.push(defaultIssueCatalogue.scuff);
    if (key.includes('crack')) issues.push(defaultIssueCatalogue.crack);
    if (key.includes('mould')) issues.push(defaultIssueCatalogue.mould);
  });

  const severityScore = issues.reduce((sum, issue) => {
    if (issue.severity === 'high') return sum + 3;
    if (issue.severity === 'medium') return sum + 2;
    return sum + 1;
  }, 0);

  let condition = 'excellent';
  if (severityScore > 6) condition = 'needs_maintenance';
  else if (severityScore > 3) condition = 'fair';
  else if (severityScore > 1) condition = 'good';

  const actions = issues.map((issue) => `Investigate ${issue.label.toLowerCase()}`);

  const summary =
    issues.length > 0
      ? `Detected ${issues.length} issues in the ${roomName}. Prioritise remediation of high severity findings.`
      : `No significant issues detected in the ${roomName}.`;

  return {
    summary,
    actions,
    conditionRating: condition,
    issues,
  };
};

module.exports = {
  generateRoomAnalysis,
};
