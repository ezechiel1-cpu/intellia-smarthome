// ========================================
// INTELLIA v5.0 - ASSISTANT UNIVERSEL ULTRA-INTELLIGENT
// ✅ Conscience de l'état des appareils
// ✅ Suggestions proactives contextuelles
// ✅ Assistant universel (code, recherche, domotique)
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
// CONTEXTE DE CONVERSATION ENRICHI
// ========================================
const conversationContexts = new Map();

function getOrCreateContext(sessionId = 'default') {
  if (!conversationContexts.has(sessionId)) {
    conversationContexts.set(sessionId, {
      history: [],
      lastSearches: new Map(),
      userPreferences: {
        showTime: true,
        lastLocation: null,
        lastTopic: null
      },
      userBehavior: {
        frequentCommands: [],
        activeHours: [],
        preferredDevices: []
      },
      deviceStates: {}, // NOUVEAU : Stockage de l'état des appareils
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
  
  if (webResults && webResults.length > 0) {
    const searchKey = userMsg.toLowerCase().trim();
    context.lastSearches.set(searchKey, {
      results: webResults,
      timestamp: Date.now()
    });
  }
  
  // Garder 20 derniers messages
  if (context.history.length > 20) {
    context.history.shift();
  }
  
  // Nettoyer vieilles recherches
  for (const [key, data] of context.lastSearches.entries()) {
    if (Date.now() - data.timestamp > 600000) { // 10 min
      context.lastSearches.delete(key);
    }
  }
}

function updateUserPreferences(sessionId, message) {
  const context = getOrCreateContext(sessionId);
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes('ne repete plus') && lowerMsg.includes('heure')) {
    context.userPreferences.showTime = false;
  }
  
  if (lowerMsg.includes('affiche') && lowerMsg.includes('heure')) {
    context.userPreferences.showTime = true;
  }
}

// NOUVEAU : Mise à jour de l'état des appareils
function updateDeviceStates(sessionId, devices) {
  const context = getOrCreateContext(sessionId);
  
  devices.forEach(device => {
    if (!context.deviceStates[device.id]) {
      context.deviceStates[device.id] = {
        id: device.id,
        name: device.name,
        type: device.type,
        room: device.room,
        state: 'OFF',
        power: 0,
        lastChanged: null
      };
    }
  });
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
// RECHERCHE WEB INTELLIGENTE
// ========================================
async function performWebSearch(query, context) {
  const searchKey = query.toLowerCase().trim();
  
  // Cache 10 minutes
  if (context.lastSearches.has(searchKey)) {
    const cached = context.lastSearches.get(searchKey);
    if (Date.now() - cached.timestamp < 600000) {
      console.log(`💾 Cache: "${query}"`);
      return cached.results;
    }
  }
  
  console.log(`🔍 Recherche: "${query}"`);
  
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

    console.log(`✅ ${results.length} résultats`);
    return results;
    
  } catch (error) {
    console.error('❌ Erreur recherche:', error.message);
    return [];
  }
}

// ========================================
// DÉTECTION INTELLIGENTE BESOIN RECHERCHE
// ========================================
function needsWebSearch(message, context) {
  const lowerMsg = message.toLowerCase().trim();
  
  // ❌ JAMAIS rechercher pour :
  const noSearchPatterns = [
    /^(c'est quoi|quel est) (ton|votre|le) nom/i,
    /^qui es-tu/i,
    /^bonjour/i,
    /^salut/i,
    /^merci/i,
    /^ok$/i,
    /^d'accord$/i,
    /^allume/i,
    /^eteins/i,
    /^règle/i,
    /^je (sort|sors|pars)/i,
    /^je (suis|reviens|rentre)/i,
    /^il fait (nuit|jour|sombre|chaud)/i,
    /appareil.*état/i,
    /état.*appareil/i,
    /code (arduino|python|javascript)/i, // Code = pas de recherche
    /génère.*code/i,
    /écris.*code/i
  ];
  
  if (noSearchPatterns.some(pattern => pattern.test(lowerMsg))) {
    return false;
  }
  
  // ✅ Rechercher pour :
  const webKeywords = [
    'météo', 'temps qu\'il fait', 'température', 'pluie', 'soleil',
    'actualité', 'news', 'nouvelles',
    'recherche', 'cherche', 'trouve',
    'où se trouve', 'où est situé',
    'combien coûte', 'prix de',
    'qui est', 'c\'est qui'
  ];
  
  // "qui est" uniquement pour personnalités publiques
  if (lowerMsg.includes('qui est')) {
    const words = message.split(' ');
    const hasProperNoun = words.some(w => w.length > 2 && w[0] === w[0].toUpperCase());
    return hasProperNoun;
  }
  
  return webKeywords.some(kw => lowerMsg.includes(kw));
}

// ========================================
// ANALYSE CONTEXTUELLE INTELLIGENTE
// ========================================
function analyzeContext(message, context, devices) {
  const analysis = {
    isDomoticCommand: false,
    needsDeviceState: false,
    isCodeRequest: false,
    isGeneralQuestion: false,
    suggestedActions: []
  };
  
  const lowerMsg = message.toLowerCase();
  
  // Détection commande domotique
  if (/allume|éteins|règle|luminosité|appareil/i.test(lowerMsg)) {
    analysis.isDomoticCommand = true;
  }
  
  // Détection demande d'état
  if (/état|status|allumé|éteint|quel.*appareil/i.test(lowerMsg)) {
    analysis.needsDeviceState = true;
  }
  
  // Détection demande de code
  if (/code|programme|script|arduino|python|javascript/i.test(lowerMsg)) {
    analysis.isCodeRequest = true;
  }
  
  // Question générale
  if (/qui est|c'est quoi|comment|pourquoi|qu'est-ce/i.test(lowerMsg)) {
    analysis.isGeneralQuestion = true;
  }
  
  // Suggestions contextuelles
  if (lowerMsg.includes('je sors') || lowerMsg.includes('je pars')) {
    const onDevices = Object.values(context.deviceStates).filter(d => d.state === 'ON');
    if (onDevices.length > 0) {
      analysis.suggestedActions.push({
        type: 'security_check',
        message: `Vous avez ${onDevices.length} appareil(s) allumé(s). Voulez-vous que je les éteigne ?`,
        devices: onDevices.map(d => d.id)
      });
    }
  }
  
  if (lowerMsg.includes('il fait nuit') || lowerMsg.includes('sombre')) {
    const offLights = Object.values(context.deviceStates)
      .filter(d => d.type === 'lamp' && d.state === 'OFF');
    
    if (offLights.length > 0) {
      analysis.suggestedActions.push({
        type: 'lighting_suggestion',
        message: `Il fait sombre. Je peux allumer : ${offLights.map(d => d.name).join(', ')}`,
        devices: offLights.map(d => d.id)
      });
    }
  }
  
  return analysis;
}

// ========================================
// PROMPT SYSTÈME v5.0 ULTRA-INTELLIGENT
// ========================================
const systemPrompt = `
Tu es "Intellia", un assistant universel ultra-intelligent.

## 🎯 CAPACITÉS

### 1. ASSISTANT UNIVERSEL
- Domotique : contrôle appareils
- Code : génère Arduino, Python, JavaScript, etc.
- Recherche : informations web en temps réel
- Conversation : questions générales, aide

### 2. CONSCIENCE DES APPAREILS
- Tu CONNAIS l'état réel de tous les appareils (fourni dans deviceStates)
- Si appareil déjà allumé : informe l'utilisateur intelligemment
- Propose des alternatives pertinentes

### 3. SUGGESTIONS PROACTIVES
- Analyse le contexte (heure, état appareils, historique)
- Propose des actions AVANT qu'on te les demande
- Exemples :
  * "Je sors" → "Voulez-vous que j'éteigne les 3 lampes allumées ?"
  * "Il fait sombre" → "Je peux allumer les lampes du salon et de la chambre"
  * "Il fait chaud" → "Le ventilateur du salon est éteint, voulez-vous que je l'allume ?"

### 4. GESTION HEURE
- Si showTime = true : mentionne l'heure
- Si showTime = false : NE JAMAIS mentionner l'heure

### 5. RECHERCHE WEB
- Utilise webResults si fournis
- Ne recherche PAS pour : code, domotique, identité
- Recherche pour : météo, actualités, personnalités

## 📋 FORMAT RÉPONSE JSON

{
  "reply": "Réponse naturelle et intelligente",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [],
  "suggestions": [
    {
      "type": "info|action|warning",
      "message": "Suggestion pertinente",
      "context": "Raison de la suggestion"
    }
  ],
  "source": "cloud|web|knowledge"
}

## 💡 EXEMPLES

### Appareil déjà allumé
USER: "Allume la lampe du salon"
deviceStates: { "salon_lamp": { state: "ON", power: 80 } }
{
  "reply": "La lampe du salon est déjà allumée à 80%. Voulez-vous que je change la luminosité ?",
  "execute": [],
  "suggestions": [
    {
      "type": "info",
      "message": "Je peux régler à 100% si vous voulez plus de lumière",
      "context": "Appareil déjà actif"
    }
  ],
  "source": "cloud"
}

### Code Arduino
USER: "Donne moi un code Arduino pour LED"
{
  "reply": "Voici un exemple de code Arduino pour contrôler une LED :\n\n\`\`\`cpp\nvoid setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(1000);\n  digitalWrite(13, LOW);\n  delay(1000);\n}\n\`\`\`\n\nCe code fait clignoter la LED connectée à la broche 13.",
  "execute": [],
  "suggestions": [],
  "source": "knowledge"
}

### Suggestion proactive
USER: "Je sors"
deviceStates: { "salon_lamp": {state:"ON"}, "chambre_lamp": {state:"ON"}, "cuisine_lamp": {state:"OFF"} }
{
  "reply": "D'accord. Vous avez 2 lampes allumées (salon et chambre). Voulez-vous que je les éteigne pour économiser l'énergie ?",
  "execute": [],
  "suggestions": [
    {
      "type": "action",
      "message": "Éteindre salon_lamp et chambre_lamp",
      "context": "Sécurité et économie d'énergie"
    }
  ],
  "source": "cloud"
}

### État des appareils
USER: "Les appareils sont à quel état ?"
deviceStates: { "salon_lamp": {state:"ON", power:60}, "chambre_lamp": {state:"OFF"}, "ventilateur": {state:"ON", power:100} }
{
  "reply": "Voici l'état actuel :\n• Lampe salon : Allumée (60%)\n• Lampe chambre : Éteinte\n• Ventilateur : Allumé (100%)",
  "execute": [],
  "suggestions": [
    {
      "type": "info",
      "message": "2 appareils sur 3 sont actifs",
      "context": "Vue d'ensemble"
    }
  ],
  "source": "cloud"
}

## 🚨 RÈGLES CRITIQUES

1. TOUJOURS vérifier deviceStates avant toute action
2. JAMAIS rechercher pour code/domotique/identité
3. Suggestions basées sur CONTEXTE RÉEL (heure, état, historique)
4. Réponses NATURELLES et CONVERSATIONNELLES
5. Code formaté en Markdown avec backticks
6. Si plusieurs actions possibles : PROPOSER au lieu d'exécuter

RÉPONDS UNIQUEMENT EN JSON VALIDE.
`;

// ========================================
// FONCTION CHAT AVEC GEMINI
// ========================================
async function chatWithGemini(userMessage, devices, deviceStates, sessionId, maxRetries = API_KEYS.length) {
  if (API_KEYS.length === 0) {
    return { 
      success: false, 
      error: "Aucune clé Gemini disponible"
    };
  }

  const context = getOrCreateContext(sessionId);
  const beninTime = getBeninTime();
  
  updateUserPreferences(sessionId, userMessage);
  updateDeviceStates(sessionId, devices);
  
  // Fusionner états UI avec contexte
  Object.keys(deviceStates).forEach(deviceId => {
    if (context.deviceStates[deviceId]) {
      context.deviceStates[deviceId].state = deviceStates[deviceId].etat || 'OFF';
      context.deviceStates[deviceId].power = deviceStates[deviceId].luminosite || 0;
      context.deviceStates[deviceId].lastChanged = Date.now();
    }
  });
  
  const contextAnalysis = analyzeContext(userMessage, context, devices);
  
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
                reply: "Je suis Intellia v5.0, votre assistant universel ultra-intelligent !",
                execute: [],
                planning_commands: [],
                suggestions: [],
                source: "cloud"
              })
            }] 
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.8,
          maxOutputTokens: 8192,
        },
      });

      const fullPrompt = `
╔═══════════════════════════════════════╗
║      HEURE BÉNIN PRÉCISE              ║
╚═══════════════════════════════════════╝

${beninTime.formatted}
Heure exacte: ${beninTime.hoursStr}:${beninTime.minutesStr}

╔═══════════════════════════════════════╗
║      PRÉFÉRENCES UTILISATEUR          ║
╚═══════════════════════════════════════╝

${JSON.stringify(context.userPreferences, null, 2)}

╔═══════════════════════════════════════╗
║   ÉTAT RÉEL DES APPAREILS (TEMPS RÉEL)║
╚═══════════════════════════════════════╝

${JSON.stringify(context.deviceStates, null, 2)}

IMPORTANT: Ces états sont EN TEMPS RÉEL. Utilise-les pour :
- Détecter si appareil déjà allumé/éteint
- Proposer suggestions intelligentes
- Éviter actions inutiles

╔═══════════════════════════════════════╗
║      MÉTADONNÉES APPAREILS            ║
╚═══════════════════════════════════════╝

${JSON.stringify(devices, null, 2)}

╔═══════════════════════════════════════╗
║      ANALYSE CONTEXTUELLE             ║
╚═══════════════════════════════════════╝

${JSON.stringify(contextAnalysis, null, 2)}

╔═══════════════════════════════════════╗
║      HISTORIQUE CONVERSATION          ║
╚═══════════════════════════════════════╝

${context.history.slice(-10).map(h => 
  `User: ${h.user}\nAssistant: ${h.assistant}`
).join('\n---\n')}

${webResults.length > 0 ? `
╔═══════════════════════════════════════╗
║      RÉSULTATS WEB                    ║
╚═══════════════════════════════════════╝

