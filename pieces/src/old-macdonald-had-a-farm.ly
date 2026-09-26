% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале и строка с пометкой «добавлено» — наши, остальное — партитура из статьи, дословно.
% Источник: https://fr.wikipedia.org/w/index.php?title=Old_MacDonald_Had_a_Farm&oldid=238744900
%   (Old MacDonald Had a Farm, правка 238744900 от 2026-08-18)
% Лицензия: текст Википедии, CC BY-SA 4.0 (авторы — история правок статьи); сама мелодия — общественное достояние.
\tempo 4 = 120 % добавлено: в источнике темп есть только для MIDI (♩ = 180), для разучивания слишком быстро
<<
  \new ChordNames \chordmode {
    \time 4/4
    \set chordChanges = ##t
    g1
    c2 g1
    d2:7
    g1
    g1
    c2 g1
    d2:7
    g1
    g1
    g1
    g1
    g1
    g1
    c2 g1
    d2:7
    g1
  }
  <<
    \new Staff {
      \relative c'' {
        \key g \major
        \time 4/4
        g4 g g d
        e e d2
        b'4 b a a
        g2. d4 \break
        g4 g g d
        e e d2
        b'4 b a a
        g2. d8 d \break
        g4 g g d8 d
        g4 g g2
        g8 g g4 g8 g g4
        g8 g g g g4 g \break
        g g g d
        e e d2
        b'4 b a a
        g1
        \bar "|."
    } }
    \addlyrics {
      \lyricmode {
        Old Mac -- Do -- nald had a farm, EE -- I -- EE -- I -- O,
        And on that farm he had a cow, EE -- I -- EE -- I -- O,
        With a moo moo here and a moo moo there
        Here a moo, there a moo, eve -- ry -- where a moo moo,
        Old Mac -- Do -- nald had a farm, EE -- I -- EE -- I -- O
    } }
  >>
>>
\midi {
  \context {
    \Score
    tempoWholesPerMinute = #(ly:make-moment 180 4)
  }
}
