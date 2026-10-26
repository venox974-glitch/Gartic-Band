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

## Téléphone et tablette (v11b)

- **Un tap pose une note, un glissement fait défiler** la grille (défilement natif du téléphone, avec inertie). Les notes se déplacent et s'allongent toujours au doigt ; le clavier à gauche joue la note touchée.
- **Boutons d'au moins 44 px** sur écran tactile, champs de texte à 16 px (évite le zoom automatique d'iOS).
- **Outils de grille et de zoom repliés** sur petit écran : le bouton « ⚙️ Outils » les déplie. Le choix du mode (Baby / Débutant / Expert) reste visible.
- **Mode paysage** : le piano-roll occupe toute la hauteur de l'écran.
- Test automatique : `test_v25.py` (émulation tactile 390×844, 360×640 et 844×390). Le défilement tactile réel et le son sur iPhone/Android sont à vérifier sur un vrai appareil.

## Refonte v12 : salon, phases, préparation, sons importés

- **Salon** : colonne « Modes de jeu » (BUILD UP actif, 3 autres « En préparation »), joueurs avec présence, réglages cliquables (vitesse des phases avec préréglages Rapide/Normal/Tranquille + durées personnalisées, boucle, joueurs max). Seul l'hôte modifie ; tout est synchronisé.
- **Phases** : Salon → Idée (1 seule, non modifiable) → Vote (tu ne vois que les idées des autres, vote définitif, tirage au sort à 2 joueurs ou en égalité) → Préparation (BPM, instrument, difficulté Baby/Débutant/Expert ; valeurs par défaut si le chrono expire) → Composition BUILD UP → Révélation. Le chrono est un MAXIMUM : on avance dès que tout le monde a terminé. En ligne, le serveur décide (js/phases.js partagé).
- **Piano-roll** plus grand ; un clic/tap = une note (maintenir ne pose plus rien de plus) ; déplacer/redimensionner conservés.
- **Pendant la composition** : sélecteurs compacts de difficulté et d'instrument, notes conservées.
- **Mes sons** : importés depuis la préparation (WAV/MP3/OGG, IndexedDB). La hauteur change SANS changer la vitesse (js/pitch.js : étirement WSOLA + rééchantillonnage). Qualité très bonne à ±7 demi-tons, correcte à ±12, métallique au-delà (jusqu'à +23) ; les percussions peuvent perdre un peu d'attaque (réglage « toujours l'original »).
- L'instrument synthétique personnalisé a été retiré (les sons importés restent).
- Tests : `cd server && npm test` (serveur, règles, phases, hauteur).

## Logo animé : le groupe de touches de piano
Le groupe est dans `index.html` (`<div class="band">`) : un personnage défini une fois (`<symbol id="key-char">`) et réutilisé 5 fois, chacun avec sa couleur (`--c`), son décalage de clignement (`--d`) et son inclinaison (`--r`). L'animation des yeux est `keyBlink` dans `css/style.css`. Les SVG sources sont dans `assets/` (`key-character-v3-hat.svg` = la version actuelle avec chapeau ; le chapeau est le `<symbol id="key-hat">`, posé pour l'instant sur le personnage du milieu seulement).

## Mon personnage (couleur + chapeau)
Bouton « 🎨 Mon personnage » sur l'accueil → page de personnalisation (8 couleurs, sans chapeau ou casquette à hélice), enregistrée dans le navigateur (`gartic-bande.avatar.v1`). Code : `js/avatar.js` (choix + dessin) et `js/avatar-ui.js` (page). Pour ajouter un chapeau : l'ajouter dans `HATS` (`js/avatar.js`) et ajouter son dessin `<symbol id="key-hat-NOM">` dans `index.html` (comme `key-hat-propeller`). Le rouge du jeu est `--red` (#d4145a) ; l'orange a été retiré.

## Ajouter tes propres chapeaux (sans toucher au code)
Dossier `hats/` : mets-y ton chapeau en SVG (canevas 1080×1080, personnage de `hats/modele-chapeau.svg` comme guide, à cacher avant l'export), puis ajoute une ligne dans `hats/hats.js` (le mode d'emploi est en commentaire dans ce fichier). Il apparaît dans « Mon personnage ».

### Placer un chapeau et couper le clignement
Dans `hats/hats.js`, une ligne de chapeau accepte `x`, `y` (décalage), `scale` (taille) et `blink: false` (pas de clignement des yeux). Plus simple : dans « Mon personnage », choisis le chapeau, ouvre « 🛠 Placer ce chapeau », règle avec les flèches et copie la ligne générée.

## Personnages dans le jeu (v13)

- Les anciens emojis de joueurs sont remplacés partout (salon, préparation, barre des joueurs, pistes, révélation) par le personnage choisi : couleur + chapeau.
- En ligne, chaque joueur envoie sa couleur et son chapeau en créant/rejoignant un salon ; le serveur les vérifie et les renvoie à tous.
- Les bots ont des personnages fixes.

## Verrouillage de l'emplacement des chapeaux

Dès qu'une ligne de `hats/hats.js` contient `x`, `y` ou `scale`, l'outil de réglage est **verrouillé** pour ce chapeau (🔒). Pour le régler de nouveau, supprime ces valeurs de la ligne. Une ligne sans position (ex. `wizard`) reste réglable.

## Version 13 — mise à jour qualité de vie : éditeur (sélection, longueur mémorisée, survol)

- **Sélection par boîte** : à la souris, maintiens le clic sur une case vide et glisse. Les notes touchées par la boîte sont sélectionnées (contour bleu). **Maj + clic** sur une note l'ajoute à la sélection (ou la retire) sans l'effacer ; **Maj + glisser** ajoute à la sélection existante. **Échap** désélectionne, **Suppr** efface les notes sélectionnées.
- Un simple clic sur une case vide pose une note (au relâchement du bouton) ; un clic sur une note l'enlève toujours.
- `GB.ui.getSelection()` donne `{ trackId, noteIds }` : base prévue pour un futur copier-coller.
- **Longueur mémorisée** : quand tu allonges ou raccourcis une note, les prochaines notes posées sur cette piste prennent la même longueur.
- **Survol** : la case qui s'allume a la taille de la grille choisie (temps, ½, ¼…), pas celle du quart de temps.

### Copier-coller de notes (v13.2)

Sélectionne des notes (boîte ou Maj + clic), **Ctrl + C** pour les mémoriser, puis place la souris sur la grille et **Ctrl + V** : les notes sont collées **identiques** (même hauteur, même durée, même voyelle) ; seule leur position horizontale change : la première (la plus à gauche) tombe sous la souris (alignée sur la grille, Alt = libre) et les autres gardent leur écart de temps. La hauteur de la souris ne compte pas. Les notes collées deviennent la sélection (tu peux recoller ailleurs). Une note qui n'a pas de place (case occupée, hors de la grille, ligne « hors mode ») est ignorée. La mémoire de copie sert aussi d'une piste à l'autre. (Cmd au lieu de Ctrl sur Mac.)


## Version 14 — Mes instruments (synthé personnalisé)

Le créateur d'instruments est de retour, avec beaucoup plus de liberté (fichiers : `js/synth.js`, `js/synth-ui.js`, moteur `custom` dans `js/audio.js`).

- **Où le trouver** : page de préparation (« 🎛 Créer mon instrument ») et sélecteur d'instrument de l'éditeur (« 🎛 Créer / modifier mes instruments… »). Sur la carte d'un de tes instruments, ✏️ le modifie.
- **Son de base** : sinus, triangle, carré, scie ou **forme dessinée** (16 barres d'harmoniques à tirer à la souris/au doigt, avec des modèles : orgue, nasal, cloche, hasard).
- **Deuxième onde** (forme, quantité, octave, désaccord) et **voix épaisses** (jusqu'à 5 ondes désaccordées).
- **Enveloppe complète** (attaque, déclin, tenue, relâchement) et **filtre** (grave, aigu, bande) avec coupure, résonance et balayage « wah ».
- **Mouvement** : vibrato et trémolo (profondeur + vitesse). **Effets** : chorus, distorsion, écho, réverbération.
- 🎲 « Au hasard », 📄 « Dupliquer », 🗑 « Supprimer ». Jusqu'à 24 instruments par navigateur (enregistrés dans le navigateur).
- **En ligne** : l'instrument voyage avec les contributions ; les autres joueurs l'entendent et ne l'ajoutent pas à leur liste. Son identifiant est calculé à partir de ses réglages (modifier un instrument en crée donc une nouvelle version ; les couches déjà faites gardent leur son). Le **serveur vérifie** que l'identifiant correspond bien aux réglages et renvoie la version nettoyée.
- Pour ajouter un réglage : une ligne dans `FIELDS` de `js/synth.js` + son usage dans `CustomVoice` (`js/audio.js`). L'éditeur se met à jour tout seul.

## Éditeur v14.1 : glisser une sélection

Quand plusieurs notes sont sélectionnées (boîte ou Maj + clic), **attraper l'une d'elles et glisser déplace toute la sélection** :
- la note attrapée mène, les autres gardent le même écart de temps et de hauteur ;
- la sélection ne sort jamais de la grille (elle s'arrête au bord) et ne se pose jamais sur une note qui n'en fait pas partie (rien ne bouge si ça touche) ;
- un repère en pointillés marque l'ancienne place de chaque note ; si le geste est interrompu, tout revient en place ;
- un simple clic sur une note sélectionnée ne l'efface plus (un clic dans le vide défait la sélection) ;
- sans sélection, une note seule se glisse comme avant. L'allongement par la poignée reste pour une note à la fois.

**v14.2** : en mode Baby/Débutant, la sélection se déplace **de lignes du mode en lignes du mode** (les notes ne tombent plus sur des lignes « hors mode » en descendant ou en montant). Les notes déjà hors mode gardent leur écart brut.

## v14.3 : aperçu avant de contribuer + notes fantômes

- **Aperçu** : au début de ta composition, quand la chanson contient déjà des couches (round 2 et suivants), la vue « couches » s'affiche à la place du piano-roll avec « 👀 Voici ce qui existe déjà », un bouton **▶ Écouter / ⏸ Pause** et un bouton **✏️ Contribuer** qui ouvre le piano-roll. C'est de l'affichage seulement : pas de nouvelle phase, aucun chrono ni message réseau en plus (le chrono du round tourne comme avant). Round 1 : pas d'aperçu.
- **Notes fantômes** : dans le piano-roll, les notes des autres couches apparaissent en transparence derrière tes notes (même famille de lignes : mélodie avec mélodie, batterie avec batterie ; la voix micro n'en a pas). Elles ne se cliquent pas, ne se déplacent pas, ne se copient pas et ne sont jamais enregistrées dans ta couche. Seulement en partie (pas en studio solo).

## v15 : nouvel accueil (pack direction artistique)

- **Mise en page** : à gauche « TON PERSO » (ton personnage avec sa couleur et son chapeau, immobile, sans cadre, sur le violet) + bouton **Skin** ; à droite 3 cartes : **Jouer en ligne**, **Éditeur solo**, **Inventaire**. « Tester une partie » devient un lien sous les cartes ; la démo et la note restent en bas.
- **Inventaire** ouvre l'écran des chapeaux et ajoute deux boutons : **🎧 Mes sons** et **🎛 Mes instruments** (mêmes fenêtres que dans l'éditeur).
- **Logos animés** (survol ou focus clavier de la carte) : `css/home-logos.css` (classes `.cg` éditeur, `.og` en ligne, `.ig` inventaire ; les `id` `cgc`, `og-*`, `ig-*` sont uniques). Tout s'arrête avec « réduire les animations ».
- **Corrections par rapport au pack** : Inventaire — le changement de couleur se fait pile à l'atterrissage du chapeau (plus de passage par un marron-gris), le perso est un peu plus petit/bas (le chapeau sorcier ne frôle plus l'anneau), l'hélice touche la tête ; En ligne — l'éclat est plus grand (il était caché derrière les mains) et les confettis, plus gros, volent plus loin.

## v15.1 — Accueil sans scroll
- Les trois logos de cartes ont maintenant exactement la même taille, et les trois cartes la même hauteur (variables CSS `--logo-s` et `--card-h`, calculées selon la hauteur de l'écran).
- Tout l'accueil (logo, cartes, « Ton perso », liens) tient dans l'écran sans scroll sur ordinateur (testé de 1024×700 à 1920×1080) et sur un téléphone 390×844. Sur un très petit écran (360×640) il reste un peu de scroll.

## v15.2 — « Ton perso » plus grand
- Le perso (colonne de gauche) grandit avec la hauteur de l'écran (jusqu'à ~17 rem) ; la colonne et les cartes prennent plus de largeur (1180 px max). Cartes et logos grandissent aussi sur grand écran.
- Sur téléphone : perso plus gros, la phrase d'accroche est masquée pour garder l'accueil sans scroll.

## v16 — Skin et Casier séparés, fond fixe, plus d'ajustement de chapeau
- **Fond** : le dégradé est maintenant sur `<html>` en `fixed` (avant, il était sur `<body>` et s'arrêtait à la hauteur de la fenêtre quand on défilait). Il couvre tout l'écran au scroll et au redimensionnement.
- **Ajustement de chapeau supprimé** : panneau « Placer ce chapeau », boutons, `GB.avatar.tune()`, `configLine()`, le verrou et le CSS associé. Les chapeaux (hats/hats.js) et leur affichage restent ; les réglages x / y / scale / blink se font dans `hats/hats.js`.
- **Skin** (bouton de l'accueil) : apparence seulement — aperçu, couleur, chapeau. Données : `GB.avatar` (`gartic-bande.avatar.v1`).
- **Casier** (carte de l'accueil, ex-« Inventaire », `js/locker.js` + `js/locker-ui.js`) : A. sons importés et instruments créés ; B. sons du jeu (par packs) ; C. chapeaux possédés (lecture seule). Chaque son est **Équipé** ou **Dans le casier**. Seuls les sons équipés sont proposés dans l'éditeur et la préparation de partie ; un son déséquipé déjà utilisé par une piste reste joué (et affiché pour cette piste). On ne peut pas déséquiper le dernier son.
- **Pas de doublon de données** : « possédé » vient des registres existants (instruments, sons importés, synthés, chapeaux). Le casier ne stocke que la liste des sons déséquipés (`gartic-bande.locker.v1`) : tout est équipé par défaut, donc rien ne change pour les joueurs existants.
- **Prêt pour la suite** : packs = ajouter un objet à `GB.SOUND_PACKS` ; presets = `{ skin: GB.avatar.get(), sounds: GB.locker.exportEquipment() }` avec `GB.locker.applyEquipment()` déjà là. Pas d'achat ni de preset implémentés.

## v17 — Outils d'édition, actions sous la sélection, Pause mobile
- **Barre d'outils** au-dessus du piano-roll (toujours visible, aussi sur téléphone) : **✏️ Crayon** (par défaut) et **🖱️ Sélection**, état actif visible. Les raccourcis clavier (Suppr, Échap, Ctrl + C / V, Maj + clic, Espace, Alt…) et la zone tracée à la souris avec le Crayon fonctionnent comme avant.
- **Crayon** : comme avant (clic = note, poignée de droite = durée). Au toucher, la poignée a une zone de toucher plus large et un 2e doigt ne déclenche rien.
- **Sélection** (souris et doigt) : toucher une note la sélectionne (au doigt, chaque tap ajoute / retire une note) ; tracer une zone choisit les notes touchées ; glisser une note choisie déplace tout le groupe (code de v14.1/14.2) ; un tap dans le vide défait la sélection sans poser de note. Les notes choisies ont un contour bleu.
- **Barre d'actions** sous la sélection (au-dessus si le bas manque de place, toujours dans la zone visible, elle suit le déplacement, le défilement et le zoom) : **🗑️ Supprimer** et **📋 Copier / Coller**. Copier / Coller crée de **nouvelles** notes juste après la dernière note de la sélection, sur la grille choisie ; si la place est prise, le groupe glisse d'un pas de grille jusqu'à tenir sans rien écraser ni raccourcir. Les copies sont sélectionnées, les originales ne bougent pas.
- **Pause mobile** : bouton ⏸ Pause / ▶ Reprendre, affiché seulement si l'appareil est tactile (`(hover: none) and (pointer: coarse)`, pas la largeur de fenêtre). Il appelle la même fonction que le bouton Lecture et la barre espace (la position n'est pas remise à zéro).
- **Limite connue** : avec l'outil Sélection, la grille ne défile plus au doigt (le glissement trace la zone) ; repasse au Crayon, utilise la barre de défilement ou « Suivre » pour te déplacer.
- **Speech to Note** : NON implémenté. Étude dans `SPEECH-TO-NOTE.md`.

## v17.1 — Vue horizontale (téléphone en paysage)
S'applique quand l'écran est en paysage et fait au plus 520 px de haut (`@media (orientation: landscape) and (max-height: 520px)`).
- **Éditeur** : toute la fenêtre est utilisée, la page ne défile plus. Une seule ligne d'outils (Crayon / Sélection, modes, 🧹, ⚙️ Zoom) ; la barre du haut est compacte (🏠 et ↺ en icônes). Le panneau des pistes est replié au départ (☰ pour l'ouvrir). La grille occupe environ 60 à 65 % de la hauteur (avant : 150 px, après deux écrans de défilement). Le bouton Pause mobile est masqué dans cette vue, car le bouton Lecture / Pause de la barre du haut est toujours visible.
- **Accueil** : deux colonnes, logo et « Ton perso » à gauche, les trois cartes à droite, sans défilement.
- Cette vue s'applique aussi à une fenêtre d'ordinateur très basse (≤ 520 px de haut).

## v18 — Version mobile paysage fidèle au concept + Annuler / Rétablir
- **Accueil (paysage)** : en haut à gauche la petite marque (un personnage + « GARTIC BANDE » sur une ligne), dessous « Ton perso » en grand avec le bouton Skin ; à droite les trois cartes. Sans défilement.
- **Éditeur (paysage)** : barre du haut sur une ligne, la grille prend toute la largeur et toute la hauteur, et une **palette verticale à droite** (2 colonnes) : ✏️ Crayon · 🖱️ Sélection · 📋 Copier / Coller · 🗑️ Supprimer · 🔍 Grille et zoom · 🎼 Instrument / difficulté / effacer · ↶ Annuler · ↷ Rétablir (+ ✅ Prêt en partie). 🔍 et 🎼 ouvrent un panneau par-dessus la grille (un seul à la fois). Copier / Coller et Supprimer ne s'activent que s'il y a une sélection.
- **Annuler / Rétablir** (nouveau, aussi dans la barre d'outils portrait / ordinateur, et Ctrl + Z / Ctrl + Maj + Z ou Ctrl + Y) : concerne les notes de la piste affichée (poser, effacer, déplacer, allonger, copier, supprimer, effacer tout). 60 pas par piste ; une nouvelle action vide « Rétablir » ; changer d'instrument ou recommencer repart d'un historique vide. Ne concerne pas les enregistrements de voix ni les réglages.
- Les cases « ? » du concept sont remplies avec les actions existantes (Copier / Coller, Supprimer, Grille et zoom, Instrument / difficulté).

## v19 : plus aucun émoji, plus de mode vertical

- **Icônes** : tous les émojis de l'interface sont remplacés par des icônes SVG au même style (`js/icons.js`, `GB.icons.svg/el/set`). Dans `index.html` : `<i class="ic" data-i="play"></i>`. Pour ajouter une icône : ajouter une ligne dans l'objet `P` de `js/icons.js`.
- Les icônes d'instruments (`icon` dans `GB.INSTRUMENTS`, choix « Icône » de l'éditeur d'instrument, packs du casier, modes de jeu) sont maintenant des **noms d'icônes** (`'piano'`, `'drum'`…).
- **Anciens instruments créés** : leur ancien émoji est converti automatiquement en icône, et leur identifiant ne change pas (l'empreinte utilise toujours l'ancien émoji, voir `LEGACY_ICONS` dans `js/synth.js`).
- Gardés volontairement : ♯ et ♭ (notation musicale), ▲ ▼ (octave), « · » et « − + ». Ce ne sont pas des émojis.
- Les avatars-émojis des personnages (`avatar` dans `bots.js` / `server/rooms.js`) sont vidés : l'affichage utilisait déjà le skin.
- **Mode vertical retiré** : sur téléphone (écran tactile, largeur ≤ 820 px) tenu à la verticale, un écran « Tourne ton téléphone » couvre le jeu. Le paysage reste inchangé. Les fenêtres étroites d'ordinateur et les tablettes larges ne sont pas concernées. Le bouton Pause « mobile » (réservé au vertical) est masqué en paysage.

## v20 : tes icônes d'instruments + chapeau Piano Bros

- **Icônes d'instruments en couleur** : tes SVG sont dans `assets/instruments/` et intégrés au jeu (`js/icons-instruments.js`, généré depuis ces fichiers ; noms `ins-piano`, `ins-synth`, `ins-bass`, `ins-lead`, `ins-drums`, `ins-trumpet`, `ins-flute`, `ins-vox`, `ins-mic`, `ins-custom`, `ins-sample`). Le dégradé de `flute.svg` est remplacé par un aplat (un dégradé « par id » peut disparaître quand l'icône est dans une zone cachée).
- Les instruments créés par le joueur (icône par défaut) utilisent `custom.svg` ; les autres icônes du choix « Icône » restent des pictos simples. Les sons importés utilisent `sample.svg`.
- **Chapeau « Piano Bros »** (`hats/hats.js`, id `bros`) : la casquette et son bord prennent la couleur du skin ; le disque blanc et les contours restent fixes. Il est dessiné « en ligne » (option `markup` avec `fill="var(--c)"`) ; `hats/bros.svg` garde la version d'origine (orange).

## v21 : barre d'outils unique, outil BPM, Smart BPM, pincement

- **Une seule barre d'outils** (`#dock`, `js/dock.js`) pour tous les appareils : Crayon, Sélection, Copier/Coller et Supprimer (visibles quand une sélection existe), Annuler/Rétablir, Lecture (tactile seulement), BPM, Smart BPM, Précision de grille, Zoom, Octaves, Instrument/Difficulté, Épingle.
  - Écran tactile (détecté par `pointer: coarse` / `hover: none` ou par un vrai toucher, pas par la largeur) : barre **verticale** à droite, grosses cibles.
  - Souris : barre **horizontale** en bas, infobulles. Raccourcis clavier inchangés.
- **Épingle** : barre désépinglée = elle se range, la grille prend la place, une petite poignée la ramène. Elle ne réapparaît pas toute seule. Le choix est gardé dans `localStorage` (`gartic-bande.dock.v1`).
- **Menus** (BPM, grille, zoom, octaves, instrument) : s'ouvrent à côté du bouton sans quitter le piano-roll ; Échap ou un toucher ailleurs les ferme.
- **Outil BPM (avec Smart BPM dedans)** : −5/−1/+1/+5, saisie numérique (60–180). Les notes gardent leurs positions musicales ; la lecture, la boucle et la barre d'espace continuent de marcher. Verrouillé en partie (le tempo est fixé à la préparation).
- **Smart BPM** : fenêtre dédiée (plein écran sur téléphone). On tape le rythme, le calcul (`js/bpm-tap.js`, testé dans `server/test-bpm.js`) utilise les intervalles entre appuis (horloge monotone `event.timeStamp`), ignore les doubles taps et les écarts aberrants, propose ×2 / ÷2 seulement si plausible. « Utiliser ce BPM » applique ; fermer ne change rien. Tout est local (pas de micro, pas de serveur).
- **Précision de grille** 1/4, 1/8, 1/16, 1/32 : ne déplace aucune note.
- **Octaves** : change seulement la plage visible, ne transpose rien.
- **Pincement à deux doigts** sur la grille (zoom avec ancrage, bornes min/max), sans poser ni déplacer de note.
- Le message « Rotation » ne s'affiche plus que sur les petits téléphones en portrait (≤ 600 px) ; les tablettes en portrait ont la barre verticale.

- v21.2 : icônes trompette, basse et piano mises à jour ; nouveaux chapeaux Chapeau bizarre, Casque audio (avec calque arrière `backFile`) et Hollow.

## v22 : Speech to Note (chanter, les notes apparaissent en direct)

Outil **micro** (bouton « Voix » de la barre d'outils). Fichiers : `js/stn-core.js` (calcul, testé par `server/test-stn.js`), `js/stn.js` (micro, capture, calibrages, fenêtre).

**Comment ça marche**
1. Clic sur l'outil : le navigateur demande le micro (jamais avant). Refus ou micro absent : message clair, retour à l'éditeur.
2. Fenêtre de préparation : durée (10–60 s), compte à rebours (aucun/3/5 s), alignement sur la grille (facultatif, avec choix de la précision : celle de l'éditeur, 1/4, 1/8, 1/16 ou 1/32 ; deux attaques dans la même case passent à la case suivante, jamais fusionnées), compensation de latence, décalage d'octave (explicite), calibrages.
3. « Démarrer » : compte à rebours (le bruit de fond est mesuré pour régler le seuil de voix), puis la lecture démarre depuis la barre de lecture et l'analyse commence au même instant. Seul un bandeau reste affiché (temps restant, niveau, hauteur détectée, nombre de notes, Arrêter / Annuler).
4. Les notes sont de **vraies notes** de la piste (même système que le crayon) : elles s'allongent pendant que tu tiens la note, se terminent quand tu t'arrêtes ou changes réellement de hauteur, et restent éditables (déplacer, redimensionner, supprimer, copier). Toute la session = un seul « Annuler ».
5. La capture s'arrête toute seule à la fin du temps **ou à la fin de la boucle** (une seule passe : pas de superposition de tours). Le BPM n'est jamais modifié.

**Détection** : YIN (autocorrélation normalisée, interpolation parabolique), maintenue sans bibliothèque. Une seule voix (monophonique). Stabilisation : médiane sur 3 trames, seuil de confiance, 25 ms (2 trames) pour déclencher une note, 70 ms (150 ms pour un saut d'octave) pour accepter un vrai changement, notes < 60 ms jetées. **Même note répétée** (« ta ta ta ») : un creux de volume (sous 60 % du niveau de la note) suivi d'une remontée = nouvelle note, même sans changement de hauteur. Une note déjà commencée accepte des trames un peu moins nettes (confiance 0,55 au lieu de 0,72) pour ne pas être coupée. Tous ces seuils sont en tête de `stn-core.js` (`DEFAULTS`) ; la durée, le compte à rebours, etc. en tête de `stn.js` (`SETTINGS`).

**Calibrage du micro** (par micro, gardé dans `localStorage`, clé `gartic-bande.stn.v1`) : 10 repères, les 2 premiers pour l'échauffement ; méthode sonore (clics) ou visuelle (boule vers une ligne). Médiane des décalages après retrait des mesures aberrantes ; fiabilité bonne/moyenne/faible selon la cohérence ; avertissement si les sons collent aux clics (écho des haut-parleurs). C'est un décalage GLOBAL (réaction humaine comprise), borné à ±400 ms, désactivable.
**Calibrage vocal** : 2 notes de référence (3e sur demande), plage grave/moyenne/aiguë. Affiche référence, note détectée, écart en cents, fiabilité. Un décalage d'octave n'est proposé que s'il est identique sur au moins 2 notes, et seulement comme option à activer.

**Limites connues** : une voix à la fois ; erreurs d'octave possibles (sons soufflés, très graves) ; au-delà d'environ Do♯6 ou sous Do♯2 rien n'est suivi ; la musique du jeu dans le micro trompe l'analyse (utiliser un casque) ; la précision temporelle est de l'ordre de 30–50 ms ; les notes hors des 36 lignes (Do3–Si5) sont ramenées d'une ou plusieurs octaves ; en mode Baby/Débutant la note est posée sur la ligne autorisée la plus proche ; une note ne peut pas être posée sur une case déjà occupée (elle est ignorée et comptée dans le message de fin).

## v23 : moteur Speech to Note corrigé (attaques, notes répétées, diagnostic)

**Causes trouvées (dans le code v22)**
- Une nouvelle note n'était détectée qu'à partir des *trames de hauteur* (25 ms) + un creux de volume : l'instant réel de l'attaque était perdu (notes décalées d'environ 50 ms), et des « ta » rapides (170 ms) fusionnaient.
- La hauteur était figée sur les 2 premières trames : un « scoop » d'attaque (début un peu trop bas) créait **deux** notes.
- Aucune raison n'était gardée pour savoir pourquoi une note naissait ou finissait.

**Ce qui a changé** (`js/stn-core.js`, `js/stn.js`)
- Nouveau détecteur d'attaques (`createAttackDetector`) sur des blocs de 256 échantillons (≈ 5 ms) : montée d'énergie (dB) + flux spectral + éclat de hautes fréquences (le « t »). Un creux trop court (< 24 ms) n'est pas un silence entre deux notes ; un crescendo ou un vibrato ne déclenche rien.
- Une attaque ne crée une note que si une **hauteur fiable** suit (la voyelle). Un bruit de consonne ou de bouche seul est ignoré (`attack-dropped`). La note commence à l'instant de l'attaque.
- Petite correction de hauteur au début d'une note (≤ 2 demi-tons, 140 ms) : la **même** note est déplacée, pas de seconde note.
- Fin de note : silence continu (55 ms), ou son sans hauteur (souffle) ; jamais sur une simple variation de volume ni sur un vibrato.
- Chaque début/fin a une raison (`attaque`, `hauteur`, `changement de hauteur`, `silence`, `nouvelle attaque`…).
- Réglages dans la fenêtre « Voix » : **Sensibilité aux attaques** (basse / normale / haute) et **Écart minimal entre deux notes** (60 à 200 ms).
- **Diagnostic** (case dans la fenêtre « Voix », ou `?stndebug=1` dans l'adresse) : fréquence, MIDI, note stabilisée, niveau en dBFS, confiance, attaques, débuts/fins de notes avec la raison. Désactivé par défaut.
- Les notes déjà présentes ne sont jamais modifiées : la session ne touche que ses propres notes (identifiants stables), « Annuler la session » ne supprime que celles-là.

**Tests**
- `node server/test-stn.js` : 68 tests (signaux synthétiques : note tenue, ta ta ta ta, la la la la, montée, descente, alternance rapide, vibrato, silence, bruit de bouche, durées variées, conversions Hz→MIDI→ligne).
- `test_v38_stn` (navigateur, micro simulé par fichiers WAV) : notes préexistantes intactes, annulation, ta/la répétés, montée/descente, bruit de bouche, alignement note ↔ nom de note avec zoom X/Y et octave.

**Limites restantes (à valider avec un vrai micro)**
- Tout a été testé avec des sons synthétiques : une vraie voix, un vrai micro et le bruit d'une vraie pièce peuvent demander d'ajuster la sensibilité.
- Des « la la » très liés (sans aucun creux de volume) restent pris pour une seule note ; sur nos « la » synthétiques, 11 attaques sur 13 environ sont retrouvées.
- Un changement de hauteur très rapide (note de 130 ms) est découpé avec un léger retard (≈ 70 ms).
- Une coupure de moins de 24 ms dans une note ne la sépare pas.

### v23.1 : réglages après test sur un vrai fredonnement
- La hauteur de référence d'une note est maintenant la moyenne suivie de la voix (et non l'entier arrondi) : une dérive de ±0,8 demi-ton ne coupe plus la note (seuil de changement 0,85 demi-ton).
- Une mesure peu sûre (confiance < 0,85) ne peut plus déclencher seule un changement de hauteur ; après une attaque, les hauteurs doivent s'accorder entre elles (évite les fausses notes d'octave).
- Temps laissé à la voyelle après une attaque : 220 ms (fredonner « mm » démarre doucement) ; fenêtre de correction de hauteur en début de note : 220 ms.
- Erreur d'harmonique corrigée (`detectPitch`) : une voix grave dont le 5e harmonique domine (mesuré sur un enregistrement réel, voix ≈ 123 Hz lue à ≈ 615 Hz) est maintenant ramenée à sa fondamentale. Réservé aux creux médiocres, pour ne pas abaisser les notes pures. Test ajouté dans `test-stn.js` (69 tests).

## v24 (étape 1 du mode Phone) : registre des modes de jeu

Aucun changement visible pour les joueurs : BUILD UP reste le mode par défaut et se joue exactement comme avant.

- Nouveau `js/modes.js` : registre unique des modes, partagé par le navigateur et le serveur. Chaque mode déclare son nom, son icône, s'il est jouable (`available`), s'il se joue en ligne et/ou hors ligne, son nombre de joueurs et la durée recommandée d'un round.
- Le serveur n'accepte que les modes jouables du registre (`server/rooms.js`) ; le salon (`js/lobby-ui.js`) affiche la liste du registre. Phone y apparaît déjà, « En préparation » (3 à 8 joueurs, en ligne seulement, rounds de 5 min).
- Tests : `node server/test-modes.js` (15 tests) et `test_v39_modes` (navigateur : liste des modes, Phone désactivé et sans effet au clic).

Prochaines étapes prévues : module partagé micro + calibration et roue dentée sur l'accueil, stockage des voix sur le serveur, maillons multipistes et rounds de Phone, interface, tests.

## v25 (étape 2 du mode Phone) : réglages du micro partagés + roue dentée Paramètres

- **`js/mic-prefs.js`** : la compensation de latence de chaque micro est maintenant gérée à un seul endroit (clé `gartic-bande.mic.v1`, dans le navigateur du joueur). Speech to Note l'utilise, ainsi que le nouveau panneau et, plus tard, l'enregistrement de la voix de Phone. Les calibrages déjà faits avec Speech to Note sont repris automatiquement (l'ancienne clé n'est pas effacée).
- **Roue dentée sur l'accueil** (en haut à droite) : panneau Paramètres avec l'état du micro, la liste des micros connus (nom, décalage, méthode, fiabilité, date), l'interrupteur de compensation et un bouton « Oublier ».
- **Pastille rouge sur la roue** tant qu'aucun micro n'a été vraiment calibré. La vérification se fait sans demander l'accès au micro. Un réglage saisi à la main ne compte pas comme un calibrage.
- **« Calibrer mon micro »** ouvre la fenêtre de Speech to Note en mode « calibrage seul » (sans piste ni bouton Démarrer), puis les Paramètres se rouvrent à jour.
- Correction : une saisie manuelle identique à la valeur déjà enregistrée ne transforme plus un calibrage mesuré en réglage « manuel » ; la fenêtre de Speech to Note se met à jour quand le calibrage change ailleurs.
- Tests : `node server/test-micprefs.js` (18) et `test_v40_settings` (navigateur, 23 : roue, pastille, calibrage seul, persistance, migration, téléphone en paysage).

## v26 — Écran de calibrage simple, roue crantée, instrument micro refait

- **Calibrage audio simple** (écran à part, pas celui du Speech to Note) : Accueil → roue crantée → « Calibrer mon micro ». 10 flashs + clics, le résultat est enregistré automatiquement (ou « À vérifier » si le micro capte le haut-parleur).
- Icône de la roue remplacée par un vrai engrenage (8 dents).
- **Instrument micro** : le bouton principal est « Enregistrer sur la boucle ». Pendant l'enregistrement, le curseur de la timeline avance et le bloc rouge de ta voix se dessine en direct (barres blanches = volume). À la réécoute, le curseur suit aussi l'extrait.
- Un bandeau jaune rappelle de calibrer le micro tant que ce n'est pas fait.
- À valider sur vrais appareils : calibrage réel, synchro voix/boucle, Safari/iPhone.

## v27 — Mode PHONE (téléphone arabe musical, en ligne seulement)

**Comment ça se joue** : une chaîne par joueur. Round 1 : écrire un titre de chanson connue → composer au piano-roll **sans chanter** (plusieurs pistes) → chanter a cappella (enregistré sur la boucle, plusieurs pistes) → recopier la voix au piano-roll (Speech to Note permis) → … en alternant → dernier round : **deviner la chanson**. Chacun ne voit que le maillon précédent de SA chaîne ; tout se révèle à la fin, maillon après maillon (l'hôte fait défiler).

- Dans le salon : choisir « Phone » (3 à 8 joueurs). Réglages : nombre de rounds (3 minimum, « Tous » = autant que de joueurs), durée de composition (5 min conseillées) et de chant (2 min par défaut). Écrire et deviner : 60 s. Dès que tout le monde est prêt, on passe à la suite.
- Les voix partent au serveur en HTTP (WAV, même route que les sons importés), restent **en mémoire** jusqu'à « Terminer la partie » (ou la disparition du salon), puis sont effacées.
- Joueur absent ou trop lent : maillon vide ; le suivant est prévenu (« maillon manquant ») et peut choisir librement.
- Instrument micro : on n'enregistre plus que « sur la boucle », avec compte à rebours 3-2-1.
- Fichiers : `js/phone.js` (règles partagées), `server/phone-room.js` (serveur), `js/phone-ui.js` (écrans). Tests : `server/test-phone.js` (74).
- À valider sur de vrais appareils : plusieurs téléphones/ordinateurs réels, micro réel (calibrage), casque, Safari/iPhone, réseau lent (envoi des voix).

## v28 — Phone : voix → notes → voix

- Déroulement : **écrire une chanson / idée / thème** → **chanter a cappella dessus** (idée affichée en énorme au-dessus de l'éditeur) → **recopier la voix au piano-roll** → **chanter de mémoire** (on écoute d'abord les notes miniatures, puis plus moyen de les revoir) → … → **deviner**.
- Consigne géante au-dessus du piano-roll ; compte à rebours 3-2-1 géant avec bips (aigu au départ).
- Révélation façon SMS : bulle « … » puis message, notes/ondes miniatures qui s'allument pendant la lecture.
- Calibrage : case « J'ai un casque » ; sans casque, une boule rebondit et il faut dire « ta » quand elle touche la ligne (aucun son joué).
- Voix enregistrées : 32 kHz, rééchantillonnage sans repliement, niveau normalisé (qualité à écouter sur vrai appareil).
- Tests : `cd server && npm test`.
