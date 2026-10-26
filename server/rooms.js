'use strict';
/**
 * GARTIC BANDE — logique des salons privés (sans réseau : testable seule).
 *
 * Le serveur est l'AUTORITÉ de la partie : joueurs, plan des rounds, chrono, contributions. Les clients lui envoient
 * leur contribution ; il la vérifie (bon joueur, bon round, pas de doublon, contenu valide), l'enregistre une seule
 * fois, puis la diffuse à tout le monde. Rien n'est jamais écrasé.
 *
 * ROUNDS SIMULTANÉS (rotation : voir js/rounds.js, partagée avec le navigateur) :
 *   - n joueurs → n chansons et n rounds ; au round 1 chacun crée sa base, ensuite chacun reçoit la chanson d'un autre ;
 *   - tous les joueurs travaillent EN MÊME TEMPS ; le chrono est celui du serveur (les clients reçoivent le temps restant) ;
 *   - un round passe par : « intro » (annonce) → « working » (chrono) → « closing » (quelques secondes pour envoyer
 *     les brouillons quand le chrono tombe à zéro) → round suivant ;
 *   - il se termine dès que tous les joueurs PRÉSENTS ont validé (« Prêt »), ou quand le temps (+ délai de grâce) est écoulé ;
 *   - qui n'a rien envoyé reçoit une contribution VIDE (`empty`, raison `timeout` ou `absent`) : aucune note n'est inventée ;
 *   - un joueur absent ne bloque jamais la partie.
 */

const crypto = require('crypto');
const Rounds = require('../js/rounds.js'); // même rotation que dans le navigateur
const Modes = require('../js/modes.js'); // registre des modes de jeu (partagé avec le navigateur)
const Phases = require('../js/phases.js'); // mêmes phases (proposition, vote, préparation) que dans le navigateur
const Avatar = require('../js/avatar.js'); // validation du personnage (couleur + chapeau) choisi par chaque joueur
const PhoneRoom = require('./phone-room.js'); // mode Phone (téléphone arabe musical)
const PhoneRules = require('../js/phone.js');
const Synth = require('../js/synth.js'); // validation des instruments personnalisés (synthé réglable)

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : pas de confusion à l'oral
const CODE_LENGTH = 5;

const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ou'];
const SOUND_HASH = /^[0-9a-f]{64}$/;

