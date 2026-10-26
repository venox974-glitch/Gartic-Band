'use strict';
/**
 * GARTIC BANDE — mode PHONE côté serveur (sans réseau : testable seul). Règles pures : js/phone.js.
 *
 * Le serveur est l'autorité : il décide du round, du chrono, de ce que chaque joueur a le droit de voir
 * (SEULEMENT le maillon précédent de sa chaîne) et valide chaque maillon avant de l'enregistrer.
 * Les voix ne passent jamais par le WebSocket : elles sont envoyées en HTTP (route des sons du salon, voir server.js),
 * gardées EN MÉMOIRE, puis effacées à la fin de la partie (commande « end » de l'hôte) ou quand le salon disparaît.
 */

const Phone = require('../js/phone.js');
const Rounds = require('../js/rounds.js');

const SOUND_HASH = /^[0-9a-f]{64}$/;
const GRACE_MS = 6000; // plus long que Build Up : la voix doit être envoyée en HTTP avant le brouillon automatique

function cleanText(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Phone.TEXT_MAX);
}

/** Démarre la partie Phone : une chaîne par joueur, puis le round 0. */
function init(room, wantedRounds, introMs) {
  const n = room.players.length;
  const total = Phone.roundCount(n, wantedRounds);
  room.phone = {
    total,
    kinds: Phone.kinds(total),
    chains: room.players.map((player, index) => ({ id: index, starterId: player.id, links: [] })),
    round: null,
    reveal: { stage: 'waiting', chain: -1, shown: 0, seq: 0 },
    purged: false,
    introMs,
  };
  beginRound(room, 0);
}

function beginRound(room, index) {
  const phone = room.phone;
  const n = room.players.length;
  const time = room.now();
  const kind = phone.kinds[index];
  phone.round = {
    index,
    kind,
    status: 'intro',
    introEnd: time + (phone.introMs === undefined ? Rounds.INTRO_SECONDS * 1000 : phone.introMs),
    deadline: 0,
    graceEnd: 0,
    durationMs: Phone.seconds(kind, room.settings) * 1000,
    tasks: room.players.map((player, playerIndex) => ({ playerId: player.id, chain: Phone.chainOf(playerIndex, index, n), status: 'working' })),
  };
}

function taskOf(room, playerId) {
  return room.phone && room.phone.round ? room.phone.round.tasks.find((task) => task.playerId === playerId) || null : null;
}

/** Ce que le joueur a le droit de voir : le maillon précédent de SA chaîne, rien d'autre. */
function inputFor(room, playerId) {
  const phone = room.phone;
  if (!phone || !phone.round) return null;
  const task = taskOf(room, playerId);
  if (!task) return null;
  const index = phone.round.index;
  let previous = null;
  if (index > 0) {
    const link = phone.chains[task.chain].links[index - 1];
    previous = !link || link.empty ? { missing: true, kind: phone.kinds[index - 1] } : publicLink(link, true);
  }
  return { round: index, total: phone.total, kind: phone.round.kind, chain: task.chain, previous, bpm: previous && previous.bpm ? previous.bpm : room.settings.bpm, bars: room.settings.bars, status: task.status };
}

