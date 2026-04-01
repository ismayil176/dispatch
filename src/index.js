import { analyzeRoute } from "./lib/route-parser.js";
import { mergeNavData, summarizeCoverage } from "./lib/navdata.js";
import { runNotamEngine } from "./lib/notam-engine.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function buildMeta(env) {
  const navData = mergeNavData();
  return {
    app: "AZAL Autorouter + FAA Worker",
    providerMode: env.NOTAM_PROVIDER_MODE || "auto",
    coverage: summarizeCoverage(navData),
    configured: {
      autorouterCredentialsPresent: Boolean(env.AUTOROUTER_CLIENT_ID && env.AUTOROUTER_CLIENT_SECRET),
      faaFallbackEnabled: String(env.FAA_FALLBACK_ENABLED || "true") === "true",
      faaExperimentalFetch: String(env.FAA_EXPERIMENTAL_FETCH || "false") === "true"
    },
    endpoints: [
      { method: "GET", path: "/api/meta" },
      { method: "POST", path: "/api/analyze" }
    ]
  };
}

async function handleAnalyze(request, env) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.routeText !== "string") {
    return withCors(json({ error: "routeText is required." }, 400));
  }

  const navData = mergeNavData(body.customData);
  const analysis = analyzeRoute(body.routeText, navData);
  const notamResult = await runNotamEngine(env, navData, analysis);

  return withCors(
    json({
      ok: true,
      route: analysis.normalizedRoute,
      faaNormalizedRoute: analysis.normalizedFaaRoute,
      overall: notamResult.overall,
      provider: notamResult.provider,
      coverage: analysis.coverage,
      coverageSummary: summarizeCoverage(navData),
      origin: analysis.origin
        ? {
            code: analysis.origin.token,
            ...analysis.origin.airport
          }
        : null,
      destination: analysis.destination
        ? {
            code: analysis.destination.token,
            ...analysis.destination.airport
          }
        : null,
      countries: analysis.summary.countries,
      firs: analysis.summary.firs,
      firQueryMap: analysis.summary.firQueryMap,
      notamItemAs: analysis.notamItemAs,
      faaLocIds: analysis.faaLocIds,
      limitations: analysis.limitations,
      legs: analysis.legs,
      reviewTargets: analysis.reviewTargets,
      liveAlerts: notamResult.liveAlerts,
      advisories: notamResult.advisories,
      alerts: notamResult.alerts,
      notes: notamResult.notes,
      parsed: analysis.parsed.map((item) => ({
        token: item.token,
        type: item.type,
        context: item.context,
        airport: item.airport,
        waypoint: item.waypoint,
        airway: item.airway,
        procedure: item.procedure
      }))
    })
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/api/meta" && request.method === "GET") {
      return withCors(json(buildMeta(env)));
    }

    if (url.pathname === "/api/analyze" && request.method === "POST") {
      return handleAnalyze(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
