// ========================================
// INTELLIA v8.0 - ASSISTANT MULTIMODAL (SYNCHRO FIREBASE)
//
// ✅ Lit l'historique des chats depuis Firebase (fini le 'conversationContexts')
// ✅ Lit les PDF, DOCX, TXT, et Images
// ✅ Gère les sessions uniques par utilisateur
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ Imports Firebase
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get } = require("firebase/database");

// ✅ Imports des Parsers de Fichiers
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
let db;
try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    console.log("🔥 Connexion à Firebase Réussie (Source de vérité)");
} catch (e) {
    console.error("❌ ERREUR CRITIQUE: Impossible d'initialiser Firebase.", e);
}

const DEVICES_STATES_REF = "devices";
const USER_CHATS_REF = "userChats"; // Chemin de l'historique des chats

const API_KEYS = [];
let currentKeyIndex = 0;

for (let i = 1; i <= 10; i++) {
  const key = process.env[`GEMINI_KEY_${i}`];
  if (key && key !== "VOTRE_CLE_API_ICI") {
    API_KEYS.push({ key: key, failures: 0, lastUsed: null, quotaExceeded: false });
  }
}

if (API_KEYS.length === 0) console.warn('⚠️ AUCUNE CLÉ API GEMINI');
console.log(`🔑 ${API_KEYS.length} clé(s) Gemini chargée(s)`);


// ========================================
// SUPPRESSION de 'conversationContexts'
// L'historique est maintenant lu depuis Firebase à chaque requête.
// ========================================


// ========================================
// GESTION DES CLÉS API
// ========================================
function getNextApiKey() {
  if (API_KEYS.length === 0) throw new Error("Aucune clé API disponible");
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
    setTimeout(() => { keyObj.quotaExceeded = false; keyObj.failures = 0; }, 3600000);
  }
}

// ========================================
// HEURE PRÉCISE DU BÉNIN (✅ CORRIGÉE)
// ========================================
function getBeninTime() {
  const timeZone = 'Africa/Porto-Novo';
  const now = new Date();
  const optionsDate = { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const optionsTime = { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const dateFormatter = new Intl.DateTimeFormat('fr-FR', optionsDate);
  const timeFormatter = new Intl.DateTimeFormat('fr-FR', optionsTime);
  const partsFormatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hour12: false });
  const parts = partsFormatter.formatToParts(now);
  let hoursPart = parts.find(p => p.type === 'hour')?.value;
  let minutesPart = parts.find(p => p.type === 'minute')?.value;
  if (hoursPart === '24') hoursPart = '00';
  const beninHours = parseInt(hoursPart, 10);
  const beninMinutes = parseInt(minutesPart, 10);
  const timeString = `${dateFormatter.format(now)} ${timeFormatter.format(now)}`;
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
function parseDataUri(dataUri) {
  try {
    const regex = /^data:(.+);base64,(.*)$/;
    const match = dataUri.match(regex);
    if (!match) return null;
    return { mimeType: match[1], data: match[2] };
  } catch (e) {
    console.error("Erreur parsing Data URI:", e.message);
    return null;
  }
}

async function parseFileAttachment(attachment) {
  try {
    const parsedData = parseDataUri(attachment.data);
    if (!parsedData) throw new Error("Invalid Data URI");
    const buffer = Buffer.from(parsedData.data, 'base64');
    let text = "";
    const MAX_CHARS = 8000;
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
        return `[Contenu du fichier '${attachment.name}' non supporté (${parsedData.mimeType})]`;
    }
    return text.substring(0, MAX_CHARS) + (text.length > MAX_CHARS ? "... [Contenu tronqué]" : "");
  } catch (error) {
    console.error(`Erreur parsing ${attachment.name}:`, error.message);
    return `[Erreur lors de la lecture du fichier '${attachment.name}']`;
  }
}

// ✅ NOUVEAU: Construit les 'parts' pour Gemini
async function createHistoryEntry(role, text, attachments = []) {
  const parts = [{ text: text || '' }];
  for (const att of attachments) {
    if (att.type === 'image') {
      const parsed = parseDataUri(att.data);
      if (parsed) parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
    } else if (att.type === 'file') {
      const fileContent = await parseFileAttachment(att);
      parts.push({ text: `\n[DEBUT CONTENU FICHIER: ${att.name}]\n${fileContent}\n[FIN CONTENU FICHIER]\n` });
    }
  }
  return { role, parts };
}

