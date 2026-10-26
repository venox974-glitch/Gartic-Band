'use strict';
/**
 * GARTIC BANDE — serveur : fichiers du jeu + salons privés (WebSocket sur /ws).
 *
 *   cd server && npm install && npm start      →  http://localhost:8080
 *
 * Variables d'environnement (toutes facultatives) :
 *   PORT              port d'écoute (8080 par défaut)
 *   HOST              adresse d'écoute (0.0.0.0 par défaut)
 *   ALLOWED_ORIGINS   origines autorisées pour le WebSocket, séparées par des virgules
 *                     (ex. https://mon-jeu.example.com). Vide = tout le monde (développement).
 *
 * Aucune clé secrète n'existe côté navigateur : les « jetons » de reconnexion sont tirés au hasard par ce serveur
 * et ne servent qu'à reprendre sa place dans un salon.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RoomManager, LIMITS, PhoneRoom } = require('./rooms');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((entry) => entry.trim()).filter(Boolean);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ENTRIES = new Set(['index.html', 'css', 'js', 'vendor', 'hats']);
const LOBBY_GRACE_MS = 10 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ------------------------------------------------------------------ */
/*  Fichiers statiques                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Sons importés : PUT/GET /rooms/CODE/sounds/EMPREINTE (jeton du joueur dans « Authorization: Bearer … ») */
/* ------------------------------------------------------------------ */

const SOUND_ROUTE = /^\/rooms\/([A-Z0-9]{3,12})\/sounds\/([0-9a-f]{64})$/i;
const uploadLog = new Map(); // ip -> horodatages des envois récents (freine les abus)

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowed = ALLOWED_ORIGINS.length === 0 || (origin && (ALLOWED_ORIGINS.includes(origin) || origin === 'http://' + request.headers.host || origin === 'https://' + request.headers.host));
  if (!origin || !allowed) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(response, status, body, extra) {
  response.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}));
  response.end(JSON.stringify(body));
}

function bearerToken(request) {
  const header = String(request.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function handleSound(request, response, match) {
  const cors = corsHeaders(request);
  const code = match[1].toUpperCase();
  const hash = match[2].toLowerCase();
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors);
    response.end();
    return;
  }
  const token = bearerToken(request);
  if (request.method === 'GET') {
    const result = manager.getSound(code, token, hash);
    if (!result.ok) return json(response, result.status, { error: result.error, code: result.code }, cors);
    response.writeHead(200, Object.assign({
      'Content-Type': result.sound.mime,
      'Content-Length': result.sound.data.length,
      'Cache-Control': 'private, no-store', // jamais mis en cache partagé : l'accès dépend du jeton
      'X-Content-Type-Options': 'nosniff',
    }, cors));
    response.end(result.sound.data);
    return;
  }
  if (request.method !== 'PUT') return json(response, 405, { error: 'Méthode non autorisée.' }, Object.assign({ Allow: 'GET, PUT, OPTIONS' }, cors));

  // Jeton vérifié AVANT de lire le corps : un inconnu ne fait rien télécharger au serveur.
  const room = manager.get(code);
  if (!room || !token || !room.players.some((player) => player.token === token)) return json(response, 403, { error: 'Accès refusé.', code: 'forbidden' }, cors);
  const ip = request.socket.remoteAddress || '?';
  const now = Date.now();
  const recent = (uploadLog.get(ip) || []).filter((time) => now - time < 60 * 1000);
  if (recent.length >= 40) return json(response, 429, { error: 'Trop d\'envois : attends un instant.', code: 'rate' }, cors);
  recent.push(now);
  uploadLog.set(ip, recent);
  const declared = Number(request.headers['content-length']);
  const max = LIMITS.sound.maxBytes;
  if (Number.isFinite(declared) && declared > max) return json(response, 413, { error: 'Fichier trop gros.', code: 'too-big' }, Object.assign({ Connection: 'close' }, cors));
  const chunks = [];
  let size = 0;
  let aborted = false;
  request.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > max) {
      aborted = true;
      json(response, 413, { error: 'Fichier trop gros.', code: 'too-big' }, Object.assign({ Connection: 'close' }, cors));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (aborted) return;
    const result = manager.putSound(code, token, hash, Buffer.concat(chunks));
    if (!result.ok) return json(response, result.status, { error: result.error, code: result.code }, cors);
    json(response, result.status, { ok: true, already: result.already }, cors);
  });
  request.on('error', () => {
    aborted = true;
  });
}

function serveStatic(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const soundMatch = SOUND_ROUTE.exec(url.pathname);
  if (soundMatch) return handleSound(request, response, soundMatch);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('ok');
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const target = path.normalize(path.join(ROOT, pathname));
  const relative = path.relative(ROOT, target);
  const top = relative.split(path.sep)[0];
  if (relative.startsWith('..') || path.isAbsolute(relative) || !PUBLIC_ENTRIES.has(top)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Introuvable');
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Introuvable');
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'microphone=(self)',
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  });
}

