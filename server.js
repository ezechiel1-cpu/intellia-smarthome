// ========================================
// INTELLIA v4.0 - HYBRIDE CORRIGÉ
// Cloud Gemini + Recherche Web Réelle + Contexte
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// CONFIGURATION
// ========================================
const AUTH_KEY = process.env.AUTH_KEY || "cle-secrete-intellia";

const API_KEYS = [];
let currentKeyIndex = 0;

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

if (API_KEYS.length === 0) {
  console.warn('⚠️ AUCUNE CLÉ API GEMINI - Mode recherche web uniquement');
}

console.log(`🔑 ${API_KEYS.length} clé(s) Gemini chargée(s)`);

// ========================================
// CONTEXTE DE CONVERSATION (Mémoire)
// ========================================
const conversationContexts = new Map(); // sessionId -> context

function getOrCreateContext(sessionId = 'default') {
  if (!conversationContexts.has(sessionId)) {
    conversationContexts.set(sessionId, {
      history: [],
      lastDevice: null,
      lastLocation: null,
      lastTopic: null,
      createdAt: Date.now()
    });
  }
  return conversationContexts.get(sessionId);
}

function addToContext(sessionId, userMsg, aiResponse) {
  const context = getOrCreateContext(sessionId);
  context.history.push({
    user: userMsg,
    assistant: aiResponse,
    timestamp: Date.now()
  });
  
  // Garder seulement les 10 derniers messages
  if (context.history.length > 10) {
    context.history.shift();
  }
}

// ========================================
// GESTION DES CLÉS API
// ========================================
function getNextApiKey() {
  if (API_KEYS.length === 0) {
    throw new Error("Aucune clé API disponible");
  }
  const maxAttempts = API_KEYS.length;
  let attempts = 0;
  while (attempts < maxAttempts) {
    const keyObj = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    if (!keyObj.quotaExceeded) {
      keyObj.lastUsed = Date.now();
      console.log(`🔑 Utilisation clé #${currentKeyIndex}`);
      return keyObj;
    }
    attempts++;
  }
  throw new Error("Toutes les clés ont atteint leur quota");
}

function markKeyAsFailed(keyObj, isQuotaError = false) {
  keyObj.failures++;
  if (isQuotaError) {
    keyObj.quotaExceeded = true;
    console.error(`❌ Clé épuisée (quota)`);
    setTimeout(() => {
      keyObj.quotaExceeded = false;
      keyObj.failures = 0;
    }, 3600000);
  }
}

