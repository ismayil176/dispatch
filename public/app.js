const SAMPLE_ROUTE = 'VRMM MUNUT1A MUNUT R329 ANODA UL425 ODOLI A474 BBB G208 APANO G451 AAE Z8 POVOS R462 KE B210 NH G326 LUBNA DCT 2925N06959E DCT HILAL G202 ZB L750 RANAH B449 ETRAP B447 KRS B143 TUNEK A909 RODAR M11 AMOKU AMOKU1G UBBB';
const PDFJS_VERSION = '5.5.207';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const TOKEN_OVERRIDES_URL = './data/token_overrides.json';
const COUNTRY_GEO_URL = './data/countries.min.json';
const NAV_BUCKET_BASE = './data/nav';
const OCR_CACHE_PREFIX = 'azal-notam-ocr-v11:';
const PAGE_MARKER_PREFIX = '<<PAGE:';

const AIRPORT_PREFIX_COUNTRIES = {
  UB: { code: 'AZ', name: 'Azerbaijan' },
  UG: { code: 'GE', name: 'Georgia' },
  LT: { code: 'TR', name: 'Turkey' },
  LC: { code: 'CY', name: 'Cyprus' },
  LL: { code: 'IL', name: 'Israel' },
  OL: { code: 'LB', name: 'Lebanon' },
  OS: { code: 'SY', name: 'Syria' },
  OJ: { code: 'JO', name: 'Jordan' },
  OR: { code: 'IQ', name: 'Iraq' },
  OI: { code: 'IR', name: 'Iran' },
  OP: { code: 'PK', name: 'Pakistan' },
  VI: { code: 'IN', name: 'India' },
  VE: { code: 'IN', name: 'India' },
  VG: { code: 'BD', name: 'Bangladesh' },
  VQ: { code: 'BT', name: 'Bhutan' },
  ZB: { code: 'CN', name: 'China' },
  ZG: { code: 'CN', name: 'China' },
  ZH: { code: 'CN', name: 'China' },
  ZJ: { code: 'CN', name: 'China' },
  ZL: { code: 'CN', name: 'China' },
  ZP: { code: 'CN', name: 'China' },
  ZS: { code: 'CN', name: 'China' },
  ZU: { code: 'CN', name: 'China' },
  ZW: { code: 'CN', name: 'China' },
  ZY: { code: 'CN', name: 'China' }
};

const COUNTRY_CODE_NAMES = {
  AF: 'Afghanistan',
  AZ: 'Azerbaijan',
  BD: 'Bangladesh',
  BT: 'Bhutan',
  CN: 'China',
  CY: 'Cyprus',
  EE: 'Estonia',
  GE: 'Georgia',
  GR: 'Greece',
  IL: 'Israel',
  IN: 'India',
  IQ: 'Iraq',
  IR: 'Iran',
  JO: 'Jordan',
  KZ: 'Kazakhstan',
  LB: 'Lebanon',
  MV: 'Maldives',
  PK: 'Pakistan',
  RU: 'Russia',
  SY: 'Syria',
  TM: 'Turkmenistan',
  TR: 'Turkey',
  ZM: 'Zambia'
};

const OCR_CHAR_EQUIV = {
  '0': '[0OQ@]',
  '1': '[1IL]',
  '2': '[2Z]',
  '5': '[5S]',
  '6': '[6G]',
  '8': '[8B]',
  A: 'A',
  B: '[B8]',
  C: 'C',
  D: 'D',
  E: 'E',
  F: 'F',
  G: '[G6]',
  H: 'H',
  I: '[I1L]',
  J: 'J',
  K: 'K',
  L: '[L1I]',
  M: 'M',
  N: 'N',
  O: '[O0Q@]',
  P: 'P',
  Q: '[Q0O@]',
  R: 'R',
  S: '[S5]',
  T: 'T',
  U: 'U',
  V: 'V',
  W: 'W',
  X: 'X',
  Y: 'Y',
  Z: '[Z2]',
  '@': '[0OQ@]'
};

let el = null;

const state = {
  pdfjs: null,
  ocrWorker: null,
  tokenOverrides: null,
  countriesGeo: null,
  countryPointCache: new Map(),
  navBuckets: new Map(),
  currentFile: null,
  booted: false
};

function getElements() {
  return {
    pdfFile: document.getElementById('pdfFile'),
    fileMeta: document.getElementById('fileMeta'),
    statusText: document.getElementById('statusText'),
    progressFill: document.getElementById('progressFill'),
    routesInput: document.getElementById('routesInput'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    sampleBtn: document.getElementById('sampleBtn'),
    clearBtn: document.getElementById('clearBtn'),
    results: document.getElementById('results')
  };
}

function ensureElementsReady() {
  if (el) return el;
  const refs = getElements();
  const missing = Object.entries(refs)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`DOM elementleri tapilmadi: ${missing.join(', ')}`);
  }

  el = refs;
  return el;
}

