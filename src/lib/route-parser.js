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

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

export function normalizeRouteText(routeText = "") {
  return String(routeText)
    .trim()
    .toUpperCase()
    .replace(/[\n\r\t]+/g, " ")
    .replace(/\s+/g, " ");
}

function looksLikeAirport(token) {
  return /^[A-Z]{4}$/.test(token);
}

function looksLikeAirway(token) {
  return /^[A-Z]{1,3}\d{1,4}[A-Z0-9]*$/.test(token);
}

function looksLikeProcedure(token) {
  return /[A-Z]/.test(token) && /\d/.test(token) && !looksLikeAirway(token);
}

function looksLikeLevelOrSpeed(token) {
  return /^([KN]\d{3,4}|F\d{2,3}|M\d{2,3}|N\d{4}F\d{3}|[A-Z]{1,2}\d{2,4}\/\d{2,4})$/.test(token);
}

function resolveContext(item) {
  const countries = [];
  const firs = [];
  const firItemAs = [];
  const notamItemAs = [];
  const faaLocIds = [];

  if (item.airport) {
    countries.push(...asArray(item.airport.country));
    firs.push(...asArray(item.airport.fir));
    firItemAs.push(...asArray(item.airport.firItemA));
    notamItemAs.push(...asArray(item.airport.notamItemAs));
    notamItemAs.push(...asArray(item.airport.notamItemA));
    faaLocIds.push(...asArray(item.airport.faaLocIds));
    faaLocIds.push(...asArray(item.airport.faaLocId || item.token));
  }

  if (item.waypoint) {
    countries.push(...asArray(item.waypoint.country));
    firs.push(...asArray(item.waypoint.fir));
    firItemAs.push(...asArray(item.waypoint.firItemAs));
    firItemAs.push(...asArray(item.waypoint.firItemA));
    notamItemAs.push(...asArray(item.waypoint.notamItemAs));
    notamItemAs.push(...asArray(item.waypoint.notamItemA));
    faaLocIds.push(...asArray(item.waypoint.faaLocIds));
    faaLocIds.push(...asArray(item.waypoint.faaLocId));
  }

  if (item.airway) {
    countries.push(...asArray(item.airway.countries));
    firs.push(...asArray(item.airway.firs));
    firItemAs.push(...asArray(item.airway.firItemAs));
    notamItemAs.push(...asArray(item.airway.notamItemAs));
    faaLocIds.push(...asArray(item.airway.faaLocIds));
    faaLocIds.push(...asArray(item.airway.faaLocId));
  }

  if (!item.airport && looksLikeAirport(item.token)) {
    notamItemAs.push(item.token);
    faaLocIds.push(item.token);
  }

  return {
    countries: uniqueOrdered(countries),
    firs: uniqueOrdered(firs),
    firItemAs: uniqueOrdered(firItemAs),
    notamItemAs: uniqueOrdered([...firItemAs, ...notamItemAs]),
    faaLocIds: uniqueOrdered(faaLocIds)
  };
}

export function parseRoute(routeText, navData) {
  const normalized = normalizeRouteText(routeText);
  const parts = normalized ? normalized.split(" ") : [];

  return parts.map((token, index) => {
    const airportData = navData.airports?.[token] || null;
    const procedureData = navData.procedures?.[token] || null;
    const waypointData = navData.waypoints?.[token] || null;
    const airwayData = navData.airways?.[token] || null;

    let type = "waypoint";
    if (token === "DCT") {
      type = "connector";
    } else if (airportData || looksLikeAirport(token)) {
      type = "airport";
    } else if (procedureData) {
      type = "procedure";
    } else if (airwayData || looksLikeAirway(token)) {
      type = "airway";
    } else if (looksLikeLevelOrSpeed(token)) {
      type = "metadata";
    } else if (looksLikeProcedure(token)) {
      type = "procedure";
    }

    const item = {
      id: `${token}-${index}`,
      index,
      token,
      type,
      airport: airportData,
      waypoint: waypointData,
      airway: airwayData,
      procedure: procedureData
    };

    item.context = resolveContext(item);
    return item;
  });
}

export function buildFlightPoints(parsedTokens) {
  return parsedTokens.filter((item) => item.type === "airport" || item.type === "waypoint");
}

export function buildLegs(parsedTokens) {
  const points = buildFlightPoints(parsedTokens);
  const legs = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    legs.push({
      from: points[index].token,
      to: points[index + 1].token
    });
  }

  return legs;
}

export function normalizeForFaaFlightPath(parsedTokens) {
  return parsedTokens
    .filter((item) => item.type === "airport" || item.type === "waypoint" || item.type === "airway")
    .map((item) => item.token)
    .join(" ");
}

