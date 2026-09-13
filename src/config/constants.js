export const DEFAULT_BOSSES = [
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
  '가르투아',
  '사르바카',
  '미나사라',
  '브란트',
  '아그로',
  '카이라'
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
  { name: '가르투아 (12시간)', value: '가르투아' },
  { name: '사르바카 (12시간)', value: '사르바카' },
  { name: '미나사라 (12시간)', value: '미나사라' },
  { name: '브란트 (6시간)', value: '브란트' },
  { name: '아그로 (24시간)', value: '아그로' },
  { name: '카이라 (4시간)', value: '카이라' }
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
  2400855: '타르탄',
  2406990: '미나사라',
  2406991: '사르바카',
  2406132: '브란트',
  2600068: '아그로',
  2600089: '카이라'
};

export const BOSS_LOCATIONS = {
  '노블루드': { region: '알트가르드', location: '(44) 바스펠트 폐허 절벽' },
  '악시오스': { region: '알트가르드', location: '(44) 바스펠트 폐허 절벽' },
  '바르시엔': { region: '알트가르드', location: '(44) 바스펠트 폐허 절벽' },
  '카루카':   { region: '알트가르드', location: '(44) 바스펠트 폐허 절벽' },
  '구루타':   { region: '알트가르드', location: '(33) 마히샤의 둥지' },
  '쉬라크':   { region: '모르헤임',   location: '(13) 이탈시그 초소' },
  '비슈베다': { region: '알트가르드', location: '(14) 수색꾼 야영지' },
  '타르탄':   { region: '알트가르드', location: '(14) 수색꾼 야영지' },
  '카샤파':   { region: '알트가르드', location: '(28) 검은발톱 주둔지' },
  '가르투아': { region: '알트가르드', location: '(28) 검은발톱 주둔지' },
  '라그타':   { region: '알트가르드', location: '(28) 검은발톱 주둔지' },
  '사르바카': { region: '모르헤임',   location: '(19) 무스펠의 눈' },
  '미나사라': { region: '모르헤임',   location: '(11) 얼어붙은 골짜기' },
  '브란트':   { region: '모르헤임',   location: '(14) 수색꾼 야영지' },
  '아그로':   { region: '어비스 하층', location: '시엘의 날개 군도' },
  '카이라':   { region: '어비스 하층', location: '에레슈란타 하층' }
};

export const NOTMETER_ENDPOINTS = [
  'https://notmeter.59-27-108-81.sslip.io/field-boss/v1/public',
  'https://notmeter.59-27-108-81.nip.io/field-boss/v1/public',
  'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Cache/main/presence/notmeter-field-boss-public.json',
  'https://cdn.jsdelivr.net/gh/Not4You-Dev/NotMeter-Cache@main/presence/notmeter-field-boss-public.json'
];