/** `secret` : ce que voit le joueur suivant (le titre secret du premier maillon n'est jamais transmis). */
function publicLink(link, secret) {
  const out = { round: link.round, kind: link.kind, empty: Boolean(link.empty) };
  if (link.text !== undefined) out.text = link.text;
  if (link.bpm) out.bpm = link.bpm;
  if (link.tracks) out.tracks = link.tracks;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Validation d'un maillon                                            */
/* ------------------------------------------------------------------ */

/**
 * `limits` : { validateTrack(raw) → {ok,value}|{ok:false,error}, hasSound(hash), owns(hash) }
 * Renvoie { ok, value } où value = { text } | { bpm, tracks }.
 */
function validateLink(kind, raw, ctx) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Contribution invalide.' };
  const content = Phone.contentOf(kind);
  const secretTitle = null;
  if (content === 'text') {
    const text = cleanText(raw.text);
    if (!text) return { ok: false, error: 'Écris au moins un mot.' };
    return { ok: true, value: { text } };
  }
  const tracksIn = Array.isArray(raw.tracks) ? raw.tracks : [];
  if (tracksIn.length === 0) return { ok: false, error: content === 'voice' ? 'Enregistre ta voix avant de valider.' : 'Pose au moins une note avant de valider.' };
  if (tracksIn.length > Phone.TRACKS_MAX[content]) return { ok: false, error: 'Trop de pistes (' + Phone.TRACKS_MAX[content] + ' au maximum).' };
  const bpm = Math.round(Number(raw.bpm));
  if (!Number.isFinite(bpm) || bpm < Phone.BPM_LIMITS[0] || bpm > Phone.BPM_LIMITS[1]) return { ok: false, error: 'Tempo invalide.' };
  if (ctx.expectedBpm && bpm !== ctx.expectedBpm) return { ok: false, error: 'Le tempo doit rester celui de la chanson reçue.' };
  const tracks = [];
  for (const track of tracksIn) {
    if (content === 'notes') {
      if (!track || track.clip || track.instrumentId === 'mic') return { ok: false, error: 'Ici, seulement des notes : pas de chant ni de voix.' };
      const checked = ctx.validateTrack(track);
      if (!checked.ok) return checked;
      tracks.push({ instrumentId: checked.value.instrumentId, instrument: checked.value.instrument, settings: checked.value.settings, notes: checked.value.notes });
    } else {
      if (!track || typeof track.hash !== 'string' || !SOUND_HASH.test(track.hash)) return { ok: false, error: 'Enregistrement invalide.' };
      if (!ctx.hasSound(track.hash)) return { ok: false, code: 'missing-sound', error: 'Ta voix n\'est pas arrivée sur le serveur : réessaie dans un instant.' };
      if (!ctx.owns(track.hash)) return { ok: false, error: 'Enregistrement invalide.' };
      const duration = Number(track.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 31) return { ok: false, error: 'Durée d\'enregistrement invalide.' };
      const start = Number(track.start);
      if (!Number.isFinite(start) || start < 0 || start >= ctx.stepCount) return { ok: false, error: 'Position de l\'enregistrement invalide.' };
      const gainDb = Number(track.gainDb);
      if (!Number.isFinite(gainDb) || gainDb < -24 || gainDb > 6) return { ok: false, error: 'Volume invalide.' };
      const peaks = Array.isArray(track.peaks) ? track.peaks.slice(0, 200).map((v) => Math.min(1, Math.max(0, Number(v) || 0))) : [];
      const sampleRate = Math.min(48000, Math.max(8000, Math.round(Number(track.sampleRate)) || 24000));
      tracks.push({ hash: track.hash, duration, start, gainDb, peaks, sampleRate });
    }
  }
  return { ok: true, value: secretTitle === null ? { bpm, tracks } : { text: secretTitle, bpm, tracks } };
}

/* ------------------------------------------------------------------ */
/*  Actions                                                            */
/* ------------------------------------------------------------------ */

function commit(room, task, value, endReason) {
  const phone = room.phone;
  const chain = phone.chains[task.chain];
  const round = phone.round.index;
  const kind = phone.round.kind;
  const link = Object.assign({ round, chain: task.chain, kind, playerId: task.playerId, empty: !value, endReason }, value || {});
  chain.links[round] = link;
  task.status = endReason === 'ready' ? 'ready' : endReason;
  return link;
}

/**
 * Un joueur envoie son maillon. `message` : { round, link }.
 * Pendant le chrono = « Prêt » (contenu valide obligatoire) ; après l'échéance = brouillon automatique (invalide → maillon vide).
 */
function submit(room, playerId, message, helpers) {
  const phone = room.phone;
  if (room.status !== 'playing' || !phone || !phone.round) return { ok: false, code: 'not-playing', error: 'Aucune partie en cours.' };
  const info = phone.round;
  const task = taskOf(room, playerId);
  if (!task) return { ok: false, code: 'not-in-game', error: 'Tu ne fais pas partie de cette partie.' };
  if (message.round !== info.index) return { ok: false, code: 'stale-round', error: 'Cette contribution ne correspond plus au round en cours.' };
  if (task.status !== 'working') return { ok: false, code: 'duplicate', error: 'Ta contribution est déjà enregistrée pour ce round.' };
  if (info.status === 'intro') return { ok: false, code: 'too-early', error: 'Le round n\'a pas encore commencé.' };
  const late = info.status === 'closing' || (info.status === 'working' && room.now() >= info.deadline);

  let expectedBpm = 0;
  if (info.kind === 'sing' || info.kind === 'transcribe') {
    const previous = phone.chains[task.chain].links[info.index - 1];
    expectedBpm = previous && !previous.empty ? previous.bpm : 0; // le tempo de la chanson ne change plus après le 1er maillon
  }
  const checked = validateLink(info.kind, message.link, {
    validateTrack: (raw) => helpers.validateTrack(raw),
    hasSound: (hash) => room.sounds.has(hash),
    owns: (hash) => {
      const sound = room.sounds.get(hash);
      return Boolean(sound) && sound.owner === playerId;
    },
    expectedBpm,
    stepCount: room.settings.bars * 4,
  });
  if (!checked.ok && !late) return { ok: false, code: checked.code || 'invalid', error: checked.error };
  const link = commit(room, task, checked.ok ? checked.value : null, late ? 'timeout' : 'ready');
  return { ok: true, link };
}

function allPresentDone(room) {
  const present = room.phone.round.tasks.filter((task) => {
    const player = room.player(task.playerId);
    return player && player.connected;
  });
  return present.length > 0 && present.every((task) => task.status !== 'working');
}

function finishRound(room, reason) {
  const phone = room.phone;
  phone.round.tasks.forEach((task) => {
    if (task.status !== 'working') return;
    const player = room.player(task.playerId);
    commit(room, task, null, player && player.connected ? 'timeout' : 'absent');
  });
  const next = phone.round.index + 1;
  if (next < phone.total) beginRound(room, next);
  else {
    room.status = 'finished';
    phone.round.status = 'done';
    phone.round.lastEnd = reason;
  }
}