/** Reconnaît WAV, MP3 ou OGG d'après les premiers octets (le type annoncé par le client ne compte pas). */
function sniffAudio(data) {
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WAVE') return 'audio/wav';
  if (data.length >= 4 && data.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
  if (data.length >= 3 && data.toString('latin1', 0, 3) === 'ID3') return 'audio/mpeg';
  if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}
const LIMITS = {
  players: [2, 8],
  bars: [2, 4],
  bpm: [60, 180],
  roundSeconds: Phases.SECONDS_LIMITS.compose,
  proposeSeconds: Phases.SECONDS_LIMITS.propose,
  voteSeconds: Phases.SECONDS_LIMITS.vote,
  prepSeconds: Phases.SECONDS_LIMITS.prep,
  gameModes: Modes.availableIds(), // seuls les modes jouables du registre js/modes.js sont acceptés
  nameLength: 16,
  stepsPerBar: 4,
  maxNotes: 400,
  maxRow: 35, // 3 octaves chromatiques (lignes 0 à 35)
  maxClipChars: 3 * 1024 * 1024, // WAV en base64 (≈ 2,2 Mo décodé : plus de 40 s à 24 kHz)
  maxClipSeconds: 31,
  maxSettingsChars: 6000,
  // Sons importés (fichiers audio des joueurs). Le serveur les garde EN MÉMOIRE, par salon, le temps de la partie.
  sound: {
    maxBytes: 5 * 1024 * 1024, // un fichier
    perPlayer: 8, // fichiers différents envoyés par un joueur
    roomBytes: 40 * 1024 * 1024, // total du salon
    // Mode Phone : les voix des maillons « chanter » passent par la même route (WAV) ; plus de fichiers, gardés jusqu'à la fin de la partie.
    phone: { perPlayer: 24, roomBytes: 96 * 1024 * 1024 },
  },
  phoneRounds: [0, 8], // 0 = autant de rounds que de joueurs
  singSeconds: PhoneRules.SING_LIMITS,
};

/** Avatars et couleurs attribués dans l'ordre d'arrivée (les mêmes pour tous les joueurs). */
const PALETTE = [
  { avatar: '', color: '#FF5C8A' },
  { avatar: '', color: '#D4145A' },
  { avatar: '', color: '#2EC4B6' },
  { avatar: '', color: '#7C5CFF' },
  { avatar: '', color: '#4DA3FF' },
  { avatar: '', color: '#7ED957' },
  { avatar: '', color: '#FFD23F' },
  { avatar: '', color: '#C45CFF' },
];

const ROOM_IDLE_MS = 30 * 60 * 1000;

function clampInt(value, [min, max], fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanName(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.nameLength);
}

function randomToken() {
  return crypto.randomBytes(18).toString('base64url');
}

/* ------------------------------------------------------------------ */
/*  Validation d'une contribution                                      */
/* ------------------------------------------------------------------ */

/**
 * Vérifie et nettoie une contribution reçue d'un client. Renvoie { ok, value } ou { ok: false, error }.
 * Le serveur ne fait jamais confiance au client : formes, bornes et tailles sont revérifiées ici.
 */
function validateContribution(raw, bars, hasSound) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Contribution invalide.' };
  const stepCount = bars * LIMITS.stepsPerBar;

  const instrumentId = typeof raw.instrumentId === 'string' ? raw.instrumentId : '';
  if (!/^[a-z0-9_-]{1,40}$/i.test(instrumentId)) return { ok: false, error: 'Instrument invalide.' };

  const notesIn = Array.isArray(raw.notes) ? raw.notes : [];
  if (notesIn.length > LIMITS.maxNotes) return { ok: false, error: 'Trop de notes.' };
  const notes = [];
  for (const note of notesIn) {
    if (!note || typeof note.step !== 'number' || !Number.isFinite(note.step) || note.step < 0 || note.step >= stepCount) return { ok: false, error: 'Note hors de la boucle.' };
    if (!Number.isInteger(note.row) || note.row < 0 || note.row > LIMITS.maxRow) return { ok: false, error: 'Hauteur de note invalide.' };
    const length = Number(note.length);
    if (!Number.isFinite(length) || length < 0.05 || length > stepCount) return { ok: false, error: 'Durée de note invalide.' };
    const entry = { step: Math.round(note.step * 1000) / 1000, row: note.row, length: Math.round(length * 1000) / 1000 };
    if (note.vowel !== undefined) {
      if (!VOWELS.includes(note.vowel)) return { ok: false, error: 'Voyelle invalide.' };
      entry.vowel = note.vowel; // voix robot : une voyelle par note
    }
    notes.push(entry);
  }

  let clip = null;
  if (raw.clip) {
    const c = raw.clip;
    if (typeof c.wav !== 'string' || c.wav.length > LIMITS.maxClipChars || !/^[A-Za-z0-9+/=]+$/.test(c.wav)) return { ok: false, error: 'Enregistrement vocal invalide ou trop gros.' };
    const duration = Number(c.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > LIMITS.maxClipSeconds) return { ok: false, error: 'Durée d\'enregistrement invalide.' };
    const start = Number(c.start);
    if (!Number.isFinite(start) || start < 0 || start >= stepCount) return { ok: false, error: 'Position de l\'enregistrement invalide.' };
    const gainDb = Number(c.gainDb);
    if (!Number.isFinite(gainDb) || gainDb < -24 || gainDb > 6) return { ok: false, error: 'Volume invalide.' };
    const peaks = Array.isArray(c.peaks) ? c.peaks.slice(0, 200).map((v) => Math.min(1, Math.max(0, Number(v) || 0))) : [];
    clip = {
      id: typeof c.id === 'string' ? c.id.slice(0, 60) : 'clip',
      wav: c.wav,
      sampleRate: clampInt(c.sampleRate, [8000, 48000], 24000),
      duration,
      peaks,
      start,
      gainDb,
    };
  }

  if (notes.length === 0 && !clip) return { ok: false, error: 'Une contribution doit contenir des notes ou un enregistrement.' };

  const mode = raw.mode === undefined || raw.mode === null ? null : raw.mode;
  if (mode !== null && !Phases.MODES.includes(mode)) return { ok: false, error: 'Difficulté invalide.' };

  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : null;
  const instrument = raw.instrument && typeof raw.instrument === 'object' ? raw.instrument : null;
  if (JSON.stringify([settings, instrument]).length > LIMITS.maxSettingsChars) return { ok: false, error: 'Réglages d\'instrument trop volumineux.' };

  // Son importé : la contribution ne porte que son EMPREINTE (jamais l'audio). Le fichier doit déjà être sur le serveur, dans CE salon.
  const hashOf = (source) => (source && source.sample && typeof source.sample.hash === 'string' ? source.sample.hash : null);
  const wanted = [hashOf(settings), hashOf(instrument && instrument.settings)].filter((hash) => hash !== null);
  if (instrumentId.startsWith('sample-') || wanted.length) {
    const hash = hashOf(settings);
    if (!hash || !SOUND_HASH.test(hash) || instrumentId !== 'sample-' + hash.slice(0, 12)) return { ok: false, error: 'Son importé invalide.' };
    if (instrument && (instrument.id !== instrumentId || hashOf(instrument.settings) !== hash)) return { ok: false, error: 'Son importé invalide.' };
    if (!hasSound || !hasSound(hash)) return { ok: false, code: 'missing-sound', error: 'Le son importé n\'est pas arrivé sur le serveur : réessaie dans un instant.' };
  }

  // Instrument personnalisé : l'identifiant doit être celui des réglages ; le serveur renvoie la version NETTOYÉE (jamais celle du client).
  let finalSettings = settings;
  let finalInstrument = instrument;
  if (instrumentId.startsWith('custom-') || (instrument && instrument.engine === 'custom')) {
    const checked = Synth.verify(instrumentId, settings);
    if (!checked.ok) return { ok: false, error: 'Instrument personnalisé invalide.' };
    finalSettings = checked.settings;
    finalInstrument = { id: instrumentId, label: checked.settings.label, icon: checked.settings.icon, kind: 'melodic', engine: 'custom', settings: checked.settings };
  }

  return { ok: true, value: { instrumentId, instrument: finalInstrument, settings: finalSettings, clip, notes, mode } };
}

