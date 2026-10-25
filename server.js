/**
 * server.js — Domestik CI
 * Plateforme de mise en relation personnel domestique ⇄ particuliers (Côte d'Ivoire)
 */
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db } = require('./src/db');
const { photoUpload, processPhoto, deletePhoto, processSiteImage } = require('./src/photos');
const C = require('./src/content');
const { notify, waManualLink, KIND_ICONS } = require('./src/notify');
const H = require('./src/helpers');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

/* PWA : manifest avec le bon type MIME + service worker sans cache navigateur */
app.get('/manifest.json', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'domestik-ci-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 14 * 24 * 3600 * 1000 },
}));

/* ---------- middlewares ---------- */
app.use((req, res, next) => {
  H.refreshPrices();                              // tarifs actualisés si modifiés dans l'admin
  res.locals.SITE = C.all();                      // contenus éditables du site (mini-CMS)
  res.locals.C = require('./src/content');        // helpers de rendu (jeton [PRIX]…)
  res.locals.user = req.session.userId
    ? db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(req.session.userId)
    : null;
  res.locals.agency = res.locals.user && res.locals.user.role === 'agency'
    ? db.prepare('SELECT * FROM agency_profiles WHERE user_id=?').get(res.locals.user.id)
    : null;
  res.locals.isPremium = H.isPremium(res.locals.agency);
  res.locals.unreadNotifs = res.locals.user && ['agency', 'user'].includes(res.locals.user.role)
    ? db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(res.locals.user.id).n
    : 0;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.H = H;
  next();
});

const flash = (req, msg, type = 'success') => { req.session.flash = { msg, type }; };

/** Colonnes dérivées : note moyenne + nombre d'avis de l'agence d'une annonce */
const AGG_RATING = `
  (SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.agency_id=l.agency_id AND r.status='publie') AS agency_rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.agency_id=l.agency_id AND r.status='publie') AS agency_reviews`;
const requireLogin = (req, res, next) => {
  if (!req.session.userId) { flash(req, 'Connectez-vous pour continuer.', 'error'); return res.redirect('/connexion'); }
  next();
};
const requireRole = role => (req, res, next) => {
  const u = req.session.userId && db.prepare('SELECT role FROM users WHERE id=?').get(req.session.userId);
  if (!u || u.role !== role) { flash(req, 'Accès réservé.', 'error'); return res.redirect('/'); }
  next();
};

/* ================================================================== */
/* PAGES PUBLIQUES                                                     */
/* ================================================================== */

app.get('/', (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM listings l WHERE l.category_id=c.id AND l.status='active') AS n
    FROM categories c WHERE c.active=1 ORDER BY c.id`).all();
  const featured = db.prepare(`
    SELECT l.*, c.name cat_name, c.icon cat_icon, a.agency_name, a.verified, a.plan, a.subscribed_until, u.phone agency_phone, ${AGG_RATING}
    FROM listings l
    JOIN categories c ON c.id=l.category_id
    JOIN agency_profiles a ON a.user_id=l.agency_id
    JOIN users u ON u.id=l.agency_id
    WHERE l.status='active' AND l.boosted_until > datetime('now') AND c.active=1
    ORDER BY l.boosted_until DESC LIMIT 6`).all();
  const latest = db.prepare(`
    SELECT l.*, c.name cat_name, c.icon cat_icon, a.agency_name, a.verified, a.plan, a.subscribed_until, u.phone agency_phone, ${AGG_RATING}
    FROM listings l
    JOIN categories c ON c.id=l.category_id
    JOIN agency_profiles a ON a.user_id=l.agency_id
    JOIN users u ON u.id=l.agency_id
    WHERE l.status='active' AND c.active=1 ORDER BY l.created_at DESC LIMIT 6`).all();
  const stats = {
    listings: db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active'").get().n,
    agencies: db.prepare('SELECT COUNT(*) n FROM agency_profiles').get().n,
    unlocks: db.prepare('SELECT COUNT(*) n FROM unlocks').get().n,
  };
  const topReviews = db.prepare(`
    SELECT r.rating, r.comment, r.hired, r.created_at, u.name author, l.id listing_id, l.title
    FROM reviews r JOIN users u ON u.id=r.user_id JOIN listings l ON l.id=r.listing_id
    WHERE r.status='publie' AND r.rating >= 4 AND length(COALESCE(r.comment,'')) > 30
    ORDER BY r.created_at DESC LIMIT 3`).all();
  res.render('index', { categories, featured, latest, stats, topReviews, title: 'Personnel domestique de confiance en Côte d\u2019Ivoire' });
});

app.get('/recherche', (req, res) => {
  const { q = '', categorie = '', ville = '', tri = '' } = req.query;
  const categories = db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name').all();

  let sql = `
    SELECT l.*, c.name cat_name, c.icon cat_icon, a.agency_name, a.verified, a.plan, a.subscribed_until, u.phone agency_phone, ${AGG_RATING}
    FROM listings l
    JOIN categories c ON c.id=l.category_id
    JOIN agency_profiles a ON a.user_id=l.agency_id
    JOIN users u ON u.id=l.agency_id
    WHERE l.status='active' AND c.active=1`;
  const p = [];
  if (q) { sql += ' AND (l.title LIKE ? OR l.description LIKE ? OR l.worker_name LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (categorie) { sql += ' AND l.category_id=?'; p.push(Number(categorie)); }
  if (ville) { sql += ' AND (l.ville=? OR l.commune=?)'; p.push(ville, ville); }
  if (tri === 'salaire_asc') sql += ' ORDER BY COALESCE(l.salary_min, 9999999) ASC';
  else if (tri === 'experience') sql += ' ORDER BY l.experience_years DESC';
  else if (tri === 'note') sql += ' ORDER BY agency_rating DESC';
  else sql += ` ORDER BY (l.boosted_until > datetime('now')) DESC, agency_rating IS NULL,
                agency_rating DESC, (a.plan='premium' AND a.subscribed_until > datetime('now')) DESC, l.created_at DESC`;
  sql += ' LIMIT 60';

  const listings = db.prepare(sql).all(...p);
  res.render('search', { listings, categories, q, categorie, ville, tri, villes: H.VILLES.concat(H.COMMUNES), title: 'Rechercher du personnel' });
});

app.get('/annonce/:id', (req, res) => {
  const l = db.prepare(`
    SELECT l.*, c.name cat_name, c.icon cat_icon, a.agency_name, a.description agency_desc,
           a.verified, a.plan, a.subscribed_until, u.phone agency_phone
    FROM listings l
    JOIN categories c ON c.id=l.category_id
    JOIN agency_profiles a ON a.user_id=l.agency_id
    JOIN users u ON u.id=l.agency_id
    WHERE l.id=?`).get(req.params.id);
  if (!l || l.status === 'retiree') return res.status(404).render('error', { title: 'Annonce introuvable', msg: 'Cette annonce n\u2019existe pas ou a été retirée.' });

  const isOwner = req.session.userId === l.agency_id;
  if (!isOwner) {
    db.prepare('UPDATE listings SET views=views+1 WHERE id=?').run(l.id);
    db.prepare(`INSERT INTO listing_views_daily (listing_id,day,n) VALUES (?,date('now'),1)
                ON CONFLICT(listing_id,day) DO UPDATE SET n=n+1`).run(l.id);
  }

  const unlocked = !!(res.locals.user && db.prepare('SELECT 1 FROM unlocks WHERE user_id=? AND listing_id=?').get(res.locals.user.id, l.id));
  const similar = db.prepare(`
    SELECT l.id, l.title, l.worker_name, l.ville, l.commune, l.salary_min, l.salary_max, c.icon cat_icon
    FROM listings l JOIN categories c ON c.id=l.category_id
    WHERE l.status='active' AND l.category_id=? AND l.id<>? LIMIT 3`).all(l.category_id, l.id);

  // Avis vérifiés pour cette annonce
  const revStats = db.prepare("SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE listing_id=? AND status='publie'").get(l.id);
  const reviews = db.prepare(`
    SELECT r.*, u.name AS author FROM reviews r JOIN users u ON u.id=r.user_id
    WHERE r.listing_id=? AND r.status='publie' ORDER BY r.created_at DESC LIMIT 20`).all(l.id);
  const myReview = (res.locals.user && res.locals.user.role === 'user')
    ? db.prepare('SELECT * FROM reviews WHERE user_id=? AND listing_id=?').get(res.locals.user.id, l.id)
    : null;
  const agencyStats = db.prepare("SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE agency_id=? AND status='publie'").get(l.agency_id);
  const pendingUnlock = (res.locals.user && res.locals.user.role === 'user')
    ? db.prepare("SELECT 1 FROM payments WHERE user_id=? AND kind='unlock' AND ref_id=? AND status='en_attente'").get(res.locals.user.id, l.id)
    : null;

  res.render('listing', { l, unlocked, isOwner, similar, revStats, reviews, myReview, agencyStats, pendingUnlock, title: l.title });
});

/* ================================================================== */
/* AVIS VÉRIFIÉS (seuls les déblocages payés peuvent laisser un avis)  */
/* ================================================================== */

app.post('/annonce/:id/avis', requireLogin, requireRole('user'), (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).render('error', { title: 'Introuvable', msg: 'Annonce introuvable.' });

  const unlocked = db.prepare('SELECT 1 FROM unlocks WHERE user_id=? AND listing_id=?').get(req.session.userId, l.id);
  if (!unlocked) {
    flash(req, 'Débloquez d\u2019abord le contact : les avis Domestik CI sont 100 % vérifiés.', 'error');
    return res.redirect('/annonce/' + l.id);
  }
  const rating = Math.min(5, Math.max(0, Number(req.body.rating) || 0));
  if (!rating) { flash(req, 'Choisissez une note de 1 à 5 étoiles.', 'error'); return res.redirect(`/annonce/${l.id}#avis`); }
  const comment = (req.body.comment || '').trim().slice(0, 1000);
  const hired = req.body.hired === '1' ? 1 : (req.body.hired === '0' ? 0 : null);

  const mine = db.prepare('SELECT id FROM reviews WHERE user_id=? AND listing_id=?').get(req.session.userId, l.id);
  if (mine) {
    db.prepare("UPDATE reviews SET rating=?, comment=?, hired=?, created_at=datetime('now') WHERE id=?").run(rating, comment || null, hired, mine.id);
    flash(req, 'Votre avis a été mis à jour ✔');
  } else {
    db.prepare('INSERT INTO reviews (user_id,listing_id,agency_id,rating,comment,hired) VALUES (?,?,?,?,?,?)')
      .run(req.session.userId, l.id, l.agency_id, rating, comment || null, hired);
    notify(l.agency_id, 'review', `Nouvel avis ${rating}/5 ⭐`,
      `Votre annonce « ${l.title} » vient de recevoir un avis vérifié${comment ? ` : « ${comment.slice(0, 90)}… »` : '.'} ` +
      'Vous pouvez y répondre publiquement depuis votre tableau de bord.',
      '/agence#avis');
    flash(req, 'Merci ! Votre avis vérifié aide les prochaines familles 🙏');
  }
  res.redirect(`/annonce/${l.id}#avis`);
});

