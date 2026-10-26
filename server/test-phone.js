'use strict';
/**
 * Tests du mode PHONE : règles pures (js/phone.js), logique du salon avec horloge simulée, puis vrais clients WebSocket + HTTP.
 *   node test-phone.js
 */
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const Phone = require('../js/phone.js');
const { RoomManager, PhoneRoom, LIMITS } = require('./rooms');
const { server, manager: liveManager } = require('./server');

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

//* ---------------------------------------------------------------- */
/*  1. Règles pures                                                  */
/* ---------------------------------------------------------------- */

check('3 rounds minimum, n au maximum', Phone.roundCount(5, 1) === 3 && Phone.roundCount(5, 0) === 5 && Phone.roundCount(5, 99) === 5 && Phone.roundCount(3, 8) === 3 && Phone.roundCount(8, 0) === 8);
check('types de rounds : idée, chanter, recopier, chanter de mémoire, deviner', JSON.stringify(Phone.kinds(5)) === '["origin","sing","transcribe","sing","guess"]', Phone.kinds(5));
check('3 rounds : idée, chanter, deviner', JSON.stringify(Phone.kinds(3)) === '["origin","sing","guess"]');
check('6 rounds : idée, voix, notes, voix, notes → deviner', JSON.stringify(Phone.kinds(6)) === '["origin","sing","transcribe","sing","transcribe","guess"]');
check('le premier round est toujours l\'idée (texte), le dernier toujours deviner', [3, 4, 5, 6, 7, 8].every((n) => Phone.kinds(n)[0] === 'origin' && Phone.kinds(n)[n - 1] === 'guess' && Phone.contentOf('origin') === 'text'));
check('après l\'idée, ça alterne voix / notes (jamais deux voix ni deux notes de suite)', [3, 4, 5, 6, 7, 8].every((n) => {
  const content = Phone.kinds(n).slice(1, n - 1).map(Phone.contentOf);
  return content[0] === 'voice' && content.every((c, i) => i === 0 || c !== content[i - 1]);
}));
check('personne ne retrouve une chaîne déjà touchée (n de 3 à 8)', [3, 4, 5, 6, 7, 8].every((n) => {
  for (let player = 0; player < n; player += 1) {
    const seen = new Set();
    for (let round = 0; round < n; round += 1) seen.add(Phone.chainOf(player, round, n));
    if (seen.size !== n) return false;
  }
  return true;
}));
check('chaque round : chaque chaîne est travaillée par un seul joueur', [3, 5, 8].every((n) => {
  for (let round = 0; round < n; round += 1) {
    const chains = new Set(Array.from({ length: n }, (_, player) => Phone.chainOf(player, round, n)));
    if (chains.size !== n) return false;
  }
  return true;
}));
check('chainOf et playerOf sont inverses', [3, 6, 8].every((n) => {
  for (let chain = 0; chain < n; chain += 1) for (let round = 0; round < n; round += 1) if (Phone.chainOf(Phone.playerOf(chain, round, n), round, n) !== chain) return false;
  return true;
}));
check('durées : recopier 300 s par défaut, chanter 120 s, idée et deviner 60 s', Phone.seconds('transcribe', {}) === 300 && Phone.seconds('transcribe', { roundSeconds: 240 }) === 240 && Phone.seconds('sing', {}) === 120 && Phone.seconds('origin', {}) === 60 && Phone.seconds('guess', {}) === 60);

/* ---------------------------------------------------------------- */
/*  2. Logique du salon avec horloge simulée                         */
/* ---------------------------------------------------------------- */

function fakeRoom(playerCount, rounds) {
  let time = 1000000;
  const manager = new RoomManager({ now: () => time });
  manager.introMs = 1000;
  const created = manager.create({ name: 'P1', max: 8 }, () => {});
  const room = created.room;
  const joined = [created.player];
  for (let index = 2; index <= playerCount; index += 1) joined.push(manager.join({ code: room.code, name: 'P' + index }, () => {}).player);
  manager.configure(room, room.hostId, { gameMode: 'phone', phoneRounds: rounds || 0 });
  const advance = (ms) => {
    time += ms;
    return manager.tick(room);
  };
  return { manager, room, players: joined, advance, setTime: (t) => { time = t; } };
}

