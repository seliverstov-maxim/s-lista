% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале и строка с пометкой «добавлено» — наши, остальное — первая из трёх партитур статьи, дословно.
% Источник: https://en.wikipedia.org/w/index.php?title=The_ABC_Song&oldid=1376282733
%   (The ABC Song, правка 1376282733 от 2026-09-23)
% Лицензия: текст Википедии, CC BY-SA 4.0 (авторы — история правок статьи); сама мелодия — общественное достояние.
\tempo 4 = 100 % добавлено: в источнике темпа нет
\relative c' {
    \key c \major \time 4/4
    c4 c4 g'4 g4 \bar "|" a4 a4 g2 \bar "|"
    f4 f4 e4 e4 \bar "|" d8 d8 d8 d8 c2 \bar "|" \break

    g'4 g4 f2 \bar "|" e4 e4 d2 \bar "|"
    g8 g8 g4 f2 \bar "|" e4 e4 d2 \bar "|" \break

    c4 c4 g'4 g4 \bar "|" a4 a4 g2 \bar "|"
    f4 f4 e4 e4 \bar "|" d4 d4 c2 \bar "|."
   }
   \addlyrics {
     A B C D E F G,
     H I J K L M N O P,
     Q R S, T U V,
     W 　 　 X, Y and Z.
     Now I know my A B Cs.
     Next time, won't you sing with me?
   }
