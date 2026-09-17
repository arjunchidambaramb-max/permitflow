const tamilNadu = require('./tamil-nadu');

/**
 * Modular Jurisdiction Registry
 * Allows easy plugging of other state or national jurisdictions (e.g. Karnataka, Maharashtra, etc.)
 */
const JURISDICTION_REGISTRY = {
  'TN': {
    code: 'TN',
    name: 'Tamil Nadu (TNCDBR-2019)',
    country: 'India',
    engine: tamilNadu,
    authorities: tamilNadu.TN_AUTHORITIES,
    districts: tamilNadu.TN_DISTRICTS
  }
};

function getJurisdictionEngine(stateCode = 'TN') {
  return JURISDICTION_REGISTRY[stateCode] || JURISDICTION_REGISTRY['TN'];
}

function resolveJurisdictionForProject(locationData) {
  const state = (locationData.state || 'Tamil Nadu').toLowerCase();
  
  if (state.includes('tamil') || state.includes('tn') || state.includes('chennai') || state.includes('coimbatore')) {
    const tnEngine = JURISDICTION_REGISTRY['TN'].engine;
    return tnEngine.evaluateTNCDBRClassification(locationData);
  }

  // Default to Tamil Nadu as primary active system
  return JURISDICTION_REGISTRY['TN'].engine.evaluateTNCDBRClassification(locationData);
}

module.exports = {
  JURISDICTION_REGISTRY,
  getJurisdictionEngine,
  resolveJurisdictionForProject
};
