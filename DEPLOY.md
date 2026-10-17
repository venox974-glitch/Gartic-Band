# 🚀 Mettre Gartic Bande en ligne — guide pour débutant (Windows 11 + PowerShell)

> **Ce que ce guide fait, et ne fait pas.** Il explique comment lancer le jeu chez toi, le tester à deux, puis le
> publier pour jouer avec des amis éloignés. Le jeu et son serveur ont été testés en local (plusieurs navigateurs
> sur une même machine, vrais clients WebSocket). **Je n'ai pas pu tester un déploiement réel sur un hébergeur** :
> les étapes de la section 8 suivent la documentation de ces services (consultée le 15 octobre 2026) mais tu seras le
> premier à les essayer. Si une étape ne donne pas le résultat annoncé, va à la section 12.

---

## 1. De quoi tu as besoin

| Outil | Pourquoi | Comment vérifier (PowerShell) |
|---|---|---|
| **Node.js 18 ou plus** (toi : v24) | fait tourner le serveur | `node --version` → `v24.x.x` |
| **npm** (installé avec Node) | installe la seule dépendance du serveur (`ws`) | `npm --version` |
| Un éditeur de texte (Bloc-notes, VS Code) | modifier un fichier si besoin | — |
| **Git + un compte GitHub** (gratuit) | seulement pour publier chez un hébergeur | `git --version` |
| Un navigateur récent (Chrome, Edge, Firefox) | jouer | — |

PowerShell : clic droit sur le menu Démarrer → « Terminal ». Pour aller dans le dossier du jeu :
`cd C:\chemin\vers\gartic-bande` (glisse le dossier dans la fenêtre pour écrire son chemin).

## 2. Les fichiers : qui fait quoi

```
gartic-bande/
├── index.html, css/, js/, vendor/   LE JEU (ce que le navigateur télécharge)
├── server/                          LE SERVEUR (Node.js) : salons, thèmes, votes, rounds, sons partagés
│   ├── server.js                    démarre tout : pages du jeu + WebSocket « /ws » + envoi/téléchargement des sons
│   ├── rooms.js                     les règles : qui est dans le salon, chrono, contributions, révélation…
│   └── test-*.js                    tests automatiques (npm test)
└── DEPLOY.md                        ce guide
```

Important : le serveur lit aussi `js/rounds.js` et `js/themes.js` (les **mêmes règles** que le navigateur). Il faut donc
**toujours garder le dépôt entier** ensemble ; ne copie pas seulement le dossier `server/`.

Le serveur est la **source de vérité** : salons, codes, joueurs, pseudos, thèmes, votes, rounds, chronos, rotation,
contributions, droits de l'hôte, révélation. Le navigateur affiche et envoie des demandes ; le serveur les refuse si elles
sont interdites.

## 3. Lancer chez toi (une seule fois pour installer)

```powershell
cd C:\chemin\vers\gartic-bande\server
npm install        # télécharge « ws » (une fois). Résultat : « added … packages »
npm start          # lance le serveur
```

**Résultat attendu :** `Gartic Bande — http://localhost:8080 (WebSocket : /ws, 2 à 8 joueurs par salon)`.
Ouvre ensuite **http://localhost:8080** dans le navigateur. Laisse la fenêtre PowerShell ouverte (Ctrl+C pour arrêter).

**Si le port 8080 est déjà pris** (erreur `EADDRINUSE`) :

```powershell
$env:PORT=8090; npm start     # puis ouvre http://localhost:8090
```

**Vérifier que tout est bon :** `npm test` dans `server/` doit afficher trois lignes `100/100 OK`, `47/47 OK`, `29/29 OK`.

## 4. Relier le jeu au serveur

- **Cas simple (recommandé) :** tu ouvres le jeu **depuis le serveur** (`http://localhost:8080`). Le jeu se connecte tout seul
  au même endroit (`ws://` en local, `wss://` si la page est en HTTPS). Rien à configurer.
- **Si le jeu est hébergé ailleurs** (par exemple une page statique) : sur l'écran « Salon privé », saisis l'adresse du serveur
  (`https://mon-serveur.example.com` ou `wss://mon-serveur.example.com/ws`). Côté serveur, mets la variable
  `ALLOWED_ORIGINS` (section 6) avec l'adresse de la page.
- Ouvrir `index.html` en double-cliquant marche pour le **solo** et le **mode test local**, mais **pas** pour le multijoueur
  (aucune adresse de serveur par défaut).

## 5. Tester à deux clients

1. Serveur lancé (section 3). Ouvre **deux fenêtres de navigateur** (une normale + une « navigation privée », ou deux navigateurs
   différents) sur `http://localhost:8080`.
