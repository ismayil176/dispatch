import { collapseSpaces, uniqOrdered } from './utils.js';

const AIRPORT_RE = /^[A-Z]{4}$/;
const AIRWAY_RE = /^[A-Z]{1,3}\d{1,4}[A-Z]?$/;
const PROCEDURE_RE = /^[A-Z]{2,6}\d{1,2}[A-Z]$/;
const PLAIN_POINT_RE = /^[A-Z]{2,5}$/;

function classifyToken(token, index, total) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const isNearEdge = index === 1 || index === total - 2;

  if ((isFirst || isLast) && AIRPORT_RE.test(token)) return 'airport';
  if (PROCEDURE_RE.test(token) && isNearEdge) return 'procedure';
  if (AIRWAY_RE.test(token) && !isNearEdge) return 'airway';
  if (AIRPORT_RE.test(token) && !isFirst && !isLast) return 'airportOrFix';
  if (PLAIN_POINT_RE.test(token)) return token.length <= 3 ? 'navaidOrPoint' : 'point';
  if (PROCEDURE_RE.test(token)) return 'procedure';
  if (AIRWAY_RE.test(token)) return 'airway';
  return 'other';
}

export function parseRoute(routeText) {
  const normalized = collapseSpaces(String(routeText ?? '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' '));
  if (!normalized) {
    return null;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  const detailedTokens = tokens.map((token, index) => ({
    token,
    index,
    category: classifyToken(token, index, tokens.length),
  }));

  const pointTokens = detailedTokens.filter((item) => {
    if (item.category === 'airport') return true;
    if (item.category === 'point' || item.category === 'navaidOrPoint') return true;
    if (item.category === 'airportOrFix' && item.index !== 0 && item.index !== tokens.length - 1) return true;
    return false;
  });

  const searchTokens = uniqOrdered(detailedTokens.map((item) => item.token));
  const matchedFriendlyTokens = uniqOrdered(
    detailedTokens
      .filter((item) => item.category !== 'other')
      .map((item) => item.token)
  );

  const segments = [];
  for (let i = 0; i < pointTokens.length - 1; i += 1) {
    const from = pointTokens[i];
    const to = pointTokens[i + 1];
    const between = detailedTokens
      .filter((item) => item.index > from.index && item.index < to.index)
      .map((item) => item.token);
    segments.push({
      from: from.token,
      via: between.join(' '),
      to: to.token,
    });
  }

  return {
    raw: routeText,
    normalized,
    tokens,
    detailedTokens,
    pointTokens,
    searchTokens,
    matchedFriendlyTokens,
    segments,
  };
}
