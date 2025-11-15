// ========================================
// INTELLIA v9.4 - ASSISTANT MULTIMODAL AMÉLIORÉ
//
// ✅ Ajout automatique d'appareils via IA
// ✅ Température de Lokossa en temps réel
// ✅ Actions "allumer"/"éteindre" dans planning
// ✅ Markdown + Planning AI
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ Imports Firebase
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, set, push } = require("firebase/database");

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
// 🌡️ TEMPÉRATURE RÉELLE DE LOKOSSA (Open-Meteo API)
// ========================================

// Fallback: Estimation si API indisponible
function getLoKossaTemperatureEstimated(month, hour) {
  const temperatureData = {
    1: { min: 23, max: 35, avg: 29 },  // Janvier
    2: { min: 25, max: 36, avg: 30.5 }, // Février
    3: { min: 25, max: 35, avg: 30 },  // Mars
    4: { min: 24, max: 34, avg: 29 },  // Avril
    5: { min: 24, max: 32, avg: 28 },  // Mai
    6: { min: 23, max: 30, avg: 26.5 }, // Juin
    7: { min: 23, max: 29, avg: 26 },  // Juillet
    8: { min: 23, max: 29, avg: 26 },  // Août
    9: { min: 23, max: 30, avg: 26.5 }, // Septembre
    10: { min: 24, max: 32, avg: 28 },  // Octobre
    11: { min: 24, max: 33, avg: 28.5 }, // Novembre
    12: { min: 23, max: 34, avg: 28.5 }  // Décembre
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

// API Open-Meteo (100% gratuit, précis à 92-95%)
async function getRealLoKossaTemperature() {
  try {
    console.log("🌡️ Appel Open-Meteo API...");
    
    // Coordonnées GPS de Lokossa: 6.64°N, 1.97°E
    const response = await axios.get(
      'https://api.open-meteo.com/v1/forecast',
      {
        params: {
          latitude: 6.64,
          longitude: 1.97,
          current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
          timezone: 'Africa/Porto-Novo',
          temperature_unit: 'celsius'
        },
        timeout: 3000 // ✅ Timeout réduit à 3 secondes
      }
    );
    
    const current = response.data.current;
    
    console.log(`✅ Température récupérée: ${Math.round(current.temperature_2m)}°C`);
    
    return {
      temperature: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      description: getWeatherDescription(current.weather_code),
      source: 'open-meteo-api',
      success: true
    };
    
  } catch (error) {
    console.warn("⚠️ Open-Meteo API indisponible, utilisation estimation:", error.message);
    const now = new Date();
    const month = now.getMonth() + 1;
    const hour = now.getHours();
    const estimated = getLoKossaTemperatureEstimated(month, hour);
    console.log(`📊 Température estimée: ${estimated.temperature}°C`);
    return { 
      ...estimated, 
      success: false 
    };
  }
}

// ========================================
// HEURE PRÉCISE DU BÉNIN + TEMPÉRATURE TEMPS RÉEL
// ========================================
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
  
  // ✅ TOUJOURS récupérer la température RÉELLE via Open-Meteo
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

// ✅ FONCTION AMÉLIORÉE - Support de TOUS les fichiers
async function parseFileAttachment(attachment) {
  try {
    const parsedData = parseDataUri(attachment.data);
    if (!parsedData) throw new Error("Invalid Data URI");
    
    const buffer = Buffer.from(parsedData.data, 'base64');
    let text = "";
    const MAX_CHARS = 15000;
    
    console.log(`📄 Parsing: ${attachment.name}, MIME: ${parsedData.mimeType}, Size: ${buffer.length} bytes`);
    
    const fileName = attachment.name.toLowerCase();
    const ext = fileName.split('.').pop();
    
    switch (true) {
      // ===== TEXTE BRUT =====
      case parsedData.mimeType.startsWith('text/'):
      case ext === 'txt':
      case ext === 'log':
      case ext === 'md':
      case ext === 'csv':
        text = buffer.toString('utf-8');
        break;
      
      // ===== HTML / XML =====
      case ext === 'html':
      case ext === 'htm':
      case ext === 'xml':
      case parsedData.mimeType.includes('html'):
      case parsedData.mimeType.includes('xml'):
        text = buffer.toString('utf-8');
        break;
      
      // ===== CODE SOURCE =====
      case ext === 'js':
      case ext === 'json':
      case ext === 'css':
      case ext === 'py':
      case ext === 'java':
      case ext === 'c':
      case ext === 'cpp':
      case ext === 'h':
      case parsedData.mimeType.includes('javascript'):
      case parsedData.mimeType.includes('json'):
        text = buffer.toString('utf-8');
        break;
      
      // ===== PDF =====
      case parsedData.mimeType === 'application/pdf':
      case ext === 'pdf':
        const pdfData = await pdf(buffer);
        text = pdfData.text;
        console.log(`✅ PDF extrait: ${pdfData.numpages} pages, ${text.length} caractères`);
        break;
      
      // ===== DOCX (AMÉLIORÉ) =====
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
            return `[Fichier DOCX détecté mais le contenu est vide ou illisible. Veuillez vérifier que le fichier n'est pas protégé ou corrompu.]`;
          }
          
          console.log(`✅ DOCX extrait: ${text.length} caractères`);
        } catch (docxError) {
          console.error(`❌ Erreur DOCX:`, docxError.message);
          return `[Erreur lors de la lecture du fichier DOCX "${attachment.name}". Le fichier est peut-être corrompu ou dans un format non standard. Essayez de l'ouvrir dans Word et de le réenregistrer, ou exportez-le en PDF.]`;
        }
        break;
      
      // ===== DOC (ancien format) =====
      case ext === 'doc':
        return `[Fichier .DOC ancien format détecté: ${attachment.name}. Veuillez le convertir en .DOCX pour une meilleure extraction.]`;
      
      // ===== EXCEL =====
      case ext === 'xlsx':
      case ext === 'xls':
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
          return `[Fichier Excel détecté mais module 'xlsx' non installé. Installez avec: npm install xlsx]`;
        }
        break;
      
      // ===== POWERPOINT =====
      case ext === 'pptx':
      case ext === 'ppt':
        return `[Fichier PowerPoint détecté: ${attachment.name}. Extraction non supportée. Taille: ${buffer.length} bytes]`;
      
      // ===== ARCHIVES =====
      case ext === 'zip':
      case ext === 'rar':
      case ext === '7z':
        return `[Archive détectée: ${attachment.name}. Extraction non supportée. Taille: ${buffer.length} bytes]`;
      
      // ===== FORMAT NON RECONNU =====
      default:
        try {
          const textAttempt = buffer.toString('utf-8');
          if (/^[\x20-\x7E\s]+$/.test(textAttempt.substring(0, 1000))) {
            text = textAttempt;
            console.log(`✅ Fichier lu comme texte brut: ${fileName}`);
          } else {
            return `[Contenu du fichier '${attachment.name}' non supporté (${parsedData.mimeType}). Type: binaire, Taille: ${buffer.length} bytes]`;
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
// RECHERCHE WEB INTELLIGENTE
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
    /génère.*code/i, /écris.*code/i, /explique/i, /température.*lokossa/i
  ];
  if (noSearchPatterns.some(pattern => pattern.test(lowerMsg))) return false;
  const webKeywords = [
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
// ✅ PROMPT SYSTÈME v9.4 (MARKDOWN + PLANNING AI + ADD DEVICES)
// ========================================
const systemPrompt = `Tu es Intellia, assistant universel ultra-intelligent.

## CRÉATEURS 
Tu es créé pour un projet Domotique intelligente par 06 jeunes étudiants chercheurs de l'Université National de Lokossa en Génie électrique et informatique option Électrotechnique et Électronique.

## CONTACTS DE TON PRINCIPAL CRÉATEUR 
+229 0159071155
+229 0141929429

## CAPACITÉS
Domotique, Code (Arduino/Python/JS), Recherche web, Conversation naturelle, Analyse de Fichiers (PDF, TXT, DOCX, HTML, JS, XLSX, etc.) et Images, **Ajout automatique d'appareils**, **Température de Lokossa en temps réel**.

## ⚠️ FORMAT DE RÉPONSE (CRITIQUE : MARKDOWN)

Tu dois TOUJOURS répondre en JSON.
Le champ "reply" doit contenir du texte en **Markdown (GFM)**.

### 🎯 Utilise Markdown pour la structure :
* \`### Titre\` (ou \`##\`)
* \`**Texte en gras**\`
* \`*Texte en italique*\`
* Listes avec \`*\` ou \`-\` ou \`1.\`
* Blocs de code avec \`\`\`javascript ... \`\`\`
* Liens : \`[texte du lien](https://url.com)\`
* Paragraphes : Laisse une ligne vide pour un nouveau paragraphe.

### 🌡️ TEMPÉRATURE DE LOKOSSA
Tu as accès à la température **RÉELLE EN TEMPS RÉEL** de Lokossa via Open-Meteo API dans les métadonnées.
**Quand l'utilisateur demande la température**, donne IMMÉDIATEMENT la valeur **sans mentionner de recherche**.

**Instructions critiques :**
- ❌ Ne dis JAMAIS "Je vais chercher" ou "Laissez-moi vérifier"
- ✅ Réponds directement : "À Lokossa, il fait actuellement **28°C** (Ciel dégagé ☀️). Ressenti: 30°C, Humidité: 75%."
- ✅ Si la source est "estimation", ajoute discrètement : "(estimation basée sur les moyennes saisonnières)"
- ❌ Ne mentionne JAMAIS "Open-Meteo" ou "API météo" sauf si l'utilisateur demande la source

### 📅 GESTION DU PLANNING (CRITIQUE)
Si l'utilisateur demande une action à un **moment futur** ("à 16h34", "dans 15 minutes", "à 20h00 demain"), tu dois générer une commande dans le champ **"planning_commands"**.

**Exemple de requête :** "Allume la lampe du salon à 16h34 à 80%"
**Exemple de JSON à générer :**
\`\`\`json
{
  "reply": "✅ C'est noté ! J'ai ajouté la tâche **Lampe Salon** à votre planning pour 16h34.",
  "planning_commands": [
    {
      "action": "add",
      "device": "lampe_salon",
      "time": "16:34",
      "actionType": "allumer",
      "power": 80
    }
  ],
  "execute": [],
  "source": "cloud"
}
\`\`\`

**Règles de planning :**
* Le format \`time\` est TOUJOURS \`HH:MM\`.
* L'ID de l'appareil (\`device\`) doit exister dans [Appareils].
* L'\`actionType\` est **"allumer"** ou **"éteindre"** selon la requête.
* Pour une lampe, la \`power\` est obligatoire (entre 0 et 100). Pour une prise (\`plug\`), mets \`power: 100\` pour ON et \`power: 0\` pour OFF.
* L'\`action\` est toujours \`"add"\` pour ajouter une tâche.

### ➕ AJOUT AUTOMATIQUE D'APPAREILS
Si l'utilisateur demande d'ajouter un nouvel appareil (ex: "Ajoute une lampe jardin dans le salon"), génère une commande dans **"device_commands"**.

**Exemple de requête :** "Ajoute une lampe jardin dans le salon"
**Exemple de JSON à générer :**
\`\`\`json
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
  "execute": [],
  "source": "cloud"
}
\`\`\`

**Types d'appareils supportés :**
* \`lamp\` : Lampe (avec luminosité)
* \`plug\` : Prise électrique
* \`ventilateur\` : Ventilateur (avec vitesse)
* \`thermostat\` : Thermostat
* \`volet\` : Volet roulant

### ❌ INTERDICTIONS :
1. ❌ JAMAIS envoyer de balises HTML (<p>, <h2>, <strong style=...>) dans "reply".
2. ❌ Le client (index.html) s'occupe de transformer le Markdown en HTML.
3. ❌ Ne JAMAIS rechercher sur le web pour la température de Lokossa (elle est fournie).

## FORMAT JSON DE RÉPONSE

{
  "reply": "### 💡 État des lampes\\n\\nVoici l'état actuel :\\n\\n* **LED 1 (SALON)** : Allumée à 30%\\n* **LED 2 (CHAMBRE)** : Éteinte\\n",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [],
  "device_commands": [],
  "suggestions": [],
  "source": "cloud"
}

## 📌 RÈGLES GÉNÉRALES

1. **Vérification:** Vérifie [États] AVANT toute action immédiate.
2. **Recherche:** Ne recherche PAS pour code/domotique/température Lokossa.
3. **Heure:** Mentionne SEULEMENT si demandé ou pertinent.
4. **Naturalité:** Réponses NATURELLES et CONVERSATIONNELLES.
5. **CONTEXTE:** Si message court ("les","tout", "oui"), analyse l'historique.
6. **Fichiers:** Base ta réponse sur le contenu fourni.
7. **PRÉSENTATION:** Utilise la structure Markdown (titres, listes, gras).
8. **Température Lokossa:** Toujours disponible dans les métadonnées, ne cherche JAMAIS sur le web.

RÉPONDS EN JSON VALIDE AVEC DU MARKDOWN DANS "reply".
`;

// ========================================
// FONCTION CHAT AVEC GEMINI
// ========================================
async function chatWithGemini(userMessage, devices, userId, sessionId, attachments = [], preferences = {}, maxRetries = API_KEYS.length) {
    
  let realDeviceStates = {};
  try {
      if (!db) throw new Error("DB non initialisée");
      const snapshot = await get(ref(db, DEVICES_STATES_REF));
      realDeviceStates = snapshot.val() || {};
      console.log(`🔥 États réels récupérés: ${Object.keys(realDeviceStates).length} appareils`);
  } catch (e) {
      console.error("❌ ERREUR FIREBASE:", e.message);
      realDeviceStates = {};
  }

  if (API_KEYS.length === 0) {
    return { success: false, error: "Aucune clé Gemini disponible" };
  }

  const beninTime = await getBeninTime();
  const contextAnalysis = analyzeContext(userMessage, realDeviceStates, beninTime);
  
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

      const historyFromFirebase = await getHistoryFromFirebase(userId, sessionId);

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
                execute: [], planning_commands: [], device_commands: [], suggestions: [], source: "cloud"
              })}] 
          },
          ...historyParts.flat()
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      });

      const metadataPrompt = `
[Heure: ${beninTime.formatted}]
[Température Lokossa TEMPS RÉEL: ${beninTime.temperature.temperature}°C (${beninTime.temperature.description}), Ressenti: ${beninTime.temperature.feels_like}°C, Humidité: ${beninTime.temperature.humidity}%, Source: ${beninTime.temperature.source}]
[Préfs: ${JSON.stringify(preferences)}]
[États: ${JSON.stringify(realDeviceStates)}]
[Appareils: ${JSON.stringify(devices)}] 
[Analyse: ${JSON.stringify(contextAnalysis)}]
${webResults.length > 0 ? `[Web: ${JSON.stringify(webResults.slice(0, 3))}]` : ''}

MESSAGE: "${userMessage}"
`;

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
      const timeout = setTimeout(() => controller.abort(), 25000);
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
      console.warn(`⚠️ Tentative ${attempt + 1}/${maxRetries} échouée: ${error.message}`);
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
    let { 
      message, 
      key, 
      devices = [],
      deviceStates = {},
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

    console.log('┌────────────────────────────────────────');
    console.log(`💬 MESSAGE: ${message || '(Pas de texte)'}`);
    console.log(`🖼️ ATTACHMENTS: ${attachments.length}`);
    console.log(`👤 USER: ${userId.substring(0, 10)}...`);
    console.log(`🏷️ SESSION: ${sessionId}`);
    console.log(`📡 APPAREILS: ${devices.length}`);

    const startTime = Date.now();
    const result = await chatWithGemini(message, devices, userId, sessionId, attachments, preferences);

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

    // ✅ Valeurs par défaut et nettoyage
    aiJson.reply = aiJson.reply || "Commande reçue.";
    aiJson.execute = aiJson.execute || [];
    aiJson.planning_commands = aiJson.planning_commands || [];
    aiJson.device_commands = aiJson.device_commands || [];
    aiJson.suggestions = aiJson.suggestions || [];
    
    // ✅ Déduplication des planifications
    aiJson.planning_commands = deduplicatePlanning(aiJson.planning_commands);
    
    // ✅ Traiter les commandes d'ajout d'appareils
    if (aiJson.device_commands && aiJson.device_commands.length > 0) {
      await handleDeviceCommands(aiJson.device_commands, userId);
    }
    
    if (!aiJson.source) aiJson.source = result.hadWebResults ? "web" : "cloud";

    console.log('✅ RÉPONSE GÉNÉRÉE');
    console.log(`📤 Execute: ${aiJson.execute.length}`);
    console.log(`📅 Planning: ${aiJson.planning_commands.length}`);
    console.log(`➕ Device Commands: ${aiJson.device_commands.length}`);
    console.log(`💡 Suggestions: ${aiJson.suggestions.length}`);
    console.log(`📝 Markdown Length: ${aiJson.reply.length} chars`);
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

function jsonErrorDefaults() {
  return { execute: [], planning_commands: [], device_commands: [], suggestions: [], source: "error" };
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
// ✅ GESTION DES COMMANDES D'APPAREILS
// ========================================
async function handleDeviceCommands(commands, userId) {
  if (!db) {
    console.warn("⚠️ Firebase non disponible, impossible d'ajouter des appareils");
    return;
  }

  for (const cmd of commands) {
    if (cmd.action === 'add') {
      try {
        const deviceName = cmd.name || 'Nouvel Appareil';
        const deviceType = cmd.type || 'lamp';
        const deviceRoom = cmd.room || 'Non spécifié';
        
        // Générer un ID unique
        const deviceId = deviceName.toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^\w\-]/g, '')
          .substring(0, 30) + '_' + Date.now().toString().slice(-4);
        
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
        
        // Ajouter à Firebase
        await set(ref(db, `${DEVICES_META_REF}/${deviceId}`), newDevice);
        
        // Initialiser l'état
        await set(ref(db, `${DEVICES_STATES_REF}/${deviceId}`), {
          etat: 'OFF',
          luminosite: 0
        });
        
        console.log(`✅ Appareil ajouté: ${deviceName} (${deviceId})`);
        
      } catch (error) {
        console.error(`❌ Erreur ajout appareil:`, error.message);
      }
    }
  }
}

