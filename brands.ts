// Brands and their branches for the field-operations hierarchy
// (Branch Employee / Branch Manager / Area Manager / Operation Manager).
// A branch is always identified by the (brand, branch) pair — the same
// branch name may exist under several brands.

export const BRANDS: Record<string, string[]> = {
  YELO: [
    'Adailiya', 'Khairan', 'Jaber Al-Ahmad', 'Sabah Al-Salem', 'Vibes',
    'Qortuba', 'Dahiya Abdullah', 'Fahaheel', 'Jleeb Al-Shuyo', 'Egaila',
    'Salmiya', 'Jabriya', 'Ishbiliya', 'Sabah Al Ahmad', 'Ardiya',
    'Midan Hawally', 'Jahra', 'Salwa', 'Zahra', 'Saad Al-Abdallah',
    'Qurain', 'Andalous', 'Bayan',
  ],
  SHAKIR: [
    'Rai', 'Qurain', 'Salmiya', 'City', 'Jahra', 'Ardiya', 'Egaila',
    'Hawally', 'Sabah Al Ahmed', 'Bayan',
  ],
  BBT: [
    'Shamiya', 'Hilltop', 'Yard (Vibes)', 'Salmiya', 'Ardiya', 'Adailiya',
    'Shuhada', 'Mangaf', 'Saad Al-Abdallah', 'Sabah Al-Ahmed', 'Bayan',
    'Khairan', 'Um Al Hyman',
  ],
  SLICE: [
    'Mishref', 'City', 'Yard Mall', 'Adailiya', 'Ardiya', 'Jahra', 'Salmiya',
  ],
  PATTIE: [
    'Adailiya', 'Mishref', 'Ardiya', 'Jahra', 'Salmiya', 'Yard', 'Hawally',
  ],
  'JUST C': ['Qortuba', 'Yard'],
  CHILI: ['Qortuba', 'Yard', 'Hawally'],
  MISHMASH: [
    'Ardiya', 'Kaifan', 'Mahboula', 'Jabriya', 'S-Salem', 'S-Abdallah',
    'Salmiya', 'Khaitan', 'Mangaf', 'W-Abdullah', 'Salwa', 'Qadsiya',
    'Qurain', 'Khairan',
  ],
  TABLE: [
    'Ardiya', 'Qortuba', 'Hawally', 'Sabah Al-Salem', 'Salmiya',
    'Bneid Al Qar', 'Mahboula', 'Jahra', 'East-Ahmadi', 'Khairan',
  ],
  FM: ['Yard', 'City', 'Hawally', 'Khaitan'],
};

export const BRAND_NAMES = Object.keys(BRANDS);
