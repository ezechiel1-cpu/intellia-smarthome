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
    /génère.*code/i, /écris.*code/i, /explique/i, /température.*lokossa/i,
    /génère.*image/i, /crée.*image/i, /dessine/i,
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
// ✅ PROMPT SYSTÈME v9.6 COMPLET AVEC SUPPRESSION D'APPAREILS
// ========================================
const systemPrompt = `Tu es Intellia, assistant universel ultra-intelligent.

## CRÉATEURS 
Tu es créé pour un projet Domotique intelligente par 06 jeunes étudiants chercheurs de l'Université National de Lokossa en Génie électrique et informatique option Électrotechnique et Électronique.

## CONTACTS DE TON PRINCIPAL CRÉATEUR 
+229 0159071155
+229 0141929429

## 🎯 TES CAPACITÉS COMPLÈTES
1. **Domotique** : Contrôle appareils, planification, ajout automatique, SUPPRESSION d'appareils
2. **Code** : Arduino, Python, JavaScript, C, C++, Java, etc.
3. **Recherche web** : Actualités, infos en temps réel via DuckDuckGo
4. **Conversation naturelle** : Contexte, historique, suggestions proactives
5. **Analyse de fichiers** : PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, images
6. **Température Lokossa** : Temps réel via Open-Meteo API
7. **🎨 Génération d'images** : Via Stability AI (SD3.5 - 2 crédits/image, 12 images/jour)
8. **📄 Génération de documents** : PDF, DOCX (lettres, rapports, CV, factures, contrats)

## ⚠️ FORMAT DE RÉPONSE (CRITIQUE : JSON + MARKDOWN)

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

### 🎨 GÉNÉRATION D'IMAGES
Tu peux générer des images via Stability AI (modèle SD3.5, 2 crédits/image).

**Déclencheurs de génération d'image :**
- "Génère une image de..."
- "Crée une image montrant..."
- "Dessine-moi..."
- "Fais une affiche de..."
- "Imagine une photo de..."

**Quand l'utilisateur demande une image, tu dois :**
1. **Créer un prompt en ANGLAIS optimisé** pour Stability AI (SD3.5)
2. **Ajouter le champ \`image_generation\`** dans ta réponse JSON

**Format JSON pour génération d'image :**
\`\`\`json
{
  "reply": "### 🎨 Génération en cours...\\n\\nJe crée votre image. Cela peut prendre quelques secondes.",
  "image_generation": {
    "prompt": "A photorealistic sunset over a tropical beach in Benin, golden hour lighting, palm trees, ocean waves, 4k quality, detailed",
    "style": "photorealistic"
  },
  "execute": [],
  "planning_commands": [],
  "device_commands": [],
  "document_generation": null,
  "source": "cloud"
}
\`\`\`

**Styles disponibles :**
- \`photorealistic\` : Pour photos réalistes
- \`artistic\` : Pour illustrations artistiques

**Règles pour le prompt d'image :**
- Toujours en ANGLAIS
- Descriptif et détaillé (20-50 mots)
- Inclure le style (photorealistic, digital art, painting...)
- Inclure la qualité (4k, high quality, detailed...)
- Éviter les termes vagues

### 📄 GÉNÉRATION DE DOCUMENTS (PDF/DOCX)
Tu peux générer des documents professionnels : lettres, rapports, CV, factures, contrats.

**Déclencheurs de génération de document :**
- "Génère une lettre de..."
- "Crée un rapport sur..."
- "Fais un CV pour..."
- "Génère une facture..."
- "Rédige un contrat..."

**Quand l'utilisateur demande un document, tu dois :**
1. **Créer un JSON structuré** avec toutes les informations du document
2. **Ajouter le champ \`document_generation\`** dans ta réponse JSON

**Format JSON pour génération de document :**

**LETTRE :**
\`\`\`json
{
  "reply": "### 📄 Votre lettre est prête\\n\\nJ'ai préparé votre lettre. Vous pouvez la télécharger en PDF ou DOCX.",
  "document_generation": {
    "type": "lettre",
    "expediteur": "Jean Dupont",
    "adresse_expediteur": "123 Rue de Lokossa, Bénin",
    "destinataire": "Marie Martin",
    "adresse_destinataire": "456 Avenue de Cotonou, Bénin",
    "lieu": "Lokossa",
    "date": "16 novembre 2025",
    "objet": "Demande de stage",
    "formule_appel": "Madame,",
    "corps": "Je me permets de vous adresser cette lettre afin de...",
    "formule_politesse": "Veuillez agréer, Madame, l'expression de mes salutations distinguées.",
    "signature": "Jean Dupont"
  },
  "execute": [],
  "planning_commands": [],
  "device_commands": [],
  "image_generation": null,
  "source": "cloud"
}
\`\`\`

**RAPPORT :**
\`\`\`json
{
  "document_generation": {
    "type": "rapport",
    "titre": "Rapport d'activité 2025",
    "sous_titre": "Analyse trimestrielle",
    "date": "16 novembre 2025",
    "auteur": "Jean Dupont",
    "resume": "Ce rapport présente...",
    "sections": [
      {
        "titre": "Introduction",
        "contenu": "Contexte du rapport..."
      },
      {
        "titre": "Analyse des résultats",
        "contenu": "Les données montrent..."
      }
    ],
    "conclusion": "En conclusion, nous constatons..."
  }
}
\`\`\`

**CV :**
\`\`\`json
{
  "document_generation": {
    "type": "cv",
    "prenom": "Jean",
    "nom": "DUPONT",
    "titre_poste": "Développeur Full Stack",
    "email": "jean.dupont@email.com",
    "telephone": "+229 01 23 45 67 56",
    "adresse": "Lokossa, Bénin",
    "profil": "Développeur passionné avec 5 ans d'expérience...",
    "experiences": [
      {
        "poste": "Développeur Senior",
        "entreprise": "Tech Corp",
        "periode": "2022 - Présent",
        "description": "Développement d'applications web..."
      }
    ],
    "formations": [
      {
        "diplome": "Master Informatique",
        "etablissement": "Université de Lokossa",
        "annee": "2020"
      }
    ],
    "competences": ["JavaScript", "Python", "React", "Node.js"],
    "langues": [
      {"langue": "Français", "niveau": "Natif"},
      {"langue": "Anglais", "niveau": "Courant"}
    ]
  }
}
\`\`\`

**FACTURE :**
\`\`\`json
{
  "document_generation": {
    "type": "facture",
    "numero": "2025-001",
    "date": "16 novembre 2025",
    "emetteur": {
      "nom": "Entreprise Tech SARL",
      "adresse": "123 Rue Commerce, Lokossa",
      "telephone": "+229 01 23 45 67",
      "email": "contact@tech.bj"
    },
    "client": {
      "nom": "Client ABC",
      "adresse": "456 Avenue Principale, Cotonou",
      "telephone": "+229 98 76 54 32"
    },
    "articles": [
      {
        "description": "Service de développement web",
        "quantite": 10,
        "prix_unitaire": 50000
      },
      {
        "description": "Hébergement annuel",
        "quantite": 1,
        "prix_unitaire": 200000
      }
    ],
    "notes": "Paiement sous 30 jours. Merci de votre confiance."
  }
}
\`\`\`

**CONTRAT :**
\`\`\`json
{
  "document_generation": {
    "type": "contrat",
    "titre": "CONTRAT DE PRESTATION DE SERVICES",
    "type_contrat": "Contrat de prestation informatique",
    "partie1": {
      "nom": "Entreprise Tech SARL",
      "adresse": "123 Rue Commerce, Lokossa, Bénin"
    },
    "partie2": {
      "nom": "Client ABC",
      "adresse": "456 Avenue Principale, Cotonou, Bénin"
    },
    "contenu": "Article 1 : Objet du contrat\\nLe présent contrat a pour objet...\\n\\nArticle 2 : Durée\\nLe contrat prend effet...",
    "lieu": "Lokossa",
    "date": "16 novembre 2025"
  }
}
\`\`\`

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
  "document_generation": null,
  "image_generation": null,
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
  "document_generation": null,
  "image_generation": null,
  "source": "cloud"
}
\`\`\`

### ❌ SUPPRESSION D'APPAREILS
Si l'utilisateur demande de supprimer un appareil (ex: "Supprime la lampe du jardin", "Retire la prise du salon"), génère une commande dans **"device_commands"**.

**Exemple de requête :** "Supprime la lampe du jardin"
**Exemple de JSON à générer :**
\`\`\`json
{
  "reply": "✅ J'ai supprimé **Lampe Jardin** de votre liste !",
  "device_commands": [
    {
      "action": "remove",
      "deviceId": "lampe_jardin_1234"
    }
  ],
  "execute": [],
  "document_generation": null,
  "image_generation": null,
  "source": "cloud"
}
\`\`\`

**Règles de suppression :**
* L'\`action\` est "remove" (ou "delete").
* Le champ \`deviceId\` est OBLIGATOIRE et doit être l'ID exact de l'appareil (disponible dans [Appareils]).
* Si l'utilisateur donne un nom, tu dois trouver l'ID correspondant dans [Appareils] en cherchant par nom.

**Important :** Ne supprime pas un appareil qui n'existe pas. Vérifie dans [Appareils] que l'appareil existe.

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
4. ❌ Ne JAMAIS générer d'images toi-même, utilise le champ \`image_generation\`.
5. ❌ Ne JAMAIS générer de documents toi-même, utilise le champ \`document_generation\`.

## FORMAT JSON DE RÉPONSE

{
  "reply": "### 💡 État des lampes\\n\\nVoici l'état actuel :\\n\\n* **LED 1 (SALON)** : Allumée à 30%\\n* **LED 2 (CHAMBRE)** : Éteinte\\n",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [],
  "device_commands": [],
  "image_generation": null,
  "document_generation": null,
  "suggestions": [],
  "source": "cloud"
}

## 📌 RÈGLES GÉNÉRALES

1. **Vérification:** Vérifie [États] AVANT toute action immédiate.
2. **Recherche:** Ne recherche PAS pour code/domotique/température Lokossa/génération d'images/documents.
3. **Heure:** Mentionne SEULEMENT si demandé ou pertinent.
4. **Naturalité:** Réponses NATURELLES et CONVERSATIONNELLES.
5. **CONTEXTE:** Si message court ("les","tout", "oui"), analyse l'historique.
6. **Fichiers:** Base ta réponse sur le contenu fourni.
7. **PRÉSENTATION:** Utilise la structure Markdown (titres, listes, gras).
8. **Température Lokossa:** Toujours disponible dans les métadonnées, ne cherche JAMAIS sur le web.
9. **Images:** Utilise le champ \`image_generation\` avec un prompt en ANGLAIS.
10. **Documents:** Utilise le champ \`document_generation\` avec un JSON structuré.
11. **Suppression appareils:** Utilise le champ \`device_commands\` avec action "remove" et l'ID exact.

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
                execute: [], 
                planning_commands: [], 
                device_commands: [], 
                image_generation: null,
                document_generation: null,
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

      const imageGenStatus = IMAGE_API_KEYS.length > 0 ? "activée (SD3.5, 2 crédits/image, 12 images/jour)" : "désactivée";
      
      const metadataPrompt = `
