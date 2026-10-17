'use strict';
/**
 * Tests des thèmes et du vote : règles pures (js/themes.js) puis vrai serveur avec de vrais clients WebSocket.
 */
const WebSocket = require('ws');
const Themes = require('../js/themes.js');
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
  wait(t, predicate, from = 0, timeout = 4000) {
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
  /** Envoie une commande ; attend un instant, puis renvoie { error } si le serveur a refusé, sinon { room } (dernière vue). */
  async cmd(message) {
    const from = this.messages.length;
    this.send(message);
    await sleep(120);
    const error = this.messages.slice(from).find((m) => m.t === 'error');
    if (error) return { error };
    return { room: this.last() };
  }
  last() {
    return this.messages.filter((m) => m.t === 'room').slice(-1)[0].room;
  }
  close() {
    this.ws.close();
  }
}


function pure() {
  const P = (id, name) => ({ id, name });
  const book = Themes.create();
  const alice = P('a', 'Alice');
  check('T1 proposition valide enregistrée avec son auteur', Themes.propose(book, alice, '  Une musique de boss final  ').ok && book.themes[0].text === 'Une musique de boss final' && book.themes[0].authorName === 'Alice');
  check('T2 proposition vide ou d\'espaces rejetée', Themes.propose(book, alice, '   ').code === 'empty' && Themes.propose(book, alice, undefined).code === 'empty');
  check('T3 au-delà de 100 caractères : rejetée (pas tronquée en silence)', Themes.propose(book, alice, 'x'.repeat(101)).code === 'too-long' && Themes.propose(book, alice, 'y'.repeat(100)).ok);
  check('T4 doublon évident rejeté (casse, accents, ponctuation)', Themes.propose(book, P('b', 'Bob'), 'UNE MUSIQUE DE BOSS FINAL !!!').code === 'duplicate' && Themes.propose(book, P('b', 'Bob'), 'une musique de boss final').code === 'duplicate');
  Themes.propose(book, alice, 'Troisième');
  check('T5 limite par joueur (3)', Themes.propose(book, alice, 'Fin du monde').code === 'limit-player');
  check('T6 caractères de contrôle nettoyés, HTML conservé tel quel comme texte', Themes.propose(book, P('b', 'Bob'), 'a\u0000b <b>x</b>').theme.text === 'a b <b>x</b>');
  const bob = P('b', 'Bob');
  Themes.propose(book, bob, 'La fin du monde');
  const ids = ['a', 'b', 'c'];
  const t0 = book.themes[0].id;
  check('T7 vote refusé tant que le vote n\'est pas ouvert', Themes.cast(book, 'a', t0, 0, ids).code === 'closed');
  check('T8 seul l\'hôte ouvre le vote', Themes.openVote(book, 'b', 'a', 30, 0).code === 'not-host' && Themes.openVote(book, 'a', 'a', 30, 1000).ok);
  check('T9 plus de proposition une fois le vote ouvert', Themes.propose(book, P('c', 'Cléa'), 'Nouveau').code === 'bad-state');
  Themes.cast(book, 'a', t0, 1500, ids);
  Themes.cast(book, 'a', book.themes[1].id, 1600, ids);
  check('T10 un joueur = un seul vote, modifiable (pas de doublon)', Object.keys(book.vote.votes).length === 1 && book.vote.votes.a === book.themes[1].id && Themes.tally(book, ids)[t0] === 0 && Themes.tally(book, ids)[book.themes[1].id] === 1);
  check('T11 vote pour un thème inconnu ou par un étranger refusé', Themes.cast(book, 'a', 'theme-999', 1700, ids).code === 'no-theme' && Themes.cast(book, 'zzz', t0, 1700, ids).code === 'not-allowed');
  check('T12 le vote se ferme au bout du temps', Themes.tick(book, 30999, ids) === false && Themes.tick(book, 31000, ids) === true && book.vote.status === 'closed');
  check('T13 un seul vote : ce thème gagne et devient officiel (source vote)', book.theme && book.theme.themeId === book.themes[1].id && book.theme.source === 'vote' && book.result.reason === 'winner');
  check('T14 après clôture, plus aucun vote ne change', Themes.cast(book, 'b', t0, 31001, ids).code === 'closed' && Themes.tally(book, ids)[book.themes[1].id] === 1);

  // égalité
  const tie = Themes.create();
  Themes.propose(tie, alice, 'Un'); Themes.propose(tie, alice, 'Deux'); Themes.propose(tie, alice, 'Trois');
  Themes.openVote(tie, 'a', 'a', 30, 0);
  Themes.cast(tie, 'a', 'theme-1', 1, ids); Themes.cast(tie, 'b', 'theme-2', 1, ids); Themes.cast(tie, 'c', 'theme-3', 1, ids);
  check('T15 vote manuel clos par l\'hôte seulement', Themes.close(tie, 'b', 'a', ids).code === 'not-host' && Themes.close(tie, 'a', 'a', ids).ok);
  check('T16 égalité : pas de thème automatique, l\'hôte choisit parmi les ex æquo', tie.theme === null && tie.result.reason === 'tie' && tie.result.tied.length === 3);
  check('T17 choix de l\'hôte : seulement lui, seulement parmi les ex æquo', Themes.pick(tie, 'b', 'a', 'theme-1').code === 'not-host' && Themes.pick(tie, 'a', 'a', 'theme-9').code === 'no-theme' && Themes.pick(tie, 'a', 'a', 'theme-2').ok && tie.theme.source === 'tie' && tie.theme.themeId === 'theme-2');
  const partial = Themes.create();
  Themes.propose(partial, alice, 'Un'); Themes.propose(partial, alice, 'Deux'); Themes.propose(partial, alice, 'Trois');
  Themes.openVote(partial, 'a', 'a', 30, 0);
  Themes.cast(partial, 'a', 'theme-1', 1, ids); Themes.cast(partial, 'b', 'theme-1', 1, ids); Themes.cast(partial, 'c', 'theme-2', 1, ids);
  Themes.close(partial, 'a', 'a', ids);
  check('T18 2 voix contre 1 : le plus voté gagne', partial.theme.themeId === 'theme-1' && partial.result.counts['theme-1'] === 2);
  const lone = Themes.create();
  Themes.propose(lone, alice, 'Un'); Themes.propose(lone, alice, 'Deux');
  Themes.openVote(lone, 'a', 'a', 30, 0);
  Themes.cast(lone, 'a', 'theme-1', 1, ids); Themes.cast(lone, 'b', 'theme-1', 1, ids);
  check('T19 les voix d\'un joueur parti ne comptent pas', Themes.tally(lone, ['a'])['theme-1'] === 1);
  // personne ne vote
  const none = Themes.create();
  Themes.propose(none, alice, 'Un'); Themes.propose(none, alice, 'Deux');
  Themes.openVote(none, 'a', 'a', 5, 0); Themes.tick(none, 5000, ids);
  check('T20 personne n\'a voté : pas de thème automatique, l\'hôte choisit ou prend le thème par défaut', none.theme === null && none.result.reason === 'no-votes' && none.result.tied.length === 2);
  check('T21 thème par défaut : hôte seulement, clairement indiqué', Themes.useDefault(none, 'b', 'a').code === 'not-host' && Themes.useDefault(none, 'a', 'a').ok && none.theme.source === 'default' && /par défaut/.test(Themes.sourceLabel(none.theme)));
  const rm = Themes.create();
  Themes.propose(rm, alice, 'Inapproprié'); Themes.propose(rm, P('b', 'Bob'), 'Bien');
  check('T22 suppression : l\'hôte supprime tout, un joueur seulement la sienne', Themes.remove(rm, 'b', 'a', 'theme-1').code === 'not-host' && Themes.remove(rm, 'a', 'a', 'theme-2').ok && Themes.remove(rm, 'a', 'a', 'theme-1').ok && rm.themes.length === 0);
  const settleBook = Themes.create();
  check('T23 sans aucun choix, le lancement applique le thème par défaut', Themes.settle(settleBook).source === 'default' && settleBook.theme.text === Themes.DEFAULT_TEXT);
  check('T24 limite totale de propositions', (() => { const b = Themes.create(); for (let i = 0; i < 40; i += 1) Themes.propose(b, P('p' + i, 'P' + i), 'thème numéro ' + 'abcdefghijklmnopqrstuvwxyz'.charAt(i % 26) + i); return b.themes.length === Themes.LIMITS.total; })());
}

