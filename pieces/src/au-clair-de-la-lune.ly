% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале — наши, остальное — исходник LilyPond из описания файла, дословно.
% Источник: https://commons.wikimedia.org/w/index.php?title=File%3ALy_au_clair_de_la_lune_accords_melodie_paroles.png&oldid=1006498541
%   (File:Ly au clair de la lune accords melodie paroles.png, правка 1006498541 от 2025-03-07)
% Лицензия: GFDL и CC BY-SA 3.0, автор набора — Christophe Dang Ngoc Chan; мелодия — общественное достояние.
 \header {
    title = "Au clair de la Lune"
    composer = "Jean-Baptiste Lully ?"
 }
 
 \score {
 
    <<
 
       \chords {
          \frenchChords
          \repeat "unfold" 2 {
             c1 c4 g4 c2
          }
          d2:m a d g
          c1 c4 g4 c2
       }
 
       \relative c' {
 
          \clef treble
          \time 4/4
          \tempo 4=80
 
          \repeat "unfold" 2 {
             c8 c c d e4 d c8 e d d c2
          }
          d8 d d d a4 a d8 c b a g2 
          c8 c c d e4 d c8 e d d c2
          \bar "|."
       }
  
       \addlyrics {
          \set stanza = "1. "
          Au clair de la Lu -- ne
          mon a -- mi Pier -- rot
          pre -- te moi ta plu -- me
          pour e -- crire un mot
          ma chan -- delle est mor -- te
          je n'ai plus de feu
          ou -- vre moi ta por -- te
          pour l'am -- our de dieu
       }
 
       \addlyrics {
          \set stanza = "2. "
          Au clair de la Lu -- ne
          Pier -- rot ré -- pon -- dit
          je n'ai pas de plu -- me
          je suis dans mon lit
          va chez la voi -- si -- ne
          je crois qu'elle y est
          car dans sa cui -- si -- ne
          on bat le bri -- quet
       }
 
    >>
 
 }