app.post('/avis/:id/supprimer', requireLogin, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  flash(req, 'Avis supprimé.');
  res.redirect(req.get('referer') || '/');
});

/* Réponse publique de l'agence à un avis */
app.post('/agence/avis/:id/repondre', requireLogin, requireRole('agency'), (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id=? AND agency_id=?').get(req.params.id, req.session.userId);
  if (!r) { flash(req, 'Avis introuvable.', 'error'); return res.redirect('/agence'); }
  const reply = (req.body.reply || '').trim().slice(0, 500);
  db.prepare("UPDATE reviews SET agency_reply=?, replied_at=datetime('now') WHERE id=?").run(reply || null, r.id);
  flash(req, reply ? 'Réponse publiée ✔' : 'Réponse retirée.');
  res.redirect('/agence#avis');
});

/* ================================================================== */
/* PAGE PUBLIQUE D'UNE AGENCE (réputation = cœur de la confiance)      */
/* ================================================================== */

app.get('/agences/:id', (req, res) => {
  const a = db.prepare(`
    SELECT ap.*, u.phone, u.created_at AS member_since
    FROM agency_profiles ap JOIN users u ON u.id=ap.user_id
    WHERE ap.user_id=?`).get(req.params.id);
  if (!a) return res.status(404).render('error', { title: 'Agence introuvable', msg: 'Cette agence n\u2019existe pas.' });

  const revStats = db.prepare("SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE agency_id=? AND status='publie'").get(a.user_id);
  const hires = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE agency_id=? AND status='publie' AND hired=1").get(a.user_id).n;
  const reviews = db.prepare(`
    SELECT r.*, u.name AS author, l.id AS lid, l.title FROM reviews r
    JOIN users u ON u.id=r.user_id JOIN listings l ON l.id=r.listing_id
    WHERE r.agency_id=? AND r.status='publie' ORDER BY r.created_at DESC LIMIT 20`).all(a.user_id);
  const listings = db.prepare(`
    SELECT l.*, c.name cat_name, c.icon cat_icon, a.agency_name, a.verified, a.plan, a.subscribed_until, ${AGG_RATING}
    FROM listings l
    JOIN categories c ON c.id=l.category_id
    JOIN agency_profiles a ON a.user_id=l.agency_id
    WHERE l.agency_id=? AND l.status='active'
    ORDER BY (l.boosted_until > datetime('now')) DESC, l.created_at DESC LIMIT 12`).all(a.user_id);

  res.render('agency', { a, revStats, hires, reviews, listings, title: a.agency_name });
});

/* ================================================================== */
/* AUTH                                                                */
/* ================================================================== */

app.get('/inscription', (req, res) => res.render('register', { title: 'Créer un compte', old: {} }));

app.post('/inscription', (req, res) => {
  const { role, name, email, phone, password, password2, agency_name, commune } = req.body;
  const old = req.body;
  try {
    if (!['user', 'agency'].includes(role)) throw new Error('Choisissez un type de compte.');
    if (!name || !email || !password) throw new Error('Nom, email et mot de passe sont obligatoires.');
    if (password.length < 6) throw new Error('Mot de passe : 6 caractères minimum.');
    if (password !== password2) throw new Error('Les deux mots de passe ne correspondent pas.');
    if (role === 'agency' && !agency_name) throw new Error('Le nom de l\u2019agence est obligatoire.');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase().trim()))
      throw new Error('Cet email est déjà utilisé. Connectez-vous.');

    const hash = bcrypt.hashSync(password, 10);
    const id = db.prepare('INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)')
      .run(name.trim(), email.toLowerCase().trim(), (phone || '').trim(), hash, role).lastInsertRowid;
    if (role === 'agency') {
      db.prepare('INSERT INTO agency_profiles (user_id,agency_name,description,ville,commune) VALUES (?,?,?,?,?)')
        .run(id, agency_name.trim(), (req.body.description || '').trim(), req.body.ville || 'Abidjan', (commune || '').trim());
    }
    req.session.userId = id;
    flash(req, role === 'agency' ? 'Bienvenue ! Publiez votre première annonce.' : 'Bienvenue ! Trouvez le profil idéal.');
    res.redirect(role === 'agency' ? '/agence' : '/recherche');
  } catch (e) {
    flash(req, e.message, 'error');
    res.render('register', { title: 'Créer un compte', old });
  }
});

app.get('/connexion', (req, res) => res.render('login', { title: 'Connexion' }));

app.post('/connexion', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    flash(req, 'Email ou mot de passe incorrect.', 'error');
    return res.redirect('/connexion');
  }
  if (u.active === 0) {
    flash(req, 'Compte désactivé. Contactez le support Domestik CI.', 'error');
    return res.redirect('/connexion');
  }
  req.session.userId = u.id;
  res.redirect(u.role === 'agency' ? '/agence' : u.role === 'admin' ? '/admin' : '/recherche');
});

app.post('/deconnexion', (req, res) => req.session.destroy(() => res.redirect('/')));

/* ================================================================== */
/* ESPACE UTILISATEUR (chercheur de personnel)                         */
/* ================================================================== */

