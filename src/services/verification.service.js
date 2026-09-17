/**
 * Document Verification & Semantic Inspection Service
 * Validates document type, key details, completeness, and TNCDBR 2019 compliance
 * backed by real Gemini multimodal AI.
 */

const { aiService, STATUTORY_DISCLAIMER } = require('./ai.service');

/**
 * Inspects a document file buffer and metadata against Tamil Nadu regulatory requirement specifications
 * using real Gemini AI.
 */
async function verifyTamilNaduDocument(requirement, document, permit, project) {
  const fileName = (document.originalName || document.fileName || '').toLowerCase();

  // 1. Initial Check: Missing file
  if (!document || !fileName) {
    return {
      aiStatus: 'Missing',
      badge: '❌ Missing',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
      reason: 'No file uploaded for this mandatory requirement.',
      extractedDetails: {},
      isVerified: false,
      disclaimer: STATUTORY_DISCLAIMER
    };
  }

  // 2. Delegate to real Gemini AI Intelligence Service
  try {
    const aiResult = await aiService.analyzeDocument({
      requirement,
      document,
      project,
      permit
    });
    return aiResult;
  } catch (err) {
    console.error('[VerificationService] AI verification error:', err);
    return {
      aiStatus: 'Needs Review',
      badge: '⚠️ Needs Review',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
      reason: `Automated inspection could not finalize AI parsing: ${err.message}. Manual verification required.`,
      extractedDetails: {},
      isVerified: false,
      disclaimer: STATUTORY_DISCLAIMER
    };
  }
}

module.exports = {
  verifyTamilNaduDocument,
  STATUTORY_DISCLAIMER
};
