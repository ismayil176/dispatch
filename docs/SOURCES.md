# Research notes for this MVP

This repo is built around two practical public-facing paths discovered during research:

1. **autorouter API**
   - OAuth 2.0 client credentials auth
   - NOTAM search by `itemA`
   - NOTAM database imported from Eurocontrol EAD/INO
   - route briefing pack exists, but it is delivered as PDF and is not the primary mechanism in this MVP

2. **FAA NOTAM Search**
   - public search site with Flight Path and Location modes
   - U.S.-centric coverage, not a global final-clearance answer
   - this repo uses FAA as a quick secondary/manual fallback path

## Why this repo is honest about limitations

- autorouter's public NOTAM API is itemA-based, so full route-corridor certainty still depends on having verified FIR itemA coverage or a separate route briefing flow
- FAA quick-check is useful, but not a global authoritative result for international dispatch
- starter navdata in this repo is intentionally small and must be extended for production

## Cloudflare deployment model

This project is structured as a Cloudflare Worker with static assets in the same deploy unit.
That makes GitHub -> Cloudflare Workers Builds deployment straightforward.
