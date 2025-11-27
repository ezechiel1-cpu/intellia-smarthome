// ========================================
// INTELLIA v11.0 - SYSTÈME ARTIFACTS COMPLET
// ✅ Version LITE : 100% Markdown (Plus rapide, moins de tokens)
// ✅ Suppression des templates HTML
// ✅ Corrections Planification & Persistance maintenues
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ Imports Firebase
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, set, push, remove, serverTimestamp } = require("firebase/database");

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
const USER_CHATS_REF = "userChats"; // Chemin racine pour les chats
// Note: userChatsRefPath n'était pas défini dans votre code original fourni, 
// je suppose qu'il s'agit de USER_CHATS_REF pour la cohérence.
const userChatsRefPath = USER_CHATS_REF; 
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
    console.log("🌡️ Appel Open-Meteo API...");
    
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
        timeout: 3000
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
    /génère.*code/i, /écris.*code/i, /explique/i, /température.*lokossa/i,
    /génère.*pdf/i, /génère.*lettre/i, /crée.*document/i, /fais.*rapport/i, /génère.*cv/i
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
// 🎯 DÉTECTION DE TRONCATURE (CRITIQUE)
// ========================================
function detectTruncation(content) {
  const truncationIndicators = [
    /\.\.\.\s*$/,
    /\[suite\]$/i,
    /\[à suivre\]$/i,
    /^\s*\/\/\s*\.\.\./m,
    /\/\*.*\*\/\s*$/,
    /,\s*$/,
    /;\s*$/
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
  
  const lastChars = content.trim().slice(-20);
  if (/^[^.!?}\]]*$/.test(lastChars) && content.length > 500) {
    console.log(`⚠️ Troncature possible: fin de contenu suspecte`);
    return true;
  }
  
  return false;
}

