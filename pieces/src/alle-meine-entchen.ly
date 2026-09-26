% «С листа»: исходник пьесы для npm run add-piece. Строки «%» в начале и строка с пометкой «добавлено» — наши, остальное — партитура из статьи, дословно.
% Источник: https://de.wikipedia.org/w/index.php?title=Alle_meine_Entchen&oldid=269542480
%   (Alle meine Entchen, правка 269542480 от 2026-08-10)
% Лицензия: текст Википедии, CC BY-SA 4.0 (авторы — история правок статьи); сама мелодия — общественное достояние.
% Размера в источнике нет — по умолчанию LilyPond это 4/4.
\tempo 4 = 100 % добавлено: в источнике темпа нет
\relative c' {\autoBeamOff
             c8 d8 e8 f8 g4 g4 | a8 a8 a8 a8 g2 | a8 a8 a8 a8 g2
             f8 f8 f8 f8 e4 e4 | d8 d8 d8 d8 c2 \bar "|."
}
\addlyrics {
    Al -- le mei -- ne Ent -- chen | schwim -- men auf dem See, | schwim -- men auf dem See,
    Köpf -- chen in das Was -- ser, | Schwänz -- chen in die Höh’.
}