app.get('/mes-contacts', requireLogin, requireRole('user'), (req, res) => {
  const unlocks = db.prepare(`
    SELECT un.created_at paid_at, un.amount, l.id, l.title, l.worker_name, l.ville, l.commune,
           c.icon cat_icon, c.name cat_name, a.agency_name, u.phone agency_phone,
           rev.rating AS my_rating, rev.id AS my_review_id
    FROM unlocks un
    JOIN listings l ON l.id=un.listing_id
    JOIN categories c ON c.id=l.category_id
    JOIN agency_profiles a ON a.user_id=l.agency_id
    JOIN users u ON u.id=l.agency_id
    LEFT JOIN reviews rev ON rev.user_id=un.user_id AND rev.listing_id=un.listing_id
    WHERE un.user_id=? ORDER BY un.created_at DESC`).all(req.session.userId);
  const payments = db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(req.session.userId);
  res.render('user-dashboard', { unlocks, payments, title: 'Mes contacts débloqués' });
});

/* ================================================================== */
/* PAIEMENTS (démo Wave — à brancher sur la vraie API Wave/CinetPay)   */
/* ================================================================== */

/** Récapitulatif avant paiement */
app.get('/paiement/:type', requireLogin, (req, res) => {
  const { type } = req.params;
  const me = res.locals.user;
  let item = null;

  if (type === 'unlock') {
    if (me.role !== 'user') { flash(req, 'Seuls les comptes « chercheur de personnel » peuvent débloquer un contact.', 'error'); return res.redirect('/'); }
    const l = db.prepare('SELECT l.*, a.agency_name FROM listings l JOIN agency_profiles a ON a.user_id=l.agency_id WHERE l.id=? AND l.status=\'active\'').get(req.query.annonce);
    if (!l) return res.status(404).render('error', { title: 'Introuvable', msg: 'Annonce introuvable.' });
    if (db.prepare('SELECT 1 FROM unlocks WHERE user_id=? AND listing_id=?').get(me.id, l.id)) {
      flash(req, 'Contact déjà débloqué.'); return res.redirect('/annonce/' + l.id);
    }
    if (db.prepare("SELECT 1 FROM payments WHERE user_id=? AND kind='unlock' AND ref_id=? AND status='en_attente'").get(me.id, l.id)) {
      flash(req, 'Paiement déjà transmis — validation en cours. ⏳'); return res.redirect('/annonce/' + l.id);
    }
    item = { label: `Déblocage du contact de l'agence — ${l.title}`, amount: H.PRICES.unlock, extra: `?annonce=${l.id}` };
  } else if (type === 'boost') {
    const pack = H.PRICES.boost[req.query.pack];
    if (!pack) { flash(req, 'Offre de boost introuvable.', 'error'); return res.redirect('/agence'); }
    const ids = [...new Set(String(req.query.ids || req.query.annonce || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0))];
    const rows = ids.length ? db.prepare(`SELECT id,title FROM listings WHERE agency_id=? AND status<>'retiree' AND id IN (${ids.map(() => '?').join(',')})`).all(me.id, ...ids) : [];
    if (!rows.length) { flash(req, 'Sélectionnez au moins une de vos annonces à booster.', 'error'); return res.redirect('/agence'); }
    item = {
      label: rows.length === 1 ? `Boost « ${pack.label} » — ${rows[0].title}` : `Boost « ${pack.label} » × ${rows.length} annonces`,
      amount: pack.amount * rows.length,
      extra: `?ids=${rows.map(r => r.id).join(',')}&pack=${req.query.pack}`,
      multi: rows.map(r => r.title),
    };
  } else if (type === 'subscription') {
    if (me.role !== 'agency') { flash(req, 'Réservé aux agences.', 'error'); return res.redirect('/'); }
    item = { label: H.PRICES.subscription.label, amount: H.PRICES.subscription.amount, extra: '' };
  } else {
    return res.status(404).render('error', { title: 'Introuvable', msg: 'Type de paiement inconnu.' });
  }
  res.render('checkout', { type, item, title: 'Paiement Wave' });
});

/** Traitement du paiement (SIMULATION — aucun argent réel débité) */
app.post('/paiement/:type', requireLogin, (req, res) => {
  const { type } = req.params;
  const me = res.locals.user;
  const tel = (req.body.wave_phone || '').trim();
  if (!tel) { flash(req, 'Indiquez votre numéro Wave.', 'error'); return res.redirect(req.originalUrl); }

  if (type === 'unlock') {
    const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.query.annonce);
    if (!l) return res.redirect('/recherche');
    const exists = db.prepare('SELECT 1 FROM unlocks WHERE user_id=? AND listing_id=?').get(me.id, l.id);
    if (exists) { flash(req, 'Contact déjà débloqué.'); return res.redirect('/annonce/' + l.id); }
    const pending = db.prepare("SELECT 1 FROM payments WHERE user_id=? AND kind='unlock' AND ref_id=? AND status='en_attente'").get(me.id, l.id);
    if (pending) { flash(req, 'Paiement déjà transmis — validation en cours. ⏳'); return res.redirect('/annonce/' + l.id); }

    if (H.PRICES.manual_review) {          // mode opérationnel : validation manuelle du transfert Wave
      db.prepare("INSERT INTO payments (user_id,kind,ref_id,label,amount,status) VALUES (?,?,?,?,?,'en_attente')")
        .run(me.id, 'unlock', l.id, 'Déblocage contact agence', H.PRICES.unlock);
      flash(req, 'Paiement transmis ✔ Notre équipe valide les transferts sous 2 h ouvrées — vous serez alerté(e). ⏳');
      return res.redirect('/annonce/' + l.id);
    }

    // mode démo : confirmation immédiate
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO unlocks (user_id,listing_id,amount) VALUES (?,?,?)').run(me.id, l.id, H.PRICES.unlock);
      db.prepare('INSERT INTO payments (user_id,kind,ref_id,label,amount) VALUES (?,?,?,?,?)')
        .run(me.id, 'unlock', l.id, 'Déblocage contact agence', H.PRICES.unlock);
      db.prepare('UPDATE listings SET unlocks=unlocks+1 WHERE id=?').run(l.id);
    });
    tx();
    notify(l.agency_id, 'unlock', 'Nouveau client débloqué !',
      `${H.maskedName(me.name)} vient de débloquer le contact de votre annonce « ${l.title} » (${H.fcfa(H.PRICES.unlock)}). ` +
      'Le client va vous contacter par téléphone ou WhatsApp — répondez vite, la rapidité fait gagner la confiance !',
      `/annonce/${l.id}`);
    flash(req, 'Paiement confirmé ✔ Le numéro de l\u2019agence est débloqué.');
    return res.redirect('/annonce/' + l.id);
  }

  if (type === 'boost') {
    const pack = H.PRICES.boost[req.query.pack];
    if (!pack) return res.redirect('/agence');
    const rawIds = req.query.ids || req.body.ids || req.query.annonce || '';
    const ids = [...new Set([].concat(rawIds).join(',').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0))];
    const rows = ids.length ? db.prepare(`SELECT * FROM listings WHERE agency_id=? AND status<>'retiree' AND id IN (${ids.map(() => '?').join(',')})`).all(me.id, ...ids) : [];
    if (!rows.length) return res.redirect('/agence');
    const label = rows.length === 1 ? pack.label : `${pack.label} × ${rows.length} annonces`;
    const meta = JSON.stringify({ pack: req.query.pack, ids: rows.map(r => r.id) });
    if (H.PRICES.manual_review) {
      db.prepare("INSERT INTO payments (user_id,kind,ref_id,label,amount,status,meta) VALUES (?,?,?,?,?,'en_attente',?)")
        .run(me.id, 'boost', rows[0].id, label, pack.amount * rows.length, meta);
      flash(req, 'Boost transmis ✔ Activation après validation du paiement (sous 2 h ouvrées). ⏳');
      return res.redirect('/agence');
    }
    const tx = db.transaction(() => {
      for (const l of rows) {
        const untilB = addDaysSql(H.isBoosted(l) ? l.boosted_until : H.nowSql(), pack.days);
        db.prepare('UPDATE listings SET boosted_until=? WHERE id=?').run(untilB, l.id);
      }
      db.prepare('INSERT INTO payments (user_id,kind,ref_id,label,amount,meta) VALUES (?,?,?,?,?,?)')
        .run(me.id, 'boost', rows[0].id, label, pack.amount * rows.length, meta);
    });
    tx();
    notify(me.id, 'boost', rows.length === 1 ? 'Boost activé ⚡' : `⚡ ${rows.length} annonces boostées`,
      rows.length === 1
        ? `${pack.label} sur « ${rows[0].title} » — votre annonce est mise en avant pendant ${pack.days} jours.`
        : `${pack.label} activé sur vos ${rows.length} annonces sélectionnées — mise en avant pendant ${pack.days} jours.`,
      '/agence');
    flash(req, `⚡ Boost activé sur ${rows.length} annonce(s) pendant ${pack.days} j.`);
    return res.redirect('/agence');
  }

  if (type === 'subscription') {
    const a = res.locals.agency;
    if (H.PRICES.manual_review) {
      db.prepare("INSERT INTO payments (user_id,kind,label,amount,status) VALUES (?,?,?,?,'en_attente')")
        .run(me.id, 'subscription', H.PRICES.subscription.label, H.PRICES.subscription.amount);
      flash(req, 'Abonnement transmis ✔ Activation après validation du paiement (sous 2 h ouvrées). ⏳');
      return res.redirect('/agence');
    }
    const base = H.isPremium(a) ? a.subscribed_until : H.nowSql();
    const until = new Date(new Date(base.replace(' ', 'T') + 'Z').getTime() + H.PRICES.subscription.days * 86400000)
      .toISOString().slice(0, 19).replace('T', ' ');
    const tx = db.transaction(() => {
      db.prepare("UPDATE agency_profiles SET plan='premium', subscribed_until=? WHERE user_id=?").run(until, me.id);
      db.prepare('INSERT INTO payments (user_id,kind,label,amount) VALUES (?,?,?,?)')
        .run(me.id, 'subscription', H.PRICES.subscription.label, H.PRICES.subscription.amount);
    });
    tx();
    notify(me.id, 'subscription', 'Abonnement Premium activé ★',
      `Votre Premium est actif jusqu'au ${H.fmtDate(until)} : annonces illimitées, priorité dans les recherches et statistiques avancées.`,
      '/agence');
    flash(req, `Abonnement Premium actif jusqu'au ${H.fmtDate(until)} 🎉`);
    return res.redirect('/agence');
  }

  res.redirect('/');
});

