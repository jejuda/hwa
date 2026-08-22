export const DEFAULT_11_BOSSES = [
  '노블루드',
  '악시오스',
  '바르시엔',
  '구루타',
  '카루카',
  '비슈베다',
  '쉬라크',
  '타르탄',
  '카샤파',
  '라그타',
  '가르투아'
];

export const BOSS_CHOICES = [
  { name: '노블루드 (4시간)', value: '노블루드' },
  { name: '악시오스 (4시간)', value: '악시오스' },
  { name: '바르시엔 (4시간)', value: '바르시엔' },
  { name: '구루타 (6시간)', value: '구루타' },
  { name: '카루카 (4시간)', value: '카루카' },
  { name: '비슈베다 (6시간)', value: '비슈베다' },
  { name: '쉬라크 (6시간)', value: '쉬라크' },
  { name: '타르탄 (6시간)', value: '타르탄' },
  { name: '카샤파 (6시간)', value: '카샤파' },
  { name: '라그타 (12시간)', value: '라그타' },
  { name: '가르투아 (12시간)', value: '가르투아' }
];

export const NOTMETER_BOSS_MAP = {
  2400424: '노블루드',
  2400425: '악시오스',
  2400504: '바르시엔',
  2400593: '구루타',
  2400608: '카루카',
  2400659: '비슈베다',
  2400709: '쉬라크',
  2400800: '가르투아',
  2400853: '라그타',
  2400854: '카샤파',
  2400855: '타르탄'
};

export const NOTMETER_ENDPOINTS = [
  'https://notmeter.112-168-140-142.sslip.io/field-boss/v1/public',
  'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Update/main/presence/notmeter-field-boss-public.json',
  'https://cdn.jsdelivr.net/gh/Not4You-Dev/NotMeter-Update@main/presence/notmeter-field-boss-public.json'
];
