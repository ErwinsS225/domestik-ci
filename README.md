# Domestik CI 🇨🇮

Plateforme web de mise en relation entre **particuliers cherchant du personnel domestique** et **agences de placement** en Côte d'Ivoire — basée sur la confiance et le professionnalisme.

## 🚀 Lancer le projet

```bash
cd domestik-ci
npm install
npm start
# → http://localhost:3000
```

### Comptes de démonstration (mot de passe : `demo1234`)
| Rôle | Email | Usage |
|---|---|---|
| 👤 Chercheur | `client@demo.ci` | Rechercher, débloquer des contacts, noter |
| 🏢 Agence Premium | `agence@demo.ci` | Dashboard, CRUD annonces, boost, stats, réponses aux avis |
| 🏢 Agence gratuite | `confiance@demo.ci` | Tester les limites de l'offre gratuite (3 annonces) |
| 🛠 **Admin (vous)** | `admin@demo.ci` | Pilotage revenus, vérification agences, modération |

> ⚠️ En production : changez le mot de passe admin et définissez `ADMIN_PASSWORD` avant le premier démarrage.

## 🧭 Fonctionnalités

**Côté chercheur de personnel (gratuit sauf déblocage)**
- Navigation par 10 catégories (ménage, cuisine, nounou, chauffeur, etc.)
- Filtres : mot-clé, ville/commune, salaire, expérience
- Déblocage du numéro de l'agence : **2 000 FCFA via Wave** (simulé)
- Espace « Mes contacts » + historique des paiements

