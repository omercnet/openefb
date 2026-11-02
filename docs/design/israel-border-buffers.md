# Israel border buffers (IL-ALERTS, efb-aac.9)

Rule: no flight within 6 km of the Gaza Strip border (LLP19), 3 km of Egypt, 6 km of Syria, 3 km of Lebanon
(domestic AIP A-17 §4b, PDF p63; docs/research/israel-cvfr.md §2). North of 33°00'N only with two-way radio and
a working transponder (A-17 §4a).

## Geometry and source

| Border | Buffer | Geometry |
|---|---|---|
| Gaza Strip | 6 km | The CAAI P-area **LLP19** polygon from `israel-aviation.sqlite` (published as the no-flight area). Not rebuilt. |
| Egypt | 3 km | Natural Earth line, `Resources/israel-border-lines.json` |
| Syria | 6 km | Natural Earth line (the line of control), same file |
| Lebanon | 3 km | Natural Earth line (12 pieces), same file |
| 33°00'N | equipment rule | Latitude test, no geometry |

`Resources/israel-border-lines.json` was cut from Natural Earth 1:10m admin-0 boundary lines
(`ne_10m_admin_0_boundary_lines_land`, public domain, https://www.naturalearthdata.com), keeping the
Israel-Egypt, Israel-Syria and Israel-Lebanon lines. Vertices are rounded to 5 decimals (about 1 m).
The Jordan border has no buffer (flight up to it is allowed) and is not in the file.

## Accuracy: what the app can and can't claim

- Natural Earth 1:10m lines are drawn for 1:10,000,000 maps. Expect up to about 1 km between the line and
  the real border. The alert text says "about 1 km accurate". A 3 km buffer is therefore known to ±1 km.
- The Syria line is Natural Earth's depiction of the 1974 line of control; the AIP buffer follows the
  ceasefire line. The two should agree to the same accuracy; an Israeli CFI should confirm (IL-12).
- The Lebanon line is split in pieces; a position between pieces is measured against the nearest.
- The alert is a **reminder from approximate data**, never a legal boundary. Red inside a buffer means "you are
  probably inside"; the pilot decides.
- Replacing the file with the CAAI P-area polygons for Egypt/Syria/Lebanon, if CAAI publishes them, only needs
  a new JSON in the same shape.

## Alert rules

- Red: inside a buffer (distance to the line ≤ buffer, either side).
- Amber: within 1 NM of a buffer, or the 2-minute projected position (ground speed × 2 min on the current track)
  is inside it. Projection needs at least 20 kt ground speed.
- 33°00'N is amber only (permitted with the equipment): position or 2-minute projection north of the line.
