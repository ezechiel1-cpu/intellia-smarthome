// ========================================
// INTELLIA v3.0 - Assistant Domotique Intelligent
// Multi-clés API + Google Search + Optimisé Vocal
// TOUTES LES CORRECTIONS APPLIQUÉES
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Route pour servir index.html à la racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// CONFIGURATION MULTI-CLÉS
// ========================================
const AUTH_KEY = process.env.AUTH_KEY || "cle-secrete-intellia";

// Récupération des clés depuis l'environnement Render
const API_KEYS = [];
let currentKeyIndex = 0;

// Charger toutes les clés disponibles (GEMINI_KEY_1, GEMINI_KEY_2, etc.)
for (let i = 1; i <= 10; i++) {
  const key = process.env[`GEMINI_KEY_${i}`];
  if (key && key !== "VOTRE_CLE_API_ICI") {
    API_KEYS.push({
      key: key,
      failures: 0,
      lastUsed: null,
      quotaExceeded: false
    });
  }
}

// Fallback si aucune clé dans l'environnement
if (API_KEYS.length === 0) {
  console.warn('⚠️ AUCUNE CLÉ API TROUVÉE dans les variables d\'environnement');
  console.warn('⚠️ Ajoutez GEMINI_KEY_1, GEMINI_KEY_2, etc. sur Render');
}

console.log(`🔑 ${API_KEYS.length} clé(s) API chargée(s)`);

// ========================================
// SYSTÈME DE ROTATION DES CLÉS
// ========================================
function getNextApiKey() {
  if (API_KEYS.length === 0) {
    throw new Error("Aucune clé API disponible");
  }

  const maxAttempts = API_KEYS.length;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const keyObj = API_KEYS[currentKeyIndex];
    
    // Passer à la clé suivante pour le prochain appel
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    
    // Si la clé n'a pas atteint son quota, l'utiliser
    if (!keyObj.quotaExceeded) {
      keyObj.lastUsed = Date.now();
      console.log(`🔑 Utilisation de la clé #${currentKeyIndex} (${keyObj.failures} échecs)`);
      return keyObj;
    }
    
    attempts++;
  }

  // Toutes les clés ont atteint leur quota
  throw new Error("Toutes les clés API ont atteint leur quota");
}

function markKeyAsFailed(keyObj, isQuotaError = false) {
  keyObj.failures++;
  
  if (isQuotaError) {
    keyObj.quotaExceeded = true;
    console.error(`❌ Clé épuisée (quota dépassé) - ${keyObj.failures} échecs totaux`);
  } else {
    console.warn(`⚠️ Échec de la clé - ${keyObj.failures} échecs totaux`);
  }

  // Réinitialiser les quotas toutes les heures (les quotas Gemini se réinitialisent)
  if (isQuotaError) {
    setTimeout(() => {
      keyObj.quotaExceeded = false;
      keyObj.failures = 0;
      console.log(`🔄 Clé réinitialisée (quota potentiellement restauré)`);
    }, 3600000); // 1 heure
  }
}

// ========================================
// FONCTION D'HEURE ACTUELLE PRÉCISE
// ========================================
function getCurrentTimeFormatted() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const day = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `${day} - ${hours}:${minutes}:${seconds}`;
}

