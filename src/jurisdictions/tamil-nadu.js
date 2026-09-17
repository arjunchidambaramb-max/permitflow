/**
 * Tamil Nadu Combined Development and Building Rules, 2019 (TNCDBR-2019)
 * Official Regulatory Authority and Document Checklist Generation Engine
 */

// Districts mapped to Primary Planning Authorities
const TN_DISTRICTS = {
  'Chennai': { authority: 'CMDA', defaultTaluks: ['Egmore', 'Mylapore', 'Guindy', 'Tondiarpet', 'Velachery', 'Aminjikarai'] },
  'Chengalpattu': { authority: 'CMDA', defaultTaluks: ['Tambaram', 'Pallavaram', 'Vandalur', 'Chengalpattu', 'Thiruporur'] },
  'Kanchipuram': { authority: 'CMDA', defaultTaluks: ['Sriperumbudur', 'Kundrathur', 'Kanchipuram', 'Walajabad'] },
  'Thiruvallur': { authority: 'CMDA', defaultTaluks: ['Poonamallee', 'Avadi', 'Ambattur', 'Madhavaram', 'Ponneri'] },
  'Coimbatore': { authority: 'DTCP', defaultTaluks: ['Coimbatore North', 'Coimbatore South', 'Sulur', 'Pollachi'] },
  'Madurai': { authority: 'DTCP', defaultTaluks: ['Madurai North', 'Madurai South', 'Melur', 'Thirumangalam'] },
  'Tiruchirappalli': { authority: 'DTCP', defaultTaluks: ['Tiruchirappalli West', 'Tiruchirappalli East', 'Srirangam'] },
  'Salem': { authority: 'DTCP', defaultTaluks: ['Salem', 'Attur', 'Omalur', 'Yercaud'] },
  'Tiruppur': { authority: 'DTCP', defaultTaluks: ['Tiruppur North', 'Tiruppur South', 'Avinashi', 'Dharapuram'] },
  'Erode': { authority: 'DTCP', defaultTaluks: ['Erode', 'Perundurai', 'Bhavani', 'Gobichettipalayam'] },
  'Vellore': { authority: 'DTCP', defaultTaluks: ['Vellore', 'Katpadi', 'Gudiyatham', 'Anaicut'] },
  'Tirunelveli': { authority: 'DTCP', defaultTaluks: ['Tirunelveli', 'Palayamkottai', 'Ambasamudram'] },
  'Other / Rest of TN': { authority: 'DTCP', defaultTaluks: ['General Taluk'] }
};

const TN_AUTHORITIES = {
  CMDA: {
    id: 'CMDA',
    name: 'Chennai Metropolitan Development Authority (CMDA)',
    state: 'Tamil Nadu',
    portalUrl: 'https://onlinecmdachennai.com',
    governingCode: 'TNCDBR-2019 & Tamil Nadu Town and Country Planning Act, 1971',
    description: 'Statutory planning authority for the 1,189 sq.km Chennai Metropolitan Area (CMA).',
    standardReviewDays: 30,
    delegatedLocalBody: 'Greater Chennai Corporation (GCC) / Municipalities'
  },
  DTCP: {
    id: 'DTCP',
    name: 'Directorate of Town and Country Planning (DTCP)',
    state: 'Tamil Nadu',
    portalUrl: 'https://dtcp.tn.gov.in',
    governingCode: 'TNCDBR-2019 & Tamil Nadu Town and Country Planning Act, 1971',
    description: 'Apex planning directorate overseeing development permissions across 37 districts of Tamil Nadu outside CMA.',
    standardReviewDays: 30,
    delegatedLocalBody: 'City Municipal Corporations / Town Panchayats / Village Panchayats'
  },
  GCC: {
    id: 'GCC',
    name: 'Greater Chennai Corporation (GCC) - Town Planning Wing',
    state: 'Tamil Nadu',
    portalUrl: 'https://chennaicorporation.gov.in',
    governingCode: 'TNCDBR-2019 Delegated Powers & GCC Building By-laws',
    description: 'Local civic body sanctioning delegated planning permissions and building permits within 15 city zones.',
    standardReviewDays: 21,
    delegatedLocalBody: 'GCC Zonal Offices (Zones 1-15)'
  }
};