/* ------------------------------------------------------------------ */
/*  Salon                                                              */
/* ------------------------------------------------------------------ */

class Room {
  constructor(code, now) {
    this.code = code;
    this.now = now; // horloge (injectable pour les tests)
    this.status = 'lobby'; // 'lobby' | 'playing' | 'finished'
    this.settings = {
      max: 4,
      bars: 4,
      bpm: 110, // tempo proposé par défaut à la préparation (chacun choisit ensuite le tempo de SA chanson)
      roundSeconds: Rounds.DEFAULT_SECONDS,
      proposeSeconds: Phases.DEFAULT_SECONDS.propose,
      voteSeconds: Phases.DEFAULT_SECONDS.vote,
      prepSeconds: Phases.DEFAULT_SECONDS.prep,
      gameMode: Modes.DEFAULT,
      phoneRounds: 0, // mode Phone : nombre de rounds (0 = autant que de joueurs, 3 au minimum)
      singSeconds: PhoneRules.DEFAULT_SECONDS.sing, // mode Phone : durée d'un round « chanter »
    };
    this.phone = null; // état du mode Phone (voir server/phone-room.js)
    this.players = []; // { id, name, token, avatar, color, connected, send }
    this.sounds = new Map(); // empreinte SHA-256 -> { data: Buffer, mime, owner: playerId, bytes } : sons importés de CE salon (jamais partagés entre salons)
    this.soundBytes = 0;
    this.hostId = null;
    this.songs = [];
    this.plan = []; // plan[round] = [{ playerId, songId, kind }]
    this.round = null; // { index, status, introEnd, deadline, graceEnd, lastEnd, tasks: [{ playerId, songId, kind, status }] }
    this.contributions = [];
    this.pre = null; // phases d'avant-composition (proposition, vote, préparation) : état officiel du salon, voir js/phases.js
    this.theme = null; // thème retenu à la fin du vote : { themeId, text, authorName, source }
    this.reveal = null; // révélation finale, pilotée par l'hôte : { stage: 'waiting'|'song'|'ended', songIndex, seq, startedAt }
    this.playerCounter = 0;
    this.contributionCounter = 0;
    this.touched = now();
  }

  player(playerId) {
    return this.players.find((entry) => entry.id === playerId) || null;
  }

  connectedPlayers() {
    return this.players.filter((entry) => entry.connected);
  }

  /** Vue envoyée aux clients : jamais les jetons ni les connexions. Les temps sont des durées restantes (pas d'horloge à synchroniser). */
  view() {
    const time = this.now();
    let round = null;
    if (this.round) {
      const info = this.round;
      let remainingMs = 0;
      if (info.status === 'intro') remainingMs = Math.max(0, info.introEnd - time);
      else if (info.status === 'working') remainingMs = Math.max(0, info.deadline - time);
      round = {
        index: info.index,
        total: this.plan.length,
        status: info.status,
        remainingMs,
        durationMs: this.settings.roundSeconds * 1000,
        lastEnd: info.lastEnd,
        tasks: info.tasks.map((task) => ({ playerId: task.playerId, songId: task.songId, status: task.status })),
      };
    }
    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      settings: Object.assign({}, this.settings),
      players: this.players.map((entry) => ({
        id: entry.id,
        name: entry.name,
        avatar: entry.avatar,
        color: entry.color,
        skin: entry.skin,
        connected: entry.connected,
        host: entry.id === this.hostId,
      })),
      songs: this.songs.map((song) => ({ id: song.id, letter: song.letter, creatorId: song.creatorId, title: song.title, bpm: song.bpm || this.settings.bpm })),
      plan: this.plan,
      round,
      phone: this.phone ? PhoneRoom.view(this) : null,
      pre: this.pre ? Phases.view(this.pre, time) : null,
      theme: this.theme || (this.pre && this.pre.book ? this.pre.book.theme || null : null),
      reveal: this.reveal
        ? { stage: this.reveal.stage, songIndex: this.reveal.songIndex, furthest: this.reveal.furthest, seq: this.reveal.seq, elapsedMs: this.reveal.stage === 'song' ? Math.max(0, time - this.reveal.startedAt) : 0 }
        : null,
    };
  }

  hasContributed(songId, playerId) {
    return this.contributions.some((entry) => entry.songId === songId && entry.playerId === playerId);
  }

  /** Une chanson par joueur, puis la rotation de js/rounds.js. */
  buildPlan() {
    this.songs = this.players.map((entry, index) => ({
      id: 'song-' + (index + 1),
      letter: String.fromCharCode(65 + index),
      creatorId: entry.id,
    }));
    // Titre = pseudo du créateur, figé ici (les pseudos ne changent plus après le lancement).
    const titles = Rounds.songTitles(this.songs, (creatorId) => this.player(creatorId).name);
    this.songs.forEach((song) => {
      song.title = titles[song.id];
    });
    this.plan = Rounds.plan(this.players.length).map((tasks) =>
      tasks.map((task) => ({ playerId: this.players[task.playerIndex].id, songId: this.songs[task.songIndex].id, kind: task.kind }))
    );
  }

  /** Annonce le round `index` : tout le monde a une tâche « working » ; le chrono démarre après l'annonce. */
  beginRound(index, lastEnd) {
    const time = this.now();
    this.round = {
      index,
      status: 'intro',
      introEnd: time + (this.introMs === undefined ? Rounds.INTRO_SECONDS * 1000 : this.introMs),
      deadline: 0,
      graceEnd: 0,
      lastEnd: lastEnd || null,
      tasks: this.plan[index].map((task) => Object.assign({}, task, { status: 'working' })),
    };
  }

  task(playerId) {
    return this.round ? this.round.tasks.find((entry) => entry.playerId === playerId) || null : null;
  }
}

