% «С листа»: исходник пьесы для npm run add-piece. Фрагмент файла Mutopia — начало верхнего стана (правая рука),
% такты 1–22 оригинала с обоими повторами: строки 39–55 файла дословно, кроме строки с пометкой «изменено»;
% строки «%» и последняя «}» — наши. Дальше в пьесе аккорды, форшлаги и триоли — их тренажёр не поддерживает.
% Источник: https://www.mutopiaproject.org/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly
%   (Mutopia Project, «Für Elise», WoO 59, Mutopia-2015/08/18-931; набор — Stelios Samelis по изданию Breitkopf & Härtel, 1888)
% Лицензия: общественное достояние.
 \new Staff = "up" {
 \clef treble
 \key a \minor
 \time 3/8
 \override Score.MetronomeMark.transparent = ##t
 \tempo 4 = 72
 \repeat volta 2 {
 \partial 8 e''16\pp^\markup { \bold "Poco moto." }
 dis'' e'' dis'' e'' b' d'' c'' a'8 r16 c' e' a' b'8 r16 e' gis' b'
 c''8 r16 e'_[ e'' dis''] e'' dis'' e'' b' d'' c'' a'8 r16 c' e' a' b'8 r16 e' c'' b' }
 \alternative { { a'4 } { a'8 \bar "" r16 b' \set Timing.measurePosition = #(ly:make-moment -1/8) c''16 d'' } 
 }
 \repeat volta 2 {
 e''8. g'16[ f'' e''] d''8. f'16[ e'' d''] c''8. e'16[ d'' c''] b'8 r16 e'_[ e''] r r e''[ e'''] r r dis''
 e''8 r16 dis'' e'' dis'' e''16 dis'' e'' b' d'' c''
 a'8 r16 c' e' a' b'8 r16 e' gis' b' c''8 r16 e'_[ e'' dis''] e'' dis'' e'' b' d'' c'' a'8 r16 c' e' a' b'8 r16 e' c'' b'} 
 \alternative { { a'8 r16 b'[ c'' d''] } { a'4 } } % изменено: в оригинале вторая концовка — a'8 r16 <e' c''>[ <f' c''> <e' g' c''>], аккорды перехода к средней части
 } % наша строка: конец стана
