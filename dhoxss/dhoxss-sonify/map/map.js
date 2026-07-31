(function () {
  const engine = new SonifyEngine();

  // Built-in gazetteer — only used as a fallback when the uploaded file has
  // no Latitude/Longitude columns of its own. Norm key = lowercased place name.
  const GAZETTEER = {
    'oxford':    { lat: 51.7520, lon: -1.2577 },
    'london':    { lat: 51.5075, lon: 0.1275 },
    'norfolk':   { lat: 52.630886, lon: 1.297355 },
    'norwich':   { lat: 52.6309, lon: 1.2974 },
    'cambridge': { lat: 52.2053, lon: 0.1218 },
    'york':      { lat: 53.9600, lon: -1.0873 },
    'edinburgh': { lat: 55.9533, lon: -3.1883 },
    'dublin':    { lat: 53.3498, lon: -6.2603 },
    'bristol':   { lat: 51.4545, lon: -2.5879 },
    'canterbury':{ lat: 51.2802, lon: 1.0789 },
  };

  const els = {};
  ['dropZone','fileInput','browseBtn','sampleBtn','err','metaStrip','setupZone',
   'refName','refLat','refLon','presetOxford','presetLondon','presetNorfolk','useGeo',
   'placesHint','placeTable','placeTableBody','buildBtn','chartWrap','controls','transport',
   'metricSel','waveSel','volModeSel','tempoRange','tempoVal','minFreq','maxFreq',
   'playBtn','stopBtn','needle','playPos'
  ].forEach(id => els[id] = document.getElementById(id));

  let records = [];
  let dateField = null, placeField = null, pagesField = null, latField = null, lonField = null;
  let usingCoords = false;         // true when the file supplies its own Latitude/Longitude
  let placeCounts = new Map();     // place label -> count (gazetteer-mode only)
  let placeCoords = new Map();     // normalized place -> {lat,lon,label} (gazetteer-mode only)
  let resolved = [];               // per-record: {r, lat, lon} or {r, lat:null, lon:null}
  let excludedCount = 0;
  let years = [];                  // aggregated per year
  let mapTopology = null;
  let mapChart = null;
  let playToken = 0;

  wireUpload({
    dropZone: els.dropZone, fileInput: els.fileInput, browseBtn: els.browseBtn,
    sampleBtn: els.sampleBtn, statusEl: els.err,
  }, onData);

  els.presetOxford.addEventListener('click', () => setRef('Oxford', 51.7520, -1.2577));
  els.presetLondon.addEventListener('click', () => setRef('London', 51.5075, 0.1275));
  els.presetNorfolk.addEventListener('click', () => setRef('Norfolk', 52.630886, 1.297355));
  els.useGeo.addEventListener('click', () => {
    if (!navigator.geolocation) { showError(els.err, 'Geolocation is not available in this browser.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setRef('My location', pos.coords.latitude, pos.coords.longitude),
      () => showError(els.err, 'Could not get your location — enter coordinates manually instead.')
    );
  });
  function setRef(name, lat, lon) {
    els.refName.value = name; els.refLat.value = lat.toFixed(4); els.refLon.value = lon.toFixed(4);
  }

  els.buildBtn.addEventListener('click', build);
  els.tempoRange.addEventListener('input', () => { els.tempoVal.textContent = els.tempoRange.value + ' ms / year'; });
  [els.metricSel, els.waveSel, els.volModeSel, els.minFreq, els.maxFreq].forEach(el =>
    el.addEventListener('change', () => { if (years.length) renderMap(); }));
  els.playBtn.addEventListener('click', play);
  els.stopBtn.addEventListener('click', stop);

  function toFloat(v) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function onData(recs, meta) {
    clearError(els.err);
    if (!recs.length) { showError(els.err, 'No rows found in that file.'); return; }
    dateField = findField(recs[0], 'date');
    placeField = findField(recs[0], 'place');
    pagesField = findField(recs[0], 'pages');
    latField = findField(recs[0], 'latitude');
    lonField = findField(recs[0], 'longitude');
    usingCoords = !!(latField && lonField);

    if (!dateField) { showError(els.err, 'Could not find a Date column in this file.'); return; }
    if (!usingCoords && !placeField) {
      showError(els.err, 'Could not find Latitude/Longitude columns, or a Place column to fall back on.');
      return;
    }

    records = recs;
    placeCounts = new Map();
    records.forEach(r => {
      const p = (placeField ? (r[placeField] || '').trim() : '') || '(unspecified)';
      placeCounts.set(p, (placeCounts.get(p) || 0) + 1);
    });

    els.metaStrip.classList.remove('hidden');
    els.metaStrip.innerHTML =
      `<span><b>${meta.filename}</b></span>` +
      `<span>${records.length} records</span>` +
      `<span>${usingCoords ? 'Located via Latitude / Longitude columns' : (placeCounts.size + ' distinct places')}</span>`;

    if (usingCoords) buildCoordSummary(); else buildPlaceTable();

    els.setupZone.classList.remove('hidden');
    els.chartWrap.classList.add('hidden');
    els.controls.classList.add('hidden');
    els.transport.classList.add('hidden');
    stop();
  }

  /* -- coordinate-column mode: read-only summary of each record's own lat/lon -- */
  function buildCoordSummary() {
    els.placeTable.classList.add('readonly-table');
    let invalid = 0;
    const clusters = new Map(); // rounded "lat,lon" -> {lat,lon,labels:Set,count}
    records.forEach(r => {
      const lat = toFloat(r[latField]), lon = toFloat(r[lonField]);
      const ok = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
      if (!ok) { invalid++; return; }
      const key = lat.toFixed(3) + ',' + lon.toFixed(3);
      if (!clusters.has(key)) clusters.set(key, { lat, lon, labels: new Set(), count: 0 });
      const c = clusters.get(key);
      c.count += 1;
      if (placeField) c.labels.add((r[placeField] || '').trim() || '(unspecified)');
    });

    const sorted = Array.from(clusters.values()).sort((a, b) => b.count - a.count);
    els.placeTableBody.innerHTML = '';
    sorted.forEach(c => {
      const tr = document.createElement('tr');
      const label = c.labels.size ? Array.from(c.labels).join(', ') : '—';
      tr.innerHTML = `
        <td>${escapeHtml(label)}</td>
        <td>${c.count}</td>
        <td>${c.lat.toFixed(4)}</td>
        <td>${c.lon.toFixed(4)}</td>
        <td class="resolved">from Latitude/Longitude columns</td>
      `;
      els.placeTableBody.appendChild(tr);
    });

    els.placesHint.textContent = invalid
      ? `${clusters.size} distinct coordinate location(s) read straight from the file's Latitude/Longitude columns — ${invalid} record(s) have missing or invalid coordinates and will be excluded.`
      : `${clusters.size} distinct coordinate location(s) read straight from the file's Latitude/Longitude columns. Each record uses its own coordinates, even where the Place name repeats.`;
  }

  /* -- fallback mode: editable gazetteer table keyed by place name -- */
  function buildPlaceTable() {
    els.placeTable.classList.remove('readonly-table');
    els.placeTableBody.innerHTML = '';
    let unresolvedCount = 0;
    const sorted = Array.from(placeCounts.entries()).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([place, count]) => {
      const key = place.toLowerCase();
      const known = GAZETTEER[key];
      if (!known) unresolvedCount++;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(place)}</td>
        <td>${count}</td>
        <td><input type="number" step="0.0001" class="lat-in" value="${known ? known.lat : ''}" placeholder="lat"></td>
        <td><input type="number" step="0.0001" class="lon-in" value="${known ? known.lon : ''}" placeholder="lon"></td>
        <td class="${known ? 'resolved' : 'unresolved'}">${known ? 'found' : 'enter coordinates'}</td>
      `;
      tr.dataset.place = place;
      els.placeTableBody.appendChild(tr);
    });
    els.placesHint.textContent = `No Latitude/Longitude columns found in this file — falling back to place names. ` +
      (unresolvedCount
        ? `${unresolvedCount} place(s) need coordinates before building (London & Norfolk are pre-filled; add others as needed).`
        : `All places resolved from the built-in gazetteer. Edit any row to override.`);
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* -- resolve a lat/lon for every record, in whichever mode is active -- */
  function resolveRecords() {
    const out = [];
    let excluded = 0;
    records.forEach(r => {
      let lat = null, lon = null;
      if (usingCoords) {
        const la = toFloat(r[latField]), lo = toFloat(r[lonField]);
        if (la !== null && lo !== null && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { lat = la; lon = lo; }
      } else {
        const place = (placeField ? (r[placeField] || '').trim() : '') || '(unspecified)';
        const coord = placeCoords.get(place.toLowerCase());
        if (coord) { lat = coord.lat; lon = coord.lon; }
      }
      if (lat === null || lon === null) { excluded++; out.push({ r, lat: null, lon: null }); return; }
      out.push({ r, lat, lon });
    });
    return { out, excluded };
  }

  async function build() {
    clearError(els.err);

    if (!usingCoords) {
      // read gazetteer-mode coordinates from the editable table
      placeCoords = new Map();
      const rows = els.placeTableBody.querySelectorAll('tr');
      let missing = [];
      rows.forEach(tr => {
        const place = tr.dataset.place;
        const lat = parseFloat(tr.querySelector('.lat-in').value);
        const lon = parseFloat(tr.querySelector('.lon-in').value);
        if (isNaN(lat) || isNaN(lon)) { missing.push(place); return; }
        placeCoords.set(place.toLowerCase(), { lat, lon, label: place });
      });
      if (missing.length) {
        showError(els.err, `Missing coordinates for: ${missing.join(', ')}. Fill these in or they will be excluded.`);
      }
    }

    const refLat = parseFloat(els.refLat.value), refLon = parseFloat(els.refLon.value);
    if (isNaN(refLat) || isNaN(refLon)) { showError(els.err, 'Reference latitude/longitude must be numbers.'); return; }

    const { out, excluded } = resolveRecords();
    resolved = out;
    excludedCount = excluded;
    years = aggregateByYear(refLat, refLon);
    if (!years.length) { showError(els.err, 'No records could be located — check the coordinates above.'); return; }

    els.buildBtn.textContent = 'Loading map…';
    els.buildBtn.disabled = true;
    try {
      if (!mapTopology) {
        const resp = await fetch('https://code.highcharts.com/mapdata/countries/gb/gb-all.topo.json');
        mapTopology = await resp.json();
      }
    } catch (e) {
      showError(els.err, 'Could not load the base map (offline?). Sonification will still work without it.');
    }
    els.buildBtn.textContent = 'Build map & sonification';
    els.buildBtn.disabled = false;

    els.chartWrap.classList.remove('hidden');
    els.controls.classList.remove('hidden');
    els.transport.classList.remove('hidden');
    renderMap();

    if (excludedCount) {
      showError(els.err, `${excludedCount} of ${records.length} record(s) excluded from the map/sonification — missing or invalid coordinates.`);
    }
  }

  function aggregateByYear(refLat, refLon) {
    const map = new Map();
    resolved.forEach(({ r, lat, lon }) => {
      if (lat === null || lon === null) return;
      const y = extractYear(r[dateField]);
      if (y === null) return;
      const place = (placeField ? (r[placeField] || '').trim() : '') || '(unspecified)';
      const p = pagesField ? (parseInt(String(r[pagesField]).replace(/[^\d]/g, ''), 10) || 0) : 0;
      if (!map.has(y)) map.set(y, { year: y, count: 0, pages: 0, distSum: 0, lonSum: 0, places: {} });
      const e = map.get(y);
      const dist = haversineKm(refLat, refLon, lat, lon);
      e.count += 1;
      e.pages += p;
      e.distSum += dist;
      e.lonSum += lon;
      e.places[place] = (e.places[place] || 0) + 1;
    });
    return Array.from(map.values()).map(e => ({
      ...e,
      avgDist: e.distSum / e.count,
      avgLon: e.lonSum / e.count,
    })).sort((a, b) => a.year - b.year);
  }

  function currentPlacePoints() {
    // group resolved, located records into map markers by rounded coordinate
    const clusters = new Map();
    resolved.forEach(({ r, lat, lon }) => {
      if (lat === null || lon === null) return;
      const key = lat.toFixed(3) + ',' + lon.toFixed(3);
      if (!clusters.has(key)) clusters.set(key, { lat, lon, labels: new Set(), count: 0 });
      const c = clusters.get(key);
      c.count += 1;
      if (placeField) c.labels.add((r[placeField] || '').trim() || '(unspecified)');
    });
    return Array.from(clusters.values()).map(c => ({
      name: c.labels.size ? Array.from(c.labels).join(' / ') : `${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`,
      lat: c.lat, lon: c.lon, z: c.count,
    }));
  }

  function renderMap() {
    const refName = els.refName.value || 'Reference';
    const refLat = parseFloat(els.refLat.value), refLon = parseFloat(els.refLon.value);

    const placePoints = currentPlacePoints();
    const counts = placePoints.map(p => p.z);
    const cMin = Math.min(...counts), cMax = Math.max(...counts);
    placePoints.forEach(p => {
      p.marker = { radius: mapRange(p.z, cMin, cMax, 7, 24, 'log') };
    });

    const lines = placePoints.map(p => ({
      geometry: { type: 'LineString', coordinates: [[refLon, refLat], [p.lon, p.lat]] },
    }));

    const series = [];
    if (mapTopology) {
      series.push({
        type: 'map', name: 'Britain', mapData: mapTopology,
        borderColor: '#cfc4a0', nullColor: '#ece7d6',
        enableMouseTracking: false, showInLegend: false,
      });
      series.push({
        type: 'mapline', name: 'Distance', data: lines,
        color: '#a9862f', lineWidth: 1, dashStyle: 'Dot',
        enableMouseTracking: false, showInLegend: false,
      });
    }
    series.push({
      type: 'mappoint', name: refName,
      data: [{ name: refName, lat: refLat, lon: refLon }],
      marker: { symbol: 'diamond', radius: 8, fillColor: '#8b2e1f', lineColor: '#1b2a22', lineWidth: 1 },
      dataLabels: { enabled: true, format: '{point.name}', style: { fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace', color: '#1b2a22', textOutline: '2px #ece7d6' } },
      showInLegend: false,
    });
    series.push({
      type: 'mappoint', name: 'Places',
      data: placePoints,
      color: '#1b2a22',
      marker: { symbol: 'circle', fillColor: 'rgba(139,46,31,0.55)', lineColor: '#8b2e1f', lineWidth: 1 },
      dataLabels: { enabled: true, format: '{point.name} ({point.z})', style: { fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace', color: '#1b2a22', textOutline: '2px #ece7d6' } },
      showInLegend: false,
      tooltip: { pointFormat: '{point.name}: {point.z} records' },
    });

    const opts = {
      chart: { backgroundColor: 'transparent', style: { fontFamily: 'IBM Plex Mono, monospace' } },
      title: { text: null },
      credits: { enabled: false },
      mapView: { padding: 12 },
      legend: { enabled: false },
      series: series,
    };
    if (mapTopology) opts.chart.map = mapTopology;

    mapChart = Highcharts.mapChart('mapChart', opts);
  }

  function currentMetricValues() {
    const metric = els.metricSel.value;
    return years.map(y => metric === 'pages' ? y.pages : y.count);
  }

  function volumeForYear(y) {
    const dists = years.map(v => v.avgDist);
    const dMin = Math.min(...dists), dMax = Math.max(...dists);
    const near = els.volModeSel.value === 'near';
    const lo = 0.08, hi = 0.9;
    return near
      ? mapRange(y.avgDist, dMin, dMax, hi, lo, 'linear')   // closer (small dist) -> loud
      : mapRange(y.avgDist, dMin, dMax, lo, hi, 'linear');  // farther -> loud
  }

  function panForYear(y) {
    const lons = years.map(v => v.avgLon);
    const lo = Math.min(...lons), hi = Math.max(...lons);
    if (lo === hi) return 0;
    return mapRange(y.avgLon, lo, hi, -0.7, 0.7, 'linear');
  }

  function freqForIndex(i) {
    const vals = currentMetricValues();
    const min = Math.min(...vals), max = Math.max(...vals);
    const lo = parseFloat(els.minFreq.value) || 110;
    const hi = parseFloat(els.maxFreq.value) || 1046;
    return mapRange(vals[i], min, max, lo, hi, 'log');
  }

  function highlightIndex(i) {
    const pct = years.length > 1 ? (i / (years.length - 1)) * 100 : 0;
    els.needle.style.left = clamp(pct, 0, 100) + '%';
    if (i >= 0 && years[i]) {
      const y = years[i];
      const placeList = Object.entries(y.places).map(([p, c]) => `${p} (${c})`).join(', ');
      els.playPos.textContent = `${y.year} — ${y.count} items, avg ${y.avgDist.toFixed(0)} km from ${els.refName.value} — ${placeList}`;
    } else {
      els.playPos.textContent = '—';
    }
  }

  function play() {
    if (!years.length) return;
    stop();
    const myToken = ++playToken;
    const stepMs = parseFloat(els.tempoRange.value);
    const stepSec = stepMs / 1000;
    const wave = els.waveSel.value;
    const startCtxTime = engine.ensure().currentTime + 0.08;

    years.forEach((y, i) => {
      const freq = freqForIndex(i);
      engine.playNote(freq, {
        when: startCtxTime + i * stepSec,
        duration: Math.min(stepSec * 0.92, 1.2),
        volume: volumeForYear(y),
        wave: wave,
        pan: panForYear(y),
      });
    });

    els.playBtn.disabled = true;
    const totalMs = years.length * stepMs + 200;
    const t0 = performance.now();
    function frame() {
      if (myToken !== playToken) return;
      const elapsed = performance.now() - t0;
      const idx = Math.min(years.length - 1, Math.floor(elapsed / stepMs));
      highlightIndex(idx);
      if (elapsed < totalMs) requestAnimationFrame(frame);
      else { highlightIndex(-1); els.playBtn.disabled = false; }
    }
    requestAnimationFrame(frame);
  }

  function stop() {
    playToken++;
    engine.stopAll();
    els.playBtn.disabled = false;
    highlightIndex(-1);
  }
})();
