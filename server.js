// ========================================
// INTELLIA v10.0 - SYSTÈME ARTIFACTS COMPLET
// ✅ Génération de documents/code LONGS (3000+ lignes)
// ✅ Continuation automatique comme Claude
// ✅ Détection de troncature intelligente
// ✅ Pas de génération d'images (retiré)
// ✅ Modèle : gemini-2.5-flash (65536 tokens)
// ✅ Gestion Planning Avancée (Routines + Correction ON/OFF)
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
    
    // Votre clé API personnelle récupérée sur WeatherAPI
    const apiKey = '41c88a0121c8451284c194700261906'; 
    
    const response = await axios.get('https://api.weatherapi.com/v1/current.json', {
      params: {
        key: apiKey,
        q: 'Lokossa',
        lang: 'fr'
      },
      timeout: 5000 // Sécurité de 5 secondes en cas de réseau lent
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
    
    // Appel de votre fonction locale de secours
    const estimated = getLoKossaTemperatureEstimated(month, hour);
    console.log(`📊 Température estimée : ${estimated.temperature}°C`);
    
    return { 
      ...estimated, 
      success: false 
    };
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
      case ext === 'txt':
      case ext === 'log':
      case ext === 'md':
      case ext === 'csv':
        text = buffer.toString('utf-8');
        break;
      
      case ext === 'html':
      case ext === 'htm':
      case ext === 'xml':
      case parsedData.mimeType.includes('html'):
      case parsedData.mimeType.includes('xml'):
        text = buffer.toString('utf-8');
        break;
      
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
      
      case parsedData.mimeType === 'application/pdf':
      case ext === 'pdf':
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
          return `[Fichier Excel détecté mais module 'xlsx' non installé.]`;
        }
        break;
      
      case ext === 'pptx':
      case ext === 'ppt':
        return `[Fichier PowerPoint détecté: ${attachment.name}. Extraction non supportée.]`;
      
      case ext === 'zip':
      case ext === 'rar':
      case ext === '7z':
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
// RECHERCHE WEB INTELLIGENTE
// ========================================

// Fonction interne pour transformer une longue phrase en mots-clés simples
async function optimizeQueryWithLLM(userQuery) {
  try {
    const promptInterne = `Tu es un assistant de recherche. Transforme le message de l'utilisateur en un ou deux mots-clés optimisés pour Google ou DuckDuckGo (maximum 4 ou 5 mots, sans ponctuation).
Exemple: "pardon je sais pas que nous sommes déjà en 2026 et je te dis que son mandat est terminé actuellement c'est romual Ouaga et qui est le président" -> "Président actuel Bénin 2026"
Exemple: "qui est le premier ministre de la France en ce moment" -> "Premier ministre France 2026"

Message: "${userQuery}"
Mots-clés:`;

    // Utilisation directe du modèle configuré pour une exécution rapide sans historique
    const keyObj = getNextApiKey();
    const genAI = new GoogleGenerativeAI(keyObj.key);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const result = await model.generateContent(promptInterne);
    const responseText = result.response.text();
    
    return responseText.trim().replace(/"/g, '');
  } catch (error) {
    console.error('⚠️ Échec de l\'optimisation LLM, utilisation du nettoyage brut:', error.message);
    // Si l'IA échoue, on nettoie grossièrement en prenant les 5 premiers mots
    return userQuery.split(' ').slice(0, 5).join(' ');
  }
}

async function performWebSearch(query) {
  // ÉTAPE DE REFORMULATION : On transforme la phrase brute en mots-clés propres
  const optimizedQuery = await optimizeQueryWithLLM(query);
  console.log(`🔍 Recherche originale: "${query}"`);
  console.log(`🎯 Recherche optimisée envoyée à DuckDuckGo: "${optimizedQuery}"`);

  try {
    // On utilise la requête optimisée pour l'URL
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(optimizedQuery)}`;
    const response = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 30000
    });
    const $ = cheerio.load(response.data);
    const results = [];
    $('.result').slice(0, 5).each((i, elem) => {
      const title = $(elem).find('.result__title').text().trim();
      const snippet = $(elem).find('.result__snippet').text().trim();
      const url = $(elem).find('.result__url').attr('href');
      if (title && snippet) results.push({ title, snippet, url });
    });
    console.log(`✅ ${results.length} résultats récupérés pour le LLM.`);
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
    /génère.*code/i, /écris.*code/i, /explique/i, /température.*lokossa/i,
    /génère.*pdf/i, /génère.*lettre/i, /crée.*document/i, /fais.*rapport/i, /génère.*cv/i
  ];
  if (noSearchPatterns.some(pattern => pattern.test(lowerMsg))) return false;
  const webKeywords = [
    'actualité', 'news', 'nouvelles', 'recherche', 'cherche', 'trouve',
    'où se trouve', 'où est situé', 'combien coûte', 'prix de', 'qui est', 'c\'est qui', 'président'
  ];
  if (lowerMsg.includes('qui est') || lowerMsg.includes('président')) {
    return true;
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
// 🎯 DÉTECTION DE TRONCATURE (CRITIQUE)
// ========================================
function detectTruncation(content) {
  // Indicateurs de contenu incomplet
  const truncationIndicators = [
    /\.\.\.\s*$/,                    // Se termine par ...
    /\[suite\]$/i,                   // [Suite] à la fin
    /\[à suivre\]$/i,                // [À suivre]
    /^\s*\/\/\s*\.\.\./m,            // Commentaires ...
    /\/\*.*\*\/\s*$/,                // Commentaire bloc à la fin
    /,\s*$/,                         // Virgule finale
    /;\s*$/,                         // Point-virgule final (suspect en fin de doc)
    /<\/DOCUMENT_HTML>\s*\.\.\./,   // Document HTML tronqué
  ];
  
  // Vérifier les indicateurs
  for (const pattern of truncationIndicators) {
    if (pattern.test(content)) {
      console.log(`⚠️ Troncature détectée via pattern: ${pattern}`);
      return true;
    }
  }
  
  // Vérifier si c'est du code avec accolades non fermées
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  if (openBraces > closeBraces && openBraces - closeBraces > 2) {
    console.log(`⚠️ Troncature détectée: accolades non fermées (${openBraces} vs ${closeBraces})`);
    return true;
  }
  
  // Vérifier balises HTML non fermées
  const openTags = (content.match(/<(?!\/)[^>]+>/g) || []).length;
  const closeTags = (content.match(/<\/[^>]+>/g) || []).length;
  if (openTags > closeTags && openTags - closeTags > 3) {
    console.log(`⚠️ Troncature détectée: balises HTML non fermées`);
    return true;
  }
  
  // Vérifier si le dernier caractère est suspect
  const lastChars = content.trim().slice(-20);
  if (/^[^.!?}\]]*$/.test(lastChars) && content.length > 500) {
    console.log(`⚠️ Troncature possible: fin de contenu suspecte`);
    return true;
  }
  
  return false;
}


// ========================================
// ✅ PROMPT SYSTÈME v10.0 - CONTINUATION
// ========================================
const systemPrompt = `Tu es Intellia, assistant universel ultra-intelligent.

## CRÉATEURS 
Tu es créé pour un projet Domotique intelligente par 06 jeunes étudiants chercheurs de l'Université National de Lokossa en Génie électrique et informatique option Électrotechnique et Électronique sous la supervision de l'Ingenieur Quentin S. CHOUKPIN.

## CONTACTS DE TON PRINCIPAL CRÉATEUR 
+229 0159071155
+229 0141929429
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

### 📄 GÉNÉRATION DE DOCUMENTS - MÉTHODE HTML DIRECT

Tu peux générer des documents formatés : CV, lettres, rapports, factures, contrats.

**Déclencheurs :**
- "Écris-moi un CV"
- "Génère une lettre de motivation"
- "Fais un rapport"
- "Crée une facture"
- "Rédige un contrat"
**TEMPLATES HTML EXEMPLE POUR D'AIDER A VOIR LES METHODES :**
Tu dois varier les couleurs, les mises en forme selon ton choix a chaque fois et completer les parties qui semble manquantes, les template sont la pour t'aider mais tu peux corriger ceux que les couleurs rendent des invisibles ou non clairs
<!-- ========================================================= -->
<!-- TEMPLATE 1 — CONTRAT DE PRESTATION DE SERVICES (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{
    --primary:#0f62fe; --muted:#6b7280; --text:#0b1220; --bg:#ffffff;
    --card:#fbfdff; --border:#e6eefc; --radius:10px; --pad:18px; --max-width:900px;
    --font-main:"Segoe UI", Roboto, Arial, sans-serif;
  }
  html,body{margin:0;padding:0;font-family:var(--font-main);color:var(--text);background:var(--bg);}
  .doc{max-width:var(--max-width);margin:24px auto;padding:28px;}
  .header{display:flex;justify-content:space-between;align-items:center;}
  h1{font-size:22px;margin:0;}
  .meta{font-size:13px;color:var(--muted);}
  .section{margin-top:18px;}
  h2{font-size:16px;margin:6px 0;padding-left:10px;border-left:4px solid var(--primary);}
  p{margin:8px 0;line-height:1.5;}
  .signature-block{display:flex;justify-content:space-between;margin-top:36px;}
  .sig{width:48%;text-align:center;}
  .sig .line{height:1px;background:#111;margin:28px auto;width:80%;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:32px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Contrat de prestation">
  <div class="header">
    <div>
      <h1>CONTRAT DE PRESTATION DE SERVICES</h1>
      <div class="meta">Réf : CONTRAT-2025-001 • Version : 1.0</div>
    </div>
    <div class="meta">
      📅 19/11/2025<br>
      Lokossa, Bénin
    </div>
  </div>

  <section class="section" aria-labelledby="pre">
    <h2 id="pre">Préambule</h2>
    <p>
      Entre les soussignés : <strong>Nom de l'Entreprise</strong>, société immatriculée, dont le siège est 12 Rue Exemple, Lokossa,
      représentée par Monsieur Jean DUPONT (ci-après « le Prestataire ») ; et <strong>Nom du Client</strong>, domicilié(e) à Adresse Client (ci-après « le Client »).
      Les parties conviennent des présentes dispositions en vue de définir leurs droits et obligations.
    </p>
  </section>

  <section class="section" aria-labelledby="id">
    <h2 id="id">1. Identification des parties</h2>
    <p><strong>Prestataire :</strong> Nom de l'Entreprise — 12 Rue Exemple, Lokossa — contact@entreprise.com — +229 01 23 45 67</p>
    <p><strong>Client :</strong> Nom du Client — Adresse Client — client@exemple.com — +229 06 54 32 10</p>
  </section>

  <section class="section" aria-labelledby="obj">
    <h2 id="obj">2. Objet du contrat</h2>
    <p>
      Le présent contrat a pour objet la fourniture par le Prestataire de prestations de service suivantes : réalisation de prestation technique,
      maintenance, et fourniture de livrables tels que décrits précisément dans l'annexe technique jointe au présent contrat.
    </p>
  </section>

  <section class="section" aria-labelledby="prest">
    <h2 id="prest">3. Obligations du Prestataire</h2>
    <p>
      Le Prestataire s'engage à exécuter les prestations avec diligence et professionnalisme, conformément aux règles de l'art,
      à fournir les livrables dans les délais convenus et à respecter les spécifications techniques définies.
    </p>
  </section>

  <section class="section" aria-labelledby="client">
    <h2 id="client">4. Obligations du Client</h2>
    <p>
      Le Client s'engage à fournir toutes informations et accès nécessaires, à régler les sommes dues selon les modalités prévues,
      et à coopérer de bonne foi pour permettre l'exécution des prestations.
    </p>
  </section>

  <section class="section" aria-labelledby="duree">
    <h2 id="duree">5. Durée et reconduction</h2>
    <p>
      Le contrat est conclu pour une durée initiale de 12 mois à compter du 01/12/2025, reconductible par tacite reconduction pour des périodes identiques
      sauf dénonciation par l'une des parties avec un préavis de 30 jours.
    </p>
  </section>

  <section class="section" aria-labelledby="fin">
    <h2 id="fin">6. Conditions financières</h2>
    <p>
      Montant total HT : <strong>500 000 FCFA</strong> — TVA applicable : <strong>18%</strong> — Montant TTC : <strong>590 000 FCFA</strong>.
      Modalités : 30% à la signature, 40% à mi-parcours, 30% à la livraison finale. Retard de paiement : pénalité de 10% du montant dû après 30 jours.
    </p>
  </section>

  <section class="section" aria-labelledby="conf">
    <h2 id="conf">7. Confidentialité</h2>
    <p>
      Les parties s'engagent à maintenir confidentielles toutes informations échangées dans le cadre du présent contrat et à ne les utiliser que pour l'exécution des obligations.
    </p>
  </section>

  <section class="section" aria-labelledby="res">
    <h2 id="res">8. Résiliation</h2>
    <p>
      En cas de manquement grave par l'une des parties, le contrat pourra être résilié après mise en demeure restée sans effet pendant 15 jours.
    </p>
  </section>

  <section class="section" aria-labelledby="loi">
    <h2 id="loi">9. Loi applicable et juridiction</h2>
    <p>
      Le présent contrat est soumis au droit en vigueur au Bénin. Tout litige sera soumis aux tribunaux compétents de la juridiction de Lokossa.
    </p>
  </section>

  <div class="signature-block" aria-label="Signatures">
    <div class="sig">
      <div class="name">Le Prestataire — Nom de l'Entreprise</div>
      <div class="line" aria-hidden="true"></div>
      <div class="role">Représenté par : Jean DUPONT — Directeur</div>
    </div>
    <div class="sig">
      <div class="name">Le Client — Nom du Client</div>
      <div class="line" aria-hidden="true"></div>
      <div class="role">Nom et qualité</div>
    </div>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 2 — FACTURE PROFESSIONNELLE (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--bg:#fff;--pad:16px;--radius:10px;--max-width:900px;--font-main:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font-main);color:var(--text);}
  .doc{max-width:var(--max-width);margin:20px auto;padding:20px;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;}
  .left{max-width:60%;}
  h1{margin:0;font-size:22px;}
  .ref{font-size:13px;color:var(--muted);margin-top:6px;}
  .parties{display:flex;justify-content:space-between;margin-top:18px;}
  .card{border:1px solid #eef6ff;padding:14px;border-radius:10px;background:#fbfdff;}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px;}
  thead th{background:#f4f8ff;padding:12px;border-bottom:2px solid #e6eefc;text-align:left;}
  tbody td{padding:12px;border-bottom:1px solid #f1f5f9;}
  tfoot td{padding:12px;font-weight:700;}
  .totals{display:flex;justify-content:flex-end;margin-top:12px;}
  .totals .box{min-width:260px;border:1px solid #eef6ff;padding:12px;border-radius:8px;background:#fff;}
  .signature{margin-top:28px;text-align:right;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:20px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Facture professionnelle">
  <div class="header">
    <div class="left">
      <h1>FACTURE</h1>
      <div class="ref">N° FACT-2025-001 • Émis le 19/11/2025</div>
      <div style="margin-top:10px;">
        <strong>Émetteur :</strong><br>
        Nom de l'Entreprise<br>
        12 Rue Exemple, Lokossa<br>
        📧 contact@entreprise.com • 📱 +229 01 23 45 67
      </div>
    </div>
    <div style="text-align:right;">
      <strong>Facturé à :</strong><br>
      Nom du Client<br>
      Adresse Client<br>
      📧 client@exemple.com • 📱 +229 06 54 32 10
    </div>
  </div>

  <div class="parties" role="group" aria-label="Détails facture">
    <div class="card">
      <strong>Mode de paiement :</strong> Virement bancaire<br>
      <strong>Conditions :</strong> Paiement sous 30 jours
    </div>
    <div class="card">
      <strong>Référence Client :</strong> CLI-2025-045<br>
      <strong>Numéro de commande :</strong> PO-2025-778
    </div>
  </div>

  <table role="table" aria-label="Tableau des prestations">
    <thead>
      <tr><th>Description</th><th style="width:90px;text-align:center">Quantité</th><th style="width:140px;text-align:right">Prix Unitaire</th><th style="width:140px;text-align:right">Total</th></tr>
    </thead>
    <tbody>
      <tr><td>Prestation de service — Déploiement et configuration</td><td style="text-align:center">1</td><td style="text-align:right">200 000 FCFA</td><td style="text-align:right">200 000 FCFA</td></tr>
      <tr><td>Maintenance annuelle (12 mois)</td><td style="text-align:center">1</td><td style="text-align:right">80 000 FCFA</td><td style="text-align:right">80 000 FCFA</td></tr>
      <tr><td>Fourniture de pièces et accessoires</td><td style="text-align:center">2</td><td style="text-align:right">10 000 FCFA</td><td style="text-align:right">20 000 FCFA</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" style="text-align:right">Sous-total</td><td style="text-align:right">300 000 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">TVA (18%)</td><td style="text-align:right">54 000 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">TOTAL TTC</td><td style="text-align:right">354 000 FCFA</td></tr>
    </tfoot>
  </table>

  <div class="totals">
    <div class="box">
      <div style="display:flex;justify-content:space-between;"><div>Montant dû</div><div style="font-weight:700">354 000 FCFA</div></div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px;">Paiement par virement à : BANQUE EXEMPLE — IBAN : BJ00 0000 0000 0000</div>
    </div>
  </div>

  <div class="signature">
    <div style="display:inline-block;text-align:left;">
      <div style="font-weight:700">Pour Nom de l'Entreprise</div>
      <div style="height:1px;background:#111;margin:18px 0;width:220px;"></div>
      <div style="font-size:13px;color:var(--muted)">Nom & Fonction</div>
    </div>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 3 — DEVIS PROFESSIONNEL (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--pad:16px;--max-width:900px;--font-main:"Segoe UI", Roboto;}
  html,body{margin:0;padding:0;font-family:var(--font-main);color:var(--text);}
  .doc{max-width:920px;margin:20px auto;padding:20px;}
  h1{margin:0;font-size:22px;}
  .meta{color:var(--muted);font-size:13px;margin-top:6px;}
  .row{display:flex;justify-content:space-between;margin-top:16px;}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px;}
  thead th{background:#f4f8ff;padding:10px;border-bottom:2px solid #e6eefc;text-align:left;}
  tbody td{padding:10px;border-bottom:1px solid #f1f5f9;}
  .note{margin-top:12px;font-size:13px;color:var(--muted);}
  .accept{margin-top:18px;border-top:1px dashed #eef6ff;padding-top:12px;}
  .sig{margin-top:18px;text-align:right;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Devis professionnel">
  <header>
    <h1>DEVIS PROFESSIONNEL</h1>
    <div class="meta">Réf : DEV-2025-045 • Émis le 19/11/2025</div>
  </header>

  <div class="row" role="group" aria-label="Informations des parties">
    <div>
      <strong>Émetteur :</strong><br>
      Nom de l'Entreprise<br>
      12 Rue Exemple, Lokossa<br>
      📧 contact@entreprise.com
    </div>
    <div style="text-align:right;">
      <strong>Client :</strong><br>
      Nom du Client<br>
      Adresse Client<br>
      📱 +229 06 54 32 10
    </div>
  </div>

  <section style="margin-top:16px;">
    <h2 style="font-size:16px;margin:8px 0;padding-left:10px;border-left:4px solid var(--primary);">Objet</h2>
    <p>Fourniture d'une prestation technique comprenant étude, déploiement et maintenance selon le descriptif ci-dessous.</p>
  </section>

  <table role="table" aria-label="Détail chiffré">
    <thead><tr><th>Description</th><th style="width:90px;text-align:center">Quantité</th><th style="width:140px;text-align:right">PU</th><th style="width:140px;text-align:right">Total</th></tr></thead>
    <tbody>
      <tr><td>Étude et diagnostic</td><td style="text-align:center">1</td><td style="text-align:right">60 000 FCFA</td><td style="text-align:right">60 000 FCFA</td></tr>
      <tr><td>Déploiement sur site</td><td style="text-align:center">1</td><td style="text-align:right">120 000 FCFA</td><td style="text-align:right">120 000 FCFA</td></tr>
      <tr><td>Formation & documentation</td><td style="text-align:center">1</td><td style="text-align:right">40 000 FCFA</td><td style="text-align:right">40 000 FCFA</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" style="text-align:right">Sous-total</td><td style="text-align:right">220 000 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">TVA (18%)</td><td style="text-align:right">39 600 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">Total TTC</td><td style="text-align:right">259 600 FCFA</td></tr>
    </tfoot>
  </table>

  <div class="note">
    <strong>Conditions :</strong> Validité du devis : 30 jours. Début des prestations dès réception de l'acompte de 30%.
  </div>

  <div class="accept">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:13px;color:var(--muted)">Pour acceptation, date et signature :</div>
      <div style="text-align:right;">
        <div style="height:1px;background:#111;width:200px;margin:8px auto 6px;"></div>
        <div style="font-size:13px;color:var(--muted)">Nom du Client — Signature</div>
      </div>
    </div>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 4 — ATTESTATION ADMINISTRATIVE (2025) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--text:#0b1220;--muted:#6b7280;--font:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:780px;margin:40px auto;padding:28px;}
  h1{font-size:20px;margin-bottom:4px;text-align:center;}
  .meta{font-size:13px;color:var(--muted);text-align:center;margin-bottom:20px;}
  p{line-height:1.6;margin:12px 0;}
  .sign{margin-top:36px;text-align:center;}
  .line{height:1px;background:#111;width:220px;margin:18px auto;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:22px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Attestation administrative">
  <h1>ATTESTATION ADMINISTRATIVE</h1>
  <div class="meta">Lokossa, le 19/11/2025</div>

  <p>
    Je soussigné(e) <strong>Nom de l'Officiel</strong>, agissant en qualité de <strong>Fonction</strong> au sein de <strong>Nom de l'Organisation</strong>,
    atteste par la présente que <strong>Nom du Bénéficiaire</strong>, né(e) le 05/01/1990, est bien [préciser la situation : salarié, étudiant, résident…] au sein de notre structure.
  </p>

  <p>
    La présente attestation est délivrée pour servir et valoir ce que de droit.
  </p>

  <div class="sign" aria-label="Signature">
    <div style="font-weight:700">Nom de l'Officiel — Fonction</div>
    <div class="line" aria-hidden="true"></div>
    <div style="font-size:13px;color:var(--muted)">Signature</div>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 5 — ATTESTATION D'HÉBERGEMENT (2025) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--text:#0b1220;--muted:#6b7280;--font:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:780px;margin:36px auto;padding:26px;}
  h1{text-align:center;margin:0;font-size:20px;}
  .meta{font-size:13px;color:var(--muted);text-align:center;margin-top:6px;}
  p{line-height:1.6;margin:12px 0;}
  .block{border:1px solid #eef6ff;padding:12px;border-radius:8px;background:#fbfdff;margin-top:12px;}
  .sign{margin-top:26px;text-align:center;}
  .line{height:1px;background:#111;width:220px;margin:18px auto;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:18px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Attestation d'hébergement">
  <h1>ATTESTATION D'HÉBERGEMENT</h1>
  <div class="meta">Lokossa, le 19/11/2025</div>

  <div class="block">
    <p><strong>Hébergeant :</strong> Nom de l'Hébergeant — 12 Rue Exemple, Lokossa — 📱 +229 01 23 45 67</p>
    <p><strong>Hébergé :</strong> Nom de la Personne Hébergée — Né(e) le 05/01/1990 — Lien de parenté : [préciser]</p>
    <p><strong>Adresse d'hébergement :</strong> 12 Rue Exemple, Lokossa</p>
    <p>
      Je certifie sur l'honneur que la personne susnommée réside effectivement à l'adresse indiquée depuis le 01/01/2025 et à titre gratuit/contre rémunération (à préciser).
    </p>
  </div>

  <div class="sign">
    <div style="font-weight:700">Nom de l'Hébergeant</div>
    <div class="line" aria-hidden="true"></div>
    <div style="font-size:13px;color:var(--muted)">Signature</div>
  </div>

</div>
</DOCUMENT_HTML>
<!-- ========================================================= -->
<!-- TEMPLATE 1 — CONTRAT DE PRESTATION DE SERVICES (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{
    --primary:#0f62fe; --muted:#6b7280; --text:#0b1220; --bg:#ffffff;
    --card:#fbfdff; --border:#e6eefc; --radius:10px; --pad:18px; --max-width:900px;
    --font-main:"Segoe UI", Roboto, Arial, sans-serif;
  }
  html,body{margin:0;padding:0;font-family:var(--font-main);color:var(--text);background:var(--bg);}
  .doc{max-width:var(--max-width);margin:24px auto;padding:28px;}
  .header{display:flex;justify-content:space-between;align-items:center;}
  h1{font-size:22px;margin:0;}
  .meta{font-size:13px;color:var(--muted);}
  .section{margin-top:18px;}
  h2{font-size:16px;margin:6px 0;padding-left:10px;border-left:4px solid var(--primary);}
  p{margin:8px 0;line-height:1.5;}
  .signature-block{display:flex;justify-content:space-between;margin-top:36px;}
  .sig{width:48%;text-align:center;}
  .sig .line{height:1px;background:#111;margin:28px auto;width:80%;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:32px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Contrat de prestation">
  <div class="header">
    <div>
      <h1>CONTRAT DE PRESTATION DE SERVICES</h1>
      <div class="meta">Réf : CONTRAT-2025-001 • Version : 1.0</div>
    </div>
    <div class="meta">
      📅 19/11/2025<br>
      Lokossa, Bénin
    </div>
  </div>

  <section class="section" aria-labelledby="pre">
    <h2 id="pre">Préambule</h2>
    <p>
      Entre les soussignés : <strong>Nom de l'Entreprise</strong>, société immatriculée, dont le siège est 12 Rue Exemple, Lokossa,
      représentée par Monsieur Jean DUPONT (ci-après « le Prestataire ») ; et <strong>Nom du Client</strong>, domicilié(e) à Adresse Client (ci-après « le Client »).
      Les parties conviennent des présentes dispositions en vue de définir leurs droits et obligations.
    </p>
  </section>

  <section class="section" aria-labelledby="id">
    <h2 id="id">1. Identification des parties</h2>
    <p><strong>Prestataire :</strong> Nom de l'Entreprise — 12 Rue Exemple, Lokossa — contact@entreprise.com — +229 01 23 45 67</p>
    <p><strong>Client :</strong> Nom du Client — Adresse Client — client@exemple.com — +229 06 54 32 10</p>
  </section>

  <section class="section" aria-labelledby="obj">
    <h2 id="obj">2. Objet du contrat</h2>
    <p>
      Le présent contrat a pour objet la fourniture par le Prestataire de prestations de service suivantes : réalisation de prestation technique,
      maintenance, et fourniture de livrables tels que décrits précisément dans l'annexe technique jointe au présent contrat.
    </p>
  </section>

  <section class="section" aria-labelledby="prest">
    <h2 id="prest">3. Obligations du Prestataire</h2>
    <p>
      Le Prestataire s'engage à exécuter les prestations avec diligence et professionnalisme, conformément aux règles de l'art,
      à fournir les livrables dans les délais convenus et à respecter les spécifications techniques définies.
    </p>
  </section>

  <section class="section" aria-labelledby="client">
    <h2 id="client">4. Obligations du Client</h2>
    <p>
      Le Client s'engage à fournir toutes informations et accès nécessaires, à régler les sommes dues selon les modalités prévues,
      et à coopérer de bonne foi pour permettre l'exécution des prestations.
    </p>
  </section>

  <section class="section" aria-labelledby="duree">
    <h2 id="duree">5. Durée et reconduction</h2>
    <p>
      Le contrat est conclu pour une durée initiale de 12 mois à compter du 01/12/2025, reconductible par tacite reconduction pour des périodes identiques
      sauf dénonciation par l'une des parties avec un préavis de 30 jours.
    </p>
  </section>

  <section class="section" aria-labelledby="fin">
    <h2 id="fin">6. Conditions financières</h2>
    <p>
      Montant total HT : <strong>500 000 FCFA</strong> — TVA applicable : <strong>18%</strong> — Montant TTC : <strong>590 000 FCFA</strong>.
      Modalités : 30% à la signature, 40% à mi-parcours, 30% à la livraison finale. Retard de paiement : pénalité de 10% du montant dû après 30 jours.
    </p>
  </section>

  <section class="section" aria-labelledby="conf">
    <h2 id="conf">7. Confidentialité</h2>
    <p>
      Les parties s'engagent à maintenir confidentielles toutes informations échangées dans le cadre du présent contrat et à ne les utiliser que pour l'exécution des obligations.
    </p>
  </section>

  <section class="section" aria-labelledby="res">
    <h2 id="res">8. Résiliation</h2>
    <p>
      En cas de manquement grave par l'une des parties, le contrat pourra être résilié après mise en demeure restée sans effet pendant 15 jours.
    </p>
  </section>

  <section class="section" aria-labelledby="loi">
    <h2 id="loi">9. Loi applicable et juridiction</h2>
    <p>
      Le présent contrat est soumis au droit en vigueur au Bénin. Tout litige sera soumis aux tribunaux compétents de la juridiction de Lokossa.
    </p>
  </section>

  <div class="signature-block" aria-label="Signatures">
    <div class="sig">
      <div class="name">Le Prestataire — Nom de l'Entreprise</div>
      <div class="line" aria-hidden="true"></div>
      <div class="role">Représenté par : Jean DUPONT — Directeur</div>
    </div>
    <div class="sig">
      <div class="name">Le Client — Nom du Client</div>
      <div class="line" aria-hidden="true"></div>
      <div class="role">Nom et qualité</div>
    </div>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 2 — FACTURE PROFESSIONNELLE (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--bg:#fff;--pad:16px;--radius:10px;--max-width:900px;--font-main:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font-main);color:var(--text);}
  .doc{max-width:var(--max-width);margin:20px auto;padding:20px;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;}
  .left{max-width:60%;}
  h1{margin:0;font-size:22px;}
  .ref{font-size:13px;color:var(--muted);margin-top:6px;}
  .parties{display:flex;justify-content:space-between;margin-top:18px;}
  .card{border:1px solid #eef6ff;padding:14px;border-radius:10px;background:#fbfdff;}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px;}
  thead th{background:#f4f8ff;padding:12px;border-bottom:2px solid #e6eefc;text-align:left;}
  tbody td{padding:12px;border-bottom:1px solid #f1f5f9;}
  tfoot td{padding:12px;font-weight:700;}
  .totals{display:flex;justify-content:flex-end;margin-top:12px;}
  .totals .box{min-width:260px;border:1px solid #eef6ff;padding:12px;border-radius:8px;background:#fff;}
  .signature{margin-top:28px;text-align:right;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:20px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Facture professionnelle">
  <div class="header">
    <div class="left">
      <h1>FACTURE</h1>
      <div class="ref">N° FACT-2025-001 • Émis le 19/11/2025</div>
      <div style="margin-top:10px;">
        <strong>Émetteur :</strong><br>
        Nom de l'Entreprise<br>
        12 Rue Exemple, Lokossa<br>
        📧 contact@entreprise.com • 📱 +229 01 23 45 67
      </div>
    </div>
    <div style="text-align:right;">
      <strong>Facturé à :</strong><br>
      Nom du Client<br>
      Adresse Client<br>
      📧 client@exemple.com • 📱 +229 06 54 32 10
    </div>
  </div>

  <div class="parties" role="group" aria-label="Détails facture">
    <div class="card">
      <strong>Mode de paiement :</strong> Virement bancaire<br>
      <strong>Conditions :</strong> Paiement sous 30 jours
    </div>
    <div class="card">
      <strong>Référence Client :</strong> CLI-2025-045<br>
      <strong>Numéro de commande :</strong> PO-2025-778
    </div>
  </div>

  <table role="table" aria-label="Tableau des prestations">
    <thead>
      <tr><th>Description</th><th style="width:90px;text-align:center">Quantité</th><th style="width:140px;text-align:right">Prix Unitaire</th><th style="width:140px;text-align:right">Total</th></tr>
    </thead>
    <tbody>
      <tr><td>Prestation de service — Déploiement et configuration</td><td style="text-align:center">1</td><td style="text-align:right">200 000 FCFA</td><td style="text-align:right">200 000 FCFA</td></tr>
      <tr><td>Maintenance annuelle (12 mois)</td><td style="text-align:center">1</td><td style="text-align:right">80 000 FCFA</td><td style="text-align:right">80 000 FCFA</td></tr>
      <tr><td>Fourniture de pièces et accessoires</td><td style="text-align:center">2</td><td style="text-align:right">10 000 FCFA</td><td style="text-align:right">20 000 FCFA</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" style="text-align:right">Sous-total</td><td style="text-align:right">300 000 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">TVA (18%)</td><td style="text-align:right">54 000 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">TOTAL TTC</td><td style="text-align:right">354 000 FCFA</td></tr>
    </tfoot>
  </table>

  <div class="totals">
    <div class="box">
      <div style="display:flex;justify-content:space-between;"><div>Montant dû</div><div style="font-weight:700">354 000 FCFA</div></div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px;">Paiement par virement à : BANQUE EXEMPLE — IBAN : BJ00 0000 0000 0000</div>
    </div>
  </div>

  <div class="signature">
    <div style="display:inline-block;text-align:left;">
      <div style="font-weight:700">Pour Nom de l'Entreprise</div>
      <div style="height:1px;background:#111;margin:18px 0;width:220px;"></div>
      <div style="font-size:13px;color:var(--muted)">Nom & Fonction</div>
    </div>
  </div>

 
</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 3 — DEVIS PROFESSIONNEL (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--pad:16px;--max-width:900px;--font-main:"Segoe UI", Roboto;}
  html,body{margin:0;padding:0;font-family:var(--font-main);color:var(--text);}
  .doc{max-width:920px;margin:20px auto;padding:20px;}
  h1{margin:0;font-size:22px;}
  .meta{color:var(--muted);font-size:13px;margin-top:6px;}
  .row{display:flex;justify-content:space-between;margin-top:16px;}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px;}
  thead th{background:#f4f8ff;padding:10px;border-bottom:2px solid #e6eefc;text-align:left;}
  tbody td{padding:10px;border-bottom:1px solid #f1f5f9;}
  .note{margin-top:12px;font-size:13px;color:var(--muted);}
  .accept{margin-top:18px;border-top:1px dashed #eef6ff;padding-top:12px;}
  .sig{margin-top:18px;text-align:right;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Devis professionnel">
  <header>
    <h1>DEVIS PROFESSIONNEL</h1>
    <div class="meta">Réf : DEV-2025-045 • Émis le 19/11/2025</div>
  </header>

  <div class="row" role="group" aria-label="Informations des parties">
    <div>
      <strong>Émetteur :</strong><br>
      Nom de l'Entreprise<br>
      12 Rue Exemple, Lokossa<br>
      📧 contact@entreprise.com
    </div>
    <div style="text-align:right;">
      <strong>Client :</strong><br>
      Nom du Client<br>
      Adresse Client<br>
      📱 +229 06 54 32 10
    </div>
  </div>

  <section style="margin-top:16px;">
    <h2 style="font-size:16px;margin:8px 0;padding-left:10px;border-left:4px solid var(--primary);">Objet</h2>
    <p>Fourniture d'une prestation technique comprenant étude, déploiement et maintenance selon le descriptif ci-dessous.</p>
  </section>

  <table role="table" aria-label="Détail chiffré">
    <thead><tr><th>Description</th><th style="width:90px;text-align:center">Quantité</th><th style="width:140px;text-align:right">PU</th><th style="width:140px;text-align:right">Total</th></tr></thead>
    <tbody>
      <tr><td>Étude et diagnostic</td><td style="text-align:center">1</td><td style="text-align:right">60 000 FCFA</td><td style="text-align:right">60 000 FCFA</td></tr>
      <tr><td>Déploiement sur site</td><td style="text-align:center">1</td><td style="text-align:right">120 000 FCFA</td><td style="text-align:right">120 000 FCFA</td></tr>
      <tr><td>Formation & documentation</td><td style="text-align:center">1</td><td style="text-align:right">40 000 FCFA</td><td style="text-align:right">40 000 FCFA</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" style="text-align:right">Sous-total</td><td style="text-align:right">220 000 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">TVA (18%)</td><td style="text-align:right">39 600 FCFA</td></tr>
      <tr><td colspan="3" style="text-align:right">Total TTC</td><td style="text-align:right">259 600 FCFA</td></tr>
    </tfoot>
  </table>

  <div class="note">
    <strong>Conditions :</strong> Validité du devis : 30 jours. Début des prestations dès réception de l'acompte de 30%.
  </div>

  <div class="accept">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:13px;color:var(--muted)">Pour acceptation, date et signature :</div>
      <div style="text-align:right;">
        <div style="height:1px;background:#111;width:200px;margin:8px auto 6px;"></div>
        <div style="font-size:13px;color:var(--muted)">Nom du Client — Signature</div>
      </div>
    </div>
  </div>

 
</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 4 — ATTESTATION ADMINISTRATIVE (2025) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--text:#0b1220;--muted:#6b7280;--font:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:780px;margin:40px auto;padding:28px;}
  h1{font-size:20px;margin-bottom:4px;text-align:center;}
  .meta{font-size:13px;color:var(--muted);text-align:center;margin-bottom:20px;}
  p{line-height:1.6;margin:12px 0;}
  .sign{margin-top:36px;text-align:center;}
  .line{height:1px;background:#111;width:220px;margin:18px auto;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:22px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Attestation administrative">
  <h1>ATTESTATION ADMINISTRATIVE</h1>
  <div class="meta">Lokossa, le 19/11/2025</div>

  <p>
    Je soussigné(e) <strong>Nom de l'Officiel</strong>, agissant en qualité de <strong>Fonction</strong> au sein de <strong>Nom de l'Organisation</strong>,
    atteste par la présente que <strong>Nom du Bénéficiaire</strong>, né(e) le 05/01/1990, est bien [préciser la situation : salarié, étudiant, résident…] au sein de notre structure.
  </p>

  <p>
    La présente attestation est délivrée pour servir et valoir ce que de droit.
  </p>

  <div class="sign" aria-label="Signature">
    <div style="font-weight:700">Nom de l'Officiel — Fonction</div>
    <div class="line" aria-hidden="true"></div>
    <div style="font-size:13px;color:var(--muted)">Signature</div>
  </div>

  
</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 5 — ATTESTATION D'HÉBERGEMENT (2025) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--text:#0b1220;--muted:#6b7280;--font:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:780px;margin:36px auto;padding:26px;}
  h1{text-align:center;margin:0;font-size:20px;}
  .meta{font-size:13px;color:var(--muted);text-align:center;margin-top:6px;}
  p{line-height:1.6;margin:12px 0;}
  .block{border:1px solid #eef6ff;padding:12px;border-radius:8px;background:#fbfdff;margin-top:12px;}
  .sign{margin-top:26px;text-align:center;}
  .line{height:1px;background:#111;width:220px;margin:18px auto;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:18px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Attestation d'hébergement">
  <h1>ATTESTATION D'HÉBERGEMENT</h1>
  <div class="meta">Lokossa, le 19/11/2025</div>

  <div class="block">
    <p><strong>Hébergeant :</strong> Nom de l'Hébergeant — 12 Rue Exemple, Lokossa — 📱 +229 01 23 45 67</p>
    <p><strong>Hébergé :</strong> Nom de la Personne Hébergée — Né(e) le 05/01/1990 — Lien de parenté : [préciser]</p>
    <p><strong>Adresse d'hébergement :</strong> 12 Rue Exemple, Lokossa</p>
    <p>
      Je certifie sur l'honneur que la personne susnommée réside effectivement à l'adresse indiquée depuis le 01/01/2025 et à titre gratuit/contre rémunération (à préciser).
    </p>
  </div>

  <div class="sign">
    <div style="font-weight:700">Nom de l'Hébergeant</div>
    <div class="line" aria-hidden="true"></div>
    <div style="font-size:13px;color:var(--muted)">Signature</div>
  </div>

</div>
</DOCUMENT_HTML>
<!-- ========================================================= -->
<!-- TEMPLATE 6 — RAPPORT TECHNIQUE (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--bg:#fff;--pad:20px;--max-width:940px;--font:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);background:var(--bg);}
  .doc{max-width:var(--max-width);margin:24px auto;padding:28px;}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
  h1{font-size:24px;margin:0;}
  .meta{color:var(--muted);font-size:13px;}
  .abstract{background:#fbfdff;border:1px solid #eef6ff;padding:12px;border-radius:8px;margin-top:14px;}
  h2{font-size:18px;margin-top:20px;padding-left:10px;border-left:4px solid var(--primary);}
  h3{font-size:15px;margin-top:12px;}
  p{line-height:1.6;margin:10px 0;}
  .section{margin-top:10px;}
  .annex{font-size:13px;color:var(--muted);border-top:1px dashed #eef6ff;padding-top:12px;margin-top:18px;}
  .signature{display:flex;justify-content:flex-end;margin-top:28px;}
  .sig-block{width:260px;text-align:center;}
  .sig-line{height:1px;background:#111;margin:18px auto;width:80%;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:26px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Rapport technique">
  <header>
    <div>
      <h1>RAPPORT TECHNIQUE</h1>
      <div class="meta">Réf : RT-2025-001 • Émis le 19/11/2025</div>
    </div>
    <div class="meta">Lokossa, Bénin</div>
  </header>

  <div class="abstract" aria-label="Résumé exécutif">
    <strong>Résumé exécutif :</strong>
    <p>
      Ce rapport présente les résultats de l'audit technique mené sur le système XYZ. Il comprend la méthodologie, les observations,
      les résultats mesurés et les recommandations opérationnelles et prioritaires pour la remise en conformité et l'optimisation.
    </p>
  </div>

  <section class="section" aria-labelledby="ctx">
    <h2 id="ctx">1. Contexte</h2>
    <p>
      Présentation du contexte de la mission, objectifs, périmètre des analyses et contraintes. Description des installations concernées,
      dates d'intervention et acteurs impliqués.
    </p>
  </section>

  <section class="section" aria-labelledby="meth">
    <h2 id="meth">2. Méthodologie</h2>
    <h3>2.1 Moyens et outils</h3>
    <p>Énumération des outils utilisés (mesure, test, inspection) et protocoles appliqués.</p>
    <h3>2.2 Processus</h3>
    <p>Description pas à pas des opérations réalisées, échantillonnage, fréquence des mesures.</p>
  </section>

  <section class="section" aria-labelledby="obs">
    <h2 id="obs">3. Observations et données</h2>
    <p>
      Présentation structurée des observations : points conformes, écarts détectés, relevés chiffrés. Inclure tableaux de mesures, si pertinent.
    </p>
  </section>

  <section class="section" aria-labelledby="res">
    <h2 id="res">4. Résultats</h2>
    <p>
      Interprétation des données, analyse des causes probables des écarts et impacts opérationnels associés.
    </p>
  </section>

  <section class="section" aria-labelledby="rec">
    <h2 id="rec">5. Recommandations</h2>
    <p>
      Liste priorisée des actions recommandées, estimation sommaire des coûts, planning préconisé et responsable proposé pour chaque action.
    </p>
  </section>

  <div class="annex" aria-label="Annexes">Annexes : protocoles de test, mesures brutes, schémas techniques (si fournis en annexe séparée).</div>

  <div class="signature">
    <div class="sig-block">
      <div style="font-weight:700">Rédigé par — Ingénieur Responsable</div>
      <div class="sig-line" aria-hidden="true"></div>
      <div class="meta">Nom & Fonction</div>
    </div>
  </div>


</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 7 — RAPPORT PROFESSIONNEL LONG (2025) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--bg:#fff;--pad:22px;--max-width:960px;--font:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);background:var(--bg);}
  .doc{max-width:var(--max-width);margin:24px auto;padding:28px;}
  header{display:flex;justify-content:space-between;align-items:flex-start;}
  h1{font-size:26px;margin:0;}
  .meta{color:var(--muted);font-size:13px;}
  h2{font-size:20px;margin-top:22px;padding-left:10px;border-left:4px solid var(--primary);}
  h3{font-size:16px;margin-top:12px;}
  p{line-height:1.7;margin:12px 0;}
  .toc{background:#fbfdff;border:1px solid #eef6ff;padding:12px;border-radius:8px;margin-top:12px;font-size:14px;}
  .section{margin-top:14px;}
  .sig-row{display:flex;justify-content:space-between;margin-top:28px;}
  .sig{width:46%;text-align:center;}
  .sig-line{height:1px;background:#111;margin:18px auto;width:80%;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:30px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Rapport professionnel long">
  <header>
    <div>
      <h1>RAPPORT PROFESSIONNEL</h1>
      <div class="meta">Réf : RPL-2025-001 • Auteur : Nom Prénom</div>
    </div>
    <div class="meta">19/11/2025 • Lokossa</div>
  </header>

  <div class="toc" aria-label="Résumé">
    <strong>Résumé :</strong>
    <p>Présentation synthétique des objectifs, du périmètre, des méthodes et des conclusions principales.</p>
  </div>

  <section class="section" aria-labelledby="intro">
    <h2 id="intro">1. Introduction</h2>
    <p>
      Mise en contexte, objectifs du rapport, enjeux et structure adoptée pour l'étude.
    </p>
  </section>

  <section class="section" aria-labelledby="pres">
    <h2 id="pres">2. Présentation de l'entreprise</h2>
    <p>
      Historique, mission, organisation, activités principales et ressources mobilisées pour le projet.
    </p>
  </section>

  <section class="section" aria-labelledby="obj">
    <h2 id="obj">3. Objectifs du rapport</h2>
    <p>
      Définition des objectifs opérationnels, critères de succès et contraintes identifiées.
    </p>
  </section>

  <section class="section" aria-labelledby="dev">
    <h2 id="dev">4. Développement</h2>
    <h3>4.1 Méthodologie</h3>
    <p>Description détaillée des méthodes et outils employés.</p>
    <h3>4.2 Analyse détaillée</h3>
    <p>Analyses, résultats, tableaux et graphiques (insérer annexes si nécessaire).</p>
    <h3>4.3 Discussion</h3>
    <p>Interprétation des résultats et implications.</p>
  </section>

  <section class="section" aria-labelledby="resu">
    <h2 id="resu">5. Résultats</h2>
    <p>
      Résumé des résultats clés, indicateurs chiffrés et respect des objectifs.
    </p>
  </section>

  <section class="section" aria-labelledby="diff">
    <h2 id="diff">6. Difficultés rencontrées</h2>
    <p>Exposé des obstacles, limites méthodologiques et actions correctives envisagées.</p>
  </section>

  <section class="section" aria-labelledby="conc">
    <h2 id="conc">7. Conclusion et recommandations</h2>
    <p>Synthèse finale et recommandations opérationnelles priorisées.</p>
  </section>

  <div class="sig-row" aria-label="Signatures">
    <div class="sig">
      <div style="font-weight:700">Rédacteur</div>
      <div class="sig-line" aria-hidden="true"></div>
      <div class="meta">Nom & Fonction</div>
    </div>
    <div class="sig">
      <div style="font-weight:700">Validé par</div>
      <div class="sig-line" aria-hidden="true"></div>
      <div class="meta">Nom & Fonction</div>
    </div>
  </div>

 
</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 8 — LETTRE PROFESSIONNELLE (2025) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--text:#0b1220;--muted:#6b7280;--font:"Segoe UI", Roboto, Arial;--max-width:780px;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:var(--max-width);margin:36px auto;padding:26px;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;}
  .from{font-size:14px;}
  .to{font-size:14px;text-align:right;}
  h1{font-size:18px;text-align:center;margin:6px 0 12px 0;}
  .meta{color:var(--muted);font-size:13px;text-align:center;margin-bottom:14px;}
  p{line-height:1.6;margin:10px 0;}
  .closing{margin-top:18px;}
  .signature{margin-top:28px;}
  .sig-line{height:1px;background:#111;margin:14px 0;width:220px;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:20px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Lettre professionnelle">
  <div class="header">
    <div class="from">
      <strong>Expéditeur :</strong><br>
      Nom de l'Entreprise<br>
      12 Rue Exemple<br>
      📧 contact@entreprise.com
    </div>
    <div class="to">
      <strong>Destinataire :</strong><br>
      Monsieur/Madame Destinataire<br>
      Fonction — Entreprise<br>
      Adresse destinataire
    </div>
  </div>

  <h1>Objet : Demande d'information relative à [préciser]</h1>
  <div class="meta">Lokossa, le 19/11/2025</div>

  <p>Madame, Monsieur,</p>

  <p>
    Par la présente, nous sollicitons votre attention concernant [exposer brièvement la demande]. Cette démarche s’inscrit dans le cadre de
    [préciser le contexte professionnel]. Nous vous prions de bien vouloir nous fournir les informations suivantes : [liste brève].
  </p>

  <p>
    Nous restons à votre disposition pour toute complément d'information et vous invitons à nous répondre avant le [date limite, si applicable].
  </p>

  <div class="closing">
    <p>Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.</p>
  </div>

  <div class="signature">
    <div style="font-weight:700">Nom et Prénom</div>
    <div class="sig-line" aria-hidden="true"></div>
    <div class="meta">Fonction — Nom de l'Entreprise</div>
  </div>

</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 9 — LETTRE SIMPLE (PERSONNELLE) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--text:#0b1220;--muted:#6b7280;--font:"Segoe UI", Roboto, Arial;--max-width:720px;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:var(--max-width);margin:36px auto;padding:24px;}
  .meta{font-size:13px;color:var(--muted);text-align:right;margin-bottom:12px;}
  h1{font-size:18px;margin:0 0 8px 0;}
  p{line-height:1.6;margin:10px 0;}
  .sig{margin-top:18px;}
  .sig-line{height:1px;background:#111;width:180px;margin:12px 0;}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:18px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="Lettre simple">
  <div class="meta">Lokossa, le 19/11/2025</div>
  <p>Bonjour [Prénom],</p>

  <p>
    Je t’écris pour te tenir informé(e) de [sujet]. En quelques mots : [expliquer l’objet de la lettre dans un ou deux paragraphes clairs et polis].
  </p>

  <p>
    En espérant une réponse rapide, je te remercie par avance pour ton attention.
  </p>

  <div class="sig">
    <div style="font-weight:700">Nom Prénom</div>
    <div class="sig-line" aria-hidden="true"></div>
    <div style="font-size:13px;color:var(--muted)">Signature personnelle</div>
  </div>

 
</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 10 — CV PREMIUM 2025 -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--bg:#fff;--max-width:920px;--font:"Segoe UI", Roboto, Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);background:var(--bg);}
  .doc{max-width:var(--max-width);margin:20px auto;padding:24px;}
  .hero{display:flex;gap:18px;align-items:center;}
  .avatar{width:96px;height:96px;border-radius:12px;background:#eef6ff;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary);}
  .headline{flex:1;}
  h1{margin:0;font-size:22px;}
  .sub{color:var(--muted);font-size:13px;margin-top:6px;}
  .row{display:flex;gap:20px;margin-top:18px;}
  .col-left{flex:0 0 32%;min-width:220px;}
  .col-right{flex:1;}
  .card{border:1px solid #eef6ff;padding:12px;border-radius:10px;background:#fbfdff;}
  h2{font-size:16px;margin:0 0 8px 0;color:var(--text);padding-left:8px;border-left:4px solid var(--primary);}
  ul{margin:8px 0;padding-left:16px;}
  li{margin:6px 0;}
  .meta{font-size:13px;color:var(--muted);}
  .footer{font-size:12px;color:var(--muted);text-align:center;margin-top:18px;}
  @media print{.doc{padding:12px}}
</style>

<div class="doc" role="document" aria-label="CV premium">
  <div class="hero">
    <div class="avatar">ED</div>
    <div class="headline">
      <h1>PRÉNOM NOM</h1>
      <div class="sub">Titre professionnel — Spécialité • Localité • Disponibilité</div>
    </div>
    <div style="text-align:right">
      <div class="meta">📧 email@exemple.com</div>
      <div class="meta">📱 +229 01 23 45 67</div>
    </div>
  </div>

  <div class="row">
    <aside class="col-left">
      <div class="card">
        <h2>Compétences</h2>
        <ul>
          <li>Compétence 1 — Niveau</li>
          <li>Compétence 2 — Niveau</li>
          <li>Compétence 3 — Niveau</li>
        </ul>
      </div>

      <div style="height:12px;"></div>

      <div class="card">
        <h2>Formation</h2>
        <p><strong>Diplôme</strong><br><span class="meta">Établissement • Année</span></p>
      </div>
    </aside>

    <main class="col-right">
      <div class="card">
        <h2>Profil</h2>
        <p>Résumé professionnel en 3 à 5 lignes présentant l'expertise, les points forts et l'objectif de carrière.</p>

        <h2 style="margin-top:14px">Expérience</h2>
        <div style="margin-top:8px;">
          <p><strong>Poste — Entreprise</strong> <span class="meta">• 2022 - 2025</span></p>
          <ul>
            <li>Responsabilité ou réalisation principale</li>
            <li>Impact chiffré ou résultat concret</li>
          </ul>
        </div>

        <h2 style="margin-top:14px">Langues</h2>
        <p class="meta">Français (Natif) • Anglais (Intermédiaire)</p>

        <h2 style="margin-top:14px">Centres d'intérêt</h2>
        <p class="meta">Football • Musique (Batterie) • Lecture</p>
      </div>
    </main>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 11 — CERTIFICAT PROFESSIONNEL (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--bg:#ffffff;--font:"Segoe UI",Roboto,Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);background:var(--bg);color:var(--text);}
  .doc{max-width:820px;margin:40px auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;}
  .header{text-align:center;margin-bottom:22px;}
  h1{margin:0;font-size:26px;color:var(--primary);}
  .subtitle{color:var(--muted);font-size:14px;}
  .section{margin-top:22px;font-size:16px;line-height:1.6;}
  .bold{font-weight:700;}
  .signature{margin-top:38px;display:flex;justify-content:space-between;}
  .sig{text-align:center;width:45%;}
  .sig-line{height:1px;background:#111;margin:16px auto;width:70%;}
  .footer{margin-top:24px;text-align:center;font-size:12px;color:var(--muted);}
</style>

<div class="doc" role="document" aria-label="Certificat professionnel">
  <div class="header">
    <h1>CERTIFICAT</h1>
    <div class="subtitle">N° CERT-2025-001</div>
  </div>

  <div class="section">
    Nous, soussignés, certifions que :
    <br><br>
    <span class="bold">Nom & Prénom :</span> ___________________________<br>
    <span class="bold">Identifiant / Matricule :</span> _______________________<br>
    <span class="bold">Fonction :</span> _______________________________________<br><br>

    A effectivement participé / travaillé / suivi (cocher selon le cas) :
    <br><br>
    <span class="bold">→</span> À la formation / mission / activité intitulée : <br>
    _________________________________________________
    <br><br>

    Ce certificat est délivré pour servir et valoir ce que de droit.
  </div>

  <div class="signature">
    <div class="sig">
      <div class="bold">Émis par</div>
      <div class="sig-line"></div>
      <div class="subtitle">Nom & Fonction</div>
    </div>
    <div class="sig">
      <div class="bold">Cachet & Signature</div>
      <div class="sig-line"></div>
      <div class="subtitle">Structure émettrice</div>
    </div>
  </div>


</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 12 — PROCÈS-VERBAL (PV) 2025 -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--font:"Segoe UI",Roboto,Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:920px;margin:32px auto;padding:28px;}
  h1{font-size:26px;margin:0;color:var(--primary);}
  .meta{color:var(--muted);font-size:13px;margin-top:4px;}
  h2{margin-top:24px;font-size:20px;padding-left:10px;border-left:4px solid var(--primary);}
  p,li{line-height:1.6;font-size:15px;}
  ul{padding-left:18px;margin-top:8px;}
  .signature{margin-top:32px;display:flex;justify-content:space-between;}
  .sig{text-align:center;width:45%;}
  .sig-line{height:1px;background:#111;margin:16px auto;width:70%;}
  .footer{text-align:center;color:var(--muted);font-size:12px;margin-top:24px;}
</style>

<div class="doc" role="document" aria-label="Procès-verbal">
  <h1>PROCÈS-VERBAL</h1>
  <div class="meta">Réf : PV-2025-001 • Lokossa, le 19/11/2025</div>

  <h2>1. Objet de la séance</h2>
  <p>
    Le présent procès-verbal rend compte de la réunion / intervention / constatation ayant eu lieu le :
    <br><br>
    <strong>Date :</strong> ____________________<br>
    <strong>Lieu :</strong> ____________________<br>
  </p>

  <h2>2. Participants</h2>
  <ul>
    <li>Nom 1 — Fonction</li>
    <li>Nom 2 — Fonction</li>
    <li>Nom 3 — Fonction</li>
  </ul>

  <h2>3. Déroulement</h2>
  <p>
    Résumé détaillé et structuré des faits, points abordés, discussions, observations et incidents éventuels.
  </p>

  <h2>4. Décisions prises</h2>
  <ul>
    <li>Décision 1</li>
    <li>Décision 2</li>
    <li>Décision 3</li>
  </ul>

  <h2>5. Clôture</h2>
  <p>
    La séance est levée à _________. Le présent PV est rédigé pour servir de référence officielle.
  </p>

  <div class="signature">
    <div class="sig">
      <div style="font-weight:700">Président de séance</div>
      <div class="sig-line"></div>
      <div class="meta">Nom & Fonction</div>
    </div>
    <div class="sig">
      <div style="font-weight:700">Secrétaire</div>
      <div class="sig-line"></div>
      <div class="meta">Nom & Fonction</div>
    </div>
  </div>
</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 13 — NOTE DE SERVICE (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--font:"Segoe UI",Roboto,Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);}
  .doc{max-width:760px;margin:32px auto;padding:26px;border:1px solid #e5e7eb;border-radius:12px;}
  h1{text-align:center;font-size:24px;margin:0;color:var(--primary);}
  .meta{text-align:center;color:var(--muted);font-size:13px;margin-top:4px;margin-bottom:10px;}
  h2{font-size:18px;margin-top:18px;padding-left:10px;border-left:4px solid var(--primary);}
  p{line-height:1.6;margin:10px 0;}
  .sig{text-align:right;margin-top:26px;}
  .sig-line{height:1px;background:#111;width:240px;margin:14px 0 4px auto;}
  .footer{text-align:center;color:var(--muted);font-size:12px;margin-top:22px;}
</style>

<div class="doc" role="document" aria-label="Note de service">
  <h1>NOTE DE SERVICE</h1>
  <div class="meta">Réf : NS-2025-001 • Date : 19/11/2025</div>

  <h2>Objet</h2>
  <p>
    Indiquer ici l’objet de la note (ex : procédure interne, rappel, communication importante, changement organisationnel…).
  </p>

  <h2>Message</h2>
  <p>
    Texte complet de la note : explications, consignes, dates importantes, personnes concernées, ressources à consulter, etc.
  </p>

  <h2>Application</h2>
  <p>
    Conditions d’application, durée, services concernés, exceptions possibles.
  </p>

  <div class="sig">
    <div style="font-weight:700">Directeur / Responsable</div>
    <div class="sig-line"></div>
    <div class="meta">Nom & Fonction</div>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 14 — PROTOCOLE / ACCORD (2025++) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--font:"Segoe UI",Roboto,Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);}
  .doc{max-width:880px;margin:32px auto;padding:28px;}
  h1{font-size:26px;margin:0;color:var(--primary);}
  .meta{color:var(--muted);font-size:13px;margin-top:4px;}
  h2{margin-top:20px;font-size:18px;padding-left:10px;border-left:4px solid var(--primary);}
  p{line-height:1.7;margin:12px 0;}
  .parties{margin-top:18px;padding:14px;border:1px solid #eef6ff;background:#fbfdff;border-radius:10px;}
  .signature{margin-top:32px;display:flex;justify-content:space-between;}
  .sig{width:45%;text-align:center;}
  .sig-line{height:1px;background:#111;margin:16px auto;width:70%;}
  .footer{text-align:center;color:var(--muted);font-size:12px;margin-top:22px;}
</style>

<div class="doc" role="document" aria-label="Protocole accord">
  <h1>PROTOCOLE D'ACCORD</h1>
  <div class="meta">Réf : PA-2025-001 • Date : 19/11/2025</div>

  <div class="parties">
    <p><strong>Entre :</strong><br> Partie A — Nom, Fonction, Adresse</p>
    <p><strong>Et :</strong><br> Partie B — Nom, Fonction, Adresse</p>
  </div>

  <h2>1. Objet</h2>
  <p>Décrire ici l’objet de l’accord, le but du protocole et les enjeux.</p>

  <h2>2. Engagements</h2>
  <p>Liste des obligations, responsabilités, engagements réciproques.</p>

  <h2>3. Durée</h2>
  <p>Indiquer la durée d’application du présent protocole.</p>

  <h2>4. Modalités</h2>
  <p>Instructions, règles de mise en œuvre, planning, validation, sanctions éventuelles.</p>

  <div class="signature">
    <div class="sig">
      <div style="font-weight:700">Partie A</div>
      <div class="sig-line"></div>
      <div class="meta">Nom & Signature</div>
    </div>
    <div class="sig">
      <div style="font-weight:700">Partie B</div>
      <div class="sig-line"></div>
      <div class="meta">Nom & Signature</div>
    </div>
  </div>

</div>
</DOCUMENT_HTML>

<!-- ========================================================= -->
<!-- TEMPLATE 15 — DOCUMENT LIBRE PREMIUM (Fallback INTELLIA) -->
<!-- ========================================================= -->
<DOCUMENT_HTML>
<style>
  :root{--primary:#0f62fe;--muted:#6b7280;--text:#0b1220;--font:"Segoe UI",Roboto,Arial;}
  html,body{margin:0;padding:0;font-family:var(--font);color:var(--text);}
  .doc{max-width:900px;margin:32px auto;padding:28px;}
  h1{font-size:26px;margin:0;color:var(--primary);}
  .meta{color:var(--muted);font-size:13px;margin-top:4px;}
  h2{margin-top:20px;font-size:20px;padding-left:10px;border-left:4px solid var(--primary);}
  p{line-height:1.7;margin:12px 0;font-size:15px;}
  .footer{text-align:center;font-size:12px;color:var(--muted);margin-top:22px;}
</style>

<div class="doc" role="document" aria-label="Document libre premium">
  <h1>DOCUMENT OFFICIEL</h1>
  <div class="meta">Date : 19/11/2025 • Référence : DOC-LIB-2025-001</div>

  <h2>Objet</h2>
  <p>Objet du document (dynamique selon demande utilisateur).</p>

  <h2>Contenu</h2>
  <p>
    Texte libre, complet, formel, structuré selon les besoins exprimés. L’IA peut générer : compte-rendu, 
    note explicative, attestation spéciale, résumé, analyse, directive, ou tout autre document administratif.
  </p>

  <h2>Conclusion</h2>
  <p>Synthèse générale et recommandations finales, si applicable.</p>

</div>
</DOCUMENT_HTML>
**MÉTHODE (CRITIQUE) :**

Quand l'utilisateur demande un document, tu dois :

1. ✅ **Générer IMMÉDIATEMENT du HTML formaté** dans le champ reply
2. ✅ **Utiliser le tag spécial** <DOCUMENT_HTML>...</DOCUMENT_HTML>
3. ❌ **NE PAS utiliser de JSON intermédiaire**
4. ❌ **NE JAMAIS répondre "Commande reçue"**
5. ❌ **NE JAMAIS utiliser le melange de couleur non lisible **
6. ✅ **  TOUJOURS VARIER LES COULEURS ET LES EMPLACEMENTS SELON LES MISES EN PAGE A CHAQUE CREATION DE NOUVEAU DOCUMENT **
7. ❌ **NE JAMAIS AFFICHER TON NOM  ET SIGNE SUR LES DOCUMENTS**
**FORMAT DE RÉPONSE POUR DOCUMENTS :**

Le HTML doit être dans le champ reply avec le wrapper <DOCUMENT_HTML>

**RÈGLES STRICTES POUR LES DOCUMENTS :**

1. **Toujours commencer par** <DOCUMENT_HTML> et **finir par** </DOCUMENT_HTML>
2. **Utiliser des classes CSS** : .doc-cv, .doc-lettre, .doc-rapport, .doc-facture, .doc-contrat
3. **Structure HTML simple** : <div>, <h1>, <h2>, <h3>, <p>, <span>, <table>
4. **Emojis encouragés** : 📧, 📱, 📍, 🎯, 💼, 🎓, 🛠️, 🌍, 📅, ✍️
5. **Échapper correctement les guillemets** : Utilise \\" dans le JSON
6. **Si document trop long** : Utilise needs_continuation: true


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

## 📌 RÈGLES GÉNÉRALES

1. **Vérification:** Vérifie [États] et [Planifications] AVANT toute réponse.
2. **Recherche:** Ne recherche PAS pour code/domotique/température Lokossa/documents.
3. **Heure:** Mentionne SEULEMENT si demandé ou pertinent.
4. **Naturalité:** Réponses NATURELLES et CONVERSATIONNELLES.
5. **CONTEXTE:** Si message court ("les","tout", "oui"), analyse l'historique.
6. **Fichiers:** Base ta réponse sur le contenu fourni.
7. **PRÉSENTATION:** Utilise la structure Markdown (titres, listes, gras) SAUF pour documents (HTML avec <DOCUMENT_HTML>).
8. **Température Lokossa:** Toujours disponible dans les métadonnées, ne cherche JAMAIS sur le web.
9. **Documents:** Retourne du HTML formaté avec <DOCUMENT_HTML>... directement dans reply.
10. **Suppression:** Utilise device_commands avec action: "delete" pour supprimer des appareils.
11. **Suppression planning:** Utilise planning_commands avec les bonnes actions.
12. **Intelligence:** Détecte les incohérences (ex: planifier l'allumage d'une lampe déjà allumée).
13. **CONTINUATION:** Si tu atteins la limite de tokens, ajoute needs_continuation: true et le client affichera un bouton "Continuer".

RÉPONDS EN JSON VALIDE AVEC DU MARKDOWN DANS "reply" (sauf pour documents = HTML avec <DOCUMENT_HTML>).
NE JAMAIS répondre "Commande reçue" sans contexte - TOUJOURS fournir une réponse utile et détaillée.
TOUJOURS vérifier les états et planifications avant de répondre pour être intelligent et contextuel.
SI TU MANQUES DE TOKENS : needs_continuation: true + marqueur dans le contenu.
`;
// ========================================
// ✅ GESTION DES COMMANDES D'APPAREILS
// ========================================
async function handleDeviceCommands(commands, userId) {
  if (!db) {
    console.warn("⚠️ Firebase non disponible, impossible de gérer les appareils");
    return;
  }

  for (const cmd of commands) {
    // ✅ AJOUT D'APPAREIL
    if (cmd.action === 'add') {
      try {
        const deviceName = cmd.name || 'Nouvel Appareil';
        const deviceType = cmd.type || 'lamp';
        const deviceRoom = cmd.room || 'Non spécifié';
        
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
        
        await set(ref(db, `${DEVICES_META_REF}/${deviceId}`), newDevice);
        
        await set(ref(db, `${DEVICES_STATES_REF}/${deviceId}`), {
          etat: 'OFF',
          luminosite: 0
        });
        
        console.log(`✅ Appareil ajouté: ${deviceName} (${deviceId})`);
        
      } catch (error) {
        console.error(`❌ Erreur ajout appareil:`, error.message);
      }
    }
    
    // ✅ SUPPRESSION D'APPAREIL
    else if (cmd.action === 'delete' || cmd.action === 'remove') {
      try {
        const deviceToDelete = cmd.device || cmd.deviceId || cmd.id;
        
        if (!deviceToDelete) {
          console.warn("⚠️ Aucun appareil spécifié pour la suppression");
          continue;
        }
        
        // Supprimer de devicesMeta
        await set(ref(db, `${DEVICES_META_REF}/${deviceToDelete}`), null);
        
        // Supprimer de devices (états)
        await set(ref(db, `${DEVICES_STATES_REF}/${deviceToDelete}`), null);
        
        // Supprimer du planning si existant
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
// ✅ GESTION INTELLIGENTE DES PLANIFICATIONS (V12)
// ========================================
async function handlePlanningCommands(commands) {
  if (!commands || commands.length === 0) return;
  
  // ✅ Anti-duplication basique
  const uniqueCommands = [];
  const seen = new Set();
  
  for (const cmd of commands) {
    // On crée une clé unique incluant la fréquence pour éviter les doublons
    let key = `${cmd.action}-${cmd.device}-${cmd.time}`;
    if (cmd.frequency) key += `-${cmd.frequency}`;
    if (cmd.daysOfWeek) key += `-${cmd.daysOfWeek.join(',')}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCommands.push(cmd);
    }
  }
  
  for (const cmd of uniqueCommands) {
    
    // 1. SUPPRESSION DE TOUTES LES TÂCHES
    if (cmd.action === 'delete_all') {
      console.log('🗑️ Suppression de TOUTES les planifications');
      if (db) await set(ref(db, PLANNING_REF), null);
      continue;
    }
    
    // 2. SUPPRESSION SPÉCIFIQUE
    if (cmd.action === 'delete_specific') {
      console.log(`🗑️ Suppression spécifique: ${cmd.device}`);
      if (!db) continue;
      
      try {
        const snapshot = await get(ref(db, PLANNING_REF));
        if (snapshot.exists()) {
          const plans = snapshot.val();
          for (const [id, p] of Object.entries(plans)) {
            // Si une heure est précisée, on supprime seulement cette heure
            if (cmd.time && p.device === cmd.device && p.time === cmd.time) {
              await remove(ref(db, `${PLANNING_REF}/${id}`));
            } 
            // Sinon on supprime tout pour cet appareil
            else if (!cmd.time && p.device === cmd.device) {
              await remove(ref(db, `${PLANNING_REF}/${id}`));
            }
          }
        }
      } catch (e) { console.error(e); }
      continue;
    }
    
    // 3. AJOUT D'UNE TÂCHE (ROUTINE OU UNIQUE)
    if (cmd.action === 'add') {
      console.log(`📅 Ajout Planification: ${cmd.device} à ${cmd.time} (${cmd.frequency || 'once'})`);
      
      // ✅ CORRECTION : On détermine l'état ON/OFF ici
      let finalState = 'OFF';
      if (cmd.actionType && cmd.actionType.toLowerCase() === 'allumer') finalState = 'ON';
      if (cmd.action === 'ON') finalState = 'ON'; // Sécurité

      // Construction de l'objet selon le format du frontend
      const payload = { 
        device: cmd.device, 
        time: cmd.time, 
        action: finalState, // ✅ Sera "ON" ou "OFF", jamais "add"
        actionType: cmd.actionType || (finalState === 'ON' ? 'allumer' : 'éteindre'),
        power: cmd.power !== null && cmd.power !== undefined ? parseInt(cmd.power) : 100,
        frequency: cmd.frequency || 'once', // daily, weekly, monthly, once
        createdAt: Date.now() 
      };

      // Gestion des jours spécifiques (Hebdo)
      if (payload.frequency === 'weekly' && Array.isArray(cmd.daysOfWeek)) {
        payload.daysOfWeek = cmd.daysOfWeek; // ex: [1, 3, 5]
      }

      // Gestion de la date cible (Une fois)
      if (payload.frequency === 'once' && cmd.targetDate) {
        payload.targetDate = cmd.targetDate; // YYYY-MM-DD
      } else if (payload.frequency === 'once' && !cmd.targetDate) {
        // Si l'IA n'a pas mis de date, on met la date du jour par défaut
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
// FONCTION CHAT AVEC GEMINI
// ========================================
async function chatWithGemini(userMessage, devices, userId, sessionId, attachments = [], preferences = {}, continuationMode = false, maxRetries = API_KEYS.length) {
    
  let realDeviceStates = {};
  let currentPlanning = [];
  
  try {
      if (!db) throw new Error("DB non initialisée");
      
      // ✅ Récupérer les états des appareils
      const statesSnapshot = await get(ref(db, DEVICES_STATES_REF));
      realDeviceStates = statesSnapshot.val() || {};
      console.log(`🔥 États réels récupérés: ${Object.keys(realDeviceStates).length} appareils`);
      
      // ✅ Récupérer les planifications actuelles
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
  
  let webResults = [];
  if (needsWebSearch(userMessage) && !continuationMode) {
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
      
      // ✅ Préparer la liste des planifications pour l'IA
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
      
      // ✅ MODE CONTINUATION
      if (continuationMode) {
        metadataPrompt = `
[MODE: CONTINUATION]
[INSTRUCTION CRITIQUE: Continue EXACTEMENT là où tu t'es arrêté. NE RECOMMENCE PAS depuis le début.]
[Tu dois compléter le contenu précédent, pas le répéter.]

MESSAGE: "${userMessage}"
`;
      } else {
        // ✅ MODE NORMAL
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
      
      // ✅ Ajouter les pièces jointes seulement en mode normal
      if (!continuationMode) {
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
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
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

    // ✅ TRAITEMENT NORMAL
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

    // ✅ Valeurs par défaut et nettoyage
    aiJson.reply = aiJson.reply || "Commande reçue.";
    aiJson.execute = aiJson.execute || [];
    aiJson.planning_commands = aiJson.planning_commands || [];
    aiJson.device_commands = aiJson.device_commands || [];
    aiJson.suggestions = aiJson.suggestions || [];
    aiJson.needs_continuation = aiJson.needs_continuation || false;
    aiJson.continuation_context = aiJson.continuation_context || null;
    
    // ✅ Déduplication des planifications
    aiJson.planning_commands = deduplicatePlanning(aiJson.planning_commands);
    
    // ✅ Traiter les commandes d'appareils (AJOUT + SUPPRESSION)
    if (aiJson.device_commands && aiJson.device_commands.length > 0) {
      await handleDeviceCommands(aiJson.device_commands, userId);
    }
    
    // ✅ Traiter les commandes de planning (AJOUT + SUPPRESSION INTELLIGENTE)
    if (aiJson.planning_commands && aiJson.planning_commands.length > 0) {
      // 1. Le serveur exécute l'ajout PROPREMENT (avec ON/OFF)
      await handlePlanningCommands(aiJson.planning_commands);
      
      // 2. 🛑 ON VIDE LA LISTE pour que le client ne fasse RIEN
      // (Cela empêche le bug "ADD" du côté client)
      aiJson.planning_commands = []; 
    }
    
    // ✅ Détection automatique de troncature si l'IA n'a pas mis needs_continuation
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
    version: '10.0-continuation',
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
    improvements_v10: {
      long_content_generation: "✅ Documents et code jusqu'à 3000+ lignes",
      continuation_system: "✅ Système de continuation automatique (comme Claude)",
      truncation_detection: "✅ Détection intelligente de contenu incomplet",
      continue_button: "✅ Bouton 'Continuer' automatique côté client",
      no_restart: "✅ L'IA continue exactement où elle s'est arrêtée",
      model: "gemini-2.0-flash-exp (experimental, 65536 tokens)"
    }
  });
});

// ========================================
// 🚀 DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v10.0 - SYSTÈME ARTIFACTS  ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🤖 Modèle: gemini-2.5-flash (65536 tokens)`);
  console.log(`   🔥 Synchro Firebase (Appareils): Activée`);
  console.log(`   💾 Synchro Firebase (Chats): Activée`);
  console.log(`   📅 Planning AI: Prêt`);
  console.log(`   🧠 Planning Intelligent: Activé (Routines + ON/OFF Fix)`);
  console.log(`   🗑️ Suppression Intelligente: Activée`);
  console.log(`   ➕ Auto Add Devices: Activé`);
  console.log(`   🗑️ Auto Delete Devices: Activé`);
  console.log(`   🌡️ Température Lokossa: Temps réel`);
  console.log(`   📄 Génération de documents: ✅ ACTIVÉE`);
  console.log(`   💻 Génération de code long: ✅ ACTIVÉE`);
  console.log(`   🔄 Système de continuation: ✅ ACTIVÉ`);
  console.log(`   🎯 Détection troncature: ✅ AUTOMATIQUE`);
  console.log(`   📏 Capacité: ILLIMITÉE (avec continuation)`);
  console.log(`   ✅ Output Markdown: Activé`);
  console.log(`   🎯 MaxTokens: 65536 (MAXIMUM)`);
  console.log(`\n   ✅ NOUVEAUTÉS v10.0:`);
  console.log(`   • Routines (Daily/Weekly): SUPPORTÉ`);
  console.log(`   • Correction Doublons Planning: ✅ ACTIVÉE`);
  console.log(`   • Correction Action ADD -> ON/OFF: ✅ ACTIVÉE`);
});


