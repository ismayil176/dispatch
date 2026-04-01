import { fetchAutorouterNotams } from "./providers/autorouter.js";
import { runFaaFallback } from "./providers/faa.js";

function levelToSeverity(level) {
  switch (level) {
    case "critical":
      return "critical";
    case "review":
      return "review";
    default:
      return "info";
  }
}

function buildManualAdvisories(navData, analysis) {
  const advisories = [];
  const countries = new Set(analysis.summary.countries);
  const firs = new Set(analysis.summary.firs);
  const airports = new Set(
    analysis.parsed.filter((item) => item.type === "airport").map((item) => item.token)
  );

  for (const item of navData.manualAdvisories || []) {
    const countryMatch = item.selector?.country ? countries.has(item.selector.country) : true;
    const firMatch = item.selector?.fir ? firs.has(item.selector.fir) : true;
    const airportMatch = item.selector?.airport ? airports.has(item.selector.airport) : true;

    if (countryMatch && firMatch && airportMatch) {
      advisories.push({
        source: "manual-rule",
        severity: levelToSeverity(item.level),
        title: item.title,
        text: item.text,
        live: false,
        requiresOfficialReview: true
      });
    }
  }

  return advisories;
}

function evaluateOverallStatus(analysis, autorouterResult, faaResult, liveAlerts) {
  const limitations = analysis.limitations || [];
  const limitedCoverage = limitations.length > 0;
  const liveQueried = Boolean(autorouterResult.provider.queried || faaResult.provider.queried);
  const hasLiveProviderConfig = Boolean(
    autorouterResult.provider.configured || (faaResult.provider.enabled && faaResult.provider.experimental)
  );

  if (liveAlerts.length > 0) {
    return {
      code: "FOUND",
      tone: "critical",
      title: "Route üzrə hit tapıldı",
      message: `Ən azı bir live source ${liveAlerts.length} hit qaytardı. Release-dən əvvəl NOTAM-ları ayrıca oxu və təsdiqlə.`
    };
  }

  if (liveQueried && limitedCoverage) {
    return {
      code: "NOT_FOUND_BUT_LIMITED",
      tone: "review",
      title: "Hit tapılmadı, amma coverage məhduddur",
      message: "Sorğu göndərildi, lakin route coverage qisməndir. FIR itemA kodları və tam navdata olmadan bu nəticə final clearance deyil."
    };
  }

  if (liveQueried) {
    return {
      code: "NOT_FOUND_IN_QUERIED_SOURCES",
      tone: "success",
      title: "Sorğu verilən mənbələrdə hit tapılmadı",
      message: "Live sorğu verilən itemA kodlarında hit tapılmadı. Buna baxmayaraq dispatch release üçün rəsmi proses qalır."
    };
  }

  if (hasLiveProviderConfig) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      tone: "review",
      title: "Provider cavabı alınmadı",
      message: "Live provider konfiqurasiyası mövcuddur, amma hazırkı sorğu üçün etibarlı cavab alınmadı."
    };
  }

  return {
    code: "LIMITED_COVERAGE",
    tone: "review",
    title: "Live yoxlama hazır deyil",
    message: "Bu route üçün live provider hələ konfiqurasiya edilməyib və ya coverage qisməndir. UI yenə də route, ölkə, FIR və review target-ləri çıxarır."
  };
}

export async function runNotamEngine(env, navData, analysis) {
  const mode = String(env.NOTAM_PROVIDER_MODE || "auto").toLowerCase();
  const manualAdvisories = buildManualAdvisories(navData, analysis);

  let autorouterResult = {
    provider: {
      name: "autorouter",
      configured: false,
      connected: false,
      queried: false,
      queriedItemAs: [],
      message: "Autorouter skipped."
    },
    alerts: []
  };

  let faaResult = {
    provider: {
      name: "faa",
      enabled: false,
      connected: false,
      queried: false,
      experimental: false,
      quickChecks: [],
      message: "FAA fallback skipped."
    },
    alerts: []
  };

  if (["auto", "autorouter", "autorouter+faa"].includes(mode)) {
    autorouterResult = await fetchAutorouterNotams(env, analysis.notamItemAs);
  }

  if (["auto", "faa", "autorouter+faa"].includes(mode)) {
    faaResult = await runFaaFallback(env, analysis);
  }

  const liveAlerts = [...autorouterResult.alerts, ...faaResult.alerts];
  const overall = evaluateOverallStatus(analysis, autorouterResult, faaResult, liveAlerts);

  return {
    overall,
    provider: {
      mode,
      autorouter: autorouterResult.provider,
      faa: faaResult.provider
    },
    liveAlerts,
    advisories: manualAdvisories,
    alerts: [...liveAlerts, ...manualAdvisories],
    notes: [
      "Autorouter checks itemA identifiers only. Full route-corridor certainty needs verified FIR itemA coverage or a dedicated route-briefing flow.",
      "FAA fallback in this package is intended as a quick secondary check, not as a global authoritative clearance."
    ]
  };
}
