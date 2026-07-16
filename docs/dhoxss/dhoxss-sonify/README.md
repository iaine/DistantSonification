# The Sonic Register

Three small, framework-free tools (HTML + CSS + vanilla JS + Web Audio +
Highcharts) for graphing and sonifying a catalogue of early printed books
(STC / EEBO-TCP metadata). Built around the columns in `data/dhoxss.csv`:
`TCP, EEBO, VID, STC, Status, Author, Date, Title, Terms, Pages, Place`.

## Running it

No build step and no server required — just open `index.html` in a
browser. Each tool page also works standalone (`timeline/index.html`,
`map/index.html`, `tags/index.html`). An internet connection is needed
for the Highcharts / Google Fonts CDN scripts and, for tool II, the
Highcharts UK map data.

Each tool has a **"Load sample"** button that loads the bundled 199-row
`dhoxss.csv` instantly — use it to try the tools before uploading your own
export. To use your own data, drag a CSV onto the upload well or click
"Browse file…". Your file never leaves the browser.

## The three tools

**I. Timeline & Tone** (`timeline/`) — groups records by publication year
and charts either the number of items or total pages per year. Playback
steps through the years in order; pitch tracks the charted metric.

**II. Distance from Home** (`map/`) — plots places of publication on a
map of Britain. You set a reference point (Oxford by default; London and
Norfolk are pre-filled in the built-in gazetteer, or type in any
latitude/longitude). Playback again steps year by year; volume falls off
with each year's average distance from the reference point, and stereo
pan drifts with east/west position.

**III. Subject Cloud** (`tags/`) — splits the semicolon-separated `Terms`
column into a word cloud sized by frequency. Click a term to hear its
associated records played as a short phrase (one note per book, ordered
by year) and to list the titles underneath.

## File map

```
index.html            landing page linking the three tools
shared/style.css       shared "card-catalogue" design system
shared/common.js        CSV parser, Web Audio engine, upload wiring, mapping helpers
shared/sample-data.js   the bundled sample dataset, embedded for offline demo use
timeline/               Tool I
map/                    Tool II
tags/                   Tool III
data/dhoxss.csv         the original sample file
```

## Bringing your own data

Any CSV with these columns (case-insensitive, minor name variants like
`Year` or `Subjects` are recognised too) will work:

- `Date` — a year is extracted from the first 4-digit number found
- `Pages` — numeric page count
- `Place` — place of publication (only needed for Tool II)
- `Terms` — semicolon-separated subject headings (only needed for Tool III)
- `Title`, `Author` — used for display only

Tool II ships with coordinates for **Oxford** (reference default),
**London**, and **Norfolk** (as specified for this dataset), plus a few
other common UK/Ireland cities. Any place not recognised will prompt you
to enter its latitude/longitude in the on-page table before building the
map — those coordinates are only used in your browser, nothing is looked
up over the network.
