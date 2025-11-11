// ========================================
// INTELLIA v5.0 - ASSISTANT UNIVERSEL ULTRA-INTELLIGENT
// ✅ Conscience de l'état des appareils
// ✅ Suggestions proactives contextuelles
// ✅ Assistant universel (code, recherche, domotique)
// ✅ CORRIGÉ : Gestion de la planification des tâches
//
// 🚀 VERSION FINALE (CORRECTION FIREBASE)
// ✅ Le serveur demande l'état réel à Firebase avant de contacter Gemini
// ✅ Correction des encodages (é, ✅, 💬)
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ AJOUT FIREBASE (Basé sur index.html)
// Assurez-vous d'avoir fait : npm install firebase
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get } = require("firebase/database");

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

// ✅ CONFIG FIREBASE (Tirée de index.html)
const firebaseConfig = {
    apiKey: "AIzaSyA5oYEu4-nOUtjOe2JJ4C9VwNniNSBdjqI",
    authDomain: "mamaisonintelligente-14485.firebaseapp.com",
    databaseURL: "https://mamaisonintelligente-14485-default-rtdb.firebaseio.com",
    projectId: "mamaisonintelligente-14485",
    storageBucket: "mamaisonintelligente-14485.firebasestorage.app",
    messagingSenderId: "197281963087",
    appId: "1:197281963087:web:da680779479391d91f1e3a"
};

// ✅ Initialisation de Firebase
try {
    const firebaseApp = initializeApp(firebaseConfig);
    const db = getDatabase(firebaseApp);
    console.log("🔥 Connexion à Firebase Réussie (Source de vérité)");
} catch (e) {
    console.error("❌ ERREUR CRITIQUE: Impossible d'initialiser Firebase. L'IA n'aura pas l'état réel.", e);
}

// Noms des "dossiers" (Ref) dans Firebase (tiré de index.html)
const DEVICES_STATES_REF = "devices"; // Ligne 638 de index.html


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
// CONTEXTE DE CONVERSATION ENRICHI (✅ AMÉLIORÉ - Analyse Point 2)
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
      // ❌ 'userBehavior' supprimé car non utilisé (Analyse Point 2.A)
      deviceStates: {}, // Stockage de l'état des appareils
      createdAt: Date.now(),
      lastAccessed: Date.now() // Pour futures optimisations
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
  
  context.lastAccessed = Date.now(); // Mettre à jour l'accès
  
  if (webResults && webResults.length > 0) {
    const searchKey = userMsg.toLowerCase().trim();
    context.lastSearches.set(searchKey, {
      results: webResults,
      timestamp: Date.now()
    });
  }
  
  // ✅ Garder 50 derniers messages (Analyse Point 2.C)
  if (context.history.length > 50) {
    context.history.shift();
  }
  
  // ❌ Nettoyage 'lastSearches' déplacé en tâche de fond (Analyse Point 2.B)
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

// NOUVEAU : Mise à jour de l'état des appareils (✅ AMÉLIORÉ - Analyse Point 3)
// Note: Ceci initialise la *structure* du contexte. La *mise à jour* se fait avec Firebase.
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
        lastChanged: null,
        history: [] // ✅ NOUVEAU: Historique des états (Analyse Point 3)
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