const PIANO_TRACK = (steps) => ({ instrumentId: 'piano', notes: steps.map((step) => ({ step, row: 12, length: 1 })) });
const WAV = (tag) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from(String(tag).padEnd(64, '.'))]);
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
/** Envoie une voix au salon et renvoie le maillon « voix » correspondant. */
function voiceLink(manager, room, player, tag, bpm, title) {
  const wav = WAV(tag);
  const hash = sha(wav);
  manager.putSound(room.code, player.token, hash, wav);
  const link = { bpm, tracks: [{ hash, duration: 3, start: 0, gainDb: 0, peaks: [0.1, 0.2], sampleRate: 32000 }] };
  if (title !== undefined) link.text = title;
  return { link, hash };
}

{
  const game = fakeRoom(4, 0);
  const { manager, room, players, advance } = game;
  check('le mode Phone est accepté par la configuration', room.settings.gameMode === 'phone');
  check('Phone refuse moins de 3 joueurs', (() => {
    const small = fakeRoom(2, 0);
    return small.manager.start(small.room, small.room.hostId).code === 'not-enough';
  })());
  const started = manager.start(room, room.hostId);
  check('la partie Phone démarre avec 4 joueurs', started.ok && room.status === 'playing' && room.phone.total === 4);
  check('pas de phases de thème/vote en Phone', room.pre === null && room.round === null);
  check('4 rounds : idée, chanter, recopier, deviner', JSON.stringify(room.phone.kinds) === '["origin","sing","transcribe","guess"]');
  advance(1100);
  check('après l\'annonce le chrono démarre (60 s pour l\'idée)', room.phone.round.status === 'working' && Math.round(room.phone.round.durationMs / 1000) === 60);

  // round 0 : tout le monde écrit une chanson / un thème
  const r0 = players.map((p, i) => manager.phoneSubmit(room, p.id, { round: 0, link: { text: '  Chanson ' + (i + 1) + '<b>  ' } }));
  check('les 4 idées sont acceptées, textes nettoyés', r0.every((r) => r.ok) && room.phone.chains[0].links[0].text === 'Chanson 1b');
  check('doublon refusé', manager.phoneSubmit(room, players[0].id, { round: 0, link: { text: 'x' } }).code === 'duplicate');
  advance(10);
  check('tous prêts : le round 2 (chanter) s\'annonce tout de suite', room.phone.round.index === 1 && room.phone.round.kind === 'sing' && room.phone.round.status === 'intro');
  check('chanter dure 120 s', Math.round(room.phone.round.durationMs / 1000) === 120);
  const inputs = players.map((p) => PhoneRoom.inputFor(room, p.id));
  check('chacun reçoit l\'idée d\'un AUTRE joueur, bien visible', inputs.every((input, i) => /^Chanson \d/.test(input.previous.text) && input.previous.text !== 'Chanson ' + (i + 1) + 'b'));
  check('joueur 1 reçoit la chaîne du joueur 4 au round 2 (rotation)', inputs[0].chain === 3 && inputs[0].previous.text === 'Chanson 4b');
  advance(1100);

  // chanter : la voix doit d'abord être sur le serveur
  const wav = WAV('mem');
  const hash = sha(wav);
  const voice = (bpm) => ({ bpm, tracks: [{ hash, duration: 3, start: 0, gainDb: 0, peaks: [0.1, 0.2], sampleRate: 32000 }] });
  check('chanter : voix absente du serveur → refus', manager.phoneSubmit(room, players[0].id, { round: 1, link: voice(100) }).code === 'missing-sound');
  manager.putSound(room.code, players[0].token, hash, wav);
  check('chanter : la voix d\'un autre joueur ne peut pas être citée', manager.phoneSubmit(room, players[1].id, { round: 1, link: voice(100) }).ok === false);
  check('chanter : des notes sont refusées', manager.phoneSubmit(room, players[0].id, { round: 1, link: { bpm: 100, tracks: [PIANO_TRACK([0])] } }).ok === false);
  const sung = manager.phoneSubmit(room, players[0].id, { round: 1, link: voice(100) });
  check('chanter : voix acceptée (sans le contenu audio)', sung.ok && sung.link.tracks[0].hash === hash && !sung.link.tracks[0].wav);
  const hashes = [hash];
  players.slice(1).forEach((p, i) => hashes.push(manager.phoneSubmit(room, p.id, { round: 1, link: voiceLink(manager, room, p, 'v1p' + i, 100).link }).link.tracks[0].hash));
  advance(10);
  check('round 3 : recopier (300 s)', room.phone.round.kind === 'transcribe' && Math.round(room.phone.round.durationMs / 1000) === 300);
  const inputs2 = players.map((p) => PhoneRoom.inputFor(room, p.id));
  check('recopier : chacun reçoit une voix qui n\'est pas la sienne', inputs2.every((input, i) => input.previous.tracks && input.previous.tracks[0].hash !== hashes[i]));
  check('le tempo reçu est celui de la voix', inputs2.every((input) => input.bpm === 100));
  advance(1100);
  check('recopier : des voix sont refusées', manager.phoneSubmit(room, players[0].id, { round: 2, link: voiceLink(manager, room, players[0], 'zz', 100).link }).code === 'invalid');
  check('recopier : le micro est refusé', !manager.phoneSubmit(room, players[0].id, { round: 2, link: { bpm: 100, tracks: [{ instrumentId: 'mic', notes: [], clip: { wav: 'AAAA', duration: 1, start: 0, gainDb: 0 } }] } }).ok);
  check('recopier : au moins une note', !manager.phoneSubmit(room, players[0].id, { round: 2, link: { bpm: 100, tracks: [{ instrumentId: 'piano', notes: [] }] } }).ok);
  check('recopier : tempo différent de la voix reçue refusé', manager.phoneSubmit(room, players[0].id, { round: 2, link: { bpm: 120, tracks: [PIANO_TRACK([0])] } }).ok === false);
  check('recopier : 7 pistes refusées (6 max)', !manager.phoneSubmit(room, players[0].id, { round: 2, link: { bpm: 100, tracks: Array.from({ length: 7 }, () => PIANO_TRACK([0])) } }).ok);
  check('recopier : note hors de la boucle refusée', !manager.phoneSubmit(room, players[0].id, { round: 2, link: { bpm: 100, tracks: [PIANO_TRACK([99])] } }).ok);
  check('mauvais round refusé', manager.phoneSubmit(room, players[0].id, { round: 0, link: { text: 'x' } }).code === 'stale-round');
  const r1 = manager.phoneSubmit(room, players[0].id, { round: 2, link: { bpm: 100, tracks: [PIANO_TRACK([0, 1, 2]), PIANO_TRACK([4, 8])] } });
  check('recopier : plusieurs pistes acceptées', r1.ok && r1.link.tracks.length === 2 && r1.link.bpm === 100);

  manager.disconnect(room, players[3].id);
  advance(room.phone.round.durationMs + 100);
  check('chrono à zéro : délai de grâce', room.phone.round.status === 'closing');
  [1, 2].forEach((i) => manager.phoneSubmit(room, players[i].id, { round: 2, link: { bpm: 100, tracks: [PIANO_TRACK([0])] } }));
  advance(PhoneRoom.GRACE_MS + 100);
  check('fin du délai : round suivant (deviner)', room.phone.round.index === 3 && room.phone.round.kind === 'guess');
  const links2 = room.phone.chains.map((chain) => chain.links[2]);
  check('les absents ont un maillon vide (aucun contenu inventé)', links2.filter((l) => l.empty).length === 1 && links2.filter((l) => !l.empty).length === 3);
  check('le joueur déconnecté est marqué « absent »', links2.find((l) => l.playerId === players[3].id).endReason === 'absent');
  const guessInputs = players.map((p) => PhoneRoom.inputFor(room, p.id));
  check('deviner : maillon précédent manquant signalé, pas d\'erreur', guessInputs.filter((i) => i.previous.missing).length === 1 && guessInputs.filter((i) => i.previous.tracks).length === 3);

  advance(1100);
  manager.phoneSubmit(room, players[0].id, { round: 3, link: { text: 'Ma réponse' } });
  advance(60 * 1000 + 100);
  advance(PhoneRoom.GRACE_MS + 100);
  check('fin de partie : état terminé, révélation en attente', room.status === 'finished' && room.phone.reveal.stage === 'waiting');
  check('chaînes cachées avant la révélation', PhoneRoom.chainsPayload(room) === null);
  check('révélation : seul l\'hôte', manager.phoneReveal(room, players[1].id, 'start').code === 'not-host');
  check('révélation : démarrer', manager.phoneReveal(room, room.hostId, 'start').ok && room.phone.reveal.chain === 0 && room.phone.reveal.shown === 1);
  const payload = PhoneRoom.chainsPayload(room);
  check('toutes les chaînes sont envoyées à la révélation', payload.length === 4 && payload.every((chain) => chain.links.length === 4) && payload[0].links[0].text === 'Chanson 1b');
  check('les chaînes ne contiennent pas de jetons', !JSON.stringify(payload).includes(players[0].token));
  let steps = 0;
  while (manager.phoneReveal(room, room.hostId, 'next').ok) steps += 1;
  check('révélation : 4 chaînes × 4 maillons', steps === 15 && room.phone.reveal.chain === 3 && room.phone.reveal.shown === 4);
  check('voix encore présentes avant la fin', room.sounds.size >= 1);
  check('terminer efface les voix du serveur', manager.phoneReveal(room, room.hostId, 'end').ok && room.sounds.size === 0 && room.soundBytes === 0 && room.phone.purged === true);
  check('GET d\'une voix effacée = introuvable', manager.getSound(room.code, players[0].token, hash).status === 404);
}