2. Fenêtre 1 : « Salon privé » → pseudo → « Créer un salon » → note le **code à 5 caractères**.
3. Fenêtre 2 : « Salon privé » → pseudo → code → « Rejoindre ».
4. Fenêtre 1 (hôte) : chacun **propose un thème** ; l'hôte lance le **vote** ; chacun vote ; l'hôte clôture (ou le minuteur s'en charge) ;
   puis « Lancer la partie ».
5. Les deux jouent le round **en même temps** ; clique « Prêt ». À la fin, l'hôte contrôle la révélation.
6. **Test des sons :** dans une fenêtre, « 🎧 Mes sons » → importe un WAV/MP3/OGG → « Utiliser comme instrument » → pose des notes →
   « Prêt ». L'autre fenêtre (qui n'a **pas** le fichier) l'entend à la révélation : il est téléchargé depuis le salon.

**Tester depuis un autre appareil du même réseau (téléphone, autre PC) :**
`ipconfig` → note l'« Adresse IPv4 » de ton PC (ex. `192.168.1.20`), puis sur l'autre appareil `http://192.168.1.20:8080`.
Windows peut demander d'autoriser Node.js dans le pare-feu : accepte pour les « réseaux privés ».
Attention : en `http://` (hors `localhost`), le **micro** est bloqué par les navigateurs. Le reste fonctionne.

## 6. Variables d'environnement (réglages sans toucher au code)

| Variable | Rôle | Valeur par défaut |
|---|---|---|
| `PORT` | port d'écoute (les hébergeurs le fournissent eux-mêmes) | `8080` |
| `HOST` | adresse d'écoute | `0.0.0.0` |
| `ALLOWED_ORIGINS` | adresses de pages autorisées à se connecter, séparées par des virgules (ex. `https://mon-jeu.example.com`) | vide = tout le monde (développement) |

PowerShell : `$env:PORT=8090; $env:ALLOWED_ORIGINS="https://mon-jeu.example.com"; npm start`
(valable seulement pour cette fenêtre). Chez un hébergeur : section « Environment / Variables » de son tableau de bord.

**Aucun secret n'existe côté navigateur** et le serveur n'en utilise aucun : pas de clé d'API à cacher. Le seul « jeton » est celui que le
serveur donne à chaque joueur pour reprendre sa place ; il sert aussi à autoriser l'envoi et le téléchargement de sons dans **son**
salon. Ne partage pas de capture d'écran de la console du navigateur.

## 7. Choisir où héberger (et ce que ça coûte)

Il faut une machine qui **reste allumée** et accepte les **connexions WebSocket longues**. Les offres changent souvent : **vérifie toujours
la page de prix officielle avant de t'engager**. Chiffres relevés le 15 octobre 2026 :