/* ================================================================== */
/* ESPACE AGENCE                                                       */
/* ================================================================== */

/** Pseudo-cron : rappels d'expiration (exécuté à chaque visite du dashboard agence).
 *  · Boost expirant dans moins de 48 h  · Premium expirant dans moins de 3 j
 *  Anti-doublon : 1 rappel max par objet et par 24 h. */
function expiryReminders(userId, agency) {
  const soonBoosts = db.prepare(`SELECT id, title, boosted_until FROM listings WHERE agency_id=? AND status='active'
    AND boosted_until > datetime('now') AND boosted_until <= datetime('now','+2 days')`).all(userId);
  soonBoosts.forEach(l => {
    const link = `/annonce/${l.id}`;
    const shown = db.prepare(`SELECT 1 FROM notifications WHERE user_id=? AND kind='boost_end' AND link=? AND created_at >= datetime('now','-1 day')`)
      .get(userId, link);
    if (!shown) notify(userId, 'boost_end', 'Votre boost se termine bientôt ⏳',
      `La mise en avant de « ${l.title} » expire le ${H.fmtDate(l.boosted_until)}. Relancez-la pour garder le cap et les contacts.`, link);
  });
  if (H.isPremium(agency) && H.premiumDaysLeft(agency) <= 3) {
    const shown = db.prepare(`SELECT 1 FROM notifications WHERE user_id=? AND kind='sub_end' AND created_at >= datetime('now','-1 day')`).get(userId);
    if (!shown) notify(userId, 'sub_end', 'Votre Premium expire bientôt ⏳',
      `Plus que ${H.premiumDaysLeft(agency)} jour(s) de Premium. Renouvelez pour garder vos avantages et votre priorité.`, '/agence/abonnement');
  }
}

app.get('/agence', requireLogin, requireRole('agency'), (req, res) => {
  const id = req.session.userId;
  expiryReminders(id, res.locals.agency);
  const listings = db.prepare(`
    SELECT l.*, c.name cat_name, c.icon cat_icon FROM listings l
    JOIN categories c ON c.id=l.category_id
    WHERE l.agency_id=? AND l.status<>'retiree' ORDER BY l.created_at DESC`).all(id);
  const rating = db.prepare("SELECT ROUND(AVG(rating),1) AS a, COUNT(*) AS n FROM reviews WHERE agency_id=? AND status='publie'").get(id);
  const stats = {
    actives: listings.filter(l => l.status === 'active').length,
    views: listings.reduce((s, l) => s + l.views, 0),
    leads: listings.reduce((s, l) => s + l.unlocks, 0),
    boosts: listings.filter(l => H.isBoosted(l)).length,
    leads30: db.prepare(`SELECT COUNT(*) n FROM unlocks un JOIN listings l ON l.id=un.listing_id
                         WHERE l.agency_id=? AND un.created_at >= datetime('now','-30 days')`).get(id).n,
    ratingAvg: rating.a,
    ratingCount: rating.n,
  };
  const reviews = db.prepare(`
    SELECT r.*, u.name AS author, l.title, l.id AS lid FROM reviews r
    JOIN users u ON u.id=r.user_id JOIN listings l ON l.id=r.listing_id
    WHERE r.agency_id=? ORDER BY r.created_at DESC LIMIT 15`).all(id);
  const payments = db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 10').all(id);
  const lastNotifs = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 4').all(id);

  /* Statistiques avancées : vues quotidiennes 30 j + performance par annonce */
  const byDay = Object.fromEntries(db.prepare(`
    SELECT d.day, SUM(d.n) t FROM listing_views_daily d
    JOIN listings l ON l.id=d.listing_id
    WHERE l.agency_id=? AND d.day >= date('now','-29 days')
    GROUP BY d.day`).all(id).map(r => [r.day, r.t]));
  const viewsDaily = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    viewsDaily.push({ day, label: day.slice(8) + '/' + day.slice(5, 7), n: byDay[day] || 0 });
  }
  const views30 = viewsDaily.reduce((s, d) => s + d.n, 0);
  const top30 = db.prepare(`
    SELECT l.id, l.title, SUM(d.n) v30 FROM listing_views_daily d
    JOIN listings l ON l.id=d.listing_id
    WHERE l.agency_id=? AND d.day >= date('now','-29 days')
    GROUP BY l.id ORDER BY v30 DESC LIMIT 3`).all(id);
  stats.views30 = views30;
  stats.conv30 = views30 ? Math.round((stats.leads30 / views30) * 100) : 0;

  res.render('agency-dashboard', { listings, stats, payments, reviews, lastNotifs, viewsDaily, top30, KIND_ICONS, title: 'Tableau de bord agence' });
});

/* ================================================================== */
/* NOTIFICATIONS AGENCE                                                */
/* ================================================================== */

app.get('/agence/notifications', requireLogin, (req, res) => res.redirect('/notifications'));

app.get('/notifications', requireLogin, (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.session.userId);
  res.render('notifications', { notifs, KIND_ICONS, title: 'Notifications' });
});

app.post('/notifications/:id/lu', requireLogin, (req, res) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (n) {
    db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND read_at IS NULL").run(n.id);
    if (n.link) return res.redirect(n.link);
  }
  res.redirect('/notifications');
});

app.post('/notifications/tout-lu', requireLogin, (req, res) => {
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL").run(req.session.userId);
  res.redirect('/notifications');
});

app.post('/agence/notifications/:id/lu', requireLogin, requireRole('agency'), (req, res) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (n) {
    db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND read_at IS NULL").run(n.id);
    if (n.link) return res.redirect(n.link);
  }
  res.redirect('/agence/notifications');
});

app.post('/agence/notifications/tout-lu', requireLogin, requireRole('agency'), (req, res) => {
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL").run(req.session.userId);
  res.redirect('/agence/notifications');
});

app.post('/agence/notifications/whatsapp-toggle', requireLogin, requireRole('agency'), (req, res) => {
  const a = res.locals.agency;
  db.prepare('UPDATE agency_profiles SET notify_wa=? WHERE user_id=?').run(a.notify_wa ? 0 : 1, a.user_id);
  flash(req, a.notify_wa ? 'Alertes WhatsApp désactivées (les notifications restent dans l\u2019app).' : 'Alertes WhatsApp activées 🔔');
  res.redirect('/agence/notifications');
});

