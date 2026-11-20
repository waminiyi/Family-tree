'use strict';
// ---------------------------------------------------------------------------
// i18n — all UI strings live here. Add a language by adding a key to I18N.
// ---------------------------------------------------------------------------
const I18N = {
  fr: {
    appTitle: 'Arbre familial',
    open: 'Ouvrir (JSON)', save: 'Enregistrer (JSON)', export: 'Exporter', undo: 'Annuler', redo: 'Rétablir',
    settings: 'Réglages', help: 'Aide', example: 'Exemple', search: 'Rechercher une personne…', newTree: 'Nouvel arbre',
    menu: 'Menu', close: 'Fermer', cancel: 'Annuler', ok: 'OK', delete: 'Supprimer', edit: 'Modifier', add: 'Ajouter',
    zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière', fit: 'Voir tout l’arbre', center: 'Centrer', recenter: 'Recentrer sur cette personne',
    collapse: 'Réduire la branche', expand: 'Développer la branche', hiddenCount: (n) => `${n} masqué${n > 1 ? 's' : ''}`,
    firstPerson: 'Ajouter la première personne', emptyHint: 'Votre arbre est vide. Commencez par vous, ou par un ancêtre.',
    autosaveNotice: 'Brouillon enregistré automatiquement dans ce navigateur. Le fichier JSON (« Enregistrer ») reste la vraie sauvegarde.',
    autosaveFailed: 'Brouillon trop volumineux pour ce navigateur : pensez à enregistrer le fichier JSON.',
    draftRestored: 'Brouillon restauré depuis ce navigateur.',
    // person fields
    firstName: 'Prénom', lastName: 'Nom', birth: 'Naissance', death: 'Décès', place: 'Lieu', photo: 'Photo', notes: 'Notes',
    dateHint: 'AAAA, MM/AAAA, JJ/MM/AAAA ou vide', datePlaceholder: 'ex. 1950 ou 12/03/1950',
    required: 'Le prénom est obligatoire.', invalidDate: 'Date invalide (utilisez AAAA, MM/AAAA ou JJ/MM/AAAA).',
    moreFields: 'Plus de champs', lessFields: 'Moins de champs',
    choosePhoto: 'Choisir une photo', takePhoto: 'Prendre une photo', removePhoto: 'Retirer la photo',
    cropTitle: 'Recadrer la photo', cropHint: 'Faites glisser pour repositionner, pincez ou utilisez la molette pour zoomer.',
    shapeCircle: 'Rond', shapeSquare: 'Carré', zoom: 'Zoom',
    // add form
    addTitle: (n) => `Ajouter un proche de ${n}`, relation: 'Lien avec cette personne',
    relParent: 'Un parent', relPartner: 'Un(e) partenaire', relChild: 'Un enfant', relSibling: 'Un frère / une sœur',
    relParentHint: 'Père, mère ou parent adoptif', relPartnerHint: 'Mariage, union libre, ex…', relChildHint: 'Biologique ou adopté',
    relSiblingHint: 'Mêmes parents ou demi-frère / demi-sœur',
    withPartner: 'Avec quel(le) partenaire ?', singleParent: 'Parent seul (autre parent inconnu)',
    adopted: 'Enfant adopté', adoptedShort: 'adopté(e)',
    siblingFull: 'Mêmes parents (frère / sœur)', siblingHalf: (n) => `Demi-frère / demi-sœur : même parent ${n}`,
    siblingNeedsParent: 'Ajoutez d’abord un parent à cette personne pour pouvoir lui ajouter un frère ou une sœur.',
    parentsFull: 'Cette personne a déjà deux parents.',
    existingPerson: 'Lier une personne déjà dans l’arbre', newPerson: 'Nouvelle personne', pickPerson: 'Choisir…',
    noResult: 'Aucun résultat', saveAndClose: 'Enregistrer (Entrée)',
    // edit
    editTitle: 'Modifier la fiche', deleteConfirmTitle: (n) => `Supprimer ${n} ?`,
    deleteExplain: 'Cette action supprime la personne et ses liens. Ses partenaires et ses enfants restent dans l’arbre : les enfants restent rattachés à l’autre parent, ou deviennent des racines s’il n’y en a pas. Vous pouvez annuler avec « Annuler » (Ctrl+Z).',
    deleteLinks: (p, c) => `${p} union(s) et ${c} lien(s) enfant seront retirés.`,
    unlinkParents: 'Détacher de ses parents', unlinkUnion: 'Retirer cette union', unions: 'Unions', parents: 'Parents',
    // errors / validation
    errSelf: 'Une personne ne peut pas être liée à elle-même.',
    errAncestor: 'Lien impossible : cette personne est déjà un ancêtre ou un descendant de l’autre.',
    errAlreadyPartners: 'Ces deux personnes sont déjà partenaires.',
    errHasParents: 'Cette personne a déjà des parents : détachez-la d’abord.',
    errAlreadyChild: 'Cette personne est déjà un enfant de cette union.',
    errPartnerAsChild: 'Un(e) partenaire ne peut pas être aussi l’enfant de l’union.',
    errUnknown: 'Personne introuvable.',
    // JSON
    jsonBadFile: 'Ce fichier n’est pas un JSON valide.',
    jsonBadSchema: 'Ce fichier n’est pas un arbre familial reconnu (champ « schema » manquant ou différent).',
    jsonBadVersion: (v) => `Version de fichier ${v} non prise en charge (cette application lit la version ${1}).`,
    jsonBadPersons: 'Liste des personnes absente ou invalide.',
    jsonBadPerson: (i) => `Personne n°${i + 1} invalide (identifiant ou prénom manquant).`,
    jsonDupId: (id) => `Identifiant en double : ${id}.`,
    jsonBadUnion: (i) => `Union n°${i + 1} invalide.`,
    jsonBadRef: (id) => `Référence vers une personne inconnue : ${id}.`,
    jsonCycle: 'Le fichier contient un lien impossible (une personne est son propre ancêtre).',
    jsonTwoParents: (id) => `La personne ${id} est l’enfant de plusieurs unions.`,
    importOk: (n) => `${n} personne(s) chargée(s).`, loaded: 'Fichier chargé.', saved: 'Fichier enregistré.',
    replaceConfirm: 'Remplacer l’arbre actuel ? Les modifications non enregistrées seront perdues (annulable avec Annuler).',
    newTreeConfirm: 'Créer un nouvel arbre vide ? L’arbre actuel sera remplacé (annulable avec Annuler).',
    // settings
    settingsTitle: 'Réglages', theme: 'Thème', themeModern: 'Sobre et moderne', themeVintage: 'Vintage / généalogique',
    shownFields: 'Champs affichés sur les cartes', showLastName: 'Nom', showDates: 'Dates', showPlace: 'Lieu', showPhoto: 'Photo',
    showPlus: 'Bouton « + » sur la carte sélectionnée', hiddenFieldsNote: 'Les champs masqués restent enregistrés dans le fichier JSON.',
    treeTitle: 'Titre de l’arbre', treeSubtitle: 'Sous-titre', language: 'Langue',
    // export
    exportTitle: 'Exporter l’arbre', format: 'Format', paper: 'Papier', orientation: 'Orientation', portrait: 'Portrait',
    landscape: 'Paysage', auto: 'Automatique', dpi: 'Résolution (DPI)', margins: 'Marges (mm)', custom: 'Personnalisé',
    widthMm: 'Largeur (mm)', heightMm: 'Hauteur (mm)', includeTitle: 'Afficher le titre', preview: 'Aperçu', download: 'Télécharger',
    share: 'Partager', exporting: 'Export en cours…', exportDone: 'Export terminé.', pixels: 'pixels',
    effective: (w, h, d) => `Image : ${w} × ${h} px (${d} dpi effectifs)`,
    capped: (req, eff) => `Résolution demandée ${req} dpi trop élevée pour ce navigateur : plafonnée à ${eff} dpi. Pour une taille illimitée, exportez en PDF ou SVG (vectoriel).`,
    vectorNote: 'Export vectoriel : netteté illimitée à l’impression.', cardScale: (s) => `Échelle des cartes sur la feuille : ${s} %`,
    tooSmallWarning: 'Attention : l’arbre est très large, les cartes seront petites sur cette feuille. Choisissez un papier plus grand.',
    noCompression: 'Compression indisponible dans ce navigateur : le PNG sera volumineux.',
    // help
    helpTitle: 'Aide',
    // misc
    personCount: (n) => `${n} personne${n > 1 ? 's' : ''}`, unknown: '?', root: 'racine',
    confirm: 'Confirmer', keyboardHint: 'Flèches : naviguer · Entrée : modifier · + : ajouter · Échap : désélectionner',
    photoTooBig: 'Image illisible ou trop grande.', generated: (n) => `Arbre de test généré : ${n} personnes.`,
    selected: (n) => `Sélection : ${n}`, exampleLoaded: 'Exemple chargé : une famille recomposée.',
    born: 'né(e)', died: 'décédé(e)',
  },
};
let LANG = 'fr';
function t(key, ...args) {
  const v = (I18N[LANG] && I18N[LANG][key]) ?? I18N.fr[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}