// ========================================
// ✅ PROMPT SYSTÈME v11.0 - LITE (MARKDOWN ONLY)
// ========================================
const systemPrompt = `Tu es Intellia, assistant universel ultra-intelligent.

## CRÉATEURS 
Tu es créé pour un projet Domotique intelligente par 06 jeunes étudiants chercheurs de l'Université National de Lokossa en Génie électrique et informatique option Électrotechnique et Électronique.

## CONTACTS DE TON PRINCIPAL CRÉATEUR 
+229 0159071155
+229 0141929429

## 🎯 TES CAPACITÉS
1. **Domotique** : Contrôle appareils, planification, ajout/suppression automatique.
2. **Code** : Arduino, Python, JavaScript, C, C++, Java, etc. (ILLIMITÉ).
3. **Recherche web** : Actualités, infos en temps réel via DuckDuckGo.
4. **Conversation naturelle** : Contexte, historique, suggestions proactives.
5. **Analyse de fichiers** : PDF, DOCX, TXT, Images.
6. **Température Lokossa** : Temps réel via Open-Meteo API.
7. **📄 Génération de documents** : CV, lettres, rapports, contrats (En MARKDOWN PROPRE).

## ⚠️ FORMAT DE RÉPONSE (JSON + MARKDOWN)

Tu dois TOUJOURS répondre en JSON.
Le champ "reply" doit contenir du texte formaté en **Markdown (GFM)** uniquement.

### 📝 RÈGLES DE GÉNÉRATION DE DOCUMENTS
Quand l'utilisateur demande un document (CV, Lettre, Contrat, etc.), **n'utilise PAS de HTML**. 
Utilise la structure Markdown pour faire une mise en page propre :

1. **Titres** : Utilise \`#\` pour le titre du document et \`##\` pour les sections.
2. **Séparateurs** : Utilise \`---\` pour séparer l'en-tête du corps (très important pour les lettres).
3. **Mise en valeur** : Utilise \`**Gras**\` pour les labels (ex: **Objet:**, **Expéditeur:**).
4. **Tableaux** : Utilise la syntaxe Markdown standard (\`| Colonne 1 | Colonne 2 |\`).

**Exemple de structure (Lettre) :**
\`\`\`markdown
# LETTRE DE MOTIVATION

**De :** Prénom Nom
**À :** Entreprise XYZ

---

### Objet : Candidature au poste de...

Madame, Monsieur,

[Corps de la lettre bien structuré en paragraphes]

Cordialement,

**Prénom Nom**
\`\`\`

### 🌡️ TEMPÉRATURE DE LOKOSSA
Tu as accès à la température **RÉELLE** dans les métadonnées. Donne la valeur directement sans dire "je cherche".

### 🚀 RÈGLES DE CONTINUATION
1. **Si tu manques de tokens** : Ajoute le champ \`needs_continuation: true\`.
2. **Le client affichera un bouton "Continuer"**.
3. **Quand tu continues** : Reprends exactement là où tu t'es arrêté (ne répète pas le début).

## 🧠 MÉMOIRE DE CONVERSATION

Tu as accès à l'historique complet de la conversation (jusqu'à 150 jours).

**UTILISE CETTE MÉMOIRE POUR :**
- Te rappeler des préférences de l'utilisateur
- Faire référence à des discussions passées
- Maintenir la cohérence sur plusieurs jours
- Comprendre le contexte des requêtes courtes ("continue", "pareil", "oui")

**EXEMPLES :**
- User (Lundi) : "Allume la lampe salon à 18h tous les jours"
- User (Mercredi) : "Et celle de la chambre aussi"
  → Tu dois comprendre qu'il veut aussi une planification à 18h quotidienne

- User (Semaine 1) : "J'aime que la maison soit lumineuse le matin"
- User (Semaine 2) : "Programme ça automatiquement"
  → Tu dois te rappeler de sa préférence et créer des planifications matinales

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
## FORMAT JSON DE RÉPONSE

{
  "reply": "Ton réponse en Markdown ici...",
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
9. **Suppression:** Utilise device_commands avec action: "delete" pour supprimer des appareils.
10. **Suppression planning:** Utilise planning_commands avec les bonnes actions.
11. **Intelligence:** Détecte les incohérences (ex: planifier l'allumage d'une lampe déjà allumée).
12. **CONTINUATION:** Si tu atteins la limite de tokens, ajoute needs_continuation: true et le client affichera un bouton "Continuer".

RÉPONDS EN JSON VALIDE AVEC DU MARKDOWN DANS "reply".
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
    
    else if (cmd.action === 'delete' || cmd.action === 'remove') {
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
// ✅ GESTION INTELLIGENTE DES PLANIFICATIONS
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
            if (cmd.time && p.device === cmd.device && p.time === cmd.time) {
              await remove(ref(db, `${PLANNING_REF}/${id}`));
            } 
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


async function chatWithGemini(userMessage, devices, userId, sessionId, attachments = [], preferences = {}, continuationMode = false, maxRetries = API_KEYS.length) {
    
  let realDeviceStates = {};
  let currentPlanning = [];
  let webResults = [];

  // ========================================
  // 🔥 RÉCUPÉRATION DES ÉTATS FIREBASE
  // ========================================
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

  // ========================================
  // 🌍 RECHERCHE WEB (SI NÉCESSAIRE)
  // ========================================
  if (!continuationMode && message && needsWebSearch(message)) {
      webResults = await performWebSearch(message);
  }

  if (API_KEYS.length === 0) {
    return { success: false, error: "Aucune clé Gemini disponible" };
  }

  const beninTime = await getBeninTime();
  const contextAnalysis = analyzeContext(userMessage, realDeviceStates, beninTime);
  
  // ========================================
  // 🔄 TENTATIVES AVEC ROTATION DES CLÉS
  // ========================================
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const keyObj = getNextApiKey();
      const genAI = new GoogleGenerativeAI(keyObj.key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // ========================================
      // 📚 RÉCUPÉRATION DE L'HISTORIQUE ÉTENDU
      // ========================================
      const historyFromFirebase = await getHistoryFromFirebase(userId, sessionId, 30); // 30 jours

      // ========================================
      // 🧠 EXTRACTION DU CONTEXTE DES FICHIERS PRÉCÉDENTS
      // ========================================
      let previousFilesContext = "";
      const filesInHistory = historyFromFirebase.filter(h => h.attachments && h.attachments.length > 0);
      
      if (filesInHistory.length > 0) {
        previousFilesContext = "\n[FICHIERS PRÉCÉDEMMENT ENVOYÉS DANS CETTE SESSION]\n";
        
        for (const msgWithFiles of filesInHistory.slice(-3)) { // 3 derniers messages avec fichiers
          for (const att of msgWithFiles.attachments) {
            previousFilesContext += `- Fichier: "${att.name}" (Type: ${att.type})\n`;
            if (att.type === 'file' && att.content) {
              previousFilesContext += `  Contenu disponible: Oui (${att.content.length} caractères)\n`;
            }
          }
        }
        previousFilesContext += `[INSTRUCTION: Ces fichiers ont été analysés précédemment.]\n\n`;
      }

      // ========================================
      // 🔄 CONVERSION DE L'HISTORIQUE EN FORMAT GEMINI
      // ========================================
      const historyParts = [];
      
      for (const h of historyFromFirebase) {
        const userParts = [{ text: h.user }];
        if (h.attachments && h.attachments.length > 0) {
          for (const att of h.attachments) {
            if (att.type === 'image' && att.data) {
              const parsed = parseDataUri(att.data);
              if (parsed) {
                userParts.push({ 
                  inlineData: { mimeType: parsed.mimeType, data: parsed.data } 
                });
              }
            } else if (att.type === 'file' && att.content) {
              userParts.push({ 
                text: `\n[FICHIER: ${att.name}]\n${att.content.substring(0, 10000)}\n[FIN FICHIER]\n` 
              });
            }
          }
        }
        historyParts.push({ role: "user", parts: userParts });
        historyParts.push({ role: "model", parts: [{ text: h.bot }] });
      }

      // ========================================
      // 💬 CRÉATION DU CHAT
      // ========================================
      const chat = model.startChat({
        history: [
          { 
            role: "user", 
            parts: [{ text: systemPrompt }] 
          },
          { 
            role: "model", 
            parts: [{ text: JSON.stringify({
                  reply: "### 👋 Bienvenue !\n\nJe suis **Intellia**, votre assistant universel.",
                  needs_continuation: false,
                  continuation_context: null,
                  execute: [], 
                  planning_commands: [], 
                  device_commands: [], 
                  suggestions: [], 
                  source: "cloud"
                })}] 
          },
          ...historyParts
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
          maxOutputTokens: 65536,
        },
      });
      
      // ========================================
      // 📝 CONSTRUCTION DES PLANIFICATIONS
      // ========================================
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
      
      // ========================================
      // 🧠 RÉSUMÉ DE L'HISTORIQUE RÉCENT
      // ========================================
      let historySummary = "";
      if (historyFromFirebase.length > 0) {
        const lastMessages = historyFromFirebase.slice(-5).map(h => {
          const userPreview = h.user.substring(0, 100);
          const botPreview = h.bot.substring(0, 100);
          return `User: "${userPreview}..." → Bot: "${botPreview}..."`;
        }).join('\n');
        historySummary = `[HISTORIQUE RÉCENT]\n${lastMessages}\n`;
      }

      // ========================================
      // 📋 CONSTRUCTION DU PROMPT MÉTADONNÉES
      // ========================================
      let metadataPrompt;
      
      if (continuationMode) {
        metadataPrompt = `
