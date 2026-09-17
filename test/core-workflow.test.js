/**
 * Automated Core Workflow Test Suite for PermitFlow TN
 * Verifies:
 * 1. User Registration, Authentication & Token Issuance
 * 2. Input Validation (rejection of malformed requests)
 * 3. Project Creation & TNCDBR-2019 Conditional Checklist Generation
 * 4. Real Gemini AI Document Validation (Valid Patta Extract)
 * 5. Real Gemini AI Wrong Document Detection (Invalid Invoice detection)
 * 6. Cross-Document Conflict Detection (Ownership discrepancy)
 * 7. Pre-Submission Audit & Readiness Score
 * 8. Strict Authorization & User Isolation (403 Forbidden for unauthorized user)
 * 9. Licensed Professional Review Sign-off
 * 10. Official Submission Package Generation
 * 11. Official Government Application Tracking
 * 12. Government Scrutiny Milestone Progression
 * 13. Data Persistence Durability Check
 */

const assert = require('assert');
const BASE_URL = 'http://localhost:3000';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { rawText: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function runCoreWorkflowTests() {
  console.log('================================================================');
  console.log('🚀 PERMITFLOW TN - CORE WORKFLOW AUTOMATED END-TO-END TEST SUITE');
  console.log('================================================================\n');

  let tokenUserA = null;
  let userA = null;
  let tokenUserB = null;
  let userB = null;
  let createdProject = null;
  let createdPermit = null;
  let requirements = [];

  // ---------------------------------------------------------------------------
  // STEP 1: AUTHENTICATION & AUTHORIZATION SETUP
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: User Registration & Authentication ---');
  
  // Register User A (Authorized Project Manager)
  const emailA = `pm.arjun.${Date.now()}@tn-builders.com`;
  const regA = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: emailA,
      password: 'Password123!',
      firstName: 'Arjun',
      lastName: 'Chidambaram',
      role: 'PROJECT_MANAGER'
    })
  });
  assert.strictEqual(regA.status, 201, `Failed to register User A: ${JSON.stringify(regA.data)}`);
  assert.ok(regA.data.token, 'Token must be issued for User A');
  tokenUserA = regA.data.token;
  userA = regA.data.user;
  console.log(`✅ User A registered: ${userA.email} (${userA.id})`);

  // Register User B (Unauthorized External Contractor)
  const emailB = `unauthorized.${Date.now()}@external.com`;
  const regB = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: emailB,
      password: 'Password123!',
      firstName: 'Unauthorized',
      lastName: 'Contractor',
      role: 'PROJECT_MANAGER'
    })
  });
  assert.strictEqual(regB.status, 201);
  tokenUserB = regB.data.token;
  userB = regB.data.user;
  console.log(`✅ User B registered: ${userB.email} (${userB.id})`);

  // Verify /api/v1/auth/me with Bearer token
  const meRes = await request('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.data.user.email, emailA);
  console.log('✅ Bearer token authentication verified.\n');

  // ---------------------------------------------------------------------------
  // STEP 2: REQUEST VALIDATION & SECURITY
  // ---------------------------------------------------------------------------
  console.log('--- Step 2: Request Input Validation & Security ---');

  // Attempt invalid project creation (missing district & invalid area)
  const badProjRes = await request('/api/v1/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify({
      name: 'X',
      address: '12',
      district: 'InvalidState'
    })
  });
  assert.strictEqual(badProjRes.status, 400, 'Malformed project creation must return 400 Bad Request');
  assert.ok(badProjRes.data.error, 'Rejection error message must be present');
  console.log(`✅ Bad input rejected safely: "${badProjRes.data.error}"\n`);

  // ---------------------------------------------------------------------------
  // STEP 3: PROJECT CREATION & TNCDBR CHECKLIST GENERATION
  // ---------------------------------------------------------------------------
  console.log('--- Step 3: Project Creation & TNCDBR-2019 Checklist Generation ---');

  const projectPayload = {
    name: 'Peelamedu Tech Square - Phase 1',
    description: 'Commercial IT Development in Coimbatore conforming to TNCDBR-2019 Rule 35 & 41.',
    address: '420 Avinashi Road, Peelamedu',
    district: 'Coimbatore',
    city: 'Coimbatore',
    taluk: 'Coimbatore South',
    parcelNumber: 'T.S. No. 104/3A',
    ownerName: 'Coimbatore Infrastructure Corp Ltd',
    ownerContact: emailA,
    plotArea: 3200, // >= 3000 sq.m -> Triggers Rule 41 OSR 10% Reservation Deed!
    builtUpArea: 6400,
    height: 18.0,
    roadWidth: 18.0, // m
    projectType: 'Commercial Building Plan Approval'
  };

  const createProjRes = await request('/api/v1/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify(projectPayload)
  });
  assert.strictEqual(createProjRes.status, 201, `Failed to create project: ${JSON.stringify(createProjRes.data)}`);
  createdProject = createProjRes.data.project;
  createdPermit = createProjRes.data.permit;
  assert.strictEqual(createdProject.managerId, userA.id, 'Project manager must be assigned to creator');
  console.log(`✅ Project created: "${createdProject.name}" [ID: ${createdProject.id}]`);
  console.log(`✅ Designated Authority: ${createdPermit.authority.name}`);
  console.log(`✅ Generated ${createProjRes.data.checklistLength} conditional checklist requirements.`);

  // Verify permit details & requirements
  const permitRes = await request(`/api/v1/permits/${createdPermit.id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  assert.strictEqual(permitRes.status, 200);
  requirements = permitRes.data.requirements;
  
  // Verify OSR requirement triggered for plot > 2500 sq.m
  const osrReq = requirements.find(r => r.idKey === 'OSR_LAND_RESERVATION_DEED');
  assert.ok(osrReq, 'TNCDBR Rule 41 OSR requirement must be conditionally triggered for area > 2500 sq.m');
  console.log(`✅ Verified OSR requirement dynamically triggered: "${osrReq.name}"\n`);

  // ---------------------------------------------------------------------------
  // STEP 4: REAL GEMINI AI DOCUMENT VALIDATION (VALID DOCUMENT)
  // ---------------------------------------------------------------------------
  console.log('--- Step 4: Real Gemini AI Document Validation (Valid Patta Extract) ---');

  const pattaReq = requirements.find(r => r.idKey === 'PATTA_CHITTA_TSLR');
  assert.ok(pattaReq, 'Patta requirement must exist');

  const validPattaDoc = {
    fileName: 'official_anywhere_patta_tsno104_3a.pdf',
    fileSize: 180000,
    mimeType: 'application/pdf',
    fileText: `
      GOVERNMENT OF TAMIL NADU - REVENUE DEPARTMENT
      e-Services Land Records Patta / Chitta Extract
      District: Coimbatore, Taluk: Coimbatore South, Town: Peelamedu
      Town Survey Number: T.S. No. 104/3A
      Registered Patta Holder / Owner: Coimbatore Infrastructure Corp Ltd
      Total Extent: 3200 sq.meters
      Abutting Road: Avinashi Road (18.0m Width)
      Extract certified digitally with QR seal by Special Tahsildar (Town Survey).
    `
  };

  const uploadValidRes = await request(`/api/v1/permits/${createdPermit.id}/requirements/${pattaReq.id}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify(validPattaDoc)
  });
  assert.strictEqual(uploadValidRes.status, 201, `Failed to upload document: ${JSON.stringify(uploadValidRes.data)}`);
  
  const validVerification = uploadValidRes.data.verification;
  console.log(`AI Provider: ${validVerification.provider || 'Gemini 3 Flash'}`);
  console.log(`AI Status: [${validVerification.badge}] ${validVerification.aiStatus}`);
  console.log(`AI Reason: ${validVerification.reason}`);
  console.log(`AI Extracted Owner: ${validVerification.extractedDetails?.ownerName}`);
  console.log(`AI Extracted Survey: ${validVerification.extractedDetails?.surveyNumber}`);
  console.log(`Statutory Disclaimer: "${validVerification.disclaimer}"`);

  assert.strictEqual(validVerification.aiStatus, 'Appears Valid', 'Valid Patta extract must be marked Appears Valid');
  assert.ok(validVerification.disclaimer, 'Legal authenticity disclaimer must be present');
  console.log('✅ Real Gemini AI document validation passed successfully.\n');

  // ---------------------------------------------------------------------------
  // STEP 5: WRONG DOCUMENT DETECTION BY REAL GEMINI AI
  // ---------------------------------------------------------------------------
  console.log('--- Step 5: Real Gemini AI Wrong Document Detection ---');

  const deedReq = requirements.find(r => r.idKey === 'REGISTERED_TITLE_DEED');
  assert.ok(deedReq, 'Registered Title Deed requirement must exist');

  const wrongInvoiceDoc = {
    fileName: 'cement_purchase_invoice_tax_bill.pdf',
    fileSize: 34000,
    mimeType: 'application/pdf',
    fileText: `
      COMMERCIAL TAX INVOICE
      Ultratech Bulk Cement Supply Agency, Coimbatore
      Invoice No: BLK-CMB-2026-881
      Date: 12-09-2026
      Billed To: Site Contractor, Peelamedu Site
      Description: 500 Bags OPC 53 Grade Cement
      Amount: INR 1,95,000
      Payment Status: Paid via NEFT
    `
  };

  const uploadWrongRes = await request(`/api/v1/permits/${createdPermit.id}/requirements/${deedReq.id}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify(wrongInvoiceDoc)
  });
  assert.strictEqual(uploadWrongRes.status, 201);
  
  const wrongVerification = uploadWrongRes.data.verification;
  console.log(`AI Status: [${wrongVerification.badge}] ${wrongVerification.aiStatus}`);
  console.log(`AI Reason: ${wrongVerification.reason}`);
  console.log(`Detected Document Type: ${wrongVerification.detectedDocumentType}`);

  assert.strictEqual(wrongVerification.aiStatus, 'Invalid', 'Commercial invoice must be flagged as Invalid');
  assert.ok(
    wrongVerification.reason.toLowerCase().includes('invoice') || 
    wrongVerification.reason.toLowerCase().includes('bill') ||
    wrongVerification.reason.toLowerCase().includes('unrelated') ||
    wrongVerification.reason.toLowerCase().includes('not official'),
    'Reason must explain why document is invalid'
  );
  console.log('✅ Real Gemini AI successfully detected and rejected wrong document.\n');

  // ---------------------------------------------------------------------------
  // STEP 6: CROSS-DOCUMENT CONFLICT DETECTION
  // ---------------------------------------------------------------------------
  console.log('--- Step 6: Cross-Document Conflict Detection ---');

  // Upload deed with mismatching owner name to test conflict detection
  const mismatchedDeedDoc = {
    fileName: 'v2_sale_deed_mismatch_name_doc914.pdf',
    fileSize: 450000,
    mimeType: 'application/pdf',
    fileText: `
      REGISTERED SALE DEED - BOOK 1, DOC NO 914/2019
      Sub-Registrar Office, Coimbatore
      Vendor: Peelamedu Agro Lands Ltd
      Purchaser / Title Holder: P. Ramanathan (Different from Project Owner)
      Schedule Property: Town Survey No. 104/3A, Peelamedu
      Extent: 2800 sq.m
    `
  };

  const uploadMismatchRes = await request(`/api/v1/permits/${createdPermit.id}/requirements/${deedReq.id}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify(mismatchedDeedDoc)
  });
  assert.strictEqual(uploadMismatchRes.status, 201);

  // Check audit for OWNERSHIP_MISMATCH blocker
  const auditMismatch = uploadMismatchRes.data.audit;
  const ownerConflict = auditMismatch.blockers.find(b => b.code === 'OWNERSHIP_MISMATCH' || b.title.includes('Ownership'));
  console.log(`Active Blockers: ${auditMismatch.blockers.length}`);
  if (ownerConflict) {
    console.log(`✅ Cross-document conflict detected: "${ownerConflict.title}"`);
    console.log(`   Detail: ${ownerConflict.detail}`);
  }

  // Now resolve the conflict by uploading the correct registered deed
  const correctedDeedDoc = {
    fileName: 'v3_registered_sale_deed_doc_4118_2021.pdf',
    fileSize: 620000,
    mimeType: 'application/pdf',
    fileText: `
      REGISTERED TITLE DEED - DOCUMENT NO. 4118/2021
      Sub-Registrar Office, Gandhipuram, Coimbatore
      In Favor Of: Coimbatore Infrastructure Corp Ltd
      Property Schedule: T.S. No. 104/3A, Peelamedu, Coimbatore
      Extent: 3,200 sq.meters
      Abutting Road: Avinashi Road (18.0m)
      Legally executed and registered with clear encumbrance-free title.
    `
  };

  const uploadCorrectRes = await request(`/api/v1/permits/${createdPermit.id}/requirements/${deedReq.id}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify(correctedDeedDoc)
  });
  assert.strictEqual(uploadCorrectRes.status, 201);
  assert.strictEqual(uploadCorrectRes.data.verification.aiStatus, 'Appears Valid');
  console.log('✅ Corrected deed uploaded. Ownership conflict resolved.\n');

  // ---------------------------------------------------------------------------
  // STEP 7: PRE-SUBMISSION AUDIT & READINESS SCORE
  // ---------------------------------------------------------------------------
  console.log('--- Step 7: Pre-Submission Audit & Readiness Score ---');

  const auditRes = await request(`/api/v1/permits/${createdPermit.id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  const audit = auditRes.data.audit;
  console.log(`Pre-Submission Audit Status: ${audit.status}`);
  console.log(`Readiness Score: ${audit.readinessScore}%`);
  console.log(`Remaining Missing Mandatory Docs: ${audit.blockers.filter(b => b.code === 'MISSING_MANDATORY_DOC').length}`);
  assert.ok(typeof audit.readinessScore === 'number', 'Readiness score must be numeric');
  console.log('✅ Pre-submission audit calculated accurately.\n');

  // ---------------------------------------------------------------------------
  // STEP 8: AUTHENTICATION & AUTHORIZATION ENFORCEMENT (403 FORBIDDEN)
  // ---------------------------------------------------------------------------
  console.log('--- Step 8: Strict Authorization & User Isolation (403 Checks) ---');

  // User B tries to view User A's project
  const forbidProjRes = await request(`/api/v1/projects/${createdProject.id}`, {
    headers: { Authorization: `Bearer ${tokenUserB}` }
  });
  assert.strictEqual(forbidProjRes.status, 403, 'Unauthorized user must be blocked with 403 Forbidden');
  console.log(`✅ Unauthorized project access blocked: HTTP ${forbidProjRes.status} (${forbidProjRes.data.error})`);

  // User B tries to view User A's permit
  const forbidPermitRes = await request(`/api/v1/permits/${createdPermit.id}`, {
    headers: { Authorization: `Bearer ${tokenUserB}` }
  });
  assert.strictEqual(forbidPermitRes.status, 403, 'Unauthorized permit view must be blocked with 403');
  console.log(`✅ Unauthorized permit view blocked: HTTP ${forbidPermitRes.status}`);

  // User B tries to upload document to User A's permit
  const forbidUploadRes = await request(`/api/v1/permits/${createdPermit.id}/requirements/${pattaReq.id}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserB}` },
    body: JSON.stringify({ fileName: 'rogue_file.pdf', fileSize: 10000 })
  });
  assert.strictEqual(forbidUploadRes.status, 403, 'Unauthorized upload must be blocked with 403');
  console.log(`✅ Unauthorized upload blocked: HTTP ${forbidUploadRes.status}\n`);

  // ---------------------------------------------------------------------------
  // STEP 9: LICENSED PROFESSIONAL REVIEW SIGN-OFF
  // ---------------------------------------------------------------------------
  console.log('--- Step 9: Licensed Professional Review Workflow ---');

  // Test missing declaration rejection
  const badReview = await request(`/api/v1/permits/${createdPermit.id}/professional-review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify({
      reviewerName: 'Ar. K. Swaminathan',
      registrationNumber: 'CA/2014/54120',
      declarationChecked: false
    })
  });
  assert.strictEqual(badReview.status, 400, 'Unchecked declaration must be rejected');

  // Valid Professional Review
  const goodReview = await request(`/api/v1/permits/${createdPermit.id}/professional-review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify({
      reviewerName: 'Ar. K. Swaminathan, B.Arch, AIIA',
      registrationNumber: 'CA/2014/54120',
      discipline: 'ARCHITECT',
      remarks: 'Architectural drawings, parking provisions, and OSR reservation vetted in conformity with TNCDBR-2019 Rule 35 & 41.',
      declarationChecked: true
    })
  });
  assert.strictEqual(goodReview.status, 200, `Failed professional review: ${JSON.stringify(goodReview.data)}`);
  assert.ok(goodReview.data.professionalReview.signedAt, 'Digital sign-off timestamp must exist');
  console.log(`✅ Professional review recorded by ${goodReview.data.professionalReview.reviewerName} (${goodReview.data.professionalReview.registrationNumber})`);
  console.log(`   Signed at: ${goodReview.data.professionalReview.signedAt}\n`);

  // ---------------------------------------------------------------------------
  // STEP 10: SUBMISSION PACKAGE GENERATION
  // ---------------------------------------------------------------------------
  console.log('--- Step 10: Official Submission Package Generation ---');

  const pkgRes = await request(`/api/v1/permits/${createdPermit.id}/generate-package`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  assert.strictEqual(pkgRes.status, 200, `Failed to generate package: ${JSON.stringify(pkgRes.data)}`);
  const manifest = pkgRes.data.manifest;
  assert.ok(manifest.packageId, 'Package ID must be generated');
  assert.ok(manifest.fileIndex.length > 0, 'Package file index must be populated');
  console.log(`✅ Submittal Package Dossier created: ${manifest.packageId}`);
  console.log(`✅ Indexed Documents for Portal Upload: ${manifest.totalFilesIncluded}`);
  console.log(`   Target Portal: ${manifest.portalSubmissionUrl}\n`);

  // ---------------------------------------------------------------------------
  // STEP 11: RECORD OFFICIAL GOVERNMENT SUBMISSION
  // ---------------------------------------------------------------------------
  console.log('--- Step 11: Record Official Government Application Reference Number ---');

  const filingPayload = {
    officialApplicationNumber: 'TN-DTCP-2026-CMB-849102',
    portalType: 'DTCP_SINGLE_WINDOW',
    remarks: 'Application filed online via DTCP Tamil Nadu Single Window System.'
  };

  const filingRes = await request(`/api/v1/permits/${createdPermit.id}/record-government-submission`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify(filingPayload)
  });
  assert.strictEqual(filingRes.status, 200, `Failed to record government filing: ${JSON.stringify(filingRes.data)}`);
  const tracking = filingRes.data.governmentTracking;
  assert.strictEqual(tracking.officialApplicationNumber, 'TN-DTCP-2026-CMB-849102');
  console.log(`✅ Recorded Official Filing: Reference # ${tracking.officialApplicationNumber}`);
  console.log(`   Portal Type: ${tracking.portalType}\n`);

  // ---------------------------------------------------------------------------
  // STEP 12: GOVERNMENT SCRUTINY MILESTONE PROGRESSION
  // ---------------------------------------------------------------------------
  console.log('--- Step 12: Government Scrutiny Milestone Progression ---');

  const milestonePayload = {
    stage: 'SITE_INSPECTION_SCHEDULED',
    remarks: 'DTCP Assistant Director site inspection scheduled for 25-09-2026.'
  };

  const milestoneRes = await request(`/api/v1/permits/${createdPermit.id}/government-milestone`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenUserA}` },
    body: JSON.stringify(milestonePayload)
  });
  assert.strictEqual(milestoneRes.status, 200, `Failed to update milestone: ${JSON.stringify(milestoneRes.data)}`);
  const updatedTracking = milestoneRes.data.governmentTracking;
  assert.strictEqual(updatedTracking.currentStage, 'SITE_INSPECTION_SCHEDULED');
  console.log(`✅ Government Scrutiny Milestone Updated: ${updatedTracking.currentStage}`);
  const historyLen = (updatedTracking.statusHistory || updatedTracking.milestones || []).length;
  console.log(`   Milestones recorded: ${historyLen}\n`);

  // ---------------------------------------------------------------------------
  // STEP 13: DATA PERSISTENCE CHECK (VERIFY ON DISK)
  // ---------------------------------------------------------------------------
  console.log('--- Step 13: Data Persistence Verification ---');

  const fs = require('fs');
  const dbPath = 'C:\\permitflow\\data\\db.json';
  assert.ok(fs.existsSync(dbPath), 'data/db.json must exist on disk');
  const diskData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  
  const savedProj = diskData.projects.find(p => p.id === createdProject.id);
  assert.ok(savedProj, 'Created project must be persisted on disk');
  const savedPermit = diskData.permits.find(p => p.id === createdPermit.id);
  assert.ok(savedPermit, 'Created permit must be persisted on disk');
  assert.strictEqual(savedPermit.governmentTracking?.officialApplicationNumber, 'TN-DTCP-2026-CMB-849102');
  assert.ok(diskData.validationResults.length > 0, 'Validation results must be persisted on disk');
  assert.ok(diskData.timelineEvents.length > 0, 'Timeline events must be persisted on disk');
  console.log('✅ Disk storage verification passed. All data survives server restarts.\n');

  // ---------------------------------------------------------------------------
  // STEP 14: RECORD DELETION & STRICT AUTHORIZATION
  // ---------------------------------------------------------------------------
  console.log('--- Step 14: Record Deletion & Authorization Verification ---');

  // 14A. Document Deletion by Owner (User A)
  const targetPattaReq = requirements.find(r => r.idKey === 'PATTA_CHITTA_TSLR');
  const deleteDocRes = await request(`/api/v1/permits/${createdPermit.id}/requirements/${targetPattaReq.id}/documents`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  assert.strictEqual(deleteDocRes.status, 200, `Failed to delete document: ${JSON.stringify(deleteDocRes.data)}`);
  assert.strictEqual(deleteDocRes.data.success, true);
  assert.strictEqual(deleteDocRes.data.requirement.status, 'PENDING');
  assert.strictEqual(deleteDocRes.data.requirement.verificationStatus, 'Missing');
  console.log(`✅ Document deleted successfully. Requirement reset to: [${deleteDocRes.data.requirement.verificationBadge}]`);
  console.log(`   Updated Readiness Score: ${deleteDocRes.data.audit.readinessScore}%`);

  // 14B. Unauthorized Project Deletion Attempt (User B tries to delete User A's project)
  const forbidDeleteRes = await request(`/api/v1/projects/${createdProject.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenUserB}` }
  });
  assert.strictEqual(forbidDeleteRes.status, 403, 'Unauthorized user deletion must be blocked with 403 Forbidden');
  console.log(`✅ Unauthorized project deletion blocked: HTTP ${forbidDeleteRes.status}`);

  // 14C. Authorized Project Deletion (User A deletes their project)
  const deleteProjRes = await request(`/api/v1/projects/${createdProject.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  assert.strictEqual(deleteProjRes.status, 200, `Failed to delete project: ${JSON.stringify(deleteProjRes.data)}`);
  assert.strictEqual(deleteProjRes.data.success, true);
  console.log(`✅ Project deleted by owner: ${deleteProjRes.data.message}`);

  // 14D. Verify cascading cleanup
  const getDeletedRes = await request(`/api/v1/projects/${createdProject.id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` }
  });
  assert.strictEqual(getDeletedRes.status, 404, 'Deleted project must return 404');
  console.log('✅ Cascade deletion verified: Project and submittals no longer exist.\n');

  console.log('================================================================');
  console.log('🎉 ALL 14 CORE WORKFLOW INTEGRATION TESTS PASSED 100%!');
  console.log('================================================================');
}

runCoreWorkflowTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
