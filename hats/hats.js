/**
 * TES CHAPEAUX — c'est ici que tu en ajoutes, sans toucher au reste du code.
 *
 * 1. Dessine ton chapeau SEUL dans un canevas de 1080 x 1080, en te servant du modèle « hats/modele-chapeau.svg »
 *    (le personnage y sert de guide : place ton chapeau sur sa tête, puis cache le personnage avant d'exporter).
 * 2. Exporte en SVG et mets le fichier dans ce dossier « hats », par exemple « hats/cowboy.svg ».
 * 3. Ajoute UNE ligne dans la liste ci-dessous (garde la virgule à la fin) :
 *      { id: 'cowboy', label: 'Cowboy', file: 'hats/cowboy.svg' },
 *    - id    : un nom court, en minuscules, sans espace ni accent (il est enregistré dans le navigateur du joueur)
 *    - label : le nom affiché dans la page « Skin »
 *    - file  : le chemin du fichier
 *    Réglages facultatifs (ajoute-les à la même ligne) :
 *    - x, y  : décalage du chapeau en unités du canevas (x positif = vers la droite, y positif = vers le bas), ex. x: 20, y: -30
 *    - scale : taille (1 = tel que dessiné, 1.2 = 20 % plus grand), autour du haut de la tête
 *    - blink : false = les yeux ne clignent pas avec ce chapeau (utile s'il cache les yeux)
 *    Ces nombres se règlent ici, dans le fichier (il n'y a plus de réglage en jeu) : essaie, recharge la page, ajuste.
 * 4. Recharge la page : le chapeau apparaît dans « Skin ».
 * Un chapeau garde ses propres couleurs ; il ne reçoit pas d'ombre.
 * CHAPEAU QUI PREND LA COULEUR DU SKIN : au lieu de `file`, donne `markup` (le contenu SVG du chapeau, canevas 1080 x 1080) et mets
 *    fill="var(--c)" aux endroits qui doivent changer de couleur (voir « bros » ci-dessous ; son fichier d'origine est hats/bros.svg).
 */
(function (GB) {
  'use strict';
  GB.HATS_EXTRA = [
       { id: 'propeller', label: 'Casquette à hélice', file: 'hats/propeller.svg', x: 0, y: 0 },
       { id: 'visor', label: 'Visière', file: 'hats/visor.svg', x: 0, y: 0, blink: false },
       { id: 'cheese', label: 'Cheese', file: 'hats/cheese.svg', y: -388 },
       // Casquette Piano Bros : le dessin est dans la décoration du jeu (casquette + bord prennent la couleur du skin). Dessinée pour un personnage plus bas de 131 : y: -131.
       { id: 'bros', label: 'Piano Bros', y: -131, markup: '<path d="M190 212.767 C228.563 170.956 252.253 104.478 346.686 74.854 C402.075 57.477 468.537 47.355 540 47.355 C628.08 47.355 708.56 62.732 770.079 88.115 C843.569 118.437 862.657 180.962 890 212.767 C949.555 282.042 733.3 378.18 540 378.18 C346.7 378.18 128.064 279.921 190 212.767 Z" fill="var(--c)" stroke="#20123f" stroke-width="36" stroke-linejoin="round"/><path d="M351.344 194.003 C351.344 145.914 435.808 106.931 540 106.931 C644.192 106.931 728.656 145.914 728.656 194.003 C728.656 242.091 644.192 281.075 540 281.075 C435.808 281.075 351.344 242.091 351.344 194.003 Z" fill="#ffffff" stroke="#20123f" stroke-width="36" stroke-linejoin="round"/><path d="M265.38 361.331 C265.38 307.336 388.186 281.075 539.675 281.075 C691.164 281.075 813.97 307.336 813.97 361.331 C813.97 415.325 704.922 386.557 553.432 386.557 C401.943 386.557 265.38 415.325 265.38 361.331 Z" fill="var(--c)" stroke="#20123f" stroke-width="36" stroke-linejoin="round"/><path d="M509.646 255.334 C509.646 239.369 506.944 178.999 511.512 168.918 C514.853 161.544 528.059 157.601 535.767 155.857 C557.087 151.036 589.875 154.307 589.875 182.397 C589.875 184.007 590.021 194.732 589.875 195.039 C585.609 204.013 564.957 209.965 556.574 209.965 L518.975 209.965" fill="none" stroke="#20123f" stroke-width="36" stroke-linejoin="round"/>' },
       { id: 'wizard', label: 'Wizard Hat', file: 'hats/wizard.svg', y: -243 },
       // Chapeaux dessinés sur un personnage 131 plus bas que le modèle : y: -131
       { id: 'weird', label: 'Chapeau bizarre', file: 'hats/weird.svg', y: -131 },
       { id: 'headphones', label: 'Casque audio', file: 'hats/headphones.svg', backFile: 'hats/headphones-back.svg', y: -131 },
       { id: 'hollow', label: 'Hollow', file: 'hats/hollow.svg', y: -131, blink: false },
  ];
})((window.GB = window.GB || {}));
