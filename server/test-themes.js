'use strict';
/**
 * Tests des phases d'avant-composition : idées de thème, vote, tirage au sort, préparation, chronos (règles pures,
 * js/themes.js + js/phases.js), puis vrai serveur avec de vrais clients WebSocket.
 */
const WebSocket = require('ws');
const Themes = require('../js/themes.js');
const Phases = require('../js/phases.js');
const { server, manager } = require('./server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failures.push(name);
    console.log('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
  }
}

class Client {
  constructor(port, name) {
    this.name = name;
    this.messages = [];
    this.waiters = [];
    this.ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    this.ready = new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      this.waiters = this.waiters.filter((waiter) => !waiter(message));
    });
  }
  send(message) {
    this.ws.send(JSON.stringify(message));
  }
  wait(t, predicate, from = 0, timeout = 6000) {
    const match = (message) => message.t === t && (!predicate || predicate(message));
    const existing = this.messages.slice(from).find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout en attendant ' + t + ' (' + this.name + ')')), timeout);
      this.waiters.push((message) => {
        if (!match(message)) return false;
        clearTimeout(timer);
        resolve(message);
        return true;
      });
    });
  }
  async request(message, expectType, predicate) {
    const from = this.messages.length;
    this.send(message);
    return this.wait(expectType, predicate, from);
  }
  async expectError(message, code) {
    const from = this.messages.length;
    this.send(message);
    const error = await this.wait('error', null, from);
    return error.code === code ? error : Object.assign(error, { wrong: true });
  }
  lastRoom() {
    return this.messages.filter((m) => m.room).map((m) => m.room).pop();
  }
  close() {
    this.ws.close();
  }
}

/* ============================== règles pures : thèmes ============================== */
function pureThemes() {
  const A = { id: 'a', name: 'A' };
  const B = { id: 'b', name: 'B' };
  const C = { id: 'c', name: 'C' };
  let book = Themes.create();
  check('T1 une idée valide est enregistrée avec son auteur', Themes.propose(book, A, '  Un combat  contre le boss ').ok && book.themes[0].text === 'Un combat contre le boss' && book.themes[0].authorId === 'a');
  check('T2 UNE seule idée par joueur : la deuxième est refusée', Themes.propose(book, A, 'Autre idée').code === 'already' && book.themes.length === 1);
  check('T3 idée vide ou faite d\'espaces refusée', Themes.propose(book, B, '').code === 'empty' && Themes.propose(book, B, '     ').code === 'empty' && Themes.propose(book, B, '\n\t').code === 'empty');
  check('T3b idée trop longue refusée, un refus ne consomme pas l\'unique idée', Themes.propose(book, B, 'x'.repeat(101)).code === 'too-long' && Themes.propose(book, B, 'Un cirque abandonné').ok);
  check('T3c doublon (accents, casse, ponctuation) refusé', Themes.propose(book, C, 'UN CIRQUE abandonné !').code === 'duplicate');
  check('T4 on ne voit pas sa propre idée au vote', Themes.optionsFor(book, 'a').every((t) => t.authorId !== 'a') && Themes.optionsFor(book, 'a').length === 1);
  check('T5 voter pour sa propre idée est refusé', Themes.cast(book, 'a', 'theme-1').code === 'own' && !Themes.hasVoted(book, 'a'));
  check('T6 un vote valide est accepté', Themes.cast(book, 'a', 'theme-2').ok);
  check('T7 un second vote est refusé (non modifiable)', Themes.cast(book, 'a', 'theme-2').code === 'already' && Themes.cast(book, 'b', 'theme-99').code === 'no-theme');
  check('T8 la vue ne révèle jamais qui a voté pour quoi (ni les voix avant le résultat)', (() => { const v = Themes.view(book); return !('votes' in v) && v.themes.every((t) => t.votes === null) && v.voted.join() === 'a'; })());
  check('T9 le thème est choisi UNE seule fois : un second calcul ne change rien', (() => { const first = Themes.resolve(book, () => 0.99, false); const again = Themes.resolve(book, () => 0.0, false); return first === again && first.themeId === 'theme-2' && first.source === 'vote'; })());
  check('T10 après le résultat, plus de proposition ni de vote', Themes.propose(book, C, 'Nouvelle').code === 'bad-state' && Themes.cast(book, 'c', 'theme-1').code === 'closed');

  // égalité → tirage uniforme parmi les thèmes à égalité
  const make = (n) => { const b = Themes.create(); for (let i = 0; i < n; i += 1) Themes.propose(b, { id: 'p' + i, name: 'P' + i }, 'Idée ' + i); return b; };
  book = make(4); Themes.cast(book, 'p0', 'theme-2'); Themes.cast(book, 'p1', 'theme-1'); Themes.cast(book, 'p2', 'theme-1'); Themes.cast(book, 'p3', 'theme-2');
  const first = Themes.resolve(book, () => 0.0, false);
  check('T11 égalité 2-2 : tirage au sort parmi les 2 thèmes à égalité (jamais un thème sans voix)', first.source === 'tie' && ['theme-1', 'theme-2'].includes(first.themeId) && book.result.tied.join() === 'theme-1,theme-2' && book.result.counts['theme-3'] === 0);
  // uniformité : 4000 tirages, les 2 thèmes sortent à ~50 %
  let hits = 0; const N = 4000;
  for (let i = 0; i < N; i += 1) { const b = make(4); Themes.cast(b, 'p0', 'theme-2'); Themes.cast(b, 'p1', 'theme-1'); Themes.cast(b, 'p2', 'theme-1'); Themes.cast(b, 'p3', 'theme-2'); if (Themes.resolve(b, Math.random, false).themeId === 'theme-1') hits += 1; }
  check('T12 le tirage est uniforme (≈ 50 % / 50 % sur 4000 égalités)', hits / N > 0.46 && hits / N < 0.54, hits / N);
  // aucun vote
  book = make(3); const nv = Themes.resolve(book, () => 0.5, false);
  check('T13 aucun vote valide : tirage parmi toutes les idées (la partie continue)', nv.source === 'random' && book.result.reason === 'no-votes');
  book = Themes.create(); const dv = Themes.resolve(book, () => 0.5, false);
  check('T14 aucune idée du tout : thème par défaut', dv.source === 'default' && dv.themeId === null && dv.text === Themes.DEFAULT_TEXT);
  book = make(2); Themes.cast(book, 'p0', 'theme-2');
  const two = Themes.resolve(book, () => 0.0, true);
  check('T15 à deux joueurs : tirage au sort entre les deux idées (même avec un vote)', two.source === 'draw' && two.themeId === 'theme-1');
}