async function main() {
  pure();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  manager.introMs = 100;

  const host = new Client(port, 'Alice'); await host.ready;
  host.send({ t: 'create', name: 'Alice', max: 4 });
  const welcome = await host.wait('welcome');
  const code = welcome.room.code;
  const bob = new Client(port, 'Bob'); await bob.ready;
  bob.send({ t: 'join', code, name: 'Bob' }); await bob.wait('welcome');
  const cara = new Client(port, 'Cara'); await cara.ready;
  cara.send({ t: 'join', code, name: 'Cara' }); await cara.wait('welcome');
  await host.wait('room', (m) => m.room.players.length === 3);
  const room = manager.get(code);

  let r = await bob.cmd({ t: 'theme-propose', text: '  Un rêve étrange ' });
  check('S1 un joueur propose : tout le monde voit la proposition avec son pseudo', !r.error && (await host.wait('room', (m) => m.room.themes.themes.length === 1)).room.themes.themes[0].authorName === 'Bob' && (await cara.wait('room', (m) => m.room.themes.themes.length === 1)).room.themes.themes[0].text === 'Un rêve étrange');
  check('S2 la proposition est enregistrée dans les données du salon (pas seulement l\'interface)', room.themeBook.themes.length === 1 && room.themeBook.themes[0].authorId === room.players[1].id);
  check('S3 proposition vide / trop longue / doublon refusées par le serveur', (await bob.cmd({ t: 'theme-propose', text: '   ' })).error.code === 'empty' && (await bob.cmd({ t: 'theme-propose', text: 'x'.repeat(500) })).error.code === 'too-long' && (await cara.cmd({ t: 'theme-propose', text: 'UN REVE ETRANGE' })).error.code === 'duplicate');
  check('S4 types invalides (nombre, objet) traités comme vides', (await cara.cmd({ t: 'theme-propose', text: 42 })).error.code === 'empty' && (await cara.cmd({ t: 'theme-propose', text: { a: 1 } })).error.code === 'empty');
  await cara.cmd({ t: 'theme-propose', text: 'Une musique de boss final' });
  await host.cmd({ t: 'theme-propose', text: 'Un truc moche' });
  const tid = (text) => room.themeBook.themes.find((t) => t.text === text).id;
  check('S5 un non-hôte ne peut pas supprimer la proposition d\'un autre', (await cara.cmd({ t: 'theme-remove', id: tid('Un rêve étrange') })).error.code === 'not-host');
  const rem = await host.cmd({ t: 'theme-remove', id: tid('Un truc moche') });
  check('S6 l\'hôte supprime une proposition inappropriée', !rem.error && room.themeBook.themes.length === 2);
  check('S7 un non-hôte ne peut pas ouvrir le vote ni choisir', (await bob.cmd({ t: 'theme-vote-open', seconds: 30 })).error.code === 'not-host' && (await bob.cmd({ t: 'theme-pick', id: tid('Un rêve étrange') })).error.code === 'not-host');
  check('S8 voter avant l\'ouverture est refusé', (await bob.cmd({ t: 'theme-vote', id: tid('Un rêve étrange') })).error.code === 'closed');
  const open = await host.cmd({ t: 'theme-vote-open', seconds: 60 });
  check('S9 l\'hôte ouvre le vote : tous les joueurs le voient ouvert avec un temps restant', !open.error && (await cara.wait('room', (m) => m.room.themes.vote.status === 'open')).room.themes.vote.remainingMs > 50000);
  check('S10 plus de propositions pendant le vote', (await cara.cmd({ t: 'theme-propose', text: 'Trop tard' })).error.code === 'bad-state');
  await bob.cmd({ t: 'theme-vote', id: tid('Une musique de boss final') });
  await bob.cmd({ t: 'theme-vote', id: tid('Un rêve étrange') }); // change d'avis
  await cara.cmd({ t: 'theme-vote', id: tid('Un rêve étrange') });
  await host.cmd({ t: 'theme-vote', id: tid('Un rêve étrange') });
  const counts = host.last().themes.themes.map((t) => t.votes);
  check('S11 comptage exact : Bob a changé d\'avis (3 voix, pas 4), chacun voit les mêmes chiffres', counts.join() === '3,0' && cara.last().themes.themes.map((t) => t.votes).join() === '3,0' && Object.keys(host.last().themes.vote.votes).length === 3);
  check('S12 voter pour un thème inexistant refusé', (await cara.cmd({ t: 'theme-vote', id: 'theme-999' })).error.code === 'no-theme');
  check('S13 lancer la partie pendant le vote est refusé', (await host.cmd({ t: 'start' })).error.code === 'vote-open');
  const closed = await host.cmd({ t: 'theme-vote-close' });
  const seen = (await bob.wait('room', (m) => m.room.themes.vote.status === 'closed')).room;
  check('S14 clôture manuelle : même thème gagnant pour tous', !closed.error && seen.themes.theme && seen.theme.text === 'Un rêve étrange' && seen.theme.source === 'vote' && host.last().theme.text === seen.theme.text && cara.last().theme.text === seen.theme.text);
  check('S15 après la clôture, on ne peut plus changer son vote', (await bob.cmd({ t: 'theme-vote', id: tid('Une musique de boss final') })).error.code === 'closed' && room.themeBook.theme.text === 'Un rêve étrange');

  // lancement : le thème reste dans la partie
  host.send({ t: 'start' });
  const started = await host.wait('started');
  check('S16 le thème gagnant accompagne la partie (même texte pour tous)', started.room.theme.text === 'Un rêve étrange' && (await cara.wait('started')).room.theme.text === 'Un rêve étrange');
  check('S17 après le lancement, thèmes et votes sont figés', (await bob.cmd({ t: 'theme-propose', text: 'Encore' })).error.code === 'started' && (await bob.cmd({ t: 'theme-vote', id: tid('Un rêve étrange') })).error.code === 'started');
  check('S18 la vue contient toujours le thème pendant la partie', room.view().theme.text === 'Un rêve étrange');
  [host, bob, cara].forEach((c) => c.close());

  // vote chronométré + égalité + défaut
  const h2 = new Client(port, 'Dan'); await h2.ready;
  h2.send({ t: 'create', name: 'Dan', max: 4 }); const w2 = await h2.wait('welcome');
  const e2 = new Client(port, 'Eve'); await e2.ready;
  e2.send({ t: 'join', code: w2.room.code, name: 'Eve' }); await e2.wait('welcome');
  const room2 = manager.get(w2.room.code);
  await h2.cmd({ t: 'theme-propose', text: 'Alpha' }); await e2.cmd({ t: 'theme-propose', text: 'Beta' });
  await h2.cmd({ t: 'theme-vote-open', seconds: 5 });
  await h2.cmd({ t: 'theme-vote', id: 'theme-1' }); await e2.cmd({ t: 'theme-vote', id: 'theme-2' });
  const timed = await h2.wait('room', (m) => m.room.themes.vote.status === 'closed', 0, 9000);
  check('S19 le minuteur du vote clôt le vote tout seul (égalité 1-1 : pas de gagnant automatique)', timed.room.themes.result.reason === 'tie' && timed.room.theme === null);
  check('S20 égalité : un non-hôte ne tranche pas, l\'hôte tranche parmi les ex æquo', (await e2.cmd({ t: 'theme-pick', id: 'theme-2' })).error.code === 'not-host' && !(await h2.cmd({ t: 'theme-pick', id: 'theme-2' })).error && room2.themeBook.theme.text === 'Beta' && room2.themeBook.theme.source === 'tie');
  h2.close(); e2.close();
  const h3 = new Client(port, 'Fay'); await h3.ready;
  h3.send({ t: 'create', name: 'Fay', max: 4 }); await h3.wait('welcome');
  h3.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
  h3.close();
  const h4 = new Client(port, 'Gus'); await h4.ready;
  h4.send({ t: 'create', name: 'Gus', max: 4 }); const w4 = await h4.wait('welcome');
  const j4 = new Client(port, 'Hal'); await j4.ready;
  j4.send({ t: 'join', code: w4.room.code, name: 'Hal' }); await j4.wait('welcome');
  await h4.cmd({ t: 'theme-propose', text: 'Seul thème' });
  await h4.cmd({ t: 'theme-vote-open', seconds: 5 });
  const noVotes = await h4.cmd({ t: 'theme-vote-close' });
  check('S21 personne n\'a voté : pas de gagnant, l\'hôte peut prendre le thème par défaut (indiqué)', noVotes.room.themes.result.reason === 'no-votes' && (await j4.cmd({ t: 'theme-default' })).error.code === 'not-host' && (await h4.cmd({ t: 'theme-default' })).room.theme.source === 'default');
  check('S22 isolation : les propositions d\'un salon n\'apparaissent pas dans un autre', manager.get(w4.room.code).themeBook.themes.length === 1 && room2.themeBook.themes.length === 2 && room.themeBook.themes.length === 2);
  // lancer sans rien choisir -> défaut
  const h5 = new Client(port, 'Ivy'); await h5.ready;
  h5.send({ t: 'create', name: 'Ivy', max: 4 }); const w5 = await h5.wait('welcome');
  const j5 = new Client(port, 'Jon'); await j5.ready;
  j5.send({ t: 'join', code: w5.room.code, name: 'Jon' }); await j5.wait('welcome');
  await h5.wait('room', (m) => m.room.players.length === 2);
  h5.send({ t: 'start' });
  const st5 = await h5.wait('started');
  check('S23 lancement sans thème choisi : thème par défaut appliqué et indiqué', st5.room.theme.source === 'default' && st5.room.theme.text === Themes.DEFAULT_TEXT);
  [h4, j4, h5, j5].forEach((c) => c.close());
  await sleep(100);
  server.close();
  console.log('\n' + passed + '/' + (passed + failures.length) + ' OK');
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ERREUR DE TEST', error);
  process.exit(2);
});