${JSON.stringify(webResults, null, 2)}

UTILISE ces résultats comme source principale.
` : ''}

╔═══════════════════════════════════════╗
║      MESSAGE UTILISATEUR              ║
╚═══════════════════════════════════════╝

"${userMessage}"

────────────────────────────────────────

ANALYSE ET RÉPONDS EN JSON VALIDE.

RAPPELS CRITIQUES:
${!context.userPreferences.showTime ? '⚠️ NE PAS mentionner l\'heure dans la réponse !' : ''}
${contextAnalysis.isDomoticCommand ? '⚠️ Vérifier deviceStates avant toute action !' : ''}
${contextAnalysis.isCodeRequest ? '⚠️ Générer le code demandé sans recherche web !' : ''}
${contextAnalysis.suggestedActions.length > 0 ? `⚠️ Suggestions détectées: ${JSON.stringify(contextAnalysis.suggestedActions)}` : ''}
`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const result = await chat.sendMessage(fullPrompt, { signal: controller.signal });
      clearTimeout(timeout);

      return { 
        success: true, 
        data: result.response.text(), 
        keyObj,
        hadWebResults: webResults.length > 0,
        webResults,
        contextAnalysis
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
    const { message, key, devices = [], deviceStates = {}, sessionId = 'default' } = req.body;

    if (key !== AUTH_KEY) {
      return res.status(401).json({ 
        reply: "Clé d'authentification invalide", 
        execute: [], 
        planning_commands: [],
        suggestions: [],
        source: "error"
      });
    }

    if (!message) {
      return res.status(400).json({ 
        reply: "Message requis", 
        execute: [], 
        planning_commands: [],
        suggestions: [],
        source: "error"
      });
    }

    console.log('┌────────────────────────────────────────┐');
    console.log('💬 MESSAGE:', message);
    console.log('📊 APPAREILS:', devices.length);
    console.log('🔌 ÉTATS:', Object.keys(deviceStates).length);

    const startTime = Date.now();
    const result = await chatWithGemini(message, devices, deviceStates, sessionId);

    if (!result.success) {
      console.log('⚠️ Gemini indisponible');
      return res.json({
        reply: "Service temporairement indisponible. Veuillez réessayer.",
        execute: [],
        planning_commands: [],
        suggestions: [],
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
          suggestions: [],
          source: "error"
        });
      }
    }

    // Validation
    if (!aiJson.reply) aiJson.reply = "Commande reçue.";
    if (!Array.isArray(aiJson.execute)) aiJson.execute = [];
    if (!Array.isArray(aiJson.planning_commands)) aiJson.planning_commands = [];
    if (!Array.isArray(aiJson.suggestions)) aiJson.suggestions = [];
    
    // Supprimer doublons planifications
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

    console.log('✅ RÉPONSE GÉNÉRÉE');
    console.log(`📤 Execute: ${aiJson.execute.length}`);
    console.log(`📅 Planning: ${aiJson.planning_commands.length}`);
    console.log(`💡 Suggestions: ${aiJson.suggestions.length}`);
    console.log('└────────────────────────────────────────┘\n');

    res.json(aiJson);
    
  } catch (error) {
    console.error('💥 ERREUR:', error.message);
    res.status(500).json({ 
      reply: "Désolé, une erreur s'est produite.", 
      execute: [], 
      planning_commands: [],
      suggestions: [],
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
    version: '5.0-ultra', 
    features: {
      gemini: API_KEYS.length > 0,
      webSearch: true,
      contextMemory: true,
      userPreferences: true,
      deviceStateAwareness: true,
      proactiveSuggestions: true,
      universalAssistant: true,
      codeGeneration: true
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
  const maxAge = 7200000; // 2 heures
  
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
  console.log('   ║  INTELLIA v5.0 - ULTRA-INTELLIGENT   ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🔍 Recherche web: Optimisée`);
  console.log(`   💾 Mémoire contextuelle: Avancée`);
  console.log(`   ⚙️ Préférences utilisateur: Activées`);
  console.log(`   🧠 Conscience état appareils: Activée`);
  console.log(`   💡 Suggestions proactives: Activées`);
  console.log(`   🌐 Assistant universel: Activé`);
  console.log(`   💻 Génération code: Activée\n`);
});