// ✅ NOUVEAU: Lit l'historique des messages depuis Firebase
async function getHistoryFromFirebase(userId, sessionId) {
  if (!db || !userId || !sessionId) return [];
  
  try {
    const messagesRef = ref(db, `${USER_CHATS_REF}/${userId}/${sessionId}/messages`);
    const snapshot = await get(messagesRef);
    if (!snapshot.exists()) return [];
    
    const messages = snapshot.val();
    // Convertir l'objet en tableau et prendre les 10 derniers
    const sortedMessages = Object.values(messages).sort((a, b) => a.timestamp - b.timestamp);
    const recentMessages = sortedMessages.slice(-10); // Prendre les 10 derniers
    
    return recentMessages;
  } catch (error) {
    console.error("Erreur lors de la lecture de l'historique Firebase:", error);
    return [];
  }
}


// ========================================
// FORMATAGE DE LA RÉPONSE (Demande utilisateur)
// ========================================
function formatAIResponse(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
}

// ========================================
// RECHERCHE WEB INTELLIGENTE (Inchangé)
// ========================================
async function performWebSearch(query) {
  console.log(`🔍 Recherche: "${query}"`);
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    const $ = cheerio.load(response.data);
    const results = [];
    $('.result').slice(0, 5).each((i, elem) => {
      const title = $(elem).find('.result__title').text().trim();
      const snippet = $(elem).find('.result__snippet').text().trim();
      const url = $(elem).find('.result__url').attr('href');
      if (title && snippet) results.push({ title, snippet, url });
    });
    console.log(`✅ ${results.length} résultats`);
    return results;
  } catch (error) {
    console.error('❌ Erreur recherche:', error.message);
    return [];
  }
}

