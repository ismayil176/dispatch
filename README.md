# Route NOTAM Checker

Bu repo Cloudflare Pages üzərində işləyən statik bir daxili web alətdir.

Məqsəd:
- NAVBLUE-dan export etdiyiniz **PDF / DOCX / TXT** NOTAM faylını yükləmək
- bir və ya bir neçə **route** daxil etmək
- route daxilindəki token-ların (airport / waypoint / airway / procedure) NOTAM text-də mention olunub-olunmadığını göstərmək
- route boyunca keçilən ölkələri **təxmini** hesablamaq
- unresolved point-ları ayrıca göstərmək

## Bu versiya nə edir?

1. **NOTAM text extraction**
   - PDF
   - DOCX
   - TXT / pasted text

2. **Route parsing**
   - departure / destination airport
   - airway-lər
   - waypoint / navaid-lər
   - SID/STAR/procedure token-ları

3. **NOTAM matching**
   - route token-ları uploaded NOTAM text daxilində flexible regex ilə axtarılır
   - matched token-lar üçün snippet göstərilir

4. **Country estimate**
   - built-in open nav reference data ilə route point-ları resolve olunur
   - point-lar arasında line interpolation edilir
   - country polygon-ları ilə təxmini keçilən ölkələr çıxarılır

5. **Opsional əlavə nav reference**
   - bəzi point-lar built-in dataset-də yoxdursa, əlavə CSV/JSON yükləyə bilərsən
   - format:

```csv
IDENT,LATITUDE,LONGITUDE,COUNTRY_CODE,COUNTRY_NAME,TYPE
PIROG,34.1234,62.5678,AF,Afghanistan,W
```

`TYPE` üçün:
- `A` = airport
- `N` = navaid
- `W` = waypoint

## Mühüm limitlər

Bu alət **operational decision engine deyil**. Bu, dispatcher üçün **decision support helper**-dir.

Məhdudiyyətlər:
- NOTAM uyğunluğu bu versiyada **uploaded text içində token mention** əsasında hesablanır.
- Bu, NOTAM-ın həqiqətən route-a hüquqi/operational təsir etdiyini avtomatik sübut etmir.
- Country hissəsi **approximate**-dir. Tam airway geometry istifadə olunmur; resolve olunmuş point-lar arasında interpolation aparılır.
- Əgər route daxilində bəzi point-lar resolve olunmasa, country nəticəsi natamam ola bilər.
- `.doc` (legacy binary Word) deyil, `.docx` dəstəklənir.
- image-based / scanned PDF üçün text extraction zəif ola bilər.

## Cloudflare Pages deploy

Bu repo build tələb etmir. Statik deploy kimi yüklənir.

### Cloudflare Pages ayarı

- **Framework preset:** None / Static site
- **Build command:** `exit 0`
- **Build output directory:** `public`
- **Root directory:** boş saxla

## GitHub-a yükləmə

1. Bu zip-i aç
2. GitHub repo yarat
3. Bütün faylları repo-ya push et
4. Cloudflare Pages-də həmin repo-nu import et
5. Yuxarıdakı build ayarlarını yaz
6. Deploy et

## Repo strukturu

```text
public/
  index.html
  styles.css
  app.js
  favicon.svg
  data/
    countries-slim.geojson
    country_names.json
    nav/
      A.json ... Z.json
  js/
    config.js
    file-parsers.js
    navdata.js
    notam.js
    route.js
    utils.js
scripts/
  build_nav_index.py
```

## Dataset yeniləmək istəsən

Repo daxilində `scripts/build_nav_index.py` var. Script aşağıdakı raw source fayllarını gözləyir:

```text
raw_data/
  waypoints.csv
  navaids.csv
  airports.csv
  countries.geojson
```

Sonra işə sal:

```bash
python scripts/build_nav_index.py
```

Bu, `public/data/nav/` və `public/data/countries-slim.geojson` fayllarını yenidən yaradacaq.

## Təklif olunan daxili istifadə axını

1. NAVBLUE-dan global NOTAM export et
2. PDF və ya DOCX faylını sistemə yüklə
3. Route-ları bir-bir və ya bir neçə sətirdə daxil et
4. `Yoxlamanı başlat` düyməsini bas
5. Matched token-lara və country estimate hissəsinə bax
6. Lazım olsa əlavə nav CSV ilə missing point-ları tamamla

## Lisenziya

Kod hissəsi bu repo daxilində MIT kimi istifadə oluna bilər.

Open reference data-lar öz mənbələrinin lisenziyaları ilə gəlir; daxili operational istifadə üçün deployment etməzdən əvvəl ayrıca hüquqi yoxlama aparmaq düzgün olar.
