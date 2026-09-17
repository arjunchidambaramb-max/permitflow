const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { storageService, UPLOADS_DIR } = require('./src/services/storage.service');
const { TN_DISTRICTS, TN_AUTHORITIES, evaluateTNCDBRClassification, generateTamilNaduChecklist } = require('./src/jurisdictions/tamil-nadu');
const { verifyTamilNaduDocument } = require('./src/services/verification.service');
const { runPreSubmissionAudit } = require('./src/services/audit.service');
const { GOVT_PORTALS, recordProfessionalReview, generateSubmissionPackage, recordOfficialGovernmentSubmission, updateGovernmentMilestone } = require('./src/services/submission.service');
const { authService } = require('./src/services/auth.service');
const {
  validateProjectInput,
  validateDocumentUpload,
  validateProfessionalReview,
  validateGovernmentSubmission,
  safeErrorHandler
} = require('./src/services/validation.service');
const { STATUTORY_DISCLAIMER } = require('./src/services/ai.service');

const PORT = process.env.PORT || 3000;
const db = storageService.getDB();

// -----------------------------------------------------------------------------
// HTTP Helpers
// -----------------------------------------------------------------------------
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id'
  });
  res.end(JSON.stringify(data));
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

// -----------------------------------------------------------------------------
// HTTP Server & Router
// -----------------------------------------------------------------------------
async function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id'
    });
    return res.end();
  }

  try {
    const user = authService.resolveUser(req);

    // 1. Authentication & User Management
    if (pathname === '/api/v1/auth/register' && method === 'POST') {
      const body = await parseJSONBody(req);
      try {
        const result = authService.registerUser(body);
        return sendJSON(res, 201, { success: true, ...result });
      } catch (err) {
        return sendJSON(res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === '/api/v1/auth/login' && method === 'POST') {
      const body = await parseJSONBody(req);
      try {
        const result = authService.loginUser(body);
        return sendJSON(res, 200, { success: true, ...result });
      } catch (err) {
        return sendJSON(res, 401, { success: false, error: err.message });
      }
    }

    if (pathname === '/api/v1/auth/me' && method === 'GET') {
      return sendJSON(res, 200, { user, availableUsers: db.users });
    }

    if (pathname === '/api/v1/auth/switch-role' && method === 'POST') {
      const body = await parseJSONBody(req);
      const targetUser = db.users.find(u => u.role === body.role || u.id === body.userId);
      if (targetUser) {
        db.currentUser = targetUser;
        storageService.save();
        return sendJSON(res, 200, { success: true, user: db.currentUser });
      }
      return sendJSON(res, 400, { error: 'Role not found' });
    }

    // 2. Metadata / Lookup options for Tamil Nadu
    if (pathname === '/api/v1/tn/metadata' && method === 'GET') {
      return sendJSON(res, 200, {
        districts: TN_DISTRICTS,
        authorities: TN_AUTHORITIES,
        portals: GOVT_PORTALS
      });
    }

    // 3. Dynamic Checklist Scrutiny Preview
    if (pathname === '/api/v1/tn/evaluate-rules' && method === 'POST') {
      const body = await parseJSONBody(req);
      const evaluation = generateTamilNaduChecklist(body);
      return sendJSON(res, 200, evaluation);
    }

    // 4. Dashboard KPIs (Filtered by authenticated user access)
    if (pathname === '/api/v1/dashboard/metrics' && method === 'GET') {
      const accessibleProjects = db.projects.filter(p => authService.canAccessProject(user, p));
      const totalProjects = accessibleProjects.length;
      const projectIds = new Set(accessibleProjects.map(p => p.id));
      const accessiblePermits = db.permits.filter(p => projectIds.has(p.projectId));
      const totalActivePermits = accessiblePermits.length;
      
      let actionRequiredCount = 0;
      let underGovtReviewCount = 0;
      let readyForReviewCount = 0;

      const projectSummaries = accessibleProjects.map(proj => {
        const permits = db.permits.filter(p => p.projectId === proj.id);
        permits.forEach(p => {
          const reqs = db.requirements.filter(r => r.permitId === p.id);
          const docs = db.documents.filter(d => reqs.some(r => r.id === d.requirementId));
          const audit = runPreSubmissionAudit(p, proj, reqs, docs);
          p.audit = audit;

          if (audit.blockers.length > 0) actionRequiredCount++;
          if (p.governmentTracking) underGovtReviewCount++;
          if (audit.status === 'READY_FOR_PROFESSIONAL_REVIEW') readyForReviewCount++;
        });

        return {
          ...proj,
          permits
        };
      });

      return sendJSON(res, 200, {
        totalProjects,
        totalActivePermits,
        actionRequiredCount,
        underGovtReviewCount,
        readyForReviewCount,
        projects: projectSummaries,
        notifications: db.notifications
      });
    }

    // 5. Notifications
    if (pathname === '/api/v1/notifications' && method === 'GET') {
      return sendJSON(res, 200, db.notifications);
    }
    if (pathname.match(/^\/api\/v1\/notifications\/([^\/]+)\/read$/) && method === 'PATCH') {
      const id = pathname.split('/')[4];
      const notif = db.notifications.find(n => n.id === id);
      if (notif) notif.isRead = true;
      storageService.save();
      return sendJSON(res, 200, { success: true, notification: notif });
    }

    // 6. Projects CRUD (Enforcing User Access Isolation)
    if (pathname === '/api/v1/projects' && method === 'GET') {
      const search = (parsedUrl.query.search || '').toLowerCase();
      const filtered = db.projects.filter(p =>
        authService.canAccessProject(user, p) && (
          p.name.toLowerCase().includes(search) ||
          p.city.toLowerCase().includes(search) ||
          (p.district && p.district.toLowerCase().includes(search)) ||
          p.address.toLowerCase().includes(search) ||
          (p.parcelNumber && p.parcelNumber.toLowerCase().includes(search))
        )
      ).map(p => {
        const permits = db.permits.filter(pm => pm.projectId === p.id).map(pm => {
          const reqs = db.requirements.filter(r => r.permitId === pm.id);
          const docs = db.documents.filter(d => reqs.some(r => r.id === d.requirementId));
          return {
            ...pm,
            audit: runPreSubmissionAudit(pm, p, reqs, docs)
          };
        });
        return {
          ...p,
          permitsCount: permits.length,
          permits
        };
      });
      return sendJSON(res, 200, filtered);
    }

    // Single Project GET (With 403 Forbidden Authorization Guard)
    if (pathname.match(/^\/api\/v1\/projects\/([^\/]+)$/) && method === 'GET') {
      const id = pathname.split('/')[4];
      const project = db.projects.find(p => p.id === id);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });
      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to access this project.' });
      }
      return sendJSON(res, 200, project);
    }

    // DELETE PROJECT (With 403 Forbidden Authorization Guard & Cascade Cleanup)
    if (pathname.match(/^\/api\/v1\/projects\/([^\/]+)$/) && method === 'DELETE') {
      const id = pathname.split('/')[4];
      const project = db.projects.find(p => p.id === id);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });
      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to delete this project.' });
      }
      const success = storageService.deleteProject(id);
      return sendJSON(res, 200, { success, message: 'Project and all associated submittals deleted successfully.' });
    }

    // CREATE PROJECT WITH VALIDATION & USER OWNERSHIP
    if (pathname === '/api/v1/projects' && method === 'POST') {
      const rawBody = await parseJSONBody(req);
      const valRes = validateProjectInput(rawBody);
      if (!valRes.isValid) {
        return sendJSON(res, 400, { error: valRes.errors.join('; ') });
      }

      const body = { ...rawBody, ...valRes.sanitized };
      const district = body.district || 'Chennai';
      const city = body.city || district;
      const taluk = body.taluk || (TN_DISTRICTS[district]?.defaultTaluks[0] || 'General Taluk');
      const projectType = body.initialPermitType || body.projectType || 'Commercial Building Plan Approval';
      const plotArea = parseFloat(body.plotArea) || 300.0;
      const builtUpArea = parseFloat(body.builtUpArea) || 600.0;
      const height = parseFloat(body.height) || 12.0;
      const roadWidth = parseFloat(body.roadWidth) || 9.0;
      const authorityKey = body.authority || (TN_DISTRICTS[district]?.authority || 'CMDA');

      // 1. Evaluate TNCDBR Classification and Rules
      const tncDbrAnalysis = evaluateTNCDBRClassification({
        height,
        builtUpArea,
        plotArea,
        roadWidth,
        projectType,
        district,
        authority: authorityKey,
        dwellingUnits: body.dwellingUnits
      });

      const selectedAuthority = tncDbrAnalysis.authority;

      // 2. Instantiate Project with User Ownership
      const newProject = {
        id: `proj-tn-${Date.now()}`,
        name: body.name,
        description: body.description || '',
        address: body.address,
        country: 'India',
        state: 'Tamil Nadu',
        district,
        city,
        taluk,
        zipCode: body.zipCode || '600001',
        parcelNumber: body.parcelNumber || 'S.No. PENDING',
        ownerName: body.ownerName || 'Project Applicant',
        ownerContact: body.ownerContact || user.email,
        plotArea,
        builtUpArea,
        height,
        roadWidth,
        nearWaterBody: Boolean(body.nearWaterBody),
        nearAirport: Boolean(body.nearAirport),
        abuttingHighway: Boolean(body.abuttingHighway),
        budget: Number(body.budget) || 10000000,
        estimatedStartDate: body.estimatedStartDate || new Date().toISOString().split('T')[0],
        estimatedEndDate: body.estimatedEndDate || '2028-12-31',
        managerId: user.id,
        authority: selectedAuthority.id,
        governingCode: selectedAuthority.governingCode,
        createdAt: new Date().toISOString()
      };
      db.projects.unshift(newProject);

      // 3. Automatically add Tamil Nadu Permit Application
      const newPermit = {
        id: `pmt-tn-${Date.now()}`,
        projectId: newProject.id,
        permitType: projectType,
        authority: selectedAuthority,
        status: 'AUDIT_IN_PROGRESS',
        minRoadWidthRequired: tncDbrAnalysis.minRoadWidthRequired,
        actualRoadWidth: roadWidth,
        isRoadWidthCompliant: tncDbrAnalysis.isRoadWidthCompliant,
        buildingClass: tncDbrAnalysis.buildingClass,
        targetSubmissionDate: '2026-11-30',
        actualSubmissionDate: null,
        notes: `Tamil Nadu planning permission submittal for ${tncDbrAnalysis.buildingClass} under ${selectedAuthority.name}.`,
        professionalReview: null,
        submissionPackage: null,
        governmentTracking: null,
        createdAt: new Date().toISOString()
      };
      db.permits.push(newPermit);

      // 4. Generate the Official Tamil Nadu Required Document Checklist
      const { checklist } = generateTamilNaduChecklist({
        district,
        authority: selectedAuthority.id,
        projectType,
        plotArea,
        builtUpArea,
        height,
        roadWidth,
        nearWaterBody: newProject.nearWaterBody,
        nearAirport: newProject.nearAirport,
        abuttingHighway: newProject.abuttingHighway,
        dwellingUnits: body.dwellingUnits
      });

      checklist.forEach((item, idx) => {
        db.requirements.push({
          id: `req-tn-${Date.now()}-${idx + 1}`,
          permitId: newPermit.id,
          idKey: item.idKey,
          documentType: item.idKey,
          category: item.category,
          name: item.name,
          description: item.description,
          isMandatory: item.isMandatory,
          status: 'PENDING',
          regulatoryCitation: item.regulatoryCitation,
          acceptedFormats: item.acceptedFormats,
          verificationStatus: 'Missing',
          verificationBadge: '❌ Missing',
          verificationReason: `Required document not yet uploaded. Mandatory under ${item.regulatoryCitation}.`,
          extractedDetails: {}
        });
      });

      storageService.addTimelineEvent({
        id: `aud-tn-${Date.now()}`,
        permitId: newPermit.id,
        changedById: user.id,
        action: 'PROJECT_AND_CHECKLIST_INITIALIZED',
        fromStatus: null,
        toStatus: 'AUDIT_IN_PROGRESS',
        details: `Created project in ${district}, Tamil Nadu. Assigned to ${selectedAuthority.name}. Generated ${checklist.length} regulatory requirements under TNCDBR-2019.`,
        createdAt: new Date().toISOString()
      });

      storageService.save();
      return sendJSON(res, 201, { project: newProject, permit: newPermit, checklistLength: checklist.length });
    }

    // 7. Single Permit Detail with Pre-Submission Audit
    if (pathname.match(/^\/api\/v1\/permits\/([^\/]+)$/) && method === 'GET') {
      const id = pathname.split('/')[4];
      const permit = db.permits.find(p => p.id === id);
      if (!permit) return sendJSON(res, 404, { error: 'Permit not found' });

      const project = db.projects.find(pr => pr.id === permit.projectId);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });
      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to access this permit.' });
      }

      const reqs = db.requirements.filter(r => r.permitId === permit.id).map(r => {
        const docs = db.documents.filter(d => d.requirementId === r.id);
        return {
          ...r,
          currentDocument: docs.find(d => d.isCurrent) || null,
          allVersions: docs
        };
      });

      const docs = db.documents.filter(d => reqs.some(r => r.id === d.requirementId));
      const audit = runPreSubmissionAudit(permit, project, reqs, docs);
      const audits = (db.timelineEvents || db.auditLogs || []).filter(a => a.permitId === permit.id).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

      return sendJSON(res, 200, {
        ...permit,
        project,
        requirements: reqs,
        audit,
        auditLogs: audits
      });
    }

    // 8. DOCUMENT UPLOAD & REAL GEMINI AI VERIFICATION
    if (pathname.match(/^\/api\/v1\/permits\/([^\/]+)\/requirements\/([^\/]+)\/documents$/) && method === 'POST') {
      const parts = pathname.split('/');
      const permitId = parts[4];
      const reqId = parts[6];

      const rawBody = await parseJSONBody(req);
      const valRes = validateDocumentUpload(rawBody);
      if (!valRes.isValid) {
        return sendJSON(res, 400, { error: valRes.errors.join('; ') });
      }

      const permit = db.permits.find(p => p.id === permitId);
      if (!permit) return sendJSON(res, 404, { error: 'Permit not found' });

      const project = db.projects.find(pr => pr.id === permit.projectId);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });

      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to upload documents for this project.' });
      }

      const reqItem = db.requirements.find(r => r.id === reqId);
      if (!reqItem) return sendJSON(res, 404, { error: 'Requirement item not found' });

      const fileName = valRes.sanitized.fileName;
      const fileSize = valRes.sanitized.fileSize;

      // Archive older active versions
      const existingDocs = db.documents.filter(d => d.requirementId === reqId);
      existingDocs.forEach(d => { d.isCurrent = false; });
      const nextVersion = existingDocs.length + 1;

      // 1. Save Document Record
      const newDoc = {
        id: `doc-tn-${Date.now()}`,
        requirementId: reqId,
        fileName: `v${nextVersion}_${fileName}`,
        originalName: fileName,
        fileSizeBytes: fileSize,
        mimeType: valRes.sanitized.mimeType,
        fileText: valRes.sanitized.fileText,
        version: nextVersion,
        isCurrent: true,
        storageKey: `firebase-storage://permits/${permitId}/${reqId}/v${nextVersion}_${fileName}`,
        uploadedById: user.id,
        createdAt: new Date().toISOString()
      };

      // 2. REAL GEMINI MULTIMODAL AI VERIFICATION & OCR
      const verification = await verifyTamilNaduDocument(reqItem, newDoc, permit, project);
      newDoc.verification = verification;
      db.documents.push(newDoc);

      // Persist validation result in Firestore collection
      storageService.saveValidationResult({
        documentId: newDoc.id,
        requirementId: reqId,
        permitId,
        ...verification
      });

      // 3. Update Requirement State
      reqItem.verificationStatus = verification.aiStatus;
      reqItem.verificationBadge = verification.badge;
      reqItem.verificationReason = verification.reason;
      reqItem.extractedDetails = verification.extractedDetails || {};

      if (verification.aiStatus === 'Appears Valid') {
        reqItem.status = 'UPLOADED';
      } else if (verification.aiStatus === 'Needs Review') {
        reqItem.status = 'UPLOADED';
      } else {
        reqItem.status = 'PENDING';
      }

      // 4. Update Timeline Event & Audit Log
      storageService.addTimelineEvent({
        id: `aud-tn-${Date.now()}`,
        permitId,
        changedById: user.id,
        action: 'DOCUMENT_AI_VERIFIED',
        fromStatus: null,
        toStatus: permit.status,
        details: `Uploaded v${nextVersion} (${fileName}). AI Inspection: [${verification.badge}] ${verification.reason}`,
        createdAt: new Date().toISOString()
      });

      storageService.save();

      // 5. Re-run Audit
      const reqs = db.requirements.filter(r => r.permitId === permit.id);
      const docs = db.documents.filter(d => reqs.some(r => r.id === d.requirementId));
      const audit = runPreSubmissionAudit(permit, project, reqs, docs);

      return sendJSON(res, 201, {
        document: newDoc,
        requirement: reqItem,
        verification,
        audit
      });
    }

    // DELETE DOCUMENT (With 403 Forbidden Authorization Guard & Pre-Submission Audit Recalculation)
    if (pathname.match(/^\/api\/v1\/permits\/([^\/]+)\/requirements\/([^\/]+)\/documents(?:\/([^\/]+))?$/) && method === 'DELETE') {
      const parts = pathname.split('/');
      const permitId = parts[4];
      const reqId = parts[6];
      const docId = parts[8] || null;

      const permit = db.permits.find(p => p.id === permitId);
      if (!permit) return sendJSON(res, 404, { error: 'Permit not found' });

      const project = db.projects.find(pr => pr.id === permit.projectId);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });

      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to delete documents for this project.' });
      }

      const reqItem = db.requirements.find(r => r.id === reqId);
      if (!reqItem) return sendJSON(res, 404, { error: 'Requirement item not found' });

      const delResult = storageService.deleteDocument(reqId, docId);
      if (!delResult) {
        return sendJSON(res, 404, { error: 'Document not found' });
      }

      storageService.addTimelineEvent({
        id: `aud-tn-${Date.now()}`,
        permitId,
        changedById: user.id,
        action: 'DOCUMENT_DELETED',
        fromStatus: null,
        toStatus: permit.status,
        details: `Deleted document from requirement "${reqItem.name}". State reset to [${reqItem.verificationBadge}].`,
        createdAt: new Date().toISOString()
      });

      // Recalculate Pre-Submission Audit
      const reqs = db.requirements.filter(r => r.permitId === permit.id);
      const docs = db.documents.filter(d => reqs.some(r => r.id === d.requirementId));
      const audit = runPreSubmissionAudit(permit, project, reqs, docs);

      return sendJSON(res, 200, {
        success: true,
        message: 'Document deleted successfully.',
        requirement: reqItem,
        audit
      });
    }

    // 9. PROFESSIONAL REVIEW SIGN-OFF (Architect / Structural Engineer)
    if (pathname.match(/^\/api\/v1\/permits\/([^\/]+)\/professional-review$/) && method === 'POST') {
      const id = pathname.split('/')[4];
      const rawBody = await parseJSONBody(req);
      const valRes = validateProfessionalReview(rawBody);
      if (!valRes.isValid) {
        return sendJSON(res, 400, { error: valRes.errors.join('; ') });
      }

      const permit = db.permits.find(p => p.id === id);
      if (!permit) return sendJSON(res, 404, { error: 'Permit not found' });

      const project = db.projects.find(pr => pr.id === permit.projectId);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });
      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to endorse this project.' });
      }

      const reviewRecord = recordProfessionalReview(permit, valRes.sanitized);
      storageService.saveProfessionalReview({ permitId: id, ...reviewRecord });

      storageService.addTimelineEvent({
        id: `aud-tn-${Date.now()}`,
        permitId: id,
        changedById: user.id,
        action: 'PROFESSIONAL_REVIEW_CLEARED',
        fromStatus: null,
        toStatus: permit.status,
        details: `Professional review completed by ${reviewRecord.reviewerName} (${reviewRecord.registrationNumber}). Technically cleared for portal submission.`,
        createdAt: new Date().toISOString()
      });

      storageService.save();
      return sendJSON(res, 200, { success: true, professionalReview: reviewRecord });
    }

    // 10. GENERATE SUBMISSION PACKAGE
    if (pathname.match(/^\/api\/v1\/permits\/([^\/]+)\/generate-package$/) && method === 'POST') {
      const id = pathname.split('/')[4];
      const permit = db.permits.find(p => p.id === id);
      if (!permit) return sendJSON(res, 404, { error: 'Permit not found' });

      const project = db.projects.find(pr => pr.id === permit.projectId);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });
      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to generate dossier for this project.' });
      }

      const reqs = db.requirements.filter(r => r.permitId === permit.id);
      const docs = db.documents.filter(d => reqs.some(r => r.id === d.requirementId));

      const manifest = generateSubmissionPackage(permit, project, reqs, docs);

      storageService.addTimelineEvent({
        id: `aud-tn-${Date.now()}`,
        permitId: id,
        changedById: user.id,
        action: 'PACKAGE_GENERATED',
        fromStatus: null,
        toStatus: permit.status,
        details: `Compiled official submittal dossier [Package ID: ${manifest.packageId}] with ${manifest.totalFilesIncluded} indexed documents. Ready for CMDA/DTCP portal upload.`,
        createdAt: new Date().toISOString()
      });

      storageService.save();
      return sendJSON(res, 200, { success: true, manifest });
    }

    // 11. RECORD OFFICIAL GOVERNMENT SUBMISSION
    if (pathname.match(/^\/api\/v1\/permits\/([^\/]+)\/record-government-submission$/) && method === 'POST') {
      const id = pathname.split('/')[4];
      const rawBody = await parseJSONBody(req);
      const valRes = validateGovernmentSubmission(rawBody);
      if (!valRes.isValid) {
        return sendJSON(res, 400, { error: valRes.errors.join('; ') });
      }

      const permit = db.permits.find(p => p.id === id);
      if (!permit) return sendJSON(res, 404, { error: 'Permit not found' });

      const project = db.projects.find(pr => pr.id === permit.projectId);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });
      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to record filings for this project.' });
      }

      const trackingRecord = recordOfficialGovernmentSubmission(permit, valRes.sanitized);
      storageService.saveApplication({ permitId: id, ...trackingRecord });

      storageService.addTimelineEvent({
        id: `aud-tn-${Date.now()}`,
        permitId: id,
        changedById: user.id,
        action: 'FILED_ON_GOVT_PORTAL',
        fromStatus: null,
        toStatus: permit.status,
        details: `Filing recorded on official ${trackingRecord.portalType} portal with Reference #: ${trackingRecord.officialApplicationNumber}.`,
        createdAt: new Date().toISOString()
      });

      storageService.save();
      return sendJSON(res, 200, { success: true, governmentTracking: trackingRecord });
    }

    // 12. UPDATE OFFICIAL GOVERNMENT SCRUTINY MILESTONE
    if (pathname.match(/^\/api\/v1\/permits\/([^\/]+)\/government-milestone$/) && method === 'PATCH') {
      const id = pathname.split('/')[4];
      const body = await parseJSONBody(req);
      const permit = db.permits.find(p => p.id === id);
      if (!permit) return sendJSON(res, 404, { error: 'Permit not found' });

      const project = db.projects.find(pr => pr.id === permit.projectId);
      if (!project) return sendJSON(res, 404, { error: 'Project not found' });
      if (!authService.canAccessProject(user, project)) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to update milestones for this project.' });
      }

      if (!permit.governmentTracking) {
        return sendJSON(res, 400, { error: 'Please first record the official government application reference number before updating scrutiny milestones.' });
      }

      const updated = updateGovernmentMilestone(permit, body);

      storageService.addTimelineEvent({
        id: `aud-tn-${Date.now()}`,
        permitId: id,
        changedById: user.id,
        action: 'GOVT_STATUS_UPDATED',
        fromStatus: null,
        toStatus: body.stage,
        details: `Official portal status: ${body.stage}. ${body.remarks || ''}`,
        createdAt: new Date().toISOString()
      });

      storageService.save();
      return sendJSON(res, 200, { success: true, governmentTracking: updated });
    }

    // -------------------------------------------------------------------------
    // Interactive Single Page Application (HTML/CSS/JS)
    // -------------------------------------------------------------------------
    if (pathname === '/' || pathname.startsWith('/permits') || pathname.startsWith('/projects')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderTamilNaduSPA());
    }

    sendJSON(res, 404, { error: 'Not Found' });

  } catch (err) {
    safeErrorHandler(res, err);
  }
}

