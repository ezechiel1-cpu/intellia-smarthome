// ========================================
// INTELLIA v4.1 - BUGS CORRIGÉS
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
// CONTEXTE DE CONVERSATION (Mémoire améliorée)
// ========================================
const conversationContexts = new Map();

function getOrCreateContext(sessionId = 'default') {
  if (!conversationContexts.has(sessionId)) {
    conversationContexts.set(sessionId, {
      history: [],
      lastSearches: new Map(), // Cache des recherches web
      userPreferences: {
        showTime: true, // Peut être désactivé par l'utilisateur
      },
      topics: [], // Sujets discutés
      createdAt: Date.now()
    });
  }
  return conversationContexts.get(sessionId);
}

function addToContext(sessionId, userMsg, aiResponse, webResults = null) {
  const context = getOrCreateContext(sessionId);
  
  context.history.push({
    user: userMsg,
    assistant: aiResponse,
    timestamp: Date.now()
  });
  
  // Sauvegarder les recherches web pour éviter les doublons
  if (webResults && webResults.length > 0) {
    const searchKey = userMsg.toLowerCase().trim();
    context.lastSearches.set(searchKey, {
      results: webResults,
      timestamp: Date.now()
    });
  }
  
  // Garder seulement les 15 derniers messages
  if (context.history.length > 15) {
    context.history.shift();
  }
  
  // Nettoyer les vieilles recherches (> 5 min)
  for (const [key, data] of context.lastSearches.entries()) {
    if (Date.now() - data.timestamp > 300000) {
      context.lastSearches.delete(key);
    }
  }
}

