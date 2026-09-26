// src/detector.js — обычный скрипт без экспорта (он встраивается в страницу при сборке).
// Для тестов выполняем его в отдельной функции и забираем нужные объявления.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/detector.js', import.meta.url), 'utf8');
export const { PitchListener, yinDetect, harmonicPick, makeSpectrum, midiToFreq } =
  new Function(`${src}; return { PitchListener, yinDetect, harmonicPick, makeSpectrum, midiToFreq };`)();
