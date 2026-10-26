/**
 * GARTIC BANDE — voix enregistrée au micro et extraits audio (« clips »).
 *
 * Un clip est un objet sérialisable, rangé dans une piste puis dans la contribution :
 *   { id, wav (WAV 16 bits mono, en base64), sampleRate, duration (s), peaks [0..1] (pour l'affichage),
 *     start (colonne de départ dans la boucle, multiple de 0,25), gainDb }
 * Le son lui-même est donc de vrais échantillons enregistrés, pas un dessin : l'audio.js le rejoue
 * avec Tone.Player, planifié sur la même horloge que les notes.
 *
 * Règles :
 *   - le micro n'est JAMAIS ouvert avant une action explicite (clic sur « Enregistrer ») ;
 *   - le micro est refermé dès la fin de l'enregistrement ;
 *   - toutes les erreurs sont renvoyées avec un message en français prêt à afficher.
 */
(function (GB) {
  'use strict';

  const STORED_RATE = 32000; // fréquence conservée : 32 kHz garde les aigus de la voix (24 kHz les rendait sourds), WAV de 64 Ko/s
  const PEAK_COUNT = 120;
  const MAX_SECONDS = 30;

  let clipCounter = 0;
  const bufferCache = new Map(); // clip.id -> Tone.ToneAudioBuffer

  const session = {
    recording: false,
    starting: false,
    stream: null,
    recorder: null,
    chunks: [],
    startedAt: 0,
    maxTimer: null,
    analyser: null,
    analyserData: null,
    sourceNode: null,
    resolveStop: null,
    cancelled: false,
  };

  /* ------------------------------------------------------------------ */
  /*  Compatibilité et messages d'erreur                                 */
  /* ------------------------------------------------------------------ */

  function support() {
    if (!window.isSecureContext) {
      return {
        ok: false,
        code: 'insecure',
        message:
          'Le navigateur bloque le micro sur cette page (connexion non sécurisée). Lance le jeu avec « python3 -m http.server » et ouvre http://localhost:8000, ou utilise un navigateur récent.',
      };
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return {
        ok: false,
        code: 'no-media',
        message: 'Ce navigateur ne permet pas d\'utiliser le micro. Essaie une version récente de Chrome, Edge, Firefox ou Safari.',
      };
    }
    if (typeof window.MediaRecorder === 'undefined') {
      return {
        ok: false,
        code: 'no-recorder',
        message: 'Ce navigateur ne sait pas enregistrer l\'audio (MediaRecorder absent). Essaie une version récente de Chrome, Edge, Firefox ou Safari.',
      };
    }
    return { ok: true };
  }

  function describeError(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return {
        code: 'denied',
        message:
          'L\'accès au micro est refusé. Clique sur l\'icône de cadenas à gauche de l\'adresse, autorise le micro pour cette page, puis réessaie.',
      };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return { code: 'no-device', message: 'Aucun micro détecté. Branche un micro ou un casque, puis réessaie.' };
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
      return { code: 'busy', message: 'Le micro est utilisé par une autre application ou ne répond pas. Ferme-la, puis réessaie.' };
    }
    return { code: 'unknown', message: 'Impossible d\'utiliser le micro : ' + ((error && error.message) || 'erreur inconnue') + '.' };
  }

  function fail(info) {
    const error = new Error(info.message);
    error.code = info.code;
    error.isVoiceError = true; // reconnaît nos erreurs : celles du navigateur ont aussi un « code » (numérique)
    return error;
  }

  /* ------------------------------------------------------------------ */
  /*  Encodage / décodage WAV                                            */
  /* ------------------------------------------------------------------ */

  function bytesToBase64(bytes) {
    let text = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      text += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return window.btoa(text);
  }

  function base64ToBytes(base64) {
    const text = window.atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
    return bytes;
  }

  /** Échantillons (Float32, mono) -> WAV PCM 16 bits en base64. */
  function encodeWav(samples, sampleRate) {
    const dataBytes = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataBytes, true);
    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    return bytesToBase64(new Uint8Array(buffer));
  }

  /** WAV 16 bits mono (celui produit par encodeWav) -> { samples: Float32Array, sampleRate }. */
  function decodeWav(base64) {
    const bytes = base64ToBytes(base64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sampleRate = view.getUint32(24, true);
    const count = Math.floor((bytes.length - 44) / 2);
    const samples = new Float32Array(count);
    for (let index = 0; index < count; index += 1) samples[index] = view.getInt16(44 + index * 2, true) / 0x8000;
    return { samples, sampleRate };
  }

  /**
   * Micro sans traitement automatique = voix souvent très faible : on remonte le volume jusqu'à ~ -2 dB (gain limité à +18 dB, jamais pour du pur
   * bruit) et on adoucit les 8 premières/dernières millisecondes pour éviter les « clacs ».
   */
  function normalize(samples) {
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
    if (peak >= 0.04 && peak < 0.8) {
      const gain = Math.min(8, 0.8 / peak);
      for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
    }
    const fade = Math.min(Math.floor(STORED_RATE * 0.008), Math.floor(samples.length / 2));
    for (let index = 0; index < fade; index += 1) {
      const factor = index / fade;
      samples[index] *= factor;
      samples[samples.length - 1 - index] *= factor;
    }
  }

  /** Ramène un AudioBuffer (n canaux) à un tableau mono à STORED_RATE (moyenne sur la fenêtre, puis normalisation). */
  function toMonoStored(audioBuffer, trimSeconds) {
    const channels = audioBuffer.numberOfChannels;
    const sourceRate = audioBuffer.sampleRate;
    const first = Math.min(audioBuffer.length, Math.max(0, Math.round((trimSeconds || 0) * sourceRate)));
    const length = audioBuffer.length - first;
    const mono = new Float32Array(length);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) mono[index] += data[first + index] / channels;
    }
    const outLength = Math.max(1, Math.floor((length * STORED_RATE) / sourceRate));
    const out = new Float32Array(outLength);
    const ratio = sourceRate / STORED_RATE;
    // Moyenne pondérée de toute la fenêtre d'entrée de chaque échantillon de sortie : un filtre passe-bas simple qui évite le repliement
    // (l'ancienne interpolation linéaire faisait « grésiller » la voix).
    for (let index = 0; index < outLength; index += 1) {
      const from = index * ratio;
      const to = Math.min(length, from + ratio);
      let sum = 0;
      let weight = 0;
      for (let position = Math.floor(from); position < to; position += 1) {
        const w = Math.min(position + 1, to) - Math.max(position, from);
        if (w <= 0) continue;
        sum += (mono[position] || 0) * w;
        weight += w;
      }
      out[index] = weight > 0 ? sum / weight : 0;
    }
    normalize(out);
    return out;
  }

  function computePeaks(samples) {
    const peaks = new Array(PEAK_COUNT).fill(0);
    const bucket = Math.max(1, Math.floor(samples.length / PEAK_COUNT));
    for (let index = 0; index < PEAK_COUNT; index += 1) {
      let max = 0;
      const from = index * bucket;
      const to = Math.min(samples.length, from + bucket);
      for (let position = from; position < to; position += 1) max = Math.max(max, Math.abs(samples[position]));
      peaks[index] = Number(max.toFixed(3));
    }
    return peaks;
  }

  function makeClip(samples) {
    clipCounter += 1;
    return {
      id: 'clip-' + Date.now().toString(36) + '-' + clipCounter,
      wav: encodeWav(samples, STORED_RATE),
      sampleRate: STORED_RATE,
      duration: samples.length / STORED_RATE,
      peaks: computePeaks(samples),
      start: 0,
      gainDb: 0,
    };
  }

  /** Buffer Tone.js d'un clip (décodé une seule fois, de façon synchrone). */
  function getBuffer(clip) {
    if (!clip) return null;
    let buffer = bufferCache.get(clip.id);
    if (!buffer) {
      const { samples, sampleRate } = decodeWav(clip.wav);
      const audioBuffer = Tone.getContext().rawContext.createBuffer(1, Math.max(1, samples.length), sampleRate);
      audioBuffer.copyToChannel(samples, 0);
      buffer = new Tone.ToneAudioBuffer(audioBuffer);
      bufferCache.set(clip.id, buffer);
    }
    return buffer;
  }

  function decodeBlob(blob) {
    return blob.arrayBuffer().then(
      (data) =>
        new Promise((resolve, reject) => {
          const context = Tone.getContext().rawContext;
          const result = context.decodeAudioData(data, resolve, reject); // forme « callback » pour les anciens Safari
          if (result && typeof result.then === 'function') result.then(resolve, reject);
        })
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Enregistrement                                                     */
  /* ------------------------------------------------------------------ */

  function releaseMic() {
    clearTimeout(session.maxTimer);
    session.maxTimer = null;
    if (session.sourceNode) {
      try {
        session.sourceNode.disconnect();
      } catch (error) {
        /* déjà déconnecté */
      }
    }
    session.sourceNode = null;
    session.analyser = null;
    if (session.stream) session.stream.getTracks().forEach((track) => track.stop());
    session.stream = null;
  }

  function resetSession() {
    releaseMic();
    session.recording = false;
    session.starting = false;
    session.recorder = null;
    session.chunks = [];
    session.resolveStop = null;
  }

  const voice = {
    MAX_SECONDS,

    support,

    isRecording() {
      return session.recording || session.starting;
    },

    /**
     * Demande le micro (le navigateur affiche sa demande d'autorisation) puis démarre l'enregistrement.
     * Résout quand l'enregistrement a vraiment commencé, avec l'instant de départ (performance.now()).
     * `maxSeconds` : arrêt automatique (la durée de la boucle, par exemple).
     */
    async start({ maxSeconds, onAutoStop } = {}) {
      const check = support();
      if (!check.ok) throw fail(check);
      if (voice.isRecording()) throw fail({ code: 'busy-recording', message: 'Un enregistrement est déjà en cours.' });

      session.starting = true;
      session.cancelled = false;
      try {
        await Tone.start(); // réveille aussi le contexte audio : nécessaire pour décoder et rejouer
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (session.cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          throw fail({ code: 'cancelled', message: 'Enregistrement annulé.' });
        }
        session.stream = stream;

        // Mesure du niveau d'entrée (pour la jauge de l'interface).
        try {
          const context = Tone.getContext().rawContext;
          session.sourceNode = context.createMediaStreamSource(stream);
          session.analyser = context.createAnalyser();
          session.analyser.fftSize = 1024;
          session.analyserData = new Float32Array(session.analyser.fftSize);
          session.sourceNode.connect(session.analyser);
        } catch (error) {
          session.analyser = null; // la jauge est facultative
        }

        const recorder = new MediaRecorder(stream);
        session.recorder = recorder;
        session.chunks = [];
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data && event.data.size > 0) session.chunks.push(event.data);
        });
        await new Promise((resolve, reject) => {
          recorder.addEventListener('start', resolve, { once: true });
          recorder.addEventListener('error', (event) => reject((event && event.error) || new Error('Erreur du moteur d\'enregistrement')), { once: true });
          recorder.start(100);
        });
        session.startedAt = performance.now();
        session.recording = true;
        session.starting = false;
        const limit = Math.min(MAX_SECONDS, maxSeconds || MAX_SECONDS);
        session.maxTimer = setTimeout(() => {
          if (typeof onAutoStop === 'function') onAutoStop();
        }, limit * 1000);
        let deviceKey = 'default';
        try {
          deviceKey = stream.getAudioTracks()[0].getSettings().deviceId || 'default';
        } catch (error) {
          /* identifiant indisponible : micro « par défaut » */
        }
        return { startedAt: session.startedAt, limit, deviceKey };
      } catch (error) {
        resetSession();
        if (error && error.isVoiceError) throw error;
        throw fail(describeError(error));
      }
    },

    /** Niveau d'entrée instantané (0 à 1), ou 0 si aucun enregistrement. */
    getLevel() {
      if (!session.recording || !session.analyser) return 0;
      session.analyser.getFloatTimeDomainData(session.analyserData);
      let sum = 0;
      for (let index = 0; index < session.analyserData.length; index += 1) sum += session.analyserData[index] ** 2;
      return Math.min(1, Math.sqrt(sum / session.analyserData.length) * 4);
    },

    /**
     * Arrête l'enregistrement et renvoie le clip. `trimSeconds` : début à ignorer (alignement sur la boucle).
     * `maxLength` : durée maximale conservée, en secondes.
     */
    stop({ trimSeconds, maxLength } = {}) {
      return new Promise((resolve, reject) => {
        const recorder = session.recorder;
        if (!session.recording || !recorder) {
          reject(fail({ code: 'not-recording', message: 'Aucun enregistrement en cours.' }));
          return;
        }
        recorder.addEventListener(
          'stop',
          () => {
            const blob = new Blob(session.chunks, { type: recorder.mimeType || 'audio/webm' });
            resetSession();
            if (blob.size === 0) {
              reject(fail({ code: 'empty', message: 'Rien n\'a été enregistré : réessaie en parlant un peu plus longtemps.' }));
              return;
            }
            decodeBlob(blob)
              .then((audioBuffer) => {
                let samples = toMonoStored(audioBuffer, trimSeconds);
                if (maxLength) samples = samples.subarray(0, Math.max(1, Math.floor(maxLength * STORED_RATE)));
                if (samples.length < STORED_RATE * 0.05) {
                  reject(fail({ code: 'too-short', message: 'L\'enregistrement est trop court : réessaie.' }));
                  return;
                }
                resolve(makeClip(samples));
              })
              .catch(() => reject(fail({ code: 'decode', message: 'Impossible de relire cet enregistrement. Réessaie.' })));
          },
          { once: true }
        );
        session.recording = false;
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch (error) {
          resetSession();
          reject(fail(describeError(error)));
        }
      });
    },

    /** Abandonne l'enregistrement en cours (ou la demande d'autorisation) sans rien garder. */
    cancel() {
      session.cancelled = true;
      const recorder = session.recorder;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (error) {
          /* déjà arrêté */
        }
      }
      resetSession();
    },

    getBuffer,
    makeClip,
    encodeWav,
    decodeWav,

    /** Dessine la forme d'onde d'un clip dans un <canvas>. */
    drawWave(canvas, peaks, color) {
      const context = canvas.getContext('2d');
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      const bar = width / peaks.length;
      peaks.forEach((peak, index) => {
        const h = Math.max(2, peak * height * 0.95);
        context.fillRect(index * bar + bar * 0.15, (height - h) / 2, Math.max(1, bar * 0.7), h);
      });
    },
  };

  GB.voice = voice;
})((window.GB = window.GB || {}));