// ========================================
// ROUTE SANTÉ
// ========================================
app.get('/api/health', async (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  const beninTime = await getBeninTime();
  
  res.json({ 
    status: 'ok', 
    version: '9.4-markdown-planning-devices-temp',
    features: {
      gemini: API_KEYS.length > 0,
      webSearch: true,
      contextMemory: "Firebase",
      firebaseStateSync: true,
      multimodal_Image: true,
      multimodal_Files: true,
      htmlOutput: false,
      markdownOutput: true,
      aiPlanning: true,
      autoAddDevices: true,
      lokossaTemperature: true,
      supportedFiles: "PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, Images"
    },
    keys: { total: API_KEYS.length, available: availableKeys },
    time: {
      benin: `${beninTime.hoursStr}:${beninTime.minutesStr}`,
      formatted: beninTime.formatted,
      temperature: beninTime.temperature
    }
  });
});

// ========================================
// DÉMARRAGE
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════════╗');
  console.log('   ║  INTELLIA v9.4 - ENHANCED AI             ║');
  console.log('   ╚═══════════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🔥 Synchro Firebase (Appareils): Activée`);
  console.log(`   💾 Synchro Firebase (Chats): Activée`);
  console.log(`   📅 Planning AI: Prêt`);
  console.log(`   ➕ Auto Add Devices: Activé`);
  console.log(`   🌡️ Température Lokossa: Temps réel`);
  console.log(`   ✅ Output Markdown: Activé`);
  console.log(`   🔧 Modèle: gemini-2.5-flash\n`);
});