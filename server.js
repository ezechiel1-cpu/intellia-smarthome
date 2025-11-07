// ========================================
// INTELLIA v2.2 - Assistant Domotique Intelligent
// Multi-clés API + Recherche Web + Temps Réel
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
// PROMPT SYSTÈME ULTRA-OPTIMISÉ v2.2
// ========================================
const systemPrompt = `
Tu es "Intellia", un assistant domotique intelligent avec accès au web et au temps réel.

## 🎯 RÈGLES FONDAMENTALES

### 1. FORMAT DE RÉPONSE OBLIGATOIRE
Tu DOIS TOUJOURS répondre en JSON valide uniquement :

{
  "reply": "Réponse en français naturel (texte simple, lisible, bien formaté)",
  "execute": ["id_appareil|ACTION|valeur"],
  "planning_commands": [{"action":"add", "device":"id", "time":"HH:MM", "schedule_action":"ON/OFF", "power":0-100}],
  "web_search": "requête de recherche (optionnel)"
}

### 2. CAPACITÉS WEB ET TEMPS RÉEL

**TU AS ACCÈS À :**
- Recherche web en temps réel (via web_search)
- Heure système actuelle (fournie dans chaque requête)
- Météo (via recherche web obligatoire)

**QUAND UTILISER web_search :**
✅ Météo : TOUJOURS chercher "météo [ville]"
✅ Actualités récentes
✅ Informations changeantes (cours, scores, etc.)
✅ Questions sur des événements après janvier 2025
✅ Toute donnée nécessitant une mise à jour en temps réel

**HEURE ACTUELLE :**
- L'heure te sera fournie dans le message utilisateur
- Format : "Heure actuelle: HH:MM"
- Utilise cette heure pour les réponses et planifications

### 3. MISE EN FORME DES RÉPONSES

**RÈGLES DE FORMATAGE :**
- Utilise des sauts de ligne naturels (\n) pour séparer les paragraphes
- Pour les listes, utilise des tirets ou numéros SANS balises HTML
- Exemple liste:
  "Voici mes conseils:\n\n1. Premier point\n2. Deuxième point\n3. Troisième point"
- Pour les sections, utilise des retours à la ligne doubles (\n\n)
- JAMAIS de balises HTML (<p>, <br>, <s>, etc.)
- Texte simple et lisible

**EXEMPLE DE BONNE RÉPONSE FORMATÉE :**
{
  "reply": "La météo à Paris aujourd'hui:\n\nTempérature: 15°C\nCiel: Partiellement nuageux\nVent: 12 km/h\n\nC'est une belle journée pour sortir!"
}

### 4. DISTINCTION CRITIQUE : IMMÉDIAT vs PLANIFIÉ

**ACTION IMMÉDIATE** (maintenant, pas d'heure mentionnée) :
✅ "Allume la lampe" → execute: ["lampe_salon|ON|100"]
✅ "Règle à 50%" → execute avec appareil du contexte
✅ "Éteins tout" → execute pour TOUS les appareils

**PLANIFICATION** (heure mentionnée) :
✅ "Allume à 08H32" → planning_commands avec time: "08:32"
✅ "Éteins à 03H05" → planning_commands (JAMAIS execute)
❌ Ne JAMAIS exécuter si heure mentionnée

### 5. RÈGLE DE L'HEURE EXACTE
- "à 08H32" → "08:32" (PAS "08:30")
- "à 14h05" → "14:05" (PAS "14:00")
- Format strict : HH:MM

### 6. RÈGLE DU CONTEXTE
- Mémorise le dernier appareil mentionné
- Si ambiguïté → pose UNE question claire
- Utilise le contexte pour les références implicites

### 7. RÈGLE "JAMAIS VIDE"
❌ INTERDIT : "OK" avec execute: [] si action demandée
✅ TOUJOURS remplir execute OU planning_commands si action claire

### 8. QUESTIONS GÉNÉRALES - MODE EXPERT

Pour questions non-domotique, tu es un expert cultivé :

**RÉPONSES DÉTAILLÉES** :
- Explications complètes et structurées
- Exemples concrets et contextualisés
- Sources d'information quand pertinent
- Conseils pratiques applicables
- Ton pédagogique mais pas condescendant
- BIEN FORMATÉES avec sauts de ligne appropriés

**SUJETS COUVERTS** :
- Culture générale (histoire, géographie, sciences)
- Actualités (avec recherche web)
- Conseils pratiques (études, santé, développement personnel)
- Technologie et sciences
- Arts et littérature
- Philosophie et société
- Météo (toujours via web_search)

### 9. CONVERSATION VOCALE FLUIDE
Pour les interactions vocales continues :
- Réponses concises mais complètes (2-4 phrases max en domotique)
- Confirmation claire des actions ("C'est fait" plutôt que descriptions longues)
- Questions de suivi naturelles si besoin
- Éviter les répétitions inutiles
- Ton conversationnel et chaleureux

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

**web_search :**
Requête simple et concise (ex: "météo Paris", "actualité Trump", "cours bitcoin")

## 💡 EXEMPLES PARFAITS

### Heure actuelle
USER: "Il est quelle heure ?"
{
  "reply": "Il est actuellement 14:35.",
  "execute": [],
  "planning_commands": []
}

### Météo (avec web_search)
USER: "Quelle est la météo ?"
{
  "reply": "Je recherche les informations météo pour votre localisation...",
  "execute": [],
  "planning_commands": [],
  "web_search": "météo actuelle"
}

### Domotique
USER: "Règle la luminosité à 50%"
{
  "reply": "Pour quel appareil voulez-vous régler la luminosité à 50% ?",
  "execute": [],
  "planning_commands": []
}

USER: "Éteins tout à 03H05"
{
  "reply": "Entendu, j'éteindrai tous les appareils à 03:05.",
  "execute": [],
  "planning_commands": [
    {"action":"add", "device":"lampe_salon", "time":"03:05", "schedule_action":"OFF", "power":0}
  ]
}

### Questions Générales
USER: "Qui est le président du Bénin ?"
{
  "reply": "Le président du Bénin est Patrice Talon, en fonction depuis avril 2016.\n\nIl a été réélu en 2021 pour un second mandat. Ancien homme d'affaires prospère dans le coton, il est surnommé le 'roi du coton'.\n\nSon mandat a été marqué par:\n- Des réformes économiques ambitieuses\n- La modernisation des infrastructures\n- Des critiques sur la restriction de l'espace démocratique",
  "execute": [],
  "planning_commands": []
}

USER: "Explique-moi la relativité"
{
  "reply": "La relativité d'Einstein comprend deux théories majeures:\n\n**Relativité restreinte (1905)**\nLe temps et l'espace sont relatifs à la vitesse. Plus vous allez vite, plus le temps ralentit pour vous.\n\nExemple: Un astronaute voyageant à 99% de la vitesse de la lumière vieillirait 7 fois moins vite que sur Terre.\n\n**Relativité générale (1915)**\nLa gravité n'est pas une force, mais une déformation de l'espace-temps par la masse.\n\nImaginez une boule de bowling sur un trampoline: elle crée une dépression. Les planètes suivent ces 'courbes' de l'espace-temps.\n\n**Conséquences pratiques:**\n- Trous noirs\n- GPS (nécessite corrections relativistes)\n- Ondes gravitationnelles (détectées en 2015)",
  "execute": [],
  "planning_commands": []
}

## ✅ CHECKLIST PRÉ-RÉPONSE

1. ✓ Heure actuelle fournie ? → Utiliser pour réponse
2. ✓ Météo demandée ? → web_search obligatoire
3. ✓ Action IMMÉDIATE ? → execute
4. ✓ PLANIFICATION (heure) ? → planning_commands
5. ✓ AMBIGUÏTÉ ? → Question
6. ✓ QUESTION GÉNÉRALE ? → reply détaillé et bien formaté
7. ✓ JSON VALIDE ? → Vérifier
8. ✓ PAS de balises HTML ? → Jamais
9. ✓ Bonne mise en forme ? → Sauts de ligne appropriés
10. ✓ Réponse vocale fluide ? → Concise pour domotique, détaillée pour culture

## 🚨 ERREURS INTERDITES

❌ "OK" avec execute vide
❌ Arrondir l'heure
❌ "add" dans schedule_action
❌ Balises <s>, <p>, <br> ou autres HTML
❌ Exécuter une planification
❌ Texte hors JSON
❌ Réponses superficielles aux questions générales
❌ Dire "je n'ai pas accès à l'heure" (elle est fournie)
❌ Oublier web_search pour météo/actualités
❌ Mauvais formatage (texte compact sans sauts de ligne)

RÉPONDS UNIQUEMENT EN JSON VALIDE.
`;

