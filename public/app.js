const SAMPLE_ROUTE = 'UBBB NAMAS1C NAMAS N35 RODAR A909 TUNEK B143 KRS B447 ETRAP B449 DOLOS B475 NINOP A909 LEMOD N644 REGET G325 ZB L750 MERUN G452 LKA LKA7C VIDP';
const PDFJS_VERSION = '5.5.207';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const TOKEN_OVERRIDES_URL = './data/token_overrides.json';
const NAV_BUCKET_BASE = './data/nav';
const OCR_CACHE_PREFIX = 'azal-notam-ocr-v2:';

const el = {
  pdfFile: document.getElementById('pdfFile'),
  fileMeta: document.getElementById('fileMeta'),
  statusText: document.getElementById('statusText'),
  progressFill: document.getElementById('progressFill'),
  routesInput: document.getElementById('routesInput'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  sampleBtn: document.getElementById('sampleBtn'),
  clearBtn: document.getElementById('clearBtn'),
  results: document.getElementById('results'),
  summary: document.getElementById('summary'),
  summaryRoutes: document.getElementById('summaryRoutes'),
  summaryHits: document.getElementById('summaryHits'),
  summaryMisses: document.getElementById('summaryMisses')
};

const state = {
  pdfFile: null,
  tokenOverrides: null,
  navBuckets: new Map(),
  pdfjs: null,
  ocrWorker: null
};

function setStatus(text, progress = null) {
  el.statusText.textContent = text;
  if (typeof progress === 'number') {
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
  return String(token).split('/')[0].trim();
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
    if (isProcedure(token)) {
      return;
    }
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
    legs.push({ from: currentPoint, to: token, airways: [...pendingAirways] });
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

function splitAlphaNumericGroups(token) {
  return String(token).match(/[A-Z]+|\d+/g) || [String(token)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleTokenPattern(token) {
  return splitAlphaNumericGroups(token).map(escapeRegExp).join('[\\s\\-_/]*');
}

function makeTokenRegex(token) {
  return new RegExp(`(^|[^A-Z0-9])(${flexibleTokenPattern(token)})(?=[^A-Z0-9]|$)`, 'i');
}

function makeLegRegex(leg) {
  const from = flexibleTokenPattern(leg.from);
  const to = flexibleTokenPattern(leg.to);
  const airwayPart = leg.airways.length
    ? `${leg.airways.map(flexibleTokenPattern).join('[^A-Z0-9]{0,12}')}[^A-Z0-9]{0,18}`
    : '';
  return new RegExp(`(?:${airwayPart})?(?:${from}[^A-Z0-9]{0,8}${to}|${to}[^A-Z0-9]{0,8}${from})`, 'i');
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeForSearch(text) {
  return normalizeOcrText(text)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBlocksFromPages(pages) {
  const blocks = [];
  const boundaryRe = /(?=(?:\*RULE\*|\*RECENT\*|[A-Z]{4}\s+[A-Z0-9]{3,}\/\d{2}))/g;

  pages.forEach((pageText, index) => {
    const normalized = normalizeOcrText(pageText);
    const parts = normalized.split(boundaryRe).map((item) => item.trim()).filter(Boolean);
    const sourceParts = parts.length ? parts : [normalized];

    sourceParts.forEach((part) => {
      const search = normalizeForSearch(part);
      if (!search || search.length < 20) return;
      const informationalOnly =
        search.includes('CHECKLIST') ||
        search.includes('LATEST PUBLICATIONS') ||
        search.includes('AIP AIRAC') ||
        search.includes('AIP AMDT') ||
        search.includes('AIP SUP');

      if (informationalOnly && !/(ATS RTE|WAYPOINT|SEGMENT|ENTRY\/EXIT|UNAVBL|NOT AVBL|CLSD|CLOSED|RESTRICTED|AUP|TSA|TRA|ACT)/.test(search)) {
        return;
      }

      blocks.push({ page: index + 1, text: part, search });
    });
  });

  return blocks;
}

function analyzeRoute(blocks, route) {
  const pointTokens = route.points.filter((token) => token.length >= 3);
  const pointRegexes = pointTokens.map((token) => ({ token, regex: makeTokenRegex(token) }));
  const airwayRegexes = route.airways.map((token) => ({ token, regex: makeTokenRegex(token) }));
  const legRegexes = route.legs.map((leg) => ({ leg, regex: makeLegRegex(leg) }));
  const routeKeywords = /(ATS RTE|AIRWAY|WAYPOINT|ENTRY\/EXIT|SEGMENT|UNAVBL|NOT AVBL|CLSD|CLOSED|RESTRICTED|PROHIBITED|AUP|TSA|TRA|ACT|DUE TO OPS|NOT AVAILABLE)/;

  const hits = [];

  for (const block of blocks) {
    const matchedLegs = legRegexes.filter((item) => item.regex.test(block.search));
    const matchedPoints = pointRegexes.filter((item) => item.regex.test(block.search));
    const matchedAirways = airwayRegexes.filter((item) => item.regex.test(block.search));

    const positive =
      matchedLegs.length > 0 ||
      matchedPoints.length >= 2 ||
      (matchedPoints.length >= 1 && matchedAirways.length >= 1) ||
      (matchedPoints.length >= 1 && routeKeywords.test(block.search));

    if (!positive) continue;

    hits.push({
      page: block.page,
      legs: matchedLegs.map((item) => `${item.leg.from}-${item.leg.to}`),
      points: matchedPoints.map((item) => item.token),
      airways: matchedAirways.map((item) => item.token)
    });
  }

  const uniqPages = Array.from(new Set(hits.map((item) => item.page)));
  return {
    hasNotam: hits.length > 0,
    hitPages: uniqPages,
    hits
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
  return Array.from(new Uint8Array(hash)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function ensureWorker() {
  if (state.ocrWorker) return state.ocrWorker;
  if (!window.Tesseract) {
    throw new Error('OCR kitabxanası yüklənmədi.');
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
    const viewport = page.getViewport({ scale: 2 });
    const canvas = makeCanvasFromViewport(viewport);
    const context = canvas.getContext('2d', { alpha: false });

    await page.render({ canvasContext: context, viewport }).promise;
    onProgress(pageNo, pdf.numPages);

    const result = await worker.recognize(canvas);
    const text = result?.data?.text || '';
    pages.push(normalizeOcrText(text));

    canvas.width = 1;
    canvas.height = 1;
  }

  return pages;
}

async function parseFlightPlanPdf(file) {
  if (!file) throw new Error('PDF faylı seçilməyib.');
  const hash = await sha256Hex(file);
  const cacheKey = `${OCR_CACHE_PREFIX}${hash}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const data = JSON.parse(cached);
    setStatus(`Cache istifadə olundu: ${file.name}`, 100);
    return data;
  }

  setStatus('PDF açılır...', 5);
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  setStatus('Sürətli mətn çıxarışı edilir...', 10);
  const quickPages = await quickExtractPages(pdf);
  const quickAlphaChars = quickPages.join(' ').replace(/[^A-Z]/gi, '').length;

  setStatus(`OCR başlanır: 0 / ${pdf.numPages}`, 12);
  const ocrPages = await ocrPdfPages(pdf, (current, total) => {
    const progress = 12 + (current / total) * 82;
    setStatus(`OCR edilir: ${current} / ${total}`, progress);
  });

  const mergedPages = ocrPages.map((ocrText, index) => {
    const quickText = quickPages[index] || '';
    if (quickText.replace(/[^A-Z]/gi, '').length > 300) {
      return normalizeOcrText(`${ocrText}\n${quickText}`);
    }
    return normalizeOcrText(ocrText);
  });

  const data = {
    hash,
    pageCount: pdf.numPages,
    quickAlphaChars,
    pages: mergedPages,
    blocks: extractBlocksFromPages(mergedPages)
  };

  localStorage.setItem(cacheKey, JSON.stringify(data));
  setStatus('PDF hazırdır.', 100);
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

async function getCountryCandidates(token) {
  const overrides = await loadTokenOverrides();
  if (overrides[token]) {
    return [overrides[token]];
  }
  const bucket = await loadNavBucket(token[0]);
  const entries = Array.isArray(bucket[token]) ? bucket[token] : [];
  const byCountry = new Map();
  entries.forEach((entry) => {
    const code = entry[3] || '';
    const name = entry[4] || code || 'Unknown';
    if (!code || byCountry.has(code)) return;
    byCountry.set(code, { code, name });
  });
  return Array.from(byCountry.values());
}

async function resolveCountries(route) {
  const tokens = route.points;
  const resolutions = new Array(tokens.length).fill(null);
  const candidatesByIndex = new Array(tokens.length).fill(null);

  for (let i = 0; i < tokens.length; i += 1) {
    const candidates = await getCountryCandidates(tokens[i]);
    candidatesByIndex[i] = candidates;
    if (candidates.length === 1) {
      resolutions[i] = candidates[0];
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (resolutions[i] || !candidatesByIndex[i]?.length) continue;
    const left = [...resolutions.slice(0, i)].reverse().find(Boolean);
    const right = resolutions.slice(i + 1).find(Boolean);
    const candidates = candidatesByIndex[i];

    const choose = (country) => candidates.find((item) => item.code === country?.code);
    resolutions[i] = choose(left) || choose(right) || candidates[0];
  }

  for (let i = 1; i < tokens.length - 1; i += 1) {
    if (resolutions[i]) continue;
    if (resolutions[i - 1] && resolutions[i + 1] && resolutions[i - 1].code === resolutions[i + 1].code) {
      resolutions[i] = resolutions[i - 1];
    }
  }

  const countries = [];
  let lastCode = null;
  resolutions.forEach((country) => {
    if (!country || !country.code || country.code === lastCode) return;
    lastCode = country.code;
    countries.push(country);
  });

  return countries;
}

function renderResults(results) {
  if (!results.length) {
    el.summary.hidden = true;
    el.results.innerHTML = '<div class="empty-state">Result yoxdur.</div>';
    return;
  }

  const hits = results.filter((item) => item.notam.hasNotam).length;
  const misses = results.length - hits;
  el.summary.hidden = false;
  el.summaryRoutes.textContent = String(results.length);
  el.summaryHits.textContent = String(hits);
  el.summaryMisses.textContent = String(misses);

  el.results.innerHTML = results
    .map((item) => {
      const countries = item.countries.length
        ? item.countries.map((country) => `<span class="country-pill">${escapeHtml(country.name)}</span>`).join('')
        : '<span class="country-pill">Tapılmadı</span>';
      const badgeClass = item.notam.hasNotam ? 'badge badge-hit' : 'badge badge-miss';
      const badgeText = item.notam.hasNotam ? 'NOTAM var' : 'NOTAM yoxdur';
      return `
        <article class="result-card">
          <div class="result-head">
            <p class="result-route">${escapeHtml(item.route.normalized)}</p>
            <span class="${badgeClass}">${badgeText}</span>
          </div>
          <div class="result-body">
            <div class="label-box">
              <div class="label-box-title">Nəticə</div>
              <div class="label-box-value">${item.notam.hasNotam ? 'Var' : 'Yoxdur'}</div>
            </div>
            <div class="countries-box">
              <div class="countries-title">Keçdiyi ölkələr</div>
              <div class="country-list">${countries}</div>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

async function analyze() {
  try {
    const file = el.pdfFile.files?.[0];
    if (!file) throw new Error('Əvvəlcə PDF yüklə.');

    const lines = routeLinesFromInput(el.routesInput.value);
    if (!lines.length) throw new Error('Ən azı 1 route daxil et.');

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
    setStatus(`Hazırdır. OCR blok sayı: ${parsedPdf.blocks.length}`, 100);
  } catch (error) {
    el.results.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Xəta baş verdi.')}</div>`;
    setStatus(error.message || 'Xəta baş verdi.', 0);
  } finally {
    el.analyzeBtn.disabled = false;
    el.sampleBtn.disabled = false;
    el.clearBtn.disabled = false;
  }
}

el.pdfFile.addEventListener('change', () => {
  const file = el.pdfFile.files?.[0] || null;
  state.pdfFile = file;
  if (!file) {
    el.fileMeta.textContent = 'Hələ fayl seçilməyib.';
    setStatus('PDF gözlənilir.', 0);
    return;
  }
  el.fileMeta.textContent = `${file.name} - ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  setStatus('PDF seçildi. Yoxla düyməsini bas.', 0);
});

el.sampleBtn.addEventListener('click', () => {
  el.routesInput.value = SAMPLE_ROUTE;
});

el.clearBtn.addEventListener('click', () => {
  el.routesInput.value = '';
  el.results.innerHTML = '';
  el.summary.hidden = true;
  setStatus(state.pdfFile ? 'PDF seçildi. Yoxla düyməsini bas.' : 'PDF gözlənilir.', 0);
});

el.analyzeBtn.addEventListener('click', analyze);
setStatus('PDF gözlənilir.', 0);
