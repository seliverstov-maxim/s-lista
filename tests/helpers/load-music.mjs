// src/music.js — обычный скрипт без экспорта (он встраивается в страницу при сборке).
// Для тестов выполняем его в отдельной функции, передав контуры знаков, и забираем нужные объявления.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/music.js', import.meta.url), 'utf8');
export const GLYPH = JSON.parse(readFileSync(new URL('../../src/glyphs.json', import.meta.url), 'utf8'));
const NAMES = ['CLEFS', 'SP', 'TPQ', 'SETTINGS_DEFAULTS', 'midiOf', 'shortName', 'fullName', 'spellMidi', 'ledgerRange', 'linesNeeded',
  'candidates', 'pickNote', 'migrateSettings', 'durOf', 'beatOf', 'buildScore', 'randomScore', 'layoutRows', 'rowFactor', 'rowOfNote',
  'placeRow', 'partMetrics', 'isEcho', 'shownAcc', 'keyAt', 'playbackPlan', 'itemRowMap', 'accidentalSource', 'keySigNames', 'headerWidth', 'scoreVBox', 'renderRow', 'staffSVG', 'keyPositions', 'cancelledKey', 'allNotes'];
export const M = new Function('GLYPH', `${src}; return { ${NAMES.join(', ')} };`)(GLYPH);