app.get('/agence/annonces/nouvelle', requireLogin, requireRole('agency'), (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name').all();
  if (!res.locals.isPremium) {
    const n = db.prepare("SELECT COUNT(*) n FROM listings WHERE agency_id=? AND status<>'retiree'").get(req.session.userId).n;
    if (n >= 3) { flash(req, 'Offre gratuite : 3 annonces maximum. Passez Premium pour des annonces illimitées.', 'error'); return res.redirect('/agence/abonnement'); }
  }
  res.render('listing-form', { categories, l: null, action: '/agence/annonces/nouvelle', title: 'Nouvelle annonce' });
});

function parseListing(body) {
  return {
    category_id: Number(body.category_id),
    title: (body.title || '').trim().slice(0, 120),
    worker_name: (body.worker_name || '').trim().slice(0, 60),
    gender: body.gender === 'M' ? 'M' : 'F',
    age: body.age ? Math.min(80, Math.max(18, Number(body.age))) : null,
    experience_years: Math.min(50, Math.max(0, Number(body.experience_years) || 0)),
    description: (body.description || '').trim(),
    ville: (body.ville || 'Abidjan').trim(),
    commune: (body.commune || '').trim(),
    salary_min: Number(body.salary_min) || null,
    salary_max: Number(body.salary_max) || null,
    contract_type: ['Temps plein', 'Temps partiel', 'À la journée'].includes(body.contract_type) ? body.contract_type : 'Temps plein',
    availability: ['Immédiate', 'Sous 1 semaine', 'Sous 1 mois'].includes(body.availability) ? body.availability : 'Immédiate',
  };
}
const validateListing = d => {
  if (!d.category_id || !db.prepare('SELECT 1 FROM categories WHERE id=? AND active=1').get(d.category_id)) throw new Error('Choisissez une catégorie valide.');
  if (!d.title || !d.worker_name) throw new Error('Titre et prénom du personnel obligatoires.');
  if (d.description.length < 20) throw new Error('Décrivez le profil en au moins 20 caractères (compétences, références…).');
  if (d.salary_min && d.salary_max && d.salary_min > d.salary_max) throw new Error('Salaire minimum supérieur au maximum.');
};

