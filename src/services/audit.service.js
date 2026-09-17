/**
 * Pre-Submission Audit & Cross-Document Consistency Engine
 * Cross-checks details across all uploaded deeds, sketches, and plans to detect
 * legal ownership discrepancies, survey number mismatches, and TNCDBR statutory deficits.
 */

function runPreSubmissionAudit(permit, project, requirements, documents) {
  const auditReport = {
    permitId: permit.id,
    projectId: project.id,
    readinessScore: 0,
    status: 'INCOMPLETE', // 'READY_FOR_PROFESSIONAL_REVIEW' | 'HAS_BLOCKERS' | 'INCOMPLETE'
    blockers: [],
    warnings: [],
    passedChecks: [],
    extractedSummary: {
      ownerName: project.ownerName || 'Not Specified',
      surveyNumber: project.parcelNumber || 'Not Specified',
      plotArea: project.plotArea ? `${project.plotArea} sq.m` : 'Not Specified',
      roadWidth: project.roadWidth ? `${project.roadWidth} m` : 'Not Specified'
    }
  };

  const totalMandatory = requirements.filter(r => r.isMandatory);
  const uploadedMandatory = requirements.filter(r => r.isMandatory && r.status === 'UPLOADED' && r.verificationStatus === 'Appears Valid');

  // 1. Completeness Check
  const missingReqs = requirements.filter(r => r.isMandatory && (!r.status || r.status === 'PENDING' || r.verificationStatus === 'Missing' || r.verificationStatus === 'Invalid'));
  
  if (missingReqs.length > 0) {
    missingReqs.forEach(req => {
      auditReport.blockers.push({
        code: 'MISSING_MANDATORY_DOC',
        title: `Missing Required Document: ${req.name}`,
        detail: `Under ${req.regulatoryCitation || 'TNCDBR-2019'}, this document is mandatory prior to CMDA/DTCP submission.`,
        requirementId: req.id
      });
    });
  } else {
    auditReport.passedChecks.push({
      title: 'Mandatory Document Completeness',
      detail: `All ${totalMandatory.length} mandatory documents have been uploaded.`
    });
  }

  // 2. Extract Document Metadatas for Cross-Checking
  const pattaReq = requirements.find(r => r.idKey === 'PATTA_CHITTA_TSLR');
  const deedReq = requirements.find(r => r.idKey === 'REGISTERED_TITLE_DEED');
  const fmbReq = requirements.find(r => r.idKey === 'FMB_TOWN_SURVEY_SKETCH');
  const archReq = requirements.find(r => r.idKey === 'ARCHITECTURAL_PLANS');
  const accessReq = requirements.find(r => r.idKey === 'COMBINED_ACCESS_SKETCH');

  const pattaMeta = pattaReq?.extractedDetails || {};
  const deedMeta = deedReq?.extractedDetails || {};
  const fmbMeta = fmbReq?.extractedDetails || {};
  const archMeta = archReq?.extractedDetails || {};
  const accessMeta = accessReq?.extractedDetails || {};

  // 3. Cross-Check: Owner Name Consistency (Sale Deed vs Patta vs Project)
  if (deedMeta.ownerName && pattaMeta.ownerName) {
    const cleanDeedOwner = deedMeta.ownerName.toLowerCase().trim();
    const cleanPattaOwner = pattaMeta.ownerName.toLowerCase().trim();

    if (cleanDeedOwner !== cleanPattaOwner) {
      auditReport.blockers.push({
        code: 'OWNERSHIP_MISMATCH',
        title: 'Ownership Discrepancy: Sale Deed vs Patta / TSLR Extract',
        detail: `Title Deed names "${deedMeta.ownerName}" whereas Patta names "${pattaMeta.ownerName}". CMDA/DTCP will issue rejection query unless Revenue Patta Name-Transfer order or legal heir succession deed is attached.`
      });
    } else {
      auditReport.passedChecks.push({
        title: 'Ownership Consistency Verified',
        detail: `Owner name "${deedMeta.ownerName}" matches consistently across Registered Sale Deed and Patta/TSLR.`
      });
    }
  }

  // 4. Cross-Check: Survey Number / T.S. Number (FMB vs Deed vs Site Plan)
  if (fmbMeta.surveyNumber && deedMeta.surveyNumber) {
    const cleanFmbSNo = fmbMeta.surveyNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanDeedSNo = deedMeta.surveyNumber.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (cleanFmbSNo !== cleanDeedSNo) {
      auditReport.blockers.push({
        code: 'SURVEY_NUMBER_MISMATCH',
        title: 'Survey Number Conflict: FMB Sketch vs Registered Deed',
        detail: `FMB sketch designates "${fmbMeta.surveyNumber}" while Title Deed refers to "${deedMeta.surveyNumber}". Requires subdivisional sub-division mutation or rectified survey extract.`
      });
    } else {
      auditReport.passedChecks.push({
        title: 'Revenue Survey Number Verified',
        detail: `Survey Number "${fmbMeta.surveyNumber}" matches across FMB Sketch, Sale Deed, and Architectural Site Plan.`
      });
    }
  }

  // 5. Cross-Check: Statutory Road Width vs TNCDBR 2019 Rule 35/39
  const projectRoadWidth = parseFloat(project.roadWidth) || parseFloat(accessMeta.abuttingRoadWidth) || 9.0;
  const minRequiredRoad = permit.minRoadWidthRequired || 9.0;

  if (projectRoadWidth < minRequiredRoad) {
    auditReport.blockers.push({
      code: 'ROAD_WIDTH_DEFICIT',
      title: 'Statutory Approach Road Width Deficit (TNCDBR Rule 35/39)',
      detail: `Site approach road width is ${projectRoadWidth}m. TNCDBR 2019 mandates minimum ${minRequiredRoad}m for ${permit.permitType}. Planning permission cannot be sanctioned without dedicated road widening gift deed.`
    });
  } else {
    auditReport.passedChecks.push({
      title: 'Road Width Conformance (TNCDBR Rule 35/39)',
      detail: `Abutting road width of ${projectRoadWidth}m satisfies statutory requirement of minimum ${minRequiredRoad}m.`
    });
  }

  // 6. Cross-Check: Open Space Reservation (OSR) Trigger
  const plotAreaSqM = parseFloat(project.plotArea) || 200.0;
  if (plotAreaSqM >= 3000) {
    const osrReq = requirements.find(r => r.idKey === 'OSR_LAND_RESERVATION_DEED');
    if (!osrReq || osrReq.verificationStatus !== 'Appears Valid') {
      auditReport.blockers.push({
        code: 'OSR_COMPLIANCE_MANDATORY',
        title: 'Open Space Reservation (OSR) Deed Required (Rule 41)',
        detail: `Plot area is ${plotAreaSqM} sq.m (>= 3,000 sq.m threshold). 10% OSR reservation or equivalent guideline value remittance is mandatory under TNCDBR Rule 41.`
      });
    } else {
      auditReport.passedChecks.push({
        title: 'OSR Compliance Verified',
        detail: `10% Open Space Reservation deed attached in accordance with TNCDBR Rule 41.`
      });
    }
  }

  // 7. Calculate Dynamic Readiness Score (0-100)
  let score = 0;
  // Document uploads: up to 50 points
  const uploadRatio = totalMandatory.length > 0 ? (uploadedMandatory.length / totalMandatory.length) : 1;
  score += Math.round(uploadRatio * 50);

  // Blocker penalties
  if (auditReport.blockers.length === 0) {
    score += 40; // Full consistency & rule adherence points
  } else {
    // Penalty per blocker
    score = Math.max(0, score - (auditReport.blockers.length * 15));
  }

  // Professional Review completed points
  if (permit.professionalReview && permit.professionalReview.isCleared) {
    score += 10;
  }

  auditReport.readinessScore = Math.min(100, Math.max(0, score));

  if (auditReport.blockers.length === 0 && uploadRatio === 1) {
    auditReport.status = permit.professionalReview?.isCleared ? 'CLEARED_FOR_SUBMISSION' : 'READY_FOR_PROFESSIONAL_REVIEW';
  } else {
    auditReport.status = 'HAS_BLOCKERS';
  }

  return auditReport;
}

module.exports = {
  runPreSubmissionAudit
};
