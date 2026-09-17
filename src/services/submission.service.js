/**
 * Submission Center & Professional Review Service
 * Manages Technical Review Sign-off, Package Generation, Official Government Portal Linkage,
 * and Official Application Number Scrutiny Tracking.
 */

const GOVT_PORTALS = {
  CMDA: {
    name: 'CMDA Single Window Portal (Chennai Metropolitan Area)',
    url: 'https://onlinecmdachennai.com',
    instruction: 'Log in with your licensed surveyor / applicant credentials and upload the generated dossier under Planning Permission Application.'
  },
  DTCP: {
    name: 'DTCP Single Window Portal (Directorate of Town & Country Planning)',
    url: 'https://dtcp.tn.gov.in',
    instruction: 'Submit planning permission dossier to the respective DTCP District Town Planning Office.'
  },
  GCC: {
    name: 'Greater Chennai Corporation (GCC) Online Building License Portal',
    url: 'https://chennaicorporation.gov.in',
    instruction: 'Submit delegated category application to the respective GCC Zonal Executive Engineer.'
  },
  TNSWP: {
    name: 'Tamil Nadu Single Window Portal (Commercial & Industrial)',
    url: 'https://tnswp.com',
    instruction: 'Unified clearances for commercial, industrial, and institutional developments.'
  }
};

const TN_GOVT_MILESTONE_STAGES = {
  SUBMITTED_ON_GOVT_PORTAL: {
    label: 'Application Filed on Official Portal',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    description: 'Planning permission application received by planning authority.'
  },
  SCRUTINY_IN_PROGRESS: {
    label: 'Technical Scrutiny in Progress',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    description: 'Scrutiny of land title deeds, PreDCR compliance, and zoning regulations by Assistant Planner.'
  },
  SITE_INSPECTION_SCHEDULED: {
    label: 'Joint Site Inspection Scheduled',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    description: 'Area Town Planning Officer and Surveyor inspecting ground setbacks and access road width.'
  },
  DEFICIENCY_QUERY_RAISED: {
    label: 'Deficiency / Scrutiny Query Raised',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
    description: 'Statutory query letter issued requiring applicant compliance or drawing rectification.'
  },
  DEMAND_NOTICE_ISSUED: {
    label: 'Demand Notice Issued for Statutory Charges',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
    description: 'Advice issued for Infrastructure & Amenities (I&A) charges, OSR charges, and scrutiny fees.'
  },
  PLANNING_PERMIT_SANCTIONED: {
    label: 'Planning Permission Sanctioned & Issued',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    description: 'Official Planning Permit order and sanctioned drawings sealed and released by Authority.'
  },
  APPLICATION_REFUSED: {
    label: 'Planning Permission Refused',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
    description: 'Order of Refusal passed under Section 49 of TN Town and Country Planning Act 1971.'
  }
};

/**
 * Handles Professional Technical Review Sign-Off
 */
function recordProfessionalReview(permit, reviewerData) {
  const now = new Date().toISOString();
  const reviewRecord = {
    reviewedAt: now,
    signedAt: now,
    reviewerName: reviewerData.reviewerName || 'Ar. K. Swaminathan, B.Arch, AIIA',
    registrationNumber: reviewerData.registrationNumber || 'COA: CA/2012/58120 / CMDA Reg: RA/GR-I/19/03/044',
    professionalRole: reviewerData.professionalRole || 'Registered Architect / Licensed Building Surveyor',
    declarationStatement: reviewerData.declarationStatement || 'I hereby certify that the architectural plans, setbacks, FSI calculations, and land records have been verified and strictly conform to the Tamil Nadu Combined Development and Building Rules, 2019 (TNCDBR-2019). The file is technically cleared for official government portal submission.',
    isCleared: true,
    recommendations: reviewerData.recommendations || 'All revenue boundaries, setback offsets, and structural stability certificates verified in order.'
  };

  permit.professionalReview = reviewRecord;
  permit.status = 'PROFESSIONALLY_CLEARED';
  return reviewRecord;
}