app.post('/agence/annonces/nouvelle', requireLogin, requireRole('agency'), photoUpload(flash), async (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name').all();
  try {
    const d = parseListing(req.body);
    validateListing(d);
    const photo = req.file ? await processPhoto(req.file.buffer) : null;
    const id = db.prepare(`INSERT INTO listings
      (agency_id,category_id,title,worker_name,gender,age,experience_years,description,ville,commune,salary_min,salary_max,contract_type,availability,photo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.session.userId, d.category_id, d.title, d.worker_name, d.gender, d.age, d.experience_years,
        d.description, d.ville, d.commune, d.salary_min, d.salary_max, d.contract_type, d.availability, photo).lastInsertRowid;
    flash(req, 'Annonce publiée ✔' + (photo ? ' — photo ajoutée 📸' : ''));
    res.redirect('/annonce/' + id);
  } catch (e) {
    flash(req, e.message, 'error');
    res.render('listing-form', { categories, l: req.body, action: '/agence/annonces/nouvelle', title: 'Nouvelle annonce' });
  }
});

app.get('/agence/annonces/:id/modifier', requireLogin, requireRole('agency'), (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND agency_id=?').get(req.params.id, req.session.userId);
  if (!l) { flash(req, 'Annonce introuvable.', 'error'); return res.redirect('/agence'); }
  const categories = db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name').all();
  res.render('listing-form', { categories, l, action: `/agence/annonces/${l.id}/modifier`, title: 'Modifier l\u2019annonce' });
});

app.post('/agence/annonces/:id/modifier', requireLogin, requireRole('agency'), photoUpload(flash), async (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND agency_id=?').get(req.params.id, req.session.userId);
  if (!l) return res.redirect('/agence');
  const categories = db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name').all();
  try {
    const d = parseListing(req.body);
    validateListing(d);
    const photo = req.file ? await processPhoto(req.file.buffer) : l.photo;
    db.prepare(`UPDATE listings SET category_id=?, title=?, worker_name=?, gender=?, age=?, experience_years=?,
      description=?, ville=?, commune=?, salary_min=?, salary_max=?, contract_type=?, availability=?, photo=? WHERE id=?`)
      .run(d.category_id, d.title, d.worker_name, d.gender, d.age, d.experience_years, d.description,
        d.ville, d.commune, d.salary_min, d.salary_max, d.contract_type, d.availability, photo, l.id);
    if (req.file && l.photo) deletePhoto(l.photo);           // libère l'ancienne image
    flash(req, 'Annonce mise à jour ✔' + (req.file ? ' — nouvelle photo 📸' : ''));
    res.redirect('/agence');
  } catch (e) {
    flash(req, e.message, 'error');
    res.render('listing-form', { categories, l: { ...req.body, id: l.id }, action: `/agence/annonces/${l.id}/modifier`, title: 'Modifier l\u2019annonce' });
  }
});

app.post('/agence/annonces/:id/statut', requireLogin, requireRole('agency'), (req, res) => {
  const s = { pause: 'pause', active: 'active', pourvue: 'pourvue' }[req.body.statut];
  if (s) {
    db.prepare('UPDATE listings SET status=? WHERE id=? AND agency_id=?').run(s, req.params.id, req.session.userId);
    flash(req, { pause: 'Annonce mise en pause.', active: 'Annonce réactivée.', pourvue: 'Annonce marquée « pourvue ». Félicitations ! 🎉' }[s]);
  }
  res.redirect('/agence');
});

app.post('/agence/annonces/:id/retirer', requireLogin, requireRole('agency'), (req, res) => {
  db.prepare("UPDATE listings SET status='retiree' WHERE id=? AND agency_id=?").run(req.params.id, req.session.userId);
  flash(req, 'Annonce retirée.');
  res.redirect('/agence');
});

/** Actions groupées : publier / pause / pourvue sur la sélection (cases à cocher du dashboard) */
app.post('/agence/annonces/groupe', requireLogin, requireRole('agency'), (req, res) => {
  const action = { active: 'active', pause: 'pause', pourvue: 'pourvue' }[req.query.action];
  const ids = [].concat(req.body.ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!action || !ids.length) { flash(req, 'Sélectionnez au moins une annonce puis une action.', 'error'); return res.redirect('/agence'); }
  const upd = db.prepare('UPDATE listings SET status=? WHERE id=? AND agency_id=?');
  const tx = db.transaction(() => { for (const i of ids) upd.run(action, i, req.session.userId); });
  tx();
  const lib = { active: 'réactivée(s)', pause: 'mise(s) en pause', pourvue: 'marquée(s) « pourvue »' }[action];
  flash(req, `✔ ${ids.length} annonce(s) ${lib} en une fois.`);
  res.redirect('/agence');
});

/** Dupliquer une annonce (copie à personnaliser — gains de temps pour l'agence) */
app.post('/agence/annonces/:id/dupliquer', requireLogin, requireRole('agency'), (req, res) => {
  const l = db.prepare("SELECT * FROM listings WHERE id=? AND agency_id=? AND status<>'retiree'").get(req.params.id, req.session.userId);
  if (!l) { flash(req, 'Annonce introuvable.', 'error'); return res.redirect('/agence'); }
  if (!res.locals.isPremium) {
    const n = db.prepare("SELECT COUNT(*) n FROM listings WHERE agency_id=? AND status<>'retiree'").get(req.session.userId).n;
    if (n >= 3) { flash(req, 'Offre gratuite : 3 annonces maximum. Passez Premium pour des annonces illimitées.', 'error'); return res.redirect('/agence/abonnement'); }
  }
  const cols = ['category_id', 'agency_id', 'worker_name', 'gender', 'age', 'experience_years', 'title', 'description', 'ville', 'commune', 'salary_min', 'salary_max', 'contract_type', 'availability', 'photo', 'status'];
  const ins = db.prepare(`INSERT INTO listings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  ins.run(...cols.map(c => c === 'title' ? (l.title + '').slice(0, 108) : l[c]));
  flash(req, `Annonce « ${l.title} » dupliquée ✔ Modifiez la copie pour la personnaliser.`);
  res.redirect('/agence');
});

/** Export CSV de ses propres annonces */
app.get('/agence/export/annonces.csv', requireLogin, requireRole('agency'), (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.title, c.name categorie, l.worker_name, l.ville, l.commune, l.salary_min, l.salary_max,
           l.status, l.views, l.unlocks, l.boosted_until, l.created_at
    FROM listings l JOIN categories c ON c.id=l.category_id
    WHERE l.agency_id=? AND l.status<>'retiree' ORDER BY l.created_at DESC`).all(req.session.userId);
  sendCsv(res, 'mes-annonces.csv',
    ['ID', 'Titre', 'Catégorie', 'Profil', 'Ville', 'Commune', 'Salaire min', 'Salaire max', 'Statut', 'Vues', 'Contacts débloqués', 'Boosté jusqu au', 'Publiée le'],
    rows.map(r => [r.id, r.title, r.categorie, r.worker_name, r.ville, r.commune || '', r.salary_min || '', r.salary_max || '', r.status, r.views, r.unlocks, r.boosted_until || '', r.created_at]));
});

app.get('/agence/abonnement', requireLogin, requireRole('agency'), (req, res) => {
  res.render('subscribe', { title: 'Abonnement Premium' });
});

/* ================================================================== */
/* ADMIN — tour de contrôle du propriétaire de la plateforme           */
/* ================================================================== */
const requireAdmin = requireRole('admin');

const KIND_LABELS = { unlock: '🔓 Déblocage', boost: '⚡ Boost', subscription: '⭐ Abonnement' };

app.get('/admin', requireAdmin, (req, res) => {
  const rev = {
    total: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments').get().s,
    m30: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE created_at >= datetime('now','-30 days')").get().s,
  };
  const byKind = {};
  db.prepare('SELECT kind, COALESCE(SUM(amount),0) t, COUNT(*) n FROM payments GROUP BY kind').all()
    .forEach(k => { byKind[k.kind] = k; });

  // Graphique : revenus des 30 derniers jours
  const raw = db.prepare(`SELECT date(created_at) d, SUM(amount) t FROM payments
    WHERE created_at >= date('now','-29 days') GROUP BY date(created_at)`).all();
  const byDay = Object.fromEntries(raw.map(r => [r.d, r.t]));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    days.push({ d: key, label: dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), t: byDay[key] || 0 });
  }
  const maxDay = Math.max(...days.map(d => d.t), 1);

  const counts = {
    users: db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n,
    agencies: db.prepare('SELECT COUNT(*) n FROM agency_profiles').get().n,
    agenciesVerified: db.prepare('SELECT COUNT(*) n FROM agency_profiles WHERE verified=1').get().n,
    listingsActive: db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active'").get().n,
    listingsTotal: db.prepare('SELECT COUNT(*) n FROM listings').get().n,
    unlocks: db.prepare('SELECT COUNT(*) n FROM unlocks').get().n,
    views: db.prepare('SELECT COALESCE(SUM(views),0) n FROM listings').get().n,
    reviews: db.prepare('SELECT COUNT(*) n FROM reviews').get().n,
    reviewsMasked: db.prepare("SELECT COUNT(*) n FROM reviews WHERE status='masque'").get().n,
  };
  const rating = db.prepare("SELECT ROUND(AVG(rating),1) a FROM reviews WHERE status='publie'").get().a;
  const lastPayments = db.prepare(`
    SELECT p.*, u.name AS payer FROM payments p JOIN users u ON u.id=p.user_id
    ORDER BY p.created_at DESC LIMIT 12`).all();
  const pendingPay = db.prepare("SELECT COUNT(*) n FROM payments WHERE status='en_attente'").get().n;
  const newMessages = db.prepare("SELECT COUNT(*) n FROM messages WHERE status='nouveau'").get().n;
  const lastAudit = db.prepare(`
    SELECT al.*, u.name AS admin_name FROM audit_log al JOIN users u ON u.id=al.admin_id
    ORDER BY al.created_at DESC LIMIT 10`).all();

  res.render('admin/dashboard', { rev, byKind, days, maxDay, counts, rating, lastPayments, pendingPay, newMessages, lastAudit, KIND_LABELS, GOAL: 500000, active: 'dashboard', title: 'Admin — table de pilotage' });
});

/* ---------------- Agences ---------------- */
app.get('/admin/agences', requireAdmin, (req, res) => {
  const agencies = db.prepare(`
    SELECT ap.*, u.name, u.email, u.phone, u.created_at,
      (SELECT COUNT(*) FROM listings l WHERE l.agency_id=ap.user_id AND l.status<>'retiree') n_listings,
      (SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.agency_id=ap.user_id AND r.status='publie') rating,
      (SELECT COUNT(*) FROM reviews r WHERE r.agency_id=ap.user_id AND r.status='publie') n_reviews
    FROM agency_profiles ap JOIN users u ON u.id=ap.user_id
    ORDER BY u.created_at DESC`).all();
  res.render('admin/agencies', { agencies, active: 'agences', title: 'Admin — agences' });
});

/** Déclaré plus bas dans la section back-office ; hoisting var pour usage amont. */
var audit;

app.post('/admin/agences/:id/verifier', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM agency_profiles WHERE user_id=?').get(req.params.id);
  if (!a) return res.redirect('/admin/agences');
  db.prepare('UPDATE agency_profiles SET verified=? WHERE user_id=?').run(a.verified ? 0 : 1, a.user_id);
  audit(req, a.verified ? 'retirer badge vérifiée' : 'attribuer badge vérifiée', a.agency_name);
  flash(req, a.verified ? 'Badge « vérifiée » retiré.' : `✔ Badge « vérifiée » attribué à ${a.agency_name}`);
  res.redirect('/admin/agences');
});

app.post('/admin/agences/:id/premium', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM agency_profiles WHERE user_id=?').get(req.params.id);
  if (!a) return res.redirect('/admin/agences');
  if (H.isPremium(a)) {
    db.prepare("UPDATE agency_profiles SET plan='free', subscribed_until=NULL WHERE user_id=?").run(a.user_id);
    audit(req, 'retirer Premium', a.agency_name);
    flash(req, 'Offre Premium retirée.');
  } else {
    db.prepare("UPDATE agency_profiles SET plan='premium', subscribed_until=datetime('now','+30 days') WHERE user_id=?").run(a.user_id);
    audit(req, 'offrir Premium', a.agency_name, '30 jours');
    flash(req, `⭐ Premium offert à ${a.agency_name} (30 jours).`);
  }
  res.redirect('/admin/agences');
});

/* ---------------- Annonces ---------------- */
app.get('/admin/annonces', requireAdmin, (req, res) => {
  const listings = db.prepare(`
    SELECT l.*, c.icon cat_icon, c.name cat_name, a.agency_name
    FROM listings l JOIN categories c ON c.id=l.category_id JOIN agency_profiles a ON a.user_id=l.agency_id
    ORDER BY l.created_at DESC LIMIT 100`).all();
  res.render('admin/listings', { listings, active: 'annonces', title: 'Admin — annonces' });
});

app.post('/admin/annonces/:id/statut', requireAdmin, (req, res) => {
  const s = { retiree: 'retiree', active: 'active' }[req.body.statut];
  if (s) {
    db.prepare('UPDATE listings SET status=? WHERE id=?').run(s, req.params.id);
    audit(req, s === 'retiree' ? 'retirer annonce' : 'restaurer annonce', `#${req.params.id}`);
    flash(req, s === 'retiree' ? 'Annonce retirée de la plateforme (modération).' : 'Annonce restaurée.');
  }
  res.redirect('/admin/annonces');
});

/* ---------------- Avis ---------------- */
app.get('/admin/avis', requireAdmin, (req, res) => {
  const reviews = db.prepare(`
    SELECT r.*, u.name author, l.id lid, l.title, ap.agency_name
    FROM reviews r JOIN users u ON u.id=r.user_id
    JOIN listings l ON l.id=r.listing_id
    JOIN agency_profiles ap ON ap.user_id=r.agency_id
    ORDER BY r.status='masque' DESC, r.rating ASC, r.created_at DESC LIMIT 50`).all();
  res.render('admin/reviews', { reviews, active: 'avis', title: 'Admin — modération des avis' });
});

app.post('/admin/avis/:id/moderer', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(req.params.id);
  if (!r) return res.redirect('/admin/avis');
  const next = r.status === 'publie' ? 'masque' : 'publie';
  db.prepare('UPDATE reviews SET status=? WHERE id=?').run(next, r.id);
  audit(req, next === 'masque' ? 'masquer avis' : 'republier avis', `#${r.id}`, `${r.rating}/5`);
  flash(req, next === 'masque' ? 'Avis masqué (invisible partout).' : 'Avis republié.');
  res.redirect('/admin/avis');
});

