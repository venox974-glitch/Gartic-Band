/**
 * GARTIC BANDE — le CASIER : quels sons je possède, lesquels j'ai ÉQUIPÉS pour jouer.
 *
 *   SKIN   = à quoi ressemble mon personnage (couleur + chapeau)  → js/avatar.js, clé « gartic-bande.avatar.v1 »
 *   CASIER = mes sons et mes objets, et ce que j'équipe pour jouer → ce fichier,  clé « gartic-bande.locker.v1 »
 * Les deux n'ont aucune donnée en commun (un futur « preset » les réunira, voir plus bas).
 *
 * Aucun doublon de données : ce qu'on POSSÈDE vient des registres existants
 *   - sons du jeu            GB.INSTRUMENTS (+ packs, voir GB.SOUND_PACKS)
 *   - sons importés          GB.instruments.sampleList()   (IndexedDB, js/sounds.js)
 *   - instruments créés      GB.instruments.customList()   (js/synth.js)
 *   - chapeaux               GB.avatar.HATS                (hats/hats.js)
 * Le casier ne retient qu'UNE chose en plus : la liste des sons que le joueur a DÉSÉQUIPÉS.
 * Par défaut tout ce qu'on possède est équipé (comme avant le casier) ; un nouveau son importé l'est donc aussi.
 * Un son déséquipé n'est plus proposé dans les listes d'instruments, mais les chansons qui l'utilisent le jouent toujours.
 *
 * PACKS (à venir) : ajouter un pack = ajouter un objet à GB.SOUND_PACKS :
 *   { id: 'jazz', label: 'Pack Jazz', icon: 'sax', items: ['sax', 'upright'] }   (les ids doivent exister dans GB.INSTRUMENTS)
 * Le casier les affiche tout seul ; aucun achat n'est géré pour l'instant.
 *
 * PRESETS (à venir) : un preset sera { skin: GB.avatar.get(), sounds: GB.locker.exportEquipment() }.
 * `exportEquipment()` / `applyEquipment()` sont déjà prêts ; le preset lui-même n'existe pas encore.
 */
(function (GB) {
  'use strict';

  const KEY = 'gartic-bande.locker.v1';

  /** Packs de sons. Le pack « base » est celui qui est livré avec le jeu. Les autres packs viendront s'ajouter ici. */
  GB.SOUND_PACKS = GB.SOUND_PACKS || [
    { id: 'base', label: 'Sons du jeu', icon: 'ins-piano', items: ['piano', 'synth', 'bass', 'lead', 'drums', 'trumpet', 'flute', 'vox', 'mic'] },
  ];

  const unequipped = new Set();
  const listeners = new Set();

  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    if (saved && Array.isArray(saved.unequipped)) saved.unequipped.slice(0, 500).forEach((id) => unequipped.add(String(id).slice(0, 80)));
  } catch (error) {
    /* casier illisible : tout est équipé */
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ v: 1, unequipped: Array.from(unequipped) }));
    } catch (error) {
      /* stockage indisponible : le choix vaut pour la session */
    }
  }

  function notify() {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        /* un écouteur ne doit pas casser le casier */
      }
    });
  }

  /** Tout ce que le joueur possède en fait de sons, dans l'ordre d'affichage habituel (base, voix, instruments créés, sons importés). */
  function ownedIds() {
    const base = GB.INSTRUMENT_ORDER.concat(['trumpet', 'flute', 'vox', 'mic']);
    const packed = [];
    GB.SOUND_PACKS.forEach((pack) => pack.items.forEach((id) => {
      if (GB.INSTRUMENTS[id] && !base.includes(id) && !packed.includes(id)) packed.push(id);
    }));
    return base.concat(packed, GB.instruments.customList().map((meta) => meta.id), GB.instruments.sampleList().map((meta) => meta.id));
  }

  const locker = {
    /** Les sons possédés (équipés ou non). */
    owned: ownedIds,

    isEquipped(id) {
      return !unequipped.has(id);
    },

    /** Les sons équipés : ce que proposent les listes d'instruments (éditeur, préparation de partie). Jamais vide. */
    equipped() {
      const all = ownedIds();
      const list = all.filter((id) => !unequipped.has(id));
      return list.length ? list : all.slice(0, 1);
    },

    /** Équipe / déséquipe un son. Refuse de déséquiper le dernier son équipé. Renvoie true si c'est fait. */
    setEquipped(id, on) {
      if (!GB.INSTRUMENTS[id]) return false;
      if (on) unequipped.delete(id);
      else {
        if (unequipped.has(id)) return true;
        const left = ownedIds().filter((other) => other !== id && !unequipped.has(other));
        if (!left.length) return false;
        unequipped.add(id);
      }
      save();
      notify();
      return true;
    },

    /** Les chapeaux possédés (lecture seule : on les porte depuis « Skin »). Même liste que GB.avatar.HATS. */
    hats() {
      return GB.avatar.HATS.filter((hat) => hat.id !== 'none');
    },

    packs() {
      return GB.SOUND_PACKS.map((pack) => ({ id: pack.id, label: pack.label, icon: pack.icon, items: pack.items.filter((id) => GB.INSTRUMENTS[id]) }));
    },

    /** Pour les futurs presets : l'équipement sonore seul (aucune donnée de skin). */
    exportEquipment() {
      return { v: 1, equipped: locker.equipped() };
    },

    /** Applique un équipement (ignore ce qu'on ne possède pas). Renvoie true si quelque chose a été appliqué. */
    applyEquipment(data) {
      if (!data || !Array.isArray(data.equipped)) return false;
      const wanted = new Set(data.equipped);
      const owned = ownedIds();
      if (!owned.some((id) => wanted.has(id))) return false;
      unequipped.clear();
      owned.forEach((id) => {
        if (!wanted.has(id)) unequipped.add(id);
      });
      save();
      notify();
      return true;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  GB.locker = locker;
})((window.GB = window.GB || {}));
