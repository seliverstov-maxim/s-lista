/* ---------- Распознавание высоты звука (YIN) и нажатий ---------- */
const A4 = 440;
const midiToFreq = (m) => A4 * Math.pow(2, (m - 69) / 12);
const freqToMidiF = (f) => 69 + 12 * Math.log2(f / A4);

/* YIN: x — буфер, off — начало окна, W — длина окна.
   Возвращает период (в отсчётах, с дробной частью) и апериодичность (0 — чистый тон). */
function yinDetect(x, off, W, tauMin, tauMax, d, cmnd, thr) {
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    const o2 = off + tau;
    for (let j = 0; j < W; j++) {
      const v = x[off + j] - x[o2 + j];
      s += v * v;
    }
    d[tau] = s;
  }
  cmnd[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  const localMin = (t) => { while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++; return t; };
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < thr) { tau = localMin(t); break; }
  }
  if (tau < 0) {
    // порог не пройден (например, звучат две ноты): берём глобальный минимум,
    // но предпочитаем более короткий период, если он почти так же хорош (защита от ошибки на октаву вниз)
    let m = Infinity;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < m) { m = cmnd[t]; tau = t; }
    for (let k = 4; k >= 2; k--) {
      const c = tau / k;
      if (c < tauMin) continue;
      const r = Math.max(2, Math.round(c * 0.04));
      let bt = -1, bv = Infinity;
      for (let t = Math.max(tauMin, Math.floor(c - r)); t <= Math.min(tauMax, Math.ceil(c + r)); t++) {
        if (cmnd[t] < bv) { bv = cmnd[t]; bt = t; }
      }
      if (bt > 0 && bv < m + 0.12 && bv < 0.5) { tau = bt; break; }
    }
  }
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const den = a - 2 * b + c;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return { tau: better, ap: cmnd[tau] };
}

