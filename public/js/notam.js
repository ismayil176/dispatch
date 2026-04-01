import { chunkSnippet, collapseSpaces, escapeHtml, splitAlphaNumericGroups } from './utils.js';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function splitNotamBlocks(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const coarseBlocks = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const blocks = [];
  const notamBoundaryRe = /(?=(?:^|\n)(?:[A-Z]\d{4}\/\d{2}|[A-Z]{4}\s+[A-Z]\d{4}\/\d{2})\b)/gm;

  for (const coarse of coarseBlocks) {
    if (coarse.length > 1400) {
      const split = coarse.split(notamBoundaryRe).map((item) => item.trim()).filter(Boolean);
      if (split.length > 1) {
        blocks.push(...split);
        continue;
      }
    }
    blocks.push(coarse);
  }

  return blocks.length ? blocks : [normalized];
}

export function buildFlexibleTokenRegex(token) {
  const groups = splitAlphaNumericGroups(token);
  const pattern = groups.map((group) => escapeRegExp(group)).join('[\\s\\-_/]*');
  return new RegExp(`(^|[^A-Z0-9])(${pattern})(?=[^A-Z0-9]|$)`, 'i');
}

export function analyzeNotamText(notamText, route) {
  const blocks = splitNotamBlocks(notamText);
  const tokenResults = [];

  for (const token of route.matchedFriendlyTokens) {
    const regex = buildFlexibleTokenRegex(token);
    const matches = [];

    blocks.forEach((block, blockIndex) => {
      if (!regex.test(block.toUpperCase())) return;
      matches.push({
        blockIndex,
        snippet: chunkSnippet(block, 280),
      });
    });

    tokenResults.push({
      token,
      hits: matches.length,
      matched: matches.length > 0,
      matches: matches.slice(0, 5),
    });
  }

  const matchedTokens = tokenResults.filter((item) => item.matched);
  const unmatchedTokens = tokenResults.filter((item) => !item.matched);

  return {
    blocksScanned: blocks.length,
    routeHasMention: matchedTokens.length > 0,
    matchedTokens,
    unmatchedTokens,
    tokenResults,
  };
}

export function renderMatchItems(items) {
  if (!items.length) {
    return '<div class="footer-note">Match tapılmadı.</div>';
  }

  return `<div class="matches-list">${items
    .map(
      (item) => `
        <div class="match-item">
          <div class="match-item-head">
            <div class="match-item-title">${escapeHtml(item.token)}</div>
            <span class="badge success">${item.hits} match</span>
          </div>
          ${item.matches
            .map((match) => `<p class="snippet">${escapeHtml(match.snippet)}</p>`)
            .join('')}
        </div>
      `
    )
    .join('')}</div>`;
}
