# 🏠 SmartHome Intelligence - Guide de déploiement

## Fonctionnalités
- ✅ Contrôle domotique intelligent
- ✅ Assistant IA intégré
- ✅ Planning automatique
- ✅ Interface WebSocket ESP32
- ✅ PWA (Application Web Progressive)
- ✅ Notifications en temps réel

## Déploiement Firebase

### Prérequis
- Node.js installé
- Compte Firebase
- CLI Firebase installé

### Installation
```bash
# Installer Firebase CLI
npm install -g firebase-tools

# Se connecter à Firebase
firebase login

# Initialiser le projet
firebase init hosting

# Déployer
firebase deploy --only hosting
