(function () {
  const engine = new SonifyEngine();

  const els = {};
  ['dropZone','fileInput','browseBtn','sampleBtn','err','metaStrip','controls',
   'waveSel','pitchBySel','tempoRange','tempoVal','minFreq','maxFreq',
   'chartWrap','resultZone','nowPlaying','replayBtn','stopBtn','titlesBody'
  ].forEach(id => els[id] = document.getElementById(id));

  let records = [];
  let termsField = null, dateField = null, pagesField = null, titleField = null, authorField = null;
  let tagIndex = new Map(); // tag -> [record,...]
  let chart = null;
  let lastTag = null;
  let playToken = 0;

  wireUpload({
    dropZone: els.dropZone, fileInput: els.fileInput, browseBtn: els.browseBtn,
    sampleBtn: els.sampleBtn, statusEl: els.err,
  }, onData);

  els.tempoRange.addEventListener('input', () => { els.tempoVal.textContent = els.tempoRange.value + ' ms'; });
  els.replayBtn.addEventListener('click', () => { if (lastTag) sonifyTag(lastTag); });
  els.stopBtn.addEventListener('click', stop);

  function onData(recs, meta) {
    clearError(els.err);
    if (!recs.length) { showError(els.err, 'No rows found in that file.'); return; }
    termsField = findField(recs[0], 'terms');
    dateField = findField(recs[0], 'date');
    pagesField = findField(recs[0], 'pages');
    titleField = findField(recs[0], 'title');
    authorField = findField(recs[0], 'author');
    if (!termsField) { showError(els.err, 'Could not find a Terms/Subjects column in this file.'); return; }

    records = recs;
    tagIndex = new Map();
    records.forEach(r => {
      splitTerms(r[termsField]).forEach(tag => {
        if (!tagIndex.has(tag)) tagIndex.set(tag, []);
        tagIndex.get(tag).push(r);
      });
    });

    if (!tagIndex.size) { showError(els.err, 'No subject terms found — check the Terms column is semicolon-separated.'); return; }

    stop();
    els.metaStrip.classList.remove('hidden');
    els.metaStrip.innerHTML =
      `<span><b>${meta.filename}</b></span>` +
      `<span>${records.length} records</span>` +
      `<span>${tagIndex.size} distinct terms</span>`;

    els.controls.classList.remove('hidden');
    els.chartWrap.classList.remove('hidden');
    els.resultZone.classList.add('hidden');
    renderCloud();
  }

  function renderCloud() {
    const data = Array.from(tagIndex.entries())
      .map(([tag, recs]) => ({ name: tag, weight: recs.length }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 160); // keep it legible

    chart = Highcharts.chart('cloud', {
      chart: { backgroundColor: 'transparent', style: { fontFamily: 'Spectral, serif' } },
      title: { text: null },
      credits: { enabled: false },
      series: [{
        type: 'wordcloud',
        data: data,
        name: 'Occurrences',
        rotation: { from: 0, to: 0, orientations: 1 },
        minFontSize: 11,
        maxFontSize: 52,
        style: { fontFamily: 'Cormorant Garamond, serif', fontWeight: '600' },
        colors: ['#1b2a22', '#8b2e1f', '#a9862f', '#3c4a3f', '#6b4a2a'],
        point: { events: { click: function () { sonifyTag(this.name); } } },
      }],
      tooltip: {
        backgroundColor: '#f4f0e2', borderColor: '#b9ae8d',
        style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px' },
        formatter: function () { return `<b>${this.point.name}</b><br>${this.point.weight} record(s) — click to play`; },
      },
    });
  }

  function sonifyTag(tag) {
    const recs = tagIndex.get(tag);
    if (!recs) return;
    lastTag = tag;
    stop();

    // order records: by year (with fallback to original order) for a legible phrase
    const withYear = recs.map((r, idx) => ({
      r, idx,
      year: dateField ? extractYear(r[dateField]) : null,
      pages: pagesField ? (parseInt(String(r[pagesField]).replace(/[^\d]/g, ''), 10) || 0) : 0,
    }));
    const ordered = withYear.slice().sort((a, b) => {
      if (a.year !== null && b.year !== null && a.year !== b.year) return a.year - b.year;
      return a.idx - b.idx;
    });

    els.resultZone.classList.remove('hidden');
    els.nowPlaying.textContent = `Now playing “${tag}” — ${ordered.length} record(s)`;
    fillTitlesTable(ordered);

    const pitchBy = els.pitchBySel.value;
    let values;
    if (pitchBy === 'pages') values = ordered.map(o => o.pages);
    else if (pitchBy === 'year') values = ordered.map(o => o.year !== null ? o.year : 0);
    else values = ordered.map((o, i) => i);
    const vMin = Math.min(...values), vMax = Math.max(...values);
    const lo = parseFloat(els.minFreq.value) || 196;
    const hi = parseFloat(els.maxFreq.value) || 988;

    const myToken = ++playToken;
    const stepMs = parseFloat(els.tempoRange.value);
    const stepSec = stepMs / 1000;
    const wave = els.waveSel.value;
    const startCtxTime = engine.ensure().currentTime + 0.06;

    ordered.forEach((o, i) => {
      const freq = mapRange(values[i], vMin, vMax, lo, hi, 'log');
      engine.playNote(freq, {
        when: startCtxTime + i * stepSec,
        duration: Math.min(stepSec * 0.9, 0.9),
        volume: 0.6,
        wave: wave,
      });
    });

    // highlight rows in time with playback
    const rows = els.titlesBody.querySelectorAll('tr');
    const totalMs = ordered.length * stepMs + 200;
    const t0 = performance.now();
    function frame() {
      if (myToken !== playToken) return;
      const elapsed = performance.now() - t0;
      const idx = Math.floor(elapsed / stepMs);
      rows.forEach((row, i) => row.style.background = (i === idx) ? 'var(--paper-dim)' : '');
      if (elapsed < totalMs) requestAnimationFrame(frame);
      else rows.forEach(row => row.style.background = '');
    }
    requestAnimationFrame(frame);
  }

  function fillTitlesTable(ordered) {
    els.titlesBody.innerHTML = '';
    ordered.forEach(o => {
      const r = o.r;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${o.year !== null ? o.year : '—'}</td>
        <td>${escapeHtml(titleField ? (r[titleField] || '') : '').slice(0, 140)}</td>
        <td>${escapeHtml(authorField ? (r[authorField] || '') : '').slice(0, 60)}</td>
        <td>${o.pages || '—'}</td>
      `;
      els.titlesBody.appendChild(tr);
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function stop() {
    playToken++;
    engine.stopAll();
  }
})();