// ========================================
// PROMPT SYSTÈME ULTRA-OPTIMISÉ v3.0
// ========================================
const systemPrompt = `
Tu es "Intellia", un assistant domotique intelligent et cultivé avec accès à Google Search.

## 🎯 RÈGLES FONDAMENTALES

### 1. FORMAT DE RÉPONSE OBLIGATOIRE
Tu DOIS TOUJOURS répondre en JSON valide uniquement :

{
  "reply": "Réponse en français naturel (texte simple, bien formaté)",
  "execute": ["id_appareil|ACTION|valeur"],
  "planning_commands": [{"action":"add", "device":"id", "time":"HH:MM", "schedule_action":"ON/OFF", "power":0-100}]
}

### 2. CAPACITÉS AUTOMATIQUES (Google Search Activé)

**TU AS ACCÈS AUTOMATIQUE À :**
- ✅ Google Search (recherche web en temps réel)
- ✅ Heure système actuelle (fournie dans chaque requête)
- ✅ Météo (via Google Search automatique)
- ✅ Actualités récentes
- ✅ Informations du web en temps réel

**IMPORTANT :** Tu n'as PAS besoin de déclarer "web_search" dans le JSON. Google Search est AUTOMATIQUE quand tu en as besoin.

### 3. FORMATAGE DES RÉPONSES VOCALES

**RÈGLES CRITIQUES POUR LA VOIX :**
- ✅ Réponses CONCISES (2-4 phrases max pour domotique)
- ✅ Texte NATUREL et FLUIDE (comme si tu parlais à quelqu'un)
- ✅ Pas de listes à puces dans les réponses vocales
- ✅ Pas de mise en forme complexe
- ✅ Confirmations COURTES : "C'est fait", "Entendu", "D'accord"

**EXEMPLES DE BONNES RÉPONSES VOCALES :**
❌ "J'ai allumé les appareils suivants : - lampe salon - lampe chambre"
✅ "J'ai allumé la lampe du salon et celle de la chambre."

❌ "Météo actuelle: Température: 15°C Vent: 10 km/h"
✅ "Il fait 15 degrés avec un vent léger de 10 kilomètres par heure."

### 4. QUESTIONS GÉNÉRALES - MODE EXPERT

Pour toute question NON-domotique, tu réponds librement comme ChatGPT ou Claude :

**TU PEUX PARLER DE :**
- Culture générale (histoire, géographie, sciences)
- Actualités (via Google Search si nécessaire)
- Conseils pratiques (études, santé, développement personnel)
- Technologie, programmation, sciences
- Arts, littérature, philosophie
- Mathématiques, physique, chimie
- Économie, politique, société
- TOUT sujet demandé par l'utilisateur

**STYLE DE RÉPONSE :**
- 📚 Explications claires et détaillées
- 🎯 Exemples concrets et pertinents
- 💡 Conseils pratiques applicables
- 🗣️ Ton pédagogique mais naturel
- ⚡ Pour la voix : résumés courts et fluides

### 5. DISTINCTION : IMMÉDIAT vs PLANIFIÉ

**ACTION IMMÉDIATE** (maintenant) :
✅ "Allume la lampe" → execute: ["lampe_salon|ON|100"]
✅ "Règle à 50%" → execute avec appareil du contexte
✅ "Éteins tout" → execute pour TOUS les appareils

**PLANIFICATION** (heure mentionnée) :
✅ "Allume à 08H32" → planning_commands avec time: "08:32"
✅ "Éteins à 22h" → planning_commands (JAMAIS execute)
❌ Ne JAMAIS exécuter si heure mentionnée

### 6. RÈGLE DE L'HEURE EXACTE
- "à 08H32" → "08:32" (PAS "08:30")
- "à 14h05" → "14:05" (PAS "14:00")
- Format strict : HH:MM

### 7. RÈGLE DU CONTEXTE
- Mémorise le dernier appareil mentionné
- Si ambiguïté → pose UNE question claire
- Utilise le contexte pour les références implicites

### 8. RÈGLE "JAMAIS VIDE"
❌ INTERDIT : "OK" avec execute: [] si action demandée
✅ TOUJOURS remplir execute OU planning_commands si action claire

## 📋 FORMATS TECHNIQUES

**planning_commands :**
{
  "action": "add",
  "device": "id_exact",
  "time": "HH:MM",
  "schedule_action": "ON" ou "OFF",
  "power": 0-100
}

**execute :**
"device_id|ACTION|valeur"  // ACTION = ON/OFF, valeur = 0-100

## 💡 EXEMPLES PARFAITS

### Heure actuelle (fournie automatiquement)
USER: "Il est quelle heure ?"
{
  "reply": "Il est 17 heures 09.",
  "execute": [],
  "planning_commands": []
}

### Météo (Google Search automatique)
USER: "Quelle est la météo ?"
RÉPONSE ATTENDUE : Gemini cherche automatiquement et répond
{
  "reply": "Il fait 18 degrés avec un ciel dégagé. Pas de pluie prévue aujourd'hui.",
  "execute": [],
  "planning_commands": []
}

### Domotique
USER: "Règle la luminosité à 50%"
{
  "reply": "Pour quel appareil ?",
  "execute": [],
  "planning_commands": []
}

USER: "Éteins tout à 22h"
{
  "reply": "Entendu, j'éteindrai tous les appareils à 22 heures.",
  "execute": [],
  "planning_commands": [
    {"action":"add", "device":"lampe_salon", "time":"22:00", "schedule_action":"OFF", "power":0}
  ]
}

### Questions générales (style conversationnel)
USER: "Qui est Elon Musk ?"
{
  "reply": "Elon Musk est un entrepreneur et ingénieur américain, fondateur de Tesla, SpaceX et Neuralink. Il est connu pour ses projets ambitieux comme la colonisation de Mars et les véhicules électriques. En 2022, il a racheté Twitter, rebaptisé X.",
  "execute": [],
  "planning_commands": []
}

USER: "Explique-moi la relativité"
{
  "reply": "La relativité d'Einstein dit que le temps et l'espace sont relatifs à la vitesse. Plus vous allez vite, plus le temps ralentit pour vous. Par exemple, un astronaute voyageant très vite vieillirait moins vite que nous sur Terre. C'est vérifié par les GPS qui doivent corriger l'heure à cause de ce phénomène.",
  "execute": [],
  "planning_commands": []
}

USER: "Code Arduino pour ESP32"
{
  "reply": "Pour contrôler une LED sur ESP32, voici un exemple simple : Utilisez la fonction digitalWrite sur le pin de votre choix. Définissez le pin en mode OUTPUT dans le setup, puis alternez entre HIGH et LOW avec des délais. Voulez-vous un exemple complet avec connexion WiFi ?",
  "execute": [],
  "planning_commands": []
}

## ✅ CHECKLIST PRÉ-RÉPONSE

1. ✓ Heure fournie ? → Utiliser pour réponse précise
2. ✓ Météo/Actualité ? → Google Search activé automatiquement
3. ✓ Action IMMÉDIATE ? → execute
4. ✓ PLANIFICATION ? → planning_commands
5. ✓ AMBIGUÏTÉ ? → Question courte
6. ✓ QUESTION GÉNÉRALE ? → Répondre librement
7. ✓ JSON VALIDE ? → Vérifier
8. ✓ PAS de balises HTML ? → Jamais
9. ✓ Réponse VOCALE ? → Concise et naturelle
10. ✓ Style CONVERSATIONNEL ? → Fluide et humain

## 🚨 ERREURS INTERDITES

❌ "OK" avec execute vide si action demandée
❌ Arrondir l'heure
❌ "add" dans schedule_action
❌ Balises HTML (<p>, <br>, <s>, etc.)
❌ Exécuter une planification
❌ Texte hors JSON
❌ Réponses robotiques ("J'ai effectué...")
❌ Dire "je n'ai pas accès" alors que Google Search est activé
❌ Listes à puces dans réponses vocales
❌ Réponses trop longues pour la voix

## 🎤 OPTIMISATION VOCALE

**Pour TOUTE réponse destinée à la voix :**
- Phrases courtes (max 20 mots)
- Éviter les chiffres complexes (dire "dix-huit" au lieu de "18")
- Pas de ponctuation complexe dans le ton
- Confirmations ultra-courtes : "Fait", "OK", "Compris"

RÉPONDS UNIQUEMENT EN JSON VALIDE.
`;