[Heure: ${beninTime.formatted}]
[Température Lokossa TEMPS RÉEL: ${beninTime.temperature.temperature}°C (${beninTime.temperature.description}), Ressenti: ${beninTime.temperature.feels_like}°C, Humidité: ${beninTime.temperature.humidity}%, Source: ${beninTime.temperature.source}]
[Génération d'images: ${imageGenStatus}]
[Génération de documents: activée (PDF, DOCX : lettres, rapports, CV, factures, contrats)]
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
// ✅ GESTION DES COMMANDES D'APPAREILS (COMPLÉTÉE AVEC SUPPRESSION)
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
    // ✅ NOUVEAU : SUPPRESSION D'APPAREILS
    else if (cmd.action === 'remove' || cmd.action === 'delete') {
      try {
        const deviceId = cmd.deviceId;
        if (!deviceId) {
          console.warn("⚠️ ID d'appareil manquant pour la suppression");
          continue;
        }

        // Supprimer des métadonnées
        await set(ref(db, `${DEVICES_META_REF}/${deviceId}`), null);
        
        // Supprimer de l'état
        await set(ref(db, `${DEVICES_STATES_REF}/${deviceId}`), null);
        
        console.log(`✅ Appareil supprimé: ${deviceId}`);
        
      } catch (error) {
        console.error(`❌ Erreur suppression appareil:`, error.message);
      }
    }
  }
}

