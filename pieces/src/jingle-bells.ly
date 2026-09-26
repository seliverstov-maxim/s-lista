% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале — наши, остальное — исходник LilyPond из описания файла, дословно (мелодия — партия сопрано).
% Источник: https://commons.wikimedia.org/w/index.php?title=File%3AJingle_Bells_refrain_vector.svg&oldid=1129990329
%   (File:Jingle Bells refrain vector.svg, правка 1129990329 от 2025-12-12)
% Лицензия: общественное достояние (PD-self, автор набора — Niamh O'C; произведение — PD-old-100-expired).
\version "2.10.33"

  \new ChoirStaff <<
    \override Score.BarNumber #'break-visibility = #'#(#f #f #f)
    \new Staff = "women" \with {
      \remove "Time_signature_engraver"
      } <<
      \set Score.tempoHideNote = ##t
    \tempo 4 = 100
      \relative c'' {
      \new Voice = "sopranos" {
        \voiceOne
        \override Voice.Rest #'staff-position = #0
          \autoBeamOff
          \key g \major
          \time 4/4
          b8 b b4 b8 b b4 |
          b8 d g,8. a16 b4 r4 |
          c8 c c8. c16 c8 b b b16 b |
          b8 a a b a4 d |
          b8 b b4 b8 b b4 |
          b8 d g,8. a16 b4 r4 |
          c8 c c8. c16 c8 b b b16 b |
          d8 d c a g4. r8 \bar "|."
      }
        \addlyrics {
      Jin -- gle bells, jin -- gle bells, |
      jin -- gle all the way. |
      Oh what fun it is to ride in a |
      one horse o -- pen sleigh. O! |
      Jin -- gle bells, jin -- gle bells, |
      jin -- gle all the way. |
      Oh what fun it is to ride in a |
      one horse o -- pen sleigh. \bar "|."
    }
    }
      \relative c'' {
      \new Voice = "altos" {
        \voiceTwo
          \autoBeamOff
          \key g \major
          \time 4/4
          g8 g g4 g8 g g4 |
          g8 g d8. d16 g4 s4 |
          e8 e e8. e16 e8 d d g16 g |
          g8 g g g fis4 fis |
          g8 g g4 g8 g g4 |
          g8 g d8. d16 g4 s4 |
          e8 e e8. e16 e8 d d g16 g |
          fis8 fis fis fis g4. s8 \bar "|."
      }
    }
    >>
   
    \new Staff = "men" \with {
      \remove "Time_signature_engraver"
      } <<
      \relative c' {
      \clef bass
      \new Voice = "tenors" {
        \voiceOne
        \override Voice.Rest #'staff-position = #0
          \autoBeamOff
          \key g \major
          \time 4/4
          d8 d d4 d8 d d4 |
          d8 b b8. c16 d4 r4 |
          g,8 g g8. g16 g8 g g d'16 d |
          cis8 cis cis cis d4 c |
          d8 d d4 d8 d d4 |
          d8 b b8. c16 d4 r4 |
          g,8 g g8. g16 g8 g g d'16 d |
          d8 d a c b4. r8 \bar "|."
      }
    }
      \relative c {
      \new Voice = "basses" {
        \voiceTwo
          \autoBeamOff
          \key g \major
          \time 4/4
          g'8 g g4 g8 g g4 |
          g8 g g8. g16 g4 s4 |
          c,8 c c8. c16 g8 g g g'16 g |
          e8 e a, a d4 d |
          g8 g g4 g8 g g4 |
          g8 g g8. g16 g4 s4 |
          c,8 c c8. c16 g8 g g g'16 g |
          d8 d d d g4. s8 \bar "|."
      }
    }
    >>
  >>
