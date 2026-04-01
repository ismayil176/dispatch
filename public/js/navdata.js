import { COUNTRIES_URL, NAV_BUCKET_BASE } from './config.js';
import { haversineKm, interpolateLine, parseCsvText, uniqOrdered } from './utils.js';

const navBucketCache = new Map();
let countriesPromise;
let supplementalIndex = new Map();
const pointCountryCache = new Map();

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fayl yüklənmədi: ${url}`);
  }
  return response.json();
}

export async function loadNavBucket(letter) {
  const key = letter.toUpperCase();
  if (!navBucketCache.has(key)) {
    navBucketCache.set(key, fetchJson(`${NAV_BUCKET_BASE}/${key}.json`));
  }
  return navBucketCache.get(key);
}

export async function loadCountryFeatures() {
  if (!countriesPromise) {
    countriesPromise = fetchJson(COUNTRIES_URL).then((data) => data.features || []);
  }
  return countriesPromise;
}

export function resetSupplementalIndex() {
  supplementalIndex = new Map();
}

function normalizeEntry(entry) {
  const lat = Number(entry.lat ?? entry.latitude ?? entry.LATITUDE ?? entry.latitude_deg);
  const lon = Number(entry.lon ?? entry.longitude ?? entry.LONGITUDE ?? entry.longitude_deg);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const token = String(entry.ident ?? entry.IDENT ?? entry.token ?? '').trim().toUpperCase();
  if (!token) return null;
  const typeRaw = String(entry.type ?? entry.TYPE ?? 'W').trim().toUpperCase();
  const type = typeRaw.startsWith('A') ? 'A' : typeRaw.startsWith('N') ? 'N' : 'W';
  return [type, lat, lon, String(entry.countryCode ?? entry.COUNTRY_CODE ?? '').trim().toUpperCase(), String(entry.countryName ?? entry.COUNTRY_NAME ?? '').trim(), String(entry.name ?? entry.NAME ?? '').trim() || null, token];
}

export async function loadSupplementalNavFile(file) {
  resetSupplementalIndex();
  if (!file) return { loaded: 0 };

  const text = await file.text();
  const ext = String(file.name ?? '').toLowerCase().split('.').pop();
  const normalizedEntries = [];

  if (ext === 'json') {
    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : [];
    for (const row of rows) {
      const entry = normalizeEntry(row);
      if (entry) normalizedEntries.push(entry);
    }
  } else {
    const rows = parseCsvText(text);
    if (!rows.length) return { loaded: 0 };
    const headers = rows[0].map((item) => String(item).trim());
    for (const values of rows.slice(1)) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });
      const entry = normalizeEntry(row);
      if (entry) normalizedEntries.push(entry);
    }
  }

  for (const entry of normalizedEntries) {
    const token = entry[6];
    const existing = supplementalIndex.get(token) || [];
    existing.push(entry.slice(0, 6));
    supplementalIndex.set(token, existing);
  }

  return { loaded: normalizedEntries.length };
}

function getTypePreference(tokenCategory, token, index, total) {
  const isEdgeAirport = index === 0 || index === total - 1;
  if (isEdgeAirport || tokenCategory === 'airport') return ['A', 'W', 'N'];
  if (tokenCategory === 'navaidOrPoint' || token.length <= 3) return ['N', 'W', 'A'];
  if (tokenCategory === 'point') return ['W', 'N', 'A'];
  return ['W', 'N', 'A'];
}

function reorderCandidates(candidates, tokenInfo, leftNeighbor, rightNeighbor) {
  const preference = getTypePreference(tokenInfo.category, tokenInfo.token, tokenInfo.index, tokenInfo.total);
  const ranked = candidates
    .map((candidate) => {
      const typeRank = preference.indexOf(candidate.type);
      let distanceScore = 0;
      if (leftNeighbor) distanceScore += haversineKm(leftNeighbor, candidate);
      if (rightNeighbor) distanceScore += haversineKm(candidate, rightNeighbor);
      if (!leftNeighbor && !rightNeighbor) distanceScore = 0;
      return {
        candidate,
        score: (typeRank === -1 ? 50 : typeRank * 100000) + distanceScore,
      };
    })
    .sort((a, b) => a.score - b.score);

  return ranked.map((item) => item.candidate);
}

function compactEntryToObject(token, compact) {
  return {
    token,
    type: compact[0],
    lat: compact[1],
    lon: compact[2],
    countryCode: compact[3] || '',
    countryName: compact[4] || compact[3] || '',
    label: compact[5] || null,
  };
}

async function collectCandidates(pointTokens) {
  const letters = uniqOrdered(pointTokens.map((item) => item.token[0]).filter(Boolean));
  const buckets = new Map();
  await Promise.all(
    letters.map(async (letter) => {
      const data = await loadNavBucket(letter);
      buckets.set(letter, data);
    })
  );

  return pointTokens.map((item) => {
    const supplemental = supplementalIndex.get(item.token) || [];
    const bucket = buckets.get(item.token[0]) || {};
    const builtIn = Array.isArray(bucket[item.token]) ? bucket[item.token] : [];
    const combined = [...supplemental, ...builtIn].map((entry) => compactEntryToObject(item.token, entry));
    return {
      ...item,
      candidates: combined,
    };
  });
}

function chooseCandidates(pointTokensWithCandidates) {
  const resolved = new Array(pointTokensWithCandidates.length).fill(null);

  for (let i = 0; i < pointTokensWithCandidates.length; i += 1) {
    const item = pointTokensWithCandidates[i];
    if (item.index === 0 || item.index === pointTokensWithCandidates[pointTokensWithCandidates.length - 1].index) {
      const airportFirst = item.candidates.filter((candidate) => candidate.type === 'A');
      resolved[i] = (airportFirst[0] || item.candidates[0] || null);
    }
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < pointTokensWithCandidates.length; i += 1) {
      if (resolved[i]) continue;
      const item = pointTokensWithCandidates[i];
      if (!item.candidates.length) continue;

      const leftNeighbor = [...resolved.slice(0, i)].reverse().find(Boolean);
      const rightNeighbor = resolved.slice(i + 1).find(Boolean);
      const ordered = reorderCandidates(item.candidates, item, leftNeighbor, rightNeighbor);
      resolved[i] = ordered[0] || null;
    }
  }

  return resolved;
}

function pointInRing(point, ring) {
  let inside = false;
  const x = point.lon;
  const y = point.lat;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonContains(point, polygonCoords) {
  if (!polygonCoords?.length) return false;
  if (!pointInRing(point, polygonCoords[0])) return false;
  for (let i = 1; i < polygonCoords.length; i += 1) {
    if (pointInRing(point, polygonCoords[i])) return false;
  }
  return true;
}

function featureContains(feature, point) {
  const bbox = feature.bbox || [-180, -90, 180, 90];
  if (point.lon < bbox[0] || point.lon > bbox[2] || point.lat < bbox[1] || point.lat > bbox[3]) {
    return false;
  }
  const geometry = feature.geometry;
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return polygonContains(point, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygonCoords) => polygonContains(point, polygonCoords));
  }
  return false;
}

function findCountry(point, features) {
  const key = `${point.lat.toFixed(3)}|${point.lon.toFixed(3)}`;
  if (pointCountryCache.has(key)) return pointCountryCache.get(key);
  const feature = features.find((item) => featureContains(item, point)) || null;
  pointCountryCache.set(key, feature);
  return feature;
}

function buildCountrySequence(points, features) {
  if (!points.length) return [];
  const sequence = [];
  let lastCode = null;

  const pushCountry = (featureOrData) => {
    if (!featureOrData) return;
    const code = featureOrData.properties?.iso_a2 || featureOrData.countryCode || '';
    const name = featureOrData.properties?.name || featureOrData.countryName || code;
    if (!code || code === lastCode) return;
    lastCode = code;
    sequence.push({ code, name });
  };

  pushCountry(findCountry(points[0], features) || points[0]);

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const distance = haversineKm(a, b);
    const steps = Math.max(1, Math.ceil(distance / 75));
    const sampled = interpolateLine(a, b, steps);
    for (const point of sampled) {
      pushCountry(findCountry(point, features));
    }
    pushCountry(findCountry(b, features) || b);
  }

  return sequence;
}

export async function resolveRouteCountries(route) {
  const pointTokens = route.pointTokens.map((item) => ({
    ...item,
    total: route.pointTokens.length,
  }));

  if (!pointTokens.length) {
    return {
      resolvedPoints: [],
      unresolvedTokens: [],
      countries: [],
      confidence: 0,
    };
  }

  const withCandidates = await collectCandidates(pointTokens);
  const selected = chooseCandidates(withCandidates);
  const resolvedPoints = [];
  const unresolvedTokens = [];

  selected.forEach((candidate, idx) => {
    const base = withCandidates[idx];
    if (candidate) {
      resolvedPoints.push({
        token: base.token,
        type: candidate.type,
        lat: candidate.lat,
        lon: candidate.lon,
        countryCode: candidate.countryCode,
        countryName: candidate.countryName,
        label: candidate.label,
      });
    } else {
      unresolvedTokens.push(base.token);
    }
  });

  const confidence = route.pointTokens.length ? resolvedPoints.length / route.pointTokens.length : 0;
  let countries = [];
  if (resolvedPoints.length) {
    const features = await loadCountryFeatures();
    countries = buildCountrySequence(resolvedPoints, features);
    if (!countries.length) {
      countries = uniqOrdered(resolvedPoints.map((point) => point.countryCode))
        .filter(Boolean)
        .map((code) => {
          const point = resolvedPoints.find((item) => item.countryCode === code);
          return { code, name: point?.countryName || code };
        });
    }
  }

  return {
    resolvedPoints,
    unresolvedTokens: uniqOrdered(unresolvedTokens),
    countries,
    confidence,
  };
}
