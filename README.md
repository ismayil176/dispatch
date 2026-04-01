# Route NOTAM Checker for Cloudflare Pages

Bu paket statik Cloudflare Pages saytıdır.

## Deploy

- Repo-nu GitHub-a yüklə.
- Cloudflare Pages-də yeni project aç.
- Build command: `exit 0`
- Build output directory: `public`

## İstifadə

- NAVBLUE flight plan PDF yüklə.
- Route-ları hər sətirdə bir dəfə daxil et.
- `Yoxla` düyməsini bas.
- Sistem route üzrə `NOTAM var / yoxdur` və keçdiyi ölkələri göstərəcək.

## Qeyd

- OCR tam brauzerdə işləyir.
- İlk analiz bir az vaxt apara bilər.
- Eyni PDF təkrar yüklənəndə nəticə brauzer cache-dən istifadə olunur.