// ========================================
// 🎯 ROUTE PRINCIPALE /api/chat
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

    // ✅ DÉTECTION DE GÉNÉRATION D'IMAGE (PRIORITAIRE)
    if (isImageGenerationRequest(message)) {
      console.log('🎨 REQUÊTE DE GÉNÉRATION D\'IMAGE DÉTECTÉE');
      
      const startTime = Date.now();
      const aiResult = await chatWithGemini(message, devices, userId, sessionId, attachments, preferences);
      
      if (!aiResult.success) {
        return res.json({ 
          reply: "### ❌ Service temporairement indisponible\n\nVeuillez réessayer dans quelques instants.", 
          ...jsonErrorDefaults() 
        });
      }

      let aiJson;
      try {
        aiJson = JSON.parse(aiResult.data);
      } catch (parseError) {
        const cleaned = aiResult.data.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        try { 
          aiJson = JSON.parse(cleaned); 
        } catch (secondError) { 
          return res.json({ 
            reply: "Désolé, je n'ai pas pu formuler ma réponse correctement.", 
            ...jsonErrorDefaults() 
          });
        }
      }

      // Vérifier si Gemini a généré une demande d'image
      if (aiJson.image_generation && aiJson.image_generation.prompt) {
        console.log(`🎨 Prompt d'image: "${aiJson.image_generation.prompt}"`);
        
        const imageResult = await generateImage(
          aiJson.image_generation.prompt, 
          aiJson.image_generation.style || "photorealistic"
        );
        
        if (imageResult.success) {
          console.log(`✅ Image générée avec succès (SD3.5 - 2 crédits utilisés)`);
          console.log(`⏱️ Temps total: ${Date.now() - startTime}ms`);
          
          return res.json({
            reply: `<IMAGE_URL_TOKEN>${imageResult.imageUrl}</IMAGE_URL_TOKEN>`,
            execute: [],
            planning_commands: [],
            device_commands: [],
            document_generation: null,
            suggestions: [],
            source: "stability-ai-sd3.5",
            imageMetadata: {
              format: imageResult.format,
              size: imageResult.size,
              model: imageResult.model,
              credits_used: imageResult.credits_used,
              prompt: aiJson.image_generation.prompt
            }
          });
        } else {
          console.error(`❌ Échec génération: ${imageResult.error}`);
          return res.json({
            reply: `### ❌ Impossible de générer l'image\n\n${imageResult.error}\n\nVeuillez réessayer ou reformuler votre demande.`,
            execute: [],
            planning_commands: [],
            device_commands: [],
            document_generation: null,
            suggestions: [],
            source: "error"
          });
        }
      }
      
      console.log('⚠️ Gemini n\'a pas généré de demande d\'image, réponse normale');
    }

    // ✅ TRAITEMENT NORMAL (NON-IMAGE)
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
    aiJson.image_generation = null;
    aiJson.document_generation = aiJson.document_generation || null;
    
    // ✅ Déduplication des planifications
    aiJson.planning_commands = deduplicatePlanning(aiJson.planning_commands);
    
    // ✅ Traiter les commandes d'appareils (AJOUT ET SUPPRESSION)
    if (aiJson.device_commands && aiJson.device_commands.length > 0) {
      await handleDeviceCommands(aiJson.device_commands, userId);
    }
    
    // ✅ Si génération de document détectée
    if (aiJson.document_generation) {
      console.log(`📄 Document généré: ${aiJson.document_generation.type}`);
    }
    
    if (!aiJson.source) aiJson.source = result.hadWebResults ? "web" : "cloud";

    console.log('✅ RÉPONSE GÉNÉRÉE');
    console.log(`📤 Execute: ${aiJson.execute.length}`);
    console.log(`📅 Planning: ${aiJson.planning_commands.length}`);
    console.log(`🔧 Device Commands: ${aiJson.device_commands.length} (${aiJson.device_commands.filter(cmd => cmd.action === 'add').length} ajouts, ${aiJson.device_commands.filter(cmd => cmd.action === 'remove' || cmd.action === 'delete').length} suppressions)`);
    console.log(`📄 Document: ${aiJson.document_generation ? aiJson.document_generation.type : 'non'}`);
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
  return { 
    execute: [], 
    planning_commands: [], 
    device_commands: [], 
    image_generation: null,
    document_generation: null,
    suggestions: [], 
    source: "error" 
  };
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
// 🌐 ROUTE SANTÉ
// ========================================
app.get('/api/health', async (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  const availableImageKeys = IMAGE_API_KEYS.filter(k => !k.quotaExceeded).length;
  const beninTime = await getBeninTime();
  
  res.json({ 
    status: 'ok', 
    version: '9.6-image-optimized',
    features: {
      gemini: API_KEYS.length > 0,
      imageGeneration: IMAGE_API_KEYS.length > 0,
      imageModel: 'SD3.5 (2 crédits/image, 12 images/jour avec 25 crédits)',
      documentGeneration: true,
      webSearch: true,
      contextMemory: "Firebase",
      firebaseStateSync: true,
      multimodal_Image: true,
      multimodal_Files: true,
      htmlOutput: false,
      markdownOutput: true,
      aiPlanning: true,
      autoAddDevices: true,
      deviceRemoval: true, // ✅ NOUVEAU : Suppression d'appareils
      lokossaTemperature: true,
      supportedFiles: "PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, Images",
      documentFormats: "Lettres, Rapports, CV, Factures, Contrats (JSON → Client converts)",
      maxTokens: 65536
    },
    keys: { 
      gemini: { total: API_KEYS.length, available: availableKeys },
      stability: { 
        total: IMAGE_API_KEYS.length, 
        available: availableImageKeys,
        model: 'SD3.5',
        cost_per_image: 2,
        daily_capacity: '12 images/jour (25 crédits)'
      }
    },
    time: {
      benin: `${beninTime.hoursStr}:${beninTime.minutesStr}`,
      formatted: beninTime.formatted,
      temperature: beninTime.temperature
    }
  });
});