| Service | Offre gratuite ? | Ce qu'il faut savoir pour CE jeu |
|---|---|---|
| **[Render](https://render.com/docs/free)** | Oui (« Free web service ») | **S'endort après 15 min sans trafic** ; le réveil prend **environ 1 minute**. Le trafic WebSocket compte comme activité, donc une partie en cours le garde éveillé. **750 h gratuites/mois** par espace de travail. Disque **éphémère** (effacé à chaque redémarrage/redéploiement) : acceptable ici car les salons sont de toute façon en mémoire. Une seule instance. Peut être redémarré par Render à tout moment (une partie en cours serait perdue). |
| **[Railway](https://docs.railway.com/reference/pricing/plans)** | Plan « Free » à **1 $ de crédit/mois** (0,5 Go de RAM max) ; essai à 5 $ unique ; **Hobby 5 $/mois** (5 $ d'usage inclus) | Serveur toujours allumé, pas d'endormissement annoncé, mais le crédit s'épuise selon l'usage. Sortie réseau : **0,05 $/Go**. |
| **[Fly.io](https://docs.fly.io/about/pricing)** | **Non** pour les nouveaux comptes (essai : 2 h de machine ou 7 jours) | Petite machine toujours allumée : ≈ **2,19 $/mois** (256 Mo) ou **3,69 $/mois** (512 Mo). Sortie réseau 0,02 $/Go (Amérique du Nord/Europe). Carte bancaire demandée. |
| **VPS** (location d'un petit serveur, quelques € par mois) | Non | Le plus de contrôle, mais **tu** installes Node, le HTTPS et les mises à jour. Pas recommandé pour un premier déploiement. |

**Coûts à surveiller :**
- **Endormissement** : sur une offre gratuite, le premier joueur attend ~1 min au réveil. Prévenez-vous : « ouvrez le lien 2 minutes avant ».
- **Limite de connexions simultanées :** ce jeu garde **1 connexion WebSocket par joueur**. Une petite machine (256–512 Mo) en supporte largement
  plusieurs dizaines ; **je n'ai pas mesuré la limite exacte**. Les hébergeurs peuvent poser leurs propres plafonds : lis leur documentation.
- **Stockage audio :** le serveur garde les sons importés **en mémoire** (RAM), par salon : maximum **40 Mo par salon**
  (8 fichiers de 5 Mo maximum par joueur). Quelques salons actifs suffisent à remplir 256 Mo de RAM ; passe à 512 Mo ou plus si tu en
  accueilles plusieurs. Les sons disparaissent avec le salon.
- **Transfert (bande passante) :** une partie typique n'envoie que des messages de quelques Ko. Les sons sont le seul poste lourd : **pire cas**
  (8 joueurs, 40 Mo de sons dans le salon, chacun télécharge les sons des 7 autres) ≈ 280 Mo de sortie, soit **≈ 0,014 $ chez Railway** ou
  **≈ 0,006 $ chez Fly.io** par partie. Chez Render, la bande passante gratuite est limitée et dépassée = services suspendus sans carte
  bancaire (le montant n'est pas indiqué sur leur page).
- **Fonctions payantes utiles plus tard :** disque persistant (Render : offres payantes), plusieurs instances, domaine personnalisé
  (nom de domaine ≈ 10–15 €/an, à acheter ailleurs).
- **Il n'existe pas d'hébergement gratuit illimité et garanti.** Prévois un petit budget (≈ 5 $/mois) si tu veux que ce soit fiable.

## 8. Déployer (exemple pas à pas : Render, tout-en-un)

Le plus simple : **un seul service** qui sert le jeu **et** le serveur (comme en local).

1. **Mets le projet sur GitHub** (`gartic-bande` entier, **sans** `server/node_modules`). Dans PowerShell, dans le dossier du jeu :
   ```powershell
   git init
   echo "node_modules/" > .gitignore
   git add .
   git commit -m "Gartic Bande"
   ```
   Puis crée un dépôt vide sur github.com et suis les deux commandes `git remote add origin …` / `git push -u origin main` qu'il affiche.
2. Sur render.com : **New → Web Service** → connecte ton dépôt GitHub.
3. Réglages à saisir :
   - **Root Directory :** laisse **vide** (le dépôt entier).
   - **Runtime :** Node.
   - **Build Command :** `cd server && npm install`
   - **Start Command :** `cd server && npm start`
   - **Instance type :** Free pour essayer.
   - **Health Check Path :** `/health`
   - Variables : rien d'obligatoire (Render fournit `PORT` tout seul). Optionnel : `ALLOWED_ORIGINS=https://ton-service.onrender.com`.
4. Valide. **Résultat attendu :** dans les logs, « Gartic Bande — http://localhost:… » puis le service passe « Live ». L'adresse est
   `https://ton-service.onrender.com`.
5. Ouvre cette adresse sur deux appareils et refais le test de la section 5.

**Variante « deux endroits »** (jeu sur une page statique, serveur ailleurs) : possible, c'est la section 4 (adresse du serveur +
`ALLOWED_ORIGINS`). Le serveur répond aux requêtes d'envoi de sons entre origines (CORS) pour les origines autorisées. **Cette variante est
moins testée** : préfère le tout-en-un.

Les autres hébergeurs suivent la même idée : « répertoire de départ = dépôt entier, installation = `cd server && npm install`, démarrage
= `cd server && npm start` ». Pour Railway/Fly.io, suis leur documentation de déploiement Node.

## 9. URLs, ports, HTTPS, WebSocket

- **Une seule adresse** pour tout : `https://ton-service.example.com/` (jeu), `/ws` (WebSocket), `/health` (« ok »), `/rooms/CODE/sounds/EMPREINTE` (sons).
- **Port :** le serveur écoute `PORT` (fourni par l'hébergeur). Tu n'écris **jamais** le port dans l'adresse publique.
- **HTTPS ↔ `wss://` :** une page en `https://` doit utiliser `wss://` (le jeu le fait tout seul quand il se connecte au serveur qui l'a servi).
  Les hébergeurs fournissent le certificat HTTPS gratuitement. Mélanger page HTTPS et `ws://` est bloqué par le navigateur.
- **Micro :** exige `https://` ou `http://localhost`. Sur un hébergeur, c'est automatique.
- **Pare-feu / proxy d'entreprise :** certains réseaux bloquent les WebSocket ; essaie un autre réseau (4G).

## 10. Que devient tout après un redémarrage ?

| Donnée | Où elle vit | Après redémarrage du serveur |
|---|---|---|
| Salons, joueurs, thèmes, votes, rounds, contributions | **mémoire du serveur** | **Perdus** (la partie est à refaire). Les joueurs voient « salon introuvable ». |
| Sons importés partagés dans un salon | mémoire du serveur | **Perdus** avec le salon. |
| « Mes sons » (ta bibliothèque) | **IndexedDB de TON navigateur** | **Conservés** (c'est sur ton ordinateur). Un autre ordinateur ne les a pas. |
| Instruments personnalisés | localStorage de ton navigateur | Conservés. |
| Salon en cours quand TU recharges la page | jeton dans le navigateur | Repris (bouton « Reprendre le salon »), tant que le serveur n'a pas redémarré. |

**Ce qui n'est pas fait :** une vraie base de données (pour retrouver une partie après un redémarrage) et des comptes. Ce serait la prochaine
étape si le jeu devait durer : stockage de parties (PostgreSQL ou équivalent) + stockage de fichiers (S3/R2/…) au lieu de la mémoire.

## 11. Stockage et partage des sons

**Principe :** l'audio **ne passe jamais par le WebSocket**. Une contribution ne contient que l'**empreinte** (SHA-256, 64 caractères) du son.
Le fichier voyage à part, en HTTP :

1. Quand tu cliques « Prêt » avec un son importé, ton navigateur envoie le fichier à `PUT /rooms/TON-CODE/sounds/EMPREINTE`
   (avec ton jeton). Le serveur vérifie : tu es bien dans ce salon, le contenu a bien cette empreinte, c'est bien du WAV/MP3/OGG
   (d'après le contenu, pas le nom), la taille, et les quotas.
2. Ta contribution (avec l'empreinte) n'est acceptée **que si** le serveur a déjà le fichier.
3. Les autres joueurs téléchargent `GET /rooms/TON-CODE/sounds/EMPREINTE` (avec leur jeton) dès qu'ils reçoivent la contribution, bien avant la
   révélation. Le son reste **en mémoire** chez eux : il **n'entre pas** dans leur bibliothèque.
4. **Droits d'accès :** sans le jeton d'un joueur **de ce salon**, rien ne se lit ni ne s'écrit. Un autre salon ne peut pas lire ce son, même
   en connaissant l'empreinte (testé).

**Limites (modifiables dans `server/rooms.js`, objet `LIMITS.sound`) :** 5 Mo par fichier, 8 fichiers différents par joueur et par salon, 40 Mo par salon.
Côté navigateur (`js/config.js`, `CONFIG.SOUNDS`) : 30 s maximum par son, 40 sons et 60 Mo par bibliothèque, taille de fichier réglable (1/2/5/10 Mo).

## 12. Journaux et dépannage

- **Logs du serveur :** en local, la fenêtre PowerShell. Chez un hébergeur : onglet « Logs ».
- **Console du navigateur :** touche **F12** → onglet « Console » (messages rouges = problèmes).
- **Test de vie :** ouvre `https://ton-service/health` → doit afficher `ok`.

| Symptôme | Cause probable | Que faire |
|---|---|---|
| `EADDRINUSE … 8080` | un autre programme utilise ce port | `$env:PORT=8090; npm start` |
| « Impossible de joindre le serveur » | serveur éteint, mauvaise adresse, WebSocket bloqué | vérifie `/health`, l'adresse (`wss://` en HTTPS), essaie un autre réseau |
| Page blanche + erreur « Mixed Content » | page en HTTPS mais adresse `ws://` | utilise `wss://` |
| Premier chargement très lent (hébergeur gratuit) | service endormi | attends ~1 minute |
| « salon introuvable » après un moment | serveur redémarré, ou 30 min d'inactivité | recréer un salon |
| Un joueur n'entend pas un son importé | fichier pas encore téléchargé, ou envoi refusé (voir le message à l'écran) | attends quelques secondes ; regarde la console (F12) ; vérifie les limites section 11 |
| « Ton navigateur ne sait pas lire le format OGG » | Safari / certains navigateurs | convertis en WAV ou MP3 |
| Le micro ne s'ouvre pas | page en `http://` hors localhost | utilise `https://` ou `localhost` |
| `npm : impossible de charger le fichier … stratégie d'exécution` | règle PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` puis réessaie |

## Ce qui reste à faire pour un « vrai » service public (honnêteté)

- **Test sur Internet avec de vrais appareils** : seulement testé en local.
- **Persistance** (base de données) et **stockage de fichiers** durable : non faits (tout est en mémoire).
- **Plusieurs serveurs** (montée en charge) : un salon vit dans la mémoire d'**un seul** processus ; non prévu.
- **Comptes, modération des pseudos/thèmes, signalement** : non faits (l'hôte peut supprimer les propositions).
- **Droits d'auteur des sons importés** : chaque joueur reste responsable des fichiers qu'il importe ; aucune vérification de contenu n'est faite.