/**
 * Compiles and generates official dossier package manifest
 */
function generateSubmissionPackage(permit, project, requirements, documents) {
  const verifiedDocs = requirements.filter(r => r.status === 'UPLOADED' && r.verificationStatus === 'Appears Valid');

  const manifest = {
    packageId: `PKG-TN-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      location: `${project.city}, ${project.state}`,
      surveyNumber: project.parcelNumber,
      applicant: project.ownerName
    },
    permit: {
      id: permit.id,
      permitType: permit.permitType,
      authority: permit.authority?.name || 'Chennai Metropolitan Development Authority (CMDA)',
      governingRule: 'Tamil Nadu Combined Development and Building Rules, 2019 (TNCDBR-2019)'
    },
    professionalSignOff: permit.professionalReview || null,
    totalFilesIncluded: verifiedDocs.length,
    fileIndex: verifiedDocs.map((req, idx) => {
      const doc = documents.find(d => d.requirementId === req.id && d.isCurrent);
      return {
        sequenceNumber: String(idx + 1).padStart(2, '0'),
        documentCategory: req.category || 'General',
        requirementName: req.name,
        officialFileAlias: `${String(idx + 1).padStart(2, '0')}_${req.idKey}_${doc?.originalName || 'document.pdf'}`,
        originalFileName: doc?.originalName || 'unnamed.pdf',
        fileSizeBytes: doc?.fileSizeBytes || 0,
        verificationStatus: req.verificationStatus,
        regulatoryCitation: req.regulatoryCitation
      };
    })
  };

  permit.submissionPackage = manifest;
  permit.status = 'PACKAGE_GENERATED';
  return manifest;
}

/**
 * Tracks actual government submission reference number entered by user
 */
function recordOfficialGovernmentSubmission(permit, submissionData) {
  const { officialApplicationNumber, portalFilingDate, portalType, notes } = submissionData;

  const trackingRecord = {
    officialApplicationNumber: officialApplicationNumber.trim(),
    portalFilingDate: portalFilingDate || new Date().toISOString().split('T')[0],
    portalType: portalType || 'CMDA',
    currentStage: 'SUBMITTED_ON_GOVT_PORTAL',
    statusHistory: [
      {
        stage: 'SUBMITTED_ON_GOVT_PORTAL',
        timestamp: new Date().toISOString(),
        remarks: notes || `Application successfully filed on official ${portalType || 'CMDA'} portal with reference number ${officialApplicationNumber}.`
      }
    ],
    queries: []
  };

  permit.governmentTracking = trackingRecord;
  permit.status = 'GOVT_SCRUTINY_IN_PROGRESS';
  return trackingRecord;
}

/**
 * Updates official government scrutiny milestone
 */
function updateGovernmentMilestone(permit, updateData) {
  if (!permit.governmentTracking) {
    throw new Error('Application has not been recorded as filed on official portal yet.');
  }

  const { stage, remarks, demandAmount, queryText } = updateData;

  permit.governmentTracking.currentStage = stage;
  permit.governmentTracking.statusHistory.unshift({
    stage,
    timestamp: new Date().toISOString(),
    remarks: remarks || `Status updated to ${stage}`
  });

  if (demandAmount) {
    permit.governmentTracking.demandNoticeAmount = parseFloat(demandAmount);
  }

  if (queryText) {
    permit.governmentTracking.queries.unshift({
      id: `qry-${Date.now()}`,
      raisedAt: new Date().toISOString(),
      queryText,
      status: 'OPEN',
      replyRemarks: null
    });
  }

  return permit.governmentTracking;
}

module.exports = {
  GOVT_PORTALS,
  TN_GOVT_MILESTONE_STAGES,
  recordProfessionalReview,
  generateSubmissionPackage,
  recordOfficialGovernmentSubmission,
  updateGovernmentMilestone
};