{
  const game = fakeRoom(5, 3);
  game.manager.start(game.room, game.room.hostId);
  check('5 joueurs, 3 rounds demandés : idée / chanter / deviner', JSON.stringify(game.room.phone.kinds) === '["origin","sing","guess"]' && game.room.phone.chains.length === 5);
  const quick = fakeRoom(3, 0);
  quick.manager.start(quick.room, quick.room.hostId);
  check('3 joueurs : 3 rounds', quick.room.phone.total === 3);
  quick.advance(1100);
  check('idée : un texte est obligatoire', quick.manager.phoneSubmit(quick.room, quick.players[0].id, { round: 0, link: { text: '   ' } }).ok === false);
  const wavs = Array.from({ length: 12 }, (_, i) => WAV('w' + i));
  const results = wavs.map((w) => quick.manager.putSound(quick.room.code, quick.players[0].token, sha(w), w));
  check('Phone : plus de 8 voix par joueur acceptées', results.every((r) => r.ok), results.map((r) => r.status));
  check('Phone : quotas plus larges déclarés', LIMITS.sound.phone.perPlayer > LIMITS.sound.perPlayer && LIMITS.sound.phone.roomBytes > LIMITS.sound.roomBytes);
  const gone = fakeRoom(3, 0);
  gone.manager.start(gone.room, gone.room.hostId);
  gone.manager.putSound(gone.room.code, gone.players[0].token, sha(wavs[0]), wavs[0]);
  gone.players.forEach((p) => gone.manager.disconnect(gone.room, p.id));
  gone.setTime(1000000 + 31 * 60 * 1000);
  gone.manager.sweep();
  check('salon abandonné : supprimé, voix effacées', !gone.manager.rooms.has(gone.room.code) && gone.room.sounds.size === 0);
}

