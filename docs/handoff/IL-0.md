# IL-0: Draft the permission request to CAAI (beads efb-aac.1; dashboard ticket T03)

Draft (don't send) an email to the Civil Aviation Authority of Israel AIS (`aip@mot.gov.il`; check
docs/research/israel-cvfr.md and the gov.il AIP page for the right address and any form) asking for written permission
to include the CAAI GIS layer packages in OpenEFB. The layers are: CVFR routes, CVFR reporting points, CTR/ATZ, TMA,
P/R/D, FIR and runways, from `https://www.gov.il/he/pages/aip?chapterIndex=11`.

The email must:
- say who we are: OpenEFB, a free, open-source (MPL-2.0) iPad VFR moving-map app, non-commercial, at
  https://github.com/sternryan/openefb;
- say exactly what we'd do: convert the layers to the app's own format, ship them inside the app, publish the conversion
  script, show the AIP amendment date in the app, and update them every amendment;
- state the use: a situational-awareness aid only, never replacing the official publications;
- ask:
  - whether the GIS layers may be redistributed in the app binary and in the source repository, and under what
    attribution;
  - whether the official CVFR chart can be licensed (we know Mapa Ltd holds the geographic rights);
  - whether there is a machine-readable NOTAM or route-closure feed;
- be polite, short (under 250 words), and in both Hebrew and English (Hebrew first).

Write it to docs/research/israel-caai-permission-request.md with a short "how to send" note for the owner at the top.
Also note which research samples in docs/research/israel-cvfr-samples/ are CAAI-derived (GeoJSON extracts, domestic AIP
text), so the owner knows what to keep out of a public push until permission arrives.

Docs only: no code, no simulator. Another agent (T24) is editing Swift code and tools/nasr-importer, so leave those alone.
Report when done.
