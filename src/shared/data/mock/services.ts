import {
  Hospital,
  GraduationCap,
  ShoppingBag,
  Building2,
  Stethoscope,
  Pill,
  Trees,
  Banknote,
  Store,
  ShieldCheck,
  Baby,
  Utensils,
  HelpCircle,
} from 'lucide-react';
import type { ServiceCategory, ServiceCategoryMeta, ServiceLocation } from '@/shared/types/service';

export const CATEGORY_META: Record<ServiceCategory, ServiceCategoryMeta> = {
  hospital:   { id: 'hospital',  label: 'Hospitals',      icon: Hospital,       color: '#e11d48', colorLight: '#ffe4e6' },
  clinic:     { id: 'clinic',    label: 'Clinics',         icon: Stethoscope,    color: '#0ea5e9', colorLight: '#e0f2fe' },
  pharmacy:   { id: 'pharmacy',  label: 'Pharmacies',     icon: Pill,           color: '#8b5cf6', colorLight: '#ede9fe' },
  school:     { id: 'school',    label: 'Schools',        icon: GraduationCap,  color: '#f59e0b', colorLight: '#fef3c7' },
  market:     { id: 'market',    label: 'Markets',         icon: ShoppingBag,    color: '#10b981', colorLight: '#d1fae5' },
  // Its own chip rather than a share of Markets: a mall is a destination people name and
  // go looking for, and folded into "Markets" it was findable only by accident.
  mall:       { id: 'mall',      label: 'Malls',           icon: Store,          color: '#c026d3', colorLight: '#fae8ff' },
  govt:       { id: 'govt',      label: 'Government',     icon: Building2,      color: '#6366f1', colorLight: '#e0e7ff' },
  park:       { id: 'park',      label: 'Parks',           icon: Trees,          color: '#22c55e', colorLight: '#dcfce7' },
  // Bronze, not teal-500. At #14b8a6 this sat one step from the reachable area's old
  // teal, so a bank dot over the area fill was all but invisible. Teal now belongs to
  // the user's own position and route, and no category may take it.
  bank:       { id: 'bank',      label: 'Banks & ATMs',    icon: Banknote,       color: '#a16207', colorLight: '#fef3c7' },
  police:     { id: 'police',    label: 'Police',          icon: ShieldCheck,    color: '#3b82f6', colorLight: '#dbeafe' },
  childcare:  { id: 'childcare', label: 'Childcare',       icon: Baby,           color: '#ec4899', colorLight: '#fce7f3' },
  food:       { id: 'food',       label: 'Food & Meals',    icon: Utensils,       color: '#f97316', colorLight: '#ffedd5' },
  other:      { id: 'other',      label: 'Other services', icon: HelpCircle,      color: '#64748b', colorLight: '#f1f5f9' },
};

export const CATEGORY_ORDER: ServiceCategory[] = [
  'hospital', 'clinic', 'pharmacy', 'school', 'market', 'mall', 'govt', 'park', 'bank', 'police', 'childcare', 'food',
  'other',
];

function svc(
  id: string, name: string, category: ServiceCategory, x: number, y: number,
  walkMin: number, transitMin: number, accessible: boolean, waitingMin: number, rating: number,
  address: string, hours: string,
): ServiceLocation {
  return { id, name, category, pos: { x, y }, walkMin, transitMin, accessible, waitingMin, rating, address, hours };
}