/* ------------------------------------------------------------------ */
/*  Salons                                                             */
/* ------------------------------------------------------------------ */

const manager = new RoomManager();
const server = http.createServer(serveStatic);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 5 * 1024 * 1024,
  verifyClient: ({ origin, req }) => {
    if (ALLOWED_ORIGINS.length === 0) return true;
    if (origin && ALLOWED_ORIGINS.includes(origin)) return true;
    const host = req.headers.host;
    return Boolean(origin) && (origin === 'http://' + host || origin === 'https://' + host);
  },
});

const joinAttempts = new Map(); // ip -> horodatages récents (freine l'essai de codes au hasard)
function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (joinAttempts.get(ip) || []).filter((time) => now - time < 60 * 1000);
  recent.push(now);
  joinAttempts.set(ip, recent);
  return recent.length > 30;
}

function sendTo(ws, message) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
}

function broadcast(room, message, exceptId) {
  const text = JSON.stringify(message);
  room.players.forEach((player) => {
    if (player.connected && player.send && player.id !== exceptId) player.send(text);
  });
}

function sendRoom(room) {
  broadcast(room, { t: 'room', room: room.view() });
  phoneSync(room);
}

/**
 * Mode Phone : chaque joueur reçoit EN PRIVÉ ce qu'il doit voir (le maillon précédent de sa chaîne), une fois par round ;
 * à la révélation, toutes les chaînes sont envoyées à tout le monde (une fois par démarrage).
 */
function phoneSync(room, onlyPlayer) {
  const phone = room.phone;
  if (!phone) return;
  if (phone.round && phone.round.status !== 'done') {
    const tag = phone.round.index;
    room.players.forEach((player) => {
      if (!player.connected || !player.send || (onlyPlayer && player.id !== onlyPlayer.id)) return;
      if (!onlyPlayer && player.phoneSent === tag) return;
      player.phoneSent = tag;
      const input = PhoneRoom.inputFor(room, player.id);
      if (input) player.send(JSON.stringify({ t: 'phone-input', input }));
    });
  }
  if (phone.reveal.stage !== 'waiting') {
    const chains = PhoneRoom.chainsPayload(room);
    room.players.forEach((player) => {
      if (!player.connected || !player.send || (onlyPlayer && player.id !== onlyPlayer.id)) return;
      if (!onlyPlayer && player.phoneChains === phone.purged + ':' + phone.reveal.stage) return;
      player.phoneChains = phone.purged + ':' + phone.reveal.stage;
      player.send(JSON.stringify({ t: 'phone-chains', chains }));
    });
  }
}

/** Fait avancer le salon avec l'horloge puis diffuse ce qui a changé (contributions vides comprises, puis l'état du salon). */
function advance(room) {
  const out = manager.tick(room);
  out.contributions.forEach((contribution) => broadcast(room, { t: 'contribution', contribution }));
  sendRoom(room);
  return out;
}

function fail(ws, result) {
  sendTo(ws, { t: 'error', code: result.code, message: result.error });
}

const lobbyTimers = new Map(); // playerId@code -> timer

