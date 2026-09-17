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

// Initial Realistic Seed Data for Tamil Nadu Construction Projects
function getInitialSeedData() {
  return {
    users: [
      { id: 'usr-1', email: 'senthil.pm@lnt-constructions.com', firstName: 'Senthil', lastName: 'Kumar', role: 'PROJECT_MANAGER' },
      { id: 'usr-2', email: 'swaminathan.architect@tn-associates.com', firstName: 'Swaminathan', lastName: 'K.', role: 'ARCHITECT' },
      { id: 'usr-3', email: 'planning.scrutiny@cmda.tn.gov.in', firstName: 'Sundaram', lastName: 'V.', role: 'PLANNING_OFFICER' },
      { id: 'usr-4', email: 'client.director@casagrand.co.in', firstName: 'Rajesh', lastName: 'V.', role: 'VIEWER' }
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
        plotArea: 2400, // sq.m
        builtUpArea: 4800, // sq.m
        height: 17.5, // meters (NHRB)
        roadWidth: 18.0, // meters (OMR Service Road)
        budget: 45000000,
        estimatedStartDate: '2026-11-01',
        estimatedEndDate: '2028-06-30',
        managerId: 'usr-1',
        authority: 'CMDA',
        governingCode: 'Tamil Nadu Combined Development and Building Rules, 2019 (TNCDBR-2019)',
        createdAt: '2026-08-10T10:00:00.000Z'
      },
      {
        id: 'proj-tn-02',
        name: 'Peelamedu Commercial Plaza',
        description: 'Multi-tenant commercial retail and office complex on Avinashi Road.',
        address: '420 Avinashi Road, Peelamedu',
        country: 'India',
        state: 'Tamil Nadu',
        district: 'Coimbatore',
        city: 'Coimbatore',
        taluk: 'Coimbatore South',
        zipCode: '641004',
        parcelNumber: 'T.S. No. 88/1A',
        ownerName: 'KG Promoters & Developers',
        ownerContact: 'projects@kgpromoters.com',
        plotArea: 3200, // sq.m (Triggers OSR Rule 41!)
        builtUpArea: 6400, // sq.m
        height: 18.0, // meters
        roadWidth: 24.0, // meters (Avinashi Road)
        budget: 62000000,
        estimatedStartDate: '2026-12-01',
        estimatedEndDate: '2028-10-31',
        managerId: 'usr-1',
        authority: 'DTCP',
        governingCode: 'TNCDBR-2019 (DTCP Regional Office)',
        createdAt: '2026-08-20T14:30:00.000Z'
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
      },
      {
        id: 'pmt-tn-201',
        projectId: 'proj-tn-02',
        permitType: 'Commercial Building Plan Approval',
        authority: {
          id: 'DTCP',
          name: 'Directorate of Town and Country Planning (DTCP)',
          portalUrl: 'https://dtcp.tn.gov.in',
          governingCode: 'TNCDBR-2019 (Coimbatore District Planning Office)'
        },
        status: 'DOCUMENTS_PENDING',
        minRoadWidthRequired: 9.0,
        actualRoadWidth: 24.0,
        targetSubmissionDate: '2026-11-15',
        actualSubmissionDate: null,
        notes: 'Coimbatore DTCP submittal requiring 10% OSR reservation deed under Rule 41.',
        professionalReview: null,
        submissionPackage: null,
        governmentTracking: null,
        createdAt: '2026-08-22T11:00:00.000Z'
      }
    ],
    requirements: [
      // Sholinganallur Tech Park Requirements
      {
        id: 'req-tn-1',
        permitId: 'pmt-tn-101',
        idKey: 'PATTA_CHITTA_TSLR',
        documentType: 'PATTA_CHITTA_TSLR',
        category: 'Land Ownership & Revenue',
        name: 'Latest Patta / Chitta / Town Survey Land Record (TSLR) Extract',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'TNCDBR-2019 Rule 10(1) & Revenue Dept Guidelines',
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
      },
      {
        id: 'req-tn-2',
        permitId: 'pmt-tn-101',
        idKey: 'REGISTERED_TITLE_DEED',
        documentType: 'REGISTERED_TITLE_DEED',
        category: 'Land Ownership & Revenue',
        name: 'Registered Title Deed / Parent Sale Deeds (Complete Chain)',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'TNCDBR-2019 Rule 10(2) & Registration Act 1908',
        verificationStatus: 'Appears Valid',
        verificationBadge: '✅ Appears Valid',
        verificationReason: 'Registered Sale Deed verified. Document No: 4118/2021, SRO Neelankarai. Clear ownership title chain verified.',
        extractedDetails: {
          ownerName: 'Apex Tech Infrastructure Pvt Ltd',
          surveyNumber: 'S.No. 142/2B',
          documentNumber: 'Doc No. 4118/2021',
          sroName: 'SRO Neelankarai'
        }
      },
      {
        id: 'req-tn-3',
        permitId: 'pmt-tn-101',
        idKey: 'ENCUMBRANCE_CERTIFICATE',
        documentType: 'ENCUMBRANCE_CERTIFICATE',
        category: 'Land Ownership & Revenue',
        name: 'Encumbrance Certificate (EC) for 13 to 30 Years',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'TNCDBR-2019 Rule 10(3) - Title Encumbrance Verification',
        verificationStatus: 'Appears Valid',
        verificationBadge: '✅ Appears Valid',
        verificationReason: 'TNREGINET certified Encumbrance Certificate verified for 30 years up to date with zero adverse encumbrances.',
        extractedDetails: {
          documentNumber: 'EC Search 1996-2026',
          sroName: 'SRO Neelankarai'
        }
      },
      {
        id: 'req-tn-4',
        permitId: 'pmt-tn-101',
        idKey: 'FMB_TOWN_SURVEY_SKETCH',
        documentType: 'FMB_TOWN_SURVEY_SKETCH',
        category: 'Land Ownership & Revenue',
        name: 'Field Measurement Book (FMB) Sketch / Certified Town Survey Sketch',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'TNCDBR-2019 Rule 10(4) - Revenue Survey Boundaries',
        verificationStatus: 'Appears Valid',
        verificationBadge: '✅ Appears Valid',
        verificationReason: 'Field Measurement Book (FMB) Sketch certified by Taluk Surveyor. Shows Subdivisional boundaries and ladder offsets for S.No 142/2B.',
        extractedDetails: {
          surveyNumber: 'S.No. 142/2B',
          villageTaluk: 'Sholinganallur'
        }
      },
      {
        id: 'req-tn-5',
        permitId: 'pmt-tn-101',
        idKey: 'COMBINED_ACCESS_SKETCH',
        documentType: 'COMBINED_ACCESS_SKETCH',
        category: 'Land Ownership & Revenue',
        name: 'Combined Revenue Sketch & Approach Road Connectivity Map',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'TNCDBR-2019 Rule 35 - Approach Road Width Verification',
        verificationStatus: 'Appears Valid',
        verificationBadge: '✅ Appears Valid',
        verificationReason: 'Approach road sketch verified by licensed surveyor. Abutting road width: 18.0 meters on OMR Service Road.',
        extractedDetails: {
          abuttingRoadWidth: '18.0 meters'
        }
      },
      {
        id: 'req-tn-6',
        permitId: 'pmt-tn-101',
        idKey: 'ARCHITECTURAL_PLANS',
        documentType: 'ARCHITECTURAL_PLANS',
        category: 'Architectural & Engineering',
        name: 'Detailed Architectural Drawings & Site Plan (PreDCR / AutoDCR Compliant)',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'CMDA Regulations - Rule 11 & Schedule I (Architectural Design Standards)',
        verificationStatus: 'Appears Valid',
        verificationBadge: '✅ Appears Valid',
        verificationReason: 'PreDCR drawing set complete: Site Plan with setbacks, Floor Plans, Sectional Elevations, RWH sump, and Parking table verified. Stamped by Architect (CA/2014/54120).',
        extractedDetails: {
          engineerStamp: 'CA/2014/54120 (Registered Architect)',
          ownerName: 'Apex Tech Infrastructure Pvt Ltd',
          surveyNumber: 'S.No. 142/2B',
          abuttingRoadWidth: '18.0 meters'
        }
      },
      {
        id: 'req-tn-7',
        permitId: 'pmt-tn-101',
        idKey: 'STRUCTURAL_STABILITY_CERTIFICATE',
        documentType: 'STRUCTURAL_STABILITY_CERTIFICATE',
        category: 'Architectural & Engineering',
        name: 'Structural Stability Certificate & Foundation Design (Form II & III)',
        isMandatory: true,
        status: 'UPLOADED',
        regulatoryCitation: 'TNCDBR-2019 Rule 11(5) & National Building Code (NBC 2016 Part 6)',
        verificationStatus: 'Appears Valid',
        verificationBadge: '✅ Appears Valid',
        verificationReason: 'Form II & Form III structural stability certificate endorsed by Class-I Structural Engineer (CMDA/SE/GR-I/19/04/018). Seismic Zone III design verified.',
        extractedDetails: {
          engineerStamp: 'CMDA/SE/GR-I/19/04/018'
        }
      },
      {
        id: 'req-tn-8',
        permitId: 'pmt-tn-101',
        idKey: 'SOIL_TEST_GEOTECH_REPORT',
        documentType: 'SOIL_TEST_GEOTECH_REPORT',
        category: 'Architectural & Engineering',
        name: 'Geotechnical Soil Investigation & Safe Bearing Capacity (SBC) Report',
        isMandatory: true,
        status: 'PENDING',
        regulatoryCitation: 'TNCDBR-2019 Rule 11(6) - Geotechnical Soil Investigation',
        verificationStatus: 'Missing',
        verificationBadge: '❌ Missing',
        verificationReason: 'Borehole log test report and soil safe bearing capacity (SBC) analysis not yet uploaded.',
        extractedDetails: {}
      },
      {
        id: 'req-tn-9',
        permitId: 'pmt-tn-101',
        idKey: 'DFRS_FIRE_RESCUE_NOC',
        documentType: 'DFRS_FIRE_RESCUE_NOC',
        category: 'Statutory Safety Clearance',
        name: 'Directorate of Fire and Rescue Services (DFRS) Preliminary NOC',
        isMandatory: true,
        status: 'PENDING',
        regulatoryCitation: 'TNCDBR-2019 Rule 42 & Tamil Nadu Fire Service Act, 1985',
        verificationStatus: 'Missing',
        verificationBadge: '❌ Missing',
        verificationReason: 'Mandatory DFRS Fire NOC for Commercial building > 500 sq.m not yet uploaded.',
        extractedDetails: {}
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
        uploadedById: 'usr-1',
        createdAt: '2026-08-16T11:00:00.000Z'
      },
      {
        id: 'doc-tn-2',
        requirementId: 'req-tn-2',
        fileName: 'v1_Registered_Sale_Deed_Doc4118_2021.pdf',
        originalName: 'Registered_Sale_Deed_Doc4118_2021.pdf',
        fileSizeBytes: 1840000,
        mimeType: 'application/pdf',
        version: 1,
        isCurrent: true,
        uploadedById: 'usr-1',
        createdAt: '2026-08-16T11:15:00.000Z'
      }
    ],
    auditLogs: [
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
    notifications: [
      {
        id: 'notif-tn-1',
        userId: 'usr-1',
        title: 'DFRS Fire NOC Required',
        message: 'Commercial building exceeding 500 sq.m in Sholinganallur requires DFRS Fire NOC prior to CMDA Single Window submittal.',
        type: 'MISSING_DOCUMENTS',
        linkUrl: '/permits/pmt-tn-101',
        isRead: false,
        createdAt: '2026-09-15T08:00:00.000Z'
      }
    ]
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

  save() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save database to disk:', err.message);
    }
  }

  getDB() {
    return this.data;
  }
}

const storageService = new StorageService();

module.exports = {
  storageService,
  UPLOADS_DIR
};