export const SERVICES: ServiceLocation[] = [
  svc('h1',  'Subang Medical Centre',     'hospital',  420, 380, 8,  12, true,  35, 4.3, 'Jalan SS12, Subang Jaya',        '24/7'),
  svc('h2',  'Bandar Utama Hospital',     'hospital',  620, 230, 14, 22, true,  50, 4.1, '1 Lebuh Bandar Utama',            '24/7'),
  svc('h3',  'Ara Damansara Hospital',    'hospital',  440, 440, 18, 28, false, 65, 3.8, 'Jalan PJU 1a',                    '6am–10pm'),
  svc('c1',  'Klinik SS15',               'clinic',    200, 530, 5,  8,  true,  15, 4.5, 'SS15/4, Subang Jaya',             '8am–9pm'),
  svc('c2',  'Klinik Mentari',            'clinic',    560, 300, 6,  10, true,  20, 4.2, 'Jalan PJS 8/5',                   '8am–10pm'),
  svc('c3',  'Klinik TTDI',               'clinic',    680, 200, 10, 15, true,  25, 4.4, 'Jalan Wan Kadir, TTDI',           '9am–9pm'),
  svc('c4',  'Klinik PJD',                'clinic',    360, 180, 12, 18, false, 30, 3.9, 'Jalan PJU 1/45',                  '9am–8pm'),
  svc('c5',  'Klinik Section 17',         'clinic',    260, 320, 7,  11, true,  18, 4.0, 'Jalan 17/1A',                     '8am–9pm'),
  svc('p1',  'Pharmacy SS15',             'pharmacy',  190, 535, 5,  7,  true,  5,  4.6, 'SS15/4B',                         '8am–11pm'),
  svc('p2',  'Pharmacy Mentari',          'pharmacy',  570, 295, 6,  9,  true,  8,  4.3, 'Jalan PJS 8/2',                   '8am–10pm'),
  svc('p3',  'Pharmacy BU',               'pharmacy',  610, 235, 14, 20, true,  12, 4.1, 'BU4, Bandar Utama',               '8am–11pm'),
  svc('p4',  'Pharmacy Section 14',        'pharmacy',  165, 275, 8,  12, true,  10, 4.2, 'Jalan 14/20',                     '8am–10pm'),
  svc('p5',  'Pharmacy Ara',              'pharmacy',  450, 435, 17, 25, false, 15, 3.7, 'Jalan PJU 1a/3',                  '9am–9pm'),
  svc('sc1', 'SMK SS19',                  'school',    280, 490, 9,  14, true,  0,  4.0, 'Jalan SS19/1',                    '7am–3pm'),
  svc('sc2', 'SMK Bandar Utama',           'school',    640, 250, 12, 18, true,  0,  3.9, 'Jalan BU 3/1',                    '7am–3pm'),
  svc('sc3', 'SK Subang Jaya',             'school',    150, 560, 7,  10, true,  0,  4.2, 'Jalan SS12/1',                    '7am–3pm'),
  svc('sc4', 'SK TTDI',                    'school',    700, 190, 11, 16, true,  0,  4.1, 'Jalan Burhanuddin Helmi',         '7am–3pm'),
  svc('sc5', 'SMK Section 17',             'school',    240, 330, 8,  12, true,  0,  3.8, 'Jalan 17/2',                      '7am–3pm'),
  svc('sc6', 'SK PJD',                     'school',    380, 160, 14, 20, false, 0,  3.7, 'Jalan PJU 1/41',                  '7am–3pm'),
  svc('m1',  'SS15 Market',                'market',    210, 525, 5,  8,  true,  0,  4.4, 'SS15/4A',                         '6am–10pm'),
  svc('m2',  'Bandar Utama Mall',          'market',    590, 245, 13, 19, true,  0,  4.5, '1 Lebuh Bandar Utama',            '10am–10pm'),
  svc('m3',  'Section 14 Market',          'market',    170, 280, 7,  11, true,  0,  4.0, 'Jalan 14/22',                     '6am–10pm'),
  svc('m4',  'TTDI Market',                'market',    690, 205, 10, 15, true,  0,  4.2, 'Jalan Wan Kadir 3',               '7am–10pm'),
  svc('m5',  'Ara Market',                 'market',    455, 430, 16, 24, false, 0,  3.6, 'Jalan PJU 1a/1',                  '7am–9pm'),
  svc('g1',  'JPJ Subang',                 'govt',      340, 460, 11, 16, true,  45, 3.5, 'Jalan Persiaran',                 '8am–5pm'),
  svc('g2',  'MBPJ City Hall',             'govt',      520, 360, 3,  5,  true,  60, 3.3, 'Jalan Yong Shuk Lin',             '8am–5pm'),
  svc('g3',  'Immigration PJD',            'govt',      400, 200, 13, 19, false, 55, 3.4, 'Jalan PJU 1/47',                  '8am–5pm'),
  svc('pk1','Subang Ria Park',             'park',      300, 580, 8,  12, true,  0,  4.6, 'Jalan SS13/1K',                   '6am–10pm'),
  svc('pk2','BU Central Park',             'park',      660, 270, 13, 19, true,  0,  4.5, 'Jalan BU 7/1',                    '6am–10pm'),
  svc('pk3','Section 17 Park',            'park',      230, 310, 7,  10, true,  0,  4.3, 'Jalan 17/14',                     '6am–10pm'),
  svc('pk4','TTDI Park',                   'park',      710, 185, 11, 16, true,  0,  4.4, 'Jalan Leong Yew Koh',             '6am–10pm'),
  svc('bk1','Maybank SS15',                'bank',      195, 530, 5,  7,  true,  10, 4.0, 'SS15/4C',                         '9am–4pm'),
  svc('bk2','CIMB Bandar Utama',           'bank',      605, 240, 13, 19, true,  12, 4.1, 'BU4 Ground Floor',                '9am–4pm'),
  svc('bk3','RHB Section 14',              'bank',      168, 278, 7,  11, true,  8,  3.9, 'Jalan 14/21',                     '9am–4pm'),
  svc('bk4','Public Bank TTDI',            'bank',      685, 200, 10, 15, true,  9,  4.0, 'Jalan Wan Kadir 5',               '9am–4pm'),
  svc('pc1','IPD Subang Jaya',             'police',    310, 510, 9,  13, true,  5,  4.2, 'Jalan USJ 1/1',                   '24/7'),
  svc('pc2','IPD Petaling Jaya',           'police',    490, 350, 4,  6,  true,  5,  4.3, 'Jalan Utara A',                   '24/7'),
  svc('pc3','IPD TTDI',                    'police',    675, 195, 11, 16, true,  5,  4.1, 'Jalan Burhanuddin Helmi 2',       '24/7'),
  svc('cc1','Taska Bonda',                 'childcare', 225, 515, 6,  9,  true,  0,  4.3, 'SS15/3B',                         '7am–7pm'),
  svc('cc2','Taska BU',                    'childcare', 615, 255, 13, 19, true,  0,  4.2, 'BU3/2',                           '7am–7pm'),
  svc('cc3','Taska Section 17',            'childcare', 255, 315, 8,  12, true,  0,  4.0, 'Jalan 17/8',                      '7am–7pm'),
  svc('f1', 'Restoran SS15',               'food',      205, 528, 5,  7,  true,  5,  4.4, 'SS15/4D',                         '7am–11pm'),
  svc('f2', 'Food Court BU',               'food',      595, 248, 13, 19, true, 8,  4.3, 'BU4 Level 2',                     '8am–10pm'),
  svc('f3', 'Mamak Section 14',             'food',      172, 282, 7,  11, true, 5,  4.5, 'Jalan 14/23',                     '24/7'),
  svc('f4', 'TTDI Food Street',            'food',      692, 202, 10, 15, true, 8,  4.6, 'Jalan Wan Kadir 7',               '7am–1am'),
  svc('f5', 'Ara Food Court',              'food',      458, 432, 16, 24, false, 12, 3.8, 'Jalan PJU 1a/5',                  '8am–10pm'),
];
