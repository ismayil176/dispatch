export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/[\t\f\v]+/g, ' ').replace(/ {2,}/g, ' ');
}

export function collapseSpaces(value) {
  return normalizeWhitespace(value).replace(/\s+/g, ' ').trim();
}

export function downloadJson(payload, filename = 'analysis.json') {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

export function uniqOrdered(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function chunkSnippet(text, maxLength = 240) {
  const cleaned = collapseSpaces(text);
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

export function splitAlphaNumericGroups(token) {
  const groups = [];
  let current = '';
  let currentType = '';

  for (const char of token) {
    const charType = /[A-Z]/.test(char) ? 'A' : /[0-9]/.test(char) ? 'N' : 'O';
    if (!current || charType === currentType) {
      current += char;
      currentType = charType;
    } else {
      groups.push(current);
      current = char;
      currentType = charType;
    }
  }
  if (current) groups.push(current);
  return groups;
}

export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const x = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function interpolateLine(a, b, steps) {
  if (steps <= 1) return [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }];
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / steps;
    points.push({
      lat: a.lat + (b.lat - a.lat) * ratio,
      lon: a.lon + (b.lon - a.lon) * ratio,
    });
  }
  return points;
}

export function parseCsvText(text) {
  const rows = [];
  let current = '';
  let row = [];
  let insideQuotes = false;

  const pushCell = () => {
    row.push(current);
    current = '';
  };

  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (insideQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
      continue;
    }

    if (char === ',') {
      pushCell();
      continue;
    }

    if (char === '\n') {
      pushCell();
      pushRow();
      continue;
    }

    current += char;
  }

  pushCell();
  if (row.length > 1 || row[0]) pushRow();
  return rows;
}
