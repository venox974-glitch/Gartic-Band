/**
 * GARTIC BANDE — personnages simulés et génération musicale.
 *
 * Les participants contrôlés par le programme composent une couche en suivant des règles
 * simples pour que le résultat reste agréable :
 *   - tout est écrit dans la gamme pentatonique de Do (donc toujours consonant) ;
 *   - une même grille d'accords (« progression ») est partagée par tous les personnages
 *     d'une partie : basse, nappes, arpèges et mélodie sont d'accord entre eux ;
 *   - chaque personnage regarde la chanson existante pour choisir un rôle qui manque
 *     (batterie, basse, harmonie, mélodie) et joue plus ou moins dense selon la place disponible ;
 *   - les rythmes sont lisibles (motifs répétés, pas de hasard pur).
 *
 * Ce module ne dépend ni du DOM ni de Tone.js.
 */
(function (GB) {
  'use strict';

  const { CONFIG } = GB;

  /* ------------------------------------------------------------------ */
  /*  Personnages                                                        */
  /* ------------------------------------------------------------------ */

  GB.HUMAN_PLAYER = {
    id: 'human',
    name: 'Toi',
    avatar: '', // ancien émoji (gardé pour compatibilité) : l'affichage utilise skin
    color: '#FF5C8A',
    isHuman: true,
    // le personnage choisi dans « Mon personnage » (lu au moment où la partie démarre)
    get skin() {
      return GB.avatar ? GB.avatar.get() : { color: 'red', hat: 'none' };
    },
  };

  /**
   * `taste` : goût de chaque personnage pour chaque rôle (plus c'est haut, plus il le choisit volontiers).
   */
  GB.BOT_PLAYERS = [
    { id: 'max', name: 'Max', avatar: '', color: '#D4145A', isHuman: false, skin: { color: 'yellow', hat: 'cheese' }, taste: { drums: 3, bass: 2, lead: 0, pad: 0, arp: 1 } },
    { id: 'zoe', name: 'Zoé', avatar: '', color: '#2EC4B6', isHuman: false, skin: { color: 'blue', hat: 'visor' }, taste: { drums: 0, bass: 1, lead: 1, pad: 3, arp: 2 } },
    { id: 'nina', name: 'Nina', avatar: '', color: '#7C5CFF', isHuman: false, skin: { color: 'violet', hat: 'wizard' }, taste: { drums: 0, bass: 0, lead: 2, pad: 1, arp: 3 } },
    { id: 'tom', name: 'Tom', avatar: '', color: '#4DA3FF', isHuman: false, skin: { color: 'green', hat: 'propeller' }, taste: { drums: 2, bass: 3, lead: 0, pad: 1, arp: 0 } },
    { id: 'leo', name: 'Léo', avatar: '', color: '#7ED957', isHuman: false, skin: { color: 'pink', hat: 'none' }, taste: { drums: 1, bass: 0, lead: 3, pad: 1, arp: 2 } },
    { id: 'ana', name: 'Ana', avatar: '', color: '#FFD23F', isHuman: false, skin: { color: 'white', hat: 'wizard' }, taste: { drums: 2, bass: 1, lead: 1, pad: 2, arp: 1 } },
    { id: 'sam', name: 'Sam', avatar: '', color: '#C45CFF', isHuman: false, skin: { color: 'grey', hat: 'cheese' }, taste: { drums: 0, bass: 2, lead: 2, pad: 2, arp: 3 } },
  ];

  /** Rôle musical → instrument. */
  const ROLE_INSTRUMENT = { drums: 'drums', bass: 'bass', pad: 'synth', arp: 'piano', lead: 'lead' };
  const ROLES = Object.keys(ROLE_INSTRUMENT);

  /** Libellé d'un rôle, pour dire ce que fait un personnage (« ajoute une basse »). */
  GB.ROLE_LABELS = {
    drums: 'un rythme de batterie',
    bass: 'une ligne de basse',
    pad: 'une nappe douce',
    arp: 'un arpège au piano',
    lead: 'une mélodie',
  };

  /* ------------------------------------------------------------------ */
  /*  Hasard reproductible                                               */
  /* ------------------------------------------------------------------ */

  /** Petit générateur pseudo-aléatoire (mulberry32) : même graine → même partie. */
  GB.createRng = function (seed) {
    let value = (seed >>> 0) || 1;
    return function () {
      value = (value + 0x6d2b79f5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function pick(rng, list) {
    return list[Math.floor(rng() * list.length) % list.length];
  }

  /* ------------------------------------------------------------------ */
  /*  Harmonie                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Accords exprimés en numéros de ligne (0 = Do3, 1 = Ré3, 2 = Mi3, 3 = Sol3, 4 = La3, 5 = Do4…).
   *   root  : ligne de la fondamentale (pour la basse)
   *   tones : trois notes de l'accord
   */
  const CHORDS = {
    C: { root: 0, tones: [0, 2, 3] }, // Do – Mi – Sol
    Am: { root: 4, tones: [4, 5, 7] }, // La – Do – Mi
    G: { root: 3, tones: [3, 6, 8] }, // Sol – Ré – Sol
    Em: { root: 2, tones: [2, 3, 6] }, // Mi – Sol – Ré
  };

  const PROGRESSIONS = [
    ['C', 'Am', 'G', 'Am'],
    ['C', 'G', 'Am', 'Em'],
    ['Am', 'C', 'G', 'C'],
    ['C', 'Em', 'Am', 'G'],
  ];

  GB.pickProgression = function (rng) {
    return pick(rng, PROGRESSIONS).slice();
  };

  function chordAt(progression, bar) {
    return CHORDS[progression[bar % progression.length]];
  }

  /* ------------------------------------------------------------------ */
  /*  Analyse de la chanson existante                                    */
  /* ------------------------------------------------------------------ */

  function describeSong(tracks) {
    const roleCount = { drums: 0, bass: 0, pad: 0, arp: 0, lead: 0 };
    const busyColumns = new Set();
    tracks.forEach((track) => {
      const role = ROLES.find((candidate) => ROLE_INSTRUMENT[candidate] === track.instrumentId);
      roleCount[role] += 1;
      track.notes.forEach((note) => {
        for (let column = note.step; column < note.step + note.length; column += 1) busyColumns.add(Math.floor(column));
      });
    });
    return { roleCount, density: busyColumns.size / CONFIG.STEP_COUNT, layerCount: tracks.length };
  }

  /**
   * Choisit le rôle du personnage : ses goûts comptent, mais un rôle qui manque
   * à la chanson (basse, batterie, harmonie) est favorisé et un rôle déjà très présent est évité.
   */
  function chooseRole(player, song, rng, opening) {
    const hasHarmony = song.roleCount.pad + song.roleCount.arp > 0;
    let bestRole = opening ? 'arp' : ROLES[0];
    let bestScore = -Infinity;
    ROLES.forEach((role) => {
      // Une chanson qui démarre ne commence pas par la batterie seule.
      if (opening && role === 'drums') return;
      let score = (player.taste[role] || 0) - 2.2 * song.roleCount[role] + rng() * 0.6;
      if (song.roleCount[role] === 0) score += 1.5; // varier les couleurs : un rôle absent est favorisé
      if (role === 'bass' && song.roleCount.bass === 0) score += 1.4;
      if (role === 'drums' && song.roleCount.drums === 0) score += 1.2;
      if ((role === 'pad' || role === 'arp') && !hasHarmony) score += 1;
      if (role === 'lead' && song.layerCount < 2 && !opening) score -= 1.5; // une mélodie a besoin d'un support
      if (score > bestScore) {
        bestScore = score;
        bestRole = role;
      }
    });
    return bestRole;
  }

  /* ------------------------------------------------------------------ */
  /*  Générateurs par rôle — chacun renvoie [{ step, row, length }]       */
  /* ------------------------------------------------------------------ */

  function note(step, row, length) {
    return { step, row, length: length || 1 };
  }

  /** Batterie : un motif de base, une cymbale au début de chaque phrase et une petite roulade en fin de boucle. */
  function generateDrums(context) {
    const { rng, stepCount, song } = context;
    const patterns = {
      boomTchak: { kick: [0, 2], snare: [1, 3], hat: [] },
      fourOnFloor: { kick: [0, 1, 2, 3], snare: [], hat: [], clap: [1, 3] },
      slow: { kick: [0], snare: [2], hat: [1, 3] },
    };
    // Si la chanson est déjà très remplie, on reste léger.
    const name = song.density > 0.7 ? 'slow' : pick(rng, ['boomTchak', 'fourOnFloor', 'slow']);
    const pattern = patterns[name];
    const notes = [];
    for (let bar = 0; bar < stepCount / CONFIG.STEPS_PER_BAR; bar += 1) {
      const start = bar * CONFIG.STEPS_PER_BAR;
      pattern.kick.forEach((beat) => notes.push(note(start + beat, 0)));
      pattern.snare.forEach((beat) => notes.push(note(start + beat, 1)));
      (pattern.hat || []).forEach((beat) => notes.push(note(start + beat, 2)));
      (pattern.clap || []).forEach((beat) => notes.push(note(start + beat, 4)));
    }
    notes.push(note(0, 7)); // cymbale au début
    if (stepCount >= 8) {
      // roulade de toms sur les deux derniers temps : on retire les coups qui s'y trouvent
      for (let index = notes.length - 1; index >= 0; index -= 1) {
        if (notes[index].step >= stepCount - 2 && notes[index].row < 7) notes.splice(index, 1);
      }
      notes.push(note(stepCount - 2, 5), note(stepCount - 1, 6));
    }
    return notes;
  }

  /** Basse : fondamentale de l'accord sur le premier temps, puis quelques appuis. */
  function generateBass(context) {
    const { rng, stepCount, progression, song } = context;
    const variants = [
      [[0, 2], [2, 1], [3, 1]], // long – court – court
      [[0, 1], [1, 1], [2, 2]], // deux battues puis tenue
      [[0, 3], [3, 1]], // tenue puis relance
    ];
    const variant = song.density > 0.7 ? variants[2] : pick(rng, variants);
    const notes = [];
    for (let bar = 0; bar < stepCount / CONFIG.STEPS_PER_BAR; bar += 1) {
      const chord = chordAt(progression, bar);
      const start = bar * CONFIG.STEPS_PER_BAR;
      variant.forEach(([beat, length], index) => {
        // les appuis du milieu alternent fondamentale / quinte pour éviter la monotonie
        const row = index > 0 && index % 2 === 0 ? chord.tones[2] : chord.root;
        notes.push(note(start + beat, row, length));
      });
    }
    return notes;
  }

  /** Nappe : deux notes de l'accord tenues sur toute la mesure. */
  function generatePad(context) {
    const { stepCount, progression } = context;
    const notes = [];
    for (let bar = 0; bar < stepCount / CONFIG.STEPS_PER_BAR; bar += 1) {
      const chord = chordAt(progression, bar);
      const start = bar * CONFIG.STEPS_PER_BAR;
      notes.push(note(start, chord.tones[0] + 2, CONFIG.STEPS_PER_BAR));
      notes.push(note(start, chord.tones[2] + 2, CONFIG.STEPS_PER_BAR));
    }
    return notes;
  }

  /** Arpège : les notes de l'accord jouées l'une après l'autre (ou plus aéré si la place manque). */
  function generateArp(context) {
    const { rng, stepCount, progression, song } = context;
    const sparse = song.density > 0.7;
    const direction = pick(rng, ['up', 'updown']);
    const notes = [];
    for (let bar = 0; bar < stepCount / CONFIG.STEPS_PER_BAR; bar += 1) {
      const tones = chordAt(progression, bar).tones.map((row) => row + 5);
      const start = bar * CONFIG.STEPS_PER_BAR;
      if (sparse) {
        notes.push(note(start, tones[0], 2), note(start + 2, tones[2], 2));
      } else {
        const order = direction === 'up' ? [0, 1, 2, 2] : [0, 1, 2, 1];
        order.forEach((toneIndex, beat) => notes.push(note(start + beat, tones[toneIndex], 1)));
      }
    }
    return notes;
  }

  /**
   * Mélodie : un petit motif rythmique par mesure (appel / réponse), des notes d'accord sur les temps
   * forts, des notes voisines sur les temps faibles, et une fin posée sur la fondamentale.
   */
  function generateLead(context) {
    const { rng, stepCount, progression, song } = context;
    const bars = stepCount / CONFIG.STEPS_PER_BAR;
    const templates = [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[0, 2], [2, 1], [3, 1]],
      [[0, 1], [2, 2]],
      [[0, 1], [1, 1], [2, 2]],
      [[1, 1], [2, 1], [3, 1]],
    ];
    const calm = [templates[1], templates[2]];
    const pool = song.density > 0.6 ? calm : templates;
    const call = pick(rng, pool);
    const response = pick(rng, pool);

    const LOW = 7;
    const HIGH = 13;
    const notes = [];
    let previous = pick(rng, [9, 10, 12]);

    for (let bar = 0; bar < bars; bar += 1) {
      const chordTones = chordAt(progression, bar).tones.map((row) => row + 5);
      const template = bar % 2 === 0 ? call : response;
      const isLastBar = bar === bars - 1;
      template.forEach(([beat, length], index) => {
        const strong = beat === 0 || beat === 2;
        let row;
        if (isLastBar && index === template.length - 1) {
          row = chordAt(progression, bar).tones[0] + 5; // on termine sur la fondamentale
        } else if (strong) {
          // note d'accord la plus proche de la note précédente
          row = chordTones.reduce((best, candidate) =>
            Math.abs(candidate - previous) < Math.abs(best - previous) ? candidate : best
          );
        } else {
          row = previous + (rng() < 0.5 ? -1 : 1);
        }
        row = Math.min(HIGH, Math.max(LOW, row));
        previous = row;
        notes.push(note(bar * CONFIG.STEPS_PER_BAR + beat, row, length));
      });
    }
    return notes;
  }

  const GENERATORS = { drums: generateDrums, bass: generateBass, pad: generatePad, arp: generateArp, lead: generateLead };

  /* ------------------------------------------------------------------ */
  /*  Point d'entrée                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Compose une couche pour un personnage.
   * Entrée : { player, tracks (couches existantes), progression, rng, opening (true = première couche d'une chanson) }
   * Sortie : { role, instrumentId, notes: [{ step, row, length }, ...] }
   */
  GB.bots = {
    composeLayer({ player, tracks, progression, rng, opening }) {
      const song = describeSong(tracks);
      const role = chooseRole(player, song, rng, Boolean(opening));
      let notes = GENERATORS[role]({ rng, stepCount: CONFIG.STEP_COUNT, progression, song });
      // Les générateurs pensent en lignes pentatoniques ; la grille est chromatique : on convertit (mêmes hauteurs).
      if (GB.INSTRUMENTS[ROLE_INSTRUMENT[role]].kind === 'melodic') notes = notes.map((entry) => Object.assign({}, entry, { row: GB.legacyRow(entry.row) }));
      return { role, instrumentId: ROLE_INSTRUMENT[role], notes };
    },
  };
})((window.GB = window.GB || {}));
