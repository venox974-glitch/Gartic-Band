/**
 * GARTIC BANDE — écran « Casier » : voir ce qu'on possède et choisir les sons ÉQUIPÉS (données : js/locker.js).
 * Les chapeaux n'y sont que consultés ; on les porte depuis « Skin » (js/avatar-ui.js).
 */
(function (GB) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const screen = $('screen-locker');
  if (!screen || !GB.locker) return;

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function row(id) {
    const meta = GB.INSTRUMENTS[id];
    const on = GB.locker.isEquipped(id);
    const item = create('li', 'locker-item' + (on ? ' equipped' : ''));
    item.dataset.instrument = id;
    const name = create('span', 'locker-name');
    name.append(GB.icons.el(meta.icon, 'ins-icon'), create('strong', null, meta.label));
    const badge = create('span', 'lk-badge' + (on ? ' on' : ''), on ? 'Équipé' : 'Dans le casier');
    const button = create('button', 'btn btn-small ' + (on ? 'btn-ghost' : 'btn-secondary'), on ? 'Déséquiper' : 'Équiper');
    button.type = 'button';
    button.setAttribute('aria-label', (on ? 'Déséquiper ' : 'Équiper ') + meta.label);
    button.addEventListener('click', () => {
      if (!GB.locker.setEquipped(id, !on)) GB.ui.showToast('Garde au moins un son équipé.');
    });
    item.append(name, badge, button);
    return item;
  }

  function fill(list, ids, emptyText) {
    list.textContent = '';
    if (!ids.length) list.append(create('li', 'locker-empty', emptyText));
    ids.forEach((id) => list.append(row(id)));
  }

  function render() {
    const owned = GB.locker.owned();
    const equipped = GB.locker.equipped();
    $('locker-summary').textContent = equipped.length + ' son' + (equipped.length > 1 ? 's' : '') + ' équipé' + (equipped.length > 1 ? 's' : '') + ' sur ' + owned.length + ' dans ton casier.';

    fill($('locker-imported'), GB.instruments.sampleList().map((meta) => meta.id), 'Aucun son importé pour l\'instant.');
    fill($('locker-created'), GB.instruments.customList().map((meta) => meta.id), 'Aucun instrument créé pour l\'instant.');

    const packs = $('locker-packs');
    packs.textContent = '';
    GB.locker.packs().forEach((pack) => {
      const block = create('div', 'locker-pack');
      const sub = create('h4', 'locker-sub');
      sub.append(GB.icons.el(pack.icon), document.createTextNode(pack.label));
      block.append(sub);
      const list = create('ul', 'locker-list');
      pack.items.forEach((id) => list.append(row(id)));
      block.append(list);
      packs.append(block);
    });

    const hats = $('locker-hats');
    hats.textContent = '';
    const worn = GB.avatar.get().hat;
    GB.locker.hats().forEach((hat) => {
      const item = create('li', 'locker-hat' + (hat.id === worn ? ' worn' : ''));
      const picture = create('span', 'hat-picture');
      picture.innerHTML = GB.avatar.markup({ color: GB.avatar.get().color, hat: hat.id }, 'key-mini');
      item.append(picture, create('span', 'hat-name', hat.label));
      if (hat.id === worn) item.append(create('span', 'lk-badge on', 'Porté'));
      hats.append(item);
    });
    if (!GB.locker.hats().length) hats.append(create('li', 'locker-empty', 'Aucun chapeau pour l\'instant.'));
  }

  function open() {
    render();
    GB.ui.showScreen('locker');
  }

  $('btn-inventory').addEventListener('click', open);
  $('btn-locker-back').addEventListener('click', () => GB.ui.showScreen('home'));
  $('btn-locker-to-skin').addEventListener('click', () => $('btn-custom').click());
  $('btn-skin-to-locker').addEventListener('click', open);
  $('btn-inv-sounds').addEventListener('click', () => GB.soundsUI && GB.soundsUI.open());
  $('btn-inv-synth').addEventListener('click', () => GB.synthUI && GB.synthUI.open());

  // Un choix d'équipement change les listes d'instruments ailleurs ; un import / une création change le casier.
  GB.locker.onChange(() => {
    render();
    GB.ui.renderInstrumentPicker();
    if (GB.pregameUI && GB.pregameUI.soundsChanged) GB.pregameUI.soundsChanged();
  });
  if (GB.instrumentUI && GB.instrumentUI.onSaved) GB.instrumentUI.onSaved(() => {
    if (!screen.hidden) render();
  });
  if (GB.sounds && GB.sounds.onChange) GB.sounds.onChange(() => {
    if (!screen.hidden) render();
  });

  GB.lockerUI = { render, open };
})((window.GB = window.GB || {}));