// ========================================
// FONCTION DE CHAT AVEC RETRY ET GOOGLE SEARCH
// ========================================
async function chatWithRetry(prompt, devices, currentTime, maxRetries = API_KEYS.length) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const keyObj = getNextApiKey();
      const genAI = new GoogleGenerativeAI(keyObj.key);
      
      // 🔑 MODÈLE AVEC GOOGLE SEARCH ACTIVÉ
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        tools: [{ googleSearch: {} }] // ✅ Active Google Search automatique
      });

      const chat = model.startChat({
        history: [
          { 
            role: "user", 
            parts: [{ text: systemPrompt }] 
          },
          { 
            role: "model", 
            parts: [{ 
              text: JSON.stringify({
                reply: "Je suis Intellia v3.0, votre assistant intelligent avec accès à Google Search. Prêt à vous aider !",
                execute: [],
                planning_commands: []
              })
            }] 
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.8, // ✅ Augmenté pour réponses plus naturelles
          maxOutputTokens: 4096,
        },
      });

      const fullPrompt = `
╔═══════════════════════════════════════╗
║         APPAREILS DISPONIBLES         ║
╚═══════════════════════════════════════╝

${JSON.stringify(devices, null, 2)}

╔═══════════════════════════════════════╗
║         HEURE ACTUELLE PRÉCISE        ║
╚═══════════════════════════════════════╝

${currentTime}

╔═══════════════════════════════════════╗
║         MESSAGE UTILISATEUR           ║
╚═══════════════════════════════════════╝

"${prompt}"

────────────────────────────────────────

ANALYSE ET RÉPONDS EN JSON VALIDE :
`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // ✅ 20s au lieu de 15s

      const result = await chat.sendMessage(fullPrompt, { signal: controller.signal });
      clearTimeout(timeout);

      return { success: true, data: result.response.text(), keyObj };

    } catch (error) {
      lastError = error;
      const keyObj = API_KEYS[(currentKeyIndex - 1 + API_KEYS.length) % API_KEYS.length];

      // Détecter les erreurs de quota
      const isQuotaError = 
        error.message?.includes('quota') ||
        error.message?.includes('429') ||
        error.message?.includes('RESOURCE_EXHAUSTED');

      markKeyAsFailed(keyObj, isQuotaError);

      console.warn(`⚠️ Tentative ${attempt + 1}/${maxRetries} échouée`);

      if (attempt === maxRetries - 1) {
        break;
      }
    }
  }

  return { success: false, error: lastError };
}

