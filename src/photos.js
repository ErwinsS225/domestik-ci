/**
 * photos.js — Upload & traitement des photos de profil des candidats
 * · Validation : JPG / PNG / WEBP, 5 Mo max
 * · Traitement sharp : recadrage carré centré sur le visage ('attention'),
 *   compression WebP ~82 (léger pour la 2G/3G)
 */
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'public', 'uploads', 'listings');
fs.mkdirSync(DIR, { recursive: true });

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Format accepté : JPG, PNG ou WEBP uniquement.'));
  },
});

/** Middleware tolérant : message clair en cas de photo refusée */
const photoUpload = flash => (req, res, next) => {
  upload.single('photo')(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Photo trop lourde : 5 Mo maximum.' : (err.message || 'Photo invalide.');
      flash(req, msg, 'error');
      return res.redirect(req.get('referer') || '/agence');
    }
    next();
  });
};

/** Retourne le chemin public de la photo traitée (webp 600×600) */
async function processPhoto(buffer) {
  const name = `photo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.webp`;
  await sharp(buffer)
    .rotate()                                                       // respecte l'orientation EXIF
    .resize(600, 600, { fit: 'cover', position: 'attention' })      // centré sur le visage
    .webp({ quality: 82 })
    .toFile(path.join(DIR, name));
  return '/uploads/listings/' + name;
}

/** Supprime le fichier d'une ancienne photo (remplacement, etc.) */
function deletePhoto(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/listings/') || publicPath.includes('demo-')) return;
  fs.promises.unlink(path.join(__dirname, '..', 'public', publicPath)).catch(() => {});
}

/* ---------- Images du site (mini-CMS admin) ---------- */
const SITE_DIR = path.join(__dirname, '..', 'public', 'uploads', 'site');
fs.mkdirSync(SITE_DIR, { recursive: true });

/** Image de section (hero…), largeur max 1200 px, WebP comprimé → /uploads/site/<clé>.webp */
async function processSiteImage(buffer, key) {
  const safe = String(key).replace(/[^a-z0-9_-]/gi, '');
  const name = `${safe}.webp`;
  await sharp(buffer)
    .rotate()
    .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(SITE_DIR, name));
  return '/uploads/site/' + name;
}

module.exports = { photoUpload, processPhoto, deletePhoto, upload, processSiteImage };
