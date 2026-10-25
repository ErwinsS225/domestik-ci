// ============================ PWA ============================
// Enregistrement du service worker (cache + hors-ligne)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Bannière d'installation "Ajouter à l'écran d'accueil" (Android/Chrome)
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});
window.addEventListener('appinstalled', () => {
  const bar = document.getElementById('pwa-install');
  if (bar) bar.remove();
  deferredInstallPrompt = null;
});

function showInstallBanner() {
  if (document.getElementById('pwa-install')) return;
  const bar = document.createElement('button');
  bar.id = 'pwa-install';
  bar.className = 'pwa-install';
  bar.innerHTML = '📲 Installer l\u2019app sur votre téléphone';
  bar.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') bar.remove();
    deferredInstallPrompt = null;
  });
  document.body.appendChild(bar);
  setTimeout(() => bar.classList.add('visible'), 400);
}

// ============================ UI ============================
// Menu mobile + spinners de paiement
document.addEventListener('DOMContentLoaded', () => {
  const burger = document.getElementById('burger');
  const links = document.getElementById('navLinks');
  if (burger && links) burger.addEventListener('click', () => links.classList.toggle('open'));

  // Auto-masquer le flash après 6s
  const flash = document.getElementById('flash');
  if (flash) setTimeout(() => { flash.style.transition = 'opacity .4s'; flash.style.opacity = '0'; setTimeout(() => flash.remove(), 400); }, 6000);

  // Boutons de paiement : état de chargement
  document.querySelectorAll('form[data-loading]').forEach(f => {
    f.addEventListener('submit', e => {
      const btn = f.querySelector('button[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = 'Traitement du paiement…'; }
    });
  });

  // Confirmation avant retrait d'annonce
  document.querySelectorAll('form[data-confirm]').forEach(f => {
    f.addEventListener('submit', e => { if (!confirm(f.dataset.confirm)) e.preventDefault(); });
  });
});
