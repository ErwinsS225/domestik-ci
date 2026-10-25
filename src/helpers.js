/** helpers.js — fonctions utilitaires partagées (vues + routes) */
const { db } = require('./db');

const num = n => (n == null ? '' : new Intl.NumberFormat('fr-FR').format(n));
const fcfa = n => num(n) + ' FCFA';

function salary(min, max) {
  if (min && max) return `${num(min)} – ${num(max)} FCFA / mois`;
  if (min) return `dès ${num(min)} FCFA / mois`;
  if (max) return `jusqu'à ${num(max)} FCFA / mois`;
  return 'Salaire à convenir';
}

/** SQLite datetime('now') format 'YYYY-MM-DD HH:MM:SS' (UTC = heure d'Abidjan) */
function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
function plusDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

const isBoosted = l => !!l.boosted_until && l.boosted_until > nowSql();
const isPremium = a => !!a && a.plan === 'premium' && !!a.subscribed_until && a.subscribed_until > nowSql();
const premiumDaysLeft = a => {
  if (!isPremium(a)) return 0;
  return Math.max(0, Math.ceil((new Date(a.subscribed_until.replace(' ', 'T') + 'Z') - Date.now()) / 86400000));
};

function timeAgo(dt) {
  if (!dt) return '';
  const diff = (Date.now() - new Date(dt.replace(' ', 'T') + 'Z').getTime()) / 1000;
  if (diff < 3600) return `il y a ${Math.max(1, Math.floor(diff / 60))} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 2592000) return `il y a ${Math.floor(diff / 86400)} j`;
  return `il y a ${Math.floor(diff / 2592000)} mois`;
}

function fmtDate(dt) {
  if (!dt) return '';
  return new Date(dt.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Masque le numéro : "+225 07 09 •• •• ••" */
function maskPhone(p) {
  if (!p) return '•• •• •• ••••';
  const digits = p.replace(/\D/g, '');
  const visible = digits.slice(0, Math.min(7, digits.length));
  const framed = visible.replace(/(\d{3})(\d{2})(\d{2})?/, (m, a, b, c) => `+${a} ${b} ${c || ''}`.trim());
  return `${framed} •• •• ••`;
}

/** Lien WhatsApp wa.me avec indicatif 225 */
function waLink(p) {
  let d = (p || '').replace(/\D/g, '');
  if (d.startsWith('225')) return 'https://wa.me/' + d;
  if (d.startsWith('00225')) return 'https://wa.me/' + d.slice(2);
  if (d.startsWith('0')) return 'https://wa.me/225' + d;
  return 'https://wa.me/225' + d;
}

/** Couleur stable d'avatar à partir d'un nom */
function avatarColor(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 42%)`;
}

/** Note → étoiles "★★★★☆" */
const stars = n => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));

/** Note à la française : 4.5 → '4,5' */
const noteFr = n => (n == null || isNaN(n) ? '–' : String(Number(n.toFixed ? n.toFixed(1) : n)).replace('.', ','));

/** "Aya Konan" → "Aya K." (anonymisation des avis) */
function maskedName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.` : (parts[0] || 'Utilisateur');
}

const COMMUNES = ['Abobo', 'Adjamé', 'Attécoubé', 'Cocody', 'Koumassi', 'Marcory', 'Plateau',
  'Port-Bouët', 'Treichville', 'Yopougon', 'Riviera', 'Angré', 'Bingerville', 'Anyama', 'Songon', 'Grand-Bassam'];

const VILLES = ['Abidjan', 'Bouaké', 'Daloa', 'Yamoussoukro', 'San-Pédro', 'Korhogo', 'Man',
  'Gagnoa', 'Abengourou', 'Divo', 'Dabou', 'Agboville', 'Grand-Bassam', 'Bondoukou', 'Assinie'];

const PRICES = {
  unlock: 2000,
  boost: { pop: { label: 'Pack Popularité (5 jours)', amount: 3000, days: 5 }, vip: { label: 'Pack VIP (14 jours)', amount: 10000, days: 14 } },
  subscription: { label: 'Abonnement Agence Premium (30 jours)', amount: 15000, days: 30 },
  manual_review: false,               // true → les paiements attendent une validation admin
  platform_phone: '+225 01 01 01 01 01',
};

/** Recharge les tarifs/réglages depuis la table settings (max 1× / 3 s). */
let pricesAt = 0;
function refreshPrices(force = false) {
  if (!force && Date.now() - pricesAt < 3000) return;
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  const n = (k, d) => { const v = Number(s[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  PRICES.unlock = n('price_unlock', 2000);
  PRICES.boost.pop = { label: `Pack Popularité (${n('boost_pop_days', 5)} jours)`, amount: n('boost_pop_amount', 3000), days: n('boost_pop_days', 5) };
  PRICES.boost.vip = { label: `Pack VIP (${n('boost_vip_days', 14)} jours)`, amount: n('boost_vip_amount', 10000), days: n('boost_vip_days', 14) };
  PRICES.subscription = { label: `Abonnement Agence Premium (${n('sub_days', 30)} jours)`, amount: n('sub_amount', 15000), days: n('sub_days', 30) };
  PRICES.manual_review = s.manual_review === '1';
  PRICES.platform_phone = s.platform_phone || '+225 01 01 01 01 01';
  pricesAt = Date.now();
}
refreshPrices(true);

module.exports = { num, fcfa, salary, nowSql, plusDays, isBoosted, isPremium, premiumDaysLeft, timeAgo, fmtDate, maskPhone, waLink, avatarColor, stars, noteFr, maskedName, refreshPrices, COMMUNES, VILLES, PRICES };
