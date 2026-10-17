/**
 * GARTIC BANDE — client réseau (WebSocket) vers le serveur de salons (dossier server/).
 *
 * Ce module ne fait que parler au serveur : connexion, commandes, événements, reconnexion automatique.
 * Il ne connaît ni l'interface ni les règles du jeu (voir online.js, lobby-ui.js, game.js).
 *
 * Important : sans serveur démarré, RIEN de « en ligne » ne fonctionne. Le jeu ouvert depuis un simple
 * fichier ne peut se connecter qu'à une adresse de serveur qu'on lui donne ; servi par server/server.js,
 * il se connecte tout seul au même endroit. Aucune clé secrète n'est stockée dans le navigateur : le
 * seul jeton conservé est celui que le serveur donne pour reprendre sa place dans un salon.
 */
(function (GB) {
  'use strict';

  const SESSION_KEY = 'gartic-bande.online-session.v1';
  const URL_KEY = 'gartic-bande.server-url.v1';
  const CONNECT_TIMEOUT_MS = 7000;
  const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 8000, 8000];

  let socket = null;
  let manualClose = false;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let pingTimer = null;
  const handlers = {};
  const uploaded = new Set(); // « CODE:empreinte » déjà envoyés au serveur

  const net = {
    status: 'offline', // 'offline' | 'connecting' | 'online' | 'reconnecting'
    url: '',
    session: null, // { url, code, token, you: { id, name } }

    isSupported() {
      return typeof window.WebSocket === 'function';
    },

    /** Adresse proposée par défaut : le serveur qui a servi cette page (jamais pour un fichier ouvert directement). */
    defaultUrl() {
      if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return '';
      return (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
    },

    getSavedUrl() {
      try {
        return window.localStorage.getItem(URL_KEY) || '';
      } catch (error) {
        return '';
      }
    },

    saveUrl(url) {
      try {
        window.localStorage.setItem(URL_KEY, url);
      } catch (error) {
        /* stockage indisponible : sans conséquence */
      }
    },

    /** Accepte « mon-serveur.fr », « http://… », « https://… », « ws://… », « wss://… » et ajoute /ws si besoin. */
    normalizeUrl(input) {
      let text = String(input || '').trim();
      if (!text) return '';
      if (/^https?:\/\//i.test(text)) text = text.replace(/^http/i, 'ws');
      else if (!/^wss?:\/\//i.test(text)) text = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + text;
      try {
        const parsed = new URL(text);
        if (parsed.pathname === '/' || parsed.pathname === '') parsed.pathname = '/ws';
        return parsed.toString();
      } catch (error) {
        return '';
      }
    },

    on(type, handler) {
      (handlers[type] = handlers[type] || []).push(handler);
      return () => {
        handlers[type] = handlers[type].filter((entry) => entry !== handler);
      };
    },

    /** Ouvre la connexion. Résout quand elle est établie ; sinon rejette avec un message en français. */
    connect(url) {
      return new Promise((resolve, reject) => {
        if (!net.isSupported()) {
          reject(new Error('Ce navigateur ne gère pas les connexions en temps réel (WebSocket).'));
          return;
        }
        const clean = net.normalizeUrl(url);
        if (!clean) {
          reject(new Error('L\'adresse du serveur n\'est pas valide. Exemple : wss://mon-serveur.example.com/ws'));
          return;
        }
        net.close(true);
        manualClose = false;
        net.url = clean;
        setStatus('connecting');
        let settled = false;
        let ws;
        try {
          ws = new WebSocket(clean);
        } catch (error) {
          setStatus('offline');
          reject(new Error('Adresse de serveur refusée par le navigateur (une page en https exige une adresse wss://).'));
          return;
        }
        socket = ws;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            ws.close();
          } catch (error) {
            /* déjà fermé */
          }
          setStatus('offline');
          reject(new Error('Le serveur ne répond pas (' + clean + '). Vérifie qu\'il est démarré et que l\'adresse est correcte.'));
        }, CONNECT_TIMEOUT_MS);

        ws.addEventListener('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reconnectAttempt = 0;
          setStatus('online');
          startPing();
          resolve();
        });
        ws.addEventListener('error', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          setStatus('offline');
          reject(new Error('Impossible de joindre le serveur (' + clean + '). Vérifie qu\'il est démarré, que l\'adresse est correcte et que ton réseau l\'autorise.'));
        });
        ws.addEventListener('message', (event) => {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (error) {
            return;
          }
          if (message.t === 'welcome') {
            net.session = {
              url: net.url,
              code: message.room.code,
              token: message.you.token,
              you: { id: message.you.id, name: message.you.name },
            };
            saveSession();
          }
          if (message.t === 'left') clearSession();
          emit(message.t, message);
        });
        ws.addEventListener('close', () => {
          if (ws !== socket) return;
          stopPing();
          socket = null;
          if (!settled) return; // l'échec d'ouverture est géré plus haut
          if (manualClose) {
            setStatus('offline');
            return;
          }
          if (net.session) scheduleReconnect();
          else setStatus('offline');
        });
      });
    },

    close(silent) {
      manualClose = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopPing();
      if (socket) {
        try {
          socket.close();
        } catch (error) {
          /* déjà fermé */
        }
        socket = null;
      }
      if (!silent) setStatus('offline');
    },

    send(message) {
      if (!socket || socket.readyState !== 1) return false;
      socket.send(JSON.stringify(message));
      return true;
    },

    /* ------------------------ commandes du protocole ------------------------ */

    create(name, max) {
      return net.send({ t: 'create', name, max });
    },
    join(code, name) {
      return net.send({ t: 'join', code: String(code || '').trim().toUpperCase(), name });
    },
    configure(patch) {
      return net.send(Object.assign({ t: 'configure' }, patch));
    },
    start() {
      return net.send({ t: 'start' });
    },
    /** Adresse HTTP du serveur (ws://hôte/ws → http://hôte) : sert aux fichiers audio, qui ne passent jamais par le WebSocket. */
    httpBase() {
      const source = net.session ? net.session.url : net.url;
      if (!source) return '';
      try {
        const parsed = new URL(source);
        return (parsed.protocol === 'wss:' ? 'https://' : 'http://') + parsed.host;
      } catch (error) {
        return '';
      }
    },

    /**
     * Envoie un son importé au serveur de MON salon (une seule fois par empreinte et par salon).
     * Résout avec { ok: true } ou { ok: false, error } (message lisible).
     */
    async uploadSound(hash) {
      const session = net.session;
      const base = net.httpBase();
      if (!session || !base) return { ok: false, error: 'Pas de connexion au salon.' };
      const key = session.code + ':' + hash;
      if (uploaded.has(key)) return { ok: true };
      const data = await GB.sounds.getFile(hash);
      if (!data) return { ok: false, error: 'Le fichier du son est introuvable dans ce navigateur.' };
      try {
        const response = await fetch(base + '/rooms/' + encodeURIComponent(session.code) + '/sounds/' + hash, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/octet-stream' },
          body: data,
        });
        if (!response.ok) {
          let error = 'Le serveur a refusé le son (' + response.status + ').';
          try {
            error = (await response.json()).error || error;
          } catch (parseError) {
            /* message par défaut */
          }
          return { ok: false, error };
        }
        uploaded.add(key);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: 'Impossible d\'envoyer le son au serveur.' };
      }
    },

    /** Télécharge un son du salon par son empreinte (ArrayBuffer), ou null. Réservé aux joueurs du salon. */
    async fetchSound(hash) {
      const session = net.session;
      const base = net.httpBase();
      if (!session || !base) return null;
      try {
        const response = await fetch(base + '/rooms/' + encodeURIComponent(session.code) + '/sounds/' + hash, { headers: { Authorization: 'Bearer ' + session.token } });
        return response.ok ? await response.arrayBuffer() : null;
      } catch (error) {
        return null;
      }
    },

    /** Envoie ma contribution du round (null = rien à sauvegarder quand le chrono est à zéro). */
    submit(round, contribution) {
      return net.send({ t: 'submit', round, contribution });
    },
    /** Propositions de thèmes et vote : 'propose' {text} · 'remove' {id} · 'vote-open' {seconds} · 'vote' {id} · 'vote-close' · 'pick' {id} · 'default'. Le serveur décide. */
    themeCommand(command, payload) {
      return net.send(Object.assign({}, payload || {}, { t: 'theme-' + command }));
    },
    /** Révélation finale (hôte seulement, le serveur refuse les autres) : 'start' | 'next' | 'end' | 'replay'. */
    revealCommand(command, index) {
      return net.send(index === undefined ? { t: 'reveal-' + command } : { t: 'reveal-' + command, index });
    },
    /** Redemande l'état courant de la révélation (reconnexion, son repris). */
    revealSync() {
      return net.send({ t: 'reveal-sync' });
    },
    leave() {
      const sent = net.send({ t: 'leave' });
      clearSession();
      net.session = null;
      return sent;
    },

    /** Une session sauvegardée (onglet rechargé en cours de salon ou de partie), ou null. */
    getSavedSession() {
      try {
        const text = window.sessionStorage.getItem(SESSION_KEY);
        const data = text ? JSON.parse(text) : null;
        return data && data.url && data.code && data.token ? data : null;
      } catch (error) {
        return null;
      }
    },

    /** Reprend sa place dans un salon grâce au jeton sauvegardé. */
    async resume(saved) {
      await net.connect(saved.url);
      net.session = saved;
      return net.send({ t: 'join', code: saved.code, token: saved.token });
    },

    forget() {
      clearSession();
      net.session = null;
    },
  };

  function setStatus(status) {
    if (net.status === status) return;
    net.status = status;
    emit('status', { t: 'status', status });
  }

  function emit(type, message) {
    (handlers[type] || []).slice().forEach((handler) => handler(message));
  }

  function saveSession() {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(net.session));
    } catch (error) {
      /* sans conséquence : on perdra seulement la reprise après rechargement */
    }
  }

  function clearSession() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {
      /* idem */
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => net.send({ t: 'ping' }), 25000);
  }

  function stopPing() {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  /** Connexion perdue pendant un salon / une partie : on retente, avec le jeton, sans perdre sa place. */
  function scheduleReconnect() {
    if (reconnectAttempt >= RECONNECT_DELAYS.length) {
      setStatus('offline');
      emit('gave-up', { t: 'gave-up' });
      return;
    }
    setStatus('reconnecting');
    const delay = RECONNECT_DELAYS[reconnectAttempt];
    reconnectAttempt += 1;
    emit('reconnecting', { t: 'reconnecting', attempt: reconnectAttempt, delay });
    reconnectTimer = setTimeout(async () => {
      if (manualClose || !net.session) return;
      try {
        await net.connect(net.session.url);
        manualClose = false;
        net.send({ t: 'join', code: net.session.code, token: net.session.token });
      } catch (error) {
        scheduleReconnect();
      }
    }, delay);
  }

  GB.net = net;
})((window.GB = window.GB || {}));