// ========================================
// ROUTE PRINCIPALE /api/chat
// ========================================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, key, devices = [] } = req.body;

    // Validations
    if (key !== AUTH_KEY) {
      return res.status(401).json({ 
        reply: "Clé d'authentification invalide",
        execute: [],
        planning_commands: []
      });
    }
    
    if (!message) {
      return res.status(400).json({ 
        reply: "Message requis",
        execute: [],
        planning_commands: []
      });
    }

    if (API_KEYS.length === 0) {
      return res.status(500).json({ 
        reply: "Erreur: Aucune clé API Gemini configurée. Ajoutez GEMINI_KEY_1, GEMINI_KEY_2, etc. dans les variables d'environnement.",
        execute: [],
        planning_commands: []
      });
    }

    console.log('┌────────────────────────────────────────┐');
    console.log('🔥 MESSAGE:', message);
    console.log('🏠 APPAREILS:', devices.map(d => `${d.name} (${d.id})`).join(', ') || 'Aucun');
    
    const currentTime = getCurrentTimeFormatted();
    console.log('🕐 HEURE:', currentTime);

    const startTime = Date.now();
    const result = await chatWithRetry(message, devices, currentTime);

    if (!result.success) {
      console.error('💥 TOUTES LES CLÉS ONT ÉCHOUÉ');
      
      if (result.error && result.error.name === 'AbortError') {
          console.error('⏱️ TIMEOUT: Requête trop longue (20s)');
          return res.status(504).json({ 
            reply: "La demande a pris trop de temps. Veuillez réessayer.",
            execute: [],
            planning_commands: []
          });
      }
      
      return res.status(503).json({ 
        reply: "Désolé, le service est temporairement indisponible. Réessayez dans quelques instants.",
        execute: [],
        planning_commands: []
      });
    }

    const aiText = result.data;
    console.log(`⏱️ Temps de réponse: ${Date.now() - startTime}ms`);

    // Parsing avec gestion d'erreur robuste
    let aiJson;
    try {
      aiJson = JSON.parse(aiText);
    } catch (parseError) {
      console.error('❌ ERREUR PARSING:', parseError.message);
      console.error('📄 Texte reçu:', aiText.substring(0, 200));
      
      // Nettoyage avancé
      const cleaned = aiText
        .replace(/^```json\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .replace(/<s>/g, '')
        .replace(/<\/s>/g, '')
        .replace(/<p>/g, '')
        .replace(/<\/p>/g, '')
        .replace(/<br\s*\/?>/g, ' ')
        .trim();
      
      try {
        aiJson = JSON.parse(cleaned);
        console.log('✅ JSON récupéré après nettoyage');
      } catch (secondError) {
        console.error('❌ ÉCHEC NETTOYAGE:', secondError.message);
        return res.json({
          reply: "Désolé, j'ai eu un problème technique. Pouvez-vous reformuler autrement ?",
          execute: [],
          planning_commands: []
        });
      }
    }

    // Validation et normalisation
    if (!aiJson.reply || typeof aiJson.reply !== 'string') {
      aiJson.reply = "Commande reçue.";
    }
    
    if (!Array.isArray(aiJson.execute)) {
      aiJson.execute = [];
    }
    
    if (!Array.isArray(aiJson.planning_commands)) {
      aiJson.planning_commands = [];
    }

    // Nettoyage final (sécurité)
    aiJson.reply = aiJson.reply
      .replace(/<[^>]*>/g, '') // Supprime TOUTES les balises HTML
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    console.log('✅ RÉPONSE FINALE:');
    console.log('   reply:', aiJson.reply.substring(0, 100) + (aiJson.reply.length > 100 ? '...' : ''));
    console.log('   execute:', aiJson.execute.length, 'commandes');
    console.log('   planning:', aiJson.planning_commands.length, 'planifications');
    console.log('└────────────────────────────────────────┘\n');

    res.json(aiJson);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('⏱️ TIMEOUT: Requête trop longue (20s)');
      return res.status(504).json({ 
        reply: "La demande a pris trop de temps. Réessayez.",
        execute: [],
        planning_commands: []
      });
    }
    
    console.error('💥 ERREUR SERVEUR:', error.message);
    console.error(error.stack);
    
    res.status(500).json({ 
      reply: "Désolé, une erreur s'est produite. Veuillez réessayer.",
      execute: [],
      planning_commands: []
    });
  }
});

// ========================================
// ROUTE DE SANTÉ (HEALTH CHECK)
// ========================================
app.get('/api/health', (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  
  res.json({ 
    status: 'ok', 
    version: '3.0',
    keys: {
      total: API_KEYS.length,
      available: availableKeys,
      exhausted: API_KEYS.length - availableKeys
    },
    features: ['google_search', 'real_time', 'weather', 'voice_optimized'],
    model: 'gemini-2.0-flash-exp',
    timestamp: new Date().toISOString()
  });
});

// ========================================
// ROUTE STATS CLÉS (DEBUG)
// ========================================
app.get('/api/keys-status', (req, res) => {
  const stats = API_KEYS.map((k, idx) => ({
    index: idx + 1,
    failures: k.failures,
    quotaExceeded: k.quotaExceeded,
    lastUsed: k.lastUsed ? new Date(k.lastUsed).toISOString() : 'never'
  }));
  
  res.json(stats);
});

// ========================================
// DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v3.0 - Google Search OK    ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`   🌐 Interface: http://localhost:${PORT}`);
  console.log(`   🔑 ${API_KEYS.length} clé(s) API chargée(s)`);
  console.log(`   🔍 Google Search: ✅ ACTIVÉ`);
  console.log(`   🕐 Heure Temps Réel: ✅ ACTIVÉ`);
  console.log(`   🎤 Optimisation Vocale: ✅ ACTIVÉ`);
  console.log(`   📊 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`   🔧 Keys Status: http://localhost:${PORT}/api/keys-status`);
  console.log('\n╚═══════════════════════════════════════════════╝\n');
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('\n🛑 Arrêt gracieux du serveur...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Arrêt du serveur (Ctrl+C)...');
  process.exit(0);
});

// ========================================
// NOTES DE DÉPLOIEMENT v3.0
// ========================================