const server = http.createServer(requestHandler);

// -----------------------------------------------------------------------------
// Interactive Web UI Generator for Tamil Nadu Permit System
// -----------------------------------------------------------------------------
function renderTamilNaduSPA() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PermitFlow TN | Tamil Nadu Construction Permit Management</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .status-missing { background-color: #FEF2F2; color: #991B1B; border-color: #FECACA; }
    .status-checking { background-color: #EFF6FF; color: #1E40AF; border-color: #BFDBFE; }
    .status-valid { background-color: #ECFDF5; color: #065F46; border-color: #A7F3D0; }
    .status-review { background-color: #FFFBEB; color: #92400E; border-color: #FDE68A; }
    .status-invalid { background-color: #FEF2F2; color: #991B1B; border-color: #FCA5A5; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen flex flex-col">

  <!-- Top Navigation Header -->
  <header class="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3 cursor-pointer" onclick="showDashboard()">
        <div class="h-9 w-9 bg-emerald-600 rounded-lg flex items-center justify-center font-bold text-lg text-white shadow">
          <i class="fa-solid fa-building-columns"></i>
        </div>
        <div>
          <span class="text-xl font-extrabold tracking-tight text-white">PermitFlow <span class="text-emerald-400">TN</span></span>
          <span class="text-xs text-slate-400 ml-2 px-2 py-0.5 bg-slate-800 rounded-full border border-slate-700">TNCDBR 2019 Suite</span>
        </div>
      </div>

      <div class="flex items-center space-x-4">
        <!-- Tamil Nadu Authority Badge -->
        <div class="hidden sm:flex items-center text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-md">
          <i class="fa-solid fa-landmark mr-1.5 text-emerald-400"></i> CMDA &bull; DTCP &bull; GCC
        </div>

        <!-- Role Selector -->
        <div class="flex items-center space-x-2 text-xs text-slate-300 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
          <span class="text-slate-400">Role:</span>
          <select id="roleSelector" onchange="switchRole(this.value)" class="bg-transparent font-semibold text-white focus:outline-none cursor-pointer">
            <option value="PROJECT_MANAGER" class="bg-slate-900">Project Manager / GC</option>
            <option value="ARCHITECT" class="bg-slate-900">Registered Architect (LBS)</option>
            <option value="PLANNING_OFFICER" class="bg-slate-900">CMDA / DTCP Scrutiny Officer</option>
            <option value="VIEWER" class="bg-slate-900">Client / Subcontractor</option>
          </select>
        </div>

        <!-- Notifications Bell -->
        <div class="relative cursor-pointer" onclick="toggleNotifications()">
          <div class="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition">
            <i class="fa-regular fa-bell text-lg"></i>
            <span id="notifBadge" class="absolute top-1 right-1 h-2.5 w-2.5 bg-rose-500 rounded-full"></span>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- Legal Disclaimer Notice -->
  <div class="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2 text-xs">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <i class="fa-solid fa-shield-halved text-amber-600"></i>
        <span><strong>Pre-Submission Audit & Scrutiny Assistant:</strong> Official planning permissions & building permits in Tamil Nadu are sanctioned solely by CMDA, DTCP, or GCC via official government portals.</span>
      </div>
      <span class="hidden md:inline-block font-mono text-[11px] text-amber-700">TNCDBR-2019 / TN Town & Country Planning Act 1971</span>
    </div>
  </div>

  <!-- Notification Drawer -->
  <div id="notifDrawer" class="hidden fixed top-24 right-4 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden">
    <div class="p-4 bg-slate-900 text-white flex justify-between items-center">
      <h4 class="font-bold text-sm flex items-center"><i class="fa-regular fa-bell mr-2 text-emerald-400"></i> Regulatory Alerts</h4>
      <button onclick="toggleNotifications()" class="text-slate-400 hover:text-white text-xs"><i class="fa-solid fa-xmark text-sm"></i></button>
    </div>
    <div id="notifList" class="max-h-80 overflow-y-auto divide-y divide-slate-100 p-2"></div>
  </div>

  <!-- Main Workspace -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div id="appRoot">
      <div class="text-center py-20 text-slate-400">
        <i class="fa-solid fa-circle-notch fa-spin text-4xl text-emerald-600 mb-4"></i>
        <p>Loading Tamil Nadu project workspace...</p>
      </div>
    </div>
  </main>

  <!-- Modal: Create Tamil Nadu Construction Project -->
  <div id="createProjectModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <div>
          <h3 class="text-lg font-bold text-slate-900">New Construction Project (Tamil Nadu)</h3>
          <p class="text-xs text-slate-500">Auto-generates TNCDBR-2019 document checklist based on size, location & authority</p>
        </div>
        <button onclick="toggleCreateProjectModal(false)" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <form id="projectForm" onsubmit="handleCreateProject(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Project Name *</label>
          <input type="text" id="pName" required placeholder="e.g., Sholinganallur IT Park - Phase II" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none">
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Site Address & Survey Number *</label>
          <input type="text" id="pAddress" required placeholder="Plot 18, S.No. 142/2B, OMR, Sholinganallur" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none">
        </div>

        <!-- Geographic Location & Authority Selection -->
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
          <div class="text-xs font-bold text-slate-800 flex items-center">
            <i class="fa-solid fa-map-location-dot text-emerald-600 mr-1.5"></i> Location & Planning Authority (TNCDBR)
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 uppercase mb-1">District *</label>
              <select id="pDistrict" onchange="onDistrictChange()" class="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white">
                <option value="Chennai" selected>Chennai (CMA)</option>
                <option value="Chengalpattu">Chengalpattu</option>
                <option value="Kanchipuram">Kanchipuram</option>
                <option value="Thiruvallur">Thiruvallur</option>
                <option value="Coimbatore">Coimbatore</option>
                <option value="Madurai">Madurai</option>
                <option value="Tiruchirappalli">Tiruchirappalli</option>
                <option value="Salem">Salem</option>
                <option value="Other / Rest of TN">Other / Rest of TN</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Taluk / Local Body *</label>
              <input type="text" id="pTaluk" required value="Sholinganallur" placeholder="e.g., Sholinganallur / Mylapore" class="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white">
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Primary Authority *</label>
              <select id="pAuthority" class="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white">
                <option value="CMDA" selected>CMDA (Chennai Metro Area)</option>
                <option value="DTCP">DTCP (Rest of Tamil Nadu)</option>
                <option value="GCC">GCC (Delegated Local Body)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Technical Size Parameters & Triggers -->
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
          <div class="text-xs font-bold text-slate-800 flex items-center">
            <i class="fa-solid fa-ruler-combined text-emerald-600 mr-1.5"></i> Building Dimensions & Threshold Triggers (TNCDBR-2019)
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Plot Area (sq.m) *</label>
              <input type="number" id="pPlotArea" required value="2400" placeholder="e.g., 2400" class="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white">
              <span class="text-[10px] text-slate-400">&ge; 3,000 sq.m triggers OSR</span>
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Built-Up Area (sq.m) *</label>
              <input type="number" id="pBuiltUpArea" required value="4800" placeholder="e.g., 4800" class="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white">
              <span class="text-[10px] text-slate-400">&ge; 500 sq.m triggers Fire</span>
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Height (Meters) *</label>
              <input type="number" step="0.1" id="pHeight" required value="17.5" placeholder="e.g., 17.5" class="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white">
              <span class="text-[10px] text-slate-400">&gt; 18.3m is High-Rise (HRB)</span>
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Road Width (m) *</label>
              <input type="number" step="0.1" id="pRoadWidth" required value="18.0" placeholder="e.g., 18.0" class="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white">
              <span class="text-[10px] text-slate-400">Rule 35 minimums</span>
            </div>
          </div>

          <!-- Environmental & Location Proximity Checkboxes -->
          <div class="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <label class="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" id="pWaterBody" class="rounded text-emerald-600 focus:ring-emerald-500">
              <span class="text-slate-700">Near Water Body / Channel (PWD NOC)</span>
            </label>
            <label class="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" id="pAirport" class="rounded text-emerald-600 focus:ring-emerald-500">
              <span class="text-slate-700">Near Airport / OLS Funnel (AAI NOC)</span>
            </label>
            <label class="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" id="pHighway" class="rounded text-emerald-600 focus:ring-emerald-500">
              <span class="text-slate-700">Abutting National / State Highway</span>
            </label>
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Permit Approval Type *</label>
          <select id="pPermitType" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none">
            <option value="Commercial Building Plan Approval" selected>Commercial Building Plan Approval</option>
            <option value="Residential Building Plan Approval">Residential Building Plan Approval</option>
            <option value="Industrial Building Plan Approval">Industrial Building Plan Approval</option>
            <option value="Educational / Institutional Building Plan Approval">Educational / Institutional Building Plan Approval</option>
            <option value="Government Building Plan Approval">Government Building Plan Approval</option>
            <option value="Layout Approval">Layout Approval (Subdivision / Plots)</option>
            <option value="Revised Building Plan Approval">Revised Building Plan Approval</option>
            <option value="Building Addition / Alteration">Building Addition / Alteration</option>
            <option value="Building Demolition">Building Demolition</option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Applicant / Owner Name *</label>
            <input type="text" id="pOwner" required placeholder="e.g., Apex Tech Infrastructure Pvt Ltd" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Survey / T.S. Number *</label>
            <input type="text" id="pSurvey" required placeholder="e.g., S.No. 142/2B" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none">
          </div>
        </div>

        <div class="pt-2 flex justify-end space-x-3">
          <button type="button" onclick="toggleCreateProjectModal(false)" class="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow">Generate TNCDBR Checklist</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal: Professional Technical Review Sign-Off -->
  <div id="profReviewModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-lg font-bold text-slate-900 flex items-center">
          <i class="fa-solid fa-user-check text-emerald-600 mr-2"></i> Professional Review & Technical Clearance
        </h3>
        <button onclick="toggleProfReviewModal(false)" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <p class="text-xs text-slate-500 mb-4">Registered Architect or Licensed Building Surveyor technical endorsement certifying conformance with TNCDBR 2019 rules prior to package generation.</p>
      
      <div id="reviewBlockerWarning" class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 mb-3 hidden">
        <span class="font-bold flex items-center mb-1"><i class="fa-solid fa-triangle-exclamation mr-1.5 text-amber-600"></i> Audit Blocker Notice:</span>
        <span id="reviewBlockerText"></span>
      </div>

      <form id="profReviewForm" onsubmit="handleProfessionalReview(event)" class="space-y-3.5">
        <input type="hidden" id="reviewPermitId">
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Reviewing Architect / Surveyor Name *</label>
          <input type="text" id="rReviewerName" required value="Ar. K. Swaminathan, B.Arch, AIIA" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none">
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">COA / CMDA / DTCP Registration Number *</label>
          <input type="text" id="rRegNo" required value="COA: CA/2012/58120 &bull; CMDA: RA/GR-I/19/03/044" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono">
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Technical Sign-Off Declaration</label>
          <textarea id="rDeclaration" rows="3" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 focus:outline-none">I hereby certify that the architectural plans, setbacks, FSI calculations, and land records have been scrutinized and strictly conform to the Tamil Nadu Combined Development and Building Rules, 2019 (TNCDBR-2019). The file is technically cleared for official government portal submission.</textarea>
        </div>
        <div class="pt-2 flex justify-end space-x-3">
          <button type="button" onclick="toggleProfReviewModal(false)" class="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow">Certify & Clear Dossier</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal: Record Official Government Filing -->
  <div id="govtFilingModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-lg font-bold text-slate-900 flex items-center">
          <i class="fa-solid fa-file-invoice text-blue-600 mr-2"></i> Record Official Government Filing
        </h3>
        <button onclick="toggleGovtFilingModal(false)" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <p class="text-xs text-slate-500 mb-4">Enter the actual Reference Number and Filing Date received from the CMDA / DTCP portal to begin official tracking.</p>

      <form id="govtFilingForm" onsubmit="handleGovtFiling(event)" class="space-y-3.5">
        <input type="hidden" id="filingPermitId">
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Official Application Reference Number *</label>
          <input type="text" id="gAppNo" required placeholder="e.g., CMDA/PP/NHRB/S/0142/2026" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Portal Type *</label>
            <select id="gPortalType" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="CMDA" selected>CMDA Single Window</option>
              <option value="DTCP">DTCP Single Window</option>
              <option value="GCC">GCC Building Portal</option>
              <option value="TNSWP">TN Single Window</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Filing Date *</label>
            <input type="date" id="gFilingDate" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none">
          </div>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Submission Notes</label>
          <textarea id="gNotes" rows="2" placeholder="e.g., Application uploaded online; scrutiny fee of Rs. 15,000 paid via netbanking." class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"></textarea>
        </div>
        <div class="pt-2 flex justify-end space-x-3">
          <button type="button" onclick="toggleGovtFilingModal(false)" class="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow">Start Scrutiny Tracking</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal: Update Government Scrutiny Milestone -->
  <div id="govtMilestoneModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-lg font-bold text-slate-900 flex items-center">
          <i class="fa-solid fa-timeline text-blue-600 mr-2"></i> Update Government Scrutiny Milestone
        </h3>
        <button onclick="toggleGovtMilestoneModal(false)" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <p class="text-xs text-slate-500 mb-4">Record official status update issued by CMDA / DTCP planning authorities under the statutory scrutiny workflow.</p>

      <form id="govtMilestoneForm" onsubmit="handleGovtMilestoneSubmit(event)" class="space-y-3.5">
        <input type="hidden" id="milestonePermitId">
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Scrutiny Stage / Milestone *</label>
          <select id="mStage" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none">
            <option value="SCRUTINY_IN_PROGRESS">Technical Scrutiny in Progress (Assistant Planner)</option>
            <option value="SITE_INSPECTION_SCHEDULED">Joint Field Site Inspection Scheduled / Completed</option>
            <option value="DEFICIENCY_QUERY_RAISED">Deficiency / Scrutiny Query Raised (Notice Issued)</option>
            <option value="DEMAND_NOTICE_ISSUED">Demand Notice Issued (I&A / Development Charges)</option>
            <option value="PLANNING_PERMIT_SANCTIONED">Planning Permission Sanctioned & Sanction Order Issued</option>
            <option value="APPLICATION_REFUSED">Planning Permission Refused (Sec 49 Order)</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Official Progress Remarks / Notes *</label>
          <textarea id="mRemarks" required rows="3" placeholder="e.g., Assistant Planner and Area Surveyor completed site inspection. Road width verified as 18.0m. Demand advice issued." class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Demand Notice Amount (₹, if applicable)</label>
            <input type="number" id="mDemandAmount" placeholder="e.g., 450000" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-700 uppercase mb-1">Query Clarification Text (if any)</label>
            <input type="text" id="mQueryText" placeholder="e.g., Submit revised RWH section" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none">
          </div>
        </div>
        <div class="pt-2 flex justify-end space-x-3">
          <button type="button" onclick="toggleGovtMilestoneModal(false)" class="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow">Record Milestone Update</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal: Submittal Package Dossier Viewer -->
  <div id="packageDossierModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-lg font-bold text-slate-900 flex items-center">
          <i class="fa-solid fa-box-archive text-indigo-600 mr-2"></i> Submittal Package Dossier Manifest
        </h3>
        <button onclick="togglePackageDossierModal(false)" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="packageDossierContent" class="text-xs text-slate-600"></div>
    </div>
  </div>

  <script>
    let state = {
      projects: [],
      currentPermit: null,
      metrics: null,
      notifications: [],
      activeView: 'dashboard'
    };

    async function init() {
      await loadMetrics();
      await loadNotifications();
      await loadProjects();
      renderApp();
    }

    async function loadMetrics() {
      const res = await fetch('/api/v1/dashboard/metrics');
      state.metrics = await res.json();
    }

    async function loadNotifications() {
      const res = await fetch('/api/v1/notifications');
      state.notifications = await res.json();
      updateNotifBadge();
    }

    async function loadProjects() {
      const res = await fetch('/api/v1/projects');
      state.projects = await res.json();
    }

    function updateNotifBadge() {
      const unread = state.notifications.filter(n => !n.isRead).length;
      const badge = document.getElementById('notifBadge');
      if (unread > 0) badge.classList.remove('hidden');
      else badge.classList.add('hidden');
    }

    function toggleNotifications() {
      const drawer = document.getElementById('notifDrawer');
      drawer.classList.toggle('hidden');
      if (!drawer.classList.contains('hidden')) {
        const list = document.getElementById('notifList');
        if (state.notifications.length === 0) {
          list.innerHTML = '<div class="p-4 text-center text-xs text-slate-400">No active alerts</div>';
          return;
        }
        list.innerHTML = state.notifications.map(n => \`
          <div class="p-3 hover:bg-slate-50 transition cursor-pointer \${n.isRead ? 'opacity-70' : 'bg-emerald-50/40'}" onclick="markNotificationRead('\${n.id}')">
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-bold text-emerald-800">\${n.title}</span>
              <span class="text-slate-400 text-[10px]">\${new Date(n.createdAt).toLocaleDateString()}</span>
            </div>
            <p class="text-xs text-slate-600 leading-relaxed">\${n.message}</p>
          </div>
        \`).join('');
      }
    }

    async function markNotificationRead(id) {
      await fetch(\`/api/v1/notifications/\${id}/read\`, { method: 'PATCH' });
      await loadNotifications();
      toggleNotifications();
    }

    async function switchRole(role) {
      await fetch('/api/v1/auth/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      alert('Role switched to: ' + role);
      if (state.activeView === 'permitDetail' && state.currentPermit) {
        openPermit(state.currentPermit.id);
      } else {
        init();
      }
    }

    function showDashboard() {
      state.activeView = 'dashboard';
      state.currentPermit = null;
      renderApp();
    }

    async function openPermit(permitId) {
      const res = await fetch(\`/api/v1/permits/\${permitId}\`);
      if (!res.ok) return alert('Failed to fetch permit');
      state.currentPermit = await res.json();
      state.activeView = 'permitDetail';
      renderApp();
    }

    function onDistrictChange() {
      const district = document.getElementById('pDistrict').value;
      const authoritySelect = document.getElementById('pAuthority');
      const talukInput = document.getElementById('pTaluk');

      if (['Chennai', 'Chengalpattu', 'Kanchipuram', 'Thiruvallur'].includes(district)) {
        authoritySelect.value = 'CMDA';
      } else {
        authoritySelect.value = 'DTCP';
      }

      if (district === 'Chennai') talukInput.value = 'Mylapore';
      else if (district === 'Coimbatore') talukInput.value = 'Coimbatore South';
      else if (district === 'Madurai') talukInput.value = 'Madurai North';
      else talukInput.value = district + ' Taluk';
    }

    function renderApp() {
      const root = document.getElementById('appRoot');
      if (state.activeView === 'dashboard') {
        root.innerHTML = renderDashboardHTML();
      } else {
        root.innerHTML = renderPermitDetailHTML();
      }
    }

    // -------------------------------------------------------------------------
    // HTML Builders
    // -------------------------------------------------------------------------
    function renderDashboardHTML() {
      const m = state.metrics || { totalProjects: 0, totalActivePermits: 0, actionRequiredCount: 0, underGovtReviewCount: 0, readyForReviewCount: 0 };

      return \`
        <!-- Metrics Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center justify-between">
            <div>
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active TN Projects</p>
              <h3 class="text-2xl font-black text-slate-900 mt-1">\${m.totalProjects}</h3>
              <p class="text-xs text-slate-500 mt-1">\${m.totalActivePermits} submittals in progress</p>
            </div>
            <div class="h-12 w-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center text-xl">
              <i class="fa-solid fa-map-location-dot"></i>
            </div>
          </div>

          <div class="bg-white p-5 rounded-2xl shadow-sm border border-amber-200 bg-gradient-to-br from-white to-amber-50/40 flex items-center justify-between">
            <div>
              <p class="text-xs font-semibold text-amber-700 uppercase tracking-wider">Audit Blockers</p>
              <h3 class="text-2xl font-black text-amber-900 mt-1">\${m.actionRequiredCount}</h3>
              <p class="text-xs text-amber-700 mt-1">Discrepancy / Missing docs</p>
            </div>
            <div class="h-12 w-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center text-xl">
              <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
          </div>

          <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center justify-between">
            <div>
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ready for Review</p>
              <h3 class="text-2xl font-black text-indigo-900 mt-1">\${m.readyForReviewCount}</h3>
              <p class="text-xs text-indigo-700 mt-1">Pending Architect sign-off</p>
            </div>
            <div class="h-12 w-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center text-xl">
              <i class="fa-solid fa-user-check"></i>
            </div>
          </div>

          <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center justify-between">
            <div>
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">In Govt Scrutiny</p>
              <h3 class="text-2xl font-black text-blue-900 mt-1">\${m.underGovtReviewCount}</h3>
              <p class="text-xs text-blue-700 mt-1">CMDA / DTCP portal tracking</p>
            </div>
            <div class="h-12 w-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center text-xl">
              <i class="fa-solid fa-building-columns"></i>
            </div>
          </div>
        </div>

        <!-- Projects Table -->
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
          <div class="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <h2 class="text-lg font-bold text-slate-900">Tamil Nadu Construction Submittals</h2>
              <p class="text-xs text-slate-500 mt-0.5">Pre-scrutiny compliance & planning permission packages under TNCDBR-2019.</p>
            </div>
            <div class="flex items-center space-x-3">
              <button onclick="toggleCreateProjectModal(true)" class="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow transition">
                <i class="fa-solid fa-plus mr-1.5"></i> New Project
              </button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs text-slate-600">
              <thead class="bg-slate-50 text-slate-500 uppercase font-semibold text-[11px] border-b border-slate-100">
                <tr>
                  <th class="py-3.5 px-5">Project, Survey No & Location</th>
                  <th class="py-3.5 px-5">Planning Authority</th>
                  <th class="py-3.5 px-5">Pre-Submission Readiness</th>
                  <th class="py-3.5 px-5">Status & Workflow Stage</th>
                  <th class="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                \${state.projects.map(proj => \`
                  <tr class="hover:bg-slate-50/80 transition">
                    <td class="py-4 px-5">
                      <div class="font-bold text-slate-900 text-sm">\${proj.name}</div>
                      <div class="text-slate-500 text-xs flex items-center mt-0.5">
                        <i class="fa-solid fa-location-dot text-slate-400 mr-1.5"></i>
                        \${proj.address}, \${proj.district || proj.city}
                      </div>
                      <div class="text-[11px] font-mono text-emerald-700 mt-0.5 font-medium">
                        \${proj.parcelNumber} &bull; \${proj.plotArea} sq.m (\${proj.height}m Ht)
                      </div>
                    </td>
                    <td class="py-4 px-5">
                      <div class="font-semibold text-slate-800 flex items-center">
                        <i class="fa-solid fa-landmark text-emerald-600 mr-1.5"></i>
                        \${proj.authority || 'CMDA'}
                      </div>
                      <div class="text-slate-400 text-[11px] mt-0.5">Taluk: \${proj.taluk || 'Chennai'}</div>
                    </td>
                    <td class="py-4 px-5">
                      \${proj.permits.map(pmt => {
                        const score = pmt.audit?.readinessScore || 0;
                        const scoreColor = score >= 90 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-rose-600';
                        return \`
                          <div class="space-y-1">
                            <div class="flex items-center space-x-2">
                              <span class="text-sm font-black \${scoreColor}">\${score}%</span>
                              <span class="text-[11px] text-slate-500">Readiness Score</span>
                            </div>
                            <div class="w-28 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div class="bg-emerald-500 h-1.5 rounded-full" style="width: \${score}%"></div>
                            </div>
                            \${pmt.audit?.blockers.length > 0 ? \`
                              <span class="text-rose-600 text-[10px] font-semibold block">
                                <i class="fa-solid fa-circle-exclamation mr-1"></i>\${pmt.audit.blockers.length} Blockers detected
                              </span>
                            \` : \`
                              <span class="text-emerald-600 text-[10px] font-semibold block">
                                <i class="fa-solid fa-circle-check mr-1"></i>Checklist clear
                              </span>
                            \`}
                          </div>
                        \`;
                      }).join('')}
                    </td>
                    <td class="py-4 px-5">
                      \${proj.permits.map(pmt => \`
                        <div class="space-y-1">
                          <span class="font-semibold text-slate-700 text-xs block">\${pmt.permitType}</span>
                          \${pmt.governmentTracking ? \`
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 block w-fit">
                              <i class="fa-solid fa-satellite-dish mr-1"></i>Filed: \${pmt.governmentTracking.officialApplicationNumber}
                            </span>
                          \` : pmt.professionalReview ? \`
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 block w-fit">
                              <i class="fa-solid fa-user-check mr-1"></i>Professionally Cleared
                            </span>
                          \` : \`
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 block w-fit">
                              <i class="fa-solid fa-magnifying-glass mr-1"></i>Pre-Submission Audit
                            </span>
                          \`}
                        </div>
                      \`).join('')}
                    </td>
                    <td class="py-4 px-5 text-right">
                      <div class="flex items-center justify-end space-x-2">
                        \${proj.permits.length > 0 ? \`
                          <button onclick="openPermit('\${proj.permits[0].id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 rounded-lg text-xs font-semibold border border-slate-200 transition">
                            Open Audit &rarr;
                          </button>
                        \` : ''}
                        <button onclick="handleDeleteProject('\${proj.id}', event)" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 rounded-lg text-xs font-semibold border border-rose-200 transition" title="Delete Project">
                          <i class="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;
    }

    function renderPermitDetailHTML() {
      const p = state.currentPermit;
      if (!p) return '<div>No permit selected</div>';

      const audit = p.audit || { readinessScore: 0, blockers: [], warnings: [], passedChecks: [] };
      const score = audit.readinessScore || 0;
      const scoreColor = score >= 90 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-rose-600';

      return \`
        <!-- Breadcrumb & Header -->
        <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center text-xs text-slate-500 mb-1">
              <span class="cursor-pointer hover:text-emerald-600" onclick="showDashboard()"><i class="fa-solid fa-arrow-left mr-1"></i> All Projects</span>
              <span class="mx-2">/</span>
              <span>\${p.project?.district || 'Tamil Nadu'}</span>
              <span class="mx-2">/</span>
              <span class="text-slate-900 font-semibold">\${p.permitType}</span>
            </div>
            <h1 class="text-2xl font-black text-slate-900">\${p.project?.name}</h1>
            <div class="text-xs text-slate-600 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><i class="fa-solid fa-location-dot text-slate-400 mr-1"></i> \${p.project?.address}, \${p.project?.taluk} Taluk</span>
              <span>&bull;</span>
              <span><strong>Survey Number:</strong> <span class="font-mono font-bold text-emerald-800">\${p.project?.parcelNumber}</span></span>
              <span>&bull;</span>
              <span><strong>Authority:</strong> <span class="font-bold text-slate-800">\${p.authority?.name}</span></span>
            </div>
          </div>

          <div class="flex items-center space-x-3">
            \${!p.professionalReview ? \`
              <button onclick="openProfReviewModal('\${p.id}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow transition flex items-center">
                <i class="fa-solid fa-user-check mr-1.5"></i> Architect / LBS Sign-Off
              </button>
            \` : \`
              <button onclick="handleGeneratePackage('\${p.id}')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow transition flex items-center">
                <i class="fa-solid fa-box-archive mr-1.5"></i> Generate Submittal Package
              </button>
            \`}
            <button onclick="handleDeleteProject('\${p.projectId || p.project?.id}', event)" class="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-semibold shadow transition flex items-center" title="Delete this project and all submittals">
              <i class="fa-solid fa-trash-can mr-1.5"></i> Delete Project
            </button>
          </div>
        </div>

        <!-- Pre-Submission Audit Score & TNCDBR Compliance Banner -->
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 mb-6">
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div class="flex items-center space-x-5">
              <div class="h-20 w-20 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center p-2 text-center">
                <span class="text-2xl font-black \${scoreColor}">\${score}%</span>
                <span class="text-[10px] uppercase font-bold text-slate-400">Readiness</span>
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-900 flex items-center">
                  Pre-Submission Audit Analysis (TNCDBR-2019)
                  \${audit.blockers.length === 0 ? \`
                    <span class="ml-2.5 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[11px] font-bold">
                      <i class="fa-solid fa-check mr-1"></i> Audit Passed
                    </span>
                  \` : \`
                    <span class="ml-2.5 px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[11px] font-bold">
                      <i class="fa-solid fa-triangle-exclamation mr-1"></i> \${audit.blockers.length} Blockers
                    </span>
                  \`}
                </h3>
                <p class="text-xs text-slate-500 mt-1">
                  Abutting Road: <strong class="text-slate-800">\${p.project?.roadWidth}m</strong> (Statutory Min: \${p.minRoadWidthRequired}m) &bull;
                  Height: <strong class="text-slate-800">\${p.project?.height}m</strong> (\${p.buildingClass || 'NHRB'}) &bull;
                  Plot Area: <strong class="text-slate-800">\${p.project?.plotArea} sq.m</strong>
                </p>
              </div>
            </div>

            <!-- Pre-Submission Step Navigator -->
            <div class="flex items-center space-x-2 text-xs">
              <div class="px-3 py-1.5 rounded-lg font-semibold \${score >= 90 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">
                1. Docs Verified
              </div>
              <i class="fa-solid fa-arrow-right text-slate-300 text-xs"></i>
              <div class="px-3 py-1.5 rounded-lg font-semibold \${p.professionalReview ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">
                2. Professional Sign-Off
              </div>
              <i class="fa-solid fa-arrow-right text-slate-300 text-xs"></i>
              <div class="px-3 py-1.5 rounded-lg font-semibold \${p.submissionPackage ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">
                3. Package Dossier
              </div>
              <i class="fa-solid fa-arrow-right text-slate-300 text-xs"></i>
              <div class="px-3 py-1.5 rounded-lg font-semibold \${p.governmentTracking ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'}">
                4. Govt Portal Filing
              </div>
            </div>
          </div>

          <!-- Cross-Check Discrepancy Alert Box -->
          \${audit.blockers.length > 0 ? \`
            <div class="mt-5 p-4 bg-rose-50 border border-rose-200 rounded-xl">
              <h4 class="text-xs font-bold text-rose-900 uppercase tracking-wider mb-2 flex items-center">
                <i class="fa-solid fa-hand text-rose-600 mr-2 text-sm"></i> Critical Scrutiny Blockers (CMDA/DTCP will reject if unaddressed)
              </h4>
              <div class="space-y-2">
                \${audit.blockers.map(b => \`
                  <div class="text-xs text-rose-800 bg-white/80 p-2.5 rounded-lg border border-rose-200">
                    <span class="font-bold text-rose-900">\${b.title}</span>: \${b.detail}
                  </div>
                \`).join('')}
              </div>
            </div>
          \` : ''}

          \${audit.passedChecks.length > 0 ? \`
            <div class="mt-4 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600">
              \${audit.passedChecks.slice(0, 3).map(chk => \`
                <div class="flex items-center text-emerald-800">
                  <i class="fa-solid fa-circle-check text-emerald-600 mr-1.5 text-xs"></i>
                  <span>\${chk.title}</span>
                </div>
              \`).join('')}
            </div>
          \` : ''}
        </div>

        <!-- Submission Center (Professional Review, Package & Government Filing) -->
        <div class="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 rounded-2xl mb-8 shadow-lg">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-700">
            <div>
              <span class="text-xs font-bold text-emerald-400 uppercase tracking-wider">Submission Center</span>
              <h3 class="text-lg font-bold text-white mt-0.5">Government Filing & Portal Tracking</h3>
              <p class="text-xs text-slate-400">Generate the verified package, launch official TN portals, and track scrutiny reference numbers.</p>
            </div>
            <div class="flex items-center space-x-2">
              <a href="\${p.authority?.portalUrl || 'https://onlinecmdachennai.com'}" target="_blank" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow flex items-center">
                <i class="fa-solid fa-arrow-up-right-from-square mr-1.5"></i> Launch \${p.authority?.id || 'CMDA'} Portal
              </a>
              <button onclick="openGovtFilingModal('\${p.id}')" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow flex items-center">
                <i class="fa-solid fa-file-signature mr-1.5"></i> Enter Portal Ref #
              </button>
            </div>
          </div>

          <!-- Active Submission Tracking State -->
          <div class="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div class="bg-white/5 p-3 rounded-xl border border-white/10">
              <span class="text-slate-400 text-[11px] block">1. Technical Clearance</span>
              \${p.professionalReview ? \`
                <span class="text-emerald-400 font-bold mt-1 block flex items-center">
                  <i class="fa-solid fa-check mr-1.5"></i> \${p.professionalReview.reviewerName}
                </span>
                <span class="text-[10px] text-slate-400 block mt-0.5">\${p.professionalReview.registrationNumber}</span>
              \` : \`
                <span class="text-amber-400 font-medium mt-1 block">Awaiting Architect Sign-Off</span>
              \`}
            </div>

            <div class="bg-white/5 p-3 rounded-xl border border-white/10">
              <span class="text-slate-400 text-[11px] block">2. Submittal Package</span>
              \${p.submissionPackage ? \`
                <span class="text-indigo-400 font-bold mt-1 block flex items-center">
                  <i class="fa-solid fa-box-archive mr-1.5"></i> \${p.submissionPackage.packageId}
                </span>
                <span class="text-[10px] text-slate-400 block mt-0.5">\${p.submissionPackage.totalFilesIncluded} indexed documents compiled</span>
              \` : \`
                <span class="text-slate-400 font-medium mt-1 block">Package not generated</span>
              \`}
            </div>

            <div class="bg-white/5 p-3 rounded-xl border border-white/10">
              <span class="text-slate-400 text-[11px] block">3. Official Govt Application</span>
              \${p.governmentTracking ? \`
                <span class="text-blue-400 font-mono font-bold mt-1 block text-sm">
                  \${p.governmentTracking.officialApplicationNumber}
                </span>
                <span class="text-[10px] text-emerald-400 block mt-0.5">Filed: \${p.governmentTracking.portalFilingDate} (\${p.governmentTracking.portalType})</span>
              \` : \`
                <span class="text-slate-400 font-medium mt-1 block">Not yet filed on portal</span>
              \`}
            </div>
          </div>

          <!-- Active Scrutiny Milestone & History Timeline -->
          \${p.governmentTracking ? \`
            <div class="mt-5 pt-4 border-t border-slate-700">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="px-3 py-1 rounded-full text-xs font-bold \${getGovtStageBadgeClass(p.governmentTracking.currentStage)}">
                    <i class="fa-solid fa-satellite-dish mr-1.5"></i> \${getGovtStageLabel(p.governmentTracking.currentStage)}
                  </span>
                  \${p.governmentTracking.demandNoticeAmount ? \`
                    <span class="px-2.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full text-xs font-mono font-bold">
                      Demand Notice: ₹\${p.governmentTracking.demandNoticeAmount.toLocaleString()}
                    </span>
                  \` : ''}
                </div>
                <div class="flex items-center space-x-2">
                  \${p.submissionPackage ? \`
                    <button onclick="viewPackageDossier('\${p.id}')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-xs font-medium transition">
                      <i class="fa-solid fa-folder-open mr-1"></i> Dossier Manifest
                    </button>
                  \` : ''}
                  <button onclick="openGovtMilestoneModal('\${p.id}')" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition shadow flex items-center">
                    <i class="fa-solid fa-pen-to-square mr-1.5"></i> Update Scrutiny Milestone
                  </button>
                </div>
              </div>

              <!-- Milestone History Timeline -->
              <div class="bg-black/20 rounded-xl p-3.5 space-y-2.5 max-h-48 overflow-y-auto">
                <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Official Scrutiny Progression Timeline</span>
                \${(p.governmentTracking.statusHistory || []).map(h => \`
                  <div class="flex items-start space-x-3 text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                    <div class="h-2 w-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></div>
                    <div class="flex-1">
                      <div class="flex items-center justify-between text-[11px]">
                        <span class="font-bold text-slate-200">\${getGovtStageLabel(h.stage)}</span>
                        <span class="text-slate-400 text-[10px]">\${new Date(h.timestamp).toLocaleString()}</span>
                      </div>
                      <p class="text-slate-300 text-xs mt-0.5">\${h.remarks || ''}</p>
                    </div>
                  </div>
                \`).join('')}
              </div>
            </div>
          \` : p.submissionPackage ? \`
            <div class="mt-4 pt-3 border-t border-slate-700 flex items-center justify-between text-xs">
              <span class="text-slate-300">Dossier compiled. Ready for portal upload.</span>
              <button onclick="viewPackageDossier('\${p.id}')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-xs font-medium transition">
                <i class="fa-solid fa-folder-open mr-1"></i> View Dossier Manifest
              </button>
            </div>
          \` : ''}
        </div>

        <!-- 2 Columns: Document Checklist & Diagnostics -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2 space-y-6">
            <div class="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
              <div class="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <div>
                  <h3 class="text-base font-bold text-slate-900">Tamil Nadu Statutory Document Checklist</h3>
                  <p class="text-xs text-slate-500 mt-0.5">Automated type, seal & cross-document consistency verification.</p>
                </div>
                <div class="flex items-center space-x-2">
                  <div class="text-xs font-semibold px-3 py-1 bg-slate-100 text-slate-700 rounded-lg">
                    \${p.requirements.filter(r => r.verificationStatus === 'Appears Valid').length} of \${p.requirements.length} Validated
                  </div>
                  <button onclick="fastTrackValidDossier('\${p.id}')" class="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold transition flex items-center">
                    <i class="fa-solid fa-wand-magic-sparkles mr-1.5 text-emerald-600"></i> Fast-Track All Valid
                  </button>
                </div>
              </div>

              <div class="divide-y divide-slate-100">
                \${p.requirements.map(req => \`
                  <div class="p-5 hover:bg-slate-50/60 transition">
                    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-2">
                      <div>
                        <div class="flex items-center space-x-2">
                          <span class="font-bold text-slate-900 text-sm">\${req.name}</span>
                          \${req.isMandatory ? \`
                            <span class="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded text-[10px] font-bold">Mandatory</span>
                          \` : \`
                            <span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">Conditional</span>
                          \`}
                        </div>
                        <p class="text-xs text-slate-500 mt-0.5">\${req.description}</p>
                      </div>
                      
                      <!-- AI Status Badge -->
                      <div>
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold border flex items-center \${getAIStatusClass(req.verificationStatus)}">
                          \${getAIStatusIcon(req.verificationStatus)} \${req.verificationStatus || 'Missing'}
                        </span>
                      </div>
                    </div>

                    <!-- Code Citation -->
                    <div class="mb-3 text-[11px] font-mono text-slate-500 flex items-center">
                      <i class="fa-solid fa-book-bookmark text-emerald-600 mr-1.5"></i>
                      <span>Citation: \${req.regulatoryCitation}</span>
                    </div>

                    <!-- Document Version Card or Upload Dropzone -->
                    \${req.currentDocument ? \`
                      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                          <div class="h-10 w-10 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center text-lg font-bold">
                            <i class="fa-solid fa-file-pdf"></i>
                          </div>
                          <div>
                            <p class="text-xs font-bold text-slate-800">\${req.currentDocument.originalName}</p>
                            <p class="text-[11px] text-slate-400 mt-0.5">
                              Version \${req.currentDocument.version} &bull; \${(req.currentDocument.fileSizeBytes / (1024*1024)).toFixed(2)} MB &bull; Uploaded \${new Date(req.currentDocument.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div class="flex flex-wrap items-center justify-end gap-2">
                          <div class="flex items-center space-x-1 text-[10px]">
                            <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'valid')" class="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded border border-emerald-200 font-medium">Re-upload Valid</button>
                            <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'invalid_invoice')" class="px-2 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded border border-rose-200 font-medium">Test Invalid</button>
                            <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'draft')" class="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded border border-amber-200 font-medium">Test Draft</button>
                            \${req.idKey === 'REGISTERED_TITLE_DEED' ? \`
                              <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'mismatch_owner')" class="px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded border border-purple-200 font-medium">Test Name Conflict</button>
                            \` : ''}
                          </div>
                          <label class="cursor-pointer px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition">
                            <i class="fa-solid fa-arrow-up-from-bracket mr-1 text-slate-400"></i> Upload v\${req.currentDocument.version + 1}
                            <input type="file" class="hidden" onchange="handleFileUpload('\${p.id}', '\${req.id}', this.files[0])">
                          </label>
                          <button onclick="handleDeleteDocument('\${p.id}', '\${req.id}', '\${req.currentDocument.id}')" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-semibold border border-rose-200 transition flex items-center" title="Delete uploaded document">
                            <i class="fa-solid fa-trash-can mr-1 text-rose-500"></i> Delete Doc
                          </button>
                        </div>
                      </div>
                    \` : \`
                      <div class="border-2 border-dashed border-slate-200 hover:border-emerald-400 rounded-xl p-4 text-center bg-slate-50/50 hover:bg-emerald-50/30 transition">
                        <i class="fa-solid fa-cloud-arrow-up text-slate-400 text-xl mb-1"></i>
                        <p class="text-xs font-semibold text-slate-700">Upload official required document</p>
                        <p class="text-[10px] text-slate-400 mb-2.5">PDF or PreDCR DWG &bull; System will verify seal, survey no & owner</p>
                        <div class="flex flex-wrap items-center justify-center gap-2">
                          <label class="cursor-pointer inline-flex items-center px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow transition">
                            <i class="fa-solid fa-folder-open mr-1.5"></i> Browse Document
                            <input type="file" class="hidden" onchange="handleFileUpload('\${p.id}', '\${req.id}', this.files[0])">
                          </label>
                          <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'valid')" class="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium">⚡ Quick Valid</button>
                          <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'invalid_invoice')" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium">❌ Test Invalid</button>
                          <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'draft')" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium">⚠️ Test Draft</button>
                          \${req.idKey === 'REGISTERED_TITLE_DEED' ? \`
                            <button onclick="simulateUpload('\${p.id}', '\${req.id}', 'mismatch_owner')" class="px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium">⚡ Discrepant Owner</button>
                          \` : ''}
                        </div>
                      </div>
                    \`}

                    <!-- AI Verification Reason Box -->
                    \${req.verificationReason ? \`
                      <div class="mt-2.5 p-3 rounded-xl text-xs border \${getAIReasonBoxClass(req.verificationStatus)}">
                        <div class="flex items-start space-x-2">
                          <span class="text-sm mt-0.5">\${getAIStatusIcon(req.verificationStatus)}</span>
                          <div class="w-full">
                            <div class="flex items-center justify-between">
                              <span class="font-bold text-slate-800">Gemini AI Document Analysis:</span>
                              \${req.extractedDetails?.surveyNumber || req.verificationStatus === 'Appears Valid' ? \`<span class="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold">Gemini 3 Flash</span>\` : ''}
                            </div>
                            <p class="mt-0.5 text-slate-700 leading-relaxed">\${req.verificationReason}</p>
                            \${req.extractedDetails?.surveyNumber || req.extractedDetails?.ownerName ? \`
                              <div class="mt-1.5 p-2 bg-white/80 rounded border border-slate-200 font-mono text-[10px] text-slate-600 space-y-0.5">
                                \${req.extractedDetails.ownerName ? \`<div>Owner: <strong>\${req.extractedDetails.ownerName}</strong></div>\` : ''}
                                \${req.extractedDetails.surveyNumber ? \`<div>Survey #: <strong>\${req.extractedDetails.surveyNumber}</strong></div>\` : ''}
                                \${req.extractedDetails.plotArea ? \`<div>Extracted Area: <strong>\${req.extractedDetails.plotArea}</strong></div>\` : ''}
                                \${req.extractedDetails.engineerStamp ? \`<div>License/Stamp: <strong>\${req.extractedDetails.engineerStamp}</strong></div>\` : ''}
                              </div>
                            \` : ''}
                            <div class="mt-1.5 text-[9px] text-slate-400 italic">
                              Disclaimer: Automated AI preliminary verification under TNCDBR-2019. Does not constitute legal title certification or government sanction.
                            </div>
                          </div>
                        </div>
                      </div>
                    \` : ''}
                  </div>
                \`).join('')}
              </div>
            </div>
          </div>

          <!-- Right Column: Audit Trail & Project Details -->
          <div class="space-y-6">
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80">
              <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Statutory Project Profile</h4>
              <div class="space-y-3 text-xs">
                <div class="flex justify-between py-1.5 border-b border-slate-100">
                  <span class="text-slate-500">Authority</span>
                  <span class="font-bold text-slate-800 text-right">\${p.authority?.name}</span>
                </div>
                <div class="flex justify-between py-1.5 border-b border-slate-100">
                  <span class="text-slate-500">District & Taluk</span>
                  <span class="font-semibold text-slate-800">\${p.project?.district}, \${p.project?.taluk}</span>
                </div>
                <div class="flex justify-between py-1.5 border-b border-slate-100">
                  <span class="text-slate-500">TNCDBR Classification</span>
                  <span class="font-bold text-emerald-800">\${p.buildingClass || 'NHRB'}</span>
                </div>
                <div class="flex justify-between py-1.5 border-b border-slate-100">
                  <span class="text-slate-500">Min. Road Required</span>
                  <span class="font-bold text-slate-800">\${p.minRoadWidthRequired} m</span>
                </div>
                <div class="flex justify-between py-1.5 border-b border-slate-100">
                  <span class="text-slate-500">Abutting Road Width</span>
                  <span class="font-bold \${p.project?.roadWidth >= p.minRoadWidthRequired ? 'text-emerald-700' : 'text-rose-700'}">
                    \${p.project?.roadWidth} m (\${p.project?.roadWidth >= p.minRoadWidthRequired ? 'Compliant' : 'Deficit'})
                  </span>
                </div>
                <div class="flex justify-between py-1.5">
                  <span class="text-slate-500">OSR Applicability</span>
                  <span class="font-bold \${p.project?.plotArea >= 3000 ? 'text-amber-700' : 'text-slate-600'}">
                    \${p.project?.plotArea >= 3000 ? '10% OSR Mandatory (Rule 41)' : 'Exempt (< 3,000 sq.m)'}
                  </span>
                </div>
              </div>
            </div>

            <!-- Audit Trail Feed -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80">
              <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center">
                <i class="fa-solid fa-timeline text-emerald-600 mr-2"></i> Audit & Pre-Scrutiny Trail
              </h4>
              <div class="space-y-4 max-h-96 overflow-y-auto pr-1">
                \${p.auditLogs.map(a => \`
                  <div class="relative pl-5 border-l-2 border-slate-200 text-xs">
                    <div class="absolute -left-1.5 top-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                    <div class="flex items-center justify-between text-[11px] text-slate-400 mb-0.5">
                      <span class="font-semibold text-slate-700">\${a.action}</span>
                      <span>\${new Date(a.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p class="text-slate-600 text-xs leading-relaxed">\${a.details}</p>
                  </div>
                \`).join('')}
              </div>
            </div>
          </div>
        </div>
      \`;
    }

    function getAIStatusClass(status) {
      switch (status) {
        case 'Appears Valid': return 'status-valid';
        case 'Needs Review': return 'status-review';
        case 'Checking': return 'status-checking';
        case 'Invalid': return 'status-invalid';
        case 'Missing':
        default: return 'status-missing';
      }
    }

    function getAIStatusIcon(status) {
      switch (status) {
        case 'Appears Valid': return '✅';
        case 'Needs Review': return '⚠️';
        case 'Checking': return '🔍';
        case 'Invalid': return '❌';
        case 'Missing':
        default: return '⭕';
      }
    }

    function getAIReasonBoxClass(status) {
      switch (status) {
        case 'Appears Valid': return 'bg-emerald-50/60 border-emerald-200 text-emerald-900';
        case 'Needs Review': return 'bg-amber-50/60 border-amber-200 text-amber-900';
        case 'Invalid': return 'bg-rose-50/60 border-rose-200 text-rose-900';
        default: return 'bg-slate-50 border-slate-200 text-slate-700';
      }
    }

    // Modal Toggles & Actions
    function toggleCreateProjectModal(show) {
      document.getElementById('createProjectModal').classList.toggle('hidden', !show);
    }

    async function handleCreateProject(e) {
      e.preventDefault();
      const payload = {
        name: document.getElementById('pName').value,
        address: document.getElementById('pAddress').value,
        district: document.getElementById('pDistrict').value,
        taluk: document.getElementById('pTaluk').value,
        city: document.getElementById('pDistrict').value,
        authority: document.getElementById('pAuthority').value,
        plotArea: document.getElementById('pPlotArea').value,
        builtUpArea: document.getElementById('pBuiltUpArea').value,
        height: document.getElementById('pHeight').value,
        roadWidth: document.getElementById('pRoadWidth').value,
        nearWaterBody: document.getElementById('pWaterBody').checked,
        nearAirport: document.getElementById('pAirport').checked,
        abuttingHighway: document.getElementById('pHighway').checked,
        initialPermitType: document.getElementById('pPermitType').value,
        ownerName: document.getElementById('pOwner').value,
        parcelNumber: document.getElementById('pSurvey').value
      };

      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        return alert(data.error || 'Failed to create project');
      }

      toggleCreateProjectModal(false);
      await loadMetrics();
      await loadProjects();
      if (data.permit && data.permit.id) {
        await openPermit(data.permit.id);
      } else {
        await init();
      }
    }

    function openProfReviewModal(permitId) {
      document.getElementById('reviewPermitId').value = permitId;
      const audit = state.currentPermit?.audit;
      const warningBox = document.getElementById('reviewBlockerWarning');
      const warningText = document.getElementById('reviewBlockerText');
      if (audit && audit.blockers && audit.blockers.length > 0) {
        warningText.innerText = 'There are ' + audit.blockers.length + ' active blockers in the pre-submission audit (e.g., "' + audit.blockers[0].title + '"). Please ensure discrepancies are rectified before government submission.';
        warningBox.classList.remove('hidden');
      } else {
        warningBox.classList.add('hidden');
      }
      document.getElementById('profReviewModal').classList.remove('hidden');
    }

    function toggleProfReviewModal(show) {
      document.getElementById('profReviewModal').classList.toggle('hidden', !show);
    }

    async function handleProfessionalReview(e) {
      e.preventDefault();
      const permitId = document.getElementById('reviewPermitId').value;
      const payload = {
        reviewerName: document.getElementById('rReviewerName').value,
        registrationNumber: document.getElementById('rRegNo').value,
        declarationStatement: document.getElementById('rDeclaration').value
      };

      const res = await fetch(\`/api/v1/permits/\${permitId}/professional-review\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        return alert(err.error || 'Failed to complete professional review');
      }

      toggleProfReviewModal(false);
      await openPermit(permitId);
      await loadMetrics();
    }

    async function handleGeneratePackage(permitId) {
      const res = await fetch(\`/api/v1/permits/\${permitId}/generate-package\`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to generate package');

      await openPermit(permitId);
      await loadMetrics();
      viewPackageDossier(permitId);
    }

    function openGovtFilingModal(permitId) {
      document.getElementById('filingPermitId').value = permitId;
      document.getElementById('gFilingDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('govtFilingModal').classList.remove('hidden');
    }

    function toggleGovtFilingModal(show) {
      document.getElementById('govtFilingModal').classList.toggle('hidden', !show);
    }

    async function handleGovtFiling(e) {
      e.preventDefault();
      const permitId = document.getElementById('filingPermitId').value;
      const payload = {
        officialApplicationNumber: document.getElementById('gAppNo').value,
        portalType: document.getElementById('gPortalType').value,
        portalFilingDate: document.getElementById('gFilingDate').value,
        notes: document.getElementById('gNotes').value
      };

      const res = await fetch(\`/api/v1/permits/\${permitId}/record-government-submission\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        return alert(err.error || 'Failed to record filing');
      }

      toggleGovtFilingModal(false);
      await openPermit(permitId);
      await loadMetrics();
    }

    function openGovtMilestoneModal(permitId) {
      document.getElementById('milestonePermitId').value = permitId;
      document.getElementById('govtMilestoneModal').classList.remove('hidden');
    }

    function toggleGovtMilestoneModal(show) {
      document.getElementById('govtMilestoneModal').classList.toggle('hidden', !show);
    }

    async function handleGovtMilestoneSubmit(e) {
      e.preventDefault();
      const permitId = document.getElementById('milestonePermitId').value;
      const stage = document.getElementById('mStage').value;
      const remarks = document.getElementById('mRemarks').value;
      const demandAmount = document.getElementById('mDemandAmount').value;
      const queryText = document.getElementById('mQueryText').value;

      const res = await fetch(\`/api/v1/permits/\${permitId}/government-milestone\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, remarks, demandAmount, queryText })
      });

      if (!res.ok) {
        const err = await res.json();
        return alert(err.error || 'Failed to update milestone');
      }

      toggleGovtMilestoneModal(false);
      await openPermit(permitId);
      await loadMetrics();
    }

    function viewPackageDossier(permitId) {
      const p = state.currentPermit;
      if (!p || !p.submissionPackage) return alert('No package dossier generated yet.');
      const pkg = p.submissionPackage;
      const container = document.getElementById('packageDossierContent');
      container.innerHTML = \`
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 space-y-2">
          <div class="flex justify-between items-center">
            <span class="font-bold text-slate-800 text-sm">Dossier ID: <span class="font-mono text-indigo-700">\${pkg.packageId}</span></span>
            <span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[11px]">\${pkg.totalFilesIncluded} Documents Indexed</span>
          </div>
          <div class="text-xs text-slate-600">
            <strong>Target Authority:</strong> \${pkg.permit?.authority || 'CMDA / DTCP'}<br>
            <strong>Governing Rules:</strong> \${pkg.permit?.governingRule || 'TNCDBR-2019'}<br>
            <strong>Technical Endorsement:</strong> \${pkg.professionalSignOff ? \`\${pkg.professionalSignOff.reviewerName} (\${pkg.professionalSignOff.registrationNumber})\` : 'Pending Sign-Off'}
          </div>
        </div>
        <h4 class="font-bold text-slate-800 mb-2 uppercase text-[11px] tracking-wider">Numbered Submittal Files (Standard Filing Order)</h4>
        <div class="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
          \${(pkg.fileIndex || []).map(f => \`
            <div class="p-3 bg-white hover:bg-slate-50 flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <span class="h-6 w-6 rounded bg-slate-100 text-slate-700 font-mono font-bold flex items-center justify-center text-[11px]">\${f.sequenceNumber}</span>
                <div>
                  <p class="font-mono font-bold text-slate-900 text-xs">\${f.officialFileAlias}</p>
                  <p class="text-[10px] text-slate-500">\${f.requirementName} &bull; \${f.regulatoryCitation}</p>
                </div>
              </div>
              <span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-bold">Verified</span>
            </div>
          \`).join('')}
        </div>
      \`;
      togglePackageDossierModal(true);
    }

    function togglePackageDossierModal(show) {
      document.getElementById('packageDossierModal').classList.toggle('hidden', !show);
    }

    async function simulateUpload(permitId, reqId, testType) {
      let fileName = 'document.pdf';
      let fileSize = 1500000;

      if (testType === 'invalid_invoice') {
        fileName = 'cement_contractor_invoice_bill.pdf';
        fileSize = 45000;
      } else if (testType === 'draft') {
        fileName = 'draft_preliminary_blueprint_wip.pdf';
        fileSize = 2500000;
      } else if (testType === 'mismatch_owner') {
        fileName = 'sale_deed_mismatch_name_doc914.pdf';
        fileSize = 2100000;
      } else if (testType === 'mismatch_survey') {
        fileName = 'fmb_sketch_mismatch_survey.pdf';
        fileSize = 1800000;
      } else if (testType === 'valid') {
        const req = state.currentPermit?.requirements?.find(r => r.id === reqId);
        fileName = (req ? req.idKey.toLowerCase() : 'verified_doc') + '_sanctioned_copy.pdf';
      }

      await fetch(\`/api/v1/permits/\${permitId}/requirements/\${reqId}/documents\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, fileSize, mimeType: 'application/pdf' })
      });

      await openPermit(permitId);
      await loadMetrics();
    }

    async function fastTrackValidDossier(permitId) {
      const p = state.currentPermit;
      if (!p) return;
      for (const req of p.requirements) {
        if (req.verificationStatus !== 'Appears Valid') {
          await fetch(\`/api/v1/permits/\${permitId}/requirements/\${req.id}/documents\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: \`\${req.idKey.toLowerCase()}_sanctioned_copy.pdf\`,
              fileSize: 1500000,
              mimeType: 'application/pdf'
            })
          });
        }
      }
      await openPermit(permitId);
      await loadMetrics();
    }

    function getGovtStageLabel(stage) {
      const map = {
        SUBMITTED_ON_GOVT_PORTAL: 'Application Filed on Official Portal',
        SCRUTINY_IN_PROGRESS: 'Technical Scrutiny in Progress (Assistant Planner)',
        SITE_INSPECTION_SCHEDULED: 'Joint Site Inspection Scheduled / Completed',
        DEFICIENCY_QUERY_RAISED: 'Deficiency Query Raised',
        DEMAND_NOTICE_ISSUED: 'Demand Notice Issued (I&A / Development Charges)',
        PLANNING_PERMIT_SANCTIONED: 'Planning Permission Sanctioned & Sanction Order Issued',
        APPLICATION_REFUSED: 'Sanction Refused (Sec 49 Order)'
      };
      return map[stage] || stage;
    }

    function getGovtStageBadgeClass(stage) {
      switch (stage) {
        case 'PLANNING_PERMIT_SANCTIONED': return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        case 'APPLICATION_REFUSED': return 'bg-rose-500/20 text-rose-300 border border-rose-500/30';
        case 'DEMAND_NOTICE_ISSUED': return 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
        case 'SITE_INSPECTION_SCHEDULED': return 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
        default: return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
      }
    }

    async function handleFileUpload(permitId, reqId, file) {
      if (!file) return;

      const res = await fetch(\`/api/v1/permits/\${permitId}/requirements/\${reqId}/documents\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/pdf'
        })
      });

      if (!res.ok) {
        const err = await res.json();
        return alert(err.error || 'Upload failed');
      }

      await openPermit(permitId);
      await loadMetrics();
    }

    async function handleDeleteProject(projectId, event) {
      if (event) event.stopPropagation();
      if (!projectId) return;
      if (!confirm('Are you sure you want to delete this project and all associated submittals, checklists, and filings? This action cannot be undone.')) {
        return;
      }
      try {
        const res = await fetch(\`/api/v1/projects/\${projectId}\`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          return alert(data.error || 'Failed to delete project');
        }
        alert(data.message || 'Project deleted successfully.');
        if (state.activeView === 'permitDetail') {
          showDashboard();
        }
        await loadMetrics();
        await loadProjects();
        renderApp();
      } catch (err) {
        alert('Error deleting project: ' + err.message);
      }
    }

    async function handleDeleteDocument(permitId, reqId, docId) {
      if (!confirm('Are you sure you want to delete this uploaded document? The requirement status will be reset to missing.')) {
        return;
      }
      try {
        const url = \`/api/v1/permits/\${permitId}/requirements/\${reqId}/documents\` + (docId ? \`/\${docId}\` : '');
        const res = await fetch(url, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          return alert(data.error || 'Failed to delete document');
        }
        await openPermit(permitId);
        await loadMetrics();
      } catch (err) {
        alert('Error deleting document: ' + err.message);
      }
    }

    init();
  </script>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('================================================================');
    console.log(' PERMITFLOW TN - TAMIL NADU CONSTRUCTION PERMIT SYSTEM ONLINE ');
    console.log(' URL: http://localhost:' + PORT);
    console.log(' Jurisdiction: Tamil Nadu (TNCDBR-2019)');
    console.log(' Planning Authorities: CMDA, DTCP, Greater Chennai Corporation');
    console.log(' Storage: Persistent DB (data/db.json) + Firebase Compatible');
    console.log('================================================================');
  });
}

module.exports = requestHandler;
module.exports.server = server;