/* ---------------- File WhatsApp (envoi manuel → auto avec API Meta) ---------------- */
app.get('/admin/whatsapp', requireAdmin, (req, res) => {
  const queued = db.prepare(`
    SELECT n.*, u.name AS dest_name, u.phone AS dest_phone
    FROM notifications n JOIN users u ON u.id=n.user_id
    WHERE n.wa_status='queued' ORDER BY n.created_at ASC LIMIT 40`).all();
  const sent = db.prepare(`
    SELECT n.*, u.name AS dest_name FROM notifications n JOIN users u ON u.id=n.user_id
    WHERE n.wa_status='sent' ORDER BY n.created_at DESC LIMIT 15`).all();
  res.render('admin/whatsapp', { queued, sent, waManualLink, KIND_ICONS, active: 'whatsapp', title: 'Admin — file WhatsApp' });
});

app.post('/admin/whatsapp/:id/envoye', requireAdmin, (req, res) => {
  db.prepare("UPDATE notifications SET wa_status='sent' WHERE id=?").run(req.params.id);
  res.redirect('/admin/whatsapp');
});

/* ================================================================== */
/* BACK-OFFICE AVANCÉ                                                  */
/* ================================================================== */

/** Journal d'audit : qui a fait quoi (var 'audit' déclarée plus haut, affectée ici) */
audit = (req, action, target, detail = '') =>
  db.prepare('INSERT INTO audit_log (admin_id,action,target,detail) VALUES (?,?,?,?)').run(req.session.userId, action, target, detail);

const addDaysSql = (base, days) =>
  new Date(new Date(base.replace(' ', 'T') + 'Z').getTime() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

/** Applique l'effet d'un paiement validé manuellement (unlock / boost / abonnement) */
function applyPayment(p) {
  if (p.kind === 'unlock' && p.ref_id) {
    const l = db.prepare('SELECT * FROM listings WHERE id=?').get(p.ref_id);
    const payer = db.prepare('SELECT name FROM users WHERE id=?').get(p.user_id);
    db.prepare('INSERT OR IGNORE INTO unlocks (user_id,listing_id,amount) VALUES (?,?,?)').run(p.user_id, p.ref_id, p.amount);
    db.prepare('UPDATE listings SET unlocks=unlocks+1 WHERE id=?').run(p.ref_id);
    if (l) {
      notify(l.agency_id, 'unlock', 'Nouveau client débloqué !',
        `${H.maskedName(payer ? payer.name : 'Un client')} vient de débloquer le contact de votre annonce « ${l.title} » (${H.fcfa(p.amount)}). Répondez vite à son appel !`, `/annonce/${l.id}`);
      notify(p.user_id, 'unlock_ok', 'Contact débloqué ✅',
        `Votre paiement a été validé : le numéro de l'agence pour « ${l.title} » est désormais visible. Bonne suite !`, `/annonce/${l.id}`);
    }
  }
  if (p.kind === 'boost') {
    let meta = {};
    try { meta = p.meta ? JSON.parse(p.meta) : {}; } catch (e) { /* meta illisible */ }
    const pack = H.PRICES.boost[meta.pack];
    const ids = Array.isArray(meta.ids) && meta.ids.length
      ? meta.ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : (p.ref_id ? [p.ref_id] : []);
    if (pack && ids.length) {
      let n = 0;
      for (const lid of ids) {
        const l = db.prepare('SELECT * FROM listings WHERE id=?').get(lid);
        if (!l) continue;
        const until = addDaysSql(H.isBoosted(l) ? l.boosted_until : H.nowSql(), pack.days);
        db.prepare('UPDATE listings SET boosted_until=? WHERE id=?').run(until, l.id);
        n++;
      }
      if (n) notify(p.user_id, 'boost', n === 1 ? 'Boost activé ⚡' : `⚡ ${n} annonces boostées`,
        `${pack.label} — vos ${n > 1 ? n + ' annonces sélectionnées sont' : 'annonce est'} mise${n > 1 ? 's' : ''} en avant pendant ${pack.days} jours.`, '/agence');
    }
  }
  if (p.kind === 'subscription') {
    const a = db.prepare('SELECT * FROM agency_profiles WHERE user_id=?').get(p.user_id);
    if (a) {
      const until = addDaysSql(H.isPremium(a) ? a.subscribed_until : H.nowSql(), H.PRICES.subscription.days);
      db.prepare("UPDATE agency_profiles SET plan='premium', subscribed_until=? WHERE user_id=?").run(until, p.user_id);
      notify(p.user_id, 'subscription', 'Abonnement Premium activé ★',
        `Votre Premium est actif jusqu'au ${H.fmtDate(until)} : annonces illimitées, priorité et statistiques avancées.`, '/agence');
    }
  }
}

/* ---------------- Paiements & validation manuelle ---------------- */
app.get('/admin/paiements', requireAdmin, (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, u.name payer, u.email payer_email, u.phone payer_phone,
           (SELECT title FROM listings WHERE id=p.ref_id) AS listing_title
    FROM payments p JOIN users u ON u.id=p.user_id
    ORDER BY p.status='en_attente' DESC, p.created_at DESC LIMIT 200`).all();
  const pending = payments.filter(p => p.status === 'en_attente').length;
  res.render('admin/payments', { payments, pending, KIND_LABELS, active: 'paiements', title: 'Admin — paiements' });
});

app.post('/admin/paiements/:id/valider', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
  if (!p || p.status !== 'en_attente') { flash(req, 'Paiement déjà traité.', 'error'); return res.redirect('/admin/paiements'); }
  db.prepare("UPDATE payments SET status='success' WHERE id=?").run(p.id);
  applyPayment(p);
  audit(req, 'valider paiement', `#${p.id}`, `${p.kind} — ${H.fcfa(p.amount)}`);
  flash(req, `Paiement #${p.id} validé ✔ Effets appliqués.`);
  res.redirect('/admin/paiements');
});

app.post('/admin/paiements/:id/rejeter', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
  if (!p || p.status !== 'en_attente') return res.redirect('/admin/paiements');
  db.prepare("UPDATE payments SET status='rejete' WHERE id=?").run(p.id);
  notify(p.user_id, 'payment_ko', 'Paiement non confirmé ⚠️',
    `Votre paiement « ${p.label} » (${H.fcfa(p.amount)}) n'a pas pu être confirmé. Vérifiez votre transfert Wave ou contactez-nous.`, '/contact');
  audit(req, 'rejeter paiement', `#${p.id}`, `${p.kind} — ${H.fcfa(p.amount)}`);
  flash(req, `Paiement #${p.id} rejeté.`);
  res.redirect('/admin/paiements');
});

