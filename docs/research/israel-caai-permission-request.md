# CAAI permission request — draft (IL-0, beads efb-aac.1)

**Status: DRAFT, not sent.** Owner sends it.

## How to send

- **To:** `aip@mot.gov.il` (CAAI AIS, per `https://www.gov.il/he/pages/aip`; no web form found on the page — plain
  e-mail). Consider CC `ais@iaa.gov.il` only if CAAI redirects you there.
- **Subject:** `בקשת אישור לשימוש בשכבות GIS של רת"א באפליקציית קוד פתוח / Permission to use CAAI GIS layers in open-source app`
- **Body:** Hebrew block first, then the English block below, verbatim. Sign with your real name and a reply address.
- **Attach nothing.** Don't attach the GeoJSON extracts; link the repo instead.
- Record CAAI's reply (and the date) in `docs/research/israel-cvfr.md` §11 and in beads `efb-aac.1`.
- Until a written answer arrives, keep the CAAI-derived samples listed at the bottom out of any public push.

---

## Hebrew

שלום רב,

שמי [שם]. אני מפתח את OpenEFB — אפליקציית מפה נעה ל-VFR לאייפד, חינמית, בקוד פתוח (רישיון MPL-2.0) וללא מטרת רווח: https://github.com/sternryan/openefb

ברצוני לכלול באפליקציה את חבילות שכבות ה-GIS שמפרסמת רת"א בעמוד הפמ"ת (https://www.gov.il/he/pages/aip?chapterIndex=11): נתיבי CVFR, נקודות דיווח CVFR, CTR/ATZ, TMA, אזורים אסורים/מוגבלים/מסוכנים (P/R/D), ה-FIR ומסלולים.

מה נעשה בפועל:
- נמיר את השכבות לפורמט הפנימי של האפליקציה ונצרף אותן לאפליקציה עצמה;
- נפרסם את סקריפט ההמרה בקוד פתוח;
- נציג באפליקציה את תאריך עדכון הפמ"ת שממנו נלקחו הנתונים;
- נעדכן את הנתונים בכל עדכון פמ"ת.

השימוש הוא כעזר למודעות מצב בלבד. האפליקציה אינה מחליפה את הפרסומים הרשמיים, והדבר יוצג לטייס במפורש.

שאלותיי:
1. האם מותר להפיץ את שכבות ה-GIS בתוך קובץ האפליקציה ובמאגר הקוד הציבורי, ובאיזה נוסח ייחוס (קרדיט) אתם מבקשים?
2. האם ניתן לקבל רישיון למפת ה-CVFR הרשמית עצמה? ידוע לנו שהזכויות על המידע הגאוגרפי שייכות לחברת "מפה" — נשמח להפניה לגורם המתאים.
3. האם קיים מקור NOTAM או סגירות נתיבים בפורמט קריא-מכונה (API או קובץ)?

תודה רבה על זמנכם,
[שם]
[טלפון / דוא"ל]

---

## English

Dear CAAI AIS team,

My name is [name]. I develop OpenEFB, a free, open-source (MPL-2.0), non-commercial VFR moving-map app for iPad: https://github.com/sternryan/openefb

I would like to include in the app the GIS layer packages CAAI publishes on the AIP page (https://www.gov.il/he/pages/aip?chapterIndex=11): CVFR routes, CVFR reporting points, CTR/ATZ, TMA, P/R/D areas, the FIR and runways.

What we would do:
- convert the layers to the app's own format and ship them inside the app;
- publish the conversion script as open source;
- show in the app the AIP amendment date the data came from;
- update the data with every AIP amendment.

The data would serve as a situational-awareness aid only. The app does not replace the official publications, and says so to the pilot.

My questions:
1. May the GIS layers be redistributed inside the app binary and in the public source repository, and with what attribution?
2. Can the official CVFR chart itself be licensed? We understand the geographic rights belong to Mapa Ltd and would welcome a referral to the right contact.
3. Is there a machine-readable NOTAM or route-closure feed (API or file)?

Thank you for your time,
[name]
[phone / e-mail]

---

## Research samples that are CAAI-derived (keep out of a public push until permission arrives)

In `docs/research/israel-cvfr-samples/`:

| File | Origin | Keep private until OK? |
|---|---|---|
| `caai-gis-cvfr-routes-2026-sample.geojson` | GeoJSON extract from CAAI `CVFR2026.zip` File GDB | **Yes** |
| `caai-gis-cvfr-points-2026.geojson` | GeoJSON extract (full layer) from CAAI `CVFR2026.zip` | **Yes** |
| `caai-gis-ctr-2026-sample.geojson` | GeoJSON extract from CAAI CTR/ATZ layer package | **Yes** |
| `caai-gis-prd-2026-sample.geojson` | GeoJSON extract from CAAI P/R/D layer package | **Yes** |
| `domestic-aip-B03-text.txt` | Text extracted from the domestic AIP PDF (gov.il/Mapa notice) | **Yes** |
| `domestic-aip-A02-A11-text.txt` | Text extracted from the domestic AIP PDF | **Yes** |
| `domestic-aip-A17-text.txt` | Text extracted from the domestic AIP PDF | **Yes** |
| `domestic-aip-reporting-points.csv` | Table transcribed from the domestic AIP PDF (p. 115) | **Yes** (derived) |
| `eaip-*.txt` (GEN, ENR, AD 2 LLBG/LLHA/LLER) | Text from the CAAI international eAIP (`e-aip.azurefd.net`) | Lower risk (no license stated); safest to hold back too |

Not CAAI-derived (fine to publish): `iaa-notam.txt`, `iaa-notam-detail.txt` (IAA NOTAM page), `ourairports-il.csv`
(public domain), `awc-metar.json`, `awc-taf.json`, `awc-isigmet-llll.json` (NOAA).
