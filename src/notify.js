/**
 * notify.js — Centre de notifications Domestik CI + pont WhatsApp
 *
 * Deux modes de livraison WhatsApp :
 *  · MANUEL (par défaut, 0 FCFA) : chaque alerte part en file 'queued' et est expédiée
 *    en 1 clic depuis /admin/whatsapp via un lien wa.me pré-rempli.
 *  · API META (production) : définir META_WA_TOKEN + META_WA_PHONE_ID + APP_URL
 *    → envoi automatique immédiat, statut passe à 'sent'.
 *
 * Les notifications restent toujours visibles dans l'app (🔔), WhatsApp est un bonus.
 */
const { db } = require('./db');

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');   // ex. https://domestik-ci.onrender.com

function absLink(link) { return link ? (APP_URL ? APP_URL + link : link) : ''; }

/** Normalise un numéro ivoirien pour l'API/WhatsApp : « 07 09 45 67 89 » → « 2250709456789 » */
function waNumber(p) {
  let d = (p || '').replace(/\D/g, '');
  if (d.startsWith('00225')) d = d.slice(2);
  if (d.startsWith('225')) return d;
  if (d.startsWith('0')) return '225' + d;
  return '225' + d;
}

/** Corps du message WhatsApp (formatage léger : *gras*) */
function waText(title, body, link) {
  return `*Domestik CI* 🏠\n\n*${title}*\n${body}${link ? `\n\n👉 ${absLink(link)}` : ''}`;
}

/** Lien wa.me pré-rempli pour l'envoi manuel par l'admin (mode 0 FCFA) */
function waManualLink(phone, title, body, link) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(waText(title, body, link))}`;
}

/** Envoi via l'API WhatsApp Cloud de Meta — retourne false si non configurée. */
async function sendViaMeta(phone, text) {
  const token = process.env.META_WA_TOKEN, phoneId = process.env.META_WA_PHONE_ID;
  if (!token || !phoneId) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: waNumber(phone), type: 'text', text: { body: text } }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Crée une notification.
 * In-app : toujours. WhatsApp : 'queued' (file manuelle) ou 'disabled' (si l'agence a coupé ses alertes).
 */
function notify(userId, kind, title, body, link) {
  const dest = db.prepare(
    'SELECT u.phone, COALESCE(ap.notify_wa, 1) AS wa_on FROM users u LEFT JOIN agency_profiles ap ON ap.user_id=u.id WHERE u.id=?'
  ).get(userId);
  const status = dest && dest.wa_on === 0 ? 'disabled' : 'queued';
  const id = db.prepare('INSERT INTO notifications (user_id,kind,title,body,link,wa_status) VALUES (?,?,?,?,?,?)')
    .run(userId, kind, title, body, link || null, status).lastInsertRowid;

  // Tentative d'envoi automatique si l'API Meta est branchée
  if (status === 'queued' && dest && dest.phone) {
    sendViaMeta(dest.phone, waText(title, body, link))
      .then(ok => { if (ok) db.prepare("UPDATE notifications SET wa_status='sent' WHERE id=?").run(id); })
      .catch(() => {});
  }
  return id;
}

const KIND_ICONS = { unlock: '🔓', unlock_ok: '✅', review: '⭐', boost: '⚡', subscription: '★', boost_end: '⏳', sub_end: '⏳', payment_ko: '⚠️' };

module.exports = { notify, waText, waManualLink, waNumber, absLink, KIND_ICONS };