wss.on('connection', (ws, request) => {
  const ip = request.socket.remoteAddress || '?';
  const context = { room: null, player: null, burst: [] };
  const sender = (text) => ws.readyState === 1 && ws.send(text);

  function attach(result) {
    context.room = result.room;
    context.player = result.player;
    const key = result.player.id + '@' + result.room.code;
    clearTimeout(lobbyTimers.get(key));
    lobbyTimers.delete(key);
    sendTo(ws, { t: 'welcome', you: { id: result.player.id, token: result.player.token, name: result.player.name }, room: result.room.view(), reconnected: Boolean(result.reconnected) });
    if (result.room.status !== 'lobby') sendTo(ws, { t: 'sync', room: result.room.view(), contributions: result.room.contributions });
    result.player.phoneSent = undefined; // un joueur qui revient reçoit de nouveau son maillon
    result.player.phoneChains = undefined;
    sendRoom(result.room);
  }

  ws.on('message', (data) => {
    // Anti-inondation : 80 messages par 10 secondes.
    const now = Date.now();
    context.burst = context.burst.filter((time) => now - time < 10000);
    context.burst.push(now);
    if (context.burst.length > 80) {
      sendTo(ws, { t: 'error', code: 'rate', message: 'Trop de messages d\'un coup : ralentis un peu.' });
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      sendTo(ws, { t: 'error', code: 'bad-json', message: 'Message illisible.' });
      return;
    }
    if (!message || typeof message.t !== 'string') return;
    const { room, player } = context;

    switch (message.t) {
      case 'ping':
        sendTo(ws, { t: 'pong' });
        break;

      case 'create': {
        if (context.room) return fail(ws, { code: 'already', error: 'Tu es déjà dans un salon.' });
        if (tooManyAttempts(ip)) return fail(ws, { code: 'rate', error: 'Trop d\'essais : attends une minute.' });
        const result = manager.create({ name: message.name, max: message.max, skin: message.skin }, sender);
        if (!result.ok) return fail(ws, result);
        attach(result);
        break;
      }

      case 'join': {
        if (context.room) return fail(ws, { code: 'already', error: 'Tu es déjà dans un salon.' });
        if (tooManyAttempts(ip)) return fail(ws, { code: 'rate', error: 'Trop d\'essais : attends une minute.' });
        const result = manager.join({ code: message.code, name: message.name, token: message.token, skin: message.skin }, sender);
        if (!result.ok) return fail(ws, result);
        attach(result);
        break;
      }

      case 'configure': {
        if (!room) return;
        const result = manager.configure(room, player.id, message);
        if (!result.ok) return fail(ws, result);
        sendRoom(room);
        break;
      }

      case 'start': {
        if (!room) return;
        const result = manager.start(room, player.id);
        if (!result.ok) return fail(ws, result);
        broadcast(room, { t: 'started', room: room.view() });
        phoneSync(room);
        break;
      }

      case 'submit': {
        if (!room) return;
        const result = manager.submit(room, player.id, { round: message.round, contribution: message.contribution });
        if (!result.ok) return fail(ws, result);
        broadcast(room, { t: 'contribution', contribution: result.contribution });
        advance(room); // tous prêts ? alors le round suivant démarre tout de suite
        break;
      }

      case 'phone-submit': {
        if (!room) return;
        const result = manager.phoneSubmit(room, player.id, { round: message.round, link: message.link });
        if (!result.ok) return fail(ws, result);
        advance(room); // tous prêts ? alors le round suivant démarre tout de suite
        break;
      }

      case 'phone-reveal': {
        if (!room) return;
        const result = manager.phoneReveal(room, player.id, String(message.command || ''));
        if (!result.ok) return fail(ws, result);
        sendRoom(room);
        break;
      }

      case 'pre-propose':
      case 'pre-vote':
      case 'pre-prep': {
        if (!room) return;
        const result = manager.preCommand(room, player.id, message.t.slice('pre-'.length), message);
        if (!result.ok) return fail(ws, result);
        advance(room); // tous ont fini ? alors la page suivante s'ouvre tout de suite
        break;
      }

      case 'reveal-start':
      case 'reveal-next':
      case 'reveal-end':
      case 'reveal-replay': {
        if (!room) return;
        const result = manager.revealCommand(room, player.id, message.t.slice('reveal-'.length), message.index);
        if (!result.ok) return fail(ws, result);
        sendRoom(room); // tous les joueurs reçoivent la même décision de l'hôte
        break;
      }

      case 'reveal-sync':
        // Un client qui a perdu le fil (reconnexion, son suspendu) redemande l'état courant de la révélation.
        if (room) sendTo(ws, { t: 'room', room: room.view() });
        break;

      case 'leave': {
        if (!room) return;
        manager.leave(room, player.id);
        context.room = null;
        context.player = null;
        sendTo(ws, { t: 'left' });
        if (manager.rooms.has(room.code)) advance(room);
        break;
      }

      default:
        fail(ws, { code: 'unknown', error: 'Commande inconnue.' });
    }
  });

  ws.on('close', () => {
    const { room, player } = context;
    if (!room || !player) return;
    manager.disconnect(room, player.id);
    if (room.status === 'playing') {
      advance(room); // un joueur absent ne doit pas bloquer le round : si les présents sont tous prêts, on enchaîne
      return;
    }
    if (room.status === 'lobby') {
      // On garde la place quelques secondes (rechargement de page, micro-coupure) avant de la libérer.
      const key = player.id + '@' + room.code;
      lobbyTimers.set(
        key,
        setTimeout(() => {
          lobbyTimers.delete(key);
          const entry = room.player(player.id);
          if (entry && !entry.connected && room.status === 'lobby') {
            manager.leave(room, player.id);
            if (manager.rooms.has(room.code)) sendRoom(room);
          }
        }, LOBBY_GRACE_MS)
      );
    }
    sendRoom(room);
  });

  ws.on('error', () => {});
});

// Horloge des parties : chrono, fin des annonces, délai de grâce. Une fois par seconde suffit (les clients affichent leur propre décompte).
setInterval(() => {
  for (const room of manager.rooms.values()) {
    if (room.status === 'playing') {
      const out = manager.tick(room);
      if (out.changed) {
        out.contributions.forEach((contribution) => broadcast(room, { t: 'contribution', contribution }));
        sendRoom(room);
      }
    }
  }
}, 250).unref();

setInterval(() => {
  manager.sweep();
  const now = Date.now();
  for (const [ip, list] of joinAttempts) {
    if (list.every((time) => now - time > 60 * 1000)) joinAttempts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('Gartic Bande — http://localhost:' + PORT + '  (WebSocket : /ws, ' + LIMITS.players[0] + ' à ' + LIMITS.players[1] + ' joueurs par salon)');
  });
}

module.exports = { server, manager };