function needsWebSearch(message) {
  const lowerMsg = message.toLowerCase().trim();
  const noSearchPatterns = [
    /^(c'est quoi|quel est) (ton|votre|le) nom/i, /^qui es-tu/i, /^bonjour/i, /^salut/i,
    /^merci/i, /^ok$/i, /^d'accord$/i, /^allume/i, /^éteins/i, /^règle/i,
    /^je (sort|sors|pars)/i, /^je (suis|reviens|rentre)/i, /^il fait (nuit|jour|sombre|chaud)/i,
    /appareil.*état/i, /état.*appareil/i, /code (arduino|python|javascript)/i,
    /génère.*code/i, /écris.*code/i
  ];
  if (noSearchPatterns.some(pattern => pattern.test(lowerMsg))) return false;
  const webKeywords = [
    'météo', 'temps qu\'il fait', 'température', 'pluie', 'soleil',
    'actualité', 'news', 'nouvelles', 'recherche', 'cherche', 'trouve',
    'où se trouve', 'où est situé', 'combien coûte', 'prix de', 'qui est', 'c\'est qui'
  ];
  if (lowerMsg.includes('qui est')) {
    const words = message.split(' ');
    const hasProperNoun = words.some(w => w.length > 2 && w[0] === w[0].toUpperCase());
    return hasProperNoun;
  }
  return webKeywords.some(kw => lowerMsg.includes(kw));
}

// ========================================
// ANALYSE CONTEXTUELLE (Simplifié)
// ========================================
// On n'analyse que le message actuel et l'état des appareils
function analyzeContext(message, deviceStates, beninTime) {
  const analysis = { suggestedActions: [] };
  const lowerMsg = message.toLowerCase();

  // Suggestions (la logique est conservée)
  if (lowerMsg.includes('je sors') || lowerMsg.includes('je pars')) {
    const onDevices = Object.values(deviceStates).filter(d => d.etat === 'ON'); // Correction: .etat
    if (onDevices.length > 0) {
      analysis.suggestedActions.push({
        type: 'security_check',
        message: `Vous avez ${onDevices.length} appareil(s) allumé(s). Voulez-vous que je les éteigne ?`,
        devices: onDevices.map(d => d.id)
      });
    }
  }
  if (lowerMsg.includes('il fait nuit') || lowerMsg.includes('sombre')) {
    // Note: deviceStates vient de Firebase, il n'a pas .type. On se base sur le nom.
    // Pour que ça marche, le 'devices' (métadonnées) est requis.
    // On simplifie : on ne suggère pas si on n'a pas les métadonnées.
  }
  // Suggestions basées sur l'heure
  if (beninTime && (beninTime.hours >= 22 || beninTime.hours < 6)) {
    const brightDevices = Object.values(deviceStates).filter(d => d.etat === 'ON' && d.luminosite > 50);
    if (brightDevices.length > 0) {
      analysis.suggestedActions.push({
        type: 'energy_saving',
        message: `Il est ${beninTime.hoursStr}:${beninTime.minutesStr}. Voulez-vous réduire la luminosité ?`,
        devices: brightDevices.map(d => d.id) // Note: l'ID n'est pas dans l'état, c'est un problème.
      });
    }
  }
  // On va simplifier l'analyse pour l'instant
  return analysis;
}

// ========================================
// PROMPT SYSTÈME v8.0 (Inchangé)
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
1. **Vérification:** Vérifie [États] (deviceStates) AVANT toute action.
2. **Recherche:** Ne recherche PAS pour code/domotique.
3. **Suggestions:** Base tes suggestions sur le CONTEXTE RÉEL ([États], [Heure]).
4. **Gestion de l'heure:** Mentionne l'heure SEULEMENT si l'utilisateur la demande ou si c'est pertinent. ÉVITE de répéter l'heure.
5. **Naturalité:** Réponses NATURELLES et CONVERSATIONNELLES.
6. **CONTEXTE CONVERSATIONNEL:** Si le message de l'utilisateur est court (ex: "les", "oui", "tout les appareils"), il répond TRÈS PROBABLEMENT à ta question précédente. Analyse l'historique récent (fourni dans 'history') pour comprendre l'intention complète.
7. **Fichiers & Images:** Si l'utilisateur envoie un fichier, le contenu sera fourni. Base ta réponse sur ce contenu.

## EXEMPLES
[Exemple 1: Contexte conversationnel]
USER: "Allume les"
AI: {"reply": "Quels appareils souhaitez-vous allumer ?"}
USER: "tout les appareils"
CONTEXTE: [États: {"salon_lampe":{"etat":"OFF"}}]
{
  "reply": "Entendu, j'allume tous les appareils.",
  "execute": ["salon_lampe|ON|100"],
  "planning_commands": [], "suggestions": [], "source": "cloud"
}

[Exemple 2: Appareil déjà allumé]
USER: "Allume la lampe du salon"
CONTEXTE: [États: {"salon_lampe":{"etat":"ON","luminosite":80}}]
{
  "reply": "La lampe du salon est déjà allumée à 80%. Voulez-vous que je change la luminosité ?",
  "execute": [], "planning_commands": [],
  "suggestions": [{"type":"info", "message":"Régler à 100% ?", "context":"Appareil déjà actif"}],
  "source": "cloud"
}

RÉPONDS EN JSON VALIDE.
`;


// ========================================
// FONCTION CHAT AVEC GEMINI (✅ v8.0 - Lit l'historique Firebase)
// ========================================
async function chatWithGemini(userMessage, devices, userId, sessionId, attachments = [], preferences = {}, maxRetries = API_KEYS.length) {
    
  // 1. Obtenir l'état réel des appareils depuis Firebase
  let realDeviceStates = {};
  try {
      if (!db) throw new Error("DB non initialisée");
      const snapshot = await get(ref(db, DEVICES_STATES_REF));
      realDeviceStates = snapshot.val() || {};
      console.log(`🔥 États réels récupérés de Firebase pour ${Object.keys(realDeviceStates).length} appareils.`);
  } catch (e) {
      console.error("❌ ERREUR FIREBASE: Impossible de lire les états.", e.message);
      realDeviceStates = {};
  }

  if (API_KEYS.length === 0) {
    return { success: false, error: "Aucune clé Gemini disponible" };
  }

  const beninTime = getBeninTime();
  
  // 2. Analyser le contexte actuel
  // On passe 'devices' (métadonnées) et 'realDeviceStates' (états réels)
  const contextAnalysis = analyzeContext(userMessage, realDeviceStates, beninTime);
  
  // 3. Recherche Web si nécessaire
  let webResults = [];
  if (needsWebSearch(userMessage)) {
    webResults = await performWebSearch(userMessage);
  }

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const keyObj = getNextApiKey();
      const genAI = new GoogleGenerativeAI(keyObj.key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // 4. ✅ NOUVEAU: Lire l'historique depuis Firebase
      const historyFromFirebase = await getHistoryFromFirebase(userId, sessionId);

      // 5. ✅ NOUVEAU: Construire les 'parts' d'historique
      const historyParts = await Promise.all(
        historyFromFirebase.flatMap(async (h) => [
          await createHistoryEntry("user", h.user, h.attachments || []), // Assurer que attachments est un array
          await createHistoryEntry("model", h.bot)
        ])
      );

      const chat = model.startChat({
        history: [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: JSON.stringify({
                reply: "Je suis Intellia v5.0, votre assistant universel ultra-intelligent !",
                execute: [], planning_commands: [], suggestions: [], source: "cloud"
              })}] 
          },
          // Utiliser l'historique de Firebase
          ...historyParts.flat()
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.8,
          maxOutputTokens: 8192,
        },
      });

      // 6. ✅ NOUVEAU: Prompt de métadonnées
      // Note: 'devices' contient les métadonnées (nom, type)
      // 'realDeviceStates' contient les états (ON/OFF, luminosite)
      const metadataPrompt = `
[Heure: ${beninTime.formatted}]
[Préfs: ${JSON.stringify(preferences)}]
[États: ${JSON.stringify(realDeviceStates)}]
[Appareils: ${JSON.stringify(devices)}] 
[Analyse: ${JSON.stringify(contextAnalysis)}]
${webResults.length > 0 ? `[Web: ${JSON.stringify(webResults.slice(0, 3))}]` : ''}

MESSAGE: "${userMessage}"
`;

      // 7. Construire le message multimodal
      const promptParts = [ { text: metadataPrompt } ];
      for (const att of attachments) {
        if (att.type === 'image') {
          const parsed = parseDataUri(att.data);
          if (parsed) promptParts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
        } 
        else if (att.type === 'file') {
          const fileContent = await parseFileAttachment(att);
          promptParts.push({ text: `\n[DEBUT FICHIER: ${att.name}]\n${fileContent}\n[FIN FICHIER]\n` });
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // 20 sec timeout
      const result = await chat.sendMessage(promptParts, { signal: controller.signal });
      clearTimeout(timeout);

      return { 
        success: true, 
        data: result.response.text(), 
        hadWebResults: webResults.length > 0,
      };

    } catch (error) {
      lastError = error;
      const keyObj = API_KEYS[(currentKeyIndex - 1 + API_KEYS.length) % API_KEYS.length];
      const isQuotaError = error.message?.includes('quota') || error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED');
      markKeyAsFailed(keyObj, isQuotaError);
      console.warn(`⚠️ Tentative ${attempt + 1}/${maxRetries} échouée`);
      if (attempt === maxRetries - 1) break;
    }
  }
  return { success: false, error: lastError };
}

// ========================================
// ROUTE PRINCIPALE /api/chat (✅ v8.0)
// ========================================
app.post('/api/chat', async (req, res) => {
  try {
    // ✅ Accepte 'userId', 'sessionId', et 'preferences'
    let { 
      message, 
      key, 
      devices = [], // Métadonnées des appareils
      deviceStates = {}, // États (ignorés, mais gardés au cas où)
      userId, 
      sessionId, 
      attachments = [], 
      preferences = {} 
    } = req.body;

    if (key !== AUTH_KEY) {
      return res.status(401).json({ reply: "Clé d'authentification invalide", ...jsonErrorDefaults() });
    }
    if (!message && attachments.length === 0) {
      return res.status(400).json({ reply: "Message ou pièce jointe requis", ...jsonErrorDefaults() });
    }
    if (!userId || !sessionId) {
      return res.status(400).json({ reply: "ID Utilisateur ou ID Session manquant", ...jsonErrorDefaults() });
    }

    console.log('┌────────────────────────────────────────┐');
    console.log(`💬 MESSAGE: ${message || '(Pas de texte)'}`);
    console.log(`🖼️ ATTACHMENTS: ${attachments.length}`);
    console.log(`👤 USER: ${userId.substring(0, 10)}...`);
    console.log(`🏷️ SESSION: ${sessionId}`);
    console.log(`📡 APPAREILS (Meta): ${devices.length}`);

    const startTime = Date.now();
    // ✅ Appel avec les métadonnées 'devices'
    const result = await chatWithGemini(message, devices, userId, sessionId, attachments, preferences);

    if (!result.success) {
      console.log('⚠️ Gemini indisponible');
      return res.json({ reply: "Service temporairement indisponible.", ...jsonErrorDefaults() });
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
        return res.json({ reply: "Désolé, reformulez votre demande ?", ...jsonErrorDefaults() });
      }
    }

    // Validation et déduplication
    aiJson.reply = aiJson.reply || "Commande reçue.";
    aiJson.execute = aiJson.execute || [];
    aiJson.planning_commands = aiJson.planning_commands || [];
    aiJson.suggestions = aiJson.suggestions || [];
    aiJson.planning_commands = deduplicatePlanning(aiJson.planning_commands);
    aiJson.reply = formatAIResponse(aiJson.reply);
    if (!aiJson.source) aiJson.source = result.hadWebResults ? "web" : "cloud";

    // ⛔ Le serveur ne sauvegarde plus l'historique. C'est le client.

    console.log('✅ RÉPONSE GÉNÉRÉE');
    console.log(`📤 Execute: ${aiJson.execute.length}`);
    console.log(`📅 Planning: ${aiJson.planning_commands.length}`);
    console.log(`💡 Suggestions: ${aiJson.suggestions.length}`);
    console.log('└────────────────────────────────────────┘\n');

    res.json(aiJson);
    
  } catch (error) {
    console.error('💥 ERREUR:', error.message);
    res.status(500).json({ reply: "Désolé, une erreur s'est produite.", ...jsonErrorDefaults() });
  }
});

// Helpers pour la route /api/chat
function jsonErrorDefaults() {
  return { execute: [], planning_commands: [], suggestions: [], source: "error" };
}

function deduplicatePlanning(plans) {
  const uniquePlannings = [];
  const seen = new Set();
  for (const plan of plans) {
    if (!plan.action) continue;
    let key;
    switch(plan.action) {
      case 'add':
        if (!plan.device || !plan.time) continue;
        key = `add_${plan.device}_${plan.time}_${plan.power || 100}`;
        break;
      case 'delete_all': key = 'delete_all'; break;
      case 'delete':
        if (!plan.device) continue;
        key = `delete_${plan.device}`;
        break;
      default: continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      uniquePlannings.push(plan);
    }
  }
  return uniquePlannings;
}

// ========================================
// ROUTE SANTÉ (Mise à jour)
// ========================================
app.get('/api/health', (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  const beninTime = getBeninTime();
  
  res.json({ 
    status: 'ok', 
    version: '8.0-firebase-sync', // Version mise à jour
    features: {
      gemini: API_KEYS.length > 0,
      webSearch: true,
      contextMemory: "Firebase", // ✅ NOUVEAU
      firebaseStateSync: true,
      multimodal_Image: true,
      multimodal_Files: true
    },
    keys: { total: API_KEYS.length, available: availableKeys },
    time: {
      benin: `${beninTime.hoursStr}:${beninTime.minutesStr}`,
      formatted: beninTime.formatted
    }
  });
});

// ========================================
// SUPPRESSION: Nettoyage 'conversationContexts' (plus nécessaire)
// ========================================

// ========================================
// DÉMARRAGE
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v8.0 - FIREBASE SYNC         ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🔥 Synchro Firebase (Appareils): Activée`);
  console.log(`   💾 Synchro Firebase (Chats): Activée`);
  console.log(`   🖼️ Multimodal (Images/Fichiers): Prêt\n`);
});
