import { SAMPLE_ROUTE } from './js/config.js';
import { extractTextFromUploadedFile } from './js/file-parsers.js';
import { resolveRouteCountries, loadSupplementalNavFile, resetSupplementalIndex } from './js/navdata.js';
import { analyzeNotamText, renderMatchItems } from './js/notam.js';
import { parseRoute } from './js/route.js';
import { downloadJson, escapeHtml, formatPercent } from './js/utils.js';

const elements = {
  notamFile: document.getElementById('notamFile'),
  notamPaste: document.getElementById('notamPaste'),
  notamStatus: document.getElementById('notamStatus'),
  navFile: document.getElementById('navFile'),
  navStatus: document.getElementById('navStatus'),
  routesInput: document.getElementById('routesInput'),
  sampleBtn: document.getElementById('sampleBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearBtn: document.getElementById('clearBtn'),
  summaryCard: document.getElementById('summaryCard'),
  summaryMetrics: document.getElementById('summaryMetrics'),
  resultsEmpty: document.getElementById('resultsEmpty'),
  resultsContainer: document.getElementById('resultsContainer'),
  routeCardTemplate: document.getElementById('routeCardTemplate'),
};

const state = {
  notamText: '',
  notamSource: null,
  notamWarnings: [],
  supplementalLoaded: 0,
  lastAnalysis: null,
};

function setStatus(element, tone, text) {
  element.className = `status-panel ${tone}`;
  element.innerHTML = text;
}

function setNotamStatusIdle() {
  setStatus(elements.notamStatus, 'info', 'Hələ NOTAM faylı yüklənməyib. Fayl seç və ya text yapışdır.');
}

async function refreshNotamTextFromFile() {
  const file = elements.notamFile.files?.[0];
  if (!file) {
    state.notamText = '';
    state.notamSource = null;
    state.notamWarnings = [];
    if (!elements.notamPaste.value.trim()) {
      setNotamStatusIdle();
    }
    return;
  }

  setStatus(elements.notamStatus, 'info', `Fayl oxunur: <strong>${escapeHtml(file.name)}</strong> ...`);
  try {
    const parsed = await extractTextFromUploadedFile(file);
    state.notamText = parsed.text;
    state.notamWarnings = parsed.warnings;
    state.notamSource = {
      name: file.name,
      parser: parsed.parser,
      characters: parsed.text.length,
    };

    const warningHtml = parsed.warnings.length
      ? `<br><small>${parsed.warnings.map(escapeHtml).join('<br>')}</small>`
      : '';
    const tone = parsed.warnings.length ? 'warning' : 'success';
    setStatus(
      elements.notamStatus,
      tone,
      `Yükləndi: <strong>${escapeHtml(file.name)}</strong> · Parser: <strong>${escapeHtml(parsed.parser || '')}</strong> · Simvol sayı: <strong>${parsed.text.length.toLocaleString('en-US')}</strong>${warningHtml}`
    );
  } catch (error) {
    state.notamText = '';
    state.notamSource = null;
    state.notamWarnings = [];
    setStatus(elements.notamStatus, 'danger', escapeHtml(error.message || 'NOTAM faylı oxunarkən xəta baş verdi.'));
  }
}

async function refreshSupplementalNav() {
  const file = elements.navFile.files?.[0];
  if (!file) {
    state.supplementalLoaded = 0;
    resetSupplementalIndex();
    setStatus(elements.navStatus, 'subtle', 'Əlavə nav reference yüklənməyib.');
    return;
  }

  setStatus(elements.navStatus, 'info', `Əlavə nav reference oxunur: <strong>${escapeHtml(file.name)}</strong> ...`);
  try {
    const result = await loadSupplementalNavFile(file);
    state.supplementalLoaded = result.loaded;
    setStatus(
      elements.navStatus,
      'success',
      `Əlavə nav reference yükləndi: <strong>${escapeHtml(file.name)}</strong> · Sətir sayı: <strong>${result.loaded.toLocaleString('en-US')}</strong>`
    );
  } catch (error) {
    state.supplementalLoaded = 0;
    resetSupplementalIndex();
    setStatus(elements.navStatus, 'danger', escapeHtml(error.message || 'Əlavə nav faylı oxunarkən xəta baş verdi.'));
  }
}

function collectNotamText() {
  const pasted = elements.notamPaste.value.trim();
  if (pasted) {
    return {
      text: pasted,
      source: {
        name: 'Pasted text',
        parser: 'TEXT',
        characters: pasted.length,
      },
      warnings: [],
    };
  }
  return {
    text: state.notamText,
    source: state.notamSource,
    warnings: state.notamWarnings,
  };
}

function makeMetric(label, value) {
  return `<div class="metric-card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(String(value))}</div></div>`;
}

function tokenPillHtml(token, notamAnalysis, countryAnalysis) {
  const matched = notamAnalysis.matchedTokens.some((item) => item.token === token.token);
  const unresolved = countryAnalysis.unresolvedTokens.includes(token.token);
  let tone = matched ? 'hit' : 'miss';
  if (!matched && unresolved) tone = 'unresolved';
  const suffix = matched ? 'NOTAM hit' : unresolved ? 'resolve yoxdur' : token.category;
  return `<span class="token-pill ${tone}">${escapeHtml(token.token)} · ${escapeHtml(suffix)}</span>`;
}

function countriesValue(countries) {
  if (!countries.length) return 'Hesablana bilmədi';
  return countries.map((item) => `${item.name} (${item.code})`).join(' → ');
}

function buildRouteSections(route, notamAnalysis, countryAnalysis) {
  const matchedTokensHtml = renderMatchItems(notamAnalysis.matchedTokens);
  const unmatchedTokens = notamAnalysis.unmatchedTokens.map((item) => item.token);

  const resolvedList = countryAnalysis.resolvedPoints.length
    ? `<ul>${countryAnalysis.resolvedPoints
        .map(
          (item) => `<li><strong>${escapeHtml(item.token)}</strong> — ${escapeHtml(item.countryName || item.countryCode || 'Unknown')} ${
            item.label ? `· ${escapeHtml(item.label)}` : ''
          }</li>`
        )
        .join('')}</ul>`
    : '<p class="footer-note">Route üzrə coordinate resolve olunmuş nöqtə tapılmadı.</p>';

  const unresolvedHtml = countryAnalysis.unresolvedTokens.length
    ? `<p><strong>Unresolved point-lar:</strong> ${countryAnalysis.unresolvedTokens.map(escapeHtml).join(', ')}</p>`
    : '<p class="footer-note">Bütün əsas point-lar üçün coordinate tapıldı.</p>';

  const segmentHtml = route.segments.length
    ? `<div class="segment-grid">${route.segments
        .map(
          (segment) => `
            <div class="segment-row">
              <div class="segment-point">${escapeHtml(segment.from)}</div>
              <div class="segment-via">${escapeHtml(segment.via || 'DIRECT')}</div>
              <div class="segment-point">${escapeHtml(segment.to)}</div>
            </div>
          `
        )
        .join('')}</div>`
    : '<p class="footer-note">Segment strukturu çıxarıla bilmədi.</p>';

  return `
    <div class="info-box">
      <h4>Matched NOTAM snippet-lər</h4>
      ${matchedTokensHtml}
    </div>
    <div class="info-box">
      <h4>Ölkə estimate və route point-ları</h4>
      ${resolvedList}
      ${unresolvedHtml}
      <p class="footer-note">Confidence: ${escapeHtml(formatPercent(countryAnalysis.confidence))}</p>
    </div>
    <div class="info-box">
      <h4>Route segment-ləri</h4>
      ${segmentHtml}
    </div>
    <div class="info-box">
      <h4>NOTAM hit olmayan token-lar</h4>
      <p>${unmatchedTokens.length ? unmatchedTokens.map(escapeHtml).join(', ') : 'Hamısı hit aldı.'}</p>
    </div>
  `;
}

function renderRouteCard(result) {
  const clone = elements.routeCardTemplate.content.firstElementChild.cloneNode(true);
  clone.querySelector('.route-title').textContent = result.route.normalized;

  const badges = [];
  badges.push(
    `<span class="badge ${result.notam.routeHasMention ? 'success' : 'danger'}">${
      result.notam.routeHasMention ? 'Route üzrə mention var' : 'Mention tapılmadı'
    }</span>`
  );
  if (result.countries.countries.length) {
    badges.push(`<span class="badge neutral">${result.countries.countries.length} ölkə</span>`);
  }
  clone.querySelector('.route-badges').innerHTML = badges.join('');

  clone.querySelector('.route-meta').innerHTML = `
    <div class="meta-box">
      <span class="title">Matched token-lar</span>
      <span class="value">${result.notam.matchedTokens.length} / ${result.notam.tokenResults.length}</span>
    </div>
    <div class="meta-box">
      <span class="title">Keçdiyi ölkələr</span>
      <span class="value">${escapeHtml(countriesValue(result.countries.countries))}</span>
    </div>
    <div class="meta-box">
      <span class="title">Country confidence</span>
      <span class="value">${escapeHtml(formatPercent(result.countries.confidence))}</span>
    </div>
    <div class="meta-box">
      <span class="title">Scanned blocks</span>
      <span class="value">${result.notam.blocksScanned}</span>
    </div>
  `;

  clone.querySelector('.token-strip').innerHTML = result.route.detailedTokens
    .map((token) => tokenPillHtml(token, result.notam, result.countries))
    .join('');

  clone.querySelector('.route-sections').innerHTML = buildRouteSections(result.route, result.notam, result.countries);
  return clone;
}

async function analyze() {
  const notamPayload = collectNotamText();
  const routes = elements.routesInput.value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!notamPayload.text.trim()) {
    setStatus(elements.notamStatus, 'danger', 'Əvvəlcə NOTAM faylı yüklə və ya NOTAM text yapışdır.');
    return;
  }

  if (!routes.length) {
    elements.routesInput.focus();
    return;
  }

  elements.analyzeBtn.disabled = true;
  elements.exportBtn.disabled = true;
  elements.resultsEmpty.classList.add('hidden');
  elements.resultsContainer.innerHTML = '';
  elements.summaryCard.classList.add('hidden');

  const results = [];

  try {
    for (const routeText of routes) {
      const route = parseRoute(routeText);
      if (!route) continue;
      const notamAnalysis = analyzeNotamText(notamPayload.text, route);
      const countryAnalysis = await resolveRouteCountries(route);
      results.push({ route, notam: notamAnalysis, countries: countryAnalysis });
    }

    state.lastAnalysis = {
      generatedAt: new Date().toISOString(),
      notamSource: notamPayload.source,
      supplementalLoaded: state.supplementalLoaded,
      routes: results,
    };

    if (!results.length) {
      elements.resultsEmpty.classList.remove('hidden');
      elements.resultsEmpty.textContent = 'Analiz ediləcək düzgün route tapılmadı.';
      return;
    }

    const routesWithMentions = results.filter((item) => item.notam.routeHasMention).length;
    elements.summaryMetrics.innerHTML = [
      makeMetric('Route sayı', results.length),
      makeMetric('Mention olan route', routesWithMentions),
      makeMetric('Mention olmayan route', results.length - routesWithMentions),
      makeMetric('Əlavə nav sətiri', state.supplementalLoaded),
    ].join('');
    elements.summaryCard.classList.remove('hidden');

    for (const result of results) {
      elements.resultsContainer.append(renderRouteCard(result));
    }

    elements.exportBtn.disabled = false;
  } finally {
    elements.analyzeBtn.disabled = false;
  }
}

