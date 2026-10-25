/**
 * db.js — Connexion SQLite + schéma + données de démarrage (seed)
 * Domestik CI — mise en relation avec du personnel domestique de confiance
 */
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','agency','admin')) DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agency_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  agency_name TEXT NOT NULL,
  description TEXT,
  ville TEXT DEFAULT 'Abidjan',
  commune TEXT,
  verified INTEGER DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','premium')),
  subscribed_until TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  worker_name TEXT NOT NULL,          -- prénom + initiale ex. "Awa K."
  gender TEXT CHECK(gender IN ('F','M')) DEFAULT 'F',
  age INTEGER,
  experience_years INTEGER DEFAULT 0,
  description TEXT,
  ville TEXT NOT NULL DEFAULT 'Abidjan',
  commune TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  contract_type TEXT DEFAULT 'Temps plein',   -- Temps plein / Temps partiel / À la journée
  availability TEXT DEFAULT 'Immédiate',      -- Immédiate / Sous 1 semaine / Sous 1 mois
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pause','pourvue','retiree')),
  views INTEGER DEFAULT 0,
  unlocks INTEGER DEFAULT 0,
  boosted_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS unlocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL DEFAULT 2000,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('unlock','boost','subscription')),
  ref_id INTEGER,                            -- id annonce ou null
  label TEXT,
  amount INTEGER NOT NULL,
  provider TEXT DEFAULT 'wave',
  status TEXT NOT NULL DEFAULT 'success',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,      -- l'employeur
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  agency_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,    -- dénormalisé → agrégation rapide
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  hired INTEGER,                                                        -- 1 = a embauché ce profil
  status TEXT NOT NULL DEFAULT 'publie' CHECK(status IN ('publie','masque')),
  agency_reply TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, listing_id)          -- 1 avis par déblocage → avis 100 % vérifiés
);
`);
/* Migration douce : ajout de la colonne photo si absente */
const listingCols = db.prepare('PRAGMA table_info(listings)').all().map(c => c.name);
if (!listingCols.includes('photo')) db.exec('ALTER TABLE listings ADD COLUMN photo TEXT');

db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- destinataire
  kind TEXT NOT NULL,              -- unlock / review / boost / subscription / boost_end / sub_end
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,                       -- page concernée (ex. /annonce/5)
  wa_status TEXT NOT NULL DEFAULT 'queued' CHECK(wa_status IN ('queued','sent','disabled')),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
/* Migration douce : préférence WhatsApp de l'agence (activée par défaut) */
const agencyCols = db.prepare('PRAGMA table_info(agency_profiles)').all().map(c => c.name);
if (!agencyCols.includes('notify_wa')) db.exec('ALTER TABLE agency_profiles ADD COLUMN notify_wa INTEGER NOT NULL DEFAULT 1');

/* ------------------------------------------------------------------ */
/* BACK-OFFICE                                                         */
/* ------------------------------------------------------------------ */
db.exec(`
-- Réglages éditables depuis /admin/reglages (prix, téléphone plateforme, mode de paiement)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Messages reçus via la page /contact
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nouveau' CHECK(status IN ('nouveau','traite')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Journal d'audit des actions admin (transparence de la modération)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Contenus éditables du site (mini-CMS : titres, textes, images, promo) */
CREATE TABLE IF NOT EXISTS contents (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Vues par annonce et par jour — statistiques du tableau de bord agence */
CREATE TABLE IF NOT EXISTS listing_views_daily (
  listing_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, day)
);
`);

/* Migrations douces */
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols.includes('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
const catCols = db.prepare('PRAGMA table_info(categories)').all().map(c => c.name);
if (!catCols.includes('active')) db.exec('ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
const payCols = db.prepare('PRAGMA table_info(payments)').all().map(c => c.name);
if (!payCols.includes('meta')) db.exec('ALTER TABLE payments ADD COLUMN meta TEXT');   // JSON éventuel (pack de boost…)

/* ------------------------------------------------------------------ */
/* SEED : les 10 catégories du personnel domestique (contexte ivoirien) */
/* ------------------------------------------------------------------ */
const CATEGORIES = [
  ['Ménage/Entretien', 'menage-entretien', '🧹', 'Nettoyage de maison, bureaux, vaisselle, entretien courant du foyer.'],
  ['Cuisine/Restauration', 'cuisine-restauration', '🍲', 'Spécialités ivoiriennes (attiéké, sauce graine, placali…), cuisine continentale.'],
  ["Garde d'enfants", 'garde-enfants', '👶', 'Nounou, baby-sitter, aide aux devoirs, accompagnement école.'],
  ['Garde personnes âgées/Malades', 'garde-personnes-agees', '🧓', 'Aide à la mobilité, soins de base, compagnie, suivi des traitements.'],
  ['Jardinage/Espaces verts', 'jardinage', '🌿', 'Tonte, élagage, potager, entretien cour intérieure et espaces verts.'],
  ['Chauffeur/Courses', 'chauffeur-courses', '🚗', 'Conduite personnelle, livraisons, courses, déplacements professionnels.'],
  ['Bricolage/Maintenance', 'bricolage-maintenance', '🔧', 'Plomberie légère, électricité, peinture, petites réparations.'],
  ['Blanchisserie/Repassage', 'blanchisserie-repassage', '👕', 'Lessive, repassage, pressing à domicile ou en boutique.'],
  ['Gouvernant/Gouvernante', 'gouvernante', '🏡', 'Coordination complète du foyer, gestion du personnel et des stocks.'],
  ['Assistant/Secrétariat', 'assistance-secretariat', '📋', 'Travaux administratifs à domicile, organisation, saisie, accueil.'],
];

const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (catCount === 0) {
  const ins = db.prepare('INSERT INTO categories (name, slug, icon, description) VALUES (?,?,?,?)');
  const tx = db.transaction(() => CATEGORIES.forEach(c => ins.run(...c)));
  tx();
  console.log('✔ Catégories insérées');
}
// Alignement idempotent : les 10 catégories canoniques garde toujours leurs noms officiels
{
  const sync = db.prepare('UPDATE categories SET name=?, icon=?, description=? WHERE slug=?');
  const txSync = db.transaction(() => CATEGORIES.forEach(([name, slug, icon, desc]) => sync.run(name, icon, desc, slug)));
  txSync();
}

/* ------------------------------------------------------------------ */
/* SEED : comptes + annonces de démonstration                           */
/* ------------------------------------------------------------------ */
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const hash = bcrypt.hashSync('demo1234', 10);

  const insUser = db.prepare('INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)');
  const insAgency = db.prepare(`INSERT INTO agency_profiles
    (user_id, agency_name, description, ville, commune, verified, plan, subscribed_until)
    VALUES (?,?,?,?,?,?,?,?)`);

  // Agence 1 : premium, vérifiée
  const a1 = insUser.run('Espoir Domestique', 'agence@demo.ci', '+225 07 09 45 67 89', hash, 'agency').lastInsertRowid;
  insAgency.run(a1, 'Agence Espoir Domestique',
    "Agence de placement de personnel domestique formée et référencée. Chaque profil est vérifié (casier, références, entretien).",
    'Abidjan', 'Cocody', 1, 'premium', null);
  db.prepare("UPDATE agency_profiles SET subscribed_until = datetime('now','+30 days') WHERE user_id=?").run(a1);

  // Agence 2 : gratuite
  const a2 = insUser.run('Confiance Placement', 'confiance@demo.ci', '+225 05 66 12 34 56', hash, 'agency').lastInsertRowid;
  insAgency.run(a2, 'Confiance Placement',
    "Mise en relation rapide avec du personnel de maison disponible sur le Grand Abidjan.",
    'Abidjan', 'Marcory', 0, 'free', null);

  // Utilisateur de démonstration
  insUser.run('Aya Konan', 'client@demo.ci', '+225 01 02 03 04 05', hash, 'user');

  const demo = [
    [a1, 3, "Nounou expérimentée — disponible immédiatement", "Awa K.", 'F', 28, 6,
     "Nounou douce et ponctuelle, 6 ans d'expérience chez des familles à Cocody et Riviera. Sait préparer les repas des enfants, aide aux devoirs (primaire). Références vérifiables.",
     'Abidjan', 'Cocody', 80000, 120000, 'Temps plein', 'Immédiate', 148, "datetime('now','+4 days')", '-2 days'],
    [a1, 2, "Cuisinière spécialités ivoiriennes et continentales", "Adjoua N.", 'F', 34, 10,
     "Excellente maîtrise des plats locaux (attiéké poisson braisé, sauce graine, kedjenou) et cuisine continentale. A travaillé pour une famille expatriée au Plateau pendant 4 ans.",
     'Abidjan', 'Plateau', 100000, 160000, 'Temps plein', 'Sous 1 semaine', 96, null, '-1 days'],
    [a1, 6, "Chauffeur personnel — permis B, 8 ans d'expérience", "Koffi Y.", 'M', 38, 8,
     "Chauffeur sérieux et discret, connaissance parfaite d'Abidjan et intérieur du pays. Conduite défensive, entretien de base du véhicule. Disponible pour courses et trajets professionnels.",
     'Abidjan', 'Marcory', 120000, 200000, 'Temps plein', 'Immédiate', 122, "datetime('now','+10 days')", '-5 days'],
    [a2, 1, "Femme de ménage rigoureuse — Yopougon / Maroc", "Fatou D.", 'F', 25, 3,
     "Entretien complet de la maison : nettoyage, vaisselle, rangement. Travailleuse et honnête, références disponibles. Recherche poste logée ou non logée.",
     'Abidjan', 'Yopougon', 60000, 90000, 'Temps plein', 'Immédiate', 61, null, '-3 hours'],
    [a2, 8, "Blanchisseuse — repassage soigné à domicile", "Mariam S.", 'F', 30, 5,
     "Lessive et repassage impeccable, pressing léger. Se déplace à domicile sur Cocody, Angré et Riviera. Formules à la semaine possibles.",
     'Abidjan', 'Cocody', 40000, 70000, 'Temps partiel', 'Sous 1 semaine', 44, null, '-6 hours'],
    [a1, 4, "Aide-soignante pour personne âgée — patiente et formée", "Aminata T.", 'F', 32, 7,
     "Accompagnement quotidien, aide à la mobilité, rappel des médicaments, préparation des repas adaptés. Formation en premiers secours. Très attentive et respectueuse.",
     'Abidjan', 'Koumassi', 90000, 140000, 'Temps plein', 'Immédiate', 77, null, '-1 days'],
    [a2, 5, "Jardinier polyvalent — tonte, élagage, potager", "Yao B.", 'M', 29, 4,
     "Entretien régulier de jardins et cours, création de potagers, taille de haies. Ponctuel, apporte ses outils de base. Passages hebdomadaires possibles.",
     'Abidjan', 'Riviera', 70000, 110000, 'Temps partiel', 'Immédiate', 38, null, '-10 hours'],
    [a1, 9, "Gouvernante organisée — gestion complète du foyer", "N'Guessan A.", 'F', 42, 12,
     "Coordination du personnel de maison, gestion des stocks et des courses, supervision des repas et de l'entretien. A géré une villa de 8 personnes à la Riviera. Excellente présentation.",
     'Abidjan', 'Riviera', 150000, 250000, 'Temps plein', 'Sous 1 mois', 85, null, '-4 days'],
  ];
  // boosted_until : expression SQL brute pour les annonces mises en avant, NULL sinon
  const tx = db.transaction(() => {
    demo.forEach((r, i) => {
      const [a, cat, title, wn, g, age, exp, desc, ville, commune, smin, smax, ct, avail, views, boostExpr, createdOff] = r;
      const photo = `/uploads/listings/demo-${i + 1}.webp`;      // générées par scripts/gen_demo_photos.py
      db.prepare(`INSERT INTO listings
        (agency_id, category_id, title, worker_name, gender, age, experience_years, description,
         ville, commune, salary_min, salary_max, contract_type, availability, status, views, boosted_until, photo, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,${boostExpr || 'NULL'},?,datetime('now', ?))`)
        .run(a, cat, title, wn, g, age, exp, desc, ville, commune, smin, smax, ct, avail, views, photo, createdOff);
    });
  });
  tx();
  console.log('✔ Données de démonstration insérées');
}

/* ------------------------------------------------------------------ */
/* SEED : avis de démonstration                                        */
/* Règle métier : un avis n'existe que si le contact a été débloqué.  */
/* ------------------------------------------------------------------ */
const revCount = db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n;
const demoUser = db.prepare("SELECT id FROM users WHERE email='client@demo.ci'").get();
if (revCount === 0 && demoUser) {
  const findListing = t => db.prepare('SELECT id, agency_id FROM listings WHERE title LIKE ?').get(t);
  const mk = (titleLike, rating, hired, comment, reply, ago) => {
    const l = findListing(titleLike);
    if (!l) return;
    db.prepare('INSERT OR IGNORE INTO unlocks (user_id,listing_id,amount) VALUES (?,?,2000)').run(demoUser.id, l.id);
    db.prepare(`INSERT INTO reviews (user_id,listing_id,agency_id,rating,comment,hired,created_at,agency_reply,replied_at)
      VALUES (?,?,?,?,?,?,datetime('now',?),?,${reply ? "datetime('now','+1 hours')" : 'NULL'})`)
      .run(demoUser.id, l.id, l.agency_id, rating, comment, hired, ago, reply);
  };
  mk('Nounou expérimentée%', 5, 1,
    "Excellente expérience. L'agence a organisé l'entretien en 48 h. Awa est douce avec mes enfants, ponctuelle et très professionnelle. Je recommande vivement !",
    'Merci Madame Konan pour votre confiance. Nous restons à votre écoute pour le suivi mensuel.', '-12 days');
  mk('Chauffeur personnel%', 4, 1,
    "Chauffeur ponctuel et conduite prudente. Une petite semaine d'adaptation au départ, mais l'agence a assuré un suivi très sérieux.",
    null, '-6 days');
  mk('Aide-soignante%', 5, 0,
    "Profil très rassurant et entretien concluant. Nous avons finalement trouvé une solution en famille, mais je salue le professionnalisme de cette agence.",
    'Merci pour votre retour, et au plaisir de vous accompagner une prochaine fois.', '-2 days');
  mk('Cuisinière spécialités%', 3, 0,
    "Premier essai prometteur mais le profil avait accepté un poste entre-temps. L'agence m'a heureusement proposé une alternative rapidement.",
    'Désolés pour ce contretemps — nous priorisons désormais les mises à jour de disponibilité.', '-1 days');
  console.log('✔ Avis de démonstration insérés');
}

/* ------------------------------------------------------------------ */
/* SEED : compte administrateur (propriétaire de la plateforme)        */
/* ------------------------------------------------------------------ */
const adminExists = db.prepare("SELECT 1 FROM users WHERE role='admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'demo1234', 10);
  db.prepare("INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,'admin')")
    .run('Administrateur', 'admin@demo.ci', '+225 01 01 01 01 01', hash);
  console.log('✔ Compte admin créé (admin@demo.ci)');
}

/* ------------------------------------------------------------------ */
/* SEED : historique de paiements de démonstration                     */
/* ------------------------------------------------------------------ */
const payCount = db.prepare('SELECT COUNT(*) AS n FROM payments').get().n;
if (payCount === 0 && demoUser) {
  const demoAgency = db.prepare("SELECT id FROM users WHERE email='agence@demo.ci'").get();
  if (demoAgency) {
    const ins = db.prepare(`INSERT INTO payments (user_id,kind,ref_id,label,amount,created_at)
                            VALUES (?,?,?,?,?,datetime('now',?))`);
    ins.run(demoUser.id, 'unlock', 1, 'Déblocage contact agence', 2000, '-12 days');
    ins.run(demoUser.id, 'unlock', 3, 'Déblocage contact agence', 2000, '-6 days');
    ins.run(demoUser.id, 'unlock', 6, 'Déblocage contact agence', 2000, '-2 days');
    ins.run(demoUser.id, 'unlock', 2, 'Déblocage contact agence', 2000, '-1 days');
    ins.run(demoAgency.id, 'subscription', null, 'Abonnement Agence Premium (30 jours)', 15000, '-5 days');
    ins.run(demoAgency.id, 'boost', 3, 'Pack VIP (14 jours)', 10000, '-3 days');
    ins.run(demoAgency.id, 'boost', 1, 'Pack Popularité (5 jours)', 3000, '-9 days');
    console.log('✔ Historique de paiements de démonstration inséré');
  }
}

module.exports = { db };