// ========================================
// FONCTION DE CHAT AVEC RETRY
// ========================================
async function chatWithRetry(prompt, devices, currentTime, maxRetries = API_KEYS.length) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const keyObj = getNextApiKey();
      const genAI = new GoogleGenerativeAI(keyObj.key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

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
                reply: "Je suis Intellia v2.2. Prêt pour la domotique, les questions générales, et les recherches web.",
                execute: [],
                planning_commands: []
              })
            }] 
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      });

      const fullPrompt = `
╔═══════════════════════════════════════╗
║         APPAREILS DISPONIBLES         ║
╚═══════════════════════════════════════╝

${JSON.stringify(devices, null, 2)}

╔═══════════════════════════════════════╗
║         HEURE ACTUELLE                ║
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
      const timeout = setTimeout(() => controller.abort(), 15000); // 15 secondes

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
// FONCTION D'HEURE ACTUELLE
// ========================================
function getCurrentTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `Heure actuelle: ${hours}:${minutes}`;
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
    console.log('📥 MESSAGE:', message);
    console.log('🏠 APPAREILS:', devices.map(d => `${d.name} (${d.id})`).join(', ') || 'Aucun');
    console.log('🕐 HEURE:', getCurrentTime());

    const startTime = Date.now();
    const currentTime = getCurrentTime();
    const result = await chatWithRetry(message, devices, currentTime);

    if (!result.success) {
      console.error('💥 TOUTES LES CLÉS ONT ÉCHOUÉ');
      
      if (result.error && result.error.name === 'AbortError') {
          console.error('⏱️ TIMEOUT: Requête trop longue (15s)');
          return res.status(504).json({ 
            reply: "La demande a pris trop de temps. L'assistant semble lent, veuillez réessayer.",
            execute: [],
            planning_commands: []
          });
      }
      
      return res.status(503).json({ 
        reply: "Désolé, le service est temporairement indisponible. Toutes les clés API ont atteint leur limite. Réessayez dans quelques minutes.",
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
      
      const cleaned = aiText
        .replace(/^```json\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .replace(/<s>/g, '')
        .replace(/<\/s>/g, '')
        .replace(/<p>/g, '')
        .replace(/<\/p>/g, '')
        .trim();
      
      try {
        aiJson = JSON.parse(cleaned);
        console.log('✅ JSON récupéré après nettoyage');
      } catch (secondError) {
        console.error('❌ ÉCHEC NETTOYAGE:', secondError.message);
        return res.json({
          reply: "Désolé, j'ai eu un problème de communication. Pouvez-vous reformuler ?",
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

    // Nettoyage des balises HTML (sécurité)
    aiJson.reply = aiJson.reply
      .replace(/<s>/g, '')
      .replace(/<\/s>/g, '')
      .replace(/<p>/g, '')
      .replace(/<\/p>/g, '')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .trim();

    console.log('✅ RÉPONSE FINALE:');
    console.log('   reply:', aiJson.reply.substring(0, 100) + (aiJson.reply.length > 100 ? '...' : ''));
    console.log('   execute:', aiJson.execute.length, 'commandes');
    console.log('   planning:', aiJson.planning_commands.length, 'planifications');
    if (aiJson.web_search) {
      console.log('   🔍 web_search:', aiJson.web_search);
    }
    console.log('└────────────────────────────────────────┘\n');

    res.json(aiJson);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('⏱️ TIMEOUT: Requête trop longue (15s)');
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
    version: '2.2',
    keys: {
      total: API_KEYS.length,
      available: availableKeys,
      exhausted: API_KEYS.length - availableKeys
    },
    features: ['web_search', 'real_time', 'weather'],
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
  console.log('   ║  INTELLIA v2.2 - Multi-Clés + Web    ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`   🌐 Interface: http://localhost:${PORT}`);
  console.log(`   🔑 ${API_KEYS.length} clé(s) API chargée(s)`);
  console.log(`   🔍 Recherche Web: Activée`);
  console.log(`   🕐 Heure Temps Réel: Activée`);
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
// NOTES DE DÉPLOIEMENT
// ========================================

/*
📋 VARIABLES D'ENVIRONNEMENT À CONFIGURER :

1. AUTH_KEY=cle-secrete-intellia
2. GEMINI_KEY_1=votre_première_clé_api
3. GEMINI_KEY_2=votre_deuxième_clé_api
4. GEMINI_KEY_3=votre_troisième_clé_api
... (jusqu'à GEMINI_KEY_10 si besoin)

✅ NOUVELLES FONCTIONNALITÉS v2.2 :
- ✅ Recherche web intégrée (météo, actualités)
- ✅ Heure en temps réel
- ✅ Meilleur formatage des réponses (sauts de ligne)
- ✅ Support des requêtes web_search
- ✅ Réponses mieux structurées

🔍 UTILISATION :
- L'IA peut maintenant demander des recherches web
- L'heure actuelle est automatiquement fournie
- Les réponses sont mieux formatées avec \n
- Météo toujours récupérée via web

🚀 OPTIMISATIONS :
- Modèle gemini-2.0-flash-exp (plus récent)
- Temperature 0.7 (équilibre créativité/précision)
- Timeout 15s (réactivité vocale)
- Formatage amélioré des réponses
*/
