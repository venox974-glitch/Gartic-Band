# Speech to Note — étude (NON implémenté)

But : le joueur fredonne devant son micro, le jeu détecte les hauteurs et les durées, et pose de **vraies notes éditables** dans le piano-roll (qu'on retouche ensuite avec le Crayon et la Sélection). Ce n'est **pas** de la reconnaissance vocale « texte » : il faut analyser le signal audio et sa hauteur (fréquence fondamentale, « F0 »).

Rien de ce document n'existe encore dans le code. Ce sont des pistes, classées par ce qu'il faut faire.

## Ce que le projet a déjà (à réutiliser)
- `js/voice.js` : ouvre le micro **seulement après un clic** (`getUserMedia`, sans traitement : écho / bruit / gain auto désactivés), enregistre en WAV mono 24 kHz, a déjà un `AnalyserNode`, referme le micro à la fin, messages d'erreur en français. C'est la bonne porte d'entrée et la bonne règle de confidentialité (tout reste dans le navigateur).
- `js/pitch.js` : outils de hauteur déjà présents pour décaler les sons.
- Piano-roll : `store.addNote(trackId, step, row, length)` accepte déjà des positions fractionnaires ; la grille (`store.grid.unit`) et l'aimant fournissent la quantification. Les lignes (`row`) sont des demi-tons (`GB.MELODIC_ROW_COUNT = 36`) : il suffit de convertir un numéro MIDI en `row` selon l'octave affichée.

## Étapes de traitement
1. **Capture** : `getUserMedia` (autorisation explicite), échantillons en `Float32`, idéalement via un `AudioWorklet` (traitement en continu, hors du fil principal) ou, plus simple pour une V1, on enregistre d'abord (comme `voice.js`) puis on analyse le fichier d'un coup.
2. **Hauteur (F0)** par fenêtres de ~30–50 ms toutes les ~10 ms. Algorithmes adaptés à UNE voix chantée :
   - **YIN** ou **McLeod Pitch Method (MPM)** : simples (quelques dizaines de lignes), rapides, précis sur la voix. Recommandé pour la V1.
   - **pYIN** (YIN probabiliste + lissage de Viterbi) : plus robuste aux erreurs d'octave, plus long à écrire.
   - **CREPE / SPICE** (réseaux de neurones, TensorFlow.js) : très robustes au bruit, mais modèle de plusieurs Mo à télécharger et plus lourd sur téléphone. À garder pour une V2 si YIN ne suffit pas.
   - Bibliothèques possibles : `pitchy` (MPM, petite, JavaScript pur), `pitchfinder` (YIN, AMDF…), ou écrire YIN soi-même (le projet n'a pas de dépendance côté navigateur, donc une copie dans `vendor/` ou un fichier maison serait cohérent).
3. **Voisé / non voisé** : ignorer les moments sans note (respiration, « s », « t »). Critères : énergie (RMS) sous un seuil, confiance de l'algorithme (clarté du pic dans YIN/MPM) trop faible.
4. **Segmentation en notes** : convertir F0 → numéro MIDI continu (`69 + 12·log2(f/440)`), puis couper une note quand (a) le son s'arrête ou (b) la hauteur arrondie change de façon stable (par ex. plus de 0,6 demi-ton pendant > 60 ms). Les glissandos et le vibrato sont le piège : prendre la **médiane** de la hauteur sur la durée de la note, pas la valeur instantanée. Éliminer les notes trop courtes (< 80 ms) ou les fusionner avec la voisine.
5. **Quantification (facultative)** : caler début et fin sur `store.grid.unit` (déjà géré par l'aimant). Prévoir un curseur « force » (0 % = libre, 100 % = calé) pour ne pas écraser le rythme naturel.
6. **Placement** : la durée d'enregistrement est liée au tempo (le jeu connaît le BPM) : `step = secondes × BPM / 60 × (pas par temps)`. Appeler `store.addNote(...)` pour chaque note détectée. Ensuite le joueur corrige avec le Crayon / la Sélection.
7. **Correction possible** avant de valider : écran d'aperçu (« voici les 12 notes trouvées ») avec lecture, réglage de la sensibilité, choix de la gamme pour « aimanter » les hauteurs sur Do majeur, etc. (même idée que les modes Baby / Débutant / Expert existants).

## Difficultés principales
- **Erreurs d'octave** (l'algorithme trouve la moitié ou le double de la fréquence) : lissage dans le temps + limite de plage vocale (~80–1000 Hz).
- **Voix non justes** : une voix chantée varie de ±50 centièmes ; arrondir au demi-ton le plus proche est souvent faux. Aimanter sur une gamme choisie aide beaucoup.
- **Bruit, respirations, plosives** : seuil d'énergie réglable + filtre passe-haut (~70 Hz). Conseiller un casque (sinon le micro capte la musique du jeu, comme déjà signalé dans l'écran voix).
- **Latence** : si on enregistre « sur la boucle », il faut compenser le délai micro (`latency` de l'audio du navigateur) comme `voice.js` le fait déjà pour le clip.
- **Téléphones** : micro et fréquences d'échantillonnage variables (44,1 / 48 kHz), `AudioWorklet` pas toujours dispo sur de vieux Safari ; analyse hors-ligne d'un enregistrement court = plus sûr. Sur iOS le micro n'est accessible qu'en HTTPS, après un geste de l'utilisateur.
- **Vie privée** : tout se passe dans le navigateur ; aucun audio n'est envoyé au serveur (le multijoueur n'envoie déjà que des notes ou des clips choisis par le joueur). Si un modèle est téléchargé, il vient d'un fichier local du projet, pas d'un service externe.
- **Une seule voix à la fois** : plusieurs voix ou accords demanderaient un autre type d'outil (transcription polyphonique, p. ex. modèles type Basic Pitch) — hors V1.

## Approche progressive
1. **V0 (test)** : écran de démo qui affiche la hauteur en direct (nom de la note) pendant qu'on fredonne : valide le micro et l'algorithme sans toucher au piano-roll.
2. **V1** : enregistrer 5–15 s, analyser avec YIN/MPM, segmenter, quantifier, **prévisualiser** puis poser les notes dans la piste choisie (bouton « 🎤 Chanter pour créer des notes » à côté des outils).
3. **V2** : réglages (sensibilité, gamme, force de quantification), métronome et décompte, annuler.
4. **V3** (si besoin) : modèle réseau de neurones pour les voix bruitées, notes polyphoniques.

Test conseillé avant d'investir : tester YIN sur quelques enregistrements de vrais joueurs (téléphone et ordinateur) pour mesurer le taux d'erreurs avant de décider du modèle.
