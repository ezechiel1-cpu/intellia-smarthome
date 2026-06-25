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
const { exec } = require('child_process');
const fs = require('fs').promises;
const os = require('os');

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

// ========================================
// GESTION DES CLÉS API GEMINI
// ========================================
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
    console.log(`✅ Température réelle récupérée : ${Math.round(current.temp_c)}°C`);
    return {
      temperature: Math.round(current.temp_c),
      feels_like: Math.round(current.feelslike_c),
      humidity: current.humidity,
      description: current.condition.text,
      source: 'weatherapi',
      success: true
    };
  } catch (error) {
    console.warn("⚠️ WeatherAPI indisponible, utilisation de l'estimation :", error.message);
    const now = new Date();
    const month = now.getMonth() + 1;
    const hour = now.getHours();
    const estimated = getLoKossaTemperatureEstimated(month, hour);
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
        return `[Fichier PowerPoint détecté: ${attachment.name}. Extraction non supportée.]`;
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
// 📄 GÉNÉRATION DOCX AVEC LIBREOFFICE
// ========================================
app.post('/api/download/docx', async (req, res) => {
  const tempDir = os.tmpdir();
  const tempHtmlFile = path.join(tempDir, `doc_${Date.now()}.html`);
  const tempDocxFile = tempHtmlFile.replace(/\.html$/, '.docx');

  try {
    const { html } = req.body;
    if (!html) {
      return res.status(400).json({ error: 'HTML manquant' });
    }

    console.log('📄 Génération DOCX...');

    await fs.writeFile(tempHtmlFile, html, 'utf8');

    let libreOfficeAvailable = false;
    try {
      await new Promise((resolve, reject) => {
        exec('libreoffice --version', (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      libreOfficeAvailable = true;
    } catch (e) {
      console.warn('⚠️ LibreOffice non installé, fallback texte simple');
    }

    if (libreOfficeAvailable) {
      const cmd = `libreoffice --headless --convert-to docx --outdir ${tempDir} ${tempHtmlFile}`;
      await new Promise((resolve, reject) => {
        exec(cmd, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      const docxBuffer = await fs.readFile(tempDocxFile);
      await fs.unlink(tempHtmlFile).catch(() => {});
      await fs.unlink(tempDocxFile).catch(() => {});
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename=document.docx');
      res.send(docxBuffer);
      console.log('✅ DOCX généré avec LibreOffice');
    } else {
      const { Document, Packer, Paragraph, TextRun } = require('docx');
      const $ = cheerio.load(html);
      $('script, style, button').remove();
      const text = $('body').text().trim() || $('html').text().trim();
      const doc = new Document({
        sections: [{
          children: text.split('\n').filter(line => line.trim()).map(line =>
            new Paragraph({ children: [new TextRun({ text: line.trim(), size: 24 })] })
          )
        }]
      });
      const buffer = await Packer.toBuffer(doc);
      await fs.unlink(tempHtmlFile).catch(() => {});
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename=document.docx');
      res.send(buffer);
      console.log('✅ DOCX généré en fallback texte simple');
    }
  } catch (error) {
    console.error('❌ Erreur génération DOCX:', error.message);
    await fs.unlink(tempHtmlFile).catch(() => {});
    await fs.unlink(tempDocxFile).catch(() => {});
    res.status(500).json({ error: 'Erreur lors de la génération du DOCX' });
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
// ANALYSE CONTEXTUELLE
// ========================================
function analyzeContext(message, deviceStates, beninTime) {
  const analysis = { suggestedActions: [] };
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes('je sors') || lowerMsg.includes('je pars')) {
    const onDevices = Object.values(deviceStates).filter(d => d.etat === 'ON');
    if (onDevices.length > 0) {
      analysis.suggestedActions.push({
        type: 'security_check',
        message: `Vous avez ${onDevices.length} appareil(s) allumé(s). Voulez-vous que je les éteigne ?`,
        devices: onDevices.map(d => d.id)
      });
    }
  }

  if (beninTime && (beninTime.hours >= 22 || beninTime.hours < 6)) {
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
// 🎯 DÉTECTION DE TRONCATURE
// ========================================
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
4. **Styles à éviter** : position absolute, dégradés complexes, ombres, border-radius excessifs.
5. **Marges** : utilise des marges de 15-20mm pour un rendu A4 propre.
6. **Emojis** : autorisés mais espacés du texte.

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
**Quand l'utilisateur demande la température**, donne IMMÉDIATEMENT la valeur **sans mentionner de recherche**.

**Instructions critiques :**
- ❌ Ne dis JAMAIS "Je vais chercher" ou "Laissez-moi vérifier"
- ✅ Réponds directement : "À Lokossa, il fait actuellement **28°C** (Ciel dégagé ☀️). Ressenti: 30°C, Humidité: 75%."
- ✅ Si la source est "estimation", ajoute discrètement : "(estimation basée sur les moyennes saisonnières)"
- ❌ Ne mentionne JAMAIS "Weather" ou "API météo" sauf si l'utilisateur demande la source

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

## 🌐 RÈGLES DE LANGUE ET DE FORMAT (NOUVEAU)
- Tu dois répondre **UNIQUEMENT en français** dans tous les champs textuels de la réponse (reply, suggestions, etc.). **Interdis-toi tout mot anglais** comme "ON", "OFF", "all devices", "all", "none", "OK", etc.
- Utilise **"allumer"** et **"éteindre"** pour les actions.
- Ne mentionne **jamais** de pourcentage de luminosité, sauf si l'appareil possède explicitement une luminosité réglable (ce qui n'est pas le cas dans cette installation). Les appareils sont soit allumés, soit éteints.
- Quand l'utilisateur parle de **"tous les appareils"**, dans les commandes JSON, utilise l'identifiant \`"all_devices"\` (pour que le système le reconnaisse), mais dans ta réponse textuelle, dis **"tous les appareils"** (en français).
- Dans les messages de confirmation, utilise des formulations comme : "J'ai allumé la lampe du salon", "J'ai éteint la prise de la cuisine", "Tous les appareils ont été allumés".

## FORMAT JSON DE RÉPONSE

{
  "reply": "Contenu en Markdown ou HTML avec DOCUMENT_HTML",
  "needs_continuation": false,
  "continuation_context": null,
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [],
  "device_commands": [],
  "suggestions": [],
  "source": "cloud"
}


- Pour les appareils de type lampe, plug, ventilateur, thermostat, volet : les commandes sont uniquement ON ou OFF. **Aucune valeur de luminosité (pourcentage) n'est prise en charge**. Si l'utilisateur demande une luminosité, ignore ce paramètre et utilise ON/OFF.
- Dans toutes les réponses textuelles (en dehors du JSON de commande), utilise **uniquement des mots en français**. Les termes comme "ON", "OFF", "all_devices" sont interdits. Remplacez-les par "Allumer", "Éteindre", "Tous les appareils".
- Pour une commande concernant tous les appareils, ne créez PAS une planification avec device: "all_devices". À la place, créez une planification pour chaque appareil individuellement (ou utilisez l'action "all" dans le champ device que le client interprétera). Cependant, pour simplifier, le client reconnaît "all_devices" et l'affiche en français "Tous les appareils". Mais dans le texte de réponse, dites "Tous les appareils" et jamais "all_devices".

📌 RÈGLES GÉNÉRALES

1. Vérification: Vérifie [États] et [Planifications] AVANT toute réponse.
2. Recherche: Ne recherche PAS pour code/domotique/température Lokossa/documents.
3. Heure: Mentionne SEULEMENT si demandé ou pertinent.
4. Naturalité: Réponses NATURELLES et CONVERSATIONNELLES.
5. CONTEXTE: Si message court ("les", "tout", "oui"), analyse l'historique.
6. Fichiers: Base ta réponse sur le contenu fourni.
7. PRÉSENTATION: Utilise la structure Markdown (titres, listes, gras) SAUF pour documents (HTML avec "<DOCUMENT_HTML>").
8. Température Lokossa: Toujours disponible dans les métadonnées. Ne jamais effectuer de recherche web pour l'obtenir. Ne la mentionner que lorsqu'elle est explicitement demandée ou lorsqu'elle est réellement pertinente pour la réponse en cours.
9. Documents: Lorsqu'un document est demandé, retourner directement un document HTML complet encapsulé dans <DOCUMENT_HTML> ... </DOCUMENT_HTML> en appliquant les règles du Moteur Documentaire Responsive 2026.
10. Suppression: Utilise "device_commands" avec "action: "delete"" pour supprimer des appareils.
11. Suppression planning: Utilise "planning_commands" avec les bonnes actions.
12. Intelligence: Détecte les incohérences (ex : planifier l'allumage d'une lampe déjà allumée).
13. CONTINUATION: Si tu atteins la limite de tokens, ajoute "needs_continuation: true" et le client affichera un bouton "Continuer".
14. Fiabilité des faits sensibles au temps (CRITIQUE) : Pour tout fait qui peut changer avec le temps (chef d'état, ministres, gouvernement, prix, actualités, résultats d'élections, etc.), tes connaissances internes peuvent être dépassées. 
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
      if (db) await set(ref(db, PLANNING_REF), null);
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
            } else if (!cmd.time && p.device === cmd.device) {
              await remove(ref(db, `${PLANNING_REF}/${id}`));
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
          console.log(`✅ Planification sauvegardée : ${finalState}`);
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
[Analyse: ${JSON.stringify(contextAnalysis)}]
${webResults.length > 0 ? `[Web: ${JSON.stringify(webResults.slice(0, 3))}]` : ''}

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
  
  let libreOfficeAvailable = false;
  try {
    await new Promise((resolve, reject) => {
      exec('libreoffice --version', (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    libreOfficeAvailable = true;
  } catch (e) {
    libreOfficeAvailable = false;
  }

  res.json({
    status: 'ok',
    version: '14.1-prompt-optimized',
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
      documentDownload: "PDF (html-pdf-node) + DOCX (LibreOffice fallback)",
      documentMetadata: true,
      supportedFiles: "PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, Images",
      maxTokens: 65536
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
      docx: libreOfficeAvailable ? "LibreOffice (headless)" : "Fallback: extraction texte simple"
    },
    system: {
      libreoffice_available: libreOfficeAvailable
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
  console.log('   ║   INTELLIA v14.1 - PROMPT OPTIMISÉ  ║');
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
  console.log(`   📥 Téléchargement DOCX: ✅ ACTIVÉ (LibreOffice + fallback)`);
  console.log(`   💻 Génération de code long: ✅ ACTIVÉE`);
  console.log(`   🔄 Système de continuation: ✅ ACTIVÉ`);
  console.log(`   🎯 Détection troncature: ✅ AUTOMATIQUE`);
  console.log(`   📏 Capacité: ILLIMITÉE (avec continuation)`);
});
