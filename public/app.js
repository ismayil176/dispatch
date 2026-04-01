const SAMPLE_ROUTE = 'VRMM MUNUT1A MUNUT R329 ANODA UL425 ODOLI A474 BBB G208 APANO G451 AAE Z8 POVOS R462 KE B210 NH G326 LUBNA DCT 2925N06959E DCT HILAL G202 ZB L750 RANAH B449 ETRAP B447 KRS B143 TUNEK A909 RODAR M11 AMOKU AMOKU1G UBBB';
const PDFJS_VERSION = '5.5.207';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const TOKEN_OVERRIDES_URL = './data/token_overrides.json';
const NAV_BUCKET_BASE = './data/nav';
const OCR_CACHE_PREFIX = 'azal-notam-ocr-v6:';

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

function fuzzyCharPattern(char) {
  return OCR_CHAR_EQUIV[char] || escapeRegExp(char);
}

function flexibleTokenPattern(token) {
  return String(token)
    .split('')
    .map(fuzzyCharPattern)
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
      .replace(/\r/g, '\n')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFDÿ]/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
    false
  );
}

function normalizeForSearch(text) {
  return repairOcrArtifacts(normalizeOcrText(text), true)
    .toUpperCase()
    .replace(/[^A-Z0-9\n/ .,:;()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksUsefulExtractedText(text) {
  const sample = normalizeOcrText(text).slice(0, 5000);
  if (!sample) return false;

  const visibleChars = (sample.match(/[A-Z0-9\s,./:;()\-*]/gi) || []).length;
  const weirdChars = (sample.match(/[^A-Z0-9\s,./:;()\-*]/gi) || []).length;
  const wordHits = (sample.match(/\b[A-Z]{3,}\b/g) || []).length;

  return visibleChars >= Math.max(200, weirdChars * 4) && wordHits >= 20;
}

function makeSnippet(text) {
  const lines = normalizeOcrText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(0, 8).join('\n').slice(0, 520);
}

function extractBlocksFromPages(pages) {
  const blocks = [];
  const boundaryRe = /(?=\*RULE\*|\*RECENT\*|(?:^|\n)(?:[A-Z]{4}(?:\s+[A-Z]{4}){0,3})\s+[A-Z0-9@]{3,6}\/\d{2})/gm;
  const routeKeywords = /(ATS RTE|AIRWAY|AIRWAYS|WAYPOINT|WAYPOINTS|ENTRY\/EXIT|SEGMENT|SEGMENTS|UNAVBL|NOT AVBL|UNSERVICEABLE|U\/S|CLSD|CLOSED|RESTRICTED|PROHIBITED|AVBL|NOT AVAILABLE|OUT OF SERVICE|LIMITED|ADVISED TO USE|VOR|VOR\/DME|DME|NDB|FIX|RNAV|SID|STAR|AUP|TSA|TRA|DUE TO OPS|BTN)/;

  pages.forEach((pageText, index) => {
    const normalized = normalizeOcrText(pageText);
    const parts = normalized.split(boundaryRe).map((item) => item.trim()).filter(Boolean);
    const sourceParts = parts.length ? parts : [normalized];

    sourceParts.forEach((part) => {
      const trimmed = part.replace(/\nNNNN[\s\S]*$/i, '').trim();
      const search = normalizeForSearch(trimmed);
      if (!search || search.length < 20) return;
      if (!routeKeywords.test(search)) return;
      if (/CHECKLIST/.test(search) && !routeKeywords.test(search.replace(/CHECKLIST/g, ''))) return;
      if (/LATEST PUBLICATIONS|AIP AIRAC|AIP AMDT|AIP SUP/.test(search) && !/ATS RTE|WAYPOINT|SEGMENT|ENTRY\/EXIT|UNAVBL|NOT AVBL|CLSD|CLOSED|RESTRICTED/.test(search)) {
        return;
      }

      blocks.push({
        id: `p${index + 1}-${blocks.length + 1}`,
        page: index + 1,
        text: trimmed,
        search
      });
    });
  });

  return blocks;
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

  matchedLegs.forEach((item) => {
    if (item.leg.airways.length) {
      item.leg.airways.forEach((airway) => labels.push(airway));
    }
    labels.push(`${item.leg.from}-${item.leg.to}`);
  });

  matchedAirways.forEach((item) => labels.push(item.token));

  if (!matchedLegs.length && !matchedAirways.length) {
    matchedPoints.forEach((item) => labels.push(item.token));
  }

  return uniqueValues(labels).slice(0, 6);
}

function analyzeRoute(blocks, route) {
  const pointTokens = route.points.filter((token) => token.length >= 2);
  const pointRegexes = pointTokens.map((token) => ({ token, regex: makeTokenRegex(token) }));
  const airwayRegexes = route.airways.map((token) => ({ token, regex: makeTokenRegex(token) }));
  const legRegexes = route.legs.map((leg) => ({ leg, regex: makeLegRegex(leg) }));
  const routeKeywords = /(ATS RTE|ATS ROUTES|AIRWAY|AIRWAYS|WAYPOINT|WAYPOINTS|ENTRY\/EXIT|SEGMENT|SEGMENTS|UNAVBL|NOT AVBL|UNSERVICEABLE|U\/S|CLSD|CLOSED|RESTRICTED|PROHIBITED|FORBIDDEN|AVBL|NOT AVAILABLE|OUT OF SERVICE|LIMITED|ADVISED TO USE|VOR|VOR\/DME|DME|NDB|FIX|RNAV|SID|STAR|AUP|TSA|TRA|ACT|DUE TO OPS|BTN|CHANGED TO|ADJUSTED AS FLW)/;

  const items = [];
  const seen = new Set();

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

    const key = `${block.page}|${labels.join('|')}|${block.search.slice(0, 140)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      page: block.page,
      labels,
      points: uniqueValues(matchedPoints.map((item) => item.token)),
      airways: uniqueValues(matchedAirways.map((item) => item.token)),
      segments: uniqueValues(matchedLegs.map((item) => `${item.leg.from}-${item.leg.to}`)),
      snippet: makeSnippet(block.text)
    });
  }

  items.sort((a, b) => a.page - b.page || a.labels.join(',').localeCompare(b.labels.join(',')));

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
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    pages.push(normalizeOcrText(text));
  }
  return pages;
}

async function ocrPdfPages(pdf, onProgress) {
  const worker = await ensureWorker();
  const pages = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = makeCanvasFromViewport(viewport);
    const context = canvas.getContext('2d', { alpha: false });

    await page.render({ canvasContext: context, viewport }).promise;
    onProgress(pageNo, pdf.numPages);

    const result = await worker.recognize(canvas);
    pages.push(normalizeOcrText(result?.data?.text || ''));

    canvas.width = 1;
    canvas.height = 1;
  }

  return pages;
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

  setStatus('Suretli metn cixarilir...', 10);
  const quickPages = await quickExtractPages(pdf);

  setStatus(`OCR basladi: 0 / ${pdf.numPages}`, 12);
  const ocrPages = await ocrPdfPages(pdf, (current, total) => {
    const progress = 12 + (current / total) * 82;
    setStatus(`OCR edilir: ${current} / ${total}`, progress);
  });

  const mergedPages = ocrPages.map((ocrText, index) => {
    const quickText = quickPages[index] || '';
    const normalizedOcr = normalizeOcrText(ocrText);
    const normalizedQuick = normalizeOcrText(quickText);

    if (looksUsefulExtractedText(normalizedQuick)) {
      const quickRatio = (normalizedQuick.match(/[A-Z0-9\s,./:;()'\-]/gi) || []).length / Math.max(1, normalizedQuick.length);
      if (quickRatio > 0.9) {
        return normalizeOcrText(`${normalizedOcr}
${normalizedQuick}`);
      }
    }

    return normalizedOcr;
  });

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

  if (airportPrefixCountry) {
    return [{
      token,
      code: airportPrefixCountry.code,
      name: airportPrefixCountry.name,
      lat: coordinate?.lat ?? null,
      lon: coordinate?.lon ?? null,
      source: 'icao-prefix'
    }];
  }

  if (overrides[token]) {
    const value = overrides[token];
    return [{
      token,
      code: value.code,
      name: value.name,
      lat: value.lat ?? coordinate?.lat ?? null,
      lon: value.lon ?? coordinate?.lon ?? null,
      source: 'override'
    }];
  }

  const bucket = await loadNavBucket(token[0]);
  const entries = Array.isArray(bucket[token]) ? bucket[token] : [];
  const candidates = entries.map((entry) => ({
    token,
    code: entry[3] || '',
    name: entry[4] || entry[3] || 'Unknown',
    lat: typeof entry[1] === 'number' ? entry[1] : coordinate?.lat ?? null,
    lon: typeof entry[2] === 'number' ? entry[2] : coordinate?.lon ?? null,
    source: 'nav'
  }));

  if (!candidates.length && coordinate) {
    return [{
      token,
      code: '',
      name: 'Unknown',
      lat: coordinate.lat,
      lon: coordinate.lon,
      source: 'coord'
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

async function resolveCountries(route) {
  const candidatesByIndex = await Promise.all(route.points.map((token) => getCountryCandidates(token)));
  const chosen = new Array(route.points.length).fill(null);

  for (let i = 0; i < candidatesByIndex.length; i += 1) {
    if (candidatesByIndex[i].length === 1 && candidatesByIndex[i][0].code) {
      chosen[i] = candidatesByIndex[i][0];
    }
  }

  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < candidatesByIndex.length; i += 1) {
      if (chosen[i] || !candidatesByIndex[i].length) continue;
      const candidates = candidatesByIndex[i].filter((item) => item.code);
      if (!candidates.length) continue;

      const left = findNeighborChoice(chosen, i, -1);
      const right = findNeighborChoice(chosen, i, 1);
      const sameCountry = candidates.find((item) => item.code === left?.code) || candidates.find((item) => item.code === right?.code);
      if (sameCountry) {
        chosen[i] = sameCountry;
        continue;
      }

      const ranked = candidates
        .map((candidate) => ({
          candidate,
          score: distanceKm(left, candidate) + distanceKm(candidate, right)
        }))
        .sort((a, b) => a.score - b.score);

      if (ranked[0]) {
        chosen[i] = ranked[0].candidate;
      }
    }
  }

  const countries = [];
  let lastCode = null;
  chosen.forEach((item) => {
    if (!item || !item.code || item.code === lastCode) return;
    lastCode = item.code;
    countries.push({ code: item.code, name: item.name });
  });

  return countries;
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
          ${item.notam.items.map((hit) => `
            <div class="notam-item">
              <div class="chip-list">
                ${hit.labels.map((label) => `<span class="route-chip">${escapeHtml(label)} NOTAM var</span>`).join('')}
              </div>
              <pre class="snippet">${escapeHtml(hit.snippet)}</pre>
            </div>
          `).join('')}
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
