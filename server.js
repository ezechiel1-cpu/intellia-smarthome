// ========================================
// INTELLIA v7.0 - ASSISTANT MULTIMODAL (FINAL)
//
// ✅ Lit les PDF, DOCX, TXT, et Images
// ✅ Prêt pour les sessions multiples (Multi-chat)
// ✅ Inclut TOUTES les corrections (Analyse, Firebase, Bugs)
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ AJOUT FIREBASE
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get } = require("firebase/database");

// ✅ AJOUT DES PARSERS DE FICHIERS
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Augmenter la limite pour les fichiers
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

const DEVICES_STATES_REF = "devices";

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
      deviceStates: {},
      createdAt: Date.now(),
      lastAccessed: Date.now()
    });
  }
  return conversationContexts.get(sessionId);
}

function addToContext(sessionId, userMsg, aiResponse, webResults = null, attachments = []) {
  const context = getOrCreateContext(sessionId);
  
  context.history.push({
    user: userMsg,
    assistant: aiResponse,
    timestamp: Date.now(),
    attachments: attachments // ✅ Stocke les pièces jointes
  });
  
  context.lastAccessed = Date.now();
  
  if (webResults && webResults.length > 0) {
    const searchKey = userMsg.toLowerCase().trim();
    context.lastSearches.set(searchKey, {
      results: webResults,
      timestamp: Date.now()
    });
  }
  
  // ✅ Augmentation de la limite (Point 2.C)
  if (context.history.length > 100) {
    context.history.shift();
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
        history: [] 
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
// HEURE PRÉCISE DU BÉNIN (✅ CORRIGÉE)
// ========================================
function getBeninTime() {
  const timeZone = 'Africa/Porto-Novo';
  const now = new Date();

  const optionsDate = {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  
  const optionsTime = {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };

  const dateFormatter = new Intl.DateTimeFormat('fr-FR', optionsDate);
  const timeFormatter = new Intl.DateTimeFormat('fr-FR', optionsTime);

  const partsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = partsFormatter.formatToParts(now);
  let hoursPart = parts.find(p => p.type === 'hour')?.value;
  let minutesPart = parts.find(p => p.type === 'minute')?.value;

  if (hoursPart === '24') {
      hoursPart = '00';
  }
  
  const beninHours = parseInt(hoursPart, 10);
  const beninMinutes = parseInt(minutesPart, 10);
  
  const formattedDate = dateFormatter.format(now);
  const formattedTime = timeFormatter.format(now);
  const timeString = `${formattedDate} ${formattedTime}`;

  return {
    formatted: timeString,
    hours: beninHours,
    minutes: beninMinutes,
    hoursStr: String(beninHours).padStart(2, '0'),
    minutesStr: String(beninMinutes).padStart(2, '0')
  };
}

// ========================================
// HELPERS POUR LE MULTIMODAL (Fichiers/Images)
// ========================================

/**
 * Parse un Data URI (ex: data:image/jpeg;base64,...)
 */
function parseDataUri(dataUri) {
  try {
    const regex = /^data:(.+);base64,(.*)$/;
    const match = dataUri.match(regex);
    if (!match) return null;
    
    return {
      mimeType: match[1],
      data: match[2]
    };
  } catch (e) {
    console.error("Erreur parsing Data URI:", e.message);
    return null;
  }
}

/**
 * ✅ NOUVEAU: Parse le contenu des fichiers (TXT, PDF, DOCX)
 */
async function parseFileAttachment(attachment) {
  try {
    const parsedData = parseDataUri(attachment.data);
    if (!parsedData) throw new Error("Invalid Data URI");

    const buffer = Buffer.from(parsedData.data, 'base64');
    let text = "";
    const MAX_CHARS = 8000; // Limiter la taille du contenu

    console.log(`Parsing file: ${attachment.name}, MIME: ${parsedData.mimeType}`);

    switch (parsedData.mimeType) {
      case 'text/plain':
        text = buffer.toString('utf-8');
        break;
      
      case 'application/pdf':
        const data = await pdf(buffer);
        text = data.text;
        break;
      
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': // DOCX
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
        break;

      default:
        console.warn(`Type de fichier non supporté pour le parsing: ${parsedData.mimeType}`);
        return `[Contenu du fichier '${attachment.name}' non supporté (${parsedData.mimeType})]`;
    }
    
    // Tronquer le texte pour éviter de surcharger le prompt
    return text.substring(0, MAX_CHARS) + (text.length > MAX_CHARS ? "... [Contenu tronqué]" : "");

  } catch (error) {
    console.error(`Erreur parsing ${attachment.name}:`, error.message);
    return `[Erreur lors de la lecture du fichier '${attachment.name}']`;
  }
}


/**
 * Construit l'objet 'parts' pour l'historique de Gemini
 */
async function createHistoryEntry(role, text, attachments = []) {
  const parts = [{ text: text || '' }];
  
  for (const att of attachments) {
    if (att.type === 'image') {
      const parsed = parseDataUri(att.data);
      if (parsed) {
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      }
    } 
    // ✅ ACTIVÉ: Gérer les fichiers (TXT, PDF, DOCX)
    else if (att.type === 'file') {
      const fileContent = await parseFileAttachment(att);
      parts.push({ text: `\n[DEBUT CONTENU FICHIER: ${att.name}]\n${fileContent}\n[FIN CONTENU FICHIER]\n` });
    }
  }
  
  return { role, parts };
}


// ========================================
// FORMATAGE DE LA RÉPONSE (Demande utilisateur)
// ========================================
function formatAIResponse(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

// ========================================
// RECHERCHE WEB INTELLIGENTE
// ========================================
async function performWebSearch(query, context) {
  const searchKey = query.toLowerCase().trim();
  
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
  
  const noSearchPatterns = [
    /^(c'est quoi|quel est) (ton|votre|le) nom/i,
    /^qui es-tu/i,
    /^bonjour/i,
    /^salut/i,
    /^merci/i,
    /^ok$/i,
    /^d'accord$/i,
    /^allume/i,
    /^éteins/i,
    /^règle/i,
    /^je (sort|sors|pars)/i,
    /^je (suis|reviens|rentre)/i,
    /^il fait (nuit|jour|sombre|chaud)/i,
    /appareil.*état/i,
    /état.*appareil/i,
    /code (arduino|python|javascript)/i,
    /génère.*code/i,
    /écris.*code/i
  ];
  
  if (noSearchPatterns.some(pattern => pattern.test(lowerMsg))) {
    return false;
  }
  
  const webKeywords = [
    'météo', 'temps qu\'il fait', 'température', 'pluie', 'soleil',
    'actualité', 'news', 'nouvelles',
    'recherche', 'cherche', 'trouve',
    'où se trouve', 'où est situé',
    'combien coûte', 'prix de',
    'qui est', 'c\'est qui'
  ];
  
  if (lowerMsg.includes('qui est')) {
    const words = message.split(' ');
    const hasProperNoun = words.some(w => w.length > 2 && w[0] === w[0].toUpperCase());
    return hasProperNoun;
  }
  
  return webKeywords.some(kw => lowerMsg.includes(kw));
}

// ========================================
// ANALYSE CONTEXTUELLE INTELLIGENTE (✅ Analyse Point 4 & 5)
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

  // --- Suggestions ---
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

  // --- ✅ Détection patterns temporels (Analyse Point 4.A) ---
  if (/(comme (hier|ce matin|la dernière fois|avant|d'habitude|d'hab))/i.test(lowerMsg)) {
    analysis.needsHistoricalData = true;
    const match = lowerMsg.match(/comme ([^,\.]+)/);
    if (match) {
        analysis.temporalReference = match[1];
    }
  }
  
  // --- ✅ Détection intentions multiples (Analyse Point 4.B) ---
  const actions = lowerMsg.match(/allume|éteins|règle|ouvre|ferme/g);
  if (actions && actions.length > 1) {
    analysis.multipleActions = true;
    analysis.actionCount = actions.length;
  }
  
  // --- ✅ Détection contradictions récentes (Analyse Point 4.C) ---
  const recentMessages = context.history.slice(-3);
  if (recentMessages.some(h => 
    h.user.includes('éteins') && lowerMsg.includes('noir'))) {
    analysis.possibleContradiction = true;
    analysis.contradictionHint = "Vous venez d'éteindre les lumières";
  }

  // --- ✅ Suggestions basées sur l'heure (Analyse Point 5.A) ---
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

  // --- ✅ Suggestions basées sur la durée d'allumage (Analyse Point 5.B) ---
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
  
  return analysis;
}

// ========================================
// PROMPT SYSTÈME v7.0 (✅ CORRIGÉ - Contexte + Heure)
// ========================================
const systemPrompt = `
Tu es Intellia v5.0, assistant universel ultra-intelligent.

## CAPACITÉS
Domotique, Code (Arduino/Python/JS), Recherche web, Conversation naturelle, Analyse de Fichiers (PDF, TXT, DOCX) et Images.

## FORMAT JSON
{
  "reply": "Réponse naturelle",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [{"action":"add", "device":"id", "time":"HH:MM", "power":100}],
  "suggestions": [{"type":"info|action|warning", "message":"...", "context":"..."}],
  "source": "cloud|web|knowledge"
}

## 📌 RÈGLES CRITIQUES (TRÈS IMPORTANT)

1. **Vérification:** Vérifie [États] (deviceStates) AVANT toute action. Si un appareil est déjà dans l'état demandé, informe l'utilisateur au lieu de l'exécuter.

2. **Recherche:** Ne recherche PAS pour code/domotique.

3. **Suggestions:** Base tes suggestions sur le CONTEXTE RÉEL ([États], [Heure]).

4. **Gestion de l'heure (✅ NOUVELLE RÈGLE):** Mentionne l'heure SEULEMENT si l'utilisateur la demande (ex: "quelle heure est-il ?") ou si c'est pertinent (ex: une planification, ou un "Bonjour" le matin). ÉVITE de répéter l'heure à chaque message.

5. **Naturalité:** Réponses NATURELLES et CONVERSATIONNELLES.

6. **CONTEXTE CONVERSATIONNEL (✅ NOUVELLE RÈGLE):** Si le message de l'utilisateur est court (ex: "les", "oui", "non", "tout les appareils", "ceux du salon"), il répond TRÈS PROBABLEMENT à ta question précédente. Analyse l'historique récent (fourni dans 'history') pour comprendre l'intention complète.
   - EXEMPLE: (User: "Allume les") -> (AI: "Lesquels?") -> (User: "ceux du salon") => Intention = "Allumer ceux du salon".

7. **Fichiers & Images:** Si l'utilisateur envoie un fichier (PDF, TXT, DOCX) ou une image, le contenu sera fourni dans le prompt. Base ta réponse sur ce contenu.

## EXEMPLES

[Exemple 1: Contexte conversationnel (Nouvel exemple)]
USER: "Allume les"
AI: {"reply": "Quels appareils souhaitez-vous allumer ?"}
USER: "tout les appareils"
CONTEXTE: [États: {"salon_lampe":{"state":"OFF"}, "chambre_prise":{"state":"OFF"}}]
{
  "reply": "Entendu, j'allume tous les appareils.",
  "execute": ["salon_lampe|ON|100", "chambre_prise|ON|100"],
  "planning_commands": [],
  "suggestions": [],
  "source": "cloud"
}

[Exemple 2: Appareil déjà allumé]
USER: "Allume la lampe du salon"
CONTEXTE: [États: {"salon_lampe":{"state":"ON","power":80}}]
{
  "reply": "La lampe du salon est déjà allumée à 80%. Voulez-vous que je change la luminosité ?",
  "execute": [],
  "planning_commands": [],
  "suggestions": [{"type":"info", "message":"Régler à 100% ?", "context":"Appareil déjà actif"}],
  "source": "cloud"
}

RÉPONDS EN JSON VALIDE.
`;


// ========================================
// FONCTION CHAT AVEC GEMINI (✅ Prêt pour Multimodal/Firebase)
// ========================================
async function chatWithGemini(userMessage, devices, deviceStates, sessionId, attachments = [], maxRetries = API_KEYS.length) {
    // -----------------------------------------------------------------
    // ✅ CORRECTION (DEMANDE UTILISATEUR)
    // Lecture de l'état réel depuis Firebase
    // -----------------------------------------------------------------
    let realDeviceStates = {};
    try {
        const db = getDatabase();
        const snapshot = await get(ref(db, DEVICES_STATES_REF));
        realDeviceStates = snapshot.val() || {};
        console.log(`🔥 États réels récupérés de Firebase pour ${Object.keys(realDeviceStates).length} appareils.`);
    } catch (e) {
        console.error("❌ ERREUR FIREBASE: Impossible de lire les états. Utilisation des états (potentiellement obsolètes) du client.", e.message);
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
  const beninTime = getBeninTime();
  
  updateUserPreferences(sessionId, userMessage);
  updateDeviceStates(sessionId, devices);
  
  // ✅ Fusion des états avec historique (Analyse Point 3)
  Object.keys(realDeviceStates).forEach(deviceId => {
    if (context.deviceStates[deviceId]) {
      const currentState = context.deviceStates[deviceId];
      const firebaseState = realDeviceStates[deviceId];
      
      const newState = firebaseState.etat || 'OFF';
      const newPower = firebaseState.luminosite || firebaseState.vitesse || 0;
      
      if (currentState.state !== newState || currentState.power !== newPower) {
        if (!currentState.history) currentState.history = [];
        currentState.history.push({
          state: currentState.state,
          power: currentState.power,
          timestamp: currentState.lastChanged || Date.now()
        });
        
        if (currentState.history.length > 50) {
          currentState.history.shift();
        }
      }
      
      currentState.state = newState;
      currentState.power = newPower;
      currentState.lastChanged = Date.now();
    }
  });
  
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
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // ✅ Construction de l'historique multimodal (Analyse Point 1 + Futur)
      const historyParts = await Promise.all(
        context.history.slice(-10).flatMap(async (h) => [
          await createHistoryEntry("user", h.user, h.attachments),
          await createHistoryEntry("model", h.assistant)
        ])
      );

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
          ...historyParts.flat()
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.8,
          maxOutputTokens: 8192,
        },
      });

      // ✅ Prompt simplifié (Analyse Point 1)
      const metadataPrompt = `
[Heure: ${beninTime.formatted}]
[Préfs: ${JSON.stringify(context.userPreferences)}]
[États: ${JSON.stringify(context.deviceStates)}]
[Appareils: ${JSON.stringify(devices)}]
[Analyse: ${JSON.stringify(contextAnalysis)}]
${webResults.length > 0 ? `[Web: ${JSON.stringify(webResults.slice(0, 3))}]` : ''}

MESSAGE: "${userMessage}"
`;

      // ✅ Construction du message multimodal (Texte + Fichiers)
      const promptParts = [
        { text: metadataPrompt }
      ];

      for (const att of attachments) {
        if (att.type === 'image') {
          const parsed = parseDataUri(att.data);
          if (parsed) {
            promptParts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
          }
        } 
        // ✅ ACTIVÉ: Gérer les fichiers (TXT, PDF, DOCX)
        else if (att.type === 'file') {
          const fileContent = await parseFileAttachment(att);
          promptParts.push({ text: `\n[DEBUT CONTENU FICHIER: ${att.name}]\n${fileContent}\n[FIN CONTENU FICHIER]\n` });
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const result = await chat.sendMessage(promptParts, { signal: controller.signal });
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
// ROUTE PRINCIPALE /api/chat (✅ Prêt pour Multimodal)
// ========================================
app.post('/api/chat', async (req, res) => {
  try {
    // ✅ Accepte 'attachments' et 'sessionId'
    let { message, key, devices = [], deviceStates = {}, sessionId = 'default', attachments = [] } = req.body;

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

    if (!message && attachments.length === 0) {
      return res.status(400).json({ 
        reply: "Message ou pièce jointe requis", 
        execute: [], 
        planning_commands: [],
        suggestions: [],
        source: "error"
      });
    }

    console.log('┌────────────────────────────────────────┐');
    console.log(`💬 MESSAGE: ${message || '(Pas de texte)'}`);
    console.log(`🖼️ ATTACHMENTS: ${attachments.length}`);
    console.log(`📊 APPAREILS: ${devices.length}`);
    console.log(`🔌 ÉTATS (Client): ${Object.keys(deviceStates).length} (Note: L'IA lira l'état de Firebase)`);
    console.log(`🏷️ SESSION: ${sessionId}`);

    const startTime = Date.now();
    const result = await chatWithGemini(message, devices, deviceStates, sessionId, attachments);

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
    
    // === ✅ Déduplication Robuste (Analyse Point 8) ===
    const uniquePlannings = [];
    const seen = new Set();
    
    for (const plan of aiJson.planning_commands) {
      if (!plan.action) continue;
      let key;
      switch(plan.action) {
        case 'add':
          if (!plan.device || !plan.time) continue;
          key = `add_${plan.device}_${plan.time}_${plan.power || 100}`;
          break;
        case 'delete_all':
          key = 'delete_all';
          break;
        case 'delete':
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

    // ✅ Sauvegarde du contexte (avec attachments)
    addToContext(sessionId, message, aiJson.reply, result.webResults, attachments);

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
    version: '7.0-multimodal-complete', // Version mise à jour
    features: {
      gemini: API_KEYS.length > 0,
      webSearch: true,
      contextMemory: true,
      userPreferences: true,
      deviceStateAwareness: true,
      proactiveSuggestions: true,
      universalAssistant: true,
      codeGeneration: true,
      deviceStateHistory: true,
      contextualAnalysisV2: true,
      firebaseStateSync: true,
      multimodal_Image: true,
      multimodal_Files: true // ✅ Activé !
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
// NETTOYAGE CONTEXTES (✅ Analyse Point 2.B)
// ========================================
setInterval(() => {
  const now = Date.now();
  const maxSessionAge = 7200000; // 2 heures
  const maxSearchAge = 600000; // 10 minutes
  
  for (const [sessionId, context] of conversationContexts.entries()) {
    if (now - context.lastAccessed > maxSessionAge) {
      conversationContexts.delete(sessionId);
      console.log(`🧹 Contexte ${sessionId} nettoyé (session expirée)`);
      continue;
    }

    for (const [key, data] of context.lastSearches.entries()) {
      if (now - data.timestamp > maxSearchAge) {
        context.lastSearches.delete(key);
      }
    }
  }
}, 120000); // Toutes les 2 minutes

// ========================================
// DÉMARRAGE
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v7.0 - MULTIMODAL COMPLET  ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🔥 Synchro Firebase: Activée`);
  console.log(`   💾 Mémoire contextuelle: Avancée (100 messages)`);
  console.log(`   🧠 Conscience état appareils: Activée (via Firebase)`);
  console.log(`   💡 Suggestions proactives: Avancées`);
  console.log(`   🖼️ Multimodal (Images): Prêt`);
  console.log(`   📁 Multimodal (PDF, DOCX, TXT): Prêt`);
  console.log(`   🔐 Sessions: Sécurisées (ID unique serveur)\n`);
});