/**
 * Evaluates building classification and road width thresholds under TNCDBR 2019
 */
function evaluateTNCDBRClassification(params) {
  const height = parseFloat(params.height) || 10.0;
  const builtUpArea = parseFloat(params.builtUpArea) || 300.0;
  const plotArea = parseFloat(params.plotArea) || 200.0;
  const roadWidth = parseFloat(params.roadWidth) || 9.0;
  const projectType = params.projectType || 'Commercial Building Plan Approval';
  const district = params.district || 'Chennai';
  const authorityKey = params.authority || (TN_DISTRICTS[district]?.authority || 'CMDA');

  // Classification: High Rise vs Non-High Rise
  let buildingClass = 'Non-High Rise Building (NHRB)';
  let isHRB = false;

  if (height > 18.30) {
    buildingClass = 'High Rise Building (HRB) / Multi-Storey Building';
    isHRB = true;
  } else if (height <= 12.0 && builtUpArea <= 300 && !projectType.includes('Industrial')) {
    buildingClass = 'Low-Rise Building (Delegated Local Body Power)';
  }

  // Statutory Minimum Road Width Check under TNCDBR-2019 Rule 35 & 39
  let minRoadWidthRequired = 7.2; // default min meters
  if (isHRB) {
    if (height <= 30.0) minRoadWidthRequired = 12.0;
    else if (height <= 60.0) minRoadWidthRequired = 15.0;
    else minRoadWidthRequired = 18.0;
  } else {
    if (projectType.includes('Commercial') || projectType.includes('Industrial')) {
      minRoadWidthRequired = 9.0;
    } else if (projectType.includes('Institutional') || projectType.includes('Educational')) {
      minRoadWidthRequired = 10.0;
    } else if (projectType.includes('Layout')) {
      minRoadWidthRequired = 7.2;
    } else {
      minRoadWidthRequired = builtUpArea > 300 ? 9.0 : 7.2;
    }
  }

  const isRoadWidthCompliant = roadWidth >= minRoadWidthRequired;

  // Open Space Reservation (OSR) Trigger under TNCDBR-2019 Rule 41
  // If plot area >= 3,000 sq.m, 10% OSR must be reserved or guideline value paid
  const osrRequired = plotArea >= 3000;
  const osrAreaSqM = osrRequired ? (plotArea * 0.10).toFixed(2) : 0;

  // NOC Triggers
  const fireNocRequired = isHRB || (projectType.includes('Commercial') && builtUpArea > 500) || projectType.includes('Educational') || projectType.includes('Industrial');
  const tnpcbRequired = builtUpArea >= 20000 || projectType.includes('Industrial') || projectType.includes('Hospital');
  const reraRequired = builtUpArea > 500 || (params.dwellingUnits && parseInt(params.dwellingUnits) > 8);

  return {
    buildingClass,
    isHRB,
    minRoadWidthRequired,
    roadWidth,
    isRoadWidthCompliant,
    osrRequired,
    osrAreaSqM,
    fireNocRequired,
    tnpcbRequired,
    reraRequired,
    authority: TN_AUTHORITIES[authorityKey] || TN_AUTHORITIES['CMDA']
  };
}

/**
 * Generates official Tamil Nadu required document checklist based on exact project parameters
 */