/* ------------------------------------------------------------------ */
/*  Gestionnaire de salons                                             */
/* ------------------------------------------------------------------ */

class RoomManager {
  /** `now` : horloge injectable (les tests la contrôlent). */
  constructor({ now = () => Date.now() } = {}) {
    this.rooms = new Map();
    this.now = now;
    this.introMs = undefined; // les tests peuvent raccourcir l'annonce
    this.drawMs = undefined; // ... et l'affichage du tirage au sort (deux joueurs)
  }

  newCode() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      let code = '';
      for (let index = 0; index < CODE_LENGTH; index += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Impossible de générer un code de salon.');
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().trim()) || null;
  }

  /** Supprime les salons abandonnés (tout le monde parti depuis longtemps). */
  sweep() {
    const limit = this.now() - ROOM_IDLE_MS;
    for (const [code, room] of this.rooms) {
      if (room.connectedPlayers().length === 0 && room.touched < limit) {
        PhoneRoom.purge(room);
        this.rooms.delete(code);
      }
    }
  }

  /**
   * Enregistre un son importé par un joueur du salon (envoi HTTP, jamais par WebSocket).
   * Vérifie : jeton du joueur, empreinte, taille, vrai format audio, quotas par joueur et par salon.
   */
  putSound(code, token, hash, data) {
    const room = this.get(code);
    const player = room && token ? room.players.find((entry) => entry.token === token) : null;
    if (!room || !player) return { ok: false, status: 403, code: 'forbidden', error: 'Accès refusé.' };
    if (!SOUND_HASH.test(String(hash))) return { ok: false, status: 400, code: 'bad-hash', error: 'Empreinte invalide.' };
    if (!Buffer.isBuffer(data) || data.length === 0) return { ok: false, status: 400, code: 'empty', error: 'Fichier vide.' };
    if (data.length > LIMITS.sound.maxBytes) return { ok: false, status: 413, code: 'too-big', error: 'Fichier trop gros (' + Math.round(LIMITS.sound.maxBytes / 1048576) + ' Mo maximum).' };
    const mime = sniffAudio(data);
    if (!mime) return { ok: false, status: 415, code: 'bad-format', error: 'Format non pris en charge (WAV, MP3 ou OGG).' };
    if (crypto.createHash('sha256').update(data).digest('hex') !== hash) return { ok: false, status: 400, code: 'bad-hash', error: 'Le fichier ne correspond pas à son empreinte.' };
    room.touched = this.now();
    if (room.sounds.has(hash)) return { ok: true, status: 200, already: true };
    const owned = Array.from(room.sounds.values()).filter((sound) => sound.owner === player.id).length;
    const quota = room.settings.gameMode === 'phone' ? LIMITS.sound.phone : { perPlayer: LIMITS.sound.perPlayer, roomBytes: LIMITS.sound.roomBytes };
    if (owned >= quota.perPlayer) return { ok: false, status: 429, code: 'limit-player', error: 'Tu as déjà envoyé ' + quota.perPlayer + ' sons dans ce salon : c\'est le maximum.' };
    if (room.soundBytes + data.length > quota.roomBytes) return { ok: false, status: 507, code: 'limit-room', error: 'Le salon a atteint sa limite de sons.' };
    room.sounds.set(hash, { data, mime, owner: player.id, bytes: data.length });
    room.soundBytes += data.length;
    return { ok: true, status: 201, already: false };
  }

  /** Lit un son du salon : seulement pour un joueur de CE salon (jeton), jamais d'un autre salon. */
  getSound(code, token, hash) {
    const room = this.get(code);
    const player = room && token ? room.players.find((entry) => entry.token === token) : null;
    if (!room || !player) return { ok: false, status: 403, code: 'forbidden', error: 'Accès refusé.' };
    const sound = SOUND_HASH.test(String(hash)) ? room.sounds.get(hash) : null;
    if (!sound) return { ok: false, status: 404, code: 'not-found', error: 'Son introuvable dans ce salon.' };
    return { ok: true, status: 200, sound };
  }

  addPlayer(room, name, send, skin) {
    room.playerCounter += 1;
    const index = room.players.length;
    const entry = {
      id: 'p' + room.playerCounter,
      name,
      token: randomToken(),
      avatar: PALETTE[index % PALETTE.length].avatar,
      color: PALETTE[index % PALETTE.length].color,
      skin: skin ? Avatar.sanitize(skin) : { color: Avatar.COLORS[index % Avatar.COLORS.length].id, hat: 'none' }, // le personnage choisi par le joueur (nettoyé)
      connected: true,
      send,
    };
    room.players.push(entry);
    return entry;
  }

  /** Crée un salon : le créateur en est l'hôte. */
  create({ name, max, skin }, send) {
    const clean = cleanName(name);
    if (!clean) return { ok: false, code: 'bad-name', error: 'Choisis un pseudo (1 à ' + LIMITS.nameLength + ' caractères).' };
    const room = new Room(this.newCode(), this.now);
    room.introMs = this.introMs;
    room.settings.max = clampInt(max, LIMITS.players, 4);
    const player = this.addPlayer(room, clean, send, skin);
    room.hostId = player.id;
    this.rooms.set(room.code, room);
    return { ok: true, room, player };
  }

  /** Rejoint un salon (ou s'y reconnecte avec son jeton). */
  join({ code, name, token, skin }, send) {
    const room = this.get(code);
    if (!room) return { ok: false, code: 'no-room', error: 'Aucun salon ne porte ce code. Vérifie-le auprès de l\'hôte.' };
    room.touched = this.now();

    if (token) {
      const known = room.players.find((entry) => entry.token === token);
      if (known) {
        known.connected = true;
        known.send = send;
        if (!room.player(room.hostId) || !room.player(room.hostId).connected) room.hostId = known.id;
        return { ok: true, room, player: known, reconnected: true };
      }
    }
    const clean = cleanName(name);
    if (!clean) return { ok: false, code: 'bad-name', error: 'Choisis un pseudo (1 à ' + LIMITS.nameLength + ' caractères).' };
    if (room.status !== 'lobby') return { ok: false, code: 'started', error: 'Cette partie a déjà commencé : on ne peut plus la rejoindre.' };
    if (room.players.length >= room.settings.max) return { ok: false, code: 'full', error: 'Le salon est complet (' + room.settings.max + ' joueurs).' };
    if (room.players.some((entry) => entry.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, code: 'name-taken', error: 'Ce pseudo est déjà pris dans ce salon : choisis-en un autre.' };
    }
    const player = this.addPlayer(room, clean, send, skin);
    return { ok: true, room, player };
  }

  /** Un joueur quitte volontairement. En salon d'attente il disparaît ; en partie il reste « absent » (reconnexion possible). */
  leave(room, playerId) {
    const player = room.player(playerId);
    if (!player) return;
    room.touched = this.now();
    if (room.status === 'lobby') {
      room.players = room.players.filter((entry) => entry.id !== playerId);
      if (room.players.length === 0) {
        this.rooms.delete(room.code);
        return;
      }
      if (room.hostId === playerId) room.hostId = room.players[0].id;
    } else {
      player.connected = false;
      player.send = null;
      this.ensureHost(room);
    }
  }

  /** Connexion perdue. Même effet qu'un départ, mais en salon d'attente on garde la place quelques instants (géré par le serveur). */
  disconnect(room, playerId) {
    const player = room.player(playerId);
    if (!player) return;
    room.touched = this.now();
    player.connected = false;
    player.send = null;
    this.ensureHost(room);
  }

  ensureHost(room) {
    const host = room.player(room.hostId);
    if (host && host.connected) return;
    const next = room.connectedPlayers()[0];
    if (next) room.hostId = next.id;
  }

  /** Réglages (hôte seulement, avant le début). */
  configure(room, playerId, patch) {
    if (playerId !== room.hostId) return { ok: false, code: 'not-host', error: 'Seul l\'hôte peut changer les réglages.' };
    if (room.status !== 'lobby') return { ok: false, code: 'started', error: 'La partie a déjà commencé.' };
    const next = Object.assign({}, room.settings);
    if (patch.max !== undefined) next.max = clampInt(patch.max, LIMITS.players, room.settings.max);
    if (patch.bars !== undefined) next.bars = clampInt(patch.bars, LIMITS.bars, room.settings.bars);
    if (patch.bpm !== undefined) next.bpm = clampInt(patch.bpm, LIMITS.bpm, room.settings.bpm);
    if (patch.roundSeconds !== undefined) next.roundSeconds = clampInt(patch.roundSeconds, LIMITS.roundSeconds, room.settings.roundSeconds);
    if (patch.proposeSeconds !== undefined) next.proposeSeconds = clampInt(patch.proposeSeconds, LIMITS.proposeSeconds, room.settings.proposeSeconds);
    if (patch.voteSeconds !== undefined) next.voteSeconds = clampInt(patch.voteSeconds, LIMITS.voteSeconds, room.settings.voteSeconds);
    if (patch.prepSeconds !== undefined) next.prepSeconds = clampInt(patch.prepSeconds, LIMITS.prepSeconds, room.settings.prepSeconds);
    if (patch.phoneRounds !== undefined) next.phoneRounds = clampInt(patch.phoneRounds, LIMITS.phoneRounds, room.settings.phoneRounds);
    if (patch.singSeconds !== undefined) next.singSeconds = clampInt(patch.singSeconds, LIMITS.singSeconds, room.settings.singSeconds);
    if (patch.gameMode !== undefined) {
      if (!LIMITS.gameModes.includes(patch.gameMode)) return { ok: false, code: 'bad-mode', error: 'Ce mode de jeu n\'est pas disponible.' };
      if (patch.gameMode !== next.gameMode && patch.roundSeconds === undefined) next.roundSeconds = Modes.get(patch.gameMode).roundSeconds.default; // chaque mode a sa durée conseillée (Phone : 5 min)
      next.gameMode = patch.gameMode;
    }
    if (next.max < room.players.length) return { ok: false, code: 'too-many', error: 'Il y a déjà ' + room.players.length + ' joueurs dans le salon.' };
    room.settings = next;
    room.touched = this.now();
    return { ok: true };
  }

  /** Contexte des phases d'avant-composition : horloge, joueurs présents, tirage au sort (cryptographique, côté serveur seulement). */
  preContext(room) {
    return {
      now: this.now(),
      present: room.connectedPlayers().map((entry) => entry.id),
      rand: () => crypto.randomInt(0, 1000000) / 1000000,
      hasSound: (hash) => room.sounds.has(hash),
      defaultBpm: room.settings.bpm,
    };
  }

  /**
   * Actions des phases d'avant-composition. L'identité vient de la connexion, jamais du message.
   *   propose (arg.text) · vote (arg.id) · prep (arg = { bpm, instrumentId, mode, settings })
   * Après chaque action, on fait avancer les phases : si tout le monde a fini, la page suivante s'ouvre tout de suite.
   */
  preCommand(room, playerId, command, arg) {
    if (room.status !== 'playing' || !room.pre || room.pre.stage === 'done') return { ok: false, code: 'bad-state', error: 'Cette étape est terminée.' };
    const player = room.player(playerId);
    if (!player) return { ok: false, code: 'no-player', error: 'Joueur inconnu.' };
    const ctx = this.preContext(room);
    const input = arg && typeof arg === 'object' ? arg : {};
    let result;
    if (command === 'propose') result = Phases.propose(room.pre, ctx, { id: player.id, name: player.name }, typeof input.text === 'string' ? input.text : '');
    else if (command === 'vote') result = Phases.vote(room.pre, ctx, playerId, String(input.id));
    else if (command === 'prep') result = Phases.prepReady(room.pre, ctx, playerId, input);
    else return { ok: false, code: 'unknown', error: 'Commande inconnue.' };
    if (!result.ok) return result;
    room.touched = ctx.now;
    return { ok: true };
  }

  /** Fait avancer les phases d'avant-composition. À la fin de la préparation : thème et tempos figés, le round 1 commence. Renvoie true si l'état a changé. */
  tickPre(room) {
    if (room.status !== 'playing' || !room.pre || room.pre.stage === 'done') return false;
    const events = Phases.tick(room.pre, this.preContext(room));
    if (events.length === 0) return false;
    if (room.pre.stage === 'done') {
      room.theme = room.pre.book.theme;
      room.songs.forEach((song) => {
        const prep = room.pre.prep[song.creatorId];
        song.bpm = prep ? prep.bpm : room.settings.bpm;
      });
      room.beginRound(0, null);
    }
    room.touched = this.now();
    return true;
  }

  /** L'hôte lance la partie : le nombre de chansons et de rounds est celui des joueurs présents. Commence par la proposition des thèmes. */
  start(room, playerId) {
    if (playerId !== room.hostId) return { ok: false, code: 'not-host', error: 'Seul l\'hôte peut lancer la partie.' };
    if (room.status !== 'lobby') return { ok: false, code: 'started', error: 'La partie a déjà commencé.' };
    room.players = room.players.filter((entry) => entry.connected);
    if (room.players.length < LIMITS.players[0]) return { ok: false, code: 'not-enough', error: 'Il faut au moins ' + LIMITS.players[0] + ' joueurs pour commencer.' };
    if (room.settings.gameMode === 'phone') {
      const phoneRange = Modes.get('phone').players;
      if (room.players.length < phoneRange[0]) return { ok: false, code: 'not-enough', error: 'Le mode Phone demande au moins ' + phoneRange[0] + ' joueurs.' };
      room.status = 'playing';
      PhoneRoom.init(room, room.settings.phoneRounds, this.introMs);
      room.touched = this.now();
      return { ok: true };
    }
    room.status = 'playing';
    room.buildPlan();
    room.pre = Phases.create(
      room.players.map((entry) => entry.id),
      this.now(),
      { propose: room.settings.proposeSeconds, vote: room.settings.voteSeconds, prep: room.settings.prepSeconds },
      { drawMs: this.drawMs }
    );
    room.touched = this.now();
    return { ok: true };
  }

  /**
   * Révélation finale : SEUL l'hôte commande. Le serveur garde l'état (étape, chanson, numéro de séquence) et le diffuse ;
   * chaque client déclenche la lecture quand le numéro de séquence change.
   *   start  → la révélation de la 1re chanson           next   → la chanson suivante
   *   end    → l'écran final de la partie               replay → rejoue une chanson déjà révélée (arg = index)
   */
  revealCommand(room, playerId, command, arg) {
    if (room.status !== 'finished' || !room.reveal) return { ok: false, code: 'bad-state', error: 'La composition n\'est pas terminée.' };
    if (playerId !== room.hostId) return { ok: false, code: 'not-host', error: 'Seul l\'hôte contrôle la révélation.' };
    const reveal = room.reveal;
    const last = room.songs.length - 1;
    const time = this.now();
    if (command === 'start') {
      if (reveal.stage !== 'waiting') return { ok: false, code: 'bad-state', error: 'La révélation a déjà commencé.' };
      Object.assign(reveal, { stage: 'song', songIndex: 0, furthest: 0, startedAt: time, seq: reveal.seq + 1 });
    } else if (command === 'next') {
      if (reveal.stage !== 'song') return { ok: false, code: 'bad-state', error: 'Aucune révélation en cours.' };
      if (reveal.furthest >= last) return { ok: false, code: 'last-song', error: 'C\'était la dernière chanson : termine la partie.' };
      Object.assign(reveal, { songIndex: reveal.furthest + 1, furthest: reveal.furthest + 1, startedAt: time, seq: reveal.seq + 1 });
    } else if (command === 'end') {
      if (reveal.stage !== 'song' || reveal.furthest < last) return { ok: false, code: 'bad-state', error: 'Il reste des chansons à révéler.' };
      Object.assign(reveal, { stage: 'ended', seq: reveal.seq + 1 });
    } else if (command === 'replay') {
      const index = Number(arg);
      if (reveal.stage !== 'song' || !Number.isInteger(index) || index < 0 || index > reveal.furthest) return { ok: false, code: 'bad-state', error: 'Cette chanson n\'a pas encore été révélée.' };
      Object.assign(reveal, { songIndex: index, startedAt: time, seq: reveal.seq + 1 });
    } else {
      return { ok: false, code: 'unknown', error: 'Commande inconnue.' };
    }
    room.touched = time;
    return { ok: true };
  }

  /** Mode Phone : un joueur envoie son maillon (texte, pistes de notes ou pistes de voix déjà envoyées en HTTP). */
  phoneSubmit(room, playerId, message) {
    if (!room.phone) return { ok: false, code: 'bad-mode', error: 'Ce n\'est pas une partie Phone.' };
    const result = PhoneRoom.submit(room, playerId, { round: message.round, link: message.link }, {
      validateTrack: (raw) => validateContribution(raw, room.settings.bars, (hash) => room.sounds.has(hash)),
    });
    if (result.ok) room.touched = this.now();
    return result;
  }

  phoneReveal(room, playerId, command) {
    if (!room.phone) return { ok: false, code: 'bad-mode', error: 'Ce n\'est pas une partie Phone.' };
    return PhoneRoom.revealCommand(room, playerId, command);
  }

  /** Enregistre une contribution (vide ou non) : une seule par (chanson, joueur), jamais écrasée. */
  commit(room, task, content, endReason) {
    room.contributionCounter += 1;
    const roundIndex = room.round.index;
    const playerIndex = room.players.findIndex((entry) => entry.id === task.playerId);
    const empty = !content;
    const contribution = Object.assign(
      {
        id: 'contribution-' + room.contributionCounter,
        songId: task.songId,
        playerId: task.playerId,
        order: room.contributions.filter((entry) => entry.songId === task.songId).length,
        kind: task.kind === 'create' ? 'initial' : 'added',
        round: roundIndex,
        turnNumber: roundIndex * room.players.length + playerIndex + 1,
        empty,
        endReason,
        noteCount: empty ? 0 : content.notes.length,
      },
      empty ? { instrumentId: null, instrument: null, settings: null, clip: null, notes: [], mode: null } : content
    );
    room.contributions.push(contribution);
    task.status = endReason === 'ready' ? 'ready' : endReason;
    return contribution;
  }

  /**
   * Un joueur envoie sa contribution du round. `message` : { round, contribution }.
   *   - pendant le chrono : c'est un « Prêt » — le contenu doit être valide et non vide ;
   *   - pendant le délai de grâce (temps écoulé) : c'est le brouillon automatique ; un contenu absent ou invalide donne une contribution vide.
   * Refusé si ce n'est pas le bon round, si le joueur a déjà contribué (rechargement de page, double clic), ou avant le départ du chrono.
   * Renvoie { ok, contribution } ; le round peut ensuite se terminer (voir tick).
   */
  submit(room, playerId, message) {
    if (room.status !== 'playing' || !room.round) return { ok: false, code: 'not-playing', error: 'Aucune partie en cours.' };
    const info = room.round;
    const task = room.task(playerId);
    if (!task) return { ok: false, code: 'not-in-game', error: 'Tu ne fais pas partie de cette partie.' };
    if (message.round !== info.index) return { ok: false, code: 'stale-round', error: 'Cette contribution ne correspond plus au round en cours.' };
    if (task.status !== 'working' || room.hasContributed(task.songId, playerId)) {
      return { ok: false, code: 'duplicate', error: 'Ta contribution est déjà enregistrée pour ce round.' };
    }
    if (info.status === 'intro') return { ok: false, code: 'too-early', error: 'Le round n\'a pas encore commencé.' };

    // Le chrono est la référence : un envoi qui arrive après l'échéance (même avant le prochain « tick ») est un brouillon automatique.
    const late = info.status === 'closing' || (info.status === 'working' && this.now() >= info.deadline);
    let content = null;
    if (message.contribution) {
      const checked = validateContribution(message.contribution, room.settings.bars, (hash) => room.sounds.has(hash));
      if (!checked.ok && checked.code === 'missing-sound' && !late) return { ok: false, code: 'missing-sound', error: checked.error };
      if (checked.ok) content = checked.value;
      else if (!late) return { ok: false, code: 'invalid', error: checked.error };
    } else if (!late) {
      return { ok: false, code: 'invalid', error: 'Une contribution doit contenir des notes ou un enregistrement.' };
    }
    const contribution = this.commit(room, task, content, late ? 'timeout' : 'ready');
    room.touched = this.now();
    return { ok: true, contribution };
  }

  /**
   * Fait avancer le salon avec l'horloge : fin de l'annonce, chrono à zéro, fin du délai de grâce, tous prêts.
   * Appelée régulièrement par le serveur et après chaque changement (contribution, départ d'un joueur).
   * Renvoie { changed, contributions } : ce qui doit être diffusé aux clients.
   */
  tick(room) {
    const out = { changed: false, contributions: [] };
    if (room.phone) {
      if (PhoneRoom.tick(room)) out.changed = true;
      return out;
    }
    if (this.tickPre(room)) out.changed = true;
    if (room.status !== 'playing' || !room.round) return out;
    for (let guard = 0; guard < 16; guard += 1) {
      const info = room.round;
      const time = this.now();
      if (info.status === 'intro' && time >= info.introEnd) {
        info.status = 'working';
        info.deadline = info.introEnd + room.settings.roundSeconds * 1000;
        out.changed = true;
        continue;
      }
      if (info.status === 'working') {
        if (this.allPresentDone(room)) {
          this.finishRound(room, 'all-ready', out);
          continue;
        }
        if (time >= info.deadline) {
          info.status = 'closing';
          info.graceEnd = time + Rounds.GRACE_SECONDS * 1000;
          out.changed = true;
          continue;
        }
      }
      if (info.status === 'closing' && (time >= info.graceEnd || this.allPresentDone(room))) {
        this.finishRound(room, 'timeout', out);
        continue;
      }
      break;
    }
    return out;
  }

  /** Tous les joueurs PRÉSENTS ont-ils fini ? (au moins un joueur doit être présent : sinon on laisse le chrono courir) */
  allPresentDone(room) {
    const present = room.round.tasks.filter((task) => {
      const player = room.player(task.playerId);
      return player && player.connected;
    });
    return present.length > 0 && present.every((task) => task.status !== 'working');
  }

  /** Fin du round : les tâches restantes deviennent des contributions vides, puis round suivant ou fin de partie. */
  finishRound(room, reason, out) {
    room.round.tasks.forEach((task) => {
      if (task.status !== 'working') return;
      const player = room.player(task.playerId);
      out.contributions.push(this.commit(room, task, null, player && player.connected ? 'timeout' : 'absent'));
    });
    const next = room.round.index + 1;
    if (next < room.plan.length) room.beginRound(next, reason);
    else {
      room.status = 'finished';
      room.reveal = { stage: 'waiting', songIndex: -1, furthest: -1, seq: 0, startedAt: 0 };
      room.round.status = 'done';
      room.round.lastEnd = reason;
    }
    room.touched = this.now();
    out.changed = true;
  }
}

module.exports = { RoomManager, Room, PhoneRoom, validateContribution, LIMITS, PALETTE, CODE_ALPHABET, CODE_LENGTH, cleanName };