function buildMaps(parsedTokens) {
  const firQueryMap = {};
  const countryMap = {};

  for (const item of parsedTokens) {
    for (const fir of item.context.firs) {
      if (!firQueryMap[fir]) firQueryMap[fir] = new Set();
      for (const code of item.context.firItemAs) firQueryMap[fir].add(code);
    }
    for (const country of item.context.countries) {
      if (!countryMap[country]) countryMap[country] = new Set();
      for (const code of item.context.notamItemAs) countryMap[country].add(code);
    }
  }

  return {
    firQueryMap: Object.fromEntries(
      Object.entries(firQueryMap).map(([label, values]) => [label, [...values]])
    ),
    countryQueryMap: Object.fromEntries(
      Object.entries(countryMap).map(([label, values]) => [label, [...values]])
    )
  };
}

export function buildCountrySummary(parsedTokens) {
  const countries = [];
  const firs = [];
  const firItemAs = [];
  const notamItemAs = [];
  const faaLocIds = [];

  for (const item of parsedTokens) {
    countries.push(...item.context.countries);
    firs.push(...item.context.firs);
    firItemAs.push(...item.context.firItemAs);
    notamItemAs.push(...item.context.notamItemAs);
    faaLocIds.push(...item.context.faaLocIds);
  }

  return {
    countries: uniqueOrdered(countries),
    firs: uniqueOrdered(firs),
    firItemAs: uniqueOrdered(firItemAs),
    notamItemAs: uniqueOrdered(notamItemAs),
    faaLocIds: uniqueOrdered(faaLocIds),
    ...buildMaps(parsedTokens)
  };
}

export function buildReviewTargets(parsedTokens, summary) {
  const targets = [];
  const origin = parsedTokens.find((item) => item.type === "airport") || null;
  const destination = [...parsedTokens].reverse().find((item) => item.type === "airport") || null;

  if (origin) {
    targets.push({
      type: "origin-airport",
      label: `${origin.token} origin airport`,
      code: origin.token,
      liveQueryCodes: origin.context.notamItemAs,
      faaLocIds: origin.context.faaLocIds
    });
  }

  if (destination && destination.token !== origin?.token) {
    targets.push({
      type: "destination-airport",
      label: `${destination.token} destination airport`,
      code: destination.token,
      liveQueryCodes: destination.context.notamItemAs,
      faaLocIds: destination.context.faaLocIds
    });
  }

  for (const fir of summary.firs) {
    targets.push({
      type: "fir",
      label: fir,
      code: fir,
      liveQueryCodes: summary.firQueryMap?.[fir] || [],
      faaLocIds: []
    });
  }

  for (const airway of parsedTokens.filter((item) => item.type === "airway")) {
    targets.push({
      type: "airway",
      label: airway.token,
      code: airway.token,
      liveQueryCodes: airway.context.notamItemAs,
      faaLocIds: airway.context.faaLocIds
    });
  }

  return targets;
}

export function buildCoverage(parsedTokens) {
  const covered = [];
  const uncovered = [];

  for (const item of parsedTokens) {
    if (["connector", "metadata"].includes(item.type)) continue;
    const known = Boolean(item.airport || item.waypoint || item.airway || item.procedure);
    if (known) {
      covered.push(item.token);
    } else {
      uncovered.push(item.token);
    }
  }

  const total = covered.length + uncovered.length;
  const percent = total === 0 ? 0 : Math.round((covered.length / total) * 100);

  return {
    total,
    covered: covered.length,
    uncovered,
    percent
  };
}

export function buildLimitations(parsedTokens, summary, coverage) {
  const limitations = [];

  if (coverage.uncovered.length > 0) {
    limitations.push(`${coverage.uncovered.length} token starter/custom navdata-da tapılmadı.`);
  }

  if (summary.firs.length > 0 && summary.firItemAs.length === 0) {
    limitations.push("FIR adları tapıldı, amma FIR itemA kodları yoxdur. Route-level live coverage qismən olacaq.");
  }

  if (summary.notamItemAs.length === 0) {
    limitations.push("Live NOTAM query üçün itemA kodları toplanmadı.");
  }

  const strippedProcedures = parsedTokens.filter((item) => item.type === "procedure").map((item) => item.token);
  if (strippedProcedures.length > 0) {
    limitations.push(`FAA quick-check üçün prosedurlar çıxarıldı: ${strippedProcedures.join(", ")}`);
  }

  return limitations;
}

export function analyzeRoute(routeText, navData) {
  const parsed = parseRoute(routeText, navData);
  const summary = buildCountrySummary(parsed);
  const coverage = buildCoverage(parsed);
  const reviewTargets = buildReviewTargets(parsed, summary);
  const legs = buildLegs(parsed);
  const normalizedRoute = normalizeRouteText(routeText);
  const normalizedFaaRoute = normalizeForFaaFlightPath(parsed);
  const limitations = buildLimitations(parsed, summary, coverage);
  const origin = parsed.find((item) => item.type === "airport") || null;
  const destination = [...parsed].reverse().find((item) => item.type === "airport") || null;

  return {
    normalizedRoute,
    normalizedFaaRoute,
    parsed,
    summary,
    coverage,
    reviewTargets,
    legs,
    limitations,
    origin,
    destination,
    notamItemAs: summary.notamItemAs,
    faaLocIds: summary.faaLocIds
  };
}
