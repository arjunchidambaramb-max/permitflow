/**
 * API Request Validation & Security Sanitization Service
 * Protects endpoints from injection, path traversal, oversized uploads,
 * malformed inputs, and sensitive information leakage.
 */

const { TN_DISTRICTS } = require('../jurisdictions/tamil-nadu');

const ALLOWED_DOC_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.dwg', '.tif', '.tiff'];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '') // Strip angle brackets
    .trim();
}

function sanitizeFilename(fileName) {
  if (typeof fileName !== 'string') return 'document.pdf';
  // Strip path traversal tokens, null bytes, and backslashes
  return fileName
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/(\.\.[\/\\])+/g, '')
    .replace(/[\/\\]/g, '_')
    .trim();
}

function validateProjectInput(body) {
  const errors = [];
  const b = body || {};

  const name = sanitizeString(b.name);
  if (!name || name.length < 3) {
    errors.push('Project name must be at least 3 characters long');
  }

  const address = sanitizeString(b.address);
  if (!address || address.length < 5) {
    errors.push('Project address must be at least 5 characters long');
  }

  const district = sanitizeString(b.district);
  if (!district || !TN_DISTRICTS[district]) {
    errors.push(`Invalid Tamil Nadu district "${district}". Must be one of the 38 recognized districts.`);
  }

  const plotArea = parseFloat(b.plotArea);
  if (isNaN(plotArea) || plotArea <= 0) {
    errors.push('Plot area must be a valid positive number in square meters');
  }

  const roadWidth = parseFloat(b.roadWidth);
  if (isNaN(roadWidth) || roadWidth <= 0) {
    errors.push('Abutting road width must be a valid positive number in meters');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      ...b,
      name,
      address,
      district,
      city: sanitizeString(b.city) || district,
      ownerName: sanitizeString(b.ownerName) || 'Applicant',
      parcelNumber: sanitizeString(b.parcelNumber) || 'Unspecified S.No',
      plotArea: isNaN(plotArea) ? 200 : plotArea,
      roadWidth: isNaN(roadWidth) ? 9.0 : roadWidth,
      builtUpArea: parseFloat(b.builtUpArea) || (plotArea * 1.5),
      height: parseFloat(b.height) || 12.0
    }
  };
}

function validateDocumentUpload(body) {
  const errors = [];
  const b = body || {};

  const rawFileName = b.fileName || b.originalName || '';
  if (!rawFileName) {
    errors.push('Document file name is required');
  }

  const fileName = sanitizeFilename(rawFileName);
  const extMatch = fileName.match(/\.[0-9a-z]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';

  if (!ALLOWED_DOC_EXTENSIONS.includes(ext)) {
    errors.push(`Invalid file format "${ext}". Permitted formats: ${ALLOWED_DOC_EXTENSIONS.join(', ')}`);
  }

  const fileSize = parseInt(b.fileSize || b.fileSizeBytes, 10);
  if (isNaN(fileSize) || fileSize <= 0) {
    errors.push('File size must be greater than 0 bytes');
  } else if (fileSize > MAX_FILE_SIZE_BYTES) {
    errors.push(`File size exceeds maximum permitted limit of 25 MB (${(fileSize / (1024*1024)).toFixed(1)} MB uploaded)`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      fileName,
      originalName: fileName,
      fileSize: isNaN(fileSize) ? 50000 : fileSize,
      fileSizeBytes: isNaN(fileSize) ? 50000 : fileSize,
      mimeType: ext === '.pdf' ? 'application/pdf' : ext.includes('dwg') ? 'application/acad' : 'image/jpeg',
      fileText: typeof b.fileText === 'string' ? b.fileText.slice(0, 20000) : ''
    }
  };
}

function validateProfessionalReview(body) {
  const errors = [];
  const b = body || {};

  const reviewerName = sanitizeString(b.reviewerName);
  if (!reviewerName || reviewerName.length < 3) {
    errors.push('Reviewer name is required (min 3 characters)');
  }

  const registrationNumber = sanitizeString(b.registrationNumber);
  if (!registrationNumber || registrationNumber.length < 4) {
    errors.push('Valid statutory registration number is required (e.g. COA/2014/54120 or CMDA/SE/GR-I/...)');
  }

  if (b.declarationChecked !== true && b.declarationChecked !== 'true') {
    errors.push('Statutory professional compliance declaration must be accepted');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      reviewerName,
      registrationNumber,
      discipline: sanitizeString(b.discipline) || 'ARCHITECT',
      remarks: sanitizeString(b.remarks) || 'Plan certified in compliance with TNCDBR-2019 standards.',
      declarationChecked: true
    }
  };
}

function validateGovernmentSubmission(body) {
  const errors = [];
  const b = body || {};

  const appNo = sanitizeString(b.officialApplicationNumber);
  if (!appNo || appNo.length < 4) {
    errors.push('Official Government Application Reference Number is required (min 4 characters)');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      officialApplicationNumber: appNo,
      portalType: sanitizeString(b.portalType) || 'CMDA_ONLINE',
      remarks: sanitizeString(b.remarks) || 'Application submitted via Official Single Window Portal'
    }
  };
}

function safeErrorHandler(res, err, clientMessage) {
  // Log actual error on server for diagnostics
  console.error('[PermitFlow Server Error]:', err);
  
  const status = err.statusCode || 500;
  const message = clientMessage || (status === 400 ? err.message : 'Internal Server Error. Please contact support.');
  
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id'
  });
  
  res.end(JSON.stringify({
    success: false,
    error: message
  }));
}

module.exports = {
  sanitizeString,
  sanitizeFilename,
  validateProjectInput,
  validateDocumentUpload,
  validateProfessionalReview,
  validateGovernmentSubmission,
  safeErrorHandler,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_DOC_EXTENSIONS
};
