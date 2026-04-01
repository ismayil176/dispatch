function uniqueOrdered(values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function buildFaaLocationUrl(locId, formatType = "ICAO") {
  const url = new URL("https://notams.aim.faa.gov/notamSearch/");
  url.searchParams.set("actionType", "notamRetrievalByICAOs");
  url.searchParams.set("formatType", formatType);
  url.searchParams.set("method", "displayByICAOs");
  url.searchParams.set("reportType", "REPORT");
  url.searchParams.set("retrieveLocId", locId);
  return url.toString();
}

function parseHtmlHeuristically(html) {
  const normalized = String(html || "");

  if (/No NOTAMs found/i.test(normalized)) {
    return {
      status: "not_found",
      message: "FAA page explicitly reported no NOTAMs found."
    };
  }

  if (/Number:\s|Start Date UTC:|Notam Text|Search results may include additional NOTAMs/i.test(normalized)) {
    return {
      status: "found",
      message: "FAA page returned content that looks like one or more NOTAM results."
    };
  }

  if (/Welcome to NOTAM Search|I\'ve read and understood|Loading the application, please hold on|NOTAM Search loading, please wait/i.test(normalized)) {
    return {
      status: "unknown",
      message: "FAA page returned an interactive or loading shell, so automatic confirmation was not reliable."
    };
  }

  return {
    status: "unknown",
    message: "FAA response could not be classified reliably."
  };
}

async function experimentalFetch(checks) {
  const results = [];
  for (const check of checks) {
    try {
      const response = await fetch(check.url, {
        headers: {
          "user-agent": "AZAL-Route-Notam-Checker/0.2"
        }
      });
      const html = await response.text();
      const parsed = parseHtmlHeuristically(html);
      results.push({
        ...check,
        httpStatus: response.status,
        ...parsed
      });
    } catch (error) {
      results.push({
        ...check,
        status: "unknown",
        message: `FAA fetch failed: ${error.message}`
      });
    }
  }
  return results;
}

export async function runFaaFallback(env, analysis) {
  const enabled = String(env.FAA_FALLBACK_ENABLED || "true") === "true";
  const experimental = String(env.FAA_EXPERIMENTAL_FETCH || "false") === "true";
  const locIds = uniqueOrdered(analysis.faaLocIds).slice(0, 10);
  const quickChecks = locIds.map((locId) => ({
    locId,
    label: `FAA quick-check ${locId}`,
    url: buildFaaLocationUrl(locId)
  }));

  if (!enabled) {
    return {
      provider: {
        name: "faa",
        enabled: false,
        connected: false,
        queried: false,
        experimental,
        quickChecks,
        message: "FAA fallback is disabled. Quick links are still available in the UI."
      },
      alerts: []
    };
  }

  if (!experimental || quickChecks.length === 0) {
    return {
      provider: {
        name: "faa",
        enabled: true,
        connected: false,
        queried: false,
        experimental,
        quickChecks,
        message: experimental
          ? "No FAA locIds were available for experimental fetch."
          : "FAA quick-check links generated. Experimental server-side parsing is disabled by default."
      },
      alerts: []
    };
  }

  const results = await experimentalFetch(quickChecks);
  const alerts = results
    .filter((item) => item.status === "found")
    .map((item) => ({
      source: "faa-experimental",
      severity: "review",
      title: `FAA quick-check hit at ${item.locId}`,
      text: item.message,
      live: true,
      link: item.url,
      metadata: {
        locId: item.locId,
        httpStatus: item.httpStatus || null
      }
    }));

  return {
    provider: {
      name: "faa",
      enabled: true,
      connected: true,
      queried: true,
      experimental,
      quickChecks: results,
      message: `FAA experimental fetch checked ${results.length} location(s); ${alerts.length} hit(s) inferred.`
    },
    alerts
  };
}
