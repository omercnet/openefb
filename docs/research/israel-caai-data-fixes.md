# CAAI data-fix email — draft (IL-DIAG2, beads efb-2e7 and efb-aac.17)

**Status: DRAFT, not sent.** Owner sends it.

## How to send

- **To:** `aip@mot.gov.il` (same CAAI AIS address as `docs/research/israel-caai-permission-request.md`).
- **Send as a reply** in the thread of the approval email if there is one, so CAAI sees the context.
- **Subject:** `תודה על האישור, ודיווח על אי-התאמות בנתוני GIS ובפמ"ת / Thank you, and data inconsistencies in the GIS layers and AIP`
- **Body:** Hebrew block first, then the English block below. Fill in the name and reply address.
- **Attach nothing.**
- Record CAAI's reply (and the date) in beads `efb-2e7` and `efb-aac.17`, and re-check each item on the next AIP amendment.

Every number below comes from our own checks (see `docs/design/caai-apd-report.md` and `bd show efb-2e7`). Offsets are
measured on the published chart against the published data; **we do not claim which of the two is wrong.**

---

## Hebrew

שלום רב,

תודה רבה על האישור לשימוש בשכבות ה-GIS ובתרשימי שדות התעופה באפליקציית OpenEFB. אנחנו משתמשים בנתונים כעזר למודעות מצב בלבד, ומציינים זאת לטייס.

תוך כדי עבודה עם הנתונים מצאנו כמה אי-התאמות. נשמח אם תוכלו לבדוק אותן ולהגיד לנו מה המקור הקובע.

**1. אי-התאמות בשכבות ה-GIS**
- בנתיבי חצרים–אופקים וחצרים–צלחות מופיע קוד המנחת LLHS (חצור). אנחנו מניחים שהכוונה ל-LLHB (חצרים), ומתקנים זאת אצלנו. נשמח לאישור.
- נבטים מופיע פעמיים כנקודת ייחוס של שדה (ARP): אחת בנבטים (31.213N 35.018E) ואחת בנגב (31.195N 35.039E, כ-2.7 ק"מ מהראשונה). הנתיבים מתחברים לנקודה הדרומית.
- קו הנתיב סמר–עובדה מסתיים כ-11 ק"מ מנקודת ה-ARP של עובדה.

**2. סתירה בתוך הפמ"ת**
- קציעות (LLKZ): אורך המסלול הוא 1600 מ' בטבלה בעמ' 365, ו-1500 מ' בתרשים בעמ' 368 (וגם בטבלת התרשים עצמו). איזה ערך נכון?

**3. בקשה לקואורדינטות מדודות של ספים ושל נקודת ה-ARP**
כשהתאמנו את המסלול המצויר בתרשימי הפמ"ת לקצות המסלול ב-GIS, סימן ה-ARP המודפס בתרשים נפל במרחק של כ-100 עד 300 מ' מנקודת ה-ARP שבפמ"ת בשדות הבאים (צפון / מזרח, במטרים, ביחס ל-ARP שבפמ"ת):
- הרצליה (LLHZ): 98 / 6
- מגידו (LLMG): 6 / 107
- מצדה / בר יהודה (LLMZ): 97 / 23
- פיק (LLFK): 255 / 192
- קריית שמונה (LLKS): 295 / 233

בקציעות (LLKZ) ובראשון לציון (LLRS) אין סימן ARP בתרשים, ולכן לא יכולנו לבדוק אותם.

האם אפשר לקבל את קואורדינטות הספים ו-ה-ARP המדודות של השדות האלה ושל שאר שדות המסלול היחיד? בלי נתון מדוד איננו מציבים את התרשים על המפה, ומציגים אותו כדף בלבד.

**4. נתבאג (LLBG)**
קצות המסלולים ב-GIS שונים מטבלת הספים ב-AD 2.12 ב-24 עד 69 מ' (בניצב לציר המסלול). התרשים ADC תואם את ה-GIS. איזה מקור הוא הקובע?

תודה רבה על הזמן והעזרה,
[שם]
[דוא"ל]

---

## English

Dear CAAI AIS team,

Thank you very much for the approval to use the GIS layers and the aerodrome charts in OpenEFB. We use the data as a situational-awareness aid only, and the app says so to the pilot.

While working with the data we found a few inconsistencies. We would be grateful if you could check them and tell us which source is authoritative.

**1. GIS layer defects**
- The Hazerim–Ofakim and Hazerim–Tzalahot routes carry the aerodrome code LLHS (Hazor). We assume LLHB (Hazerim) was meant and correct it on our side. Please confirm.
- Nevatim is published twice as an aerodrome reference point (ARP): once at Nevatim (31.213N 35.018E) and once at Negav (31.195N 35.039E, about 2.7 km from the first). The routes attach to the Negav point.
- The Samar–Ovda route line ends about 11 km from the Ovda ARP.

**2. An inconsistency inside the AIP**
- Kzioth (LLKZ): the runway length is 1600 m in the table on p. 365 and 1500 m on the chart on p. 368 (and in the chart's own table). Which is correct?

**3. Request for surveyed threshold and ARP coordinates**
When we fitted the runway drawn on the AIP charts to the GIS runway ends, the ARP symbol printed on the chart fell about 100 to 300 m from the ARP published in the AIP at these aerodromes (north / east, metres, relative to the AIP ARP):
- Herzliya (LLHZ): 98 / 6
- Megiddo (LLMG): 6 / 107
- Masada / Bar Yehuda (LLMZ): 97 / 23
- Fik (LLFK): 255 / 192
- Kiryat Shmona (LLKS): 295 / 233

The LLKZ and LLRS (Rishon LeZion) charts have no ARP symbol, so we could not check them.

Could you provide the surveyed threshold and ARP coordinates for these aerodromes and for the other single-runway fields? Without a measured value we do not place a chart on the map; we show it as a sheet only.

**4. Ben Gurion (LLBG)**
The GIS runway ends differ from the AD 2.12 threshold table by 24 to 69 m (cross-track). The ADC chart agrees with the GIS. Which source is authoritative?

Thank you for your time and help,
[name]
[e-mail]