/* Быстрое преобразование Фурье (радикс-2) с окном Ханна; возвращает амплитудный спектр */
function makeSpectrum(N) {
  const bits = Math.log2(N) | 0;
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
  const re = new Float32Array(N), im = new Float32Array(N);
  return (x, out) => {
    for (let i = 0; i < N; i++) { re[rev[i]] = x[i] * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cos[k] - im[b] * sin[k];
          const ti = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let i = 0; i < N / 2; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  };
}

/* Гармоническая сумма по спектру "новой" энергии: какая нота только что прозвучала */
function harmonicPick(Y, binHz, lo, hi) {
  const nb = Y.length;
  const peak = (f, tol) => {
    const b0 = Math.max(1, Math.floor((f * (1 - tol)) / binHz)), b1 = Math.min(nb - 1, Math.max(b0 + 1, Math.ceil((f * (1 + tol)) / binHz)));
    let m = 0; for (let b = b0; b <= b1; b++) if (Y[b] > m) m = Y[b];
    return m;
  };
  let best = null, bestS = 0, second = 0;
  for (let m = lo; m <= hi; m++) {
    const f0 = midiToFreq(m);
    let s = 0, half = 0, third = 0;
    for (let k = 1; k <= 12; k++) {
      const f = k * f0;
      if (f > 5000) break;
      const tol = 0.015 + 0.002 * k, w = 1 / Math.pow(k, 0.6);
      s += w * peak(f, tol);
      half += w * peak((k - 0.5) * f0, tol);
      third += w * 0.5 * (peak((k - 1 / 3) * f0, tol) + peak((k - 2 / 3) * f0, tol));
    }
    const score = s - 0.7 * Math.max(half, third);
    if (score > bestS) { second = Math.max(second, bestS); bestS = score; best = m; }
    else if (score > second) second = score;
  }
  return { midi: best, score: bestS };
}

/* Слушатель: получает последние отсчёты с микрофона на каждом кадре,
   находит начало нового звука (удар по клавише) и определяет ноту. */
class PitchListener {
  constructor(sampleRate, bufferLength, onEvent) {
    this.sr = sampleRate;
    this.dec = sampleRate >= 32000 ? 2 : 1;
    this.dsr = sampleRate / this.dec;
    this.maxDec = Math.floor(bufferLength / this.dec);
    this.dbuf = new Float32Array(this.maxDec);
    this.d = new Float32Array(this.maxDec);
    this.cmnd = new Float32Array(this.maxDec);
    this.onEvent = onEvent;
    this.N = bufferLength;
    this.spectrum = makeSpectrum(bufferLength);
    this.prevBuf = new Float32Array(bufferLength);
    this.specPre = new Float32Array(bufferLength / 2);
    this.specCur = new Float32Array(bufferLength / 2);
    this.specNew = new Float32Array(bufferLength / 2);
    this.gateDb = -50;
    this.floorDb = -90;          // шумовой фон: минимум громкости за последние ~3 с
    this.floorBins = new Array(30).fill(0);
    this.floorBinT = 0;
    this.floorIdx = 0;
    this.env = 0;
    this.lastT = null;
    this.lastOnset = -1e9;
    this.collect = null;
    this.stableMidi = null;
    this.stableSince = 0;
    this.lastEmitted = null;
    this.silentSince = 0;
    this.setRange(36, 96);
  }

  setRange(lowMidi, highMidi) {
    const fmin = Math.max(45, midiToFreq(lowMidi - 5) * 0.97);
    const fmax = Math.min(this.dsr / 4, midiToFreq(highMidi + 12) * 1.06);
    this.tauMax = Math.min(Math.ceil(this.dsr / fmin), Math.floor(this.maxDec / 3));
    this.tauMin = Math.max(2, Math.floor(this.dsr / fmax));
    this.W = Math.max(256, Math.min(3 * this.tauMax, this.maxDec - this.tauMax - 1));
    this.windowMs = ((this.W + this.tauMax) / this.dsr) * 1000;
    this.settleMs = Math.max(30, this.windowMs * 0.85);
    this.candLo = Math.max(21, lowMidi - 5);
    this.candHi = Math.min(108, highMidi + 12);
  }

  process(buf, t) {
    const n = buf.length;
    const dt = this.lastT == null ? 16.7 : Math.max(1, t - this.lastT);
    this.lastT = t;
    if (this.startT == null) this.startT = t;
    const warm = t - this.startT < 600; // первые 0,6 с только слушаем фон

    // быстрая громкость по последним ~11 мс
    const fastN = Math.min(512, n);
    let s = 0;
    for (let i = n - fastN; i < n; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / fastN);
    const db = 20 * Math.log10(rms + 1e-9);

    // рабочий порог (посчитан на прошлом кадре): из настройки, но не ниже «фон + 8 дБ»
    const gateDb = Math.max(this.gateDb, this.floorDb + 8);
    const gate = Math.pow(10, gateDb / 20);

    const onset = !warm && rms > gate && rms > this.env * 1.4 + gate * 0.25 && t - this.lastOnset > 90;
    this.env = Math.max(rms, this.env * Math.pow(0.93, dt / 16.7));
    if (onset) {
      this.lastOnset = t;
      this.collect = { t0: t, votes: new Map(), peak: rms };
      this.spectrum(this.prevBuf, this.specPre);
    }

    // высота тона
    let midi = null, cents = 0, valid = false, ap = 1;
    if (rms > gate * 0.6) {
      const need = this.W + this.tauMax + 1;
      const start = n - need * this.dec;
      const dbuf = this.dbuf;
      if (this.dec === 2) {
        for (let i = 0; i < need; i++) dbuf[i] = 0.5 * (buf[start + 2 * i] + buf[start + 2 * i + 1]);
      } else {
        for (let i = 0; i < need; i++) dbuf[i] = buf[start + i];
      }
      const r = yinDetect(dbuf, 0, this.W, this.tauMin, this.tauMax, this.d, this.cmnd, 0.15);
      if (r.tau > 0) {
        const f = this.dsr / r.tau;
        const mf = freqToMidiF(f);
        midi = Math.round(mf);
        cents = Math.round((mf - midi) * 100);
        ap = r.ap;
        valid = r.ap < 0.25 && rms > gate;
      }
    }
    // шумовой фон: минимум по корзинам (100 мс) за последние ~3 с «немузыкальных» кадров —
    // без тона и не сразу после удара, чтобы фон не подстраивался под само пианино
    if (warm || (t - this.lastOnset > 1200 && ap > 0.3)) {
      if (!this.floorBinT) { this.floorBins.fill(db); this.floorBinT = t; }
      if (t - this.floorBinT >= 100) { this.floorBinT = t; this.floorIdx = (this.floorIdx + 1) % this.floorBins.length; this.floorBins[this.floorIdx] = db; }
      else if (db < this.floorBins[this.floorIdx]) this.floorBins[this.floorIdx] = db;
      this.floorDb = Math.min.apply(null, this.floorBins);
    }
    this.onEvent('level', { rms, db, t, gateDb, floorDb: this.floorDb, midi: valid ? midi : null, cents });

    // решение после удара
    if (this.collect) {
      const c = this.collect;
      const age = t - c.t0;
      if (rms > c.peak) c.peak = rms;
      if (age >= this.settleMs && rms > gate) {
        let vm = this.newNote(buf);
        // спектр грубоват на низких нотах: если YIN уверен и близок — берём его точное значение
        if (vm != null && midi != null && ap < 0.2 && Math.abs(midi - vm) <= 2) vm = midi;
        if (vm != null) {
          const v = (c.votes.get(vm) || 0) + 1;
          c.votes.set(vm, v);
          if (v >= 3) this.emit(vm, 'onset', c.peak > gate * 2);
        }
      }
      if (this.collect && age > 420) {
        let best = null, bv = 0;
        c.votes.forEach((v, m) => { if (v > bv) { bv = v; best = m; } });
        if (bv >= 2) this.emit(best, 'onset', false);
        this.collect = null;
      }
    }

    // плавный переход без явного удара (легато)
    if (valid && !warm) {
      if (midi !== this.stableMidi) { this.stableMidi = midi; this.stableSince = t; }
      else if (!this.collect && t - this.stableSince >= 130 && midi !== this.lastEmitted &&
               (this.lastEmitted == null || Math.abs(midi - this.lastEmitted) % 12 !== 0)) {
        this.emit(midi, 'legato');
      }
    } else {
      this.stableMidi = null;
    }

    this.prevBuf.set(buf);

    if (rms < gate) {
      if (!this.silentSince) this.silentSince = t;
      if (t - this.silentSince > 200) this.lastEmitted = null;
    } else this.silentSince = 0;
  }

  // нота, которая появилась после удара: спектр сейчас минус спектр до удара
  newNote(buf) {
    const cur = this.spectrum(buf, this.specCur), pre = this.specPre, Y = this.specNew;
    let eNew = 0, eCur = 0;
    for (let i = 0; i < Y.length; i++) {
      const v = cur[i] - pre[i];
      Y[i] = v > 0 ? Math.sqrt(v) : 0;
      eNew += v > 0 ? v : 0; eCur += cur[i];
    }
    if (eNew < eCur * 0.12) return null;
    const r = harmonicPick(Y, this.sr / this.N, this.candLo, this.candHi);
    return r.midi;
  }

  // strong — уверенное распознавание: громкий удар (на 6 дБ выше порога) и три совпавших замера
  // at — когда замечен удар (для легато — когда тон установился): по нему игра на оценку судит о ритме
  emit(midi, via, strong = false) {
    const at = this.collect ? this.collect.t0 : via === 'legato' ? this.stableSince : this.lastT;
    this.collect = null;
    this.lastEmitted = midi;
    this.stableMidi = midi;
    this.onEvent('note', { midi, via, strong, at });
  }
}