/* ---------------- Exports CSV (comptabilité) ---------------- */
function sendCsv(res, filename, header, rows) {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [header, ...rows].map(r => r.map(esc).join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

app.get('/admin/export/paiements.csv', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT p.*, u.name payer FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC`).all();
  sendCsv(res, 'paiements-domestik-ci.csv',
    ['Date', 'Payeur', 'Type', 'Opération', 'Montant FCFA', 'Statut'],
    rows.map(p => [p.created_at, p.payer, p.kind, p.label, p.amount, p.status]));
});

app.get('/admin/export/utilisateurs.csv', requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM users WHERE role <> 'admin' ORDER BY created_at DESC").all();
  sendCsv(res, 'utilisateurs-domestik-ci.csv',
    ['Date inscription', 'Nom', 'Email', 'Téléphone', 'Rôle', 'Actif'],
    rows.map(u => [u.created_at, u.name, u.email, u.phone || '', u.role, u.active ? 'oui' : 'non']));
});

/* ---------------- Réglages (prix, mode paiement, téléphone) ---------------- */
const SETTING_KEYS = ['price_unlock', 'boost_pop_amount', 'boost_pop_days', 'boost_vip_amount', 'boost_vip_days', 'sub_amount', 'sub_days', 'platform_phone', 'manual_review'];

app.get('/admin/reglages', requireAdmin, (req, res) => {
  res.render('admin/settings', { active: 'reglages', title: 'Admin — réglages' });
});

app.post('/admin/reglages', requireAdmin, (req, res) => {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(() => {
    ['price_unlock', 'boost_pop_amount', 'boost_pop_days', 'boost_vip_amount', 'boost_vip_days', 'sub_amount', 'sub_days']
      .forEach(k => { const v = Math.max(1, Math.round(Number(req.body[k]) || 0)); if (v) up.run(k, String(v)); });
    up.run('platform_phone', (req.body.platform_phone || '').trim().slice(0, 30));
    up.run('manual_review', req.body.manual_review === 'on' ? '1' : '0');
  });
  tx();
  H.refreshPrices(true);
  audit(req, 'modifier réglages', 'tarifs/paiement', JSON.stringify(req.body).slice(0, 200));
  flash(req, 'Réglages enregistrés ✔ Appliqués immédiatement sur tout le site.');
  res.redirect('/admin/reglages');
});

/* ---------------- Contenus du site (mini-CMS) ---------------- */

app.get('/admin/contenus', requireAdmin, (req, res) => {
  res.render('admin/content', { FORM: C.CONTENT_FORM, SITE: C.all(true), active: 'contenus', title: 'Admin — contenus du site' });
});

app.post('/admin/contenus', requireAdmin, (req, res) => {
  const fields = C.CONTENT_FORM.flatMap(s => s.fields).filter(f => ['text', 'html', 'textarea', 'toggle'].includes(f.kind));
  for (const f of fields) {
    if (f.kind === 'toggle') C.set(f.key, req.body[f.key] === 'on' ? '1' : '0');
    else if (req.body[f.key] != null) C.set(f.key, String(req.body[f.key]).trim().slice(0, f.kind === 'textarea' ? 500 : 250));
  }
  audit(req, 'modifier contenus', 'site', 'textes du site mis à jour');
  flash(req, 'Contenus enregistrés ✔ Visibles immédiatement sur le site.');
  res.redirect('/admin/contenus');
});

app.post('/admin/contenus/image', requireAdmin, photoUpload(flash), async (req, res) => {
  const key = String(req.body.champ || '');
  if (!C.IMAGE_KEYS.includes(key)) { flash(req, 'Champ image inconnu.', 'error'); return res.redirect('/admin/contenus'); }
  if (!req.file) { flash(req, 'Choisissez une image (JPG, PNG ou WEBP, 5 Mo max).', 'error'); return res.redirect('/admin/contenus'); }
  try {
    const p = await processSiteImage(req.file.buffer, key);
    C.set(key, p + '?v=' + Date.now());
    audit(req, 'modifier image', key);
    flash(req, 'Image mise à jour ✔ Elle est en ligne.');
  } catch (e) {
    flash(req, "Impossible de traiter l'image : " + e.message, 'error');
  }
  res.redirect('/admin/contenus');
});

/** Retirer une image de section (retour à la mise en page sans image) */
app.post('/admin/contenus/image-retirer', requireAdmin, (req, res) => {
  const key = String(req.body.champ || '');
  if (C.IMAGE_KEYS.includes(key)) { C.set(key, ''); audit(req, 'retirer image', key); flash(req, 'Image retirée.'); }
  res.redirect('/admin/contenus');
});

/* ---------------- Catégories ---------------- */
app.get('/admin/categories', requireAdmin, (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM listings l WHERE l.category_id=c.id AND l.status<>'retiree') n
    FROM categories c ORDER BY c.active DESC, c.id`).all();
  const editing = req.query.edit ? categories.find(c => c.id === Number(req.query.edit)) : null;
  res.render('admin/categories', { categories, editing, active: 'categories', title: 'Admin — catégories' });
});

app.post('/admin/categories', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) { flash(req, 'Nom de catégorie obligatoire.', 'error'); return res.redirect('/admin/categories'); }
  const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    db.prepare('INSERT INTO categories (name,slug,icon,description) VALUES (?,?,?,?)')
      .run(name, slug, (req.body.icon || '📌').trim(), (req.body.description || '').trim());
    audit(req, 'créer catégorie', name);
    flash(req, `Catégorie « ${name} » créée ✔`);
  } catch {
    flash(req, 'Cette catégorie existe déjà.', 'error');
  }
  res.redirect('/admin/categories');
});

app.post('/admin/categories/:id/modifier', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.redirect('/admin/categories');
  db.prepare('UPDATE categories SET name=?, icon=?, description=? WHERE id=?')
    .run((req.body.name || c.name).trim(), (req.body.icon || c.icon).trim(), (req.body.description ?? c.description).trim(), c.id);
  audit(req, 'modifier catégorie', c.name);
  flash(req, 'Catégorie mise à jour ✔');
  res.redirect('/admin/categories');
});

app.post('/admin/categories/:id/basculer', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.redirect('/admin/categories');
  db.prepare('UPDATE categories SET active=? WHERE id=?').run(c.active ? 0 : 1, c.id);
  audit(req, c.active ? 'désactiver catégorie' : 'activer catégorie', c.name);
  flash(req, c.active ? `Catégorie « ${c.name} » masquée du site.` : `Catégorie « ${c.name} » visible à nouveau.`);
  res.redirect('/admin/categories');
});

/* ---------------- Messages de contact ---------------- */
app.get('/admin/messages', requireAdmin, (req, res) => {
  const messages = db.prepare("SELECT * FROM messages ORDER BY status='traite', created_at DESC LIMIT 100").all();
  res.render('admin/messages', { messages, active: 'messages', title: 'Admin — messages' });
});

app.post('/admin/messages/:id/statut', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (m) db.prepare('UPDATE messages SET status=? WHERE id=?').run(m.status === 'nouveau' ? 'traite' : 'nouveau', m.id);
  res.redirect('/admin/messages');
});

/* ---------------- Comptes utilisateurs ---------------- */
app.post('/admin/utilisateurs/:id/basculer', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u || u.role === 'admin') return res.redirect('/admin/utilisateurs');
  db.prepare('UPDATE users SET active=? WHERE id=?').run(u.active ? 0 : 1, u.id);
  audit(req, u.active ? 'désactiver compte' : 'réactiver compte', u.email);
  flash(req, u.active ? `Compte de ${u.name} désactivé.` : `Compte de ${u.name} réactivé.`);
  res.redirect('/admin/utilisateurs');
});

/* ---------------- Utilisateurs ---------------- */
app.get('/admin/utilisateurs', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM unlocks un WHERE un.user_id=u.id) n_unlocks,
      (SELECT COUNT(*) FROM reviews rv WHERE rv.user_id=u.id) n_reviews
    FROM users u WHERE u.role <> 'admin'
    ORDER BY u.active DESC, u.created_at DESC LIMIT 200`).all();
  res.render('admin/users', { users, active: 'utilisateurs', title: 'Admin — utilisateurs' });
});

/* ================================================================== */
/* PAGE CONTACT (publique) → boîte de réception admin                  */
/* ================================================================== */

app.get('/contact', (req, res) => res.render('contact', { title: 'Nous contacter' }));

app.post('/contact', (req, res) => {
  const { name = '', email = '', phone = '', subject = '', body = '' } = req.body;
  if (!name.trim() || !email.trim() || body.trim().length < 10) {
    flash(req, 'Nom, email et message (10 caractères min.) sont requis.', 'error');
    return res.redirect('/contact');
  }
  db.prepare('INSERT INTO messages (name,email,phone,subject,body) VALUES (?,?,?,?,?)')
    .run(name.trim().slice(0, 80), email.trim().slice(0, 120), phone.trim().slice(0, 30),
      (subject || 'Question').slice(0, 60), body.trim().slice(0, 2000));
  flash(req, 'Message envoyé ✔ Notre équipe vous répond rapidement (souvent sous 24 h).');
  res.redirect('/contact');
});

/* ================================================================== */
app.use((req, res) => res.status(404).render('error', { title: 'Page introuvable', msg: 'La page demandée n\u2019existe pas.' }));

app.listen(PORT, '0.0.0.0', () => console.log(`\n🚀 Domestik CI → http://localhost:${PORT}\n`));
