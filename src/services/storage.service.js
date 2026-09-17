/**
 * Real Persistence & Firestore-Modeled Storage Service
 * Persists projects, permits, requirements, documents, validation results,
 * professional reviews, applications, issues, and timeline events.
 * Guarantees data durability across server restarts.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function getInitialSeedData() {
  return {
    users: [
      { id: 'usr-1', email: 'senthil.pm@lnt-constructions.com', firstName: 'Senthil', lastName: 'Kumar', role: 'PROJECT_MANAGER', passwordHash: 'salt_hash_pass123' },
      { id: 'usr-2', email: 'swaminathan.architect@tn-associates.com', firstName: 'Swaminathan', lastName: 'K.', role: 'ARCHITECT', passwordHash: 'salt_hash_pass123' },
      { id: 'usr-3', email: 'planning.scrutiny@cmda.tn.gov.in', firstName: 'Sundaram', lastName: 'V.', role: 'PLANNING_OFFICER', passwordHash: 'salt_hash_pass123' },
      { id: 'usr-4', email: 'client.director@casagrand.co.in', firstName: 'Rajesh', lastName: 'V.', role: 'VIEWER', passwordHash: 'salt_hash_pass123' },
      { id: 'usr-other', email: 'contractor.guest@external.com', firstName: 'Guest', lastName: 'Contractor', role: 'PROJECT_MANAGER', passwordHash: 'salt_hash_pass123' }
    ],
    currentUser: { id: 'usr-1', email: 'senthil.pm@lnt-constructions.com', firstName: 'Senthil', lastName: 'Kumar', role: 'PROJECT_MANAGER' },
    projects: [
      {
        id: 'proj-tn-01',
        name: 'Sholinganallur Tech Park - Tower A',
        description: 'Stilt + 5 Floors Commercial IT/ITES development conforming to TNCDBR-2019 Rule 35 with dedicated parking and RWH.',
        address: 'Plot 42, Rajiv Gandhi Salai (OMR), Sholinganallur',
        country: 'India',
        state: 'Tamil Nadu',
        district: 'Chennai',
        city: 'Chennai',
        taluk: 'Sholinganallur',
        zipCode: '600119',
        parcelNumber: 'S.No. 142/2B',
        ownerName: 'Apex Tech Infrastructure Pvt Ltd',
        ownerContact: 'director@apextech.in',
        plotArea: 2400,
        builtUpArea: 4800,
        height: 17.5,
        roadWidth: 18.0,
        budget: 45000000,
        estimatedStartDate: '2026-11-01',
        estimatedEndDate: '2028-06-30',
        managerId: 'usr-1',
        authority: 'CMDA',
        governingCode: 'Tamil Nadu Combined Development and Building Rules, 2019 (TNCDBR-2019)',
        createdAt: '2026-08-10T10:00:00.000Z'
      }
    ],
    permits: [
      {
        id: 'pmt-tn-101',
        projectId: 'proj-tn-01',
        permitType: 'Commercial Building Plan Approval',
        authority: {
          id: 'CMDA',
          name: 'Chennai Metropolitan Development Authority (CMDA)',
          portalUrl: 'https://onlinecmdachennai.com',
          governingCode: 'TNCDBR-2019 & Tamil Nadu Town and Country Planning Act, 1971'
        },
        status: 'AUDIT_IN_PROGRESS',
        minRoadWidthRequired: 9.0,
        actualRoadWidth: 18.0,
        targetSubmissionDate: '2026-10-15',
        actualSubmissionDate: null,
        notes: 'Pre-submission audit in progress for CMDA Single Window submittal.',
        professionalReview: null,
        submissionPackage: null,
        governmentTracking: null,
        createdAt: '2026-08-15T09:00:00.000Z'
      }
    ],
    requirements: [
      {
        id: 'req-tn-1',
        permitId: 'pmt-tn-101',
        idKey: 'PATTA_CHITTA_TSLR',
        documentType: 'PATTA_CHITTA_TSLR',
        category: 'Land Ownership & Revenue',
        name: 'Latest Patta / Chitta / Town Survey Land Record (TSLR) Extract',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'TNCDBR-2019 Rule 10(1)',
        verificationStatus: 'Appears Valid',
        verificationBadge: '✅ Appears Valid',
        verificationReason: 'Verified valid Tamil Nadu digital Patta / TSLR extract. Survey Number: S.No. 142/2B, Owner: Apex Tech Infrastructure Pvt Ltd.',
        extractedDetails: {
          ownerName: 'Apex Tech Infrastructure Pvt Ltd',
          surveyNumber: 'S.No. 142/2B',
          villageTaluk: 'Sholinganallur, Chennai',
          plotArea: '2,400 sq.m',
          abuttingRoadWidth: '18.0 meters'
        }
      }
    ],
    documents: [
      {
        id: 'doc-tn-1',
        requirementId: 'req-tn-1',
        fileName: 'v1_Patta_SNo142_2B_Sholinganallur.pdf',
        originalName: 'Patta_SNo142_2B_Sholinganallur.pdf',
        fileSizeBytes: 420000,
        mimeType: 'application/pdf',
        version: 1,
        isCurrent: true,
        storageKey: 'firebase-storage://permits/pmt-tn-101/req-tn-1/v1_Patta_SNo142_2B_Sholinganallur.pdf',
        uploadedById: 'usr-1',
        createdAt: '2026-08-16T11:00:00.000Z'
      }
    ],
    validationResults: [],
    professionalReviews: [],
    applications: [],
    issues: [],
    timelineEvents: [
      {
        id: 'aud-tn-1',
        permitId: 'pmt-tn-101',
        changedById: 'usr-1',
        action: 'PROJECT_INITIALIZED',
        fromStatus: null,
        toStatus: 'AUDIT_IN_PROGRESS',
        details: 'Initialized Sholinganallur Tech Park project under CMDA Planning Permission regulations (TNCDBR-2019).',
        createdAt: '2026-08-15T09:00:00.000Z'
      }
    ],
    auditLogs: [],
    notifications: []
  };
}

class StorageService {
  constructor() {
    this.data = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        this.data = JSON.parse(raw);
        // Ensure all collections exist
        this._ensureCollections();
      } else {
        this.data = getInitialSeedData();
        this.save();
      }
    } catch (err) {
      console.error('Failed to load database from disk, using seed data:', err.message);
      this.data = getInitialSeedData();
      this.save();
    }
  }

  _ensureCollections() {
    if (!Array.isArray(this.data.users)) this.data.users = [];
    if (!Array.isArray(this.data.projects)) this.data.projects = [];
    if (!Array.isArray(this.data.permits)) this.data.permits = [];
    if (!Array.isArray(this.data.requirements)) this.data.requirements = [];
    if (!Array.isArray(this.data.documents)) this.data.documents = [];
    if (!Array.isArray(this.data.validationResults)) this.data.validationResults = [];
    if (!Array.isArray(this.data.professionalReviews)) this.data.professionalReviews = [];
    if (!Array.isArray(this.data.applications)) this.data.applications = [];
    if (!Array.isArray(this.data.issues)) this.data.issues = [];
    if (!Array.isArray(this.data.timelineEvents)) this.data.timelineEvents = [];
    if (!Array.isArray(this.data.auditLogs)) this.data.auditLogs = this.data.timelineEvents;
    if (!Array.isArray(this.data.notifications)) this.data.notifications = [];
    if (!this.data.currentUser) {
      this.data.currentUser = this.data.users[0] || { id: 'usr-1', email: 'senthil.pm@lnt-constructions.com', role: 'PROJECT_MANAGER' };
    }
  }

  save() {
    try {
      // Sync timelineEvents and auditLogs
      if (this.data.auditLogs && !this.data.timelineEvents) {
        this.data.timelineEvents = this.data.auditLogs;
      } else if (this.data.timelineEvents && !this.data.auditLogs) {
        this.data.auditLogs = this.data.timelineEvents;
      }
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save database to disk:', err.message);
    }
  }

  getDB() {
    return this.data;
  }

  // --- Entity Operations (Firestore collection abstractions) ---

  // Projects
  getProjects(userId) {
    if (!userId) return this.data.projects;
    return this.data.projects.filter(p => p.managerId === userId);
  }

  getProjectById(id) {
    return this.data.projects.find(p => p.id === id) || null;
  }

  saveProject(project) {
    const idx = this.data.projects.findIndex(p => p.id === project.id);
    if (idx >= 0) {
      this.data.projects[idx] = { ...this.data.projects[idx], ...project, updatedAt: new Date().toISOString() };
    } else {
      this.data.projects.push({ ...project, createdAt: project.createdAt || new Date().toISOString() });
    }
    this.save();
    return project;
  }

  // Permits
  getPermits(projectId) {
    if (!projectId) return this.data.permits;
    return this.data.permits.filter(p => p.projectId === projectId);
  }

  getPermitById(id) {
    return this.data.permits.find(p => p.id === id) || null;
  }

  savePermit(permit) {
    const idx = this.data.permits.findIndex(p => p.id === permit.id);
    if (idx >= 0) {
      this.data.permits[idx] = { ...this.data.permits[idx], ...permit, updatedAt: new Date().toISOString() };
    } else {
      this.data.permits.push({ ...permit, createdAt: permit.createdAt || new Date().toISOString() });
    }
    this.save();
    return permit;
  }

  // Requirements
  getRequirements(permitId) {
    if (!permitId) return this.data.requirements;
    return this.data.requirements.filter(r => r.permitId === permitId);
  }

  saveRequirement(req) {
    const idx = this.data.requirements.findIndex(r => r.id === req.id);
    if (idx >= 0) {
      this.data.requirements[idx] = { ...this.data.requirements[idx], ...req, updatedAt: new Date().toISOString() };
    } else {
      this.data.requirements.push(req);
    }
    this.save();
    return req;
  }

  // Documents
  getDocuments(requirementId) {
    if (!requirementId) return this.data.documents;
    return this.data.documents.filter(d => d.requirementId === requirementId);
  }

  saveDocument(doc) {
    const idx = this.data.documents.findIndex(d => d.id === doc.id);
    if (idx >= 0) {
      this.data.documents[idx] = { ...this.data.documents[idx], ...doc };
    } else {
      this.data.documents.push(doc);
    }
    this.save();
    return doc;
  }

  // Validation Results
  saveValidationResult(val) {
    this.data.validationResults.push({
      id: val.id || `val-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      ...val,
      createdAt: new Date().toISOString()
    });
    this.save();
  }

  // Professional Reviews
  saveProfessionalReview(review) {
    this.data.professionalReviews.push({
      id: review.id || `rev-${Date.now()}`,
      ...review,
      createdAt: new Date().toISOString()
    });
    this.save();
  }

  // Applications
  saveApplication(app) {
    const idx = this.data.applications.findIndex(a => a.id === app.id);
    if (idx >= 0) {
      this.data.applications[idx] = { ...this.data.applications[idx], ...app, updatedAt: new Date().toISOString() };
    } else {
      this.data.applications.push({ ...app, createdAt: new Date().toISOString() });
    }
    this.save();
  }

  // Timeline & Audit Logs
  addTimelineEvent(event) {
    const newEvent = {
      id: event.id || `aud-${Date.now()}`,
      ...event,
      createdAt: event.createdAt || new Date().toISOString()
    };
    this.data.timelineEvents.unshift(newEvent);
    if (this.data.auditLogs !== this.data.timelineEvents) {
      this.data.auditLogs.unshift(newEvent);
    }
    this.save();
    return newEvent;
  }

  // Users & Auth
  getUserById(id) {
    return this.data.users.find(u => u.id === id) || null;
  }

  getUserByEmail(email) {
    if (!email) return null;
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase().trim()) || null;
  }

  saveUser(user) {
    const idx = this.data.users.findIndex(u => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase());
    if (idx >= 0) {
      this.data.users[idx] = { ...this.data.users[idx], ...user };
    } else {
      this.data.users.push(user);
    }
    this.save();
    return user;
  }
}

const storageService = new StorageService();

module.exports = {
  storageService,
  StorageService,
  UPLOADS_DIR
};
