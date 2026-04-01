const SAMPLE_ROUTE = "UBBB BAMAK1B BAMAK T480 PIROG N39 ULDUS N319 ZDN G452 LKA LKA7G VIDP";
const STORAGE_KEY = "azal-route-notam-custom-navdata-v2";

const elements = {
  routeInput: document.getElementById("routeInput"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  sampleBtn: document.getElementById("sampleBtn"),
  clearBtn: document.getElementById("clearBtn"),
  navdataInput: document.getElementById("navdataInput"),
  removeNavdataBtn: document.getElementById("removeNavdataBtn"),
  navdataStatus: document.getElementById("navdataStatus"),
  metaStatus: document.getElementById("metaStatus"),
  coveragePanel: document.getElementById("coveragePanel"),
  summaryPanel: document.getElementById("summaryPanel"),
  overallPanel: document.getElementById("overallPanel"),
  providerPanel: document.getElementById("providerPanel"),
  quickChecksPanel: document.getElementById("quickChecksPanel"),
  liveAlertsPanel: document.getElementById("liveAlertsPanel"),
  advisoryPanel: document.getElementById("advisoryPanel"),
  targetsPanel: document.getElementById("targetsPanel"),
  limitationsPanel: document.getElementById("limitationsPanel"),
  notesPanel: document.getElementById("notesPanel"),
  parsedBody: document.getElementById("parsedBody"),
  legsPanel: document.getElementById("legsPanel")
};

const state = {
  customData: null,
  meta: null
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pill(text, tone = "info") {
  return `<span class="pill ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function renderList(target, items, mapper) {
  if (!items || items.length === 0) {
    target.innerHTML = empty("Məlumat yoxdur.");
    return;
  }
  target.innerHTML = items.map(mapper).join("");
}

function summarizeCustomData(data) {
  if (!data || typeof data !== "object") {
    return "Heç bir custom navdata yüklənməyib.";
  }

  const counts = {
    airports: Object.keys(data.airports || {}).length,
    waypoints: Object.keys(data.waypoints || {}).length,
    airways: Object.keys(data.airways || {}).length,
    procedures: Object.keys(data.procedures || {}).length
  };

  return JSON.stringify(
    {
      loaded: true,
      version: data.version || "custom",
      counts,
      note: data.coverageNote || ""
    },
    null,
    2
  );
}

function loadSavedCustomData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    elements.navdataStatus.textContent = summarizeCustomData(null);
    return;
  }

  try {
    state.customData = JSON.parse(raw);
    elements.navdataStatus.textContent = summarizeCustomData(state.customData);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    state.customData = null;
    elements.navdataStatus.textContent = "Saxlanmış custom navdata korlanıb və silindi.";
  }
}

function renderMeta(meta) {
  state.meta = meta;
  elements.metaStatus.innerHTML = `
    <div class="summary-line"><strong>Mode:</strong> ${escapeHtml(meta.providerMode)}</div>
    <div class="summary-line"><strong>Bundled coverage:</strong> ${escapeHtml(String(meta.coverage.airports))} airports, ${escapeHtml(String(meta.coverage.waypoints))} waypoints, ${escapeHtml(String(meta.coverage.airways))} airways</div>
    <div class="summary-line"><strong>Autorouter creds:</strong> ${meta.configured.autorouterCredentialsPresent ? "bəli" : "xeyr"}</div>
    <div class="summary-line"><strong>FAA fallback:</strong> ${meta.configured.faaFallbackEnabled ? "aktiv" : "sönük"}</div>
    <div class="summary-line"><strong>FAA experimental fetch:</strong> ${meta.configured.faaExperimentalFetch ? "aktiv" : "sönük"}</div>
  `;
}

function renderOverall(overall) {
  elements.overallPanel.className = `overall-panel ${escapeHtml(overall.tone || "review")}`;
  elements.overallPanel.innerHTML = `
    <div class="overall-title">${escapeHtml(overall.title || "-")}</div>
    <div class="overall-text">${escapeHtml(overall.message || "")}</div>
    <div class="top-gap">${pill(overall.code || "UNKNOWN", overall.tone || "review")}</div>
  `;
}

function renderCoverage(data) {
  elements.coveragePanel.innerHTML = `
    <div class="summary-line"><strong>Token coverage:</strong> ${escapeHtml(String(data.coverage.covered))}/${escapeHtml(String(data.coverage.total))} (${escapeHtml(String(data.coverage.percent))}%)</div>
    <div class="summary-line"><strong>Unknown tokens:</strong> ${data.coverage.uncovered.length ? escapeHtml(data.coverage.uncovered.join(", ")) : "yoxdur"}</div>
    <div class="summary-line muted">${escapeHtml(data.coverageSummary.note || "")}</div>
  `;
}

function renderSummary(data) {
  const countries = data.countries.length ? data.countries.map((value) => pill(value, "info")).join("") : empty("Yoxdur");
  const firs = data.firs.length ? data.firs.map((value) => pill(value, "review")).join("") : empty("Yoxdur");
  const itemAs = data.notamItemAs.length ? data.notamItemAs.map((value) => pill(value, "success")).join("") : empty("Yoxdur");

  elements.summaryPanel.innerHTML = `
    <div class="summary-line"><strong>Origin:</strong> ${escapeHtml(data.origin?.code || "-")}${data.origin?.country ? ` (${escapeHtml(data.origin.country)})` : ""}</div>
    <div class="summary-line"><strong>Destination:</strong> ${escapeHtml(data.destination?.code || "-")}${data.destination?.country ? ` (${escapeHtml(data.destination.country)})` : ""}</div>
    <div class="summary-line"><strong>Raw route:</strong></div>
    <div class="code">${escapeHtml(data.route)}</div>
    <div class="summary-line top-gap"><strong>FAA-clean route:</strong></div>
    <div class="code">${escapeHtml(data.faaNormalizedRoute || "-")}</div>
    <div class="summary-line top-gap"><strong>Countries</strong></div>
    <div class="pill-row">${countries}</div>
    <div class="summary-line top-gap"><strong>FIRs</strong></div>
    <div class="pill-row">${firs}</div>
    <div class="summary-line top-gap"><strong>Live itemA</strong></div>
    <div class="pill-row">${itemAs}</div>
  `;
}

function providerCard(title, lines, extra = "") {
  return `
    <div class="item">
      <h3>${escapeHtml(title)}</h3>
      ${lines.map((line) => `<div class="summary-line">${line}</div>`).join("")}
      ${extra}
    </div>
  `;
}

function renderProviders(provider) {
  const autorouter = provider.autorouter || {};
  const faa = provider.faa || {};

  elements.providerPanel.innerHTML = [
    providerCard("autorouter", [
      `<strong>Configured:</strong> ${autorouter.configured ? "bəli" : "xeyr"}`,
      `<strong>Connected:</strong> ${autorouter.connected ? "bəli" : "xeyr"}`,
      `<strong>Queried:</strong> ${autorouter.queried ? "bəli" : "xeyr"}`,
      `<strong>itemA:</strong> ${escapeHtml((autorouter.queriedItemAs || []).join(", ") || "-")}`,
      `<span class="muted">${escapeHtml(autorouter.message || "")}</span>`
    ]),
    providerCard("FAA", [
      `<strong>Enabled:</strong> ${faa.enabled ? "bəli" : "xeyr"}`,
      `<strong>Experimental fetch:</strong> ${faa.experimental ? "bəli" : "xeyr"}`,
      `<strong>Queried:</strong> ${faa.queried ? "bəli" : "xeyr"}`,
      `<span class="muted">${escapeHtml(faa.message || "")}</span>`
    ])
  ].join("");
}

function renderQuickChecks(provider) {
  const quickChecks = provider.faa?.quickChecks || [];
  if (!quickChecks.length) {
    elements.quickChecksPanel.innerHTML = empty("FAA quick-check üçün locId tapılmadı.");
    return;
  }

  renderList(elements.quickChecksPanel, quickChecks, (item) => `
    <div class="item">
      <h3>${escapeHtml(item.locId || item.label || "FAA check")}</h3>
      ${item.status ? `<div class="summary-line">${pill(item.status, item.status === "found" ? "critical" : item.status === "not_found" ? "success" : "review")}</div>` : ""}
      ${item.message ? `<div class="summary-line muted">${escapeHtml(item.message)}</div>` : ""}
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">FAA-da aç</a>
    </div>
  `);
}

function renderAlerts(panel, alerts, emptyText) {
  renderList(panel, alerts, (alert) => `
    <div class="item">
      <div class="inline-gap">
        ${pill(alert.severity || "info", alert.severity || "info")}
        ${alert.live ? pill("live", "critical") : pill("advisory", "review")}
      </div>
      <h3>${escapeHtml(alert.title || "Alert")}</h3>
      <p>${escapeHtml(alert.text || "")}</p>
      ${alert.source ? `<div class="summary-line"><strong>Source:</strong> ${escapeHtml(alert.source)}</div>` : ""}
      ${alert.link ? `<a href="${escapeHtml(alert.link)}" target="_blank" rel="noreferrer">Linki aç</a>` : ""}
    </div>
  `);
  if (!alerts || alerts.length === 0) {
    panel.innerHTML = empty(emptyText);
  }
}

function renderTargets(data) {
  const firMap = Object.entries(data.firQueryMap || {});
  elements.targetsPanel.innerHTML = `
    <div class="item">
      <h3>Review targets</h3>
      ${data.reviewTargets.length ? data.reviewTargets.map((target) => `
        <div class="summary-line">
          <strong>${escapeHtml(target.label)}</strong><br />
          <span class="muted">type=${escapeHtml(target.type)} | live=${escapeHtml((target.liveQueryCodes || []).join(", ") || "-")}</span>
        </div>`).join("") : empty("Target yoxdur")}
    </div>
    <div class="item">
      <h3>FIR → itemA mapping</h3>
      ${firMap.length ? firMap.map(([label, values]) => `
        <div class="summary-line"><strong>${escapeHtml(label)}</strong>: ${escapeHtml(values.join(", ") || "-")}</div>
      `).join("") : empty("FIR itemA mapping yoxdur")}
    </div>
  `;
}

function renderLimitations(data) {
  renderList(elements.limitationsPanel, data.limitations || [], (item) => `
    <div class="item">${escapeHtml(item)}</div>
  `);
  if (!data.limitations || data.limitations.length === 0) {
    elements.limitationsPanel.innerHTML = empty("Ciddi limitation qeyd olunmadı.");
  }

  renderList(elements.notesPanel, data.notes || [], (item) => `
    <div class="item muted">${escapeHtml(item)}</div>
  `);
  if (!data.notes || data.notes.length === 0) {
    elements.notesPanel.innerHTML = "";
  }
}

function renderParsed(data) {
  if (!data.parsed.length) {
    elements.parsedBody.innerHTML = `<tr><td colspan="3">Route boşdur.</td></tr>`;
    return;
  }

  elements.parsedBody.innerHTML = data.parsed
    .map((item) => {
      const contextParts = [];
      if ((item.context?.countries || []).length) contextParts.push(`countries=${item.context.countries.join(",")}`);
      if ((item.context?.firs || []).length) contextParts.push(`firs=${item.context.firs.join(",")}`);
      if ((item.context?.notamItemAs || []).length) contextParts.push(`itemA=${item.context.notamItemAs.join(",")}`);
      return `
        <tr>
          <td><code>${escapeHtml(item.token)}</code></td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(contextParts.join(" | ") || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderLegs(data) {
  renderList(elements.legsPanel, data.legs || [], (leg) => `
    <div class="item"><strong>${escapeHtml(leg.from)}</strong> → <strong>${escapeHtml(leg.to)}</strong></div>
  `);
  if (!data.legs || data.legs.length === 0) {
    elements.legsPanel.innerHTML = empty("Leg yoxdur.");
  }
}

function renderAnalysis(data) {
  renderOverall(data.overall);
  renderCoverage(data);
  renderSummary(data);
  renderProviders(data.provider);
  renderQuickChecks(data.provider);
  renderAlerts(elements.liveAlertsPanel, data.liveAlerts, "Live hit tapılmadı.");
  renderAlerts(elements.advisoryPanel, data.advisories, "Advisory yoxdur.");
  renderTargets(data);
  renderLimitations(data);
  renderParsed(data);
  renderLegs(data);
}

async function fetchMeta() {
  const response = await fetch("/api/meta");
  if (!response.ok) throw new Error(`Meta request failed with ${response.status}`);
  const data = await response.json();
  renderMeta(data);
}

async function analyze() {
  const routeText = elements.routeInput.value.trim();
  if (!routeText) {
    alert("Əvvəl route daxil et.");
    return;
  }

  elements.analyzeBtn.disabled = true;
  elements.analyzeBtn.textContent = "Yoxlanır...";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        routeText,
        customData: state.customData
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Analyze request failed with ${response.status}`);
    }

    renderAnalysis(data);
  } catch (error) {
    renderOverall({
      tone: "critical",
      title: "Xəta baş verdi",
      message: error.message || "Naməlum xəta",
      code: "ERROR"
    });
  } finally {
    elements.analyzeBtn.disabled = false;
    elements.analyzeBtn.textContent = "Yoxla";
  }
}

async function handleNavdataUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    state.customData = parsed;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    elements.navdataStatus.textContent = summarizeCustomData(parsed);
  } catch (error) {
    alert(`JSON oxunmadı: ${error.message}`);
    event.target.value = "";
  }
}

function resetRoute() {
  elements.routeInput.value = "";
}

function init() {
  elements.routeInput.value = SAMPLE_ROUTE;
  loadSavedCustomData();
  fetchMeta().catch((error) => {
    elements.metaStatus.textContent = `Meta yüklənmədi: ${error.message}`;
  });

  elements.analyzeBtn.addEventListener("click", analyze);
  elements.sampleBtn.addEventListener("click", () => {
    elements.routeInput.value = SAMPLE_ROUTE;
  });
  elements.clearBtn.addEventListener("click", resetRoute);
  elements.navdataInput.addEventListener("change", handleNavdataUpload);
  elements.removeNavdataBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state.customData = null;
    elements.navdataInput.value = "";
    elements.navdataStatus.textContent = summarizeCustomData(null);
  });
}

init();
