# AZAL Autorouter + FAA Worker

Bu repo route paste edib aşağıdakıları göstərən Cloudflare-ready MVP-dir:

- route parser
- country / FIR summary
- live `itemA` query via **autorouter**
- **FAA quick-check** fallback link-ləri
- coverage limitation-lərinin açıq göstərilməsi
- custom navdata upload

## Bu repo nə edir

İstifadəçi route daxil edir, məsələn:

```text
UBBB BAMAK1B BAMAK T480 PIROG N39 ULDUS N319 ZDN G452 LKA LKA7G VIDP
```

Sistem:

1. route-u normalize edir
2. airport / airway / waypoint / procedure token-lərini ayırır
3. ölkələri və FIR-ları çıxarır
4. navdata içində mövcud `itemA` kodlarını toplayır
5. autorouter üzərindən həmin `itemA` kodları üçün live NOTAM sorğusu edir
6. FAA üçün quick-check link-ləri yaradır
7. coverage limit-lərini açıq yazır

## Əsas dürüstlük qaydası

Bu repo **dispatch-grade final clearance** verdiyini iddia etmir.

Səbəb:
- autorouter public NOTAM API `itemA` əsaslıdır
- tam route-corridor certainty üçün verified FIR itemA coverage və ya ayrıca route briefing mexanizmi lazımdır
- FAA fallback qlobal son cavab deyil

Yəni nəticə statusu belə başa düşülməlidir:
- **FOUND** -> live source ən azı bir hit qaytardı
- **NOT_FOUND_IN_QUERIED_SOURCES** -> sorğu verilən itemA-larda hit tapılmadı
- **NOT_FOUND_BUT_LIMITED** -> hit tapılmadı, amma coverage qisməndir
- **PROVIDER_UNAVAILABLE / LIMITED_COVERAGE** -> live nəticə üçün əlavə konfiqurasiya lazımdır

## Deploy üçün nə lazımdır

### Minimum

- Cloudflare hesabı
- GitHub repo

### Live autorouter yoxlaması üçün

- autorouter account
- autorouter API access icazəsi
- credentials:
  - `AUTOROUTER_CLIENT_ID`
  - `AUTOROUTER_CLIENT_SECRET`

## Addım-addım: GitHub -> Cloudflare deploy

### 1) Zip-i aç

Bu qovluğu GitHub repository kimi push et.

### 2) Cloudflare-də repo import et

Cloudflare Dashboard-da:

- **Workers & Pages** aç
- **Create application** seç
- **Import a repository** seç
- GitHub repo-nu seç
- Save and Deploy et

Bu repo ayrıca build step tələb etmir; Worker və static assets birlikdə deploy olunur.

## Cloudflare variables / secrets

### Dashboard ilə

Deploy-dan sonra Worker settings içində bunları əlavə et:

#### Vars

- `NOTAM_PROVIDER_MODE=auto`
- `FAA_FALLBACK_ENABLED=true`
- `FAA_EXPERIMENTAL_FETCH=false`
- `AUTOROUTER_API_BASE=https://api.autorouter.aero/v1.0`
- `AUTOROUTER_NOTAM_LIMIT=100`

#### Secrets

- `AUTOROUTER_CLIENT_ID`
- `AUTOROUTER_CLIENT_SECRET`

### Wrangler CLI ilə

```bash
npx wrangler secret put AUTOROUTER_CLIENT_ID
npx wrangler secret put AUTOROUTER_CLIENT_SECRET
```

## Local development

```bash
npm install
npm run dev
```

## Ən vacib operational addım

Starter navdata ilə origin/destination airport query işləyə bilər, amma həqiqi route-level coverage üçün öz navdata-nı genişləndirmək lazımdır.

Xüsusilə bunları əlavə et:
- verified FIR labels
- verified FIR `itemA` codes
- airway -> FIR mapping
- lazım olan airport / waypoint mapping

Bunun üçün UI-də custom JSON upload dəstəyi var.
Nümunə schema: `examples/custom-navdata.sample.json`

## FAA fallback bu repo-da necə işləyir

Bu repo-da FAA hissəsi iki formada istifadə olunur:

1. **Quick links**
   - FAA NOTAM Search location link-ləri yaradır
2. **Optional experimental fetch**
   - `FAA_EXPERIMENTAL_FETCH=true` etsən, Worker FAA HTML cavabını sadə heuristics ilə yoxlamağa çalışır
   - bu hissə intentionally experimental-dir və final truth source sayılmamalıdır

## Route-level dəqiqliyi necə artırmaq olar

Ən praktik yol:

1. öz verified navdata export-unuzu JSON-a çevirin
2. FIR `itemA` kodlarını navdata-ya əlavə edin
3. airway-ləri FIR-lara bağlayın
4. lazım olsa ayrıca vendor / official route briefing flow əlavə edin

## Fayllar

- `src/index.js` - Worker entrypoint
- `src/lib/route-parser.js` - parser, summary, coverage, FAA-clean route
- `src/lib/providers/autorouter.js` - OAuth və live itemA NOTAM query
- `src/lib/providers/faa.js` - FAA quick-check links və optional experimental fetch
- `src/lib/notam-engine.js` - provider orchestration və overall status
- `src/lib/navdata.js` - bundled starter navdata
- `public/` - UI
- `examples/custom-navdata.sample.json` - custom navdata schema example

## Birbaşa istifadə ssenarisi

1. Route-u daxil et
2. Əgər autorouter secrets verilibsə, sistem live itemA query edəcək
3. Əgər hit varsa, `FOUND` çıxacaq
4. Əgər hit yoxdursa, coverage məhdudiyyətinə görə `NOT_FOUND...` və ya `NOT_FOUND_BUT_LIMITED` çıxacaq
5. FAA quick-check link-lərini ayrıca aça bilərsən

## Qısa reallıq

Bu repo hazır MVP-dir, amma airline dispatch səviyyəsində tam güvən üçün sonradan aşağıdakılardan biri faydalı olar:
- verified FIR dataset
- vendor navdata export
- route briefing PDF / downstream parser
- rəsmi və ya lisenziyalı NOTAM source ilə daha dərin inteqrasiya
