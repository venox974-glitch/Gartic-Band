// Tests de js/modes.js. Lancer : node test-modes.js
const Modes = require('../js/modes.js');
let pass = 0, total = 0;
const ok = (name, cond, info) => { total += 1; if (cond) pass += 1; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(info))); };

ok('le mode par défaut est BUILD UP et il est jouable', Modes.DEFAULT === 'buildup' && Modes.isAvailable('buildup'));
ok('BUILD UP et Phone sont jouables (les autres : « en préparation »)', JSON.stringify(Modes.availableIds()) === '["buildup","phone"]', Modes.availableIds());
ok('Phone se joue en ligne seulement', Modes.isAvailable('phone') && Modes.supports('phone', 'online') && !Modes.supports('phone', 'offline'));
ok('identifiants uniques', new Set(Modes.ids()).size === Modes.ids().length);
ok('resolve : inconnu, indisponible ou vide → BUILD UP', ['zombie', 'duel', '', undefined, null, 42].every((id) => Modes.resolve(id) === 'buildup'));
ok('resolve : BUILD UP reste BUILD UP', Modes.resolve('buildup') === 'buildup');
ok('BUILD UP se joue en ligne ET hors ligne', Modes.supports('buildup', 'online') && Modes.supports('buildup', 'offline'));
ok('supports : mode inconnu → faux', !Modes.supports('zombie', 'online'));
ok('joueurs de BUILD UP : 2 à 8, comme js/rounds.js', Modes.playersOk('buildup', 2) && Modes.playersOk('buildup', 8) && !Modes.playersOk('buildup', 1) && !Modes.playersOk('buildup', 9) && !Modes.playersOk('buildup', 2.5));
ok('Phone : 3 joueurs minimum', !Modes.playersOk('phone', 2) && Modes.playersOk('phone', 3) && Modes.playersOk('phone', 8));
ok('Phone : durée recommandée d\'un round = 5 min, BUILD UP = 90 s', Modes.list().find((m) => m.id === 'phone').roundSeconds.recommended === 300 && Modes.get('buildup').roundSeconds.default === 90);
ok('list() renvoie des copies : les modifier ne change pas le registre', (() => { const l = Modes.list(); l[0].label = 'X'; l[0].players[0] = 99; return Modes.get('buildup').label === 'BUILD UP' && Modes.get('buildup').players[0] === 2; })());
ok('chaque mode a un libellé, une icône et un texte', Modes.list().every((m) => m.label && m.icon && m.blurb));
ok('bornes des joueurs cohérentes (min ≤ max, dans 2..8)', Modes.list().every((m) => m.players[0] >= 2 && m.players[1] <= 8 && m.players[0] <= m.players[1]));
const Rounds = require('../js/rounds.js');
ok('les bornes de joueurs de BUILD UP égalent celles de js/rounds.js', JSON.stringify(Modes.get('buildup').players) === JSON.stringify(Rounds.LIMITS.players));
console.log(pass === total ? 'OK ' + pass + '/' + total : 'ÉCHECS ' + (total - pass) + ' — ' + pass + '/' + total);
process.exit(pass === total ? 0 : 1);
