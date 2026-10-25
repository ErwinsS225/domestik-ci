/**
 * content.js — Mini-CMS : contenus éditables du site (accueil, promo, pied de page)
 * · Registre CONTENT_FORM décrivant les sections et champs éditables dans /admin/contenus
 * · Valeurs stockées dans la table contents (clé/valeur) ; les valeurs par défaut vivent ici
 * · Cache 3 s : le site lit le contenu à chaque requête sans requêter la base en boucle
 */
const { db } = require('./db');

/* ------------------------------ Définition des sections ------------------------------ */

const CONTENT_FORM = [
  {
    id: 'promo', icon: '📣', title: 'Bandeau promo flash (visible sur TOUTES les pages)',
    help: 'Idéal pour lancer une offre limitée : « Premium offert aux 10 premières agences », « -50 % ce week-end », etc. Laissez le lien vide pour un bandeau simple.',
    fields: [
      { key: 'promo_active', label: 'Afficher le bandeau promo', kind: 'toggle', default: '0' },
      { key: 'promo_text', label: 'Texte de la promo', kind: 'text', default: '⚡ Offre de lancement : le Premium est OFFERT 30 jours aux 10 premières agences partenaires !' },
      { key: 'promo_link', label: 'Lien du bandeau (facultatif)', kind: 'text', placeholder: '/inscription', default: '' },
    ],
  },
  {
    id: 'hero', icon: '🖼', title: "Grande bannière d'accueil",
    help: 'La première chose que voient vos visiteurs. Le titre accepte <em>…</em> pour la partie italique et colorée.',
    fields: [
      { key: 'hero_title', label: 'Titre principal', kind: 'html', help: 'Ex : Du personnel domestique <em>de confiance</em>, près de chez vous.', default: 'Du personnel domestique <em>de confiance</em>, près de chez vous.' },
      { key: 'hero_lead', label: 'Sous-titre', kind: 'textarea', default: 'Domestik CI met en relation les familles et entreprises ivoiriennes avec des agences de placement vérifiées : nounous, cuisiniers, chauffeurs, femmes de ménage… Trouvez le bon profil en quelques minutes.' },
      { key: 'hero_image', label: "Image d'illustration (à droite du titre)", kind: 'image', default: '' },
    ],
  },
  {
    id: 'sections', icon: '🛋', title: "Titres des sections de l'accueil",
    fields: [
      { key: 'cats_eyebrow', label: 'Sur-titre des catégories', kind: 'text', default: "Domaines d'expertise" },
      { key: 'cats_title', label: 'Titre des catégories', kind: 'text', default: '10 catégories de personnel qualifié' },
      { key: 'featured_title', label: 'Titre « En vedette » (annonces boostées)', kind: 'text', default: 'Profils boostés par les agences' },
      { key: 'latest_eyebrow', label: 'Sur-titre des nouveautés', kind: 'text', default: 'Nouveautés' },
      { key: 'latest_title', label: 'Titre des nouveautés', kind: 'text', default: 'Derniers profils publiés' },
      { key: 'reviews_title', label: 'Titre des avis', kind: 'text', default: 'Ils ont trouvé leur perle' },
    ],
  },
  {
    id: 'how', icon: '🧭', title: 'Section « Comment ça marche ? »',
    help: 'L\'astuce [PRIX] sera remplacée par le prix actuel du déblocage (voir Réglages).',
    fields: [
      { key: 'how_eyebrow', label: 'Sur-titre', kind: 'text', default: 'Simple & sécurisé' },
      { key: 'how_title', label: 'Titre', kind: 'text', default: 'Comment ça marche ?' },
      { key: 'step1_title', label: 'Étape 1 — titre', kind: 'text', default: 'Recherchez par catégorie' },
      { key: 'step1_text', label: 'Étape 1 — texte', kind: 'textarea', default: 'Parcourez les profils publiés par des agences de placement : nounou, cuisinier, chauffeur… Filtrez par commune et salaire.' },
      { key: 'step2_title', label: 'Étape 2 — titre', kind: 'text', default: 'Débloquez le contact pour [PRIX]', help: '[PRIX] = prix du déblocage actuel.' },
      { key: 'step2_text', label: 'Étape 2 — texte', kind: 'textarea', default: "Le profil vous intéresse ? Payez via Wave pour obtenir immédiatement le numéro de l'agence responsable de l'annonce." },
      { key: 'step3_title', label: 'Étape 3 — titre', kind: 'text', default: "Contactez l'agence et embauchez" },
    ],
  },
  {
    id: 'footer', icon: '🦶', title: 'Pied de page',
    help: 'Phrase courte affichée sous le logo, au bas de chaque page.',
    fields: [
      { key: 'footer_tagline', label: "Phrase d'accroche du pied de page", kind: 'textarea', default: "La mise en relation de personnel domestique basée sur la confiance et le professionnalisme, en Côte d'Ivoire." },
    ],
  },
];

/* ------------------------------ Lecture / écriture ------------------------------ */

const DEFAULTS = {};
for (const s of CONTENT_FORM) for (const f of s.fields) DEFAULTS[f.key] = f.default;
const CONTENT_KEYS = Object.keys(DEFAULTS);
const IMAGE_KEYS = CONTENT_FORM.flatMap(s => s.fields).filter(f => f.kind === 'image').map(f => f.key);

let CACHE = null;
let LOADED_AT = 0;

/** Toutes les valeurs (défauts + personnalisations). Mis en cache 3 s max. */
function all(force = false) {
  if (!force && CACHE && Date.now() - LOADED_AT < 3000) return CACHE;
  const rows = db.prepare('SELECT key,value FROM contents').all();
  CACHE = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) CACHE[r.key] = r.value;
  LOADED_AT = Date.now();
  return CACHE;
}

/** Enregistre une valeur (upsert). */
function set(key, value) {
  if (!(key in DEFAULTS)) return;
  db.prepare(`INSERT INTO contents (key,value,updated_at) VALUES (?,?,datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, String(value ?? ''));
  LOADED_AT = 0; // invalidation
}

/** Insertion du jeton [PRIX] dans un texte éditable. */
const withPrice = (text, prix) => String(text || '').replace(/\[PRIX\]/g, prix);

module.exports = { CONTENT_FORM, CONTENT_KEYS, IMAGE_KEYS, all, set, withPrice };
