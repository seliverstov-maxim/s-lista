% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале и строка с пометкой «добавлено» — наши, остальное — исходник LilyPond из описания файла, дословно.
% Источник: https://commons.wikimedia.org/w/index.php?title=File%3AJoyeux_anniversaire_patty_mildred_hill.svg&oldid=1226958144
%   (File:Joyeux anniversaire patty mildred hill.svg, правка 1226958144 от 2026-06-06)
% Лицензия: CC0 1.0 (набор — Christophe Dang Ngoc Chan, участник Cdang). Мелодия «Good Morning to All» (1893) — общественное достояние.
% Берётся первая партитура — до мажор; вторая (соль мажор через \transpose) пропускается.
\tempo 4 = 100 % добавлено: в источнике темпа нет
\version "2.18.2"

\header {
  title = "Joyeux Anniversaire"
  subtitle="Happy Birthday to You"
  composer = "Patty et Mildred Hill (1893)"
  tagline = ""
}

theme = \relative c''{\partial 4
    g8. g16
    a4 g c
    b2 g8. g16
    a4 g d'
    c2 g8. g16 \break
    g'4 e c
    b a f'8. f16
    e4 c d
    c2 \bar"|."
}

\score {
  
  \new Staff \with{midiInstrument="oboe"} \relative c''{
    \time 3/4
    \clef "G"
    \key c \major
    
    \mark \markup{\italic{do} majeur}
    \theme
  }
  
  \layout {}
  \midi {}
}

\score {
  
  \new Staff \with{midiInstrument="oboe"} \relative c''{
    \time 3/4
    \clef "G"
    
    \mark \markup{\italic{sol} majeur}
    \transpose c g, {\key c \major
                    \theme }
  }
  
  \layout {}
}