/* Parties complètes simulées : 3 à 8 joueurs, toutes les durées de partie possibles */
{
  let allGood = true;
  let detail = null;
  let games = 0;
  for (let n = 3; n <= 8; n += 1) {
    for (let rounds = 3; rounds <= n; rounds += 1) {
      const game = fakeRoom(n, rounds);
      const { manager, room, players, advance } = game;
      manager.start(room, room.hostId);
      for (let guard = 0; guard < rounds * 4 && room.status === 'playing'; guard += 1) {
        advance(1100);
        const kind = room.phone.round.kind;
        const index = room.phone.round.index;
        players.forEach((p, i) => {
          const input = PhoneRoom.inputFor(room, p.id);
          let link;
          if (kind === 'guess') link = { text: 'r' + index + 'p' + i };
          else if (kind === 'sing' && !input.previous.tracks) link = voiceLink(manager, room, p, 'v' + index + 'p' + i, 100).link;
          else if (kind === 'origin') link = { text: 'titre ' + i };
          else if (kind === 'sing') link = voiceLink(manager, room, p, 'v' + index + 'p' + i, input.bpm).link;
          else link = { bpm: input.bpm, tracks: [PIANO_TRACK([0, 1])] };
          const result = manager.phoneSubmit(room, p.id, { round: index, link });
          if (!result.ok) { allGood = false; detail = [n, rounds, kind, result.error]; }
        });
        advance(10);
      }
      games += 1;
      const chainsOk = room.status === 'finished' && room.phone.chains.length === n && room.phone.chains.every((chain) => {
        const owners = chain.links.map((l) => l.playerId);
        return chain.links.length === rounds && new Set(owners).size === rounds && chain.links.every((l) => !l.empty) && chain.links.map((l) => l.kind).join() === Phone.kinds(rounds).join();
      });
      if (!chainsOk) { allGood = false; detail = detail || [n, rounds, room.status]; }
    }
  }
  check('parties complètes de 3 à 8 joueurs, 3 à n rounds (' + games + ' parties) : chaînes complètes, aucun joueur deux fois dans la même chaîne', allGood, detail);
}