// ========================================
// HEURE PRÉCISE DU BÉNIN
// ========================================
function getBeninTime() {
  const now = new Date();
  
  // Obtenir l'heure UTC
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  
  // Bénin = UTC+1 (pas de changement d'heure)
  let beninHours = utcHours + 1;
  let beninMinutes = utcMinutes;
  
  // Gérer le passage à un nouveau jour
  if (beninHours >= 24) {
    beninHours -= 24;
  }
  
  // Formater pour la lecture
  const formatted = new Date(now);
  formatted.setUTCHours(beninHours);
  formatted.setUTCMinutes(beninMinutes);
  
  const timeString = formatted.toLocaleString('fr-FR', {
    timeZone: 'Africa/Porto-Novo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  return {
    formatted: timeString,
    hours: beninHours,
    minutes: beninMinutes,
    hoursStr: String(beninHours).padStart(2, '0'),
    minutesStr: String(beninMinutes).padStart(2, '0')
  };
}

// ========================================
// RECHERCHE WEB RÉELLE
// ========================================
async function performWebSearch(query) {
  console.log(`🔍 Recherche web: "${query}"`);
  
  try {
    // Recherche via DuckDuckGo
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('.result').slice(0, 5).each((i, elem) => {
      const title = $(elem).find('.result__title').text().trim();
      const snippet = $(elem).find('.result__snippet').text().trim();
      const url = $(elem).find('.result__url').attr('href');
      
      if (title && snippet) {
        results.push({ title, snippet, url });
      }
    });

    console.log(`✅ Trouvé ${results.length} résultats web`);
    return results;
    
  } catch (error) {
    console.error('❌ Erreur recherche web:', error.message);
    return [];
  }
}

function summarizeWebResults(results) {
  if (results.length === 0) {
    return "Je n'ai pas trouvé d'informations pertinentes sur le web pour cette recherche.";
  }

  let summary = "Voici ce que j'ai trouvé sur le web :\n\n";
  
  results.slice(0, 3).forEach((result, index) => {
    summary += `${index + 1}. ${result.title}\n${result.snippet}\n\n`;
  });

  return summary.trim();
}

// ========================================
// DÉTECTION DU BESOIN DE RECHERCHE WEB
// ========================================
function needsWebSearch(message) {
  const webKeywords = [
    'météo', 'temps', 'température', 'pluie', 'soleil',
    'actualité', 'news', 'nouvelles', 'info',
    'recherche', 'cherche', 'trouve',
    'qui est', 'c\'est quoi', 'qu\'est-ce',
    'où se trouve', 'où est',
    'combien coûte', 'prix de'
  ];
  
  const lowerMsg = message.toLowerCase();
  return webKeywords.some(kw => lowerMsg.includes(kw));
}

// ========================================
// PROMPT SYSTÈME AMÉLIORÉ v4.0
// ========================================
const systemPrompt = `
Tu es "Intellia", un assistant domotique intelligent basé au BÉNIN.

## 🎯 RÈGLES FONDAMENTALES

### 1. HEURE ACTUELLE
- L'heure PRÉCISE du Bénin est TOUJOURS fournie dans chaque requête
- Utilise EXACTEMENT cette heure, ne l'arrondis JAMAIS
- Format: "Il est actuellement [heure exacte fournie]"

### 2. RECHERCHE WEB
- Si des résultats web sont fournis, utilise-les comme source PRINCIPALE
- Cite toujours que l'info vient "du web" ou "de mes recherches"
- Ne JAMAIS inventer d'informations si pas de résultats web

### 3. CONTEXTE DE CONVERSATION
- Un historique de conversation est fourni
- Utilise le contexte pour comprendre les références ("il", "là", "ça")
- Si l'utilisateur mentionne un lieu (ex: "Lokossa"), mémorise-le pour les questions suivantes

### 4. RÉPONSES VOCALES
- Concis: 2-4 phrases max pour domotique
- Naturel: pas de listes à puces en vocal
- Confirmations courtes: "C'est fait", "Entendu", "D'accord"

### 5. PLANIFICATION vs EXÉCUTION IMMÉDIATE

**EXÉCUTION IMMÉDIATE** (maintenant):
✅ "Allume la lampe" → execute: ["device_id|ON|100"]
✅ "Éteins tout" → execute pour TOUS les appareils

**PLANIFICATION** (heure mentionnée):
✅ "Éteins tout à 22h" → planning_commands avec time: "22:00"
✅ Un seul planning_commands par appareil (éviter duplications)

### 6. GESTION DES DUPLICATIONS
- Pour "éteins tout à [heure]", créer UN planning par appareil unique
- Vérifier qu'il n'y a pas de doublons dans planning_commands
- Si plusieurs appareils: un planning par device_id unique

## 📋 FORMAT DE RÉPONSE JSON

{
  "reply": "Réponse en français naturel",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [{
    "action": "add",
    "device": "device_id",
    "time": "HH:MM",
    "schedule_action": "ON" ou "OFF",
    "power": 0-100
  }],
  "source": "cloud" | "web" | "knowledge"
}

## 💡 EXEMPLES PARFAITS

### Heure
USER: "Quelle heure est-il ?"
HEURE FOURNIE: "01:35"
{
  "reply": "Il est actuellement 1 heure 35.",
  "execute": [],
  "planning_commands": [],
  "source": "knowledge"
}

### Recherche Web
USER: "Quel temps fait-il à Lokossa ?"
RÉSULTATS WEB: [données météo]
{
  "reply": "D'après mes recherches web, il fait actuellement 28°C à Lokossa avec un ciel dégagé.",
  "execute": [],
  "planning_commands": [],
  "source": "web"
}

### Planification (SANS DUPLICATION)
USER: "Éteins tout à 22h"
APPAREILS: led1, led2, led_test
{
  "reply": "Entendu, j'éteindrai tous les appareils à 22 heures.",
  "execute": [],
  "planning_commands": [
    {"action":"add", "device":"led1", "time":"22:00", "schedule_action":"OFF", "power":0},
    {"action":"add", "device":"led2", "time":"22:00", "schedule_action":"OFF", "power":0},
    {"action":"add", "device":"led_test", "time":"22:00", "schedule_action":"OFF", "power":0}
  ],
  "source": "cloud"
}

### Contexte de Conversation
HISTORIQUE: User: "Lokossa" | Assistant: "Lokossa est une ville du Bénin"
USER: "Quelle est la température ?"
{
  "reply": "Pour Lokossa, je vais chercher la température actuelle...",
  "execute": [],
  "planning_commands": [],
  "source": "cloud"
}

## 🚨 ERREURS À ÉVITER

❌ Arrondir l'heure (01:35 → 02:00)
❌ Inventer des données météo sans recherche web
❌ Créer des doublons dans planning_commands
❌ Oublier le contexte de conversation
❌ Répondre "OK" sans execute ni planning
❌ Utiliser des balises HTML

RÉPONDS UNIQUEMENT EN JSON VALIDE.
`;

// ========================================
// FONCTION CHAT AVEC GEMINI + WEB
// ========================================
async function chatWithGemini(userMessage, devices, sessionId, maxRetries = API_KEYS.length) {
  if (API_KEYS.length === 0) {
    return { 
      success: false, 
      error: "Aucune clé Gemini disponible",
      useWebOnly: true 
    };
  }

  const context = getOrCreateContext(sessionId);
  const beninTime = getBeninTime();
  
  // Vérifier si recherche web nécessaire
  let webResults = [];
  if (needsWebSearch(userMessage)) {
    webResults = await performWebSearch(userMessage);
  }

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
                reply: "Je suis Intellia v4.0. Prêt à vous aider !",
                execute: [],
                planning_commands: [],
                source: "cloud"
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
║      HEURE ACTUELLE BÉNIN (PRÉCISE)   ║
╚═══════════════════════════════════════╝

${beninTime.formatted}

Il est EXACTEMENT ${beninTime.hoursStr}:${beninTime.minutesStr}
(Ne pas arrondir, utiliser cette heure exacte)

╔═══════════════════════════════════════╗
║         APPAREILS DISPONIBLES         ║
╚═══════════════════════════════════════╝

${JSON.stringify(devices, null, 2)}

╔═══════════════════════════════════════╗
║      HISTORIQUE CONVERSATION          ║
╚═══════════════════════════════════════╝

${context.history.slice(-5).map(h => 
  `User: ${h.user}\nAssistant: ${h.assistant}`
).join('\n---\n')}

${webResults.length > 0 ? `
╔═══════════════════════════════════════╗
║      RÉSULTATS RECHERCHE WEB          ║
╚═══════════════════════════════════════╝

${JSON.stringify(webResults, null, 2)}

(Utilise ces résultats comme source principale)
` : ''}

╔═══════════════════════════════════════╗
║         MESSAGE UTILISATEUR           ║
╚═══════════════════════════════════════╝

"${userMessage}"

────────────────────────────────────────

ANALYSE ET RÉPONDS EN JSON VALIDE.
${webResults.length > 0 ? 'IMPORTANT: Utilise les résultats web fournis ci-dessus.' : ''}
IMPORTANT: Pour les planifications, évite les doublons (un seul planning par device_id).
`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const result = await chat.sendMessage(fullPrompt, { signal: controller.signal });
      clearTimeout(timeout);

      return { 
        success: true, 
        data: result.response.text(), 
        keyObj,
        hadWebResults: webResults.length > 0
      };

    } catch (error) {
      lastError = error;
      const keyObj = API_KEYS[(currentKeyIndex - 1 + API_KEYS.length) % API_KEYS.length];
      const isQuotaError = 
        error.message?.includes('quota') ||
        error.message?.includes('429') ||
        error.message?.includes('RESOURCE_EXHAUSTED');
      markKeyAsFailed(keyObj, isQuotaError);
      console.warn(`⚠️ Tentative ${attempt + 1}/${maxRetries} échouée`);
      if (attempt === maxRetries - 1) break;
    }
  }

  return { success: false, error: lastError };
}

// ========================================
// ROUTE PRINCIPALE /api/chat
// ========================================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, key, devices = [], sessionId = 'default' } = req.body;

    if (key !== AUTH_KEY) {
      return res.status(401).json({ 
        reply: "Clé d'authentification invalide", 
        execute: [], 
        planning_commands: [],
        source: "error"
      });
    }

    if (!message) {
      return res.status(400).json({ 
        reply: "Message requis", 
        execute: [], 
        planning_commands: [],
        source: "error"
      });
    }

    console.log('┌────────────────────────────────────────┐');
    console.log('🔥 MESSAGE:', message);
    
    const beninTime = getBeninTime();
    console.log('🕐 HEURE BÉNIN:', `${beninTime.hoursStr}:${beninTime.minutesStr}`);

    const startTime = Date.now();

    // Essayer avec Gemini Cloud
    const result = await chatWithGemini(message, devices, sessionId);

    // Si Gemini échoue, utiliser recherche web pure
    if (!result.success) {
      console.log('⚠️ Gemini indisponible, recherche web uniquement');
      
      if (needsWebSearch(message)) {
        const webResults = await performWebSearch(message);
        const summary = summarizeWebResults(webResults);
        
        addToContext(sessionId, message, summary);
        
        return res.json({
          reply: summary,
          execute: [],
          planning_commands: [],
          source: "web"
        });
      } else {
        // Réponse d'erreur simple
        return res.json({
          reply: "Le service Gemini est temporairement indisponible. Veuillez réessayer.",
          execute: [],
          planning_commands: [],
          source: "error"
        });
      }
    }

    const aiText = result.data;
    console.log(`⏱️ Temps de réponse: ${Date.now() - startTime}ms`);
    console.log(`🌐 Recherche web: ${result.hadWebResults ? 'OUI' : 'NON'}`);

    let aiJson;
    try {
      aiJson = JSON.parse(aiText);
    } catch (parseError) {
      console.error('❌ ERREUR PARSING:', parseError.message);
      const cleaned = aiText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
      try { 
        aiJson = JSON.parse(cleaned); 
        console.log('✅ JSON récupéré après nettoyage'); 
      } catch (secondError) { 
        console.error('❌ ÉCHEC NETTOYAGE');
        return res.json({ 
          reply: "Désolé, j'ai eu un problème de communication. Reformulez ?", 
          execute: [], 
          planning_commands: [],
          source: "error"
        });
      }
    }

    // Validation et nettoyage
    if (!aiJson.reply || typeof aiJson.reply !== 'string') {
      aiJson.reply = "Commande reçue.";
    }
    if (!Array.isArray(aiJson.execute)) aiJson.execute = [];
    if (!Array.isArray(aiJson.planning_commands)) aiJson.planning_commands = [];
    
    // Supprimer les doublons dans planning_commands
    const uniquePlannings = [];
    const seen = new Set();
    
    for (const plan of aiJson.planning_commands) {
      const key = `${plan.device}_${plan.time}_${plan.schedule_action}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniquePlannings.push(plan);
      }
    }
    
    aiJson.planning_commands = uniquePlannings;
    
    // Nettoyer HTML
    aiJson.reply = aiJson.reply.replace(/<[^>]*>/g, '').trim();

    if (!aiJson.source) {
      aiJson.source = result.hadWebResults ? "web" : "cloud";
    }

    // Sauvegarder dans le contexte
    addToContext(sessionId, message, aiJson.reply);

    console.log('✅ RÉPONSE FINALE');
    console.log(`📊 Execute: ${aiJson.execute.length} | Planning: ${aiJson.planning_commands.length}`);
    console.log('└────────────────────────────────────────┘\n');

    res.json(aiJson);
    
  } catch (error) {
    console.error('💥 ERREUR SERVEUR:', error.message);
    res.status(500).json({ 
      reply: "Désolé, une erreur s'est produite.", 
      execute: [], 
      planning_commands: [],
      source: "error"
    });
  }
});

