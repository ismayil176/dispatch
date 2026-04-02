# AZAL Route NOTAM Checker

Cloudflare Pages ucun statik web app.

## Nedir

- NAVBLUE flight plan PDF yukleyir
- Route daxil edilir
- Sistem route uzerinde match olunan NOTAM-lari tapir
- Hansi route hissesinde NOTAM oldugunu gosterir
- Kecdiyi olkeleri cixarir

## Deploy

Cloudflare Pages:

- Build command: `exit 0`
- Build output directory: `public`

## Istifade

1. PDF yukle
2. Her setirde 1 route yaz
3. `Yoxla` duymesini bas

## Qeyd

- OCR brauzerde lokal isleyir
- PDF xarice gonderilmir
- Ilk analiz uzun sure biler
- Eyni PDF tekrar yuklenende local cache istifade olunur