function generateTamilNaduChecklist(params) {
  const analysis = evaluateTNCDBRClassification(params);
  const { authority, isHRB, osrRequired, fireNocRequired, tnpcbRequired, reraRequired } = analysis;
  const projectType = params.projectType || 'Commercial Building Plan Approval';
  const nearWaterBody = Boolean(params.nearWaterBody);
  const nearAirport = Boolean(params.nearAirport);
  const abuttingHighway = Boolean(params.abuttingHighway);

  const checklist = [];

  // 1. Mandatory Land Ownership & Revenue Records (Applicable to ALL TN Permissions)
  checklist.push({
    idKey: 'PATTA_CHITTA_TSLR',
    name: 'Latest Patta / Chitta / Town Survey Land Record (TSLR) Extract',
    category: 'Land Ownership & Revenue',
    isMandatory: true,
    description: 'Extract from A-Register or TSLR issued by Revenue Dept (AnyWhere / E-Services) in the name of the present owner/applicant with correct Survey/T.S. Number.',
    regulatoryCitation: 'TNCDBR-2019 Rule 10(1) & Tamil Nadu Revenue Department Circulars',
    acceptedFormats: 'PDF (Official Digital Stamp/QR)'
  });

  checklist.push({
    idKey: 'REGISTERED_TITLE_DEED',
    name: 'Registered Title Deed / Parent Sale Deeds (Complete Chain)',
    category: 'Land Ownership & Revenue',
    isMandatory: true,
    description: 'Certified copy of registered Sale Deed, Partition Deed, or Gift Deed with Doc No., Year, and Sub-Registrar Office (SRO) seal establishing clear legal title.',
    regulatoryCitation: 'TNCDBR-2019 Rule 10(2) & Registration Act 1908',
    acceptedFormats: 'PDF (Certified True Copy)'
  });

  checklist.push({
    idKey: 'ENCUMBRANCE_CERTIFICATE',
    name: 'Encumbrance Certificate (EC) for 13 to 30 Years',
    category: 'Land Ownership & Revenue',
    isMandatory: true,
    description: 'Nil-encumbrance certificate obtained from TNREGINET covering at least 13 years up to the current date, verifying free and clear title.',
    regulatoryCitation: 'TNCDBR-2019 Rule 10(3) - Title Encumbrance Verification',
    acceptedFormats: 'PDF (TNREGINET Digital Certified Copy)'
  });

  checklist.push({
    idKey: 'FMB_TOWN_SURVEY_SKETCH',
    name: 'Field Measurement Book (FMB) Sketch / Certified Town Survey Sketch',
    category: 'Land Ownership & Revenue',
    isMandatory: true,
    description: 'Certified copy of FMB sketch showing subdivisional measurements, boundary offsets, ladder details, and adjacent survey boundaries.',
    regulatoryCitation: 'TNCDBR-2019 Rule 10(4) - Revenue Survey Boundaries',
    acceptedFormats: 'PDF / CAD DWG (Surveyor Signed)'
  });

  checklist.push({
    idKey: 'COMBINED_ACCESS_SKETCH',
    name: 'Combined Revenue Sketch & Approach Road Connectivity Map',
    category: 'Land Ownership & Revenue',
    isMandatory: true,
    description: 'Topographical sketch prepared by licensed surveyor showing unbroken continuity of approach public road width up to the site.',
    regulatoryCitation: 'TNCDBR-2019 Rule 35 - Approach Road Width Verification',
    acceptedFormats: 'PDF / CAD (Licensed Surveyor Stamped)'
  });

  // 2. Technical Drawings & Architectural Submittals (TNCDBR / PreDCR Standard)
  checklist.push({
    idKey: 'ARCHITECTURAL_PLANS',
    name: 'Detailed Architectural Drawings & Site Plan (PreDCR / AutoDCR Compliant)',
    category: 'Architectural & Engineering',
    isMandatory: true,
    description: `Complete plan set conforming to TNCDBR-2019: Key Plan (1:10000), Site Plan (1:500) showing front/side/rear setbacks, Floor Plans, Cross-Sections, Terrace Plan with Rain Water Harvesting (RWH) sump, and Parking calculation table. Stamped by Registered Architect (COA) or Licensed Building Surveyor.`,
    regulatoryCitation: `${authority.governingCode} - Rule 11 & Schedule I (Architectural Design Standards)`,
    acceptedFormats: 'PDF & PreDCR DWG'
  });

  checklist.push({
    idKey: 'STRUCTURAL_STABILITY_CERTIFICATE',
    name: 'Structural Stability Certificate & Foundation Design (Form II & III)',
    category: 'Architectural & Engineering',
    isMandatory: true,
    description: 'Structural calculation report and foundation framing schedule conforming to seismic zone III standards, stamped by Class-I / Class-II Structural Engineer registered with CMDA / DTCP.',
    regulatoryCitation: 'TNCDBR-2019 Rule 11(5) & National Building Code (NBC 2016 Part 6)',
    acceptedFormats: 'PDF (SE Stamped Form II & III)'
  });

  checklist.push({
    idKey: 'SOIL_TEST_GEOTECH_REPORT',
    name: 'Geotechnical Soil Investigation & Safe Bearing Capacity (SBC) Report',
    category: 'Architectural & Engineering',
    isMandatory: true,
    description: 'Borehole log test report from certified geotechnical laboratory determining sub-soil stratification, water table, and allowable foundation bearing pressure.',
    regulatoryCitation: 'TNCDBR-2019 Rule 11(6) - Geotechnical Soil Investigation',
    acceptedFormats: 'PDF (Lab Certified Report)'
  });

  // 3. Conditional Statutory Clearances & NOCs
  if (osrRequired) {
    checklist.push({
      idKey: 'OSR_LAND_RESERVATION_DEED',
      name: 'Open Space Reservation (OSR) Gift Deed / Guideline Value Declaration',
      category: 'Statutory Planning Clearance',
      isMandatory: true,
      description: `Plot area exceeds 3,000 sq.m (${params.plotArea} sq.m). Under TNCDBR Rule 41, 10% OSR (${analysis.osrAreaSqM} sq.m) must be physically gifted to local body or equivalent guideline value remitted.`,
      regulatoryCitation: 'TNCDBR-2019 Rule 41 - Open Space Reservation (OSR)',
      acceptedFormats: 'PDF (Draft Gift Deed or Valuation Certificate)'
    });
  }

  if (fireNocRequired) {
    checklist.push({
      idKey: 'DFRS_FIRE_RESCUE_NOC',
      name: 'Directorate of Fire and Rescue Services (DFRS) Preliminary NOC',
      category: 'Statutory Safety Clearance',
      isMandatory: true,
      description: `Required for ${isHRB ? 'High-Rise Buildings (>18.30m)' : 'Commercial/Assembly buildings > 500 sq.m'}. Fire driveway access, external hydrant network, fire lifts, and dual egress staircase certification.`,
      regulatoryCitation: 'TNCDBR-2019 Rule 42 & Tamil Nadu Fire Service Act, 1985',
      acceptedFormats: 'PDF (DFRS Official Sealed NOC)'
    });
  }

  if (nearWaterBody) {
    checklist.push({
      idKey: 'PWD_WRD_INUNDATION_NOC',
      name: 'Water Resources Department (WRD / PWD) Inundation & Buffer NOC',
      category: 'Environmental & Waterbody Clearance',
      isMandatory: true,
      description: 'Site is located within 15m to 500m of a water body, river, tank, or drainage surplus channel. Requires Executive Engineer WRD clearance confirming non-inundation and buffer protection.',
      regulatoryCitation: 'Tamil Nadu Protection of Tanks and Eviction of Encroachment Act 2007 & TNCDBR Rule 19',
      acceptedFormats: 'PDF (WRD Executive Engineer Signed NOC)'
    });
  }

  if (nearAirport) {
    checklist.push({
      idKey: 'AAI_HEIGHT_CLEARANCE_NOC',
      name: 'Airports Authority of India (AAI) NOC for Height Clearance',
      category: 'Aviation Safety Clearance',
      isMandatory: true,
      description: 'Site falls within Obstacle Limitation Surfaces (OLS) funnel of Chennai/Tambaram/Coimbatore Airport. Requires NOCAS WGS-84 coordinate height clearance certificate.',
      regulatoryCitation: 'Ministry of Civil Aviation (GSR 751(E)) & TNCDBR Rule 22',
      acceptedFormats: 'PDF (AAI NOCAS Online Certificate)'
    });
  }

  if (abuttingHighway) {
    checklist.push({
      idKey: 'HIGHWAYS_NHAI_ACCESS_NOC',
      name: 'National Highways Authority (NHAI) / State Highways Department Access NOC',
      category: 'Roads & Infrastructure Clearance',
      isMandatory: true,
      description: 'Property abuts a designated State or National Highway. Verification of building line setback and approved geometric median access points.',
      regulatoryCitation: 'Tamil Nadu Highways Act 2001 & TNCDBR Rule 35',
      acceptedFormats: 'PDF (Highways Divisional Engineer NOC)'
    });
  }

  if (tnpcbRequired) {
    checklist.push({
      idKey: 'TNPCB_CONSENT_TO_ESTABLISH',
      name: 'TNPCB Consent to Establish (CTE) & Environmental Clearance (SEIAA)',
      category: 'Environmental Clearance',
      isMandatory: true,
      description: 'Total built-up area >= 20,000 sq.m or Industrial/Hospital category. Requires State Level Environment Impact Assessment Authority (SEIAA) clearance and TNPCB Water/Air CTE.',
      regulatoryCitation: 'EIA Notification 2006 & Water/Air Acts (TNPCB Standards)',
      acceptedFormats: 'PDF (SEIAA / TNPCB Certified Clearance)'
    });
  }

  if (reraRequired) {
    checklist.push({
      idKey: 'TNRERA_REGISTRATION_DECLARATION',
      name: 'TNRERA Form-A Affidavit & Registration Declaration',
      category: 'Consumer Protection Clearance',
      isMandatory: true,
      description: 'Real estate development with more than 8 dwelling units or land area exceeding 500 sq.m requires statutory undertaking for TNRERA registration prior to advertising or sale.',
      regulatoryCitation: 'Real Estate (Regulation and Development) Act 2016 (TNRERA Rules)',
      acceptedFormats: 'PDF (Notarized Affidavit Form-A)'
    });
  }

  if (projectType === 'Building Demolition') {
    checklist.push({
      idKey: 'DEMOLITION_SAFETY_UNDERTAKING',
      name: 'Demolition Methodology, Shoring Plan & Structural Demolition Undertaking',
      category: 'Safety & Site Operations',
      isMandatory: true,
      description: 'Structural safety sequence, barricading details, dust suppression measures, and debris disposal plan conforming to C&D Waste Management Rules.',
      regulatoryCitation: 'TNCDBR-2019 Rule 17 - Demolition of Buildings',
      acceptedFormats: 'PDF (Registered Structural Engineer Signed)'
    });
  }

  if (projectType === 'Revised Building Plan Approval') {
    checklist.push({
      idKey: 'PREVIOUS_PLANNING_PERMIT_COPY',
      name: 'Copy of Previously Sanctioned Planning Permission & Building Permit',
      category: 'Prior Sanction Records',
      isMandatory: true,
      description: 'Copy of previously sanctioned Planning Permit Order, approved drawing plan, and local body building license with expiry verification.',
      regulatoryCitation: 'TNCDBR-2019 Rule 28 - Revalidation & Revision of Permissions',
      acceptedFormats: 'PDF (Certified Copy)'
    });
  }

  return {
    analysis,
    checklist
  };
}

module.exports = {
  TN_DISTRICTS,
  TN_AUTHORITIES,
  evaluateTNCDBRClassification,
  generateTamilNaduChecklist
};
