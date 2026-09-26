% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале — наши, остальное — партитура из статьи, дословно (темп — из её блока \midi).
% Источник: https://en.wikipedia.org/w/index.php?title=London_Bridge_Is_Falling_Down&oldid=1374989681
%   (London Bridge Is Falling Down, правка 1374989681 от 2026-09-15)
% Лицензия: текст Википедии, CC BY-SA 4.0 (авторы — история правок статьи); сама мелодия — общественное достояние.
\header { tagline = ##f }
\layout { indent = 0 \context { \Score \remove "Bar_number_engraver" } }

global = { \key f \major \numericTimeSignature \time 2/4 \autoBeamOff }

melody = \relative c'' { \global \set melismaBusyProperties = #'() \set midiInstrument = "clarinet"
  \repeat volta 2 { c8. (d16 c8 bes8 | a8 bes8 c4) | }
    \alternative { { g8 (a8) bes4) | a8 (bes8 c4) | } { g4 (c4 |a8 f4.) } } \bar "|."
}

verse = \lyricmode {
  Lon -- don Bridge is fall -- ing down,
  fall -- ing down, fall -- ing down,
  my fair la -- dy.
}

\score {
  <<
    \new Staff { \melody } \addlyrics { \verse }
  >>
  \layout { }
}
\score { \unfoldRepeats { << \melody >> }
  \midi { \tempo 4=102
    \context { \Score midiChannelMapping = #'instrument }
    \context { \Staff \remove "Staff_performer" }
    \context { \Voice \consists "Staff_performer" }
  }
}
