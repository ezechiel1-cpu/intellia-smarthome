// ========================================
// INTELLIA v14.1 - Prompt optimisé + cascade modèles
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const htmlPdf = require('html-pdf-node');
// exec/fs/os supprimés : LibreOffice remplacé par html-to-docx (aucune dépendance système)

// ✅ Imports Firebase
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, set, push, remove } = require("firebase/database");

// ✅ Imports des Parsers de Fichiers
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// CONFIGURATION
// ========================================
const AUTH_KEY = process.env.AUTH_KEY || "cle-secrete-intellia";

// ✅ CONFIG FIREBASE
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
    console.log("🔥 Connexion à Firebase Réussie");
} catch (e) {
    console.error("❌ ERREUR CRITIQUE: Impossible d'initialiser Firebase.", e);
}

const DEVICES_STATES_REF = "devices";
const DEVICES_META_REF = "devicesMeta";
const USER_CHATS_REF = "userChats";
const PLANNING_REF = "planning";
const HISTORY_LOGS_REF = "history_logs"; // ✅ NOUVEAU : logs horodatés de tous les changements d'état

// ========================================
// GESTION DES CLÉS API GEMINI
// ========================================
const API_KEYS = [];
let currentKeyIndex = 0;

for (let i = 1; i <= 12; i++) {
  const key = process.env[`GEMINI_KEY_${i}`];
  if (key && key !== "VOTRE_CLE_API_ICI") {
    API_KEYS.push({ key: key, failures: 0, lastUsed: null, quotaExceeded: false });
  }
}

if (API_KEYS.length === 0) console.warn('⚠️ AUCUNE CLÉ API GEMINI');
console.log(`🔑 ${API_KEYS.length} clé(s) Gemini chargée(s)`);

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
// TEMPÉRATURE RÉELLE DE LOKOSSA
// ========================================
function getLoKossaTemperatureEstimated(month, hour) {
  const temperatureData = {
    1: { min: 23, max: 35, avg: 29 },
    2: { min: 25, max: 36, avg: 30.5 },
    3: { min: 25, max: 35, avg: 30 },
    4: { min: 24, max: 34, avg: 29 },
    5: { min: 24, max: 32, avg: 28 },
    6: { min: 23, max: 30, avg: 26.5 },
    7: { min: 23, max: 29, avg: 26 },
    8: { min: 23, max: 29, avg: 26 },
    9: { min: 23, max: 30, avg: 26.5 },
    10: { min: 24, max: 32, avg: 28 },
    11: { min: 24, max: 33, avg: 28.5 },
    12: { min: 23, max: 34, avg: 28.5 }
  };

  const monthData = temperatureData[month] || temperatureData[1];
  let tempAdjustment = 0;
  
  if (hour >= 6 && hour < 12) {
    tempAdjustment = ((hour - 6) / 6) * (monthData.max - monthData.avg);
  } else if (hour >= 12 && hour < 18) {
    tempAdjustment = monthData.max - monthData.avg - ((hour - 12) / 6) * (monthData.max - monthData.avg);
  } else {
    tempAdjustment = monthData.min - monthData.avg;
  }
  
  const estimatedTemp = Math.round(monthData.avg + tempAdjustment);
  
  return {
    temperature: estimatedTemp,
    feels_like: estimatedTemp,
    humidity: hour >= 6 && hour < 18 ? 65 : 80,
    description: estimatedTemp >= 32 ? "Très chaud et humide" : 
                 estimatedTemp >= 28 ? "Chaud" : 
                 estimatedTemp >= 25 ? "Agréable" : "Frais",
    source: 'estimation'
  };
}

function getWeatherDescription(code) {
  const descriptions = {
    0: "Ciel dégagé ☀️", 1: "Principalement dégagé 🌤️", 2: "Partiellement nuageux ⛅", 3: "Couvert ☁️",
    45: "Brouillard 🌫️", 48: "Brouillard givrant 🌫️",
    51: "Bruine légère 🌦️", 53: "Bruine modérée 🌦️", 55: "Bruine dense 🌧️",
    61: "Pluie faible 🌧️", 63: "Pluie modérée 🌧️", 65: "Pluie forte ⛈️",
    71: "Neige faible ❄️", 73: "Neige modérée ❄️", 75: "Neige forte ❄️",
    80: "Averses légères 🌦️", 81: "Averses modérées 🌧️", 82: "Averses violentes ⛈️",
    85: "Averses de neige légères 🌨️", 86: "Averses de neige fortes 🌨️",
    95: "Orage ⛈️", 96: "Orage avec grêle légère ⛈️", 99: "Orage avec grêle forte ⛈️"
  };
  return descriptions[code] || "Conditions variables";
}

async function getRealLoKossaTemperature() {
  try {
    console.log("🌡️ Appel WeatherAPI pour Lokossa...");
    const apiKey = '41c88a0121c8451284c194700261906';
    const response = await axios.get('https://api.weatherapi.com/v1/current.json', {
      params: { key: apiKey, q: 'Lokossa', lang: 'fr' },
      timeout: 5000
    });
    const current = response.data.current;
    const temp = Math.round(current.temp_c);
    const feels = Math.round(current.feelslike_c);
    // WeatherAPI condition codes → emoji français
    const code = current.condition.code;
    const isDay = current.is_day === 1;
    let emoji = '🌡️';
    if ([1000].includes(code)) emoji = isDay ? '☀️' : '🌙';
    else if ([1003].includes(code)) emoji = isDay ? '🌤️' : '🌤️';
    else if ([1006].includes(code)) emoji = '⛅';
    else if ([1009].includes(code)) emoji = '☁️';
    else if ([1030, 1135, 1147].includes(code)) emoji = '🌫️';
    else if ([1063, 1072, 1150, 1153, 1168, 1171, 1180, 1186, 1192, 1198, 1204, 1240, 1246].includes(code)) emoji = '🌧️';
    else if ([1066, 1069, 1114, 1117, 1210, 1216, 1222, 1255, 1261].includes(code)) emoji = '❄️';
    else if ([1087, 1273, 1279, 1282].includes(code)) emoji = '⛈️';
    else if ([1183, 1189, 1195, 1201, 1207, 1213, 1219, 1225, 1237, 1243, 1249, 1252, 1258, 1264].includes(code)) emoji = '🌦️';
    // Description en français depuis l'API (lang=fr) + emoji
    const description = `${current.condition.text} ${emoji}`;
    console.log(`✅ Température réelle récupérée : ${temp}°C (${description})`);
    return {
      temperature: temp,
      feels_like: feels,
      humidity: current.humidity,
      description: description,
      source: 'weatherapi',
      success: true
    };
  } catch (error) {
    console.warn("⚠️ WeatherAPI indisponible, utilisation de l'estimation :", error.message);
    const now = new Date();
    const month = now.getMonth() + 1;
    const hour = now.getHours();
    const estimated = getLoKossaTemperatureEstimated(month, hour);
    // Ajouter emoji selon la description estimée
    let emoji = '🌡️';
    if (estimated.description.includes('chaud') || estimated.description.includes('Très chaud')) emoji = '🔆';
    else if (estimated.description.includes('Chaud')) emoji = '☀️';
    else if (estimated.description.includes('Agréable')) emoji = '🌤️';
    else if (estimated.description.includes('Frais')) emoji = '🌬️';
    estimated.description = `${estimated.description} ${emoji}`;
    console.log(`📊 Température estimée : ${estimated.temperature}°C`);
    return { ...estimated, success: false };
  }
}

async function getBeninTime() {
  const timeZone = 'Africa/Porto-Novo';
  const now = new Date();
  const optionsDate = { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const optionsTime = { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const dateFormatter = new Intl.DateTimeFormat('fr-FR', optionsDate);
  const timeFormatter = new Intl.DateTimeFormat('fr-FR', optionsTime);
  const partsFormatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hour12: false, month: 'numeric' });
  const parts = partsFormatter.formatToParts(now);
  let hoursPart = parts.find(p => p.type === 'hour')?.value;
  let minutesPart = parts.find(p => p.type === 'minute')?.value;
  let monthPart = parts.find(p => p.type === 'month')?.value;
  
  if (hoursPart === '24') hoursPart = '00';
  const beninHours = parseInt(hoursPart, 10);
  const beninMinutes = parseInt(minutesPart, 10);
  const beninMonth = parseInt(monthPart, 10);
  
  const timeString = `${dateFormatter.format(now)} ${timeFormatter.format(now)}`;
  
  const tempInfo = await getRealLoKossaTemperature();
  
  return {
    formatted: timeString,
    hours: beninHours,
    minutes: beninMinutes,
    month: beninMonth,
    hoursStr: String(beninHours).padStart(2, '0'),
    minutesStr: String(beninMinutes).padStart(2, '0'),
    temperature: tempInfo
  };
}

// ========================================
// HELPERS MULTIMODAL
// ========================================
function parseDataUri(dataUri) {
  try {
    // Nettoyer les éventuels sauts de ligne dans la partie base64
    // (FileReader ne devrait pas en injecter, mais sécurité défensive)
    const cleaned = dataUri.replace(/\r?\n/g, '');
    const regex = /^data:([^;]+);base64,(.+)$/;
    const match = cleaned.match(regex);
    if (!match) return null;
    return { mimeType: match[1].trim(), data: match[2] };
  } catch (e) {
    console.error("Erreur parsing Data URI:", e.message);
    return null;
  }
}

async function parseFileAttachment(attachment) {
  try {
    const parsedData = parseDataUri(attachment.data);
    if (!parsedData) {
      const preview = (attachment.data || '').substring(0, 80);
      console.error(`❌ parseDataUri échoué pour "${attachment.name}"`);
      console.error(`   Début du data reçu : ${preview}`);
      console.error(`   Type : ${typeof attachment.data}, longueur : ${(attachment.data || '').length}`);
      throw new Error(`Data URI invalide pour ${attachment.name}`);
    }
    const buffer = Buffer.from(parsedData.data, 'base64');
    let text = "";
    const MAX_CHARS = 500000;
    console.log(`📄 Parsing: ${attachment.name}, MIME: ${parsedData.mimeType}, Size: ${buffer.length} bytes`);
    const fileName = attachment.name.toLowerCase();
    const ext = fileName.split('.').pop();
    
    switch (true) {
      case parsedData.mimeType.startsWith('text/'):
      case ext === 'txt': case ext === 'log': case ext === 'md': case ext === 'csv':
        text = buffer.toString('utf-8');
        break;
      case ext === 'html': case ext === 'htm': case ext === 'xml':
      case parsedData.mimeType.includes('html'): case parsedData.mimeType.includes('xml'):
        text = buffer.toString('utf-8');
        break;
      case ext === 'js': case ext === 'json': case ext === 'css': case ext === 'py':
      case ext === 'java': case ext === 'c': case ext === 'cpp': case ext === 'h':
      case parsedData.mimeType.includes('javascript'): case parsedData.mimeType.includes('json'):
        text = buffer.toString('utf-8');
        break;
      case parsedData.mimeType === 'application/pdf': case ext === 'pdf':
        const pdfData = await pdf(buffer);
        text = pdfData.text;
        console.log(`✅ PDF extrait: ${pdfData.numpages} pages, ${text.length} caractères`);
        break;
      case parsedData.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      case ext === 'docx':
        try {
          console.log(`📄 Tentative d'extraction DOCX...`);
          const docxResult = await mammoth.extractRawText({ buffer });
          text = docxResult.value;
          if (!text || text.trim().length === 0) {
            console.warn(`⚠️ DOCX vide, tentative avec convertToHtml...`);
            const htmlResult = await mammoth.convertToHtml({ buffer });
            const $ = cheerio.load(htmlResult.value);
            text = $.text();
          }
          if (!text || text.trim().length === 0) {
            return `[Fichier DOCX détecté mais le contenu est vide ou illisible.]`;
          }
          console.log(`✅ DOCX extrait: ${text.length} caractères`);
        } catch (docxError) {
          console.error(`❌ Erreur DOCX:`, docxError.message);
          return `[Erreur lors de la lecture du fichier DOCX "${attachment.name}".]`;
        }
        break;
      case ext === 'doc':
        return `[Fichier .DOC ancien format détecté: ${attachment.name}. Veuillez le convertir en .DOCX.]`;
      case ext === 'xlsx': case ext === 'xls':
      case parsedData.mimeType.includes('spreadsheet'):
        try {
          const XLSX = require('xlsx');
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheetNames = workbook.SheetNames;
          text = sheetNames.map(name => {
            const sheet = workbook.Sheets[name];
            return `[Feuille: ${name}]\n${XLSX.utils.sheet_to_txt(sheet)}`;
          }).join('\n\n');
          console.log(`✅ Excel extrait: ${sheetNames.length} feuille(s)`);
        } catch (xlsxError) {
          return `[Fichier Excel détecté mais module 'xlsx' non installé.]`;
        }
        break;
      case ext === 'pptx': case ext === 'ppt':
      case ext === 'odp': case ext === 'odt': case ext === 'ods':
        try {
          const { parseOffice } = require('officeparser');
          text = await parseOffice(buffer);
          if (!text || !text.trim()) {
            return `[Fichier ${ext.toUpperCase()} vide ou illisible : ${attachment.name}]`;
          }
          console.log(`✅ ${ext.toUpperCase()} extrait: ${text.length} caractères`);
        } catch (officeErr) {
          console.error(`❌ Erreur ${ext.toUpperCase()}:`, officeErr.message);
          return `[Erreur lecture ${ext.toUpperCase()} "${attachment.name}": ${officeErr.message}]`;
        }
        break;
      case ext === 'zip': case ext === 'rar': case ext === '7z':
        return `[Archive détectée: ${attachment.name}. Extraction non supportée.]`;
      default:
        try {
          const textAttempt = buffer.toString('utf-8');
          if (/^[\x20-\x7E\s]+$/.test(textAttempt.substring(0, 10000))) {
            text = textAttempt;
            console.log(`✅ Fichier lu comme texte brut: ${fileName}`);
          } else {
            return `[Contenu du fichier '${attachment.name}' non supporté (${parsedData.mimeType}).]`;
          }
        } catch (e) {
          return `[Impossible de lire '${attachment.name}' (${parsedData.mimeType})]`;
        }
    }
    
    if (text.length > MAX_CHARS) {
      console.log(`⚠️ Fichier tronqué: ${text.length} -> ${MAX_CHARS} caractères`);
      text = text.substring(0, MAX_CHARS) + `\n\n... [Contenu tronqué. Total: ${text.length} caractères]`;
    }
    return text;
  } catch (error) {
    console.error(`❌ Erreur parsing ${attachment.name}:`, error.message);
    return `[Erreur lors de la lecture du fichier '${attachment.name}': ${error.message}]`;
  }
}

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