/* ---------------------------------------------------------------- */
/*  3. Vrais clients WebSocket + HTTP                                */
/* ---------------------------------------------------------------- */

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
  wait(t, predicate, from = 0, timeout = 5000) {
    const match = (m) => m.t === t && (!predicate || predicate(m));
    const existing = this.messages.slice(from).find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout en attendant ' + t + ' (' + this.name + ')')), timeout);
      this.waiters.push((m) => {
        if (!match(m)) return false;
        clearTimeout(timer);
        resolve(m);
        return true;
      });
    });
  }
  close() {
    this.ws.close();
  }
}

function httpRequest(port, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream' } : {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function online() {
  liveManager.introMs = 30;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const clients = ['Anna', 'Ben', 'Cléo', 'Dan'].map((name) => new Client(port, name));
  await Promise.all(clients.map((c) => c.ready));
  const [host, ...others] = clients;
  host.send({ t: 'create', name: host.name, max: 6 });
  const welcome = await host.wait('welcome');
  const code = welcome.room.code;
  others.forEach((c) => c.send({ t: 'join', code, name: c.name }));
  await Promise.all(others.map((c) => c.wait('welcome')));
  const you = {};
  for (const c of clients) you[c.name] = (await c.wait('welcome')).you;

  others[0].send({ t: 'configure', gameMode: 'phone' });
  const denied = await others[0].wait('error');
  check('seul l\'hôte configure le mode', denied.code === 'not-host');
  host.send({ t: 'configure', gameMode: 'phone', roundSeconds: 300 });
  await host.wait('room', (m) => m.room.settings.gameMode === 'phone');
  host.send({ t: 'start' });
  const started = await host.wait('started');
  check('partie Phone lancée en ligne', started.room.settings.gameMode === 'phone' && started.room.phone && started.room.phone.total === 4);
  const inputs0 = await Promise.all(clients.map((c) => c.wait('phone-input', (m) => m.input.round === 0)));
  check('chacun reçoit sa consigne en privé (round idée)', inputs0.every((m) => m.input.kind === 'origin' && m.input.previous === null));
  await sleep(450);
  clients.forEach((c) => c.send({ t: 'phone-submit', round: 0, link: { text: 'Titre de ' + c.name } }));
  const inputs1 = await Promise.all(clients.map((c) => c.wait('phone-input', (m) => m.input.round === 1)));
  check('round chanter : chacun reçoit l\'idée d\'un autre joueur', inputs1.every((m, i) => m.input.kind === 'sing' && /^Titre de /.test(m.input.previous.text) && m.input.previous.text !== 'Titre de ' + clients[i].name));
  await sleep(450);
  const hashes = {};
  for (const c of clients) {
    const wav = WAV('origine-' + c.name);
    const hash = sha(wav);
    hashes[c.name] = hash;
    const put = await httpRequest(port, 'PUT', '/rooms/' + code + '/sounds/' + hash, you[c.name].token, wav);
    if (put.status !== 201) check('envoi HTTP de la voix de ' + c.name, false, put.status);
    c.send({ t: 'phone-submit', round: 1, link: { bpm: 100, tracks: [{ hash, duration: 2.5, start: 0, gainDb: 0, peaks: [0.1], sampleRate: 32000 }] } });
  }
  const inputs2 = await Promise.all(clients.map((c) => c.wait('phone-input', (m) => m.input.round === 2)));
  check('round recopier : chacun reçoit une voix qui n\'est pas la sienne', inputs2.every((m, i) => m.input.kind === 'transcribe' && m.input.previous.tracks[0].hash !== hashes[clients[i].name] && m.input.bpm === 100));
  const fetched = await httpRequest(port, 'GET', '/rooms/' + code + '/sounds/' + inputs2[0].input.previous.tracks[0].hash, you.Anna.token);
  check('la voix se télécharge avec le jeton du salon', fetched.status === 200 && fetched.body.length > 40);
  const stranger = await httpRequest(port, 'GET', '/rooms/' + code + '/sounds/' + inputs2[0].input.previous.tracks[0].hash, 'faux-jeton');
  check('sans jeton valide : refusé', stranger.status === 403);
  await sleep(450);
  clients.forEach((c) => c.send({ t: 'phone-submit', round: 2, link: { bpm: 100, tracks: [PIANO_TRACK([0, 2, 4])] } }));
  const inputs3 = await Promise.all(clients.map((c) => c.wait('phone-input', (m) => m.input.round === 3)));
  check('round deviner : on reçoit les notes du joueur précédent', inputs3.every((m) => m.input.kind === 'guess' && m.input.previous.tracks.length === 1));
  await sleep(450);
  clients.forEach((c) => c.send({ t: 'phone-submit', round: 3, link: { text: 'Je pense que c\'est la chanson de ' + c.name } }));
  await Promise.all(clients.map((c) => c.wait('room', (m) => m.room.status === 'finished')));
  check('partie terminée, révélation en attente', true);

  host.send({ t: 'phone-reveal', command: 'start' });
  const chains = await Promise.all(clients.map((c) => c.wait('phone-chains')));
  check('à la révélation, tout le monde reçoit les 4 chaînes complètes', chains.every((m) => m.chains.length === 4 && m.chains.every((chain) => chain.links.length === 4)));
  check('chaque chaîne : idée → voix → notes → deviner', chains[0].chains.every((chain) => chain.links.map((l) => l.kind).join() === 'origin,sing,transcribe,guess'));
  check('les idées sont dans les chaînes révélées', chains[0].chains[0].links[0].text === 'Titre de Anna');
  others[0].send({ t: 'phone-reveal', command: 'next' });
  check('un joueur ne pilote pas la révélation', (await others[0].wait('error', (m) => m.code === 'not-host')).code === 'not-host');
  for (let i = 0; i < 15; i += 1) host.send({ t: 'phone-reveal', command: 'next' });
  await host.wait('room', (m) => m.room.phone && m.room.phone.reveal.chain === 3 && m.room.phone.reveal.shown === 4);
  const stillThere = await httpRequest(port, 'GET', '/rooms/' + code + '/sounds/' + hashes.Anna, you.Anna.token);
  check('voix encore disponibles pendant la révélation', stillThere.status === 200);
  host.send({ t: 'phone-reveal', command: 'end' });
  await host.wait('room', (m) => m.room.phone && m.room.phone.reveal.stage === 'ended');
  const gone = await httpRequest(port, 'GET', '/rooms/' + code + '/sounds/' + hashes.Anna, you.Anna.token);
  check('après la fin de la partie, les voix sont supprimées', gone.status === 404);

  clients.forEach((c) => c.close());
  await new Promise((resolve) => server.close(resolve));
}

online()
  .catch((error) => {
    check('suite en ligne sans erreur', false, String(error && error.stack || error));
  })
  .finally(() => {
    console.log(failures.length ? 'ÉCHECS : ' + failures.length + ' — ' + failures.join(' | ') : 'OK ' + passed + '/' + passed);
    process.exit(failures.length ? 1 : 0);
  });
