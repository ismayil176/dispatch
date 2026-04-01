#!/usr/bin/env python3
import csv
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / 'raw_data'
PUBLIC_DIR = ROOT / 'public'
NAV_DIR = PUBLIC_DIR / 'data' / 'nav'

TYPE_PRIORITY = {'A': 0, 'N': 1, 'W': 2}


def safe_float(value: str):
    if value is None:
        return None
    value = str(value).strip()
    if not value:
        return None
    try:
        return float(value)
    except Exception:
        return None


def normalize_ident(value: str):
    if value is None:
        return None
    ident = str(value).strip().upper()
    if not ident:
        return None
    if not re.fullmatch(r'[A-Z0-9]{2,10}', ident):
        return None
    return ident


def minify_feature_geometry(geometry):
    # Round coordinate precision a bit to reduce size while keeping the 110m dataset useful.
    gtype = geometry['type']
    coords = geometry['coordinates']

    def round_coords(obj):
        if isinstance(obj, (list, tuple)) and obj and isinstance(obj[0], (int, float)):
            return [round(float(obj[0]), 4), round(float(obj[1]), 4)]
        return [round_coords(item) for item in obj]

    return {
        'type': gtype,
        'coordinates': round_coords(coords),
    }


def compute_bbox(geometry):
    xmin = ymin = math.inf
    xmax = ymax = -math.inf

    def visit(obj):
        nonlocal xmin, ymin, xmax, ymax
        if isinstance(obj, (list, tuple)) and obj and isinstance(obj[0], (int, float)):
            x = float(obj[0])
            y = float(obj[1])
            xmin = min(xmin, x)
            xmax = max(xmax, x)
            ymin = min(ymin, y)
            ymax = max(ymax, y)
        else:
            for item in obj:
                visit(item)

    visit(geometry['coordinates'])
    return [round(xmin, 4), round(ymin, 4), round(xmax, 4), round(ymax, 4)]


def load_country_names(countries_geojson_path: Path):
    data = json.loads(countries_geojson_path.read_text(encoding='utf-8'))
    iso_to_name = {}
    slim_features = []
    for feature in data['features']:
        props = feature.get('properties', {})
        code = (props.get('iso_a2') or props.get('postal') or '').upper()
        if len(code) != 2:
            alt = str(props.get('postal') or '').upper()
            code = alt if len(alt) == 2 else ''
        name = props.get('name') or props.get('admin') or code
        if code and len(code) == 2:
            iso_to_name[code] = name
        geom = minify_feature_geometry(feature['geometry'])
        slim_features.append({
            'type': 'Feature',
            'properties': {
                'name': name,
                'iso_a2': code,
            },
            'bbox': compute_bbox(geom),
            'geometry': geom,
        })
    slim = {'type': 'FeatureCollection', 'features': slim_features}
    return iso_to_name, slim


def add_entry(index, ident, entry):
    bucket = index[ident[0]]
    bucket[ident].append(entry)


def dedupe_entries(index):
    for letter, mapping in index.items():
        new_mapping = {}
        for ident, entries in mapping.items():
            seen = set()
            deduped = []
            for entry in sorted(entries, key=lambda x: (TYPE_PRIORITY.get(x[0], 9), x[1], x[2], x[3], x[5] or '')):
                key = tuple(entry)
                if key in seen:
                    continue
                seen.add(key)
                deduped.append(entry)
            new_mapping[ident] = deduped
        index[letter] = new_mapping


def build_index(raw_dir: Path, country_names: dict):
    index = {chr(code): defaultdict(list) for code in range(ord('A'), ord('Z') + 1)}

    # Waypoints from OpenNav scrape (global 5-letter fixes, plus some others)
    with (raw_dir / 'waypoints.csv').open(newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ident = normalize_ident(row.get('IDENT'))
            lat = safe_float(row.get('LATITUDE'))
            lon = safe_float(row.get('LONGITUDE'))
            cc = (row.get('COUNTRY_CODE') or '').strip().upper()
            name = country_names.get(cc) or (row.get('COUNTRY_NAME') or '').strip() or cc
            if not ident or lat is None or lon is None or ident[0] not in index:
                continue
            add_entry(index, ident, ['W', lat, lon, cc, name, None])

    # Navaids from OurAirports
    with (raw_dir / 'navaids.csv').open(newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ident = normalize_ident(row.get('ident'))
            lat = safe_float(row.get('latitude_deg'))
            lon = safe_float(row.get('longitude_deg'))
            cc = (row.get('iso_country') or '').strip().upper()
            country_name = country_names.get(cc, cc)
            label = (row.get('name') or '').strip() or None
            if not ident or lat is None or lon is None or ident[0] not in index:
                continue
            add_entry(index, ident, ['N', lat, lon, cc, country_name, label])

    # Airports from OurAirports. Keep ICAO/gps_code and also local_code if they look like route tokens.
    with (raw_dir / 'airports.csv').open(newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            lat = safe_float(row.get('latitude_deg'))
            lon = safe_float(row.get('longitude_deg'))
            cc = (row.get('iso_country') or '').strip().upper()
            country_name = country_names.get(cc, cc)
            label = (row.get('name') or '').strip() or None
            if lat is None or lon is None:
                continue
            idents = [row.get('ident'), row.get('gps_code'), row.get('icao_code'), row.get('local_code')]
            for raw_ident in idents:
                ident = normalize_ident(raw_ident)
                if not ident or ident[0] not in index:
                    continue
                add_entry(index, ident, ['A', lat, lon, cc, country_name, label])

    dedupe_entries(index)
    return index


def main():
    raw_dir = RAW_DIR
    if not raw_dir.exists():
        raise SystemExit(f'Missing raw_data directory: {raw_dir}')

    NAV_DIR.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DIR / 'data').mkdir(parents=True, exist_ok=True)

    country_names, slim_countries = load_country_names(raw_dir / 'countries.geojson')
    index = build_index(raw_dir, country_names)

    # Write slim countries file and iso mapping.
    (PUBLIC_DIR / 'data' / 'countries-slim.geojson').write_text(
        json.dumps(slim_countries, separators=(',', ':')), encoding='utf-8'
    )
    (PUBLIC_DIR / 'data' / 'country_names.json').write_text(
        json.dumps(country_names, separators=(',', ':'), sort_keys=True), encoding='utf-8'
    )

    stats = {
        'letters': {},
        'entries_total': 0,
        'idents_total': 0,
    }

    for letter, mapping in index.items():
        out_path = NAV_DIR / f'{letter}.json'
        compact = {}
        ident_count = 0
        entry_count = 0
        for ident, entries in mapping.items():
            compact[ident] = entries
            ident_count += 1
            entry_count += len(entries)
        out_path.write_text(json.dumps(compact, separators=(',', ':')), encoding='utf-8')
        stats['letters'][letter] = {'idents': ident_count, 'entries': entry_count}
        stats['idents_total'] += ident_count
        stats['entries_total'] += entry_count

    (PUBLIC_DIR / 'data' / 'nav_stats.json').write_text(
        json.dumps(stats, separators=(',', ':'), sort_keys=True), encoding='utf-8'
    )

    print('Generated nav index files in', NAV_DIR)
    print('Total idents:', stats['idents_total'])
    print('Total entries:', stats['entries_total'])


if __name__ == '__main__':
    main()