**Côté agence**
- Dashboard : vues, contacts débloqués (leads), boosts actifs, **note moyenne**, **taux de contact (30 j)**, prévisions (Premium)
- 📊 **Graphique des vues sur 30 jours** (barres, jour par jour) + **top 3 annonces les plus consultées**
- 🧩 **Actions groupées** : cochez plusieurs annonces → **boost multiple en un seul paiement** (Popularité ou VIP × N annonces) ou publier / pause / « pourvue » en masse
- ⧉ **Dupliquer une annonce** (création rapide à partir d'un profil existant ; quota gratuit respecté)
- ⬇ **Export CSV** de ses annonces
- CRUD complet des annonces (pause / pourvue / retirer)
- 📸 **Photo de profil** uploadée par l'agence : recadrage carré auto centré visage + compression WebP (léger en 2G/3G)
- Boosts : Popularité **3 000 F / 5 j** · VIP **10 000 F / 14 j** (par annonce ou groupés)
- Abonnement Premium **15 000 F / mois** : annonces illimitées, priorité, statistiques
- **Réponse publique aux avis** + page publique de réputation (`/agences/:id`)

**🛡 Avis vérifiés (cœur de la confiance)**
- Seul un utilisateur ayant **payé le déblocage** d'une annonce peut la noter → **zéro faux avis**
- Note ⭐ 1-5 + commentaire + badge « ✅ embauche confirmée »
- Un seul avis par déblocage (modifiable, supprimable par son auteur)
- Note moyenne de l'agence affichée sur toutes ses annonces + page agence publique
- Section « Ils ont trouvé leur perle » sur l'accueil

**🔔 Notifications & alertes WhatsApp**
- Centre de notifications intégré (agences **et** chercheurs) : cloche 🔔 avec compteur de non-lus, page dédiée, bloc sur le dashboard
- Événements : 🔓 nouveau client (déblocage) · ✅ paiement validé · ⚠️ paiement rejeté · ⭐ nouvel avis · ⚡/★ confirmations boost & Premium · ⏳ rappels auto d'expiration (boost < 48 h, Premium < 3 j, anti-doublon 24 h)
- **WhatsApp — 2 modes** :
  - *Manuel (0 F, activé par défaut)* : les alertes arrivent dans `/admin/whatsapp` ; l'admin clique « Envoyer » (message wa.me pré-rempli) puis « Marquer envoyé »
  - *Automatique* : définir `META_WA_TOKEN` + `META_WA_PHONE_ID` + `APP_URL` → envoi direct via l'API WhatsApp Cloud de Meta (le code est déjà branché dans `src/notify.js`)
- L'agence peut couper ses alertes WhatsApp depuis sa page notifications

**🛠 Panneau admin `/admin` (réservé au propriétaire)**
- 🎯 **Jauge objectif 500 000 F / mois** + graphique des revenus sur 30 jours (barres) + répartition par levier (déblocages / boosts / abonnements)
- 🏢 Gestion des agences : **badge ✔ vérifiée** (contrôle manuel) et **Premium offert 30 j** (pour séduire les premières partenaires)
- 📢 Modération des annonces (retirer / restaurer un contenu abusif)
- ⭐ Modération des avis (masquer / republier — les agences ne peuvent pas censurer leurs avis)
- 👥 Liste des utilisateurs et leur activité + **suspension / réactivation de compte** (connexion bloquée)

**💳 Back-office avancé (encaissement réel sans API)**
- **Validation manuelle des paiements** (`Réglages` → case à cocher) : les clients envoient l'argent au numéro Wave de la plateforme ; chaque paiement arrive **« en attente »** dans `/admin/paiements` — l'effet (contact débloqué / boost activé / Premium accordé) ne s'applique **qu'à la validation** ; le rejet notifie le payeur
- ⚙️ **Tarifs modifiables en direct** (déblocage, boosts, abonnement) + numéro Wave de la plateforme — reflétés immédiatement partout (accueil, checkout…)
- 🗂 **Catégories : ajout / modification / masquage** — une catégorie masquée retire ses annonces de la recherche et de l'accueil
- 📬 **Page contact publique `/contact`** → boîte de réception admin (réponse par mail ou WhatsApp)
- 🧾 **Journal d'audit** (qui a fait quoi), visible sur le tableau de pilotage
- ⬇ **Exports CSV** (paiements, utilisateurs) compatibles Excel
- 🎨 **Mini-CMS `/admin/contenus`** — administrez le site sans coder :
  - 📣 **Bandeau promo flash** sur toutes les pages (texte + lien + interrupteur on/off)
  - 🖼 **Bannière d'accueil** : titre (italique `<em>` possible), sous-titre, **image d'illustration** uploadée (redimensionnée 1200 px, WebP léger)
  - 🛋 Titres des sections (catégories, vedettes, nouveautés, avis, « Comment ça marche », tarifs, 3 étapes)
  - 🦶 Phrase du pied de page
  - Astuce : insérez `[PRIX]` dans un texte pour afficher automatiquement le prix actuel du déblocage
  - Toutes les modifications sont en ligne **immédiatement** et consignées dans le journal d'audit

## 🏗 Stack

Express · EJS · better-sqlite3 · bcryptjs · express-session — **zéro dépendance externe au runtime**, base auto-créée avec données de démonstration.

```
domestik-ci/
├── server.js          # toutes les routes (public, auth, paiements, agence)
├── src/db.js          # schéma SQLite + seeds (10 catégories + démo)
├── src/helpers.js     # FCFA, dates, Wave links, prix, constantes
├── views/             # templates EJS
└── public/            # CSS + JS
```

## 📱 Application mobile (PWA)

Le site est une **Progressive Web App** : installable sur téléphone comme une vraie app, sans Play Store.
- `public/manifest.json` — nom, couleurs, icônes, raccourcis Android (Recherche / Mon agence / Mes contacts)
- `public/sw.js` — service worker : assets en cache (rapide en 2G/3G), repli hors-ligne
- `public/offline.html` — page affichée sans connexion
- `public/icons/` — icônes générées par `scripts/gen_icons.py` (192, 512, maskable, Apple)
- Bannière « 📲 Installer l'app » automatique (Chrome/Android) via `beforeinstallprompt`

**Installer :** Android → Chrome ⋮ → *Ajouter à l'écran d'accueil* · iOS → Safari → Partager → *Sur l'écran d'accueil*.
Une fois déployée en HTTPS, l'app se lance en plein écran avec son icône orange 🏠✔

## ⚙️ Variables d'environnement (production)

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `3000` |
| `SESSION_SECRET` | Sécurité des sessions | valeur de dev |
| `ADMIN_PASSWORD` | Mot de passe du compte admin au 1er démarrage | `demo1234` ⚠️ |
| `APP_URL` | URL publique (liens dans les WhatsApp) | chemin relatif |
| `META_WA_TOKEN` / `META_WA_PHONE_ID` | API WhatsApp Cloud (Meta) → envoi auto des alertes | mode manuel |

> 💡 Les tarifs, le numéro Wave de la plateforme et la validation manuelle des paiements se règlent **en ligne** via `/admin/reglages` — aucune variable d'environnement nécessaire.

## 💰 Prochaines étapes vers la production

1. **Paiement réel** (étape déjà préparée) : en attendant l'API, activez la **validation manuelle** dans `/admin/reglages` — les clients envoient au numéro Wave plateforme et vous validez chaque paiement dans `/admin/paiements`. Quand l'API Wave Business (ou CinetPay / PayDunya) sera souscrite, on branchera le callback de confirmation dans `POST /paiement/:type`.
2. **Déploiement** : Render / Railway / VPS (conteneur Node 20, variable `SESSION_SECRET`) — le PWA nécessite HTTPS.
3. **Confiance** : vérification manuelle des agences (badge ✔), téléchargement de références, avis clients.
4. **Sécurité** : protection CSRF, rate-limit, migration SQLite → PostgreSQL à l'échelle.