// ✅ NOUVEAU: Formatage avancé des réponses AI (demande utilisateur)
/**
* Formate correctement les réponses AI avec retours à la ligne
*/
function formatAIResponse(text) {
  if (typeof text !== 'string') return text; // Garde-fou
  return text
    // Convertir balises HTML en retours à la ligne
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    
    // Supprimer toutes les balises HTML restantes
    .replace(/<[^>]*>/g, '')
    
    // Nettoyer les espaces
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    
    // Normaliser les retours à la ligne
    .replace(/\r\n/g, '\n')       // Windows → Unix
    .replace(/\r/g, '\n')         // Mac → Unix
    .replace(/\n{3,}/g, '\n\n')   // Max 2 retours consécutifs
    .replace(/[ \t]+\n/g, '\n')   // Supprimer espaces avant retours
    .replace(/\n[ \t]+/g, '\n')   // Supprimer espaces après retours
    
    // Nettoyer début et fin
    .trim();
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
    /^éteins/i, // Correction encodage
    /^règle/i, // Correction encodage
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
// ANALYSE CONTEXTUELLE INTELLIGENTE (✅ AMÉLIORÉE - Analyse Point 4 & 5)
// ========================================
function analyzeContext(message, context, devices, beninTime) {
  const analysis = {
    isDomoticCommand: false,
    needsDeviceState: false,
    isCodeRequest: false,
    isGeneralQuestion: false,
    suggestedActions: []
  };
  
  const lowerMsg = message.toLowerCase();

  // --- Logique existante ---
  if (/allume|éteins|règle|luminosité|appareil/i.test(lowerMsg)) {
    analysis.isDomoticCommand = true;
  }
  if (/état|status|allumé|éteint|quel.*appareil/i.test(lowerMsg)) {
    analysis.needsDeviceState = true;
  }
  if (/code|programme|script|arduino|python|javascript/i.test(lowerMsg)) {
    analysis.isCodeRequest = true;
  }
  if (/qui est|c'est quoi|comment|pourquoi|qu'est-ce/i.test(lowerMsg)) {
    analysis.isGeneralQuestion = true;
  }

  // --- Suggestions existantes ---
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

  // --- ✅ NOUVEAU : Détection patterns temporels (Analyse Point 4.A) ---
  if (/comme (hier|ce matin|la dernière fois|avant)/.test(lowerMsg)) {
    analysis.needsHistoricalData = true;
    const match = lowerMsg.match(/comme ([^,\.]+)/);
    if (match) {
        analysis.temporalReference = match[1];
    }
  }
  
  // --- ✅ NOUVEAU : Détection intentions multiples (Analyse Point 4.B) ---
  const actions = lowerMsg.match(/allume|éteins|règle|ouvre|ferme/g);
  if (actions && actions.length > 1) {
    analysis.multipleActions = true;
    analysis.actionCount = actions.length;
  }
  
  // --- ✅ NOUVEAU : Détection contradictions récentes (Analyse Point 4.C) ---
  const recentMessages = context.history.slice(-3);
  if (recentMessages.some(h => 
    h.user.includes('éteins') && lowerMsg.includes('noir'))) {
    analysis.possibleContradiction = true;
    analysis.contradictionHint = "Vous venez d'éteindre les lumières";
  }

  // --- ✅ NOUVEAU : Suggestions basées sur l'heure (Analyse Point 5.A) ---
  // beninTime est requis ici
  if (beninTime && (beninTime.hours >= 22 || beninTime.hours < 6)) {
    const brightDevices = Object.values(context.deviceStates)
      .filter(d => d.type === 'lamp' && d.state === 'ON' && d.power > 50);
    
    if (brightDevices.length > 0) {
      analysis.suggestedActions.push({
        type: 'energy_saving',
        message: `Il est ${beninTime.hoursStr}:${beninTime.minutesStr}. Voulez-vous réduire la luminosité pour économiser ?`,
        devices: brightDevices.map(d => d.id)
      });
    }
  }

  // --- ✅ NOUVEAU : Suggestions basées sur la durée d'allumage (Analyse Point 5.B) ---
  const now = Date.now();
  const longRunningDevices = Object.values(context.deviceStates)
    .filter(d => d.state === 'ON' && 
      d.lastChanged && (now - d.lastChanged) > 14400000); // 4h

  if (longRunningDevices.length > 0) {
    analysis.suggestedActions.push({
      type: 'usage_alert',
      message: `Certains appareils sont allumés depuis longtemps : ${longRunningDevices.map(d => d.name).join(', ')}`,
      devices: longRunningDevices.map(d => d.id)
    });
  }
  
  // Note: Point 5.C (Patterns d'utilisation) n'est pas implémenté car `detectRoutineDevices` n'est pas défini.
  
  return analysis;
}

// ========================================
// PROMPT SYSTÈME v5.0 (✅ OPTIMISÉ - Analyse Point 7)
// ========================================
const systemPrompt = `
Tu es Intellia v5.0, assistant universel ultra-intelligent.

## CAPACITÉS
Domotique, Code (Arduino/Python/JS), Recherche web, Conversation naturelle

## FORMAT JSON
{
  "reply": "Réponse naturelle",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [{"action":"add", "device":"id", "time":"HH:MM", "power":100}],
  "suggestions": [{"type":"info|action|warning", "message":"...", "context":"..."}],
  "source": "cloud|web|knowledge"
}

## RÈGLES CRITIQUES
1. Vérifie deviceStates AVANT toute action
2. Ne recherche PAS pour code/domotique
3. Suggestions basées sur CONTEXTE RÉEL
4. Si showTime=false, NE JAMAIS mentionner l'heure
5. Réponses NATURELLES et CONVERSATIONNELLES

## EXEMPLES (seulement 2)
[Exemple 1: Appareil déjà allumé]
USER: "Allume la lampe du salon"
CONTEXTE: [États: {"salon_lamp":{"state":"ON","power":80}}]
{
  "reply": "La lampe du salon est déjà allumée à 80%. Voulez-vous que je change la luminosité ?",
  "execute": [],
  "planning_commands": [],
  "suggestions": [{"type":"info", "message":"Régler à 100% ?", "context":"Appareil déjà actif"}],
  "source": "cloud"
}

[Exemple 2: Suggestion proactive]
USER: "Je sors"
CONTEXTE: [États: {"salon_lamp":{"state":"ON"},"chambre_lamp":{"state":"ON"}}]
{
  "reply": "D'accord. Vous avez 2 lampes allumées. Voulez-vous que je les éteigne ?",
  "execute": [],
  "planning_commands": [],
  "suggestions": [{"type":"action", "message":"Éteindre salon_lamp et chambre_lamp", "context":"Sécurité"}],
  "source": "cloud"
}

RÉPONDS EN JSON VALIDE.
`;


// ========================================
// FONCTION CHAT AVEC GEMINI (✅ CORRECTION FINALE - Lecture Firebase)
// ========================================
async function chatWithGemini(userMessage, devices, deviceStates, sessionId, maxRetries = API_KEYS.length) {
    // -----------------------------------------------------------------
    // ✅ CORRECTION (DEMANDE UTILISATEUR)
    // Au lieu de faire confiance à 'deviceStates' (venant du client),
    // nous demandons l'état réel à Firebase avant de parler à l'IA.
    // -----------------------------------------------------------------
    let realDeviceStates = {};
    try {
        const db = getDatabase();
        const snapshot = await get(ref(db, DEVICES_STATES_REF));
        realDeviceStates = snapshot.val() || {};
        console.log(`🔥 États réels récupérés de Firebase pour ${Object.keys(realDeviceStates).length} appareils.`);
    } catch (e) {
        console.error("❌ ERREUR FIREBASE: Impossible de lire les états. Utilisation des états (potentiellement obsolètes) du client.", e.message);
        // En cas d'échec, on se rabat sur les états envoyés par le client
        realDeviceStates = deviceStates; 
    }
    // -----------------------------------------------------------------

  if (API_KEYS.length === 0) {
    return { 
      success: false, 
      error: "Aucune clé Gemini disponible"
    };
  }

  const context = getOrCreateContext(sessionId);
  
  // ✅ Heure calculée d'abord (pour Analyse Point 5)
  const beninTime = getBeninTime();
  
  updateUserPreferences(sessionId, userMessage);
  updateDeviceStates(sessionId, devices); // Initialise les nouveaux appareils
  
  // ✅ Fusion des états avec historique (Analyse Point 3)
  // -----------------------------------------------------------------
  // ✅ MODIFIÉ: On n'utilise plus 'deviceStates' (du client) mais 'realDeviceStates' (de Firebase)
  // -----------------------------------------------------------------
  Object.keys(realDeviceStates).forEach(deviceId => {
    // On vérifie que l'appareil est connu (métadonnées)
    if (context.deviceStates[deviceId]) {
      const currentState = context.deviceStates[deviceId];
      const firebaseState = realDeviceStates[deviceId]; // Ex: { etat: "ON", luminosite: 80 }
      
      const newState = firebaseState.etat || 'OFF';
      const newPower = firebaseState.luminosite || firebaseState.vitesse || 0;
      
      // Si changement détecté
      if (currentState.state !== newState || currentState.power !== newPower) {
        // Sauvegarder dans l'historique
        if (!currentState.history) currentState.history = [];
        currentState.history.push({
          state: currentState.state,
          power: currentState.power,
          timestamp: currentState.lastChanged || Date.now()
        });
        
        // Garder seulement les 50 derniers changements
        if (currentState.history.length > 50) {
          currentState.history.shift();
        }
      }
      
      // Mettre à jour l'état actuel dans le contexte du serveur
      currentState.state = newState;
      currentState.power = newPower;
      currentState.lastChanged = Date.now(); // Date de *notre* vérification
    }
  });
  
  // ✅ Analyse contextuelle améliorée (Analyse Point 4)
  const contextAnalysis = analyzeContext(userMessage, context, devices, beninTime);
  
  let webResults = [];
  if (needsWebSearch(userMessage, context)) {
    webResults = await performWebSearch(userMessage, context);
  }

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const keyObj = getNextApiKey();
      const genAI = new GoogleGenerativeAI(keyObj.key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Modèle NON MODIFIÉ (par demande)

      // ✅ NOUVEAU: Historique conversationnel structuré (Analyse Point 1)
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
          },
          
          // ✅ AJOUT : Historique réel comme messages structurés
          ...context.history.slice(-10).flatMap(h => [
            { role: "user", parts: [{ text: h.user }] },
            { role: "model", parts: [{ text: h.assistant }] }
          ])
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.8,
          maxOutputTokens: 8192,
        },
      });

      // ✅ NOUVEAU: Prompt simplifié (juste les métadonnées) (Analyse Point 1)
      const fullPrompt = `
[Heure: ${beninTime.formatted}]
[Préfs: ${JSON.stringify(context.userPreferences)}]
[États: ${JSON.stringify(context.deviceStates)}]
[Appareils: ${JSON.stringify(devices)}]
[Analyse: ${JSON.stringify(contextAnalysis)}]
${webResults.length > 0 ? `[Web: ${JSON.stringify(webResults.slice(0, 3))}]` : ''}

MESSAGE: "${userMessage}"
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
    // ✅ 'let' au lieu de 'const' pour sessionId (Analyse Point 6)
    // 'deviceStates' est reçu mais NE SERA PAS UTILISÉ pour la logique (voir chatWithGemini)
    let { message, key, devices = [], deviceStates = {}, sessionId = 'default' } = req.body;

    // ✅ NOUVEAU: Générer sessionId côté serveur si absent (Analyse Point 6)
    if (!sessionId || sessionId === 'default') {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`📝 Nouvelle session créée: ${sessionId}`);
    }

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
    console.log(`💬 MESSAGE: ${message}`); // Correction encodage
    console.log(`📊 APPAREILS: ${devices.length}`);
    console.log(`🔌 ÉTATS (Client): ${Object.keys(deviceStates).length} (Note: L'IA lira l'état de Firebase)`);

    const startTime = Date.now();
    // 'deviceStates' (du client) est passé, mais sera ignoré par la nouvelle logique au profit de Firebase
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
    
    // === 🔴 CORRECTION DU BUG DE DÉDUPLICATION (✅ AMÉLIORÉE - Analyse Point 8) 🔴 ===
    const uniquePlannings = [];
    const seen = new Set();
    
    for (const plan of aiJson.planning_commands) {
      // Validation de base
      if (!plan.action) continue;
      
      let key;
      
      switch(plan.action) {
        case 'add':
          if (!plan.device || !plan.time) continue;
          // Utiliser 100 comme valeur par défaut si power n'est pas fourni
          key = `add_${plan.device}_${plan.time}_${plan.power || 100}`;
          break;
          
        case 'delete_all':
          key = 'delete_all';
          break;
          
        case 'delete': // ✅ NOUVEAU : Support suppression unitaire
          if (!plan.device) continue;
          key = `delete_${plan.device}`;
          break;
          
        default:
          console.warn(`⚠️ Action inconnue: ${plan.action}`);
          continue;
      }
      
      if (!seen.has(key)) {
        seen.add(key);
        uniquePlannings.push(plan);
      }
    }
    aiJson.planning_commands = uniquePlannings;
    // === 🟢 FIN DE LA CORRECTION 🟢 ===
    
    // ✅ Nettoyage avancé (demande utilisateur)
    aiJson.reply = formatAIResponse(aiJson.reply);

    if (!aiJson.source) {
      aiJson.source = result.hadWebResults ? "web" : "cloud";
    }

    // Sauvegarder contexte
    addToContext(sessionId, message, aiJson.reply, result.webResults);

    console.log('✅ RÉPONSE GÉNÉRÉE'); // Correction encodage
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
    version: '5.0-ultra-firebase-v2', // Version mise à jour
    features: {
      gemini: API_KEYS.length > 0,
      webSearch: true,
      contextMemory: true,
      userPreferences: true,
      deviceStateAwareness: true,
      proactiveSuggestions: true,
      universalAssistant: true,
      codeGeneration: true,
      deviceStateHistory: true, // ✅ Ajout
      contextualAnalysisV2: true, // ✅ Ajout
      firebaseStateSync: true // ✅ Ajout
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
// NETTOYAGE CONTEXTES (✅ AMÉLIORÉ - Analyse Point 2.B)
// ========================================
setInterval(() => {
  const now = Date.now();
  const maxSessionAge = 7200000; // 2 heures (existant)
  const maxSearchAge = 600000; // 10 minutes (Analyse Point 2.B)
  
  for (const [sessionId, context] of conversationContexts.entries()) {
    // Nettoyage session (existant)
    if (now - context.createdAt > maxSessionAge) {
      conversationContexts.delete(sessionId);
      console.log(`🧹 Contexte ${sessionId} nettoyé (session expirée)`);
      continue; // Session supprimée, pas besoin de nettoyer le cache
    }

    // ✅ NOUVEAU: Nettoyage cache 'lastSearches' en tâche de fond (Analyse Point 2.B)
    for (const [key, data] of context.lastSearches.entries()) {
      if (now - data.timestamp > maxSearchAge) {
        context.lastSearches.delete(key);
      }
    }
  }
}, 120000); // Toutes les 2 minutes (Analyse Point 2.B)

// ========================================
// DÉMARRAGE
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v5.0 - ULTRA-INTELLIGENT   ║');
  console.log('   ║      (Version FIREBASE Sync)         ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🔍 Recherche web: Optimisée`);
  console.log(`   💾 Mémoire contextuelle: Avancée (50 messages)`);
  console.log(`   ⚙️ Préférences utilisateur: Activées`);
  console.log(`   🧠 Conscience état appareils: Activée (via Firebase)`);
  console.log(`   💡 Suggestions proactives: Avancées (temps, durée)`);
  console.log(`   🌐 Assistant universel: Activé`);
  console.log(`   💻 Génération code: Activée`);
  console.log(`   🔐 Sessions: Sécurisées (ID unique serveur)\n`);
});