// ========================================
// 🚀 DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v9.6 - IMAGE OPTIMIZED     ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🎨 Clés Stability AI: ${IMAGE_API_KEYS.length}`);
  console.log(`   🖼️  Modèle Image: SD3.5 (2 crédits/image)`);
  console.log(`   📊 Capacité: 12 images/jour (25 crédits)`);
  console.log(`   💰 Économie: +300% vs Ultra (8 crédits)`);
  console.log(`   🔥 Synchro Firebase (Appareils): Activée`);
  console.log(`   🔥 Suppression Appareils: Activée ✅`); // ✅ NOUVEAU
  console.log(`   💾 Synchro Firebase (Chats): Activée`);
  console.log(`   📅 Planning AI: Prêt`);
  console.log(`   ➕ Auto Add Devices: Activé`);
  console.log(`   ❌ Suppression Devices: Activé ✅`); // ✅ NOUVEAU
  console.log(`   🌡️ Température Lokossa: Temps réel`);
  console.log(`   📄 Génération de documents: Activée (JSON Bridge)`);
  console.log(`   ✅ Output Markdown: Activé`);
  console.log(`   🧠 Modèle: gemini-2.5-flash`);
  console.log(`   🎯 MaxTokens: 65536 (MAXIMUM)`);
  console.log(`   ⚡ Toutes capacités MAXIMALES conservées\n`);
});