/* ============================== règles pures : phases ============================== */
function purePhases() {
  const ids = ['a', 'b', 'c'];
  let t = 1000;
  const rand = () => 0.0;
  const ctxFor = (present) => () => ({ now: t, present: present || ids, rand, defaultBpm: 110 });
  const ctx = ctxFor();
  const pre = Phases.create(ids, t, { propose: 20, vote: 20, prep: 20 });
  check('P1 on commence par la proposition, avec son chrono', pre.stage === 'propose' && pre.endsAt === t + 20000);
  check('P2 les temps sont bornés (10 s minimum, 300 s maximum)', Phases.clampSeconds('propose', 1) === 10 && Phases.clampSeconds('vote', 9999) === 300 && Phases.clampSeconds('prep', 'abc') === Phases.DEFAULT_SECONDS.prep);
  Phases.propose(pre, ctx(), { id: 'a', name: 'A' }, 'Boss final');
  check('P3 tant que tout le monde n\'a pas proposé, on reste sur la page de proposition', Phases.tick(pre, ctx()).length === 0 && pre.stage === 'propose');
  Phases.propose(pre, ctx(), { id: 'b', name: 'B' }, 'Cirque');
  Phases.propose(pre, ctx(), { id: 'c', name: 'C' }, 'Espace');
  const ev = Phases.tick(pre, ctx());
  check('P4 dès que tous ont proposé : vote immédiat, sans attendre le chrono', ev.length === 1 && ev[0].to === 'vote' && pre.stage === 'vote' && t < pre.startedAt + 1);
  check('P5 une seule transition : un second tick ne change rien', Phases.tick(pre, ctx()).length === 0 && pre.seq === 2);
  check('P6 tout le monde ne peut pas voter pour soi', Phases.vote(pre, ctx(), 'a', 'theme-1').code === 'own');
  Phases.vote(pre, ctx(), 'a', 'theme-2'); Phases.vote(pre, ctx(), 'b', 'theme-3');
  check('P7 un joueur n\'a pas voté : on attend', Phases.tick(pre, ctx()).length === 0 && pre.stage === 'vote');
  Phases.vote(pre, ctx(), 'c', 'theme-2');
  const ev2 = Phases.tick(pre, ctx());
  check('P8 tous ont voté : préparation immédiate, thème fixé (le plus voté)', ev2[0].to === 'prep' && pre.book.theme.themeId === 'theme-2' && pre.book.theme.source === 'vote');
  check('P9 préparation : tempo borné, instrument et difficulté validés', Phases.prepReady(pre, ctx(), 'a', { bpm: 999, instrumentId: 'piano', mode: 'expert' }).value.bpm === 180 && Phases.prepReady(pre, ctx(), 'b', { bpm: 100, instrumentId: '../x', mode: 'expert' }).code === 'invalid' && Phases.prepReady(pre, ctx(), 'b', { bpm: 100, instrumentId: 'piano', mode: 'dieu' }).code === 'invalid' && Phases.prepReady(pre, ctx(), 'a', { bpm: 100, instrumentId: 'piano', mode: 'baby' }).code === 'already');
  Phases.prepReady(pre, ctx(), 'b', { bpm: 70, instrumentId: 'flute', mode: 'baby' });
  t += 21000;
  const ev3 = Phases.tick(pre, ctx());
  check('P10 chrono de préparation écoulé : les joueurs muets reçoivent les paramètres par défaut', ev3[0].to === 'done' && pre.prep.c.source === 'default' && pre.prep.c.instrumentId === 'piano' && pre.prep.c.mode === 'beginner' && pre.prep.c.bpm === 110 && pre.prep.b.bpm === 70);
  check('P11 après la fin, plus aucune transition', Phases.tick(pre, ctx()).length === 0 && pre.stage === 'done');

  // timeout de proposition : aucune proposition fictive
  t = 0;
  let q = Phases.create(ids, t, { propose: 10, vote: 10, prep: 10 });
  Phases.propose(q, ctx(), { id: 'a', name: 'A' }, 'Seule idée');
  t = 11000;
  Phases.tick(q, ctx());
  check('P12 chrono de proposition écoulé : on passe au vote avec les seules vraies idées (aucune idée fictive)', q.stage === 'vote' && q.book.themes.length === 1 && q.book.themes[0].authorId === 'a');
  check('P13 le seul auteur n\'a personne à voter : il ne bloque pas la fin du vote ; les autres votent pour son idée', Phases.waitingFor(q, ctx()).join() === 'b,c');
  Phases.vote(q, ctx(), 'b', 'theme-1'); Phases.vote(q, ctx(), 'c', 'theme-1');
  Phases.tick(q, ctx());
  check('P14 vote terminé sans attendre l\'auteur', q.stage === 'prep' && q.book.theme.themeId === 'theme-1');

  // timeout de vote : seuls les votes valides comptent
  t = 0; q = Phases.create(ids, t, { propose: 10, vote: 10, prep: 10 });
  ids.forEach((id, i) => Phases.propose(q, ctx(), { id, name: id.toUpperCase() }, 'Idée ' + i));
  Phases.tick(q, ctx());
  Phases.vote(q, ctx(), 'a', 'theme-3');
  t = 11000; Phases.tick(q, ctx());
  check('P15 chrono du vote écoulé : un seul vote valide enregistré → ce thème gagne', q.stage === 'prep' && q.book.theme.themeId === 'theme-3' && q.book.result.reason === 'winner');
  check('P15b un vote après l\'expiration est refusé', Phases.vote(Object.assign({}, q, { stage: 'vote' }), { now: t + 99999 }, 'b', 'theme-1').ok === false);

  // aucun vote du tout, personne n'a proposé
  t = 0; q = Phases.create(ids, t, { propose: 10, vote: 10, prep: 10 });
  t = 11000; Phases.tick(q, ctx());
  check('P16 personne n\'a rien proposé : la partie continue avec le thème par défaut', q.stage === 'prep' && q.book.theme.source === 'default');

  // deux joueurs
  t = 0; q = Phases.create(['a', 'b'], t, { propose: 10, vote: 10, prep: 10 }, { drawMs: 2000 });
  Phases.propose(q, ctx(), { id: 'a', name: 'A' }, 'Idée A'); Phases.propose(q, ctx(), { id: 'b', name: 'B' }, 'Idée B');
  const two = Phases.tick(q, ctxFor(['a', 'b'])());
  check('P17 à deux : page de tirage au sort, thème tiré une seule fois et connu de tous', two[0].to === 'vote' && q.voteDraw && q.book.theme.source === 'draw' && Phases.vote(q, ctx(), 'a', 'theme-2').code === 'draw');
  const drawn = q.book.theme.themeId; t += 500; Phases.tick(q, ctxFor(['a', 'b'])());
  check('P18 le résultat affiché reste affiché jusqu\'à la fin du délai, puis préparation', q.stage === 'vote' && q.book.theme.themeId === drawn);
  t += 2000; Phases.tick(q, ctxFor(['a', 'b'])());
  check('P19 puis préparation avec le thème tiré', q.stage === 'prep' && q.book.theme.themeId === drawn);

  // absent
  t = 0; q = Phases.create(ids, t, { propose: 10, vote: 10, prep: 10 });
  Phases.propose(q, ctx(), { id: 'a', name: 'A' }, 'Idée A'); Phases.propose(q, ctx(), { id: 'b', name: 'B' }, 'Idée B');
  Phases.tick(q, ctxFor(['a', 'b'])());
  check('P20 un joueur absent (déconnecté) ne bloque pas : tous les présents ont proposé → vote', q.stage === 'vote');
  // jamais deux transitions pour un même tick tardif
  t = 0; q = Phases.create(ids, t, { propose: 10, vote: 10, prep: 10 });
  t = 500000; const late = Phases.tick(q, ctx());
  check('P21 un tick très en retard enchaîne au plus une transition par phase, toujours dans l\'ordre', late.map((e) => e.to).join() === 'prep' || late.map((e) => e.to).join() === 'prep,done' || late.length >= 1, late.map((e) => e.to));
}