function clearAll() {
  elements.notamFile.value = '';
  elements.notamPaste.value = '';
  elements.navFile.value = '';
  elements.routesInput.value = '';
  state.notamText = '';
  state.notamSource = null;
  state.notamWarnings = [];
  state.supplementalLoaded = 0;
  state.lastAnalysis = null;
  resetSupplementalIndex();
  setNotamStatusIdle();
  setStatus(elements.navStatus, 'subtle', 'Əlavə nav reference yüklənməyib.');
  elements.resultsContainer.innerHTML = '';
  elements.resultsEmpty.classList.remove('hidden');
  elements.resultsEmpty.textContent = 'NOTAM faylını yüklə və route yazandan sonra nəticələr burada görünəcək.';
  elements.summaryCard.classList.add('hidden');
  elements.exportBtn.disabled = true;
}

function wireEvents() {
  elements.sampleBtn.addEventListener('click', () => {
    elements.routesInput.value = SAMPLE_ROUTE;
  });

  elements.analyzeBtn.addEventListener('click', () => {
    analyze().catch((error) => {
      console.error(error);
      const message = error?.message || 'Analiz zamanı gözlənilməz xəta baş verdi.';
      elements.resultsEmpty.classList.remove('hidden');
      elements.resultsEmpty.textContent = message;
      elements.analyzeBtn.disabled = false;
    });
  });

  elements.exportBtn.addEventListener('click', () => {
    if (!state.lastAnalysis) return;
    downloadJson(state.lastAnalysis, 'route-notam-analysis.json');
  });

  elements.clearBtn.addEventListener('click', clearAll);
  elements.notamFile.addEventListener('change', () => {
    refreshNotamTextFromFile().catch((error) => {
      console.error(error);
      setStatus(elements.notamStatus, 'danger', escapeHtml(error.message || 'NOTAM faylı oxunmadı.'));
    });
  });
  elements.navFile.addEventListener('change', () => {
    refreshSupplementalNav().catch((error) => {
      console.error(error);
      setStatus(elements.navStatus, 'danger', escapeHtml(error.message || 'Əlavə nav faylı oxunmadı.'));
    });
  });
}

function init() {
  setNotamStatusIdle();
  setStatus(elements.navStatus, 'subtle', 'Əlavə nav reference yüklənməyib.');
  elements.routesInput.placeholder = `${SAMPLE_ROUTE}\nVIDP LKA7G LKA G452 ZDN N319 ULDUS N39 PIROG T480 BAMAK BAMAK1B UBBB`;
  wireEvents();
}

init();
