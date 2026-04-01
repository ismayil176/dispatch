let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

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

function safeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function guessSeverity(notam) {
  const text = `${notam.iteme || ""} ${notam.code23 || ""} ${notam.code45 || ""}`.toUpperCase();
  if (/CLSD|CLOSED|UNSERVICEABLE|OUT OF SERVICE|PROHIBITED|DANGER|HAZARD|MIL|RESTR|RESTRICT|RWY|TWY/.test(text)) {
    return "critical";
  }
  if (/ALT|PROC|ROUTE|AIRSPACE|NAV|GPS|RADAR|COMM/.test(text)) {
    return "review";
  }
  return "info";
}

function formatIdentifier(notam) {
  const series = safeText(notam.series);
  const number = safeText(notam.number);
  const year = safeText(notam.year);
  const location = Array.isArray(notam.itema) ? notam.itema.join(", ") : safeText(notam.itema);
  const pieces = [series && number ? `${series}${number}` : number, year ? `/${year}` : "", location ? ` ${location}` : ""];
  return pieces.join("").trim() || `NOTAM ${notam.id || ""}`.trim();
}

export function autorouterConfigured(env) {
  return Boolean(env.AUTOROUTER_CLIENT_ID && env.AUTOROUTER_CLIENT_SECRET);
}

async function getAccessToken(env) {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const base = env.AUTOROUTER_API_BASE || "https://api.autorouter.aero/v1.0";
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", env.AUTOROUTER_CLIENT_ID);
  form.set("client_secret", env.AUTOROUTER_CLIENT_SECRET);

  const response = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token request failed (${response.status}): ${text.slice(0, 180)}`);
  }

  const data = await response.json();
  const accessToken = data.access_token || data.accessToken;
  const expiresIn = Number(data.expires_in || 3600);

  if (!accessToken) {
    throw new Error("Autorouter token response did not include access_token.");
  }

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
  };

  return accessToken;
}

function buildQueryUrl(base, itemAs, limit) {
  const url = new URL(`${base}/notam`);
  url.searchParams.set("itemas", JSON.stringify(itemAs));
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

function mapNotamToAlert(notam) {
  return {
    source: "autorouter",
    severity: guessSeverity(notam),
    title: formatIdentifier(notam),
    text: safeText(notam.iteme, "No text returned."),
    live: true,
    locationCodes: Array.isArray(notam.itema) ? notam.itema : [safeText(notam.itema)].filter(Boolean),
    metadata: {
      id: notam.id,
      fir: notam.fir || null,
      type: notam.type || null,
      scope: notam.scope || null,
      startvalidity: notam.startvalidity || null,
      endvalidity: notam.endvalidity || null
    }
  };
}

export async function fetchAutorouterNotams(env, itemAs) {
  const uniqueItemAs = uniqueOrdered(itemAs);

  if (!autorouterConfigured(env)) {
    return {
      provider: {
        name: "autorouter",
        configured: false,
        connected: false,
        queried: false,
        queriedItemAs: [],
        message: "Autorouter credentials are missing."
      },
      alerts: []
    };
  }

  if (uniqueItemAs.length === 0) {
    return {
      provider: {
        name: "autorouter",
        configured: true,
        connected: false,
        queried: false,
        queriedItemAs: [],
        message: "No itemA codes were available to query."
      },
      alerts: []
    };
  }

  try {
    const base = env.AUTOROUTER_API_BASE || "https://api.autorouter.aero/v1.0";
    const limit = Number(env.AUTOROUTER_NOTAM_LIMIT || 100);
    const accessToken = await getAccessToken(env);
    const response = await fetch(buildQueryUrl(base, uniqueItemAs, limit), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        provider: {
          name: "autorouter",
          configured: true,
          connected: false,
          queried: true,
          queriedItemAs: uniqueItemAs,
          message: `Autorouter NOTAM request failed (${response.status}): ${text.slice(0, 180)}`
        },
        alerts: []
      };
    }

    const data = await response.json();
    const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];

    return {
      provider: {
        name: "autorouter",
        configured: true,
        connected: true,
        queried: true,
        queriedItemAs: uniqueItemAs,
        message: `Queried ${uniqueItemAs.length} itemA code(s), received ${rows.length} row(s).`
      },
      alerts: rows.map(mapNotamToAlert)
    };
  } catch (error) {
    return {
      provider: {
        name: "autorouter",
        configured: true,
        connected: false,
        queried: true,
        queriedItemAs: uniqueItemAs,
        message: `Autorouter error: ${error.message}`
      },
      alerts: []
    };
  }
}