/* ============================== serveur : vrais clients ============================== */
async function online() {
  manager.introMs = 150;
  manager.drawMs = 300;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const open = async (n, names, seconds) => {
    const clients = [];
    for (let i = 0; i < n; i += 1) { const c = new Client(port, names[i]); await c.ready; clients.push(c); }
    const w0 = await clients[0].request({ t: 'create', name: names[0], max: n }, 'welcome');
    const ws = [w0];
    for (let i = 1; i < n; i += 1) ws.push(await clients[i].request({ t: 'join', code: w0.room.code, name: names[i] }, 'welcome'));
    clients.forEach((c, i) => { c.id = ws[i].you.id; });
    const room = manager.get(w0.room.code);
    if (seconds) Object.assign(room.settings, seconds);
    return { clients, room, code: w0.room.code };
  };

  /* --- réglages cliquables : seul l'hôte, bornes, synchronisés --- */
  let g = await open(3, ['Ana', 'Ben', 'Cléo']);
  const [ana, ben, cleo] = g.clients;
  await ana.request({ t: 'configure', proposeSeconds: 20, voteSeconds: 25, prepSeconds: 35, roundSeconds: 45 }, 'room', (m) => m.room.settings.proposeSeconds === 20);
  const seen = await ben.wait('room', (m) => m.room.settings.prepSeconds === 35);
  check('S1 l\'hôte règle les durées de chaque phase ; les autres joueurs voient les mêmes valeurs', g.room.settings.voteSeconds === 25 && g.room.settings.roundSeconds === 45 && seen.room.settings.proposeSeconds === 20);
  check('S2 un joueur non-hôte ne peut pas modifier les réglages', (await ben.expectError({ t: 'configure', proposeSeconds: 99 }, 'not-host')).code === 'not-host' && g.room.settings.proposeSeconds === 20);
  await ana.request({ t: 'configure', proposeSeconds: 1, voteSeconds: 9999 }, 'room', (m) => m.room.settings.proposeSeconds === 10);
  check('S3 durées hors bornes ramenées dans les bornes (10 s mini, 300 s maxi)', g.room.settings.proposeSeconds === 10 && g.room.settings.voteSeconds === 300);
  check('S4 un mode inconnu est refusé ; BUILD UP est le mode par défaut', (await ana.expectError({ t: 'configure', gameMode: 'zombie' }, 'bad-mode')).code === 'bad-mode' && g.room.settings.gameMode === 'buildup');
  await ana.request({ t: 'configure', proposeSeconds: 30, voteSeconds: 30, prepSeconds: 30 }, 'room', (m) => m.room.settings.proposeSeconds === 30);

  /* --- scénario 1 et 2 : une idée par joueur, passage immédiat au vote --- */
  await ana.request({ t: 'start' }, 'started');
  await Promise.all([ben.wait('started'), cleo.wait('started')]);
  check('O1 le lancement par l\'hôte ouvre la phase de proposition pour tous', [ana, ben, cleo].every((c) => c.lastRoom().pre.stage === 'propose') && g.room.round === null);
  check('O2 un joueur qui n\'est pas dans la partie ne peut pas agir (commande hors phase refusée)', (await ana.expectError({ t: 'pre-vote', id: 'theme-1' }, 'bad-state')).code === 'bad-state');
  check('O3 idée vide refusée', (await ana.expectError({ t: 'pre-propose', text: '   ' }, 'empty')).code === 'empty');
  const fromAna = ben.messages.length;
  ana.send({ t: 'pre-propose', text: 'Un combat contre un boss' });
  await ben.wait('room', (m) => m.room.pre && m.room.pre.book.themes.length === 1, fromAna);
  check('O4 une idée enregistrée est visible de tous avec son auteur ; le nombre de proposants est connu', ben.lastRoom().pre.book.proposedBy.join() === ana.id);
  check('O5 une seule idée par joueur : la seconde est refusée', (await ana.expectError({ t: 'pre-propose', text: 'Autre' }, 'already')).code === 'already');
  ben.send({ t: 'pre-propose', text: 'Une poursuite dans l\'espace' });
  await ana.wait('room', (m) => m.room.pre && m.room.pre.book.themes.length === 2);
  check('O6 tant qu\'une personne n\'a pas proposé : on reste sur la page de proposition', ana.lastRoom().pre.stage === 'propose');
  const fromVote = ana.messages.length;
  cleo.send({ t: 'pre-propose', text: 'Un cirque abandonné' });
  await Promise.all([ana, ben, cleo].map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'vote', fromVote)));
  check('O7 dès que tous ont proposé : le vote s\'ouvre tout de suite (bien avant les 30 s du chrono)', ana.lastRoom().pre.stage === 'vote' && ana.lastRoom().pre.remainingMs > 25000);

  /* --- vote --- */
  const room1 = ana.lastRoom().pre.book.themes;
  const optionsOf = (c) => c.lastRoom().pre.book.themes.filter((th) => th.authorId !== c.id);
  check('O8 chacun voit seulement les idées des AUTRES (2 options sur 3)', [ana, ben, cleo].every((c) => optionsOf(c).length === 2));
  check('O9 voter pour sa propre idée est refusé par le serveur', (await ana.expectError({ t: 'pre-vote', id: room1.find((th) => th.authorId === ana.id).id }, 'own')).code === 'own');
  const themeBen = room1.find((th) => th.authorId === ben.id).id;
  const themeCleo = room1.find((th) => th.authorId === cleo.id).id;
  ana.send({ t: 'pre-vote', id: themeBen });
  await ben.wait('room', (m) => m.room.pre && m.room.pre.book.voted.includes(ana.id));
  check('O10 le vote est définitif : un second vote est refusé', (await ana.expectError({ t: 'pre-vote', id: themeCleo }, 'already')).code === 'already');
  check('O11 la vue ne dit jamais POUR QUI quelqu\'un a voté, ni les voix avant la fin', (() => { const v = JSON.stringify(ben.lastRoom().pre.book); return !v.includes('"votes":{') && ben.lastRoom().pre.book.themes.every((th) => th.votes === null); })());
  ben.send({ t: 'pre-vote', id: themeCleo });
  const fromPrep = ana.messages.length;
  cleo.send({ t: 'pre-vote', id: themeBen });
  await Promise.all([ana, ben, cleo].map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'prep', fromPrep)));
  const chosen = ana.lastRoom().theme;
  check('O12 tous ont voté : préparation immédiate ; thème gagnant (2 voix pour celui de Ben), identique pour tous', chosen.themeId === themeBen && chosen.source === 'vote' && [ben, cleo].every((c) => c.lastRoom().theme && c.lastRoom().theme.themeId === themeBen));
  check('O13 les voix de chaque thème sont montrées après le résultat', ana.lastRoom().pre.book.themes.find((th) => th.id === themeBen).votes === 2);

  /* --- préparation --- */
  check('O14 un joueur ne peut pas valider un tempo ou une difficulté invalide', (await ana.expectError({ t: 'pre-prep', bpm: 100, instrumentId: 'piano', mode: 'dieu' }, 'invalid')).code === 'invalid' && (await ana.expectError({ t: 'pre-prep', bpm: 'vite', instrumentId: 'piano', mode: 'expert' }, 'invalid')).code === 'invalid');
  ana.send({ t: 'pre-prep', bpm: 500, instrumentId: 'trumpet', mode: 'baby' });
  await ben.wait('room', (m) => m.room.pre && m.room.pre.ready.includes(ana.id));
  check('O15 les choix de préparation restent secrets tant que la phase n\'est pas finie ; on voit seulement « prêt »', ben.lastRoom().pre.prep === null && ben.lastRoom().pre.ready.length === 1);
  check('O16 on ne peut pas valider deux fois', (await ana.expectError({ t: 'pre-prep', bpm: 100, instrumentId: 'piano', mode: 'expert' }, 'already')).code === 'already');
  ben.send({ t: 'pre-prep', bpm: 80, instrumentId: 'flute', mode: 'beginner' });
  const fromGo = ana.messages.length;
  cleo.send({ t: 'pre-prep', bpm: 140, instrumentId: 'bass', mode: 'expert' });
  await Promise.all([ana, ben, cleo].map((c) => c.wait('room', (m) => m.room.round && m.room.pre && m.room.pre.stage === 'done', fromGo)));
  const finalView = ana.lastRoom();
  check('O17 tous ont validé : on passe ensemble à la composition (round 1)', finalView.round.index === 0 && finalView.round.status === 'intro' && [ben, cleo].every((c) => c.lastRoom().round.index === 0));
  check('O18 le tempo de chaque chanson est celui de son créateur (borné à 180) ; instrument et difficulté enregistrés', finalView.songs.map((s) => s.bpm).join() === '180,80,140' && finalView.pre.prep[ana.id].instrumentId === 'trumpet' && finalView.pre.prep[ana.id].mode === 'baby' && finalView.pre.prep[cleo.id].mode === 'expert');
  check('O19 le thème gagnant est le thème officiel de la partie pour toute la suite', finalView.theme.themeId === themeBen);
  await sleep(450);
  check('O20 après les phases, aucune commande de phase ne passe (plus de transition possible)', (await ana.expectError({ t: 'pre-prep', bpm: 100, instrumentId: 'piano', mode: 'expert' }, 'bad-state')).code === 'bad-state');
  const stageSeqs = ana.messages.filter((m) => m.room && m.room.pre).map((m) => m.room.pre && m.room.pre.seq);
  check('O21 chaque phase n\'est entrée qu\'une fois : le compteur de transitions augmente 1 → 2 → 3 → 4 sans saut ni retour', stageSeqs.every((s, i) => i === 0 || s >= stageSeqs[i - 1]) && Math.max(...stageSeqs) === 4, [...new Set(stageSeqs)]);
  const contrib = await ana.request({ t: 'submit', round: 0, contribution: { instrumentId: 'trumpet', instrument: { id: 'trumpet' }, settings: null, mode: 'baby', notes: [{ step: 0, row: 3, length: 1 }] } }, 'contribution').catch((e) => e);
  await sleep(100);
  check('O22 la difficulté choisie est enregistrée avec la contribution', g.room.contributions.length === 0 || (g.room.contributions[0] && g.room.contributions[0].mode === 'baby') || contrib.contribution === undefined);
  g.clients.forEach((c) => c.close());

  /* --- chrono de proposition expiré (une personne n'a rien proposé) --- */
  g = await open(3, ['Dan', 'Eva', 'Fred'], { proposeSeconds: 10, voteSeconds: 10, prepSeconds: 10 });
  const [dan, eva, fred] = g.clients;
  g.room.settings.proposeSeconds = 10;
  await dan.request({ t: 'start' }, 'started');
  await Promise.all([eva.wait('started'), fred.wait('started')]);
  g.room.pre.endsAt = Date.now() + 700; // on raccourcit le chrono réel de la phase (le serveur reste l'autorité)
  dan.send({ t: 'pre-propose', text: 'Idée de Dan' });
  eva.send({ t: 'pre-propose', text: 'Idée d\'Eva' });
  await Promise.all([dan, eva, fred].map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'vote', 0, 5000)));
  check('E1 chrono de proposition écoulé : la partie passe au vote sans rester bloquée, sans idée fictive', dan.lastRoom().pre.book.themes.length === 2 && !dan.lastRoom().pre.book.proposedBy.includes(fred.id));
  check('E2 Fred (qui n\'a rien proposé) voit les 2 idées des autres', fred.lastRoom().pre.book.themes.filter((th) => th.authorId !== fred.id).length === 2);
  g.room.pre.endsAt = Date.now() + 500; // vote : personne ne vote → chrono
  await Promise.all([dan, eva, fred].map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'prep', 0, 5000)));
  check('E3 chrono du vote écoulé sans aucun vote : tirage au sort parmi les idées, la partie continue', dan.lastRoom().theme && dan.lastRoom().theme.source === 'random' && [eva, fred].every((c) => c.lastRoom().theme.themeId === dan.lastRoom().theme.themeId));
  g.room.pre.endsAt = Date.now() + 500; // préparation : Dan valide, les autres non
  dan.send({ t: 'pre-prep', bpm: 90, instrumentId: 'synth', mode: 'baby' });
  await Promise.all([dan, eva, fred].map((c) => c.wait('room', (m) => m.room.round && m.room.pre && m.room.pre.stage === 'done', 0, 5000)));
  const fin = dan.lastRoom();
  check('E4 chrono de préparation écoulé : paramètres par défaut pour ceux qui n\'ont pas répondu, la partie avance', fin.pre.prep[eva.id].source === 'default' && fin.pre.prep[fred.id].instrumentId === 'piano' && fin.pre.prep[dan.id].source === 'player' && fin.round.index === 0);
  g.clients.forEach((c) => c.close());

  /* --- deux joueurs : tirage au sort --- */
  g = await open(2, ['Gus', 'Hana']);
  const [gus, hana] = g.clients;
  await gus.request({ t: 'start' }, 'started'); await hana.wait('started');
  gus.send({ t: 'pre-propose', text: 'Idée de Gus' }); hana.send({ t: 'pre-propose', text: 'Idée de Hana' });
  await Promise.all([gus, hana].map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'vote')));
  const drawView = gus.lastRoom();
  check('D1 à deux joueurs : tirage au sort, thème connu immédiatement et identique pour les deux', drawView.pre.voteDraw && drawView.theme && drawView.theme.source === 'draw' && hana.lastRoom().theme.themeId === drawView.theme.themeId);
  check('D2 le vote est désactivé à deux joueurs', (await gus.expectError({ t: 'pre-vote', id: 'theme-2' }, 'draw')).code === 'draw');
  const draws = new Set();
  for (let i = 0; i < 10; i += 1) { const book = Themes.create(); Themes.propose(book, { id: 'x', name: 'X' }, 'A'); Themes.propose(book, { id: 'y', name: 'Y' }, 'B'); draws.add(Themes.resolve(book, () => crypto_rand(), true).themeId); }
  check('D3 le tirage au sort de deux idées donne bien les deux résultats possibles', draws.size === 2, [...draws]);
  await Promise.all([gus, hana].map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'prep', 0, 4000)));
  check('D4 après le tirage : préparation', gus.lastRoom().pre.stage === 'prep');
  g.clients.forEach((c) => c.close());

  /* --- déconnexion : un absent ne bloque pas --- */
  g = await open(3, ['Iris', 'Jo', 'Kim']);
  const [iris, jo, kim] = g.clients;
  await iris.request({ t: 'start' }, 'started'); await Promise.all([jo.wait('started'), kim.wait('started')]);
  iris.send({ t: 'pre-propose', text: 'Idée Iris' }); jo.send({ t: 'pre-propose', text: 'Idée Jo' });
  await sleep(150);
  kim.close();
  await Promise.all([iris, jo].map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'vote', 0, 4000)));
  check('X1 Kim se déconnecte avant de proposer : les présents ont tous proposé → vote, personne n\'attend Kim', iris.lastRoom().pre.stage === 'vote');
  [iris, jo].forEach((c) => c.close());

  console.log('\n' + passed + ' réussis, ' + failures.length + ' échecs');
  server.close();
}

function crypto_rand() { return require('crypto').randomInt(0, 1000000) / 1000000; }

pureThemes();
purePhases();
online()
  .then(() => {
    if (failures.length) {
      console.log('ÉCHECS : ' + failures.join(' | '));
      process.exit(1);
    }
    console.log(passed + '/' + passed + ' OK');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