/** Fait avancer avec l'horloge. Renvoie true si l'état public a changé. */
function tick(room) {
  const phone = room.phone;
  if (room.status !== 'playing' || !phone || !phone.round) return false;
  let changed = false;
  for (let guard = 0; guard < 16; guard += 1) {
    const info = phone.round;
    const time = room.now();
    if (info.status === 'intro' && time >= info.introEnd) {
      info.status = 'working';
      info.deadline = info.introEnd + info.durationMs;
      changed = true;
      continue;
    }
    if (info.status === 'working') {
      if (allPresentDone(room)) {
        finishRound(room, 'all-ready');
        changed = true;
        continue;
      }
      if (time >= info.deadline) {
        info.status = 'closing';
        info.graceEnd = time + (room.graceMs === undefined ? GRACE_MS : room.graceMs);
        changed = true;
        continue;
      }
    }
    if (info.status === 'closing' && (time >= info.graceEnd || allPresentDone(room))) {
      finishRound(room, 'timeout');
      changed = true;
      continue;
    }
    break;
  }
  return changed;
}

/** Vue publique (identique pour tous) : aucun contenu de maillon, seulement l'avancement. */
function view(room) {
  const phone = room.phone;
  if (!phone) return null;
  const time = room.now();
  let round = null;
  if (phone.round) {
    const info = phone.round;
    let remainingMs = 0;
    if (info.status === 'intro') remainingMs = Math.max(0, info.introEnd - time);
    else if (info.status === 'working') remainingMs = Math.max(0, info.deadline - time);
    round = { index: info.index, total: phone.total, kind: info.kind, status: info.status, remainingMs, durationMs: info.durationMs, tasks: info.tasks.map((task) => ({ playerId: task.playerId, status: task.status })) };
  }
  return { total: phone.total, kinds: phone.kinds, round, reveal: Object.assign({}, phone.reveal), purged: phone.purged };
}

/** Toutes les chaînes — uniquement une fois la révélation commencée. */
function chainsPayload(room) {
  const phone = room.phone;
  if (!phone || phone.reveal.stage === 'waiting') return null;
  return phone.chains.map((chain) => ({
    id: chain.id,
    starterId: chain.starterId,
    links: Array.from({ length: phone.total }, (_, round) => {
      const link = chain.links[round];
      if (!link) return { round, kind: phone.kinds[round], empty: true, playerId: null };
      return Object.assign(publicLink(link), { playerId: link.playerId, endReason: link.endReason });
    }),
  }));
}

/** Efface les voix de la partie (mémoire du serveur). */
function purge(room) {
  room.sounds.clear();
  room.soundBytes = 0;
  if (room.phone) room.phone.purged = true;
}

/** Révélation (hôte seulement) : start · next · end · replay. */
function revealCommand(room, playerId, command) {
  const phone = room.phone;
  if (room.status !== 'finished' || !phone) return { ok: false, code: 'bad-state', error: 'La partie n\'est pas terminée.' };
  if (playerId !== room.hostId) return { ok: false, code: 'not-host', error: 'Seul l\'hôte contrôle la révélation.' };
  const reveal = phone.reveal;
  const lastChain = phone.chains.length - 1;
  if (command === 'start') {
    if (reveal.stage !== 'waiting') return { ok: false, code: 'bad-state', error: 'La révélation a déjà commencé.' };
    Object.assign(reveal, { stage: 'chain', chain: 0, shown: 1, seq: reveal.seq + 1 });
  } else if (command === 'next') {
    if (reveal.stage !== 'chain') return { ok: false, code: 'bad-state', error: 'Aucune révélation en cours.' };
    if (reveal.shown < phone.total) reveal.shown += 1;
    else if (reveal.chain < lastChain) Object.assign(reveal, { chain: reveal.chain + 1, shown: 1 });
    else return { ok: false, code: 'last', error: 'C\'était la dernière chaîne : termine la partie.' };
    reveal.seq += 1;
  } else if (command === 'replay') {
    if (reveal.stage !== 'chain') return { ok: false, code: 'bad-state', error: 'Aucune révélation en cours.' };
    reveal.seq += 1;
  } else if (command === 'end') {
    if (reveal.stage !== 'chain' || reveal.chain < lastChain || reveal.shown < phone.total) return { ok: false, code: 'bad-state', error: 'Il reste des chaînes à révéler.' };
    reveal.stage = 'ended';
    reveal.seq += 1;
    purge(room); // fin de partie : les voix sont supprimées du serveur
  } else {
    return { ok: false, code: 'unknown', error: 'Commande inconnue.' };
  }
  room.touched = room.now();
  return { ok: true };
}

module.exports = { init, inputFor, submit, tick, view, chainsPayload, purge, revealCommand, validateLink, taskOf, cleanText, GRACE_MS };
