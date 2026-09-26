% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале — наши, остальное — партитура из статьи, дословно, кроме строки с пометкой «изменено».
% Источник: https://it.wikipedia.org/w/index.php?title=Mary_had_a_little_lamb&oldid=150827858
%   (Mary had a little lamb, правка 150827858 от 2026-05-24)
% Лицензия: текст Википедии, CC BY-SA 4.0 (авторы — история правок статьи); сама мелодия — общественное достояние.
\relative c'' {
\tempo 4 = 110 % изменено: в источнике ♩ = 220 — скрытый темп для MIDI, для разучивания слишком быстро
 \language "deutsch"
 \set Staff.midiInstrument = #"flute" 
 \key g \major
\set Score.tempoHideNote = ##t
h a g a
h h h2
a4 a a2
h4 d d2
h4 a g a
h h h h
a a h a
g1
 \bar "|."
}
\addlyrics {
 Ma -- ry had a li -- ttle lamb,
 li -- ttle lamb, li -- ttle lamb,
 Ma -- ry had a li -- ttle lamb whose
 fleece was white as snow.
}
