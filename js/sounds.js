/**
 * GARTIC BANDE — bibliothèque « Mes sons » : sons importés par le joueur (WAV, MP3, OGG).
 *
 * Stockage : IndexedDB du navigateur (base « gartic-bande-sounds »), donc sur CET ordinateur seulement.
 *   - magasin « sounds » : une fiche par son (nom, volume, durée, empreinte…), ce que le joueur voit et modifie ;
 *   - magasin « blobs »  : le fichier lui-même, rangé par EMPREINTE (SHA-256 du contenu).
 * L'empreinte est la référence STABLE d'un son : une couche qui utilise un son garde l'empreinte, pas le nom.
 * Renommer, changer le volume ou supprimer un son de la bibliothèque ne change donc jamais une chanson déjà posée.
 *
 * Mémoire : chaque son n'est décodé qu'UNE fois (cache par empreinte) ; toutes les notes d'une piste
 * jouent ce même tampon (aucune copie par note).
 *
 * Multijoueur : le jeu n'envoie jamais l'audio par WebSocket. Une contribution ne contient que l'empreinte ;
 * le fichier voyage à part (voir js/net.js : envoi/téléchargement HTTP par empreinte, par salon).
 */
(function (GB) {
  'use strict';

  const { CONFIG } = GB;
  const DB_NAME = 'gartic-bande-sounds';
  const SETTINGS_KEY = 'gartic-bande.sounds.settings.v1';

  const listeners = new Set();
  let list = []; // fiches, de la plus ancienne à la plus récente
  let db = null;
  let persistent = false; // true quand IndexedDB fonctionne
  let ready = null;
  const memoryBlobs = new Map(); // empreinte -> { data: ArrayBuffer, mime } (repli sans IndexedDB + sons reçus d'autres joueurs)
  const decoded = new Map(); // empreinte -> ToneAudioBuffer
  const loading = new Map(); // empreinte -> Promise
  const used = new Set(); // empreintes utilisées par une couche pendant cette session (leur fichier est conservé)
  let sizeLimit = CONFIG.SOUNDS.MAX_FILE_BYTES;
  let remoteFetcher = null; // (hash) => Promise<ArrayBuffer|null> : téléchargement depuis le serveur (multijoueur)

  /* ------------------------------------------------------------------ */
  /*  Réglages du joueur (taille maximale)                               */
  /* ------------------------------------------------------------------ */

  try {
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isFinite(saved.maxFileBytes)) sizeLimit = Math.min(CONFIG.SOUNDS.HARD_MAX_FILE_BYTES, Math.max(256 * 1024, saved.maxFileBytes));
  } catch (error) {
    /* réglages illisibles : valeur par défaut */
  }

  function notify() {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        /* un écouteur ne doit jamais casser la bibliothèque */
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Empreinte SHA-256                                                  */
  /* ------------------------------------------------------------------ */

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  /** SHA-256 en JavaScript pur : repli quand crypto.subtle n'existe pas (page ouverte en http:// sur le réseau local). */
  function sha256Fallback(bytes) {
    const length = bytes.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor((length * 8) / 0x100000000));
    view.setUint32(padded.length - 4, (length * 8) >>> 0);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i += 1) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
  }

  async function sha256(buffer) {
    try {
      if (window.crypto && window.crypto.subtle) {
        const digest = await window.crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
    } catch (error) {
      /* repli ci-dessous */
    }
    return sha256Fallback(new Uint8Array(buffer));
  }

  /* ------------------------------------------------------------------ */
  /*  Formats                                                            */
  /* ------------------------------------------------------------------ */

  /** Reconnaît le format d'après les premiers octets (l'extension et le type annoncé peuvent mentir). */
  function sniffFormat(buffer) {
    const b = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
    const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
    if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
    if (b.length >= 4 && ascii(0, 4) === 'OggS') return 'ogg';
    if (b.length >= 3 && ascii(0, 3) === 'ID3') return 'mp3';
    if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
    return null;
  }

  const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' };
  const LABEL = { wav: 'WAV', mp3: 'MP3', ogg: 'OGG' };

  /** Formats que CE navigateur sait lire (WAV et MP3 presque partout ; OGG surtout Chrome et Firefox). */
  function supportedFormats() {
    const probe = document.createElement('audio');
    const can = (type) => Boolean(probe.canPlayType) && probe.canPlayType(type) !== '';
    return { wav: true, mp3: can('audio/mpeg'), ogg: can('audio/ogg; codecs="vorbis"') || can('audio/ogg') };
  }

  function megabytes(bytes) {
    return (bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1).replace('.', ',') + ' Mo';
  }

  /* ------------------------------------------------------------------ */
  /*  IndexedDB                                                          */
  /* ------------------------------------------------------------------ */

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB indisponible'));
      const open = window.indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const upgrade = open.result;
        if (!upgrade.objectStoreNames.contains('sounds')) upgrade.createObjectStore('sounds', { keyPath: 'id' });
        if (!upgrade.objectStoreNames.contains('blobs')) upgrade.createObjectStore('blobs', { keyPath: 'hash' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('IndexedDB bloquée'));
    });
  }

  function store(name, mode) {
    return db.transaction(name, mode).objectStore(name);
  }

  async function saveEntry(entry) {
    if (!persistent) return;
    await request(store('sounds', 'readwrite').put(entry));
  }

  async function saveBlob(hash, data, mime) {
    memoryBlobs.set(hash, { data, mime });
    if (!persistent) return;
    await request(store('blobs', 'readwrite').put({ hash, data, mime }));
  }

  async function readBlob(hash) {
    if (memoryBlobs.has(hash)) return memoryBlobs.get(hash);
    if (!persistent) return null;
    const row = await request(store('blobs', 'readonly').get(hash));
    return row ? { data: row.data, mime: row.mime } : null;
  }

  /* ------------------------------------------------------------------ */
  /*  Décodage                                                           */
  /* ------------------------------------------------------------------ */

  function rawContext() {
    return Tone.getContext().rawContext;
  }

  /** Décode un fichier. Résout avec un AudioBuffer, ou rejette (fichier illisible ou corrompu). */
  function decode(data) {
    const copy = data.slice(0); // decodeAudioData « consomme » son argument
    return new Promise((resolve, reject) => {
      const context = rawContext();
      try {
        const result = context.decodeAudioData(copy, resolve, reject);
        if (result && typeof result.then === 'function') result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  function peaksOf(buffer, count) {
    const channel = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / count));
    const peaks = [];
    for (let i = 0; i < count; i += 1) {
      let max = 0;
      for (let j = i * block; j < Math.min(channel.length, (i + 1) * block); j += 1) max = Math.max(max, Math.abs(channel[j]));
      peaks.push(Math.round(Math.min(1, max) * 100) / 100);
    }
    return peaks;
  }

  function cleanName(name, fallback) {
    const clean = String(name === undefined || name === null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CONFIG.SOUNDS.NAME_MAX);
    return clean || (fallback === undefined ? 'Son' : fallback);
  }

  function nameFromFile(file) {
    return cleanName(String(file.name || '').replace(/\.[a-z0-9]{1,5}$/i, ''), 'Mon son');
  }

  function totalBytes() {
    return list.reduce((sum, entry) => sum + entry.bytes, 0);
  }

  /* ------------------------------------------------------------------ */
  /*  API                                                                */
  /* ------------------------------------------------------------------ */

  const sounds = {
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Ouvre la base et charge la liste. Ne rejette jamais : sans IndexedDB, la bibliothèque marche en mémoire seulement. */
    init() {
      if (ready) return ready;
      ready = (async () => {
        try {
          db = await openDb();
          persistent = true;
          list = (await request(store('sounds', 'readonly').getAll())).sort((a, b) => a.createdAt - b.createdAt);
          // Ménage : un fichier que plus aucune fiche ne référence n'a plus de raison d'être gardé.
          const keep = new Set(list.map((entry) => entry.hash));
          const keys = await request(store('blobs', 'readonly').getAllKeys());
          await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => request(store('blobs', 'readwrite').delete(key))));
        } catch (error) {
          persistent = false;
          list = [];
        }
        notify();
        return persistent;
      })();
      return ready;
    },

    isPersistent: () => persistent,
    list: () => list.slice(),
    get: (id) => list.find((entry) => entry.id === id) || null,
    byHash: (hash) => list.find((entry) => entry.hash === hash) || null,
    count: () => list.length,
    totalBytes,
    megabytes,
    supportedFormats,
    limits() {
      return Object.assign({}, CONFIG.SOUNDS, { MAX_FILE_BYTES: sizeLimit });
    },
    fileLimit: () => sizeLimit,

    /** Taille maximale d'un fichier (en octets), dans les bornes du jeu. Mémorisée dans ce navigateur. */
    setFileLimit(bytes) {
      sizeLimit = Math.min(CONFIG.SOUNDS.HARD_MAX_FILE_BYTES, Math.max(256 * 1024, Math.round(Number(bytes) || CONFIG.SOUNDS.MAX_FILE_BYTES)));
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxFileBytes: sizeLimit }));
      } catch (error) {
        /* réglage valable pour cette session seulement */
      }
      notify();
      return sizeLimit;
    },

    /**
     * Importe un fichier. Vérifie dans l'ordre : taille (SANS lire le fichier s'il est trop gros), format réel,
     * décodage, durée, quota. Résout avec { ok: true, sound, duplicate } ou { ok: false, error }.
     */
    async add(file) {
      await sounds.init();
      if (!file || typeof file.size !== 'number') return { ok: false, error: 'Ce n\'est pas un fichier.' };
      const label = file.name ? '« ' + file.name + ' »' : 'Ce fichier';
      if (file.size === 0) return { ok: false, error: label + ' est vide.' };
      if (file.size > sizeLimit) {
        return { ok: false, error: label + ' est trop gros (' + megabytes(file.size) + ') : la limite est de ' + megabytes(sizeLimit) + '. Tu peux la relever dans « Mes sons » (maximum ' + megabytes(CONFIG.SOUNDS.HARD_MAX_FILE_BYTES) + ').' };
      }
      if (list.length >= CONFIG.SOUNDS.MAX_COUNT) {
        return { ok: false, error: 'Ta bibliothèque est pleine (' + CONFIG.SOUNDS.MAX_COUNT + ' sons). Supprime un son avant d\'en ajouter.' };
      }
      if (totalBytes() + file.size > CONFIG.SOUNDS.MAX_TOTAL_BYTES) {
        return { ok: false, error: 'Plus assez de place dans ta bibliothèque (' + megabytes(CONFIG.SOUNDS.MAX_TOTAL_BYTES) + ' au total). Supprime un son.' };
      }
      let data;
      try {
        data = await file.arrayBuffer();
      } catch (error) {
        return { ok: false, error: label + ' n\'a pas pu être lu.' };
      }
      const format = sniffFormat(data);
      if (!format) {
        return { ok: false, error: label + ' n\'est pas un son WAV, MP3 ou OGG (ou il est corrompu). Les autres formats ne sont pas pris en charge.' };
      }
      if (!supportedFormats()[format]) {
        return { ok: false, error: 'Ton navigateur ne sait pas lire le format ' + LABEL[format] + '. Convertis le fichier en WAV ou MP3, ou essaie avec Chrome ou Firefox.' };
      }
      let buffer;
      try {
        buffer = await decode(data);
      } catch (error) {
        return { ok: false, error: label + ' est illisible ou corrompu : impossible de le décoder.' };
      }
      if (!buffer || !(buffer.duration > 0.01)) return { ok: false, error: label + ' ne contient aucun son.' };
      if (buffer.duration > CONFIG.SOUNDS.MAX_SECONDS) {
        return { ok: false, error: label + ' dure ' + Math.round(buffer.duration) + ' s : la limite est de ' + CONFIG.SOUNDS.MAX_SECONDS + ' s. Coupe-le avant de l\'importer.' };
      }
      const hash = await sha256(data);
      const existing = sounds.byHash(hash);
      if (existing) return { ok: true, sound: existing, duplicate: true };
      const entry = {
        id: 'snd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: cleanName(nameFromFile(file)),
        hash,
        format,
        bytes: data.byteLength,
        duration: Math.round(buffer.duration * 1000) / 1000,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        volumeDb: 0,
        peaks: peaksOf(buffer, 48),
        instrument: false, // ajouté à la liste des instruments ?
        createdAt: Date.now(),
      };
      try {
        await saveBlob(hash, data, MIME[format]);
        await saveEntry(entry);
      } catch (error) {
        memoryBlobs.delete(hash);
        return { ok: false, error: 'Impossible de sauvegarder dans ce navigateur (espace plein ou stockage bloqué). Le son n\'a pas été ajouté.' };
      }
      decoded.set(hash, new Tone.ToneAudioBuffer(buffer));
      list.push(entry);
      notify();
      return { ok: true, sound: entry, duplicate: false };
    },

    async update(id, patch) {
      const entry = sounds.get(id);
      if (!entry) return { ok: false, error: 'Ce son n\'existe plus.' };
      if (patch.name !== undefined) {
        const name = cleanName(patch.name, '');
        if (!name) return { ok: false, error: 'Donne un nom au son.' };
        entry.name = name;
      }
      if (patch.volumeDb !== undefined) entry.volumeDb = Math.min(6, Math.max(-24, Math.round(Number(patch.volumeDb) || 0)));
      if (patch.instrument !== undefined) entry.instrument = Boolean(patch.instrument);
      try {
        await saveEntry(entry);
      } catch (error) {
        return { ok: false, error: 'Sauvegarde impossible dans ce navigateur.' };
      }
      notify();
      return { ok: true, sound: entry };
    },

    rename(id, name) {
      return sounds.update(id, { name });
    },

    /**
     * Retire un son de la bibliothèque. Si une couche de cette session l'utilise, son fichier est gardé
     * en mémoire : la chanson ne change pas. (Sinon le fichier est effacé.)
     */
    async remove(id) {
      const entry = sounds.get(id);
      if (!entry) return { ok: false, error: 'Ce son n\'existe plus.' };
      list = list.filter((item) => item.id !== id);
      if (persistent) {
        try {
          await request(store('sounds', 'readwrite').delete(id));
          if (!used.has(entry.hash) && !list.some((item) => item.hash === entry.hash)) await request(store('blobs', 'readwrite').delete(entry.hash));
        } catch (error) {
          /* la fiche est déjà retirée de la liste ; le ménage se fera au prochain démarrage */
        }
      }
      if (!used.has(entry.hash)) {
        memoryBlobs.delete(entry.hash);
        decoded.delete(entry.hash);
      } else {
        // Une couche l'utilise : on garde le fichier (en mémoire pour cette session) pour qu'elle continue de sonner.
        readBlob(entry.hash).then((blob) => blob && memoryBlobs.set(entry.hash, blob), () => {});
      }
      notify();
      return { ok: true, entry };
    },

    /** Une couche utilise ce son : on retient son fichier pour la session. */
    markUsed(hash) {
      used.add(hash);
    },

    /* ----- Tampons audio (pour le moteur) ----- */

    /** Tampon déjà décodé, ou null. Appelé à chaque note : très rapide. */
    peekBuffer(hash) {
      return decoded.get(hash) || null;
    },

    /**
     * Décode (une seule fois) le son d'empreinte `hash`. Cherche dans cet ordre : cache, bibliothèque / IndexedDB,
     * puis le serveur du salon (multijoueur). Résout avec le tampon, ou null si introuvable.
     */
    ensure(hash) {
      if (decoded.has(hash)) return Promise.resolve(decoded.get(hash));
      if (loading.has(hash)) return loading.get(hash);
      const job = (async () => {
        let blob = await readBlob(hash).catch(() => null);
        if (!blob && remoteFetcher) {
          const data = await remoteFetcher(hash).catch(() => null);
          if (data && (await sha256(data)) === hash) {
            blob = { data, mime: MIME[sniffFormat(data)] || 'audio/wav' };
            memoryBlobs.set(hash, blob); // sons des autres joueurs : mémoire seulement, jamais dans ta bibliothèque
          }
        }
        if (!blob) return null;
        const buffer = await decode(blob.data);
        const tone = new Tone.ToneAudioBuffer(buffer);
        decoded.set(hash, tone);
        return tone;
      })()
        .catch(() => null)
        .then((result) => {
          loading.delete(hash);
          if (result) notify();
          return result;
        });
      loading.set(hash, job);
      return job;
    },

    /** Résout quand tous ces sons sont prêts (ou introuvables). Sert avant une lecture qui ne doit rien perdre. */
    whenReady(hashes) {
      return Promise.all(Array.from(new Set(hashes)).map((hash) => sounds.ensure(hash))).then((all) => all.every(Boolean));
    },

    /** Le fichier brut d'un son (pour l'envoyer au serveur du salon), ou null. */
    async getFile(hash) {
      const blob = await readBlob(hash).catch(() => null);
      return blob ? blob.data : null;
    },

    /** Branche le téléchargement des sons des autres joueurs (fourni par js/net.js). */
    setRemoteFetcher(fn) {
      remoteFetcher = typeof fn === 'function' ? fn : null;
    },

    sha256,
    sniffFormat,
    sha256Fallback: (bytes) => sha256Fallback(bytes),
    quota() {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate().catch(() => null);
      return Promise.resolve(null);
    },
  };

  GB.sounds = sounds;
})((window.GB = window.GB || {}));
