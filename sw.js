// Service Worker pour SmartHome Intelligence
const CACHE_NAME = 'smarthome-v12-' + new Date().getTime();
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Installation du Service Worker
self.addEventListener('install', function(event) {
  console.log('🔄 Service Worker installation...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('✅ Cache ouvert');
        return cache.addAll(urlsToCache);
      })
      .then(function() {
        console.log('✅ Toutes les ressources mises en cache');
        return self.skipWaiting();
      })
      .catch(function(error) {
        console.error('❌ Erreur lors de l\'installation du cache:', error);
      })
  );
});

// Activation du Service Worker
self.addEventListener('activate', function(event) {
  console.log('🔄 Service Worker activation...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Suppression de l\'ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      console.log('✅ Service Worker activé');
      return self.clients.claim();
    })
  );
});

// Interception des requêtes
self.addEventListener('fetch', function(event) {
  // Ignorer les requêtes Firebase et les API externes
  if (event.request.url.includes('firebase') || 
      event.request.url.includes('render.com') ||
      event.request.url.includes('cdnjs')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Retourne la réponse en cache ou fetch depuis le réseau
        return response || fetch(event.request);
      })
      .catch(function(error) {
        console.error('❌ Erreur fetch:', error);
        // En cas d'erreur, on peut retourner une page offline personnalisée
        if (event.request.destination === 'document') {
          return caches.match('/offline.html');
        }
      })
  );
});

// Gestion des messages (pour les notifications push)
self.addEventListener('push', function(event) {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'Nouvelle notification SmartHome',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    },
    actions: [
      {
        action: 'open',
        title: 'Ouvrir'
      },
      {
        action: 'close',
        title: 'Fermer'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'SmartHome Intelligence', options)
  );
});

// Gestion des clics sur les notifications
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'open') {
    event.waitUntil(
      clients.matchAll({type: 'window'}).then(function(clientList) {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Gestion de la synchronisation en arrière-plan
self.addEventListener('sync', function(event) {
  if (event.tag === 'background-sync') {
    console.log('🔄 Synchronisation en arrière-plan');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Logique de synchronisation des données
  console.log('✅ Synchronisation effectuée');
}