function setStatus(text, progress = null) {
  if (!el) return;
  if (el.statusText) {
    el.statusText.textContent = text;
  }
  if (typeof progress === 'number' && el.progressFill) {
    const safe = Math.max(0, Math.min(100, progress));
    el.progressFill.style.width = `${safe}%`;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' }[char]));
}

function normalizeRouteLine(line) {
  return String(line || '')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function routeLinesFromInput(value) {
  return String(value || '')
    .split(/\n+/)
    .map(normalizeRouteLine)
    .filter(Boolean);
}

function removeFlightLevelSuffix(token) {
  return String(token || '').split('/')[0].trim();
}

function cleanToken(token) {
  return removeFlightLevelSuffix(token).replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
}

function isAirway(token) {
  return /^(?:[A-Z]{0,2}\d{1,3}[A-Z]?|J\d{1,3}|V\d{1,3}|UL\d{1,3}|UM\d{1,3}|UN\d{1,3}|UP\d{1,3}|UT\d{1,3})$/.test(token);
}

function isProcedure(token) {
  return /^[A-Z]{3,6}\d{1,2}[A-Z]$/.test(token);
}

function isIgnorableToken(token) {
  return !token || token === 'DCT' || token === 'DIRECT' || /^N\d{4}F\d{3}$/.test(token);
}

function parseRoute(routeText) {
  const normalized = normalizeRouteLine(routeText);
  const rawTokens = normalized.split(' ').map(cleanToken).filter(Boolean);
  const tokens = rawTokens.filter((token) => !isIgnorableToken(token));
  const points = [];
  const airways = [];
  const legs = [];

  let currentPoint = null;
  let pendingAirways = [];

  tokens.forEach((token) => {
    if (isProcedure(token)) return;
    if (isAirway(token)) {
      airways.push(token);
      if (currentPoint) pendingAirways.push(token);
      return;
    }

    points.push(token);
    if (!currentPoint) {
      currentPoint = token;
      return;
    }

    legs.push({
      from: currentPoint,
      to: token,
      airways: [...pendingAirways]
    });
    currentPoint = token;
    pendingAirways = [];
  });

  return {
    raw: routeText,
    normalized,
    tokens,
    points,
    airways: Array.from(new Set(airways)),
    legs
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fuzzyCharPattern(char, strictAlpha = false) {
  if (strictAlpha) {
    if (char === 'O' || char === 'Q') return '[O0Q@]';
    return escapeRegExp(char);
  }
  return OCR_CHAR_EQUIV[char] || escapeRegExp(char);
}

function flexibleTokenPattern(token) {
  const strictAlpha = /^[A-Z]{3,5}$/.test(String(token || ''));
  return String(token)
    .split('')
    .map((char) => fuzzyCharPattern(char, strictAlpha))
    .join('[\\s\\-_/,:;()]{0,3}');
}

function makeTokenRegex(token) {
  return new RegExp(`(^|[^A-Z0-9])(${flexibleTokenPattern(token)})(?=[^A-Z0-9]|$)`, 'i');
}

function makeLegRegex(leg) {
  const from = flexibleTokenPattern(leg.from);
  const to = flexibleTokenPattern(leg.to);
  const airwayPart = leg.airways.length ? `${leg.airways.map(flexibleTokenPattern).join('[^A-Z0-9]{0,12}')}[^A-Z0-9]{0,18}` : '';
  return new RegExp(`(?:${airwayPart})?(?:${from}[^A-Z0-9]{0,8}${to}|${to}[^A-Z0-9]{0,8}${from})`, 'i');
}

function repairOcrTokenArtifacts(token, aggressive = false) {
  let value = String(token || '');
  if (!value) return value;

  value = value
    .replace(/[＠]/g, '@')
    .replace(/[ÒÓÕÖØ]/g, 'O')
    .replace(/[İ|]/g, 'I');

  if (aggressive || /\d/.test(value)) {
    value = value
      .replace(/@/g, '0')
      .replace(/(?<=\d)[QO](?=\d)/g, '0')
      .replace(/(?<=\d)[IL](?=\d)/g, '1')
      .replace(/(?<=\d)S(?=\d)/g, '5')
      .replace(/(?<=\d)B(?=\d)/g, '8')
      .replace(/(?<=\d)G(?=\d)/g, '6');
  }

  if (aggressive || /[A-Z]/.test(value)) {
    value = value
      .replace(/(?<=[A-Z])0(?=[A-Z])/g, 'O')
      .replace(/(?<=[A-Z])1(?=[A-Z])/g, 'I')
      .replace(/(?<=[A-Z])8(?=[A-Z])/g, 'B')
      .replace(/(?<=[A-Z])6(?=[A-Z])/g, 'G');
  }

  return value;
}

function repairOcrArtifacts(text, aggressive = false) {
  return String(text || '').replace(/\b[A-Z0-9@]{2,}\b/g, (token) => repairOcrTokenArtifacts(token, aggressive));
}

function normalizeOcrText(text) {
  return repairOcrArtifacts(
    String(text || '')
      .replace(/\(cid:\d+\)/gi, ' ')
      .replace(/\r/g, '\n')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/[\u0000-\u001F\u007F-\u009F\uFFFDÿ]/g, ' ')
      .replace(/[•·▪■□▲△▼▽◆◇]/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
    false
  );
}

function normalizeSnippetText(text) {
  return repairOcrArtifacts(normalizeOcrText(text), true)
    .replace(/@/g, '0')
    .replace(/\bNR\.0/gi, 'NR.0')
    .replace(/\b([A-Z]\d)0(?=\d\/\d{2}\b)/g, '$10')
    .replace(/\b[QO][I1L](?=(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4}\b)/g, '01')
    .replace(/\bAIP\s+CHINA\s+WEBSITE\b/gi, 'AIP CHINA WEBSITE')
    .replace(/[^\x0A\x20-\x7E]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function normalizeForSearch(text) {
  return repairOcrArtifacts(normalizeOcrText(text), true)
    .toUpperCase()
    .replace(/[^A-Z0-9\n/ .,:;()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTextQuality(text) {
  const raw = String(text || '');
  const normalized = normalizeSnippetText(raw);
  if (!normalized) return { score: 0, normalized };

  const controlPenalty = (raw.match(/[\u0000-\u001F\u007F-\u009F]/g) || []).length * 3;
  const weirdPenalty = (raw.match(/[�ÿ]/g) || []).length * 4;
  const notamHits = (normalized.match(/\b[A-Z]{4}\s+[A-Z]\d{4}\/\d{2}\b/g) || []).length;
  const routeHits = (normalized.match(/\b(?:ATS RTE|ATS ROUTES|AIRWAY|WAYPOINT|SEGMENT|CLSD|CHANGED TO|ADJUSTED AS FLW|VOR|NDB|DME|RNAV)\b/g) || []).length;
  const tokenHits = (normalized.match(/\b[A-Z]{2,5}\d{0,3}[A-Z]?\b/g) || []).length;
  const longWords = (normalized.match(/\b[A-Z]{3,}\b/g) || []).length;
  const printableRatio = normalized.replace(/\s/g, '').length / Math.max(1, raw.length);

  const score = (notamHits * 80) + (routeHits * 18) + (tokenHits * 1.5) + (longWords * 0.8) + (printableRatio * 20) - controlPenalty - weirdPenalty;
  return { score, normalized };
}

function looksUsefulExtractedText(text) {
  const { score, normalized } = scoreTextQuality(text);
  return normalized.length >= 120 && score >= 120;
}


function makeDisplayText(text) {
  const lines = normalizeSnippetText(text).toUpperCase()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^<<PAGE:\d+>>$/i.test(line));

  return lines.join('\n').trim();
}

function makeSnippet(text) {
  return makeDisplayText(text)
    .split('\n')
    .slice(0, 18)
    .join('\n')
    .slice(0, 1400);
}

function makeBlockFingerprint(text) {
  return normalizeForSearch(text)
    .replace(/\b(?:RECENT|RULE)\b/g, ' ')
    .replace(/\b[A-Z]{4}(?:\s+[A-Z]{4}){0,3}\s+[A-Z]\d{4}\/\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2400);
}

function extractNoticeId(text) {
  const match = normalizeForSearch(text).match(/\b([A-Z]{4}(?:\s+[A-Z]{4}){0,3}\s+[A-Z]\d{4}\/\d{2})\b/);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function canonicalNoticeKey(noticeId) {
  return normalizeForSearch(noticeId)
    .replace(/[OQ@]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMergeText(text) {
  return repairOcrArtifacts(
    String(text || '')
      .replace(/\(cid:\d+\)/gi, ' ')
      .replace(/\r/g, '\n')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFDÿ]/g, ' ')
      .replace(/[•·▪■□▲△▼▽◆◇]/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
    true
  );
}

function normalizedLines(text) {
  return normalizeMergeText(text)
    .toUpperCase()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^<<PAGE:\d+>>$/i.test(line));
}

function normalizeLineKey(line) {
  return normalizeForSearch(line).replace(/\s+/g, ' ').trim();
}

function mergeNoticeTexts(existingText, candidateText) {
  const existingLines = normalizedLines(existingText);
  const candidateLines = normalizedLines(candidateText);

  if (!existingLines.length) return makeDisplayText(candidateText);
  if (!candidateLines.length) return makeDisplayText(existingText);

  const existingKeys = existingLines.map(normalizeLineKey);
  const candidateKeys = candidateLines.map(normalizeLineKey);
  const existingJoined = existingKeys.join('\n');
  const candidateJoined = candidateKeys.join('\n');

  if (existingJoined.includes(candidateJoined)) return existingLines.join('\n');
  if (candidateJoined.includes(existingJoined)) return candidateLines.join('\n');

  let overlap = 0;
  const maxOverlap = Math.min(existingKeys.length, candidateKeys.length);
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const left = existingKeys.slice(-size).join('\n');
    const right = candidateKeys.slice(0, size).join('\n');
    if (left && left === right) {
      overlap = size;
      break;
    }
  }

  if (overlap > 0) {
    return [...existingLines, ...candidateLines.slice(overlap)].join('\n').trim();
  }

  const seen = new Set(existingKeys);
  const appended = candidateLines.filter((line, index) => {
    const key = candidateKeys[index];
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...existingLines, ...appended].join('\n').trim();
}

function sharedLineCount(a, b) {
  const aKeys = new Set(normalizedLines(a).map(normalizeLineKey).filter(Boolean));
  const bKeys = new Set(normalizedLines(b).map(normalizeLineKey).filter(Boolean));
  if (!aKeys.size || !bKeys.size) return 0;
  let count = 0;
  aKeys.forEach((key) => {
    if (bKeys.has(key)) count += 1;
  });
  return count;
}

function shouldMergeBlocks(current, next) {
  if (!current || !next) return false;
  const currentEnd = current.endPage || current.page || 1;
  const nextStart = next.startPage || next.page || 1;
  if (nextStart > currentEnd + 1) return false;

  if (current.noticeKey && next.noticeKey) {
    return current.noticeKey === next.noticeKey;
  }

  if (current.noticeKey || next.noticeKey) {
    const overlapLines = sharedLineCount(current.text, next.text);
    return overlapLines >= 2;
  }

  return false;
}

function mergeNeighborBlocks(blocks) {
  if (!blocks.length) return blocks;
  const merged = [];

  blocks.forEach((block) => {
    const current = {
      ...block,
      noticeKey: block.noticeKey || canonicalNoticeKey(block.noticeId)
    };
    const last = merged[merged.length - 1];

    if (!last || !shouldMergeBlocks(last, current)) {
      merged.push(current);
      return;
    }

    last.startPage = Math.min(last.startPage || last.page || 1, current.startPage || current.page || 1);
    last.endPage = Math.max(last.endPage || last.page || 1, current.endPage || current.page || 1);
    last.page = Math.min(last.page || last.startPage || 1, current.page || current.startPage || 1);
    last.noticeId = last.noticeId || current.noticeId;
    last.noticeKey = last.noticeKey || current.noticeKey;
    last.text = mergeNoticeTexts(last.text, current.text);
    last.displayText = makeDisplayText(last.text);
    last.search = normalizeForSearch(last.text);
    last.fingerprint = makeBlockFingerprint(last.text);
  });

  return merged.map((block, index) => ({
    ...block,
    id: `b${index + 1}`,
    displayText: makeDisplayText(block.text),
    search: normalizeForSearch(block.text),
    fingerprint: makeBlockFingerprint(block.text),
    noticeKey: block.noticeKey || canonicalNoticeKey(block.noticeId)
  }));
}


function extractBlocksFromPages(pages) {
  const blocks = [];
  const boundaryRe = /(?=\*RECENT\*|\*RULE\*|(?:^|[^A-Z0-9])(?:[A-Z]{4}(?:\s+[A-Z]{4}){0,3})\s+[A-Z]\d{4}\/\d{2}\b)/g;
  const routeKeywords = /(ATS RTE|ATS ROUTES|AIRWAY|AIRWAYS|WAYPOINT|WAYPOINTS|ENTRY\/EXIT|SEGMENT|SEGMENTS|UNAVBL|NOT AVBL|UNSERVICEABLE|U\/S|CLSD|CLOSED|RESTRICTED|PROHIBITED|AVBL|NOT AVAILABLE|OUT OF SERVICE|LIMITED|ADVISED TO USE|VOR|VOR\/DME|DME|NDB|FIX|RNAV|SID|STAR|AUP|TSA|TRA|DUE TO OPS|BTN|CHANGED TO|ADJUSTED AS FLW)/;

  const documentText = pages
    .map((pageText, index) => `${PAGE_MARKER_PREFIX}${index + 1}>>\n${normalizeSnippetText(pageText)}`)
    .join('\n\n');

  const parts = documentText.split(boundaryRe).map((item) => item.trim()).filter(Boolean);

  parts.forEach((part) => {
    const pageMatches = Array.from(part.matchAll(/<<PAGE:(\d+)>>/gi)).map((match) => Number(match[1]));
    const startPage = pageMatches[0] || 1;
    const endPage = pageMatches[pageMatches.length - 1] || startPage;
    const trimmed = part
      .replace(/<<PAGE:\d+>>/gi, ' ')
      .replace(/\nNNNN[\s\S]*$/i, '')
      .trim();

    const search = normalizeForSearch(trimmed);
    if (!search || search.length < 20) return;
    if (!routeKeywords.test(search)) return;
    if (/CHECKLIST/.test(search) && !routeKeywords.test(search.replace(/CHECKLIST/g, ''))) return;
    if (/LATEST PUBLICATIONS|AIP AIRAC|AIP AMDT|AIP SUP/.test(search) && !/ATS RTE|ATS ROUTES|WAYPOINT|SEGMENT|ENTRY\/EXIT|UNAVBL|NOT AVBL|CLSD|CLOSED|RESTRICTED|CHANGED TO|ADJUSTED AS FLW/.test(search)) {
      return;
    }

    blocks.push({
      id: `b${blocks.length + 1}`,
      page: startPage,
      startPage,
      endPage,
      text: trimmed,
      displayText: makeDisplayText(trimmed),
      search,
      noticeId: extractNoticeId(trimmed),
      fingerprint: makeBlockFingerprint(trimmed)
    });
  });

  return mergeNeighborBlocks(blocks);
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hitLabelsFromMatches(matchedLegs, matchedAirways, matchedPoints) {
  const labels = [];
  const segmentPointSet = new Set();

  matchedLegs.forEach((item) => {
    if (item.leg.airways.length) {
      item.leg.airways.forEach((airway) => labels.push(airway));
    }
    labels.push(`${item.leg.from}-${item.leg.to}`);
    segmentPointSet.add(item.leg.from);
    segmentPointSet.add(item.leg.to);
  });

  matchedAirways.forEach((item) => labels.push(item.token));
  matchedPoints.forEach((item) => {
    if (!segmentPointSet.has(item.token) || (!matchedLegs.length && !matchedAirways.length)) {
      labels.push(item.token);
    }
  });

  return uniqueValues(labels).slice(0, 8);
}


function analyzeRoute(blocks, route) {
  const pointTokens = route.points.filter((token) => token.length >= 2);
  const pointRegexes = pointTokens.map((token) => ({ token, regex: makeTokenRegex(token) }));
  const airwayRegexes = route.airways.map((token) => ({ token, regex: makeTokenRegex(token) }));
  const legRegexes = route.legs.map((leg) => ({ leg, regex: makeLegRegex(leg) }));
  const routeKeywords = /(ATS RTE|ATS ROUTES|AIRWAY|AIRWAYS|WAYPOINT|WAYPOINTS|ENTRY\/EXIT|SEGMENT|SEGMENTS|UNAVBL|NOT AVBL|UNSERVICEABLE|U\/S|CLSD|CLOSED|RESTRICTED|PROHIBITED|FORBIDDEN|AVBL|NOT AVAILABLE|OUT OF SERVICE|LIMITED|ADVISED TO USE|VOR|VOR\/DME|DME|NDB|FIX|RNAV|SID|STAR|AUP|TSA|TRA|ACT|DUE TO OPS|BTN|CHANGED TO|ADJUSTED AS FLW)/;

  const grouped = new Map();

  for (const block of blocks) {
    const matchedLegs = legRegexes.filter((item) => item.regex.test(block.search));
    const matchedPoints = pointRegexes.filter((item) => item.regex.test(block.search));
    const matchedAirways = airwayRegexes.filter((item) => item.regex.test(block.search));

    const positive =
      matchedLegs.length > 0 ||
      matchedAirways.length > 0 ||
      matchedPoints.length >= 2 ||
      (matchedPoints.length >= 1 && routeKeywords.test(block.search));

    if (!positive) continue;

    const labels = hitLabelsFromMatches(matchedLegs, matchedAirways, matchedPoints);
    if (!labels.length) continue;

    const groupKey = block.noticeKey || canonicalNoticeKey(block.noticeId) || block.fingerprint || `${block.page}|${makeSnippet(block.text).slice(0, 260)}`;
    const existing = grouped.get(groupKey);

    if (!existing) {
      grouped.set(groupKey, {
        page: block.startPage || block.page,
        startPage: block.startPage || block.page,
        endPage: block.endPage || block.page,
        noticeId: block.noticeId,
        labels: [...labels],
        points: uniqueValues(matchedPoints.map((item) => item.token)),
        airways: uniqueValues(matchedAirways.map((item) => item.token)),
        segments: uniqueValues(matchedLegs.map((item) => `${item.leg.from}-${item.leg.to}`)),
        text: block.displayText || makeDisplayText(block.text)
      });
      continue;
    }

    existing.startPage = Math.min(existing.startPage, block.startPage || block.page);
    existing.endPage = Math.max(existing.endPage, block.endPage || block.page);
    existing.page = Math.min(existing.page, block.startPage || block.page);
    existing.labels = uniqueValues([...existing.labels, ...labels]);
    existing.points = uniqueValues([...existing.points, ...matchedPoints.map((item) => item.token)]);
    existing.airways = uniqueValues([...existing.airways, ...matchedAirways.map((item) => item.token)]);
    existing.segments = uniqueValues([...existing.segments, ...matchedLegs.map((item) => `${item.leg.from}-${item.leg.to}`)]);

    const candidateText = block.displayText || makeDisplayText(block.text);
    existing.text = mergeNoticeTexts(existing.text || '', candidateText);
  }

  const items = Array.from(grouped.values())
    .sort((a, b) => a.startPage - b.startPage || (a.noticeId || '').localeCompare(b.noticeId || ''));

  return {
    hasNotam: items.length > 0,
    items,
    matchedRouteItems: uniqueValues(items.flatMap((item) => item.labels))
  };
}

async function loadPdfJs() {
  if (!state.pdfjs) {
    state.pdfjs = import(PDFJS_URL).then((module) => {
      module.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return module;
    });
  }
  return state.pdfjs;
}

async function sha256Hex(file) {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function ensureWorker() {
  if (state.ocrWorker) return state.ocrWorker;
  if (!window.Tesseract) {
    throw new Error('OCR kitabxanasi yuklenmedi.');
  }

  const worker = await window.Tesseract.createWorker('eng');
  if (typeof worker.setParameters === 'function') {
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1'
    });
  }

  state.ocrWorker = worker;
  return worker;
}

function makeCanvasFromViewport(viewport) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  return canvas;
}

async function quickExtractPages(pdf) {
  const pages = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const lines = [];
    let currentLine = [];
    let currentY = null;

    for (const item of content.items) {
      const textItem = 'str' in item ? item.str : '';
      if (!textItem) continue;
      const y = Math.round((item.transform?.[5] || 0) * 10) / 10;

      if (currentY != null && Math.abs(y - currentY) > 2.5) {
        lines.push(currentLine.join(' ').trim());
        currentLine = [];
      }

      currentLine.push(textItem);
      currentY = y;
    }

    if (currentLine.length) {
      lines.push(currentLine.join(' ').trim());
    }

    pages.push(normalizeOcrText(lines.filter(Boolean).join('\n')));
  }
  return pages;
}

function chooseBetterPageText(extractedText, ocrText) {
  const quick = scoreTextQuality(extractedText);
  const ocr = scoreTextQuality(ocrText);
  if (!quick.normalized && ocr.normalized) return normalizeSnippetText(ocrText);
  if (!ocr.normalized && quick.normalized) return normalizeSnippetText(extractedText);
  if (ocr.score > quick.score + 20) return normalizeSnippetText(ocrText);
  return normalizeSnippetText(extractedText || ocrText);
}

async function ocrPdfPages(pdf, pageNumbers, onProgress) {
  const worker = await ensureWorker();
  const pageMap = new Map();

  for (let index = 0; index < pageNumbers.length; index += 1) {
    const pageNo = pageNumbers[index];
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = makeCanvasFromViewport(viewport);
    const context = canvas.getContext('2d', { alpha: false });

    await page.render({ canvasContext: context, viewport }).promise;
    onProgress(index + 1, pageNumbers.length, pageNo);

    const result = await worker.recognize(canvas);
    pageMap.set(pageNo, normalizeOcrText(result?.data?.text || ''));

    canvas.width = 1;
    canvas.height = 1;
  }

  return pageMap;
}


async function parseFlightPlanPdf(file) {
  if (!file) throw new Error('Evvelce PDF yukle.');

  const hash = await sha256Hex(file);
  const cacheKey = `${OCR_CACHE_PREFIX}${hash}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const data = JSON.parse(cached);
    setStatus(`Cache istifade olundu: ${file.name}`, 100);
    return data;
  }

  setStatus('PDF acilir...', 5);
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  setStatus('Metn qati yoxlanilir...', 10);
  const quickPages = await quickExtractPages(pdf);
  const mergedPages = new Array(pdf.numPages).fill('');
  const weakPageNumbers = [];

  quickPages.forEach((pageText, index) => {
    if (looksUsefulExtractedText(pageText)) {
      mergedPages[index] = normalizeSnippetText(pageText);
    } else {
      weakPageNumbers.push(index + 1);
    }
  });

  if (weakPageNumbers.length) {
    setStatus(`OCR basladi: 0 / ${weakPageNumbers.length}`, 14);
    const ocrPages = await ocrPdfPages(pdf, weakPageNumbers, (current, total, pageNo) => {
      const progress = 14 + (current / Math.max(1, total)) * 78;
      setStatus(`OCR edilir: ${current} / ${total} (sehife ${pageNo})`, progress);
    });

    weakPageNumbers.forEach((pageNo) => {
      const quickText = quickPages[pageNo - 1] || '';
      const ocrText = ocrPages.get(pageNo) || '';
      mergedPages[pageNo - 1] = chooseBetterPageText(quickText, ocrText);
    });
  }

  for (let index = 0; index < mergedPages.length; index += 1) {
    if (!mergedPages[index]) {
      mergedPages[index] = normalizeSnippetText(quickPages[index] || '');
    }
  }

  const data = {
    hash,
    pageCount: pdf.numPages,
    pages: mergedPages,
    blocks: extractBlocksFromPages(mergedPages)
  };

  localStorage.setItem(cacheKey, JSON.stringify(data));
  setStatus('PDF hazirdir.', 100);
  return data;
}

async function loadTokenOverrides() {
  if (!state.tokenOverrides) {
    state.tokenOverrides = fetch(TOKEN_OVERRIDES_URL).then((res) => res.json());
  }
  return state.tokenOverrides;
}

async function loadCountryGeometries() {
  if (!state.countriesGeo) {
    state.countriesGeo = fetch(COUNTRY_GEO_URL).then((res) => (res.ok ? res.json() : []));
  }
  return state.countriesGeo;
}

function pointInLinearRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < (((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonContainsPoint(lat, lon, polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return false;
  if (!pointInLinearRing(lat, lon, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInLinearRing(lat, lon, polygon[i])) return false;
  }
  return true;
}

function geometryContainsPoint(feature, lat, lon) {
  if (!feature || !feature.type || !feature.geometry) return false;
  if (feature.type === 'Polygon') {
    return polygonContainsPoint(lat, lon, feature.geometry);
  }
  if (feature.type === 'MultiPolygon') {
    return feature.geometry.some((polygon) => polygonContainsPoint(lat, lon, polygon));
  }
  return false;
}

async function lookupCountryByPoint(lat, lon) {
  if (lat == null || lon == null) return null;

  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}`;
  if (state.countryPointCache.has(key)) {
    return state.countryPointCache.get(key);
  }

  const features = await loadCountryGeometries();
  let match = null;

  for (const feature of features) {
    const [minLon, minLat, maxLon, maxLat] = feature.bbox || [];
    if (minLon == null || minLat == null || maxLon == null || maxLat == null) continue;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    if (!geometryContainsPoint(feature, lat, lon)) continue;

    match = {
      code: feature.iso2 || '',
      name: canonicalCountryName(feature.iso2, feature.name || 'Unknown')
    };
    break;
  }

  state.countryPointCache.set(key, match);
  return match;
}

async function loadNavBucket(letter) {
  const key = String(letter || '').toUpperCase();
  if (!key) return {};
  if (!state.navBuckets.has(key)) {
    const promise = fetch(`${NAV_BUCKET_BASE}/${key}.json`).then((res) => (res.ok ? res.json() : {}));
    state.navBuckets.set(key, promise);
  }
  return state.navBuckets.get(key);
}


function getAirportPrefixCountry(token) {
  const value = String(token || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(value)) return null;
  return AIRPORT_PREFIX_COUNTRIES[value.slice(0, 2)] || null;
}

function canonicalCountryName(code, fallbackName = '') {
  const normalizedCode = String(code || '').toUpperCase();
  if (COUNTRY_CODE_NAMES[normalizedCode]) return COUNTRY_CODE_NAMES[normalizedCode];
  return fallbackName || 'Unknown';
}

function parseCoordinateToken(token) {
  const match = String(token).match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/);
  if (!match) return null;
  const lat = Number(match[1]) + Number(match[2]) / 60;
  const lon = Number(match[4]) + Number(match[5]) / 60;
  return {
    lat: match[3] === 'S' ? -lat : lat,
    lon: match[6] === 'W' ? -lon : lon
  };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.code}|${candidate.lat ?? ''}|${candidate.lon ?? ''}`;
    if (!candidate.code || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getCountryCandidates(token) {
  const overrides = await loadTokenOverrides();
  const coordinate = parseCoordinateToken(token);
  const airportPrefixCountry = getAirportPrefixCountry(token);
  const bucket = await loadNavBucket(token[0]);
  const entries = Array.isArray(bucket[token]) ? bucket[token] : [];

  const navCandidates = [];
  for (const entry of entries) {
    const lat = typeof entry[1] === 'number' ? entry[1] : coordinate?.lat ?? null;
    const lon = typeof entry[2] === 'number' ? entry[2] : coordinate?.lon ?? null;
    const geo = await lookupCountryByPoint(lat, lon);
    navCandidates.push({
      token,
      code: geo?.code || entry[3] || '',
      name: canonicalCountryName(geo?.code || entry[3], geo?.name || entry[4] || entry[3] || 'Unknown'),
      lat,
      lon,
      source: 'nav'
    });
  }

  const candidates = [];

  if (overrides[token]) {
    const value = overrides[token];
    let lat = value.lat ?? coordinate?.lat ?? null;
    let lon = value.lon ?? coordinate?.lon ?? null;

    if ((lat == null || lon == null) && navCandidates.length) {
      const sameCodeNav = navCandidates.find((item) => item.code && item.code === value.code) || navCandidates[0];
      if (sameCodeNav) {
        lat = sameCodeNav.lat;
        lon = sameCodeNav.lon;
      }
    }

    candidates.push({
      token,
      code: value.code,
      name: canonicalCountryName(value.code, value.name),
      lat,
      lon,
      source: 'override'
    });
  }

  if (airportPrefixCountry) {
    let lat = coordinate?.lat ?? null;
    let lon = coordinate?.lon ?? null;

    if ((lat == null || lon == null) && navCandidates.length) {
      const sameCodeNav = navCandidates.find((item) => item.code && item.code === airportPrefixCountry.code) || navCandidates[0];
      if (sameCodeNav) {
        lat = sameCodeNav.lat;
        lon = sameCodeNav.lon;
      }
    }

    candidates.push({
      token,
      code: airportPrefixCountry.code,
      name: canonicalCountryName(airportPrefixCountry.code, airportPrefixCountry.name),
      lat,
      lon,
      source: 'icao-prefix'
    });
  }

  candidates.push(...navCandidates);

  if (!candidates.length && coordinate) {
    const geo = await lookupCountryByPoint(coordinate.lat, coordinate.lon);
    return [{
      token,
      code: geo?.code || '',
      name: geo?.name || 'Unknown',
      lat: coordinate.lat,
      lon: coordinate.lon,
      source: geo ? 'coord-geo' : 'coord'
    }];
  }

  return dedupeCandidates(candidates);
}

function distanceKm(a, b) {
  if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return 0;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const value = sinDLat ** 2 + Math.cos(lat1) * Math.cos(lat2) * sinDLon ** 2;
  const c = 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  return 6371 * c;
}

function findNeighborChoice(chosen, index, direction) {
  let cursor = index + direction;
  while (cursor >= 0 && cursor < chosen.length) {
    if (chosen[cursor]) return chosen[cursor];
    cursor += direction;
  }
  return null;
}


async function countriesAlongSegment(from, to) {
  if (!from || !to || from.lat == null || from.lon == null || to.lat == null || to.lon == null) {
    return [];
  }

  const totalDistance = distanceKm(from, to);
  const steps = Math.max(8, Math.ceil(totalDistance / 60));
  const stepDistance = totalDistance / Math.max(1, steps);
  const runs = [];
  let currentRun = null;

  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const lat = from.lat + ((to.lat - from.lat) * ratio);
    const lon = from.lon + ((to.lon - from.lon) * ratio);
    const country = await lookupCountryByPoint(lat, lon);
    const code = country?.code || '';

    if (!currentRun || currentRun.code !== code) {
      currentRun = {
        code,
        name: country?.name || '',
        count: 1,
        firstStep: step,
        lastStep: step
      };
      runs.push(currentRun);
      continue;
    }

    currentRun.count += 1;
    currentRun.lastStep = step;
  }

  const minSamples = Math.max(2, Math.ceil(steps * 0.08));
  const minDistance = Math.max(75, totalDistance * 0.06);

  return runs
    .filter((run) => run.code)
    .filter((run) => {
      if (run.code === from.code || run.code === to.code) return true;
      const runDistance = run.count * stepDistance;
      return run.count >= minSamples && runDistance >= minDistance;
    })
    .map((run) => ({
      code: run.code,
      name: canonicalCountryName(run.code, run.name)
    }));
}

function candidateBias(candidate) {
  let score = 0;
  if (!candidate) return 1000;
  if (candidate.lat == null || candidate.lon == null) score += 300;
  if (candidate.source === 'override') score -= 80;
  if (candidate.source === 'icao-prefix') score -= 35;
  if (candidate.source === 'nav') score -= 10;
  return score;
}

function transitionPenalty(left, right) {
  if (!left || !right) return 0;
  if (left.lat == null || left.lon == null || right.lat == null || right.lon == null) return 700;

  let penalty = distanceKm(left, right);
  if (left.code && right.code && left.code === right.code) penalty -= 90;
  if (penalty > 2200) penalty += (penalty - 2200) * 2.2;
  if (penalty > 4000) penalty += 4000;
  return penalty;
}

function chooseBestCountrySequence(candidatesByIndex) {
  const positions = candidatesByIndex
    .map((candidates, index) => ({
      index,
      candidates: candidates.filter((item) => item.code)
    }))
    .filter((item) => item.candidates.length);

  const chosen = new Array(candidatesByIndex.length).fill(null);
  if (!positions.length) return chosen;

  const costs = [];
  const prev = [];

  positions.forEach((position, layerIndex) => {
    costs[layerIndex] = new Array(position.candidates.length).fill(Infinity);
    prev[layerIndex] = new Array(position.candidates.length).fill(-1);

    position.candidates.forEach((candidate, candidateIndex) => {
      const selfCost = candidateBias(candidate);
      if (layerIndex === 0) {
        costs[layerIndex][candidateIndex] = selfCost;
        return;
      }

      positions[layerIndex - 1].candidates.forEach((previousCandidate, previousIndex) => {
        const candidateCost = costs[layerIndex - 1][previousIndex]
          + transitionPenalty(previousCandidate, candidate)
          + selfCost;

        if (candidateCost < costs[layerIndex][candidateIndex]) {
          costs[layerIndex][candidateIndex] = candidateCost;
          prev[layerIndex][candidateIndex] = previousIndex;
        }
      });
    });
  });

  let bestIndex = 0;
  const lastLayer = costs.length - 1;
  costs[lastLayer].forEach((value, index) => {
    if (value < costs[lastLayer][bestIndex]) bestIndex = index;
  });

  for (let layer = lastLayer; layer >= 0; layer -= 1) {
    const position = positions[layer];
    chosen[position.index] = position.candidates[bestIndex] || null;
    bestIndex = prev[layer][bestIndex];
    if (bestIndex < 0 && layer > 0) bestIndex = 0;
  }

  return chosen;
}


async function resolveCountries(route) {
  const candidatesByIndex = await Promise.all(route.points.map((token) => getCountryCandidates(token)));
  const chosen = chooseBestCountrySequence(candidatesByIndex);

  const countries = [];
  let lastCode = null;
  let lastCoordinateChoice = null;

  const emitCountry = (item) => {
    if (!item || !item.code || item.code === lastCode) return;
    lastCode = item.code;
    countries.push({ code: item.code, name: canonicalCountryName(item.code, item.name) });
  };

  for (const item of chosen) {
    if (!item) continue;

    if (lastCoordinateChoice && item.lat != null && item.lon != null) {
      const segmentCountries = await countriesAlongSegment(lastCoordinateChoice, item);
      segmentCountries.forEach(emitCountry);
    }

    emitCountry(item);

    if (item.lat != null && item.lon != null) {
      lastCoordinateChoice = item;
    }
  }

  const orderedUniqueCountries = [];
  const seenCodes = new Set();

  countries.forEach((country) => {
    if (!country?.code || seenCodes.has(country.code)) return;
    seenCodes.add(country.code);
    orderedUniqueCountries.push(country);
  });

  return orderedUniqueCountries;
}

function tokensForHit(hit) {
  return uniqueValues([
    ...(hit?.airways || []),
    ...(hit?.points || []),
    ...((hit?.segments || []).flatMap((segment) => String(segment).split('-').filter(Boolean))),
    ...((hit?.labels || []).filter((label) => /^[A-Z0-9]{2,}$/.test(label)))
  ]).sort((a, b) => b.length - a.length);
}

function tokenIndexRanges(text, tokens) {
  const source = String(text || '').toUpperCase();
  const ranges = [];

  tokens.forEach((token) => {
    const regex = new RegExp(`(^|[^A-Z0-9])(${escapeRegExp(token)})(?=[^A-Z0-9]|$)`, 'g');
    let match;
    while ((match = regex.exec(source))) {
      const leading = match[1] ? match[1].length : 0;
      const start = match.index + leading;
      const end = start + match[2].length;
      ranges.push({ start, end, token: match[2] });
      if (regex.lastIndex === match.index) regex.lastIndex += 1;
    }
  });

  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function mergeIndexRanges(ranges, gap = 36) {
  if (!ranges.length) return [];
  const merged = [{ start: ranges[0].start, end: ranges[0].end }];

  for (let index = 1; index < ranges.length; index += 1) {
    const current = ranges[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end + gap) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged;
}

function excerptAroundRanges(text, ranges, windowSize = 210, maxChars = 1800) {
  const source = String(text || '');
  if (!ranges.length) return makeSnippet(source);

  const slices = [];
  for (const range of ranges) {
    const start = Math.max(0, range.start - windowSize);
    const end = Math.min(source.length, range.end + windowSize);

    if (!slices.length || start > slices[slices.length - 1].end + 24) {
      slices.push({ start, end });
    } else {
      slices[slices.length - 1].end = Math.max(slices[slices.length - 1].end, end);
    }
  }

  let used = 0;
  const parts = [];
  slices.forEach((slice, index) => {
    if (used >= maxChars) return;
    let chunk = source.slice(slice.start, slice.end).trim();
    if (!chunk) return;

    const remaining = maxChars - used;
    if (chunk.length > remaining) {
      chunk = chunk.slice(0, remaining).trimEnd();
      if (chunk && !/[.?!:]$/.test(chunk)) chunk += '...';
    }

    if (!chunk) return;
    if (index > 0 && slice.start > 0) parts.push('...');
    parts.push(chunk);
    used += chunk.length;
  });

  return parts.join('\n').trim() || makeSnippet(source);
}

function makeFocusedSnippet(text, hit) {
  const displayText = makeDisplayText(text);
  const tokens = tokensForHit(hit);
  const directRanges = mergeIndexRanges(tokenIndexRanges(displayText, tokens));
  return excerptAroundRanges(displayText, directRanges);
}

function renderHighlightedSnippet(text, hit) {
  const bodyText = makeDisplayText(text);
  const tokens = tokensForHit(hit);
  const ranges = mergeIndexRanges(tokenIndexRanges(bodyText, tokens), 0);

  if (!ranges.length) {
    return escapeHtml(bodyText);
  }

  let cursor = 0;
  let html = '';
  ranges.forEach((range) => {
    html += escapeHtml(bodyText.slice(cursor, range.start));
    html += `<mark class="snippet-hit">${escapeHtml(bodyText.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  });
  html += escapeHtml(bodyText.slice(cursor));
  return html;
}

function renderResults(results) {
  if (!el || !el.results) return;

  if (!results.length) {
    el.results.innerHTML = '<div class="empty-state">Netice yoxdur.</div>';
    return;
  }

  el.results.innerHTML = results.map((item) => {
    const countriesHtml = item.countries.length
      ? item.countries.map((country) => `<span class="country-pill">${escapeHtml(country.name)}</span>`).join('')
      : '<span class="country-pill">Tapilmadi</span>';

    const badgeClass = item.notam.hasNotam ? 'badge badge-hit' : 'badge badge-miss';
    const badgeText = item.notam.hasNotam ? 'NOTAM var' : 'NOTAM yoxdur';
    const matchedItemsHtml = item.notam.matchedRouteItems.length
      ? item.notam.matchedRouteItems.map((label) => `<span class="route-chip">${escapeHtml(label)} NOTAM var</span>`).join('')
      : '';

    const notamHtml = item.notam.hasNotam
      ? `
        <div class="notam-list">
          ${item.notam.items.map((hit) => {
            const pageLabel = hit.startPage && hit.endPage && hit.startPage !== hit.endPage
              ? `Sehife ${hit.startPage}-${hit.endPage}`
              : `Sehife ${hit.startPage || hit.page}`;
            const noticeLabel = hit.noticeId || 'NOTAM';
            return `
              <div class="notam-item">
                <div class="notam-meta">
                  <span class="notam-id">${escapeHtml(noticeLabel)}</span>
                  <span class="notam-page">${escapeHtml(pageLabel)}</span>
                </div>
                <div class="chip-list">
                  ${hit.labels.map((label) => `<span class="route-chip">${escapeHtml(label)} NOTAM var</span>`).join('')}
                </div>
                <div class="snippet">${renderHighlightedSnippet(hit.text, hit)}</div>
              </div>
            `;
          }).join('')}
        </div>
      `
      : '<div class="notam-empty">Bu route uzrinde match olunan NOTAM tapilmadi.</div>';

    return `
      <article class="result-card">
        <div class="result-head">
          <p class="result-route">${escapeHtml(item.route.normalized)}</p>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        <div class="meta-grid">
          <div class="info-box">
            <div class="box-title">Kecdiyi olkeler</div>
            <div class="country-list">${countriesHtml}</div>
            ${matchedItemsHtml ? `<div class="small-note">Match olunan route hisseleri</div><div class="chip-list">${matchedItemsHtml}</div>` : ''}
          </div>
          <div class="notam-box">
            <div class="box-title">Tapilan NOTAM-lar${item.notam.hasNotam ? ` (${item.notam.items.length})` : ''}</div>
            ${notamHtml}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function analyze() {
  try {
    ensureElementsReady();
    const file = el.pdfFile.files?.[0];
    if (!file) throw new Error('Evvelce PDF yukle.');

    const lines = routeLinesFromInput(el.routesInput.value);
    if (!lines.length) throw new Error('En azi 1 route daxil et.');

    el.analyzeBtn.disabled = true;
    el.sampleBtn.disabled = true;
    el.clearBtn.disabled = true;
    el.results.innerHTML = '<div class="empty-state">Analiz gedir...</div>';

    const parsedPdf = await parseFlightPlanPdf(file);
    const routes = lines.map(parseRoute);

    const results = [];
    for (const route of routes) {
      const notam = analyzeRoute(parsedPdf.blocks, route);
      const countries = await resolveCountries(route);
      results.push({ route, notam, countries });
    }

    renderResults(results);
    setStatus(`Hazirdir. OCR blok sayi: ${parsedPdf.blocks.length}`, 100);
  } catch (error) {
    if (el?.results) {
      el.results.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Xeta bas verdi.')}</div>`;
    }
    setStatus(error.message || 'Xeta bas verdi.', 0);
  } finally {
    if (el?.analyzeBtn) el.analyzeBtn.disabled = false;
    if (el?.sampleBtn) el.sampleBtn.disabled = false;
    if (el?.clearBtn) el.clearBtn.disabled = false;
  }
}

function bindUi() {
  ensureElementsReady();
  if (state.booted) return;
  state.booted = true;

  el.pdfFile.addEventListener('change', () => {
    const file = el.pdfFile.files?.[0] || null;
    state.currentFile = file;
    if (!file) {
      el.fileMeta.textContent = 'Hele fayl secilmeyib.';
      setStatus('PDF gozlenilir.', 0);
      return;
    }
    el.fileMeta.textContent = `${file.name} - ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    setStatus('PDF secildi. Yoxla duymesini bas.', 0);
  });

  el.sampleBtn.addEventListener('click', () => {
    el.routesInput.value = SAMPLE_ROUTE;
  });

  el.clearBtn.addEventListener('click', () => {
    el.routesInput.value = '';
    el.results.innerHTML = '';
    setStatus(state.currentFile ? 'PDF secildi. Yoxla duymesini bas.' : 'PDF gozlenilir.', 0);
  });

  el.analyzeBtn.addEventListener('click', analyze);
  setStatus('PDF gozlenilir.', 0);
}

function boot() {
  try {
    bindUi();
  } catch (error) {
    console.error('Boot error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