// ========================================
// ROUTE SANTÉ
// ========================================
app.get('/api/health', (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  const beninTime = getBeninTime();
  
  res.json({ 
    status: 'ok', 
    version: '4.0', 
    features: {
      gemini: API_KEYS.length > 0,
      webSearch: true,
      contextMemory: true
    },
    keys: { 
      total: API_KEYS.length, 
      available: availableKeys 
    },
    time: {
      benin: `${beninTime.hoursStr}:${beninTime.minutesStr}`,
      formatted: beninTime.formatted
    },
    timestamp: new Date().toISOString() 
  });
});

// ========================================
// NETTOYAGE CONTEXTES ANCIENS
// ========================================
setInterval(() => {
  const now = Date.now();
  const maxAge = 3600000; // 1 heure
  
  for (const [sessionId, context] of conversationContexts.entries()) {
    if (now - context.createdAt > maxAge) {
      conversationContexts.delete(sessionId);
      console.log(`🧹 Contexte ${sessionId} nettoyé`);
    }
  }
}, 600000); // Toutes les 10 minutes

// ========================================
// DÉMARRAGE
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v4.0 - HYBRIDE CORRIGÉ     ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🔍 Recherche web: Activée`);
  console.log(`   💾 Mémoire contextuelle: Activée`);
  console.log(`   🕐 Heure Bénin: ${getBeninTime().formatted}\n`);
});
