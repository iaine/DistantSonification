/* ==========================================================================
   Early English Books — Sonic Register
   Shared utilities: CSV parsing, Web Audio engine, upload wiring, mapping.
   ========================================================================== */

/* ---------------------------------------------------------------------- *
 * CSV parsing — handles quoted fields, embedded commas, "" escaped quotes,
 * and quoted newlines (Author/Title/Terms fields in this dataset contain
 * commas and semicolons inside quotes).
 * ---------------------------------------------------------------------- */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // normalise line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  // drop trailing empty row
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }
  if (!rows.length) return [];

  const headers = rows[0].map(h => h.trim());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const vals = rows[r];
    if (vals.length === 1 && vals[0] === '') continue;
    const rec = {};
    headers.forEach((h, idx) => { rec[h] = (vals[idx] !== undefined ? vals[idx] : '').trim(); });
    records.push(rec);
  }
  return records;
}

/* ---------------------------------------------------------------------- *
 * Field helpers tuned to the EEBO/STC catalogue shape, but forgiving of
 * near-matches so slightly different exports still work.
 * ---------------------------------------------------------------------- */
const FIELD_ALIASES = {
  date:  ['Date', 'Year', 'Publication Date'],
  pages: ['Pages', 'Page Count', 'Extent'],
  place: ['Place', 'Place of Publication', 'Location'],
  terms: ['Terms', 'Tags', 'Subjects', 'Subject Terms'],
  title: ['Title'],
  author:['Author'],
};

function findField(record, key) {
  const aliases = FIELD_ALIASES[key] || [key];
  for (const a of aliases) if (a in record) return a;
  // case-insensitive fallback
  const lower = aliases.map(a => a.toLowerCase());
  for (const k of Object.keys(record)) if (lower.includes(k.toLowerCase())) return k;
  return null;
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function splitTerms(termStr) {
  if (!termStr) return [];
  return termStr.split(';').map(s => s.trim()).filter(Boolean);
}

/* ---------------------------------------------------------------------- *
 * Numeric mapping helpers
 * ---------------------------------------------------------------------- */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function mapRange(value, inMin, inMax, outMin, outMax, curve) {
  curve = curve || 'linear';
  if (inMax === inMin) return (outMin + outMax) / 2;
  let t = (value - inMin) / (inMax - inMin);
  t = clamp(t, 0, 1);
  if (curve === 'log') {
    // perceptual-ish curve, keeps t in [0,1] but bends it
    t = Math.log10(1 + 9 * t);
  } else if (curve === 'exp') {
    t = t * t;
  }
  return outMin + t * (outMax - outMin);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ---------------------------------------------------------------------- *
 * Web Audio engine — a small monophonic-per-voice tone generator with a
 * soft attack/release envelope so notes don't click. Lazily creates the
 * AudioContext on first user gesture (required by browsers).
 * ---------------------------------------------------------------------- */
class SonifyEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._voices = [];
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get currentTime() { return this.ctx ? this.ctx.currentTime : 0; }

  /**
   * Schedule a tone.
   * @param {number} freq - Hz
   * @param {object} opts - {when, duration, volume(0-1), wave, pan(-1..1)}
   */
  playNote(freq, opts) {
    const ctx = this.ensure();
    const when = (opts.when !== undefined ? opts.when : ctx.currentTime);
    const dur = opts.duration || 0.35;
    const vol = clamp(opts.volume !== undefined ? opts.volume : 0.6, 0, 1);
    const wave = opts.wave || 'triangle';

    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(Math.max(20, freq), when);

    const gain = ctx.createGain();
    const attack = Math.min(0.03, dur * 0.25);
    const release = Math.min(0.12, dur * 0.5);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0005), when + attack);
    gain.gain.setValueAtTime(Math.max(vol, 0.0005), when + Math.max(attack, dur - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    let node = osc;
    if (opts.pan !== undefined && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(opts.pan, -1, 1);
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      osc.connect(gain);
      gain.connect(this.master);
    }

    osc.start(when);
    osc.stop(when + dur + 0.05);
    this._voices.push(osc);
    osc.onended = () => {
      const i = this._voices.indexOf(osc);
      if (i >= 0) this._voices.splice(i, 1);
    };
    return { osc, gain, when, dur };
  }

  stopAll() {
    this._voices.forEach(o => { try { o.stop(); } catch (e) {} });
    this._voices = [];
  }
}

/* ---------------------------------------------------------------------- *
 * Upload wiring — click, drag/drop, and "load sample" all funnel into the
 * same onData(records, meta) callback.
 * ---------------------------------------------------------------------- */
function wireUpload({ dropZone, fileInput, browseBtn, sampleBtn, statusEl }, onData) {
  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const records = parseCSV(reader.result);
        if (!records.length) throw new Error('No rows found in file.');
        onData(records, { filename: file.name });
      } catch (e) {
        showError(statusEl, 'Could not read that file: ' + e.message);
      }
    };
    reader.onerror = () => showError(statusEl, 'Could not read that file.');
    reader.readAsText(file);
  }

  if (browseBtn && fileInput) browseBtn.addEventListener('click', () => fileInput.click());
  if (fileInput) fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(ev =>
      dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev =>
      dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); }));
    dropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
  }
  if (sampleBtn) sampleBtn.addEventListener('click', () => {
    const records = parseCSV(SAMPLE_CSV);
    onData(records, { filename: 'dhoxss.csv (sample)' });
  });
}

function showError(el, msg) {
  if (!el) { console.error(msg); return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

/* small helper for building an even musical-ish scale from a range */
function frequencyScale(min, max, steps) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    out.push(min * Math.pow(max / min, i / Math.max(1, steps - 1)));
  }
  return out;
}
