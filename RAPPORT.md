# Arbre familial — rapport de livraison

Livrable : `index.html` (un seul fichier, hors ligne, aucune dépendance). Sources lisibles dans `src/` ; `node build.js` les concatène dans `index.html` (facultatif : le fichier livré se modifie aussi directement).

## Choix du moteur de rendu

Rendu maison (canvas 2D à l'écran, géométrie vectorielle partagée avec les exports) plutôt que la bibliothèque family-chart. family-chart est centrée sur une « personne principale » et ne montre les unions multiples d'une personne que lorsqu'elle est au centre, ce qui rend les familles recomposées ambiguës dès qu'on regarde l'arbre entier ; ses cartes sont des éléments HTML (export = capture d'écran, flou à l'impression) ; et elle tire d3 (~280 Ko) à inliner. Le moteur maison place chaque union comme un trait entre deux partenaires adjacents et regroupe les enfants sous le trait de *leur* union, gère les beaux-parents de rang (parents d'un conjoint entrant) en les rattachant à côté de la génération concernée, détecte les croisements et dessine des « sauts » là où un trait vertical traverse une ligne d'une autre union, et produit PNG, PDF et SVG à partir de la même géométrie.

## Modèle de données (schéma `family-tree` v1)

- `persons[]` : `id, first (obligatoire), last, birth, death, place, notes, photo (id), photoShape, collapsed`. Dates partielles : `AAAA`, `AAAA-MM`, `AAAA-MM-JJ` ou vide.
- `unions[]` : `partners` (1 ou 2 ids), `children[] {id, rel: 'adopted'?}`. Un enfant appartient à une seule union (deux parents ou parent seul).
- `photos{}` : JPEG ≤ 600 px en data URL (recadrage rond ou carré à l'import).
- `settings` : thème, champs affichés, titre, sous-titre.
- Validation à l'import avec messages en français (JSON invalide, schéma, version, références, doublons, cycles, enfant de deux unions). Brouillon auto dans localStorage avec avertissement visible.

## Fonctions

Ajout (parent, partenaire, enfant biologique/adopté, frère-sœur complet ou demi), liaison d'une personne existante avec contrôles d'impossibilité (auto-lien, ancêtre/descendant, doublons, troisième parent), édition, suppression expliquée, détacher parents / retirer union, annuler-rétablir (100 niveaux), recherche, recentrage, réduire/développer une branche, deux thèmes, champs affichables, aide intégrée, exemple (16 personnes, famille recomposée), clavier (flèches, Entrée, +, Échap, Ctrl+Z/Y/S/F), zones tactiles ≥ 44 px, pincement, molette, mouvement réduit respecté.

## Export

PNG (150/300/600 dpi), PDF vectoriel (polices standard Helvetica/Times, photos JPEG intégrées en résolution native, clip circulaire), SVG. Papier A4→A0 ou personnalisé, portrait/paysage/auto, marges, titre. Aperçu avant téléchargement, partage natif sur mobile. Le PNG est rendu par tuiles de 4096 × 256 px et encodé en flux (CompressionStream) : aucune toile géante n'est jamais créée ; au-delà de 30 000 px de côté ou 320 Mpx (16 000 / 60 Mpx sur mobile) la résolution est plafonnée et annoncée en français avec la résolution effective ; PDF et SVG restent illimités.

## Taille du fichier

`index.html` : **140 918 octets** (≈ 138 Ko), sans aucune ressource externe.

## Vérification fonctionnelle (Chrome headless, `tests/functional.js`)

**64 / 64 tests passés** (bureau + émulation iPhone tactile). Couverture : première personne via le gros bouton et Entrée ; ajout par formulaire d'un partenaire, d'un enfant (union présélectionnée), d'un frère complet, d'un parent, d'un second parent, d'un demi-frère (même parent), d'un enfant adopté de parent seul ; recentrage sur la nouvelle personne ; liaison d'une personne existante ; blocages (ancêtre comme descendant, auto-lien, partenaire avec son propre enfant, troisième parent) ; édition ; suppression avec explication ; annuler / rétablir ; scénarios « 3 partenaires successifs avec enfants de chacun », « parents divorcés remariés avec nouveaux enfants (demi et beaux) », « conjoint entrant dont les parents et un frère sont dans l'arbre » ; réduire / développer ; export JSON → import → export identique et disposition identique ; rejet de 5 fichiers invalides avec message français ; import d'une photo par le sélecteur de fichier puis recadrage carré (JPEG 600 × 600) ; exports PNG/PDF/SVG en page ; **zéro requête réseau et zéro erreur console** sur tout le parcours ; sur mobile : sélection par tap, ajout par la barre flottante, pincement, glissement.

Invariants géométriques vérifiés sur chaque scénario : aucune carte ne chevauche une autre, aucun trait ne traverse une carte étrangère, chaque enfant est placé entre (ou sous) les parents de son union, toute personne visible est placée.

## Performance (Chrome headless, rendu logiciel, 1920 × 1080 ; `tests/perf.js`)

| Personnes | Mise en page | Rendu/image (zoom tout) | Rendu/image (zoom 0,3) | Rendu/image (zoom 1) | FPS pan |
|---|---|---|---|---|---|
| 1 000 | 17 ms | 1,0 ms | 0,7 ms | 1,1 ms | 60 |
| 5 000 | 70 ms | 3,5 ms (p95 4,0) | 3,0 ms (p95 4,6) | 3,5 ms (p95 5,1) | 60 |
| 10 000 | 102 ms | 5,8 ms | 3,3 ms | 3,9 ms | 60 |
| 20 000 | 373 ms | 12,1 ms (p95 15,7) | 5,0 ms | 4,9 ms | 58–60 |

Mobile (fenêtre 390 × 844, dpr 3, CPU bridé ×4 comme approximation d'un téléphone milieu de gamme), arbre de 5 000 personnes : 4,5 ms par image à zoom 0,3 et 1 (60 fps), 8,1 ms (p95 15 ms) en vue d'ensemble (58 fps). Le plus grand arbre resté fluide : **20 000 personnes** (≥ 58 fps sur bureau ; au-delà, la vue d'ensemble dépasse 16 ms). Mesures non réalisées sur un vrai téléphone ; le bridage ×4 n'est qu'une approximation.

Export A1 / 300 dpi (9 933 × 7 016 px) :

| Arbre | PNG | PDF | SVG |
|---|---|---|---|
| Exemple (16 pers.) | 0,71 s, 2,9 Mo | 3 ms, 53 Ko | 1 ms, 85 Ko |
| 5 000 personnes | 0,78 s, 0,4 Mo | 0,12 s, 0,8 Mo | 0,05 s, 6,8 Mo |

Échantillons livrés : `example-modern-A1-300.{png,pdf,svg}` et `example-vintage-A1-300.{png,pdf,svg}` (PDF rastérisé par macOS pour contrôle : texte et photos nets à 100 %).

## Revue visuelle

La passe « critique visuel » par sous-agent a été abandonnée à votre demande (« forget the screenshots »). Contrôles visuels faits par mes soins sur les captures : exemple dans les deux thèmes à 390 × 844, 820 × 1180 et 1920 × 1080, état vide, formulaire d'ajout, arbre de 5 000 personnes dézoomé et zoomé, exports A1/300 (vue réduite + recadrages 100 %). Défauts trouvés et corrigés en cours de route : barre d'outils débordant sur téléphone, cartes vides à faible zoom, carte de beau-parent posée sur un trait d'union, croisement trait/bus lisible comme une jonction (résolu par des sauts), anneau rond autour d'une photo carrée, bouton « + » chevauchant le texte (déplacé hors de la carte, visible seulement sur la carte sélectionnée).

## Lancer les tests

```
cd tests && npm install
node functional.js   # 64 tests, bureau + mobile émulé
node perf.js         # mesures de performance et d'export
```