async function getHistoryFromFirebase(userId, sessionId) {
  if (!db || !userId || !sessionId) return [];
  try {
    const messagesRef = ref(db, `${USER_CHATS_REF}/${userId}/${sessionId}/messages`);
    const snapshot = await get(messagesRef);
    if (!snapshot.exists()) return [];
    const messages = snapshot.val();
    const sortedMessages = Object.values(messages).sort((a, b) => a.timestamp - b.timestamp);
    const recentMessages = sortedMessages.slice(-10);
    return recentMessages;
  } catch (error) {
    console.error("Erreur lecture historique Firebase:", error);
    return [];
  }
}

// ========================================
// 📄 GÉNÉRATION PDF AVEC HTML-PDF-NODE
// ========================================
app.post('/api/download/pdf', async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) {
      return res.status(400).json({ error: 'HTML manquant' });
    }

    console.log('📄 Génération PDF avec html-pdf-node...');

    const options = {
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };

    const file = { content: html };
    const pdfBuffer = await htmlPdf.generatePdf(file, options);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=document.pdf');
    res.send(pdfBuffer);

    console.log('✅ PDF généré avec succès');
  } catch (error) {
    console.error('❌ Erreur génération PDF:', error.message);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF', details: error.message });
  }
});

// ========================================
// 📄 GÉNÉRATION DOCX AVEC HTML-TO-DOCX (sans dépendance système)
// ========================================
app.post('/api/download/docx', async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML manquant' });

    console.log('📄 Génération DOCX avec html-to-docx...');

    const HTMLtoDOCX = require('html-to-docx');
    const buffer = await HTMLtoDOCX(html, null, {
      table:      { row: { cantSplit: true } },
      footer:     true,
      pageNumber: false,
      margins:    { top: 850, right: 850, bottom: 850, left: 850 }, // ~15mm en twips
      font:       'Arial',
      fontSize:   22, // 11pt
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=document.docx');
    res.send(buffer);
    console.log('✅ DOCX généré avec html-to-docx');
  } catch (error) {
    console.error('❌ Erreur génération DOCX:', error.message);
    res.status(500).json({ error: 'Erreur génération DOCX', details: error.message });
  }
});

