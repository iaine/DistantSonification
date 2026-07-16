(function () {
  const engine = new SonifyEngine();

  const els = {
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    browseBtn: document.getElementById('browseBtn'),
    sampleBtn: document.getElementById('sampleBtn'),
    err: document.getElementById('err'),
    metaStrip: document.getElementById('metaStrip'),
    controls: document.getElementById('controls'),
    chartWrap: document.getElementById('chartWrap'),
    transport: document.getElementById('transport'),
    metricSel: document.getElementById('metricSel'),
    waveSel: document.getElementById('waveSel'),
    curveSel: document.getElementById('curveSel'),
    tempoRange: document.getElementById('tempoRange'),
    tempoVal: document.getElementById('tempoVal'),
    minFreq: document.getElementById('minFreq'),
    maxFreq: document.getElementById('maxFreq'),
    playBtn: document.getElementById('playBtn'),
    stopBtn: document.getElementById('stopBtn'),
    needleStrip: document.getElementById('needleStrip'),
    needle: document.getElementById('needle'),
    playPos: document.getElementById('playPos'),
    clickHint: document.getElementById('clickHint'),
  };

  let years = [];        // [{year, count, pages}]
  let chart = null;
  let playToken = 0;      // increments to invalidate in-flight playback loops

  wireUpload(els, onData);

  els.tempoRange.addEventListener('input', () => {
    els.tempoVal.textContent = els.tempoRange.value + ' ms / year';
  });
  [els.metricSel, els.waveSel, els.curveSel, els.minFreq, els.maxFreq].forEach(el =>
    el.addEventListener('change', () => { renderChart(); }));
  els.playBtn.addEventListener('click', play);
  els.stopBtn.addEventListener('click', stop);

  function onData(records, meta) {
    clearError(els.err);
    try {
      years = aggregate(records);
      if (!years.length) throw new Error('No usable Date values found in that file.');
    } catch (e) {
      showError(els.err, e.message);
      return;
    }
    stop();
    els.metaStrip.classList.remove('hidden');
    els.controls.classList.remove('hidden');
    els.chartWrap.classList.remove('hidden');
    els.transport.classList.remove('hidden');
    els.clickHint.textContent = 'Tip: click any bar to hear that year on its own.';

    const totalItems = records.length;
    const yr0 = years[0].year, yr1 = years[years.length - 1].year;
    els.metaStrip.innerHTML =
      `<span><b>${meta.filename}</b></span>` +
      `<span>${totalItems} records</span>` +
      `<span>${years.length} distinct years</span>` +
      `<span>${yr0}–${yr1}</span>`;

    renderChart();
  }

  function aggregate(records) {
    const dateField = findField(records[0], 'date');
    const pagesField = findField(records[0], 'pages');
    if (!dateField) throw new Error('Could not find a Date column in this file.');

    const map = new Map();
    records.forEach(r => {
      const y = extractYear(r[dateField]);
      if (y === null) return;
      const p = pagesField ? (parseInt(String(r[pagesField]).replace(/[^\d]/g, ''), 10) || 0) : 0;
      if (!map.has(y)) map.set(y, { year: y, count: 0, pages: 0 });
      const e = map.get(y);
      e.count += 1;
      e.pages += p;
    });
    return Array.from(map.values()).sort((a, b) => a.year - b.year);
  }

  function currentMetricValues() {
    const metric = els.metricSel.value;
    return years.map(y => metric === 'pages' ? y.pages : y.count);
  }

  function renderChart() {
    const metric = els.metricSel.value;
    const label = metric === 'pages' ? 'Total pages' : 'Number of items';
    const vals = currentMetricValues();
    const categories = years.map(y => String(y.year));

    chart = Highcharts.chart('chart', {
      chart: {
        type: 'column',
        backgroundColor: 'transparent',
        style: { fontFamily: 'IBM Plex Mono, monospace' },
        animation: false,
      },
      title: { text: null },
      credits: { enabled: false },
      xAxis: {
        categories: categories,
        lineColor: '#b9ae8d',
        tickColor: '#b9ae8d',
        labels: { style: { color: '#3c4a3f', fontSize: '10px' }, step: Math.ceil(categories.length / 30) },
        plotLines: [{ id: 'playhead', value: -1, width: 2, color: '#8b2e1f', zIndex: 5 }],
      },
      yAxis: {
        title: { text: label, style: { color: '#3c4a3f' } },
        gridLineColor: '#e3dcc4',
        labels: { style: { color: '#3c4a3f' } },
      },
      legend: { enabled: false },
      tooltip: {
        backgroundColor: '#f4f0e2',
        borderColor: '#b9ae8d',
        style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px' },
        formatter: function () {
          const y = years[this.point.index];
          return `<b>${y.year}</b><br>Items: ${y.count}<br>Pages: ${y.pages}`;
        },
      },
      plotOptions: {
        column: {
          color: '#a9862f',
          borderRadius: 1,
          borderWidth: 0,
          point: {
            events: {
              click: function () { playOne(this.index); },
            },
          },
          states: { hover: { color: '#8b2e1f' } },
        },
      },
      series: [{ name: label, data: vals }],
    });
  }

  function freqForIndex(i) {
    const vals = currentMetricValues();
    const min = Math.min(...vals), max = Math.max(...vals);
    const lo = parseFloat(els.minFreq.value) || 110;
    const hi = parseFloat(els.maxFreq.value) || 1046;
    const curve = els.curveSel.value;
    return mapRange(vals[i], min, max, lo, hi, curve);
  }

  function playOne(i) {
    const freq = freqForIndex(i);
    engine.playNote(freq, { duration: 0.5, volume: 0.7, wave: els.waveSel.value });
    highlightIndex(i);
    setTimeout(() => highlightIndex(-1), 550);
  }

  function highlightIndex(i) {
    if (!chart) return;
    const xAxis = chart.xAxis[0];
    const line = xAxis.plotLinesAndBands.find(p => p.id === 'playhead');
    xAxis.removePlotLine('playhead');
    xAxis.addPlotLine({ id: 'playhead', value: i, width: 2, color: '#8b2e1f', zIndex: 5 });
    const pct = years.length > 1 ? (i / (years.length - 1)) * 100 : 0;
    els.needle.style.left = clamp(pct, 0, 100) + '%';
    els.playPos.textContent = i >= 0 && years[i] ? `${years[i].year} — ${years[i].count} items, ${years[i].pages} pages` : '—';
  }

  function play() {
    if (!years.length) return;
    stop(); // cancel any prior playback
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
        volume: 0.65,
        wave: wave,
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
      if (elapsed < totalMs) {
        requestAnimationFrame(frame);
      } else {
        highlightIndex(-1);
        els.playBtn.disabled = false;
      }
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
