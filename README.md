# 🎵 Gartic Bande — Build Up (v10 : piano-roll refondu — 3 modes, zoom, grille plein écran)

Un petit jeu de création musicale : pose des notes sur un piano-roll, ajoute des pistes avec d'autres instruments et écoute tout jouer en boucle.

## Lancer le jeu

**Solo (aucun serveur) :** lance un mini serveur local dans ce dossier et ouvre `http://localhost:8000` :

```bash
python3 -m http.server 8000
```

Double-cliquer sur `index.html` marche pour le solo, mais le **microphone** n'est autorisé par les navigateurs que sur `http://localhost` ou en `https://` : utilise donc `localhost`.

**Avec des amis (salons privés) :** voir la section « Multijoueur » plus bas — il faut démarrer le serveur du dossier `server/`.

> Le son démarre après ton premier clic (règle des navigateurs). Pense à monter le volume 🔊.

## Révélation finale (v10b)

Quand toutes les couches d'une chanson jouent ensemble, la **boucle complète tourne à l'infini** : la musique ne s'arrête que lorsque l'hôte clique « Chanson suivante » ou « Terminer la partie » (une chanson ne démarre jamais seule). Même chose pour un joueur qui rejoint ou se reconnecte après la fin de la montée en couches.

## Refonte du piano-roll (v10)

**Mise en page.** L'éditeur occupe exactement la fenêtre : barre du haut sur une ligne (Lecture / Pause, Arrêt, **position de la barre de lecture**, tempo), une seule barre d'outils pour le piano-roll, et la grille prend tout le reste (à 1366×768 : ≈ 1045×556 px, soit 76 % de la largeur). Le panneau pistes / instruments (☰) se replie et défile seul ; « Astuces » est repliable. En partie, la barre de round est compacte. Sur petit écran (< 1100 px) tout passe en colonne.

**Trois modes** (sélecteur 👶 Baby · 🎹 Débutant · 🎼 Expert, mémorisé dans ce navigateur ; Expert par défaut). Le mode ne change que **l'affichage et ce qu'on peut poser** : les données restent chromatiques, aucun format de sauvegarde ni le serveur n'ont changé (pas de migration nécessaire).
- **Baby** : gamme pentatonique au choix, **majeure** (Do Ré Mi Sol La) ou **mineure** (Do Mi♭ Fa Sol Si♭), identique sur les 3 octaves ; seules ces 15 lignes existent, en grosses touches colorées ; grille Temps / Demi-temps, aimant forcé (Alt ne libère plus).
- **Débutant** : les 7 notes naturelles sur 3 octaves (21 touches blanches, aucune noire), toutes libres ; pas de grille jusqu'au quart de temps ; aimant ou placement libre.
- **Expert** : 36 lignes (touches blanches et noires), pas Temps, ½, ¼, ⅛ et **triolet ⅓**, placement libre (Alt).
- **Changer de mode ne supprime ni ne modifie rien.** Une note sur une ligne que le mode ne propose pas reste jouée normalement, sa ligne reste affichée **en grisé avec l'étiquette « hors mode »**, la note est hachurée, et un bandeau l'explique. On peut la déplacer (elle garde sa hauteur si on ne la déplace que dans le temps) ou la supprimer ; on ne peut pas poser de nouvelles notes sur cette ligne. Dès qu'elle rejoint une ligne du mode, la ligne grisée disparaît. L'ancien bouton « Gamme douce » est remplacé par le mode Baby.