[MODE: CONTINUATION]
[INSTRUCTION CRITIQUE: Continue EXACTEMENT là où tu t'es arrêté.]
${historySummary}
${previousFilesContext}
MESSAGE: "${userMessage}"
`;
      } else {
        metadataPrompt = `
[Heure: ${beninTime.formatted}]
[Température Lokossa: ${beninTime.temperature.temperature}°C]
[Génération de documents: Mode Markdown Standard]
[Prés: ${JSON.stringify(preferences)}]
[États: ${JSON.stringify(realDeviceStates)}]
[Appareils: ${JSON.stringify(devices)}]
[Planifications: \n${planningsText}\n]
${webResults.length > 0 ? `[Web: ${JSON.stringify(webResults.slice(0, 3))}]` : ''}

${historySummary}
${previousFilesContext}

MESSAGE: "${userMessage}"
`;
      }

      // ========================================
      // 📎 AJOUT DES PIÈCES JOINTES
      // ========================================
      const promptParts = [ { text: metadataPrompt } ];
      
      if (!continuationMode && attachments && attachments.length > 0) {
        console.log(`📎 Traitement de ${attachments.length} pièce(s) jointe(s)`);
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

      // ========================================
      // 🚀 ENVOI DE LA REQUÊTE
      // ========================================
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      
      console.log(`🚀 Envoi requête Gemini (Tentative ${attempt + 1}/${maxRetries})`);
      const result = await chat.sendMessage(promptParts, { signal: controller.signal });
      clearTimeout(timeout);

      console.log(`✅ Réponse reçue de Gemini`);
      return { 
        success: true, 
        data: result.response.text(), 
        hadWebResults: webResults.length > 0,
      };

    } catch (error) {
      lastError = error;
      const keyObj = API_KEYS[(currentKeyIndex - 1 + API_KEYS.length) % API_KEYS.length];
      const isQuotaError = error.message?.includes('quota') || error.message?.includes('429');
      markKeyAsFailed(keyObj, isQuotaError);
      console.warn(`⚠️ Tentative ${attempt + 1} échouée: ${error.message}`);
      if (attempt === maxRetries - 1) break;
    }
  }
  
  console.error('❌ Toutes les tentatives ont échoué');
  return { success: false, error: lastError };
}

// ========================================
// 📚 FONCTION getHistoryFromFirebase
// ========================================
async function getHistoryFromFirebase(userId, sessionId, daysBack = 30) {
  if (!db || !userId || !sessionId) return [];
  try {
    const messagesRef = ref(db, `${USER_CHATS_REF}/${userId}/${sessionId}/messages`);
    const snapshot = await get(messagesRef);
    if (!snapshot.exists()) return [];
    
    const messages = snapshot.val();
    const cutoffDate = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    const filteredMessages = Object.values(messages)
      .filter(msg => (msg.timestamp || 0) >= cutoffDate)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    return filteredMessages.slice(-150);
  } catch (error) {
    console.error("❌ Erreur historique:", error);
    return [];
  }
}

// ========================================
// 💾 SAUVEGARDE AMÉLIORÉE
// ========================================
async function saveMessageToFirebase(userMsg, botMsg, attachments, appState) {
  if (!appState.currentUser || !db || !appState.currentSessionId) return;

  const sessionRef = ref(db, `${USER_CHATS_REF}/${appState.currentUser.uid}/${appState.currentSessionId}`);
  const sessionSnapshot = await get(sessionRef);
  const isNewSession = !sessionSnapshot.exists();
  
  if (isNewSession) {
    let newTitle = userMsg;
    if (!newTitle && attachments.length > 0) newTitle = `📎 ${attachments[0].name}`;
    if (!newTitle) newTitle = "Nouvelle discussion";
    newTitle = newTitle.substring(0, 30);
    
    await set(sessionRef, {
      title: newTitle,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
    });
  }

  const messagesRef = ref(db, `${USER_CHATS_REF}/${appState.currentUser.uid}/${appState.currentSessionId}/messages`);
  
  const attachmentsMeta = await Promise.all(attachments.map(async att => {
    if (att.type === 'image') return { name: att.name, type: att.type, data: att.data };
    else if (att.type === 'file') {
      const fileContent = await parseFileAttachment(att);
      return { name: att.name, type: att.type, content: fileContent.substring(0, 100000) };
    }
    return { name: att.name, type: att.type };
  }));

  await push(messagesRef, {
    user: userMsg,
    bot: botMsg,
    attachments: attachmentsMeta,
    timestamp: serverTimestamp()
  });

  await set(ref(db, `${USER_CHATS_REF}/${appState.currentUser.uid}/${appState.currentSessionId}/lastUpdated`), serverTimestamp());
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

    if (key !== AUTH_KEY) return res.status(401).json({ reply: "Clé invalide", ...jsonErrorDefaults() });
    if (!message && attachments.length === 0 && !continuationMode) return res.status(400).json({ reply: "Message requis", ...jsonErrorDefaults() });
    if (!userId || !sessionId) return res.status(400).json({ reply: "IDs manquants", ...jsonErrorDefaults() });

    console.log(`💬 MSG: ${message || '(Continuation)'} | 📄 MODE: ${continuationMode ? 'CONT' : 'NORM'}`);

    const result = await chatWithGemini(message, devices, userId, sessionId, attachments, preferences, continuationMode);

    if (!result.success) {
      return res.json({ 
        reply: "### ❌ Service indisponible\nRéessayez plus tard.", 
        ...jsonErrorDefaults() 
      });
    }

    let aiJson;
    try {
      aiJson = JSON.parse(result.data);
    } catch (parseError) {
      console.warn('⚠️ Parsing JSON échoué, nettoyage...');
      const cleaned = result.data.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
      try { aiJson = JSON.parse(cleaned); } catch (e) { 
        return res.json({ reply: "Erreur de format de réponse.", ...jsonErrorDefaults() });
      }
    }

    aiJson.reply = aiJson.reply || "Commande reçue.";
    aiJson.execute = aiJson.execute || [];
    aiJson.planning_commands = aiJson.planning_commands || [];
    aiJson.device_commands = aiJson.device_commands || [];
    aiJson.suggestions = aiJson.suggestions || [];
    aiJson.needs_continuation = aiJson.needs_continuation || false;
    
    // Traitement des commandes
    aiJson.planning_commands = deduplicatePlanning(aiJson.planning_commands);
    if (aiJson.device_commands.length > 0) await handleDeviceCommands(aiJson.device_commands, userId);
    if (aiJson.planning_commands.length > 0) await handlePlanningCommands(aiJson.planning_commands);
    
    // Détection auto troncature
    if (!aiJson.needs_continuation && aiJson.reply && detectTruncation(aiJson.reply)) {
      aiJson.needs_continuation = true;
      if (!aiJson.continuation_context) aiJson.continuation_context = { type: "auto" };
    }
    
    if (!aiJson.source) aiJson.source = result.hadWebResults ? "web" : "cloud";

    // Sauvegarde en arrière-plan
    const appStateStub = { currentUser: { uid: userId }, currentSessionId: sessionId };
    saveMessageToFirebase(message, aiJson.reply, attachments, appStateStub).catch(console.error);

    res.json(aiJson);
    
  } catch (error) {
    console.error('💥 ERREUR SERVEUR:', error.message);
    res.status(500).json({ reply: "### ❌ Erreur interne", ...jsonErrorDefaults() });
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
    version: '11.0-lite-markdown',
    features: {
      gemini: API_KEYS.length > 0,
      documentGeneration: true,
      codeLongGeneration: true,
      continuationSystem: true,
      webSearch: true,
      contextMemory: "Firebase",
      htmlOutput: false,  // ❌ DÉSACTIVÉ
      markdownOutput: true, // ✅ ACTIVÉ
      aiPlanning: true,
      lokossaTemperature: true
    },
    keys: { total: API_KEYS.length, available: availableKeys },
    time: { benin: `${beninTime.hoursStr}:${beninTime.minutesStr}`, temp: beninTime.temperature }
  });
});

// ========================================
// 🚀 DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
  console.log('\n┌────────────────────────────────────────────────────────────┐');
  console.log('│     INTELLIA v11.0 - SYSTÈME MARKDOWN LITE              │');
  console.log('│        ✅ 100% Markdown (Plus rapide)                   │');
  console.log('└────────────────────────────────────────────────────────────┘');
  console.log(`   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   📄 Mo}); // <--- AJOUTEZ ); ICI