// ========================================
// 📊 ROUTE : ENREGISTREMENT D'UN CHANGEMENT D'ÉTAT (depuis index.html)
// ========================================
app.post('/api/log-state', async (req, res) => {
  try {
    const { deviceId, etat, source = 'manual' } = req.body;
    if (!deviceId || !etat) return res.status(400).json({ error: 'deviceId et etat requis' });
    await logDeviceStateChange(deviceId, etat, source);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================================
// 📊 ROUTE : STATISTIQUES D'USAGE D'UN APPAREIL
// ========================================
app.get('/api/usage-stats/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const days = parseInt(req.query.days) || 7;
    const stats = await computeUsageStats(deviceId, days);
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================================
// 📊 ROUTE : JOURNAL D'UN JOUR (pour "qu'a-t-on fait hier ?")
// ========================================
app.get('/api/day-history', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const history = await getDayHistory(date);
    res.json({ success: true, history, date });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================================
// RECHERCHE WEB INTELLIGENTE
// ========================================
if (!process.env.TAVILY_API_KEY) {
  console.warn('⚠️ TAVILY_API_KEY manquante — la recherche web sera désactivée');
}

async function optimizeQueryWithLLM(userQuery) {
  try {
    const promptInterne = `Tu es un assistant de recherche. Transforme le message ci-dessous en une requête de recherche courte et précise (maximum 12 mots, sans ponctuation inutile). Ignore le bavardage, les digressions, garde uniquement l'information nécessaire pour trouver la réponse.
Exemple: "pardon je sais pas que nous sommes déjà en 2026 et je te dis que son mandat est terminé actuellement c'est romual Ouaga et qui est le président" -> "président actuel Bénin 2026"
Exemple: "qui est le premier ministre de la France en ce moment" -> "premier ministre France 2026"

Message: "${userQuery}"
Requête:`;

    const keyObj = getNextApiKey();
    const genAI = new GoogleGenerativeAI(keyObj.key);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const result = await model.generateContent(promptInterne, { signal: controller.signal });
    clearTimeout(timeoutId);

    const responseText = result.response.text().trim().replace(/["']/g, '');
    return responseText || null;
  } catch (error) {
    console.warn('⚠️ Optimisation LLM indisponible (timeout/erreur), bascule locale:', error.message);
    return null;
  }
}

function extractCoreQuestionLocal(message) {
  let text = message.trim();
  const sentences = text.split(/(?<=[.?!])\s+/);
  const questionWords = /\b(qui|quoi|quel|quelle|quels|quelles|comment|où|pourquoi|combien|quand|est-ce que)\b/i;
  const questionSentence = sentences.find(s => questionWords.test(s));
  if (questionSentence) text = questionSentence;
  return text.length > 400 ? text.slice(0, 400) : text;
}

async function searchTavily(searchQuery) {
  if (searchQuery.length > 400) searchQuery = searchQuery.slice(0, 400);
  console.log(`🎯 Requête envoyée à Tavily: "${searchQuery}"`);
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: process.env.TAVILY_API_KEY,
      query: searchQuery,
      search_depth: 'basic',
      max_results: 5
    }, { timeout: 8000 });
    const results = (response.data.results || []).map(r => ({
      title: r.title,
      snippet: r.content,
      url: r.url
    }));
    console.log(`✅ ${results.length} résultats récupérés pour le LLM.`);
    return results;
  } catch (error) {
    console.error('❌ Erreur recherche Tavily:', error.message);
    return [];
  }
}

async function performWebSearch(query) {
  let searchQuery = await optimizeQueryWithLLM(query);
  if (!searchQuery) {
    searchQuery = extractCoreQuestionLocal(query);
  }
  console.log(`🔍 Recherche originale: "${query.slice(0, 80)}${query.length > 80 ? '...' : ''}"`);
  return searchTavily(searchQuery);
}

async function decideIfSearchNeeded(userMessage, historyFromFirebase) {
  try {
    const recentHistory = (historyFromFirebase || []).slice(-4).map(h =>
      `Utilisateur: ${h.user}\nAssistant: ${h.bot}`
    ).join('\n\n');

    const decisionPrompt = `Tu es un module de décision pour un assistant IA. Ta SEULE tâche : déterminer si une recherche web en temps réel est nécessaire pour répondre correctement et de façon à jour au MESSAGE ACTUEL ci-dessous.

CONTEXTE RÉCENT DE LA CONVERSATION :
${recentHistory || "(aucun historique)"}

MESSAGE ACTUEL DE L'UTILISATEUR :
"${userMessage}"

Une recherche est NÉCESSAIRE si la question porte sur :
- des personnes/postes qui peuvent changer (présidents, ministres, dirigeants, PDG, etc.)
- des actualités, événements récents, résultats (élections, sport, etc.)
- des prix, taux de change, ou toute donnée qui évolue
- une information que tes connaissances internes pourraient ne plus avoir à jour
- le cas où l'utilisateur conteste, doute, ou redemande une info déjà donnée plus haut dans la conversation (il faut alors revérifier plutôt que répéter)

Une recherche n'est PAS nécessaire pour : domotique, code, calculs, conversation générale, génération de documents/CV, salutations, ou des faits intemporels (mathématiques, définitions, histoire ancienne...).

Réponds UNIQUEMENT avec ce JSON, rien d'autre :
{"needs_search": true ou false, "query": "requête de recherche concise et précise en français, vide si needs_search est false"}`;

    const keyObj = getNextApiKey();
    const genAI = new GoogleGenerativeAI(keyObj.key);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: decisionPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 200,
      },
    }, { signal: controller.signal });
    clearTimeout(timeoutId);

    const decision = JSON.parse(result.response.text());
    console.log(`🧠 Décision recherche: ${decision.needs_search ? 'OUI' : 'NON'}${decision.query ? ` (requête: "${decision.query}")` : ''}`);
    return {
      needsSearch: !!decision.needs_search,
      query: decision.query || userMessage
    };
  } catch (error) {
    console.warn('⚠️ Décision de recherche indisponible, repli sur les mots-clés:', error.message);
    return { needsSearch: needsWebSearch(userMessage), query: userMessage };
  }
}

function needsWebSearch(message) {
  const lowerMsg = message.toLowerCase().trim();
  const noSearchPatterns = [
    /^(c'est quoi|quel est) (ton|votre|le) nom/i, /^qui es-tu/i, /^bonjour/i, /^salut/i,
    /^merci/i, /^ok$/i, /^d'accord$/i, /^allume/i, /^éteins/i, /^règle/i,
    /^je (sort|sors|pars)/i, /^je (suis|reviens|rentre)/i, /^il fait (nuit|jour|sombre|chaud)/i,
    /appareil.*état/i, /état.*appareil/i, /code (arduino|python|javascript)/i,
    /génère.*code/i, /écris.*code/i, /explique/i, /température.*lokossa/i,
    /génère.*pdf/i, /génère.*lettre/i, /crée.*document/i, /fais.*rapport/i, /génère.*cv/i
  ];
  if (noSearchPatterns.some(pattern => pattern.test(lowerMsg))) return false;
  const webKeywords = [
    'actualité', 'news', 'nouvelles', 'recherche', 'cherche', 'trouve',
    'où se trouve', 'où est situé', 'combien coûte', 'prix de',
    'qui est', 'c\'est qui', 'qui sont', 'qui dirige', 'qui gouverne',
    'président', 'premier ministre', 'ministre', 'ministres', 'gouvernement',
    'chef d\'état', 'dirigeant', 'élection', 'élu', 'nommé', 'nomination'
  ];
  const challengePatterns = [
    /tu mens/i, /c'est faux/i, /tu te trompes/i, /tu es sûr/i, /es-tu sûr/i,
    /vérifie/i, /pas vrai/i, /erreur/i, /tu as dit/i, /pour la dernière fois/i,
    /actuel(le|lement)?\b/i, /en ce moment/i, /aujourd'hui/i, /désormais/i, /maintenant/i
  ];
  return webKeywords.some(kw => lowerMsg.includes(kw)) ||
         challengePatterns.some(pattern => pattern.test(lowerMsg));
}

// ========================================
// ANALYSE CONTEXTUELLE (corrigée v14.2)
// ========================================
function analyzeContext(message, deviceStates, beninTime) {
  const analysis = { suggestedActions: [] };
  const lowerMsg = message.toLowerCase().trim();

  // ✅ FIX BUG "perte de fil" : si le message est court OU technique,
  // on ne génère AUCUNE suggestion domotique automatique.
  // Gemini doit lire l'historique pour comprendre le contexte, 
  // pas se laisser distraire par [Analyse].
  const isTechnicalOrShortContext = 
    lowerMsg.length < 30 ||  // messages courts : "oui", "vas-y", "continue", "ok"
    ['code', 'fonction', 'server', 'serveur', 'firebase', 'history',
     'log', 'intégr', 'implémente', 'ajoute', 'écris', 'module',
     'route', 'api', 'index', 'fichier', 'bug', 'erreur', 'corrig',
     'modifi', 'oui', 'vas-y', 'continue', 'ok', 'd\'accord', 'parfait',
     'exactement', 'maintenant', 'ça marche', 'test', 'développ',
     'expliqu', 'analyse', 'prédic', 'statistique', 'comment'].some(kw => lowerMsg.includes(kw));

  if (isTechnicalOrShortContext) {
    // Retour immédiat : aucune suggestion domotique auto-injectée
    return analysis;
  }

  // Suggestion sécurité au départ seulement si message explicite
  if (lowerMsg.includes('je sors') || lowerMsg.includes('je pars') || lowerMsg.includes('je quitte')) {
    const onDevices = Object.values(deviceStates).filter(d => d.etat === 'ON');
    if (onDevices.length > 0) {
      analysis.suggestedActions.push({
        type: 'security_check',
        message: `Vous avez ${onDevices.length} appareil(s) allumé(s). Voulez-vous que je les éteigne ?`,
        devices: onDevices.map(d => d.id)
      });
    }
  }

  // Suggestion économie d'énergie la nuit uniquement si l'utilisateur parle d'appareils
  const talkingAboutDevices = lowerMsg.includes('lampe') || lowerMsg.includes('lumière') || 
    lowerMsg.includes('appareil') || lowerMsg.includes('allum') || lowerMsg.includes('étein');
  if (talkingAboutDevices && beninTime && (beninTime.hours >= 22 || beninTime.hours < 6)) {
    const brightDevices = Object.values(deviceStates).filter(d => d.etat === 'ON' && d.luminosite > 50);
    if (brightDevices.length > 0) {
      analysis.suggestedActions.push({
        type: 'energy_saving',
        message: `Il est ${beninTime.hoursStr}:${beninTime.minutesStr}. Voulez-vous réduire la luminosité ?`,
        devices: brightDevices.map(d => d.id)
      });
    }
  }

  return analysis;
}

// ========================================
// 📊 HISTORIQUE D'USAGE — FONCTIONS PRÉDICTIVES (nouveau v14.2)
// ========================================

/**
 * Enregistre un changement d'état dans history_logs.
 * Appelé par handleDeviceCommands (commandes IA côté serveur).
 * index.html appelle /api/log-state pour les commandes client.
 */
async function logDeviceStateChange(deviceId, etat, source = 'ai_command') {
  if (!db || !deviceId) return;
  try {
    await push(ref(db, HISTORY_LOGS_REF), {
      type: 'state_change',
      deviceId,
      etat,          // "ON" ou "OFF"
      source,        // 'ai_command' | 'manual' | 'planning' | 'esp32'
      timestamp: Date.now()
    });
  } catch (e) {
    console.warn(`⚠️ Impossible de logger l'état pour ${deviceId}:`, e.message);
  }
}

/**
 * Enregistre un ajout ou une suppression d'appareil dans history_logs.
 * Ces événements sont STOCKÉS mais ne sont JAMAIS racontés spontanément
 * par l'IA dans un résumé de journée — seulement si l'utilisateur les
 * demande explicitement (cf. règles du prompt système).
 */
async function logDeviceMetaChange(deviceId, deviceName, action) {
  // action: 'device_add' | 'device_delete'
  if (!db || !deviceId) return;
  try {
    await push(ref(db, HISTORY_LOGS_REF), {
      type: action,
      deviceId,
      deviceName: deviceName || deviceId,
      timestamp: Date.now()
    });
  } catch (e) {
    console.warn(`⚠️ Impossible de logger ${action} pour ${deviceId}:`, e.message);
  }
}

/**
 * Enregistre un ajout ou une suppression de planification dans history_logs.
 * Mêmes règles de discrétion que logDeviceMetaChange : stocké, mais
 * jamais raconté sans demande explicite de l'utilisateur.
 */
async function logPlanningMetaChange(deviceId, action, extra = {}) {
  // action: 'planning_add' | 'planning_delete' | 'planning_delete_all'
  if (!db) return;
  try {
    await push(ref(db, HISTORY_LOGS_REF), {
      type: action,
      deviceId: deviceId || null,
      ...extra,
      timestamp: Date.now()
    });
  } catch (e) {
    console.warn(`⚠️ Impossible de logger ${action}:`, e.message);
  }
}

/**
 * Calcule les statistiques d'usage d'un appareil sur les N derniers jours.
 * Retourne les heures d'activité habituelles et une probabilité par tranche.
 */
async function computeUsageStats(deviceId, days = 7) {
  if (!db) return null;
  try {
    const snapshot = await get(ref(db, HISTORY_LOGS_REF));
    if (!snapshot.exists()) return null;
    
    const allLogs = Object.values(snapshot.val() || {});
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    // Filtrer les logs de cet appareil sur la période
    const deviceLogs = allLogs.filter(l => 
      l.deviceId === deviceId && 
      l.etat === 'ON' && 
      l.timestamp >= cutoff
    );

    if (deviceLogs.length === 0) return null;

    // Compter les activations par heure
    const hourCounts = new Array(24).fill(0);
    deviceLogs.forEach(l => {
      const h = new Date(l.timestamp).getHours();
      hourCounts[h]++;
    });

    // Heure de pointe (la plus fréquente)
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const peakCount = hourCounts[peakHour];
    
    // Probabilité par heure (sur combien de jours l'appareil était ON)
    const hourlyProbability = hourCounts.map(c => Math.round((c / days) * 100));

    // Heures habituelles (probabilité > 40%)
    const usualHours = hourlyProbability
      .map((p, h) => ({ hour: h, probability: p }))
      .filter(x => x.probability >= 40)
      .sort((a, b) => b.probability - a.probability);

    return {
      deviceId,
      totalActivations: deviceLogs.length,
      peakHour,
      peakCount,
      hourlyProbability,
      usualHours,
      daysAnalyzed: days
    };
  } catch (e) {
    console.warn(`⚠️ Erreur calcul stats pour ${deviceId}:`, e.message);
    return null;
  }
}

/**
 * Calcule les statistiques pour tous les appareils et génère
 * un résumé textuel injecté dans le prompt de Gemini.
 */
async function getAllDeviceUsagePatterns(currentHour) {
  if (!db) return '';
  try {
    const snapshot = await get(ref(db, HISTORY_LOGS_REF));
    if (!snapshot.exists()) return '';

    const allLogs = Object.values(snapshot.val() || {});
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentLogs = allLogs.filter(l => l.timestamp >= cutoff && l.etat === 'ON');

    if (recentLogs.length < 3) return ''; // Pas encore assez de données

    // Grouper par appareil
    const byDevice = {};
    recentLogs.forEach(l => {
      if (!byDevice[l.deviceId]) byDevice[l.deviceId] = [];
      byDevice[l.deviceId].push(new Date(l.timestamp).getHours());
    });

    const patterns = [];
    for (const [deviceId, hours] of Object.entries(byDevice)) {
      // Probabilité à l'heure courante ±1h
      const nearNow = hours.filter(h => Math.abs(h - currentHour) <= 1).length;
      const probability = Math.round((nearNow / 7) * 100);
      if (probability >= 50) {
        patterns.push(`${deviceId}: actif ${probability}% du temps à ${currentHour}h`);
      }
    }

    if (patterns.length === 0) return '';
    return `\n[Habitudes d'usage (7j): ${patterns.join(' | ')}]`;
  } catch (e) {
    return '';
  }
}

/**
 * Récupère le journal des actions d'hier ou d'un jour précis.
 * Utilisé pour "fais comme hier" ou "qu'a-t-on fait vendredi ?".
 */
async function getDayHistory(targetDate) {
  if (!db) return [];
  try {
    const snapshot = await get(ref(db, HISTORY_LOGS_REF));
    if (!snapshot.exists()) return [];

    const allLogs = Object.values(snapshot.val() || {});
    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    return allLogs
      .filter(l => l.timestamp >= start.getTime() && l.timestamp <= end.getTime())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(l => {
        const heure = new Date(l.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const type = l.type || 'state_change'; // logs historiques sans "type" = changements d'état
        if (type === 'device_add' || type === 'device_delete') {
          return { type, deviceId: l.deviceId, deviceName: l.deviceName, heure };
        }
        if (type === 'planning_add' || type === 'planning_delete' || type === 'planning_delete_all') {
          return { type, deviceId: l.deviceId, time: l.time, frequency: l.frequency, heure };
        }
        // state_change (par défaut, y compris les anciens logs sans champ "type")
        return { type: 'state_change', deviceId: l.deviceId, etat: l.etat, source: l.source, heure };
      });
  } catch (e) {
    return [];
  }
}

// ========================================
// 🗓️ DÉTECTION "RÉCAP DE JOURNÉE" + HELPERS DE DATE (BÉNIN)
// ========================================

function getBeninDateString(daysOffset = 0) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Porto-Novo', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = fmt.formatToParts(new Date());
    const y = parseInt(parts.find(p => p.type === 'year').value, 10);
    const m = parseInt(parts.find(p => p.type === 'month').value, 10);
    const d = parseInt(parts.find(p => p.type === 'day').value, 10);
    const baseDate = new Date(Date.UTC(y, m - 1, d));
    baseDate.setUTCDate(baseDate.getUTCDate() + daysOffset);
    return baseDate.toISOString().split('T')[0];
  } catch (e) {
    const d = new Date(Date.now() + daysOffset * 86400000);
    return d.toISOString().split('T')[0];
  }
}

const DAY_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function getMostRecentDayOfWeekDate(targetDow) {
  // Retourne la date (YYYY-MM-DD, heure de Lokossa/Bénin) du jour de semaine le plus récent <= aujourd'hui
  for (let offset = 0; offset <= 7; offset++) {
    const dateStr = getBeninDateString(-offset);
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    if (dow === targetDow) return dateStr;
  }
  return getBeninDateString(0);
}

/**
 * Retourne le jour de la semaine (0=dimanche..6=samedi) d'une date décalée
 * de "daysOffset" jours par rapport à aujourd'hui, en heure du Bénin.
 */
function getBeninDayOfWeek(daysOffset = 0) {
  const dateStr = getBeninDateString(daysOffset);
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

/**
 * Calcule une plage "semaine" (lundi -> dimanche) en heure du Bénin.
 * weeksAgo = 0 -> semaine en cours (lundi -> aujourd'hui)
 * weeksAgo = 1 -> semaine dernière complète (lundi -> dimanche)
 */
function getWeekRange(weeksAgo = 0) {
  const dow = getBeninDayOfWeek(0); // 0=dimanche..6=samedi
  const mondayOffsetToday = (dow === 0) ? 6 : dow - 1; // jours écoulés depuis le lundi de cette semaine
  const mondayOffset = mondayOffsetToday + (weeksAgo * 7);
  const start = getBeninDateString(-mondayOffset);
  const end = weeksAgo === 0 ? getBeninDateString(0) : getBeninDateString(-(mondayOffset - 6));
  return { start, end };
}

/**
 * Parse un repère temporel explicite dans le message ("hier", "avant-hier",
 * un jour de semaine, "cette semaine", "la semaine passée"...).
 * Retourne { type: 'day', date } ou { type: 'range', start, end }, ou null si aucun repère trouvé.
 */
function parseRequestedPeriod(lower) {
  if (/la semaine (?:passée|dernière|derniere)|semaine (?:passée|dernière|derniere)/.test(lower)) {
    const { start, end } = getWeekRange(1);
    return { type: 'range', start, end };
  }
  if (/cette semaine/.test(lower)) {
    const { start, end } = getWeekRange(0);
    return { type: 'range', start, end };
  }
  if (/avant[- ]hier/.test(lower)) return { type: 'day', date: getBeninDateString(-2) };
  if (/\bhier\b/.test(lower)) return { type: 'day', date: getBeninDateString(-1) };
  if (/aujourd['’]hui/.test(lower)) return { type: 'day', date: getBeninDateString(0) };

  for (let i = 0; i < DAY_NAMES_FR.length; i++) {
    if (new RegExp(`\\b${DAY_NAMES_FR[i]}\\b`, 'i').test(lower)) {
      return { type: 'day', date: getMostRecentDayOfWeekDate(i) };
    }
  }
  return null; // aucun repère temporel explicite
}

/**
 * Détecte si le message demande un historique/récapitulatif d'activité d'appareil(s)
 * (ex: "qu'a-t-on fait hier ?", "fais comme vendredi", "le story de la prise hier",
 * "l'historique du ventilateur la semaine passée", "historique de la prise" [-> aujourd'hui par défaut]).
 * Retourne { type: 'day', date } ou { type: 'range', start, end }, ou null si rien détecté.
 */
function detectHistoryRequest(message, devices = []) {
  if (!message) return null;
  const lower = message.toLowerCase();

  // Formulations "fortes" : déclenchent toujours la détection, même sans référence temporelle explicite
  // (dans ce cas -> aujourd'hui par défaut).
  const strongRecapKeywords = /(qu['’]a[- ]t[- ]on fait|qu['’]est[- ]ce qu['’]on a fait|qu['’]est[- ]ce qui a (?:été|ete) fait|qu['’]as[- ]tu fait|qu['’]avez[- ]vous fait|récapitulat|recapitulat|fais comme (?:hier|aujourd['’]hui)|répète ce qu['’]on a fait|repete ce qu['’]on a fait|journal (?:du|de la) jour)/i;
  // Formulations "faibles" (mots plus génériques comme "historique", "story", "résumé", "raconte") :
  // déclenchent la détection soit avec une référence temporelle, soit avec un nom d'appareil cité
  // (ex: "historique de la prise" -> aujourd'hui par défaut), pour éviter les faux positifs purement
  // génériques (ex: "fais-moi un résumé de ce document").
  const weakRecapKeywords = /(historique|story|résumé|resume|récap\b|recap\b|raconte[- ]moi|ce qui s['’]est passé)/i;
  const timeReference = /(avant[- ]hier|\bhier\b|aujourd['’]hui|cette semaine|la semaine (?:passée|dernière|derniere)|semaine (?:passée|dernière|derniere)|\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b)/i;

  const hasDeviceMention = extractDeviceFilter(message, devices) !== null;
  const isStrong = strongRecapKeywords.test(lower);
  const isWeak = weakRecapKeywords.test(lower) && (timeReference.test(lower) || hasDeviceMention);
  if (!isStrong && !isWeak) return null;

  const period = parseRequestedPeriod(lower);
  // Par défaut (pas de repère temporel explicite, ex: "historique de la prise") : aujourd'hui
  return period || { type: 'day', date: getBeninDateString(0) };
}

/**
 * Normalise une chaîne pour comparaison insensible aux accents/casse.
 */
function normalizeForMatch(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Essaie de détecter si le message cible un appareil précis
 * (ex: "le story de la prise hier" -> id de l'appareil "prise").
 * Retourne l'id de l'appareil trouvé, ou null.
 */
function extractDeviceFilter(message, devices) {
  if (!message || !devices || devices.length === 0) return null;
  const lower = normalizeForMatch(message);
  let bestMatch = null;
  let bestLen = 0;
  for (const d of devices) {
    const name = normalizeForMatch(d.name || d.id || '');
    if (name && name.length >= 3 && lower.includes(name) && name.length > bestLen) {
      bestMatch = d;
      bestLen = name.length;
    }
  }
  return bestMatch ? bestMatch.id : null;
}

/**
 * Récupère le journal des actions sur une plage de dates (bornes incluses).
 */
async function getRangeHistory(startDate, endDate) {
  if (!db) return [];
  try {
    const snapshot = await get(ref(db, HISTORY_LOGS_REF));
    if (!snapshot.exists()) return [];

    const allLogs = Object.values(snapshot.val() || {});
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    return allLogs
      .filter(l => l.timestamp >= start.getTime() && l.timestamp <= end.getTime())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(l => {
        const dateObj = new Date(l.timestamp);
        const heure = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const dateLabel = dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        const type = l.type || 'state_change'; // logs historiques sans "type" = changements d'état
        if (type === 'device_add' || type === 'device_delete') {
          return { type, deviceId: l.deviceId, deviceName: l.deviceName, heure, dateLabel };
        }
        if (type === 'planning_add' || type === 'planning_delete' || type === 'planning_delete_all') {
          return { type, deviceId: l.deviceId, time: l.time, frequency: l.frequency, heure, dateLabel };
        }
        // state_change (par défaut, y compris les anciens logs sans champ "type")
        return { type: 'state_change', deviceId: l.deviceId, etat: l.etat, source: l.source, heure, dateLabel };
      });
  } catch (e) {
    return [];
  }
}

/**
 * Construit le bloc texte [Journal ...] à injecter dans le prompt,
 * à partir des logs bruts de history_logs pour la date/plage donnée,
 * avec filtrage optionnel sur un appareil précis.
 * Le formatage final (traduction des sources en français naturel + mise en forme
 * soignée) est délégué au modèle, conformément aux règles du prompt système.
 */
async function buildHistoryBlock(dateRange, devices, deviceFilterId = null) {
  let entries;
  let rangeLabel;
  const isRange = dateRange.type === 'range';

  if (isRange) {
    entries = await getRangeHistory(dateRange.start, dateRange.end);
    rangeLabel = `du ${dateRange.start} au ${dateRange.end}`;
  } else {
    entries = await getDayHistory(dateRange.date);
    rangeLabel = dateRange.date;
  }

  if (deviceFilterId) {
    entries = entries.filter(e => e.deviceId === deviceFilterId);
  }

  const deviceName = (id) => devices.find(d => d.id === id)?.name || id;
  const deviceLabel = deviceFilterId ? ` [Filtré sur appareil: ${deviceName(deviceFilterId)}]` : '';

  if (!entries || entries.length === 0) {
    return `\n[Journal (${rangeLabel})${deviceLabel}: aucune donnée enregistrée pour cette période]`;
  }

  const lines = entries.map(e => {
    const dateTag = isRange ? `${e.dateLabel} ` : '';
    if (e.type === 'device_add') return `- ${dateTag}${e.heure} | AJOUT_APPAREIL | ${e.deviceName || deviceName(e.deviceId)}`;
    if (e.type === 'device_delete') return `- ${dateTag}${e.heure} | SUPPRESSION_APPAREIL | ${e.deviceName || deviceName(e.deviceId)}`;
    if (e.type === 'planning_add') return `- ${dateTag}${e.heure} | AJOUT_PLANIFICATION | ${deviceName(e.deviceId)} (${e.time || '?'}, ${e.frequency || 'once'})`;
    if (e.type === 'planning_delete') return `- ${dateTag}${e.heure} | SUPPRESSION_PLANIFICATION | ${deviceName(e.deviceId)}`;
    if (e.type === 'planning_delete_all') return `- ${dateTag}${e.heure} | SUPPRESSION_TOUTES_PLANIFICATIONS`;
    return `- ${dateTag}${e.heure} | ETAT | ${deviceName(e.deviceId)} | ${e.etat} | source=${e.source || 'inconnue'}`;
  });
  return `\n[Journal (${rangeLabel})${deviceLabel}:\n${lines.join('\n')}\n]`;
}

// ========================================
// 💬 HISTORIQUE DE CONVERSATION PAR DATE
// ("Qu'avons-nous dit hier ?", "De quoi a-t-on parlé la semaine passée ?")
// ========================================

/**
 * Détecte si le message demande de retrouver le CONTENU de conversations passées
 * (par opposition à l'historique des appareils). Nécessite un repère temporel explicite,
 * sinon le contexte récent (10 derniers messages déjà injectés) suffit.
 * Retourne { type: 'day', date } ou { type: 'range', start, end }, ou null.
 */
function detectConversationRecapRequest(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  const convoKeywords = /(qu['’]avons[- ]nous dit|qu['’]est[- ]ce qu['’]on a dit|qu['’]est[- ]ce qui a (?:été )?dit|qu['’]est[- ]ce que (?:je|nous) (?:t['’]ai|t['’]avons) (?:demandé|dit)|de quoi (?:on|nous) (?:a[- ]t[- ]on|a(?:vons)?) parlé|a[- ]t[- ]on parlé|on avait discuté|qu['’]avais[- ]je demandé|qu['’]est[- ]ce qu['’]on s['’]est dit|qu['’]est[- ]ce que je t['’]avais (?:demandé|dit))/i;
  if (!convoKeywords.test(lower)) return null;

  const period = parseRequestedPeriod(lower);
  return period; // null si pas de repère temporel -> pas de recherche spéciale nécessaire
}

function truncateForPrompt(text, maxLen = 500) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '… [tronqué]';
}

/**
 * Récupère tous les échanges (toutes sessions confondues) d'un utilisateur
 * dont le timestamp tombe dans la période demandée.
 */
async function getConversationHistoryInRange(userId, dateRange) {
  if (!db || !userId) return [];
  try {
    const isRange = dateRange.type === 'range';
    const startStr = isRange ? dateRange.start : dateRange.date;
    const endStr = isRange ? dateRange.end : dateRange.date;
    const start = new Date(startStr); start.setHours(0, 0, 0, 0);
    const end = new Date(endStr); end.setHours(23, 59, 59, 999);

    const sessionsSnapshot = await get(ref(db, `${USER_CHATS_REF}/${userId}`));
    if (!sessionsSnapshot.exists()) return [];

    const sessions = sessionsSnapshot.val();
    const results = [];
    for (const session of Object.values(sessions)) {
      const messages = session.messages || {};
      for (const msg of Object.values(messages)) {
        if (msg.timestamp >= start.getTime() && msg.timestamp <= end.getTime()) {
          results.push({ timestamp: msg.timestamp, user: msg.user || '', bot: msg.bot || '' });
        }
      }
    }
    results.sort((a, b) => a.timestamp - b.timestamp);
    return results;
  } catch (e) {
    console.warn('⚠️ Erreur lecture historique conversation:', e.message);
    return [];
  }
}

/**
 * Construit le bloc [Conversations passées] injecté dans le prompt.
 * Garde le texte utilisateur quasi complet (généralement court) et tronque
 * les réponses trop longues de l'assistant tout en conservant leur substance
 * (le début, qui contient en général l'essentiel de la réponse).
 */
async function buildConversationHistoryBlock(userId, dateRange) {
  const MAX_EXCHANGES = 25;
  const exchanges = await getConversationHistoryInRange(userId, dateRange);
  const isRange = dateRange.type === 'range';
  const label = isRange ? `du ${dateRange.start} au ${dateRange.end}` : dateRange.date;

  if (!exchanges || exchanges.length === 0) {
    return `\n[Conversations passées (${label}): aucun échange enregistré pour cette période]`;
  }

  const limited = exchanges.length > MAX_EXCHANGES ? exchanges.slice(-MAX_EXCHANGES) : exchanges;
  const lines = limited.map(ex => {
    const d = new Date(ex.timestamp);
    const dateLabel = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `- ${dateLabel} ${heure} | UTILISATEUR: "${truncateForPrompt(ex.user, 250)}" | ASSISTANT: "${truncateForPrompt(ex.bot, 600)}"`;
  });
  const note = exchanges.length > MAX_EXCHANGES
    ? `\n(Note: ${exchanges.length} échanges trouvés au total sur cette période, seuls les ${MAX_EXCHANGES} plus récents sont listés ci-dessus.)`
    : '';
  return `\n[Conversations passées (${label}):\n${lines.join('\n')}${note}\n]`;
}


function detectTruncation(content) {
  const truncationIndicators = [
    /\.\.\.\s*$/,
    /\[suite\]$/i,
    /\[à suivre\]$/i,
    /^\s*\/\/\s*\.\.\./m,
    /\/\*.*\*\/\s*$/,
    /,\s*$/,
    /;\s*$/,
    /<\/DOCUMENT_HTML>\s*\.\.\./,
  ];
  for (const pattern of truncationIndicators) {
    if (pattern.test(content)) {
      console.log(`⚠️ Troncature détectée via pattern: ${pattern}`);
      return true;
    }
  }
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  if (openBraces > closeBraces && openBraces - closeBraces > 2) {
    console.log(`⚠️ Troncature détectée: accolades non fermées (${openBraces} vs ${closeBraces})`);
    return true;
  }
  const openTags = (content.match(/<(?!\/)[^>]+>/g) || []).length;
  const closeTags = (content.match(/<\/[^>]+>/g) || []).length;
  if (openTags > closeTags && openTags - closeTags > 3) {
    console.log(`⚠️ Troncature détectée: balises HTML non fermées`);
    return true;
  }
  const lastChars = content.trim().slice(-20);
  if (/^[^.!?}\]]*$/.test(lastChars) && content.length > 500) {
    console.log(`⚠️ Troncature possible: fin de contenu suspecte`);
    return true;
  }
  return false;
}

// ========================================
// NOUVEAU PROMPT SYSTÈME (corrigé)
// ========================================
const systemPrompt = `Tu es Intellia, assistant universel ultra-intelligent.

## CRÉATEURS 
Tu es créé pour un projet Domotique intelligente par 06 jeunes étudiants chercheurs de l'Université National de Lokossa en Génie électrique et informatique option Électrotechnique et Électronique.
Ton principal créateur est DODAHO Ezéchiel étudiant en 2ème année GEI/EE2
## CONTACTS DE TON PRINCIPAL CRÉATEUR
+229 0159071155
+2290141929429
## VOICI LE NOM DES ETUDIANTS
1.	ADEBIYI Itiyanou
2.	ASSAGA ALLEGA Caleb                                              
3.	DODAHO Ezéchiel 
4.	FADAIRO Onel
5.	KODJO Brice Jean-touss                                               
6.	SOSSAMINOU Maazia Keren                            

## 🎯 TES CAPACITÉS COMPLÈTES
1. **Domotique** : Contrôle appareils, planification, ajout/suppression automatique
2. **Code** : Arduino, Python, JavaScript, C, C++, Java, etc. (ILLIMITÉ - jusqu'à 3000+ lignes)
3. **Recherche web** : Actualités, infos en temps réel via DuckDuckGo
4. **Conversation naturelle** : Contexte, historique, suggestions proactives
5. **Analyse de fichiers** : PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, images
6. **Température Lokossa** : Temps réel via Open-Meteo API
7. **📄 Génération de documents** : CV, lettres, rapports, factures, contrats (HTML formaté direct - ILLIMITÉ)

## 📄 RÈGLES SPÉCIALES POUR LES DOCUMENTS (CRITIQUE)

### Objectif : documents A4 professionnels, compatibles Word

Lorsque tu génères un document (CV, lettre, rapport, facture, contrat) :

1. **Format A4** : utilise les dimensions A4 (210mm x 297mm) dans le CSS.
2. **Polices classiques** : utilise Arial, Calibri, Times New Roman ou Georgia. Évite les polices web.
3. **Structure** : utilise des **tableaux HTML** pour les colonnes et alignements complexes. Évite flexbox et grid.
4. **Styles à éviter** : position absolute, dégradés complexes, ombres (box-shadow, text-shadow), border-radius excessifs, background-image, @font-face, Google Fonts (pas de <link> vers fonts.googleapis.com).
5. **Marges** : utilise des marges de 15-20mm pour un rendu A4 propre.
6. **Emojis** : autorisés mais espacés du texte.
7. **Images** : embarque-les en base64 si indispensables. Sinon, évite-les — les URL externes ne sont pas résolues lors de la conversion DOCX.

**Exemple de structure compatible :**

\`\`\`html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { 
    width: 210mm; 
    margin: 15mm auto; 
    font-family: Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #222;
  }
  table { width: 100%; border-collapse: collapse; }
  .header { border-bottom: 2px solid #4361ee; padding-bottom: 10px; }
  .content { padding: 20px 0; }
</style>
</head>
<body>
  <!-- Contenu structuré avec tableaux -->
</body>
</html>
\`\`\`

⚠️ **RAPPEL : Le document sera converti en PDF et DOCX. Une structure simple garantit un meilleur rendu.**

## ⚠️ FORMAT DE RÉPONSE (CRITIQUE : JSON + MARKDOWN)

Tu dois TOUJOURS répondre en JSON.
Le champ "reply" doit contenir du texte en **Markdown (GFM)** OU du **HTML formaté** pour les documents.

### 🎯 Utilise Markdown pour la structure :
* ### Titre (ou ##)
* **Texte en gras**
* *Texte en italique*
* Listes avec * ou - ou 1.
* Blocs de code avec triple backticks
* Liens : [texte du lien](https://url.com)
* Paragraphes : Laisse une ligne vide pour un nouveau paragraphe.

### 🌡️ TEMPÉRATURE DE LOKOSSA
Tu as accès à la température **RÉELLE EN TEMPS RÉEL** de Lokossa via weather API dans les métadonnées.
**Quand l'utilisateur demande EXPLICITEMENT la température**, donne IMMÉDIATEMENT la valeur **sans mentionner de recherche**.

**Instructions critiques :**
- ❌ Ne dis JAMAIS "Je vais chercher" ou "Laissez-moi vérifier"
- ✅ Réponds directement : "À Lokossa, il fait actuellement **28°C** (Ciel dégagé ☀️). Ressenti: 30°C, Humidité: 75%."
- ✅ Si la source est "estimation", ajoute discrètement : "(estimation basée sur les moyennes saisonnières)"
- ❌ Ne mentionne JAMAIS "Weather" ou "API météo" sauf si l'utilisateur demande la source
- 🚫 **INTERDICTION ABSOLUE** : ne mentionne JAMAIS la température spontanément dans une réponse qui ne porte pas sur la météo, même si tu juges que c'est "pertinent" ou en lien avec le sujet (chaleur, confort, appareils, etc.). Uniquement si l'utilisateur la demande noir sur blanc.

## 📝 GÉNÉRATION DE CODE ET DOCUMENTS LONGS (CRITIQUE)

**Tu peux générer du code ou des documents de N'IMPORTE QUELLE LONGUEUR.**

### 🚀 RÈGLES DE CONTINUATION (COMME CLAUDE)

1. **Si ta réponse est COMPLÈTE** : Génère tout normalement
2. **Si tu manques de tokens** : Ajoute le champ needs_continuation: true
3. **Le client affichera automatiquement un bouton "Continuer"**
4. **Quand l'utilisateur clique "Continuer"** : Tu reçois le contexte et tu CONTINUES exactement là où tu t'es arrêté

**FORMAT JSON POUR CONTINUATION :**
{
  "reply": "Voici le code partie 1 avec marqueur de suite",
  "needs_continuation": true,
  "continuation_context": {
    "type": "code",
    "language": "python",
    "last_line": "def fonction():",
    "section": "Partie 1/3"
  },
  "execute": [],
  "planning_commands": [],
  "device_commands": [],
  "source": "cloud"
}

**QUAND TU CONTINUES (après clic sur "Continuer") :**
{
  "reply": "Suite du code partie 2",
  "needs_continuation": false,
  "execute": [],
  "planning_commands": [],
  "device_commands": [],
  "source": "cloud"
}

### 📍 INDICATEURS DE CONTINUATION

**Ajoute ces marqueurs si tu dois tronquer :**
- Code : # [SUITE DANS LA PROCHAINE RÉPONSE]
- HTML : - Markdown : **[À suivre...]**

**NE JAMAIS :**
- ❌ Recommencer depuis le début
- ❌ Dire "je ne peux pas générer tout"
- ❌ Tronquer sans needs_continuation: true

## 📄 MOTEUR DOCUMENTAIRE RESPONSIVE 2026 (COMPATIBLE WORD)

Lorsqu'un utilisateur demande un document (CV, rapport, contrat, facture, devis, lettre, attestation, document administratif, document professionnel ou tout autre document), l'assistant doit générer un document HTML5 moderne, professionnel, robuste et entièrement responsive.

### Objectif principal

Le document doit être parfaitement lisible sur :
- Smartphone
- Tablette
- Ordinateur portable
- Écran de bureau

Aucun document ne doit nécessiter un défilement horizontal global.
La compatibilité mobile est prioritaire.

---

### Règles HTML obligatoires

Toujours générer :
<!DOCTYPE html>
<html lang="fr">

Utiliser :
- header
- main
- section
- article
- footer

quand cela est pertinent.

Respecter les bonnes pratiques HTML5.

---

### Règles CSS obligatoires

Inclure systématiquement :
*{
  box-sizing:border-box;
}
html, body{
  margin:0;
  padding:0;
  max-width:100%;
  overflow-x:hidden;
}
img{
  max-width:100%;
  height:auto;
  display:block;
}
svg, canvas, iframe{
  max-width:100%;
}
p, span, div, td, th, a, li{
  overflow-wrap:anywhere;
  word-break:break-word;
}

---

### Responsive Mobile First

La conception doit être mobile-first.
Commencer par la version smartphone.
Ajouter ensuite des media queries pour :
- tablette
- ordinateur

Exemple :
.container{
  width:100%;
  padding:16px;
}
@media(min-width:768px){
  .container{
    padding:24px;
  }
}
@media(min-width:1200px){
  .container{
    max-width:1200px;
    margin:auto;
  }
}

---

### Colonnes

Sur smartphone :
- 1 seule colonne
Sur tablette :
- 1 ou 2 colonnes
Sur ordinateur :
- maximum 2 colonnes pour les CV et documents classiques

**⚠️ Pour la compatibilité Word :** utilise des **tableaux HTML** pour créer des colonnes (pas de flexbox/grid).

---

### Gestion des emails et téléphones

Les éléments suivants ne doivent jamais être coupés ou masqués :
- emails
- numéros de téléphone
- URL
- références
- identifiants
- IBAN

Ils doivent automatiquement revenir à la ligne proprement.

---

### Tableaux

Tous les tableaux doivent être responsives.
Toujours utiliser :
<div class="table-wrapper">
  <table>
  </table>
</div>

.table-wrapper{
  width:100%;
  overflow-x:auto;
}

Les tableaux ne doivent jamais casser la mise en page globale.

---

### Images

Les images doivent :
- rester visibles
- conserver leurs proportions
- s'adapter automatiquement à l'écran

Aucune image ne doit provoquer de débordement horizontal.

---

### Collecte des informations avant génération (CRITIQUE)

Avant de générer un CV, une lettre ou tout document personnel, vérifie si tu disposes des informations réelles nécessaires (nom, titre/poste visé, coordonnées, expériences, formations, compétences).

- Si l'utilisateur a déjà fourni ces informations (dans le message actuel ou dans l'historique), utilise-les telles quelles. N'invente rien et ne les remplace JAMAIS par des espaces réservés du type "[Votre Prénom Nom]".
- Si l'utilisateur N'A PAS encore fourni ces informations (ex: il répond "je n'ai pas de CV"), NE GÉNÈRE PAS tout de suite un document avec des champs entre crochets à remplir. Pose plutôt 2-3 questions courtes dans "reply" (en Markdown, sans DOCUMENT_HTML) pour obtenir : nom complet, poste/domaine visé, coordonnées, et un résumé des expériences/formations/compétences. Génère le document HTML seulement une fois ces informations obtenues.
- Exception : si l'utilisateur demande explicitement "un modèle vierge", "un exemple", ou "un template", alors les espaces réservés entre crochets sont autorisés et attendus.
- Si l'utilisateur indique qu'une proposition précédente "est trop standard", "ne lui convient pas", ou demande "un autre", ne renvoie JAMAIS le même contenu (mêmes textes, mêmes espaces réservés). Propose une mise en page, un ton ou un contenu réellement différents, et si le besoin n'est pas clair, demande ce qu'il souhaite changer (style visuel ? informations différentes ? secteur d'activité différent ?).

---

### CV Professionnel 2026

Pour les CV :
- Design moderne 2026
- Très lisible
- Aspect premium
- Compatible ATS
- Mobile-first
- Coordonnées toujours visibles
- Sections bien séparées
- Hiérarchie visuelle claire

Structure recommandée :
- Profil
- Coordonnées
- Expériences
- Formations
- Compétences
- Certifications
- Langues
- Références (si demandé)

Sur mobile :
- une seule colonne
Sur desktop :
- deux colonnes maximum (avec tableaux HTML)

---

### Rapports Professionnels

Les rapports doivent :
- utiliser une structure hiérarchique claire
- inclure un sommaire lorsque pertinent
- être agréables à lire sur téléphone
- éviter les blocs trop larges

---

### Contrats

Les contrats doivent :
- être juridiquement présentables
- conserver une structure claire
- utiliser des sections numérotées
- inclure des espaces de signature adaptés au mobile

---

### Factures et Devis

Les factures et devis doivent :
- présenter clairement les montants
- rester lisibles sur smartphone
- utiliser des tableaux responsives
- afficher les totaux de façon visible

---

### Design

Interdiction de générer des styles incohérents.
Ne jamais appliquer une variation graphique qui réduit :
- la lisibilité
- la stabilité
- le responsive

Les variations visuelles sont autorisées uniquement si elles restent :
- professionnelles
- cohérentes
- élégantes

---

### Accessibilité

Toujours privilégier :
- contraste élevé
- titres hiérarchisés
- HTML sémantique
- lisibilité maximale

---

### Robustesse

Le document final doit :
- fonctionner sur smartphone Android
- fonctionner sur iPhone
- fonctionner sur tablette
- fonctionner sur ordinateur

Aucun contenu ne doit être caché.
Aucun texte ne doit sortir de l'écran.
Aucun élément ne doit dépasser du viewport.

La stabilité d'affichage est prioritaire sur les effets visuels.

ÉLÉMENTS VISUELS
Les emojis professionnels sont autorisés lorsque pertinents :
📧 📱 📍 🎯 💼 🎓 🛠️ 🌍 📅 ✍️
Ils doivent améliorer la lecture et non la surcharger.

PRIORITÉ ABSOLUE
La stabilité d'affichage, la compatibilité mobile et la lisibilité sont prioritaires sur toute créativité graphique.
Aucun contenu ne doit être masqué.
Aucun texte ne doit sortir du viewport.
Aucun élément ne doit dépasser de l'écran.
Le document doit être immédiatement exploitable sur téléphone, tablette et ordinateur sans correction manuelle.
## 🏠 FORMAT DES RÉPONSES DOMOTIQUES (Obligatoire)
- Quand l’utilisateur demande l’état ou le contrôle des appareils, tu dois répondre avec un classement par pièce.
- Utilise les emojis : 🟢 pour « allumé » et 🔴 pour « éteint ».
- Structure :
🏠 État de vos appareils
[Nom de la pièce]
[Nom de l’appareil] : [🟢 Allumé / 🔴 Éteint]
...
- Ne confonds pas les emojis ou icônes selon l’heure/réaction et utiliser pour montrer certains actions et autres si nécessaire.

### 📅 GESTION DU PLANNING AVANCÉE (ROUTINES)

**AVANT d'ajouter, vérifie l'état actuel.**

L'utilisateur peut demander des planifications uniques OU récurrentes. Tu dois détecter la **Fréquence**.

**CHAMPS OBLIGATOIRES DU JSON PLANNING :**
- \`frequency\`: "once" (une fois), "daily" (tous les jours), "weekly" (hebdo), "monthly" (mensuel).
- \`daysOfWeek\`: Tableau d'entiers pour "weekly" [0=Dim, 1=Lun, ... 6=Sam].
- \`targetDate\`: "YYYY-MM-DD" si frequency est "once" (et que ce n'est pas aujourd'hui).

**⚠️ RÈGLE DE DÉFAUT (CRITIQUE) :** Si l'utilisateur demande une planification SANS préciser de date, de jour, ni de fréquence (ex: "Allume la lampe à 18h" sans autre précision), considère par défaut \`frequency: "once"\` pour **aujourd'hui** (ne demande pas de précision, n'invente pas une récurrence). Précise-le naturellement dans ta réponse (ex: "✅ J'ai programmé l'allumage de la Lampe Salon aujourd'hui à 18h.").

**SCÉNARIOS INTELLIGENTS :**

1. **Routine Quotidienne ("Comme d'habitude", "Tous les jours")**
   - Requête : "Allume le salon tous les jours à 18h"
   - JSON : \`frequency: "daily"\`

2. **Routine Hebdomadaire ("Chaque lundi", "Les week-ends")**
   - Requête : "Allume la ventilation chaque Lundi et Mardi à 08h00"
   - JSON : \`frequency: "weekly"\`, \`daysOfWeek: [1, 2]\`
   - Requête : "Le week-end allume tout"
   - JSON : \`frequency: "weekly"\`, \`daysOfWeek: [0, 6]\`

3. **Routine basée sur les habitudes ("Fais comme la semaine passée")**
   - Si l'utilisateur demande de répliquer une routine ou dit "active le mode travail", propose une planification **"daily"** (lundi au vendredi) ou **"weekly"** selon le contexte implicite.

**EXEMPLE DE JSON COMPLET :**
{
  "reply": "✅ C'est noté ! J'ai programmé l'allumage récurrent de la **Lampe Salon** chaque Lundi et Mercredi.",
  "planning_commands": [
    {
      "action": "add",
      "device": "lampe_salon",
      "time": "18:30",
      "actionType": "allumer",
      "power": 100,
      "frequency": "weekly",
      "daysOfWeek": [1, 3]
    }
  ],
  "needs_continuation": false,
  "execute": [],
  "device_commands": [],
  "source": "cloud"
}

### 🗑️ SUPPRESSION DE PLANIFICATIONS (INTELLIGENT)

Tu peux supprimer des planifications de 3 façons :

#### 1. SUPPRESSION DE TOUTES LES TÂCHES

**Déclencheurs :**
- "Supprime toutes les tâches planifiées"
- "Efface tout le planning"
- "Supprime tous les plannings"
- "Annule toutes les tâches planifiées"
- "Vide le planning"

**Exemple de JSON à générer :**
{
  "reply": "✅ Toutes les planifications ont été supprimées !",
  "planning_commands": [
    {
      "action": "delete_all"
    }
  ],
  "needs_continuation": false,
  "execute": [],
  "device_commands": [],
  "source": "cloud"
}

#### 2. SUPPRESSION D'UNE TÂCHE SPÉCIFIQUE PAR NOM D'APPAREIL

**Déclencheurs :**
- "Supprime la planification de la lampe salon"
- "Annule la tâche de la lampe intelligente"
- "Efface le planning du ventilateur"

**Tu dois IDENTIFIER l'appareil dans [Appareils] et chercher les planifications correspondantes dans [Planifications].**

**Si la planification existe :**
{
  "reply": "✅ J'ai supprimé la planification de **Lampe Salon** (prévue à 16h34).",
  "planning_commands": [
    {
      "action": "delete_specific",
      "device": "lampe_salon"
    }
  ],
  "needs_continuation": false,
  "execute": [],
  "device_commands": [],
  "source": "cloud"
}

#### 3. SUPPRESSION D'UNE TÂCHE SPÉCIFIQUE PAR HEURE

**Déclencheurs :**
- "Supprime la planification de la lampe salon à 16h34"
- "Annule la tâche de la lampe intelligente prévue à 19h00"

**Tu dois vérifier dans [Planifications] si une tâche correspond à l'appareil ET à l'heure.**

**Si trouvée :**
{
  "reply": "✅ J'ai supprimé la planification de **Lampe Salon** prévue à **16h34**.",
  "planning_commands": [
    {
      "action": "delete_specific",
      "device": "lampe_salon",
      "time": "16:34"
    }
  ],
  "needs_continuation": false,
  "execute": [],
  "device_commands": [],
  "source": "cloud"
}

**IMPORTANT : Vérifie TOUJOURS [Planifications] avant de confirmer une suppression.**

### ➕ AJOUT AUTOMATIQUE D'APPAREILS
Si l'utilisateur demande d'ajouter un nouvel appareil (ex: "Ajoute une lampe jardin dans le salon"), génère une commande dans **"device_commands"**.

**Exemple de requête :** "Ajoute une lampe jardin dans le salon"
**Exemple de JSON à générer :**
{
  "reply": "✅ J'ai ajouté **Lampe Jardin** dans votre salon !",
  "device_commands": [
    {
      "action": "add",
      "name": "Lampe Jardin",
      "type": "lamp",
      "room": "Salon"
    }
  ],
  "needs_continuation": false,
  "execute": [],
  "planning_commands": [],
  "source": "cloud"
}

**Types d'appareils supportés :**
* lamp : Lampe (avec luminosité)
* plug : Prise électrique
* ventilateur : Ventilateur (avec vitesse)
* thermostat : Thermostat
* volet : Volet roulant

### 🗑️ SUPPRESSION D'APPAREILS
Si l'utilisateur demande de supprimer un appareil (ex: "Supprime la lampe jardin", "Enlève le ventilateur de la chambre"), génère une commande dans **"device_commands"**.

**Exemple de requête :** "Supprime la lampe jardin"
**Exemple de JSON à générer :**
{
  "reply": "✅ J'ai supprimé **Lampe Jardin** de votre système !",
  "device_commands": [
    {
      "action": "delete",
      "device": "lampe_jardin_1234"
    }
  ],
  "needs_continuation": false,
  "execute": [],
  "planning_commands": [],
  "source": "cloud"
}

**Règles de suppression :**
* L'action doit être "delete" ou "remove"
* Le device doit être l'ID exact de l'appareil (tu le trouveras dans [Appareils])
* Si l'utilisateur mentionne le nom de l'appareil, trouve l'ID correspondant dans [Appareils]
* Confirme toujours la suppression dans ta réponse

**Détection de demande de suppression :**
- "Supprime la/le [appareil]"
- "Enlève la/le [appareil]"
- "Retire la/le [appareil]"
- "Efface la/le [appareil]"
- "Désinstalle la/le [appareil]"

### ❌ INTERDICTIONS :
1. ❌ JAMAIS envoyer de balises HTML dans "reply" **SAUF pour les documents** (avec <DOCUMENT_HTML>).
2. ❌ Le client (index.html) s'occupe de transformer le Markdown en HTML pour les réponses normales.
3. ❌ Ne JAMAIS rechercher sur le web pour la température de Lokossa (elle est fournie).
4. ❌ Pour les documents, utilise <DOCUMENT_HTML>... dans reply, pas de JSON structuré.
5. ❌ NE JAMAIS répondre "Commande reçue" sans contexte - TOUJOURS générer du contenu utile.
6. ❌ TOUJOURS vérifier [États] et [Planifications] avant de répondre pour être intelligent.
7. ❌ Si tu manques de tokens, AJOUTE needs_continuation: true au lieu de tronquer brutalement.

## 🌐 RÈGLES DE LANGUE ET DE FORMAT (CRITIQUE)
- Tu dois répondre **UNIQUEMENT en français** dans le champ "reply" et "suggestions".
- Dans le champ "reply", utilise **"allumer"** et **"éteindre"** (jamais "ON"/"OFF" dans le texte visible).
- Dans les messages de confirmation : "J'ai allumé la lampe du salon", "J'ai éteint la prise de la cuisine".

### ⚠️ SÉPARATION ABSOLUE : TEXTE vs COMMANDES MACHINE
- Dans "reply" (texte visible) → FRANÇAIS UNIQUEMENT : "allumer", "éteindre", "tous les appareils"
- Dans "execute" (commandes machine) → UNIQUEMENT "ON" ou "OFF" en majuscules. JAMAIS "allumer" ou "éteindre" dans execute.
- Dans "planning_commands" → le champ "actionType" DOIT être "allumer" ou "éteindre" (le serveur s'en sert pour convertir en ON/OFF). Le champ "action" dans planning_commands n'est PAS utilisé pour ON/OFF, c'est "actionType" qui compte.
- RÉSUMÉ : execute → ON/OFF | planning_commands.actionType → "allumer"/"éteindre" | reply → français

- Ne mentionne jamais de pourcentage dans le texte. Les appareils sont allumés ou éteints.
- Quand l'utilisateur parle de "tous les appareils" : dans les commandes JSON utilise "all_devices", dans le texte dis "tous les appareils".

## FORMAT JSON DE RÉPONSE

{
  "reply": "Contenu en Markdown ou HTML avec DOCUMENT_HTML",
  "needs_continuation": false,
  "continuation_context": null,
  "execute": ["device_id|ON|100"],
  "planning_commands": [],
  "device_commands": [],
  "suggestions": [],
  "source": "cloud"
}

### ⚠️ RÈGLE CRITIQUE POUR LE CHAMP "execute" :
- Le format est TOUJOURS : "device_id|ACTION|valeur"
- Pour ALLUMER : "device_id|ON|100" → valeur = 100 (JAMAIS 1)
- Pour ÉTEINDRE : "device_id|OFF|0" → valeur = 0 (JAMAIS -1 ou autre)
- Pour TOUS les appareils : "all_devices|ON|100" ou "all_devices|OFF|0"
- La valeur doit TOUJOURS être 100 pour ON et 0 pour OFF, rien d'autre.

- Pour les appareils de type lampe, plug, ventilateur, thermostat, volet : les commandes sont uniquement ON ou OFF. **Aucune valeur de luminosité (pourcentage) n'est prise en charge**. Si l'utilisateur demande une luminosité, ignore ce paramètre et utilise ON/OFF avec valeur 100 ou 0.
- Dans toutes les réponses textuelles (en dehors du JSON de commande), utilise **uniquement des mots en français**. Les termes comme "ON", "OFF", "all_devices" sont interdits. Remplacez-les par "Allumer", "Éteindre", "Tous les appareils".
- Pour une commande concernant tous les appareils, ne créez PAS une planification avec device: "all_devices". À la place, créez une planification pour chaque appareil individuellement (ou utilisez l'action "all" dans le champ device que le client interprétera). Cependant, pour simplifier, le client reconnaît "all_devices" et l'affiche en français "Tous les appareils". Mais dans le texte de réponse, dites "Tous les appareils" et jamais "all_devices".

📌 RÈGLES GÉNÉRALES

1. Vérification: Vérifie [États] et [Planifications] AVANT toute réponse.
2. Recherche: Ne recherche PAS pour code/domotique/température Lokossa/documents.
3. Heure: Mentionne SEULEMENT si demandé ou pertinent.
4. Naturalité: Réponses NATURELLES et CONVERSATIONNELLES.
5. CONTEXTE: Si message court ("les", "tout", "oui"), analyse l'historique.
6. MESSAGES COURTS — RÈGLE CRITIQUE (corrigée v14.2) :
   Pour tout message de moins de 6 mots OU contenant "oui", "vas-y", "continue", "ok", "d'accord", "parfait", "exactement", "maintenant" :
   - Lis IMPÉRATIVEMENT les 3 derniers échanges de l'historique.
   - Identifie le SUJET EN COURS : technique/développement/code ? OU domotique ?
   - Si le sujet est technique (code, server.js, Firebase, fonctions, bugs, analyse, implémentation) :
     ✅ IGNORE COMPLÈTEMENT [Analyse] et les états des appareils.
     ✅ Continue le sujet technique en cours. Ne parle PAS d'appareils.
     ✅ "oui vas-y" après une question technique = "continue à écrire le code".
   - Si le sujet est clairement domotique : réponds sur la domotique.
   - En cas de doute : priorité au sujet de la dernière réponse longue de l'historique.
   - Ne JAMAIS interpréter "oui" seul comme une confirmation d'action domotique si la conversation précédente était technique.
7. Fichiers: Base ta réponse sur le contenu fourni.
8. PRÉSENTATION: Utilise la structure Markdown (titres, listes, gras) SAUF pour documents (HTML avec "<DOCUMENT_HTML>").
9. Température Lokossa: Toujours disponible dans les métadonnées. Ne jamais effectuer de recherche web pour l'obtenir. Ne la mentionne JAMAIS spontanément — uniquement lorsqu'elle est explicitement demandée par l'utilisateur.
10. Documents: Lorsqu'un document est demandé, retourner directement un document HTML complet encapsulé dans <DOCUMENT_HTML> ... </DOCUMENT_HTML> en appliquant les règles du Moteur Documentaire Responsive 2026.
11. Suppression: Utilise "device_commands" avec "action: "delete"" pour supprimer des appareils.
12. Suppression planning: Utilise "planning_commands" avec les bonnes actions.
13. Intelligence: Détecte les incohérences (ex : planifier l'allumage d'une lampe déjà allumée).
14. CONTINUATION: Si tu atteins la limite de tokens, ajoute "needs_continuation: true" et le client affichera un bouton "Continuer".
15. Habitudes d'usage : Si [Habitudes d'usage] est présent dans les métadonnées, utilise-le pour faire des suggestions proactives. Ex : "D'habitude vous allumez la lampe salon vers 18h, voulez-vous que je le fasse ?".
16. Mémoire d'activité (HISTORIQUE / RÉCAPITULATIF — jour, semaine, ou appareil précis) : Si l'utilisateur demande un historique, un "story", un résumé ou un récapitulatif ("qu'a-t-on fait aujourd'hui/hier ?", "fais comme hier", "répète ce qu'on a fait vendredi", "le story de la prise pour hier", "l'historique du ventilateur la semaine passée", "résumé de cette semaine"...), un bloc [Journal (...)] peut être présent dans les métadonnées (issu de history_logs). Utilise-le pour répondre avec PRÉCISION. Règles strictes :
- Le bloc peut couvrir UN SEUL JOUR (ex: "[Journal (2026-06-30): ...]") ou UNE PLAGE DE PLUSIEURS JOURS (ex: "[Journal (du 2026-06-22 au 2026-06-28): ...]") pour une demande portant sur "la semaine passée" ou "cette semaine". Dans ce dernier cas, chaque ligne indique le jour concerné : REGROUPE ta réponse par jour (un sous-titre par jour, ex: "**Lundi 22 juin**"), ne mélange pas tout en une seule liste plate.
- Le bloc peut être FILTRÉ SUR UN APPAREIL PRÉCIS (mention "[Filtré sur appareil: NomAppareil]" dans l'en-tête). Dans ce cas, ta réponse ne doit parler QUE de cet appareil — ne mentionne aucun autre appareil, même si la question était formulée de façon générale.
- Par défaut, ne raconte QUE les changements d'état des appareils (allumage/extinction), avec l'heure exacte de chaque action.
- Traduis TOUJOURS la source technique en formulation naturelle et professionnelle, sans jamais utiliser les termes techniques bruts ("manual", "ai_command", "planning", "esp32", "source", "type") :
  - source "manual" → "allumé/éteint manuellement"
  - source "ai_command" → "allumé/éteint par l'assistant"
  - source "planning" → "allumé/éteint automatiquement (planification)"
  - source "esp32" → "allumé/éteint par appui sur bouton poussoir"
- N'évoque les ajouts/suppressions d'appareils ou de planifications QUE si l'utilisateur les demande explicitement (ex: "quels appareils ont été ajoutés aujourd'hui ?", "quelles planifications ont été créées ?"). Par défaut, ces événements sont ignorés dans le récapitulatif, même s'ils sont présents dans les données.
- PRÉSENTATION SOIGNÉE (obligatoire) : ne recopie jamais les lignes brutes du bloc [Journal ...] telles quelles (jamais de "ETAT", "source=...", "|" dans la réponse visible). Reformule proprement en Markdown, par exemple :
  ### 📅 Récapitulatif du 30 juin 2026
  - 🟢 **08h12** — Lampe Salon allumée manuellement
  - 🔴 **22h45** — Lampe Salon éteinte par l'assistant
  Pour une plage de plusieurs jours, structure avec un sous-titre par jour (ex: "**Lundi 22 juin**") suivi des actions de ce jour, plutôt qu'une liste unique non datée.
- Si le bloc [Journal ...] est absent ou vide pour la période/l'appareil demandé, dis-le clairement (ex: "Je n'ai aucune donnée enregistrée pour la prise sur cette période.") plutôt que d'inventer des événements.
16bis. Mémoire de CONVERSATION par date ("Qu'avons-nous dit hier/avant-hier ?", "De quoi a-t-on parlé la semaine passée ?") : Ceci est DIFFÉRENT du point 16 (qui concerne les appareils). Si un bloc [Conversations passées (...)] est présent dans les métadonnées, il contient les échanges réels (question de l'utilisateur + réponse de l'assistant) de la période demandée, toutes discussions confondues. Règles strictes :
- Réponds en te basant sur le CONTENU RÉEL de ces échanges, pas sur une généralité vague. Si le bloc montre par exemple que l'utilisateur avait demandé un CV et reçu telle réponse, dis-le précisément (ex: "Le 29 juin, tu m'as demandé de préparer un CV pour un poste de développeur, et je t'avais proposé une structure avec telles sections.").
- Tu peux résumer si les échanges sont longs, mais le résumé doit FAIRE RESSORTIR l'essentiel du sujet et du contenu réellement échangé (sujet précis, éléments clés de la réponse), jamais une phrase générique du type "nous avons parlé de choses diverses".
- Si plusieurs échanges distincts existent dans la période, regroupe-les par sujet ou par jour, de façon lisible (liste à puces ou courts paragraphes), pas en JSON ni en bloc brut.
- Si le bloc [Conversations passées ...] est absent ou vide pour la période demandée, dis-le clairement (ex: "Je n'ai gardé aucune trace de nos échanges pour cette période.") plutôt que d'inventer un contenu.
17. Fiabilité des faits sensibles au temps (CRITIQUE) : Pour tout fait qui peut changer avec le temps (chef d'état, ministres, gouvernement, prix, actualités, résultats d'élections, etc.), tes connaissances internes peuvent être dépassées. 
- Si un bloc [Web: ...] est présent dans le message, considère-le comme la vérité la plus à jour et fais-le PRIMER sur tes connaissances internes en cas de contradiction. 
- Si [Web] est absent et que la question porte sur un fait potentiellement périmé, dis clairement que l'information pourrait avoir changé plutôt que d'affirmer avec une fausse certitude une réponse issue uniquement de tes connaissances internes. 
- Ne contredis JAMAIS silencieusement une information que TU as toi-même donnée plus tôt dans la même conversation (visible dans l'historique) sans expliquer pourquoi tu corriges (nouvelle recherche, information plus récente, etc.). Si tu n'es pas sûr de laquelle de tes deux réponses précédentes est correcte, dis-le honnêtement au lieu de trancher au hasard.

---

FORMAT DE RÉPONSE

Réponds toujours en JSON valide.

- Réponses normales : Markdown dans "reply".
- Documents : HTML complet dans "<DOCUMENT_HTML>...</DOCUMENT_HTML>" dans "reply".

Ne jamais répondre uniquement :
- "Commande reçue"
- "Traitement en cours"
- "Document généré"

Toujours fournir une réponse utile, complète et contextualisée.

Toujours vérifier les états et les planifications avant de répondre afin d'être intelligent, cohérent et contextuel.

Si la réponse dépasse la limite disponible :
{
  "needs_continuation": true
}
et continuer proprement lors de la reprise.
`;

// ========================================
// GESTION DES COMMANDES D'APPAREILS
// ========================================
async function handleDeviceCommands(commands, userId) {
  if (!db) {
    console.warn("⚠️ Firebase non disponible, impossible de gérer les appareils");
    return;
  }
  for (const cmd of commands) {
    if (cmd.action === 'add') {
      try {
        const deviceName = cmd.name || 'Nouvel Appareil';
        const deviceType = cmd.type || 'lamp';
        const deviceRoom = cmd.room || 'Non spécifié';

        const baseId = deviceName.toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^\w\-]/g, '')
          .substring(0, 30);

        let deviceId = baseId;
        const existingSnapshot = await get(ref(db, `${DEVICES_META_REF}/${baseId}`));
        if (existingSnapshot.exists()) {
          deviceId = baseId + '_' + Date.now().toString().slice(-4);
        }
        const deviceTypes = {
          'lamp': { hasBrightness: true, icon: 'lightbulb' },
          'plug': { hasBrightness: false, icon: 'plug' },
          'ventilateur': { hasBrightness: true, icon: 'fan' },
          'thermostat': { hasBrightness: false, icon: 'temperature-low' },
          'volet': { hasBrightness: false, icon: 'window-maximize' }
        };
        const typeInfo = deviceTypes[deviceType] || deviceTypes['lamp'];
        const newDevice = {
          id: deviceId,
          name: deviceName,
          type: deviceType,
          room: deviceRoom,
          hasBrightness: typeInfo.hasBrightness,
          icon: typeInfo.icon,
          createdAt: Date.now(),
          createdBy: userId
        };
        await set(ref(db, `${DEVICES_META_REF}/${deviceId}`), newDevice);
        await set(ref(db, `${DEVICES_STATES_REF}/${deviceId}`), {
          etat: 'OFF',
          luminosite: 0
        });
        await logDeviceMetaChange(deviceId, deviceName, 'device_add');
        console.log(`✅ Appareil ajouté: ${deviceName} (${deviceId})`);
      } catch (error) {
        console.error(`❌ Erreur ajout appareil:`, error.message);
      }
    } else if (cmd.action === 'delete' || cmd.action === 'remove') {
      try {
        const deviceToDelete = cmd.device || cmd.deviceId || cmd.id;
        if (!deviceToDelete) {
          console.warn("⚠️ Aucun appareil spécifié pour la suppression");
          continue;
        }
        let deletedDeviceName = deviceToDelete;
        try {
          const metaSnapshot = await get(ref(db, `${DEVICES_META_REF}/${deviceToDelete}`));
          if (metaSnapshot.exists()) {
            deletedDeviceName = metaSnapshot.val().name || deviceToDelete;
          }
        } catch (e) { /* ignore */ }
        await set(ref(db, `${DEVICES_META_REF}/${deviceToDelete}`), null);
        await set(ref(db, `${DEVICES_STATES_REF}/${deviceToDelete}`), null);
        const planningSnapshot = await get(ref(db, PLANNING_REF));
        if (planningSnapshot.exists()) {
          const planning = planningSnapshot.val();
          const updatedPlanning = {};
          Object.keys(planning).forEach(key => {
            if (planning[key].device !== deviceToDelete) {
              updatedPlanning[key] = planning[key];
            }
          });
          await set(ref(db, PLANNING_REF), updatedPlanning);
        }
        await logDeviceMetaChange(deviceToDelete, deletedDeviceName, 'device_delete');
        console.log(`✅ Appareil supprimé: ${deviceToDelete}`);
      } catch (error) {
        console.error(`❌ Erreur suppression appareil:`, error.message);
      }
    }
  }
}

// ========================================
// GESTION INTELLIGENTE DES PLANIFICATIONS
// ========================================
async function handlePlanningCommands(commands) {
  if (!commands || commands.length === 0) return;
  const uniqueCommands = [];
  const seen = new Set();
  for (const cmd of commands) {
    let key = `${cmd.action}-${cmd.device}-${cmd.time}`;
    if (cmd.frequency) key += `-${cmd.frequency}`;
    if (cmd.daysOfWeek) key += `-${cmd.daysOfWeek.join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCommands.push(cmd);
    }
  }
  for (const cmd of uniqueCommands) {
    if (cmd.action === 'delete_all') {
      console.log('🗑️ Suppression de TOUTES les planifications');
      if (db) {
        await set(ref(db, PLANNING_REF), null);
        await logPlanningMetaChange(null, 'planning_delete_all');
      }
      continue;
    }
    if (cmd.action === 'delete_specific') {
      console.log(`🗑️ Suppression spécifique: ${cmd.device}`);
      if (!db) continue;
      try {
        const snapshot = await get(ref(db, PLANNING_REF));
        if (snapshot.exists()) {
          const plans = snapshot.val();
          for (const [id, p] of Object.entries(plans)) {
            if (cmd.time && p.device === cmd.device && p.time === cmd.time) {
              await remove(ref(db, `${PLANNING_REF}/${id}`));
              await logPlanningMetaChange(cmd.device, 'planning_delete', { time: p.time });
            } else if (!cmd.time && p.device === cmd.device) {
              await remove(ref(db, `${PLANNING_REF}/${id}`));
              await logPlanningMetaChange(cmd.device, 'planning_delete', { time: p.time });
            }
          }
        }
      } catch (e) { console.error(e); }
      continue;
    }
    if (cmd.action === 'add') {
      console.log(`📅 Ajout Planification: ${cmd.device} à ${cmd.time} (${cmd.frequency || 'once'})`);
      let finalState = 'OFF';
      if (cmd.actionType && cmd.actionType.toLowerCase() === 'allumer') finalState = 'ON';
      if (cmd.action === 'ON') finalState = 'ON';
      const payload = {
        device: cmd.device,
        time: cmd.time,
        action: finalState,
        actionType: cmd.actionType || (finalState === 'ON' ? 'allumer' : 'éteindre'),
        power: cmd.power !== null && cmd.power !== undefined ? parseInt(cmd.power) : 100,
        frequency: cmd.frequency || 'once',
        createdAt: Date.now()
      };
      if (payload.frequency === 'weekly' && Array.isArray(cmd.daysOfWeek)) {
        payload.daysOfWeek = cmd.daysOfWeek;
      }
      if (payload.frequency === 'once' && cmd.targetDate) {
        payload.targetDate = cmd.targetDate;
      } else if (payload.frequency === 'once' && !cmd.targetDate) {
        payload.targetDate = new Date().toISOString().split('T')[0];
      }
      if (db) {
        try {
          await push(ref(db, PLANNING_REF), payload);
          await logPlanningMetaChange(cmd.device, 'planning_add', { time: cmd.time, frequency: payload.frequency });
          console.log(`✅ Planification sauvegardée : ${finalState}`);
          // ✅ Log du planning lui-même (pas de l'exécution, le client loggue à l'exécution)
        } catch (error) {
          console.error('❌ Erreur Firebase:', error);
        }
      }
    }
  }
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
        key = `add_${plan.device}_${plan.time}_${plan.actionType}_${plan.power || 100}`;
        break;
      case 'delete_all': key = 'delete_all'; break;
      case 'delete_specific':
        if (!plan.device) continue;
        key = plan.time ? `delete_${plan.device}_${plan.time}` : `delete_${plan.device}`;
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

function jsonErrorDefaults() {
  return {
    execute: [],
    planning_commands: [],
    device_commands: [],
    needs_continuation: false,
    continuation_context: null,
    suggestions: [],
    source: "error"
  };
}

// ========================================
// FONCTION CHAT AVEC GEMINI - CASCADE COMPLÈTE
// ========================================
async function chatWithGemini(userMessage, devices, userId, sessionId, attachments = [], preferences = {}, continuationMode = false, maxRetries = API_KEYS.length) {
    
  let realDeviceStates = {};
  let currentPlanning = [];
  
  try {
      if (!db) throw new Error("DB non initialisée");
      const statesSnapshot = await get(ref(db, DEVICES_STATES_REF));
      realDeviceStates = statesSnapshot.val() || {};
      console.log(`🔥 États réels récupérés: ${Object.keys(realDeviceStates).length} appareils`);
      const planningSnapshot = await get(ref(db, PLANNING_REF));
      if (planningSnapshot.exists()) {
        const planningObj = planningSnapshot.val();
        currentPlanning = Object.entries(planningObj).map(([id, plan]) => ({
          ...plan,
          firebaseId: id
        }));
        console.log(`📅 Planifications actuelles: ${currentPlanning.length}`);
      }
  } catch (e) {
      console.error("❌ ERREUR FIREBASE:", e.message);
      realDeviceStates = {};
      currentPlanning = [];
  }

  if (API_KEYS.length === 0) {
    return { success: false, error: "Aucune clé Gemini disponible" };
  }

  const beninTime = await getBeninTime();
  const contextAnalysis = analyzeContext(userMessage, realDeviceStates, beninTime);
  const historyFromFirebase = await getHistoryFromFirebase(userId, sessionId);

  // OPTIMISATION : check local avant appel API
  let webResults = [];
  if (!continuationMode) {
    const localDecision = needsWebSearch(userMessage);
    if (localDecision) {
      const searchDecision = await decideIfSearchNeeded(userMessage, historyFromFirebase);
      if (searchDecision.needsSearch) {
        webResults = await searchTavily(searchDecision.query);
      }
    }
  }

  // ✅ Historique/récapitulatif ("qu'a-t-on fait hier/aujourd'hui/vendredi ?", "story de la prise hier",
  // "historique du ventilateur la semaine passée") — supporte jour unique, plage (semaine) et filtre par appareil.
  let dayHistoryBlock = '';
  if (!continuationMode) {
    const requestedRange = detectHistoryRequest(userMessage, devices);
    if (requestedRange) {
      const deviceFilterId = extractDeviceFilter(userMessage, devices);
      dayHistoryBlock = await buildHistoryBlock(requestedRange, devices, deviceFilterId);
    }
  }

  // ✅ NOUVEAU : contenu des conversations passées ("qu'avons-nous dit avant-hier ?",
  // "de quoi a-t-on parlé la semaine passée ?") — distinct de l'historique des appareils.
  let conversationHistoryBlock = '';
  if (!continuationMode) {
    const convoRange = detectConversationRecapRequest(userMessage);
    if (convoRange) {
      conversationHistoryBlock = await buildConversationHistoryBlock(userId, convoRange);
    }
  }

  let lastError = null;

  // 🔥 CASCADE COMPLÈTE des modèles valides
  const modelNames = [
    'gemini-3.1-flash-lite',   // stable, gros quota (500 RPD)
    'gemini-3.5-flash',        // stable, quota limité (20 RPD)
    'gemini-3-flash-preview',  // preview, toujours accessible
    'gemini-3.1-pro-preview',  // preview, à utiliser avec précaution
    'gemini-2.5-flash',        // fiable, pour requêtes standards
    'gemini-2.5-pro'           // dernier recours (texte brut)
  ];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const modelName of modelNames) {
      try {
        const keyObj = getNextApiKey();
        const genAI = new GoogleGenerativeAI(keyObj.key);
        const model = genAI.getGenerativeModel({ model: modelName });

        const historyParts = await Promise.all(
          historyFromFirebase.flatMap(async (h) => [
            await createHistoryEntry("user", h.user, h.attachments || []),
            await createHistoryEntry("model", h.bot)
          ])
        );

        const chat = model.startChat({
          history: [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: JSON.stringify({
                  reply: "### 👋 Recevez mes chaleureuses salutations !\n\nJe suis **Intellia**, votre assistant universel. Comment puis-je vous aider aujourd'hui ?",
                  needs_continuation: false,
                  continuation_context: null,
                  execute: [],
                  planning_commands: [],
                  device_commands: [],
                  suggestions: [],
                  source: "cloud"
                })}] 
            },
            ...historyParts.flat()
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
            maxOutputTokens: 65536,
          },
        });
        
        let planningsText = "Aucune planification actuellement.";
        if (currentPlanning.length > 0) {
          planningsText = currentPlanning.map(p => {
            const deviceName = devices.find(d => d.id === p.device)?.name || p.device;
            const actionText = p.actionType || (p.action === 'ON' ? 'allumer' : 'éteindre');
            const powerText = p.power !== null && p.power !== undefined ? ` à ${p.power}%` : '';
            const freqText = p.frequency ? ` (${p.frequency})` : '';
            return `- ${deviceName} (${p.device}): ${actionText} à ${p.time}${powerText}${freqText}`;
          }).join('\n');
        }
        
        let metadataPrompt;
        
        if (continuationMode) {
          metadataPrompt = `
[MODE: CONTINUATION]
[INSTRUCTION CRITIQUE: Continue EXACTEMENT là où tu t'es arrêté. NE RECOMMENCE PAS depuis le début.]
[Tu dois compléter le contenu précédent, pas le répéter.]

MESSAGE: "${userMessage}"
`;
        } else {
          // ✅ NOUVEAU v14.2 : injection des habitudes d'usage
          const usagePatterns = await getAllDeviceUsagePatterns(beninTime.hours);
          metadataPrompt = `
[Heure: ${beninTime.formatted}]
[Température Lokossa TEMPS RÉEL: ${beninTime.temperature.temperature}°C (${beninTime.temperature.description}), Ressenti: ${beninTime.temperature.feels_like}°C, Humidité: ${beninTime.temperature.humidity}%, Source: ${beninTime.temperature.source}]
[Génération de documents: activée (HTML direct)]
[Préfs: ${JSON.stringify(preferences)}]
[États: ${JSON.stringify(realDeviceStates)}]
[Appareils: ${JSON.stringify(devices)}]
[Planifications: 
${planningsText}
]
[Analyse: ${JSON.stringify(contextAnalysis)}]${usagePatterns}
${webResults.length > 0 ? `[Web: ${JSON.stringify(webResults.slice(0, 3))}]` : ''}${dayHistoryBlock}${conversationHistoryBlock}

MESSAGE: "${userMessage}"
`;
        }

        const promptParts = [ { text: metadataPrompt } ];
        
        if (!continuationMode) {
          for (const att of attachments) {
            if (att.type === 'image') {
              const parsed = parseDataUri(att.data);
              if (parsed) promptParts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
            } else if (att.type === 'file') {
              const fileContent = await parseFileAttachment(att);
              promptParts.push({ text: `\n[DEBUT FICHIER: ${att.name}]\n${fileContent}\n[FIN FICHIER]\n` });
            }
          }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const result = await chat.sendMessage(promptParts, { signal: controller.signal });
        clearTimeout(timeout);

        let aiText = result.response.text();
        try {
          let parsed = JSON.parse(aiText);
          if (parsed.reply) {
            const docMatch = parsed.reply.match(/<DOCUMENT_HTML>([\s\S]*?)<\/DOCUMENT_HTML>/);
            if (docMatch) {
              const htmlContent = docMatch[1].trim();
              const metadata = extractDocumentMetadata(htmlContent);
              parsed.document = {
                html: htmlContent,
                title: metadata.title,
                type: metadata.type,
                pdf_url: '/api/download/pdf',
                docx_url: '/api/download/docx'
              };
              aiText = JSON.stringify(parsed);
            }
          }
        } catch (e) {
          // pas du JSON
        }

        return {
          success: true,
          data: aiText,
          hadWebResults: webResults.length > 0,
        };

      } catch (error) {
        lastError = error;
        const keyObj = API_KEYS[(currentKeyIndex - 1 + API_KEYS.length) % API_KEYS.length];
        const isQuotaError = error.message?.includes('quota') || error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED');
        markKeyAsFailed(keyObj, isQuotaError);
        console.warn(`❌ Modèle ${modelName} échoué (tentative ${attempt+1}): ${error.message}`);
        if (error.message?.includes('503') || error.message?.includes('429')) {
          continue; // essayer le modèle suivant
        }
        // sinon, on passe au prochain modèle de la liste
      }
    }
  }
  return { success: false, error: lastError };
}

function extractDocumentMetadata(html) {
  const titleMatch = html.match(/<title>(.*?)<\/title>/i) || 
                     html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Document';
  
  let type = 'document';
  if (html.includes('doc-cv') || html.includes('CV')) type = 'cv';
  else if (html.includes('doc-lettre') || html.includes('Lettre')) type = 'lettre';
  else if (html.includes('doc-rapport') || html.includes('Rapport')) type = 'rapport';
  else if (html.includes('doc-facture') || html.includes('Facture')) type = 'facture';
  else if (html.includes('doc-contrat') || html.includes('Contrat')) type = 'contrat';
  
  return { title, type };
}

// ========================================
// 🔥 ROUTE PRINCIPALE /api/chat
// ========================================
app.post('/api/chat', async (req, res) => {
  try {
    let {
      message,
      key,
      devices = [],
      deviceStates = {},
      userId,
      sessionId,
      attachments = [],
      preferences = {},
      continuationMode = false
    } = req.body;

    if (key !== AUTH_KEY) {
      return res.status(401).json({ reply: "Clé d'authentification invalide", ...jsonErrorDefaults() });
    }
    if (!message && attachments.length === 0 && !continuationMode) {
      return res.status(400).json({ reply: "Message ou pièce jointe requis", ...jsonErrorDefaults() });
    }
    if (!userId || !sessionId) {
      return res.status(400).json({ reply: "ID Utilisateur ou ID Session manquant", ...jsonErrorDefaults() });
    }

    console.log('\n┌────────────────────────────────────────');
    console.log(`💬 MESSAGE: ${message || '(Continuation)'}`);
    console.log(`🖼️ ATTACHMENTS: ${attachments.length}`);
    console.log(`👤 USER: ${userId.substring(0, 10)}...`);
    console.log(`🏷️ SESSION: ${sessionId}`);
    console.log(`📡 APPAREILS: ${devices.length}`);
    console.log(`🔄 MODE: ${continuationMode ? 'CONTINUATION' : 'NORMAL'}`);

    const startTime = Date.now();
    const result = await chatWithGemini(message, devices, userId, sessionId, attachments, preferences, continuationMode);

    if (!result.success) {
      console.log('⚠️ Gemini indisponible');
      return res.json({
        reply: "### ❌ Service temporairement indisponible\n\nVeuillez réessayer dans quelques instants.",
        ...jsonErrorDefaults()
      });
    }

    const aiText = result.data;
    console.log(`⏱️ Temps: ${Date.now() - startTime}ms`);

    let aiJson;
    try {
      aiJson = JSON.parse(aiText);
    } catch (parseError) {
      console.warn('⚠️ Première tentative de parsing JSON échouée, nettoyage...');
      const cleaned = aiText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
      try {
        aiJson = JSON.parse(cleaned);
      } catch (secondError) {
        console.error('❌ Parsing JSON impossible:', secondError.message);
        return res.json({
          reply: "Désolé, je n'ai pas pu formuler ma réponse correctement. Pouvez-vous reformuler votre demande ?",
          ...jsonErrorDefaults()
        });
      }
    }

    aiJson.reply = aiJson.reply || "Commande reçue.";
    aiJson.execute = aiJson.execute || [];
    aiJson.planning_commands = aiJson.planning_commands || [];
    aiJson.device_commands = aiJson.device_commands || [];
    aiJson.suggestions = aiJson.suggestions || [];
    aiJson.needs_continuation = aiJson.needs_continuation || false;
    aiJson.continuation_context = aiJson.continuation_context || null;
    
    aiJson.planning_commands = deduplicatePlanning(aiJson.planning_commands);
    
    if (aiJson.device_commands && aiJson.device_commands.length > 0) {
      await handleDeviceCommands(aiJson.device_commands, userId);
    }
    
    if (aiJson.planning_commands && aiJson.planning_commands.length > 0) {
      await handlePlanningCommands(aiJson.planning_commands);
      aiJson.planning_commands = [];
    }
    
    if (!aiJson.needs_continuation && aiJson.reply && detectTruncation(aiJson.reply)) {
      console.log('🔍 Troncature automatique détectée par le serveur');
      aiJson.needs_continuation = true;
      if (!aiJson.continuation_context) {
        aiJson.continuation_context = {
          type: "auto-detected",
          message: "Contenu incomplet détecté"
        };
      }
    }
    
    if (!aiJson.source) aiJson.source = result.hadWebResults ? "web" : "cloud";

    console.log('✅ RÉPONSE GÉNÉRÉE');
    console.log(`📤 Execute: ${aiJson.execute.length}`);
    console.log(`📅 Planning: ${aiJson.planning_commands.length} (Traité serveur)`);
    console.log(`➕ Device Commands: ${aiJson.device_commands.length}`);
    console.log(`💡 Suggestions: ${aiJson.suggestions.length}`);
    console.log(`📏 Reply Length: ${aiJson.reply.length} chars`);
    console.log(`🔄 Needs Continuation: ${aiJson.needs_continuation}`);
    if (aiJson.document) {
      console.log(`📄 Document: ${aiJson.document.title} (${aiJson.document.type})`);
    }
    console.log('└────────────────────────────────────────\n');

    res.json(aiJson);
    
  } catch (error) {
    console.error('💥 ERREUR:', error.message);
    console.error(error.stack);
    res.status(500).json({
      reply: "### ❌ Erreur interne\n\nUne erreur s'est produite. Veuillez réessayer.",
      ...jsonErrorDefaults()
    });
  }
});

// ========================================
// 🌐 ROUTE SANTÉ
// ========================================
app.get('/api/health', async (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  const beninTime = await getBeninTime();

  res.json({
    status: 'ok',
    version: '14.2-predictive-analytics',
    features: {
      gemini: API_KEYS.length > 0,
      imageGeneration: false,
      documentGeneration: true,
      codeLongGeneration: true,
      continuationSystem: true,
      webSearch: true,
      contextMemory: "Firebase",
      firebaseStateSync: true,
      multimodal_Image: true,
      multimodal_Files: true,
      htmlOutput: true,
      markdownOutput: true,
      aiPlanning: true,
      intelligentPlanning: true,
      autoAddDevices: true,
      autoDeleteDevices: true,
      intelligentPlanningDeletion: true,
      lokossaTemperature: true,
      documentDownload: "PDF (html-pdf-node) + DOCX (html-to-docx, sans dépendance système)",
      documentMetadata: true,
      supportedFiles: "PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, PPTX, ODT, ODP, ODS, Images",
      maxTokens: 65536,
      // ✅ NOUVEAU v14.2
      historyLogs: true,
      usageStats: true,
      predictiveContext: true,
      dayHistory: true,
      shortMessageFix: true
    },
    keys: {
      gemini: { total: API_KEYS.length, available: availableKeys }
    },
    time: {
      benin: `${beninTime.hoursStr}:${beninTime.minutesStr}`,
      formatted: beninTime.formatted,
      temperature: beninTime.temperature
    },
    conversions: {
      pdf: "html-pdf-node (Chromium embarqué)",
      docx: "html-to-docx (pur Node.js, pas de dépendance système)"
    },
    models_used: {
      chat_cascade: [
        "gemini-3.1-flash-lite (500 RPD)",
        "gemini-3.5-flash (20 RPD)",
        "gemini-3-flash-preview",
        "gemini-3.1-pro-preview",
        "gemini-2.5-flash",
        "gemini-2.5-pro"
      ],
      subtasks: "gemini-3.1-flash-lite"
    }
  });
});

// ========================================
// 🚀 DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v14.2 - ANALYSE PRÉDICTIVE ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🤖 Cascade:`);
  console.log(`      1. gemini-3.1-flash-lite (500 RPD)`);
  console.log(`      2. gemini-3.5-flash (20 RPD)`);
  console.log(`      3. gemini-3-flash-preview`);
  console.log(`      4. gemini-3.1-pro-preview`);
  console.log(`      5. gemini-2.5-flash`);
  console.log(`      6. gemini-2.5-pro`);
  console.log(`   🤖 Sous‑tâches: gemini-3.1-flash-lite`);
  console.log(`   🌐 Langue: 100% français (interdit ON/OFF/all devices)`);
  console.log(`   🔥 Synchro Firebase: Activée`);
  console.log(`   📅 Planning AI: Prêt`);
  console.log(`   🌡️ Température Lokossa: Temps réel`);
  console.log(`   📄 Génération de documents: ✅ ACTIVÉE (HTML)`);
  console.log(`   📥 Téléchargement PDF: ✅ ACTIVÉ (html-pdf-node)`);
  console.log(`   📥 Téléchargement DOCX: ✅ ACTIVÉ (html-to-docx, HTML → DOCX formaté)`);
  console.log(`   💻 Génération de code long: ✅ ACTIVÉE`);
  console.log(`   🔄 Système de continuation: ✅ ACTIVÉ`);
  console.log(`   🎯 Détection troncature: ✅ AUTOMATIQUE`);
  console.log(`   📏 Capacité: ILLIMITÉE (avec continuation)`);
  console.log(`   📊 History Logs: ✅ ACTIVÉ → /api/log-state`);
  console.log(`   📈 Usage Stats: ✅ ACTIVÉ → /api/usage-stats/:deviceId`);
  console.log(`   📆 Day History: ✅ ACTIVÉ → /api/day-history`);
  console.log(`   🧠 Analyse prédictive: ✅ ACTIVÉE (habitudes 7 jours)`);
  console.log(`   🐛 Fix "perte de fil": ✅ CORRIGÉ (v14.2)`);
});