**Zoom.** Horizontal ↔ (100 % = les 4 mesures tiennent dans la grille ; jusqu'à 1200 %) et vertical ↕ (60 % à 400 %) **indépendants**, boutons − / + avec niveau affiché, **Ctrl + molette** (temps, centré sur le curseur) et **Ctrl + Maj + molette** (hauteur) — le pincement du pavé tactile marche aussi —, **⤢ Ajuster** (cadre les notes de la piste), **↺ 100 %**, boutons **Octave ▲▼**, défilement normal à la molette / barres. Les repères de subdivision (½, ¼, ⅛, ⅓) apparaissent d'eux-mêmes quand on zoome. Le clavier et la règle des temps restent collés (alignés ligne par ligne). Le zoom est de l'affichage pur : hauteurs, durées, tempo et sons ne changent pas. Pendant un déplacement / redimensionnement, tenir le pointeur près d'un bord fait défiler la grille.

**Barre de lecture.** Visible dans la règle et dans la grille, glissable (la position change sans toucher aux notes), lecture reprise depuis cet endroit, affichage « Mesure · temps » en haut. **🎯 Suivre** : pendant l'écoute, la grille défile pour garder la barre visible.

## Clavier à touches noires (v9)

- Le piano-roll est **chromatique** : une ligne par demi-ton, 3 octaves (Do3 à Si5). La colonne de gauche est un vrai **clavier** : touches blanches, et touches noires (Do♯ Ré♯ | Fa♯ Sol♯ La♯ — motif 2 puis 3 qui se répète) plus courtes (62 % de la largeur) et au premier plan, alignées exactement sur leur ligne. Cliquer une touche la fait **sonner**.
- Les notes noires se posent, se déplacent, se redimensionnent, se quantifient et se lisent comme les blanches. La hauteur est celle du nom affiché (ex. ligne « Do♯4 » = C#4, exactement un demi-ton au-dessus de Do4).
- (v10 : l'ancien bouton « Gamme douce » est remplacé par le mode **Baby**.)
- Compatibilité : la démo, les personnages et les aperçus ont été convertis (`GB.legacyRow`) et sonnent comme avant. Les sons importés restent à leur hauteur d'origine sur Do4. Le serveur accepte les lignes 0 à 35.
- Les voix, instruments personnalisés, sons importés et la voix robot (voyelle par note) fonctionnent sur les touches noires.

## Nouveautés v8

- **Thèmes et vote** (parties en rounds) : chaque joueur propose des thèmes (100 caractères, 3 par joueur, doublons refusés, auteur affiché, l'hôte peut supprimer). L'hôte lance un vote (durée au choix, clôture manuelle possible) : 1 vote par joueur, modifiable tant que le vote est ouvert, compteurs identiques pour tous. Gagnant = le plus voté ; **égalité** : l'hôte choisit parmi les thèmes à égalité ; **personne n'a voté** : l'hôte choisit une proposition ou le thème par défaut (indiqué « par défaut »). Le thème reste affiché pendant les rounds et la révélation. Le mode **composition solo** n'a pas de thème et ouvre le studio directement. Le mode **test local** passe par le même écran (tu joues l'hôte ou n'importe quel participant, les bots votent). Règles dans `js/themes.js`, partagées par le navigateur et le serveur.
- **🎧 Mes sons** : importe des fichiers WAV, MP3 ou OGG (selon ce que ton navigateur sait lire) par le sélecteur ou en glissant-déposant. Vérifications : taille (réglable 1/2/5/10 Mo, jamais lue si trop grosse), vrai format (d'après le contenu), fichier corrompu, durée (30 s max), 40 sons et 60 Mo au total, doublons (même contenu = même son). Écouter, renommer, volume, supprimer. Sauvegarde dans **IndexedDB de ton navigateur** (donc **sur cet ordinateur seulement**).
- **Son importé = instrument du piano-roll** : « 🎹 Utiliser comme instrument ». Chaque note joue le son à sa position (au quart de temps ou libre), déplaçable/redimensionnable comme les autres, synchronisée avec les autres couches et la barre de lecture (reprise au milieu d'un son long comprise). Le même son sert pour autant de notes qu'on veut : **un seul décodage partagé**, une source de lecture légère par note.
  - **Hauteur = vitesse de lecture** (comme un échantillonneur d'autrefois) : Do4 = son d'origine, plus aigu = plus rapide donc **plus court**, plus grave = plus lent donc plus long. Ce n'est pas un changement de hauteur « à durée constante » (c'est un choix prévisible ; l'autre demande un algorithme beaucoup plus lourd). Réglage « Hauteur : toujours l'original » pour des sons de batterie ou d'ambiance.
  - **Durée** : « Joué en entier » (la note déclenche le son, jamais coupé) ou « Coupé à la fin de la note » (fondu de 15 ms). Le panneau de réglages indique la durée du son en temps au tempo courant.
- **Mémoire des compositions** : une couche garde l'**empreinte SHA-256** du son (référence stable) et un instantané de ses réglages. Renommer, changer le volume ou supprimer le son dans la bibliothèque ne change pas une contribution déjà validée.
- **Multijoueur et sons** : l'audio ne passe **pas** par le WebSocket. Le fichier part en HTTP vers le salon (`PUT /rooms/CODE/sounds/EMPREINTE`), les autres joueurs le téléchargent (`GET`) ; la contribution ne contient que l'empreinte. Accès réservé aux joueurs du salon (jeton), vérification de l'empreinte et du format côté serveur, quotas (5 Mo/fichier, 8 fichiers/joueur, 40 Mo/salon). Les sons des autres restent en mémoire, **jamais** dans ta bibliothèque. Stockage serveur **en mémoire** (perdu au redémarrage).
- **Guide de mise en ligne pour débutant** : voir **DEPLOY.md** (outils, commandes, variables, hébergeurs et coûts, HTTPS/WebSocket, persistance, dépannage).

## Structure des fichiers

```
gartic-bande/
├── index.html        Structure (accueil, configuration, éditeur, écran final)
├── css/style.css     Design, couleurs, animations
├── server/           Serveur multijoueur Node (rooms.js, server.js, test-server.js)
├── vendor/Tone.js    Tone.js 15.1.22 (copie locale → fonctionne hors-ligne)
└── js/
    ├── config.js     Constantes, instruments, gamme, démo
    ├── state.js      État (pistes, notes, déplacement, durées, pistes verrouillées) — sans DOM ni audio
    ├── audio.js      Moteur Tone.js : voix, séquenceur au quart de temps, note-on/note-off, lecture/pause/arrêt, déplacement de la barre (seek)
    ├── bots.js       Joueurs fictifs : choix d'instrument et génération des couches
    ├── rounds.js     Plan des rounds (rotation générale 2–8 joueurs), partagé avec le serveur
    ├── game.js       Machine à états de la partie en rounds (chrono, Prêt, contributions)
    ├── ui.js         Éditeur : rendu, clics, glisser-déposer, poignée de durée
    ├── instruments.js Instruments : voix robot, instruments perso (sauvegarde locale), sons importés
    ├── sounds.js / sounds-ui.js  Bibliothèque « Mes sons » (IndexedDB, import, décodage partagé) et sa fenêtre
    ├── themes.js / themes-ui.js  Propositions de thèmes et vote (règles partagées avec le serveur) et panneau
    ├── voice.js      Micro : permission, enregistrement, WAV, rendu de la forme d'onde
    ├── instrument-ui.js / voice-ui.js  Panneaux réglages / enregistrement
    ├── net.js / online.js / lobby-ui.js  Client multijoueur (WebSocket), salon, bandeau de connexion
    └── game-ui.js    Interface de la partie solo : configuration, bandeau, choix d'instrument, écran final
```

## Dépendances

Une seule : **Tone.js** (fournie dans `vendor/`). Pas de build, pas de npm, pas d'API externe.

## Contrôles de l'éditeur

| Action | Comment |
| --- | --- |
| Poser une note | Clic sur une cellule vide (ou glisser pour en poser plusieurs) |
| Supprimer une note | Simple clic sur la note (un glisser ne supprime jamais) |
| Déplacer une note | La saisir et la glisser (temps et hauteur), aimantée au pas de la grille choisie, souris ou tactile |
| Changer la durée | Tirer la poignée au bord droit de la note : la **fin** se cale sur un repère de la grille |
| Choisir le pas de la grille | Barre **Grille** : *Temps*, *Demi-temps* (contretemps), *Quart de temps* |
| Placement libre | Bouton **🧲 Aimant** (coupé = « 🖐 Libre ») ou touche **Alt** maintenue pendant le geste : position au millième de temps |
| Placer la barre de lecture | Cliquer ou glisser dans la **règle des temps** (en haut de la grille), ou saisir le drapeau / la poignée de la barre. Aucune note n'est touchée. |
| Lecture / Pause | Bouton **Lecture** ou **Espace** (la lecture part de la barre ; à l'arrêt la barre revient au début) |
| Arrêt | Bouton **Arrêt** |
| Tempo | Curseur, − / + (60 à 180 BPM), modifiable en lecture |
| Pistes | Ajouter (8 max), changer d'instrument, couper, supprimer, effacer, recommencer |

## Barre de lecture et grille (v7)

- **Barre de lecture** : toujours visible dans le piano-roll (verte à l'arrêt, jaune en lecture, orange en pause). Cliquer ou glisser dans la règle des temps la place au quart de temps près. À l'arrêt ou en pause, la prochaine lecture part de là ; en lecture, un glissement saute à la position au relâchement. Les notes déjà commencées à cet endroit sont rejouées pour leur durée restante, ainsi que les voix enregistrées (`audio.seek`, `audio.getCursor`). Fonctionne avec les instruments, la voix robot (voyelles comprises) et les voix micro. La barre n'écrit jamais dans la composition.
- **Grille** : temps / demi-temps / quart de temps, avec repères (traits de subdivision dans la grille, graduations dans la règle, ligne pointillée sous le curseur et lecture « Ici : mesure 2, temps 2½ »). Avec l'aimant, poser, déplacer et allonger se calent sur le pas ; sans aimant (ou avec Alt) la position est libre, arrondie au millième de temps. Un clic en mode libre pose une seule note (pas de traînée).
- **L'audio colle à l'affichage** : une note `step` est planifiée à `step` exactement (pas seulement à la case la plus proche), sa durée est `length × durée d'un temps`. Mesuré dans un navigateur avec un compteur de niveau échantillon par échantillon : écart de position ≤ 2 ms, durées proportionnelles aux longueurs affichées.
- Les batteries ne se chevauchent que si deux coups sont à moins d'un quart de temps ; leur largeur affichée se raccourcit alors pour ne pas se recouvrir.
- Le serveur accepte les positions fractionnaires (0 ≤ position < boucle, durée ≥ 0,05 temps, arrondies au millième).

## Révélation pilotée par l'hôte (v7)

- Fin du dernier round → **écran d'attente** (« La composition est terminée ! ») : rien ne démarre tout seul.
- **Hôte seulement** : « ▶ Commencer la révélation » → chanson 1 couche après couche ; quand la boucle complète est finie : « Chanson suivante ▶ » (ou « ↺ Réécouter cette chanson ») ; après la dernière : « 🏁 Terminer la partie » → écran final. La chanson suivante ne démarre jamais automatiquement. Les boutons n'apparaissent que quand l'action est possible.
- **En ligne** : l'hôte envoie `reveal-start` / `reveal-next` / `reveal-replay` / `reveal-end` au serveur, qui refuse tout autre joueur (`not-host`), tient l'état (étape, chanson, numéro de séquence) et le diffuse. Chaque client lance la chanson quand le numéro de séquence change. La vue du salon contient l'état de la révélation : un joueur qui se reconnecte rejoint la chanson en cours au bon endroit.
- **Pas de pause pour les joueurs** : plus de bouton Pause, Espace / Lecture / Arrêt / barre de lecture sont ignorés pendant la révélation. Chacun peut régler **son volume** (curseur 🔊, sans effet sur la lecture). Après « Terminer la partie », chacun peut réécouter les chansons pour lui seul.
- **Audio suspendu** (veille, onglet gelé, blocage du navigateur) : un bandeau le signale avec « Reprendre le son » ; quand le son revient, le client redemande l'état au serveur (`reveal-sync`) et rejoint les autres. On ne peut pas empêcher un navigateur de suspendre l'audio : on le détecte et on rattrape.
- En test local, le joueur humain est l'hôte (mêmes règles, `GB.game.revealCommand(commande, arg, auteur)` refuse un autre auteur).

## Noms des chansons (v7)

« La chanson d'Alex », « La chanson de Mia » (élision devant une voyelle). Le titre vient du **créateur initial** de la base, calculé **une seule fois au lancement** (`Rounds.songTitles`, fonction partagée navigateur/serveur) : les pseudos sont figés au lancement et on ne peut pas les changer ensuite, donc une chanson ne change jamais de propriétaire. Deux titres identiques sont numérotés « (1) », « (2) ». Chaque chanson a un id stable (`song-N`) et un `creatorId` ; le titre ne sert qu'à l'affichage. Visible pendant les rounds (bandeau, choix d'instrument, écoute, annonce), dans la liste des chansons et le titre de la révélation. En mode test, un champ « Ton pseudo » permet de nommer ta chanson.

## Direction artistique (v6)

Style « autocollants » : fond violet profond avec motifs dessinés, cartes blanches à contour encre épais et ombre dure, boutons qui s'enfoncent quand on clique, mascotte et logo originaux (aucune image ni ressource de Gartic Phone). Polices **Bagel Fat One** (titres) et **Fredoka** (texte), embarquées dans `vendor/fonts/` (licence OFL, fichiers de licence inclus) : tout marche hors-ligne. Toutes les couleurs sont des variables en tête de `css/style.css`.

- **Plus de barre d'étapes en haut.** Pendant un round, la zone de travail affiche directement : le round, la consigne (« Ajoute ta couche à la chanson B de Max (2 couches déjà) »), le temps restant avec sa barre, l'état de ta contribution (« Tu composes », « Ta contribution est verrouillée »…) et « 2/4 prêts ». Les joueurs et leur état (compose… / prêt ✓ / absent) sont dans un panneau à gauche.
- Le piano-roll reste précis : grille lisible sur fond blanc, notes à contour net, poignée de durée, déplacement inchangés.

## Voix robot : une voyelle par note

Dans une piste « Voix robot », chaque note porte sa voyelle (**A, E, I, O, U, OU**), écrite sur la note.
- Barre jaune au-dessus de la grille : sans note sélectionnée, le bouton choisit la voyelle des **prochaines** notes ; clique une note posée pour la **sélectionner** (contour jaune) et change sa voyelle seule (aussi avec les touches A E I O U). Second clic sur la note sélectionnée, bouton « Supprimer la note » ou touche Suppr : la note disparaît.
- La voyelle est conservée quand on déplace ou allonge la note, dans les contributions (solo, test local, serveur) et à la révélation (écrite sur la note dans la vue des couches, et listée dans la carte de contribution).
- Son : chaque voyelle a sa propre banque de trois filtres de formants (résonances de la bouche) appliquée à une source en dents de scie ; les notes qui se suivent passent d'une voyelle à l'autre par un fondu court (attaque 40 ms / relâchement 180 ms). « U » est le [y] français, « OU » le [u].
- **Limites honnêtes** : c'est une voix électronique stylisée, pas un chant réaliste ; les voyelles sont reconnaissables mais robotiques ; le passage d'une voyelle à l'autre est un fondu enchaîné et non un vrai glissement des formants ; pas de consonnes ni de paroles. Un ancien projet qui avait « U » réglé sur la piste entendra un U légèrement différent (il est maintenant français).

## Accueil et modes

- **🌐 Jouer en ligne** : créer un salon privé (code à 5 caractères), rejoindre avec un code, pseudo, liste des participants, lancement par l'hôte. Ne marche que si le serveur `server/` est joignable (sinon message d'erreur clair).
- **🎹 Composition solo** : le studio libre, sans round ni chrono. Le bouton « 🏠 Accueil » du studio garde ta composition en mémoire (un rechargement de la page l'efface).
- **🧪 Tester une partie** (séparé) : simule une partie à 2–8 participants sur ton ordinateur, avec des personnages fictifs, ou en mode « test » où tu contrôles tout le monde (clique sur un participant pour passer de l'un à l'autre, son brouillon est gardé).

## Parties en rounds simultanés

n participants → n chansons (une par créateur) → n rounds. **Tout le monde joue en même temps.**

- Round 1 : chacun crée la base de sa chanson. Round r : le joueur i reçoit la chanson (i + r − 1) mod n. Chaque round, chaque chanson n'a qu'un seul joueur ; un joueur ne contribue jamais deux fois à la même chanson ; le créateur ne reçoit jamais sa chanson (sa base compte). Marche pour 2 à 8 joueurs (à 2 : chacun ajoute une couche à la chanson de l'autre). Voir `js/rounds.js` (partagé navigateur/serveur).
- Un round = annonce (4 s) → chrono commun (durée réglée par l'hôte : 30 s à 5 min, défaut 90 s) avec barre de progression toujours visible.
- **Prêt** : sauvegarde immédiatement, verrouille l'éditeur (« En attente des autres joueurs »), pas de double validation. Le round se termine dès que tous les joueurs présents sont prêts, ou à zéro.
- **Temps écoulé** : le travail en cours est sauvegardé tel quel ; qui n'a rien fait reçoit une contribution **vide** (marquée `empty`, aucune note inventée). Un joueur qui ne répond pas ne bloque jamais les autres.
- Les contributions validées sont figées (notes, durées, instrument, voix enregistrée, auteur, ordre). Pas de « corriger après Prêt ».
- **Révélation** : pour chaque chanson, la base du créateur seule, puis chaque couche s'ajoute (les précédentes continuent), avec le nom de l'auteur. Pilotée par l'hôte (voir ci-dessus) ; une couche vide est indiquée.

Fichiers : `rounds.js` (plan), `game.js` (état, chrono, contributions), `game-ui.js` (écrans), `bots.js` (personnages).

## Comment ça marche

- Grille : 1 colonne = 1 temps ; la boucle fait 8 à 16 colonnes selon le nombre de mesures. Positions et durées suivent le pas choisi (temps, demi-temps, quart de temps) ou sont libres.
- Lignes = **gamme chromatique** (v9) : 36 lignes = 3 octaves de Do3 à Si5, une ligne par demi-ton (voir « Clavier à touches noires ») ; batterie = 8 sons.
- Une note a un début et une durée réels : chaque note est jouée avec un attack/release planifié sur l'horloge audio, donc pas de note bloquée ni de son après l'arrêt, même si on déplace ou redimensionne en lecture.
- Une seule séquence Tone.js lit l'état à chaque **quart de temps** ; chaque note part avec le décalage exact de sa position dans ce quart. Les modifications en lecture sont prises en compte au quart de temps suivant.

## Voix, instruments personnalisés

- **🎤 Voix (micro)** : piste d'enregistrement. Le micro ne s'ouvre que sur ton clic (« Enregistrer » ou « Enregistrer sur la boucle »), se referme à l'arrêt, et tu peux réécouter, recommencer, déplacer la voix sur la boucle (glisser, ◀ ▶) et régler son volume. L'enregistrement est stocké dans la contribution (WAV mono 24 kHz). Refus de permission, absence de micro, micro occupé, navigateur incompatible ou page non sécurisée donnent un message explicite.
- **🤖 Voix robot** : voix **électronique** à formants (voyelles a/e/i/o/u, octave, brillance, vibrato, effet robot…). Ce n'est PAS une voix chantée réaliste. `audio.registerEngine(nom, fabrique)` est le point d'extension pour brancher plus tard un vrai synthé de chant.
- **Instruments personnalisés** (« ＋ Créer un instrument ») : forme d'onde (sinus/carré/triangle/dent de scie), octave, volume, attack/release, réverb, écho, nom et icône. Sauvegardés dans le navigateur (localStorage), utilisables comme les autres instruments dans le piano-roll. L'import de sons personnels existe depuis la v8 (« 🎧 Mes sons »).

## Multijoueur (salons privés)

**État réel :** le multijoueur ne fonctionne que si le serveur `server/` est démarré et joignable. Sans serveur, l'écran « 🌐 Salon privé » affiche une erreur claire ; le mode solo n'est jamais affecté.

```bash
cd server
npm install
npm start          # http://localhost:8080 — sert aussi le jeu et le WebSocket /ws
npm test           # 176 vérifications automatiques (100 salons/rounds/révélation + 47 thèmes/votes + 29 sons partagés)
```

Ouvre `http://localhost:8080` dans plusieurs onglets/appareils du même réseau : un joueur crée un salon (code à 5 caractères), les autres le rejoignent avec le code et un pseudo ; l'hôte règle (joueurs, mesures, tempo, durée des rounds) et lance. Le serveur est l'autorité : il garde le round, le chrono et les transitions, accepte une contribution seulement du bon joueur pour le round en cours (jamais de doublon ni d'écrasement, même après rechargement), complète les absents par une contribution vide et envoie tout à tous.

- **Déconnexion** : le client se reconnecte seul avec un jeton de reprise (donné par le serveur, gardé en sessionStorage, aucune clé secrète). Un rechargement de page propose « Reprendre le salon ». Un joueur absent est signalé et ne bloque pas la partie (contribution vide). Si l'hôte part, un autre joueur le devient.
- Le serveur a besoin du **dépôt entier** (il lit `../js/rounds.js` et sert `index.html`, `css/`, `js/`, `vendor/`). **Pour jouer à distance** il faut **héberger** ce serveur sur une machine publique (Render, Railway, Fly.io, un VPS…) : commande `npm start` dans `server/`, Node ≥ 18, port lu dans `PORT`. Ces services fournissent le HTTPS ; le navigateur se connectera alors en `wss://` automatiquement (même adresse que la page). Variable optionnelle `ALLOWED_ORIGINS` (liste séparée par des virgules) pour n'autoriser que ton domaine. Si la page est hébergée ailleurs (ex. GitHub Pages), saisis l'adresse `wss://…` dans « Adresse du serveur ».
- **Limites** : salons gardés en mémoire (un redémarrage du serveur les efface, expiration après 30 min d'inactivité), 2 à 8 joueurs, pas de comptes ni de sauvegarde de partie, un seul serveur (pas de répartition de charge). Les enregistrements voix (≤ 30 s) transitent par le serveur.
- Aucune clé secrète dans le code navigateur : le serveur n'en utilise aucune.

## Limites connues

- Pas de sauvegarde de partie : recharger la page efface la partie locale et le studio solo (les instruments perso restent). En ligne, recharger en plein round perd le brouillon non envoyé (le salon, lui, est repris).
- Le multijoueur en ligne est testé avec de vrais clients WebSocket et 3 navigateurs sur la même machine ; **pas encore testé sur Internet avec de vrais appareils**.
- Les sons de batterie ne sont pas redimensionnables (durée fixe).
- **Synchronisation de la révélation** : elle repose sur les messages du serveur, donc au niveau de la latence réseau (quelques dizaines de ms en réseau local, davantage sur Internet) ; il n'y a pas d'horloge commune sur l'audio. Testé avec de vrais clients WebSocket et 3 navigateurs sur une même machine, **pas sur Internet ni sur des appareils réels**.
- Aucun site web ne peut garantir qu'un joueur n'arrête pas sa propre musique (outils de développement, coupure du son système) : l'interface n'offre aucune commande de pause et le serveur est l'autorité sur la progression, mais c'est de la conception, pas une protection absolue.
- « Chanson suivante » est bloqué tant que la boucle complète n'est pas finie **côté hôte** (le serveur, lui, accepte l'ordre de l'hôte à tout moment).
- Un joueur qui rejoint ou revient en cours de révélation rejoint la chanson au bon endroit à la précision de la latence et du quart de temps près.
- La barre de lecture se place au quart de temps ; la reprise après une pause rejoue au plus un quart de temps.
- Les notes d'une même ligne ne peuvent pas se chevaucher ; un déplacement/redimensionnement bloqué par une voisine est refusé ou limité.
- Les timbres de base sont synthétisés ; seuls les sons que TU importes sont des échantillons.
- **Sons importés** : la hauteur change aussi la durée (voir plus haut) ; pas de recadrage ni de boucle du son ; WAV/MP3/OGG selon le navigateur (OGG absent de Safari) ; la bibliothèque est locale à ton ordinateur ; côté serveur les sons sont en mémoire et disparaissent avec le salon. La révélation télécharge les sons dès réception des contributions : sur une connexion très lente, un son pourrait ne pas être prêt à temps (il est alors muet jusqu'à son arrivée).
- **Thèmes** : pas de modération automatique (l'hôte supprime à la main) ; les votes se font entre joueurs présents.
- Les bots sont des règles musicales simples, pas de l'IA : leurs couches restent volontairement modestes.
- Pas de comptes ni d'export audio. Le tempo change la durée d'une voix enregistrée par rapport aux temps.

## Tester en local

```bash
# jeu + serveur (une seule commande) :
cd server && npm install && npm start      # http://localhost:8080
```
- **Rounds, 2/3/4 joueurs** : « Tester une partie » → choisis le nombre de participants. Mode « test » : tu joues tous les rôles (clique sur chaque participant, pose des notes, « Prêt »).
- **Voyelles** : studio solo → instrument « Voix robot » → clique les boutons A E I O U OU puis la grille ; clique une note pour changer seulement sa voyelle ; ▶ Lecture.
- **Joueur prêt avant les autres** : mets-toi « Prêt » et regarde les autres puces passer de « compose » à « prêt ».
- **Joueur qui ne clique jamais** : choisis 30 s, ne fais rien pour un participant → à zéro sa contribution est vide.
- **Chrono expiré avec travail en cours** : pose des notes sans « Prêt », attends zéro → les notes sont gardées.
- **En ligne** : ouvre 2–4 onglets sur `http://localhost:8080`, un crée le salon, les autres le rejoignent avec le code.
- Tests auto du serveur : `cd server && npm test`.

## Trompette, flûte, barre espace et boucle (v11)

- **Trompette 🎺** : voix `MonoSynth` en dents de scie, filtre qui « s'ouvre » à l'attaque (effet cuivre) et bosse de présence vers 1,8 kHz.
- **Flûte 🪈** : sinus presque pur, vibrato lent et petit souffle de bruit filtré. Joue une octave plus haut que le piano par défaut.
- Les deux sont dans la bibliothèque, ont des réglages **Octave** et **Volume**, et fonctionnent avec tous les modes, zooms, subdivisions et la boucle.
- **Barre espace** : une pression = une action (touche maintenue ignorée, 120 ms mini entre deux bascules, désactivée dans les champs de texte). Cause du bug « plus d'espace après le tempo » : le curseur de tempo gardait le focus et l'ancien code ignorait tout `<input>`, même un curseur.
- **Démarrage/pause rapides** : un jeton (`playToken`) annule un démarrage devenu obsolète, ce qui évite un moteur audio désynchronisé.
- **Boucle** : la composition entière se répète sans fin tant qu'on n'a pas fait pause ou stop.