// Extraire les préférences utilisateur du message
function updateUserPreferences(sessionId, message) {
  const context = getOrCreateContext(sessionId);
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes('ne repete plus') && lowerMsg.includes('heure')) {
    context.userPreferences.showTime = false;
    console.log('⚙️ Préférence: affichage heure désactivé');
  }
  
  if (lowerMsg.includes('affiche') && lowerMsg.includes('heure')) {
    context.userPreferences.showTime = true;
    console.log('⚙️ Préférence: affichage heure activé');
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
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  
  let beninHours = utcHours + 1;
  let beninMinutes = utcMinutes;
  
  if (beninHours >= 24) {
    beninHours -= 24;
  }
  
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
// RECHERCHE WEB RÉELLE (Améliorée)
// ========================================
async function performWebSearch(query, context) {
  // Vérifier le cache
  const searchKey = query.toLowerCase().trim();
  if (context.lastSearches.has(searchKey)) {
    const cached = context.lastSearches.get(searchKey);
    if (Date.now() - cached.timestamp < 300000) { // 5 min cache
      console.log(`💾 Utilisation cache pour: "${query}"`);
      return cached.results;
    }
  }
  
  console.log(`🔍 Recherche web: "${query}"`);
  
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

// ========================================
// DÉTECTION DU BESOIN DE RECHERCHE WEB (Corrigée)
// ========================================
function needsWebSearch(message, context) {
  const lowerMsg = message.toLowerCase().trim();
  
  // ❌ PAS DE RECHERCHE pour ces cas
  const noSearchPatterns = [
    /^(c'est quoi|quel est) (ton|votre) nom/i,
    /^qui es-tu/i,
    /^tu t'appelles comment/i,
    /^bonjour/i,
    /^salut/i,
    /^merci/i,
    /^ok$/i,
    /^d'accord$/i,
    /^allume/i,
    /^eteins/i,
    /^règle/i,
  ];
  
  if (noSearchPatterns.some(pattern => pattern.test(lowerMsg))) {
    return false;
  }
  
  // ✅ RECHERCHE pour ces cas
  const webKeywords = [
    'météo', 'temps', 'température', 'pluie', 'soleil',
    'actualité', 'news', 'nouvelles',
    'recherche', 'cherche', 'trouve',
    'où se trouve', 'où est',
    'combien coûte', 'prix de',
    'qui est', // Seulement pour les personnalités publiques
  ];
  
  // Si "qui est" + nom propre (commence par majuscule)
  if (lowerMsg.includes('qui est')) {
    const words = message.split(' ');
    const hasProperNoun = words.some(w => w.length > 2 && w[0] === w[0].toUpperCase());
    return hasProperNoun;
  }
  
  return webKeywords.some(kw => lowerMsg.includes(kw));
}

// ========================================
// PROMPT SYSTÈME AMÉLIORÉ v4.1
// ========================================
const systemPrompt = `
Tu es "Intellia", un assistant domotique intelligent basé au BÉNIN.

## 🎯 RÈGLES FONDAMENTALES

### 1. AFFICHAGE DE L'HEURE
- Si user_preferences.showTime = true : mentionne l'heure dans ta réponse
- Si user_preferences.showTime = false : NE MENTIONNE JAMAIS l'heure
- Format (si activé): "Il est actuellement [heure exacte]"

### 2. RECHERCHE WEB
- Si webResults fournis : utilise-les comme SOURCE PRINCIPALE
- Si webResults vides : réponds avec tes connaissances générales
- Pour Lokossa : cite les quartiers comme Agbodji, Hozin, Koudo si aucun résultat web
- JAMAIS répéter la même recherche web 2 fois de suite

### 3. CONTEXTE DE CONVERSATION
- Utilise l'historique pour comprendre les références
- Si sujet déjà discuté : ne pas re-chercher, approfondir
- Exemple: "Lokossa" déjà mentionné → "quartiers" = quartiers de Lokossa

### 4. IDENTITÉ
- Ton nom est "Intellia"
- Réponds directement sans recherche web pour "c'est quoi ton nom"

### 5. RÉPONSES CONCISES
- Domotique : 1-2 phrases max
- Questions générales : 2-4 phrases
- Pas de listes à puces en vocal

## 📋 FORMAT DE RÉPONSE JSON

{
  "reply": "Réponse naturelle en français",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [],
  "source": "cloud" | "web" | "knowledge"
}

## 💡 EXEMPLES

### Identité (SANS recherche web)
USER: "C'est quoi ton nom ?"
{
  "reply": "Je m'appelle Intellia.",
  "execute": [],
  "planning_commands": [],
  "source": "knowledge"
}

### Contexte (Lokossa déjà discuté)
HISTORIQUE: [...discussion sur Lokossa...]
USER: "trouve les quartiers"
{
  "reply": "Les principaux quartiers de Lokossa sont Agbodji, Hozin, Koudo et le centre-ville.",
  "execute": [],
  "planning_commands": [],
  "source": "knowledge"
}

### Heure désactivée
user_preferences.showTime = false
USER: "Quelle heure ?"
{
  "reply": "1 heure 35.",
  "execute": [],
  "planning_commands": [],
  "source": "knowledge"
}

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
  
  // Mettre à jour les préférences utilisateur
  updateUserPreferences(sessionId, userMessage);
  
  // Vérifier si recherche web nécessaire
  let webResults = [];
  if (needsWebSearch(userMessage, context)) {
    webResults = await performWebSearch(userMessage, context);
  }

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const keyObj = getNextApiKey();
      const genAI = new GoogleGenerativeAI(keyObj.key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
                reply: "Je suis Intellia. Prêt à vous aider !",
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

╔═══════════════════════════════════════╗
║      PRÉFÉRENCES UTILISATEUR          ║
╚═══════════════════════════════════════╝

${JSON.stringify(context.userPreferences, null, 2)}

╔═══════════════════════════════════════╗
║         APPAREILS DISPONIBLES         ║
╚═══════════════════════════════════════╝

${JSON.stringify(devices, null, 2)}

╔═══════════════════════════════════════╗
║      HISTORIQUE CONVERSATION          ║
╚═══════════════════════════════════════╝

${context.history.slice(-8).map(h => 
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
${!context.userPreferences.showTime ? 'IMPORTANT: Ne mentionne PAS l\'heure dans ta réponse.' : ''}
${webResults.length > 0 ? 'IMPORTANT: Utilise les résultats web fournis.' : ''}
`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const result = await chat.sendMessage(fullPrompt, { signal: controller.signal });
      clearTimeout(timeout);

      return { 
        success: true, 
        data: result.response.text(), 
        keyObj,
        hadWebResults: webResults.length > 0,
        webResults
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

    const startTime = Date.now();
    const result = await chatWithGemini(message, devices, sessionId);

    if (!result.success) {
      console.log('⚠️ Gemini indisponible, réponse de secours');
      return res.json({
        reply: "Le service est temporairement indisponible. Veuillez réessayer.",
        execute: [],
        planning_commands: [],
        source: "error"
      });
    }

    const aiText = result.data;
    console.log(`⏱️ Temps: ${Date.now() - startTime}ms`);

    let aiJson;
    try {
      aiJson = JSON.parse(aiText);
    } catch (parseError) {
      const cleaned = aiText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
      try { 
        aiJson = JSON.parse(cleaned); 
      } catch (secondError) { 
        return res.json({ 
          reply: "Désolé, reformulez votre demande ?", 
          execute: [], 
          planning_commands: [],
          source: "error"
        });
      }
    }

    // Validation
    if (!aiJson.reply) aiJson.reply = "Commande reçue.";
    if (!Array.isArray(aiJson.execute)) aiJson.execute = [];
    if (!Array.isArray(aiJson.planning_commands)) aiJson.planning_commands = [];
    
    // Supprimer doublons
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

    // Sauvegarder contexte
    addToContext(sessionId, message, aiJson.reply, result.webResults);

    console.log('✅ RÉPONSE FINALE');
    console.log('└────────────────────────────────────────┘\n');

    res.json(aiJson);
    
  } catch (error) {
    console.error('💥 ERREUR:', error.message);
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
    version: '4.1-fixed', 
    features: {
      gemini: API_KEYS.length > 0,
      webSearch: true,
      contextMemory: true,
      userPreferences: true
    },
    keys: { 
      total: API_KEYS.length, 
      available: availableKeys 
    },
    time: {
      benin: `${beninTime.hoursStr}:${beninTime.minutesStr}`,
      formatted: beninTime.formatted
    }
  });
});

// ========================================
// NETTOYAGE CONTEXTES
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
}, 600000);

// ========================================
// DÉMARRAGE
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v4.1 - BUGS CORRIGÉS       ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🔍 Recherche web: Optimisée`);
  console.log(`   💾 Mémoire contextuelle: Améliorée`);
  console.log(`   ⚙️ Préférences utilisateur: Activées\n`);
});
