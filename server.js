// ========================================
// INTELLIA v3.1 - Assistant Domotique Intelligent
// Multi-clés API + HEURE INJECTÉE (BÉNIN) + Optimisé Vocal
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
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
// CONFIGURATION MULTI-CLÉS
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
  console.warn('⚠️ AUCUNE CLÉ API TROUVÉE.');
}

console.log(`🔑 ${API_KEYS.length} clé(s) API chargée(s)`);

// ========================================
// SYSTÈME DE ROTATION DES CLÉS
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
      console.log(`🔑 Utilisation de la clé #${currentKeyIndex} (${keyObj.failures} échecs)`);
      return keyObj;
    }
    attempts++;
  }
  throw new Error("Toutes les clés API ont atteint leur quota");
}

function markKeyAsFailed(keyObj, isQuotaError = false) {
  keyObj.failures++;
  if (isQuotaError) {
    keyObj.quotaExceeded = true;
    console.error(`❌ Clé épuisée (quota dépassé) - ${keyObj.failures} échecs totaux`);
  } else {
    console.warn(`⚠️ Échec de la clé - ${keyObj.failures} échecs totaux`);
  }
  if (isQuotaError) {
    setTimeout(() => {
      keyObj.quotaExceeded = false;
      keyObj.failures = 0;
      console.log(`🔄 Clé réinitialisée (quota potentiellement restauré)`);
    }, 3600000);
  }
}

// ========================================
// FONCTION D'HEURE ACTUELLE PRÉCISE
// ========================================
function getCurrentTimeFormatted() {
  const now = new Date().toLocaleString('fr-FR', {
    timeZone: 'Africa/Porto-Novo', // ✅ FUSEAU HORAIRE DU BÉNIN (UTC+1)
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return now;
}

// ========================================
// PROMPT SYSTÈME ULTRA-OPTIMISÉ v3.1
// ========================================
DANS server.js v3.1
const systemPrompt = `
Tu es "Intellia", un assistant domotique intelligent, cultivé et ultra-précis. 
**TON EMPLACEMENT PRINCIPAL EST LE BÉNIN.**

## 🎯 RÈGLES FONDAMENTALES
...
### 2. CAPACITÉS AUTOMATIQUES (Connaissance du Monde)

**TU AS ACCÈS AUTOMATIQUE À :**
- ✅ Heure système actuelle (fournie dans chaque requête, fuseau horaire Bénin)
- ✅ Connaissance générale (pour répondre à "Qui est Patrice Talon ?" ou "Météo à Cotonou" en utilisant ta connaissance interne si l'utilisateur ne précise pas l'emplacement).

**IMPORTANT :** Si tu ne connais pas la réponse (météo précise ou évènement très récent), tu dois dire de manière honnête et polie que tu n'as pas l'information.

### 3. FORMATAGE DES RÉPONSES VOCALES

**RÈGLES CRITIQUES POUR LA VOIX :**
- ✅ Réponses CONCISES (2-4 phrases max pour domotique)
- ✅ Texte NATUREL et FLUIDE (comme si tu parlais à quelqu'un)
- ✅ Pas de listes à puces dans les réponses vocales
- ✅ Confirmations COURTES : "C'est fait", "Entendu", "D'accord"

### 4. QUESTIONS GÉNÉRALES - MODE EXPERT

Pour toute question NON-domotique (y compris l'heure), tu réponds librement comme un expert.

**STYLE DE RÉPONSE :**
- 📚 Explications claires et détaillées
- 🎯 Exemples concrets et pertinents
- 💡 Conseils pratiques applicables
- 🗣️ Ton pédagogique mais naturel

### 5. DISTINCTION : IMMÉDIAT vs PLANIFIÉ

**ACTION IMMÉDIATE** (maintenant) :
✅ "Allume la lampe" → execute: ["lampe_salon|ON|100"]
✅ "Règle à 50%" → execute avec appareil du contexte

**PLANIFICATION** (heure mentionnée) :
✅ "Allume à 08H32" → planning_commands avec time: "08:32"
❌ Ne JAMAIS exécuter si heure mentionnée

### 6. RÈGLE DU CONTEXTE
- Mémorise le dernier appareil mentionné
- Si ambiguïté → pose UNE question claire
- Utilise le contexte pour les références implicites

## 📋 FORMATS TECHNIQUES (Identiques)

**planning_commands :**
{
  "action": "add",
  "device": "id_exact",
  "time": "HH:MM",
  "schedule_action": "ON" ou "OFF",
  "power": 0-100
}

**execute :**
"device_id|ACTION|valeur"

## 💡 EXEMPLES PARFAITS

### Heure actuelle (Utiliser le contexte injecté)
USER: "Il est quelle heure ?"
RÉPONSE ATTENDUE : Utiliser la donnée de l'heure injectée, ex:
{
  "reply": "Il est actuellement 21 heures 30, ce vendredi 7 novembre 2025.",
  "execute": [],
  "planning_commands": []
}

### Domotique
USER: "Éteins tout à 22h"
{
  "reply": "Entendu, j'éteindrai tous les appareils à 22 heures.",
  "execute": [],
  "planning_commands": [
    {"action":"add", "device":"lampe_salon", "time":"22:00", "schedule_action":"OFF", "power":0}
  ]
}

## 🚨 ERREURS INTERDITES
❌ "OK" avec execute vide si action demandée
❌ Arrondir l'heure
❌ Balises HTML

RÉPONDS UNIQUEMENT EN JSON VALIDE.
`;

// ========================================
// FONCTION DE CHAT AVEC RETRY
// ========================================
async function chatWithRetry(prompt, devices, currentTime, maxRetries = API_KEYS.length) {
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
                reply: "Je suis Intellia v3.1, votre assistant intelligent. Prêt à vous aider !",
                execute: [],
                planning_commands: []
              })
            }] 
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7, 
          maxOutputTokens: 4096,
        },
      });

      const fullPrompt = `
╔═══════════════════════════════════════╗
║         APPAREILS DISPONIBLES         ║
╚═══════════════════════════════════════╝

${JSON.stringify(devices, null, 2)}

╔═══════════════════════════════════════╗
║         HEURE ACTUELLE PRÉCISE        ║
╚═══════════════════════════════════════╝

${currentTime}
(Utilise cette heure pour répondre à la question "Quelle heure est-il ?". Le fuseau horaire est le Bénin.)

╔═══════════════════════════════════════╗
║         MESSAGE UTILISATEUR           ║
╚═══════════════════════════════════════╝

"${prompt}"

────────────────────────────────────────

ANALYSE ET RÉPONDS EN JSON VALIDE :
`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const result = await chat.sendMessage(fullPrompt, { signal: controller.signal });
      clearTimeout(timeout);

      return { success: true, data: result.response.text(), keyObj };

    } catch (error) {
      lastError = error;
      const keyObj = API_KEYS[(currentKeyIndex - 1 + API_KEYS.length) % API_KEYS.length];
      const isQuotaError = 
        error.message?.includes('quota') ||
        error.message?.includes('429') ||
        error.message?.includes('RESOURCE_EXHAUSTED');
      markKeyAsFailed(keyObj, isQuotaError);
      console.warn(`⚠️ Tentative ${attempt + 1}/${maxRetries} échouée`);
      if (attempt === maxRetries - 1) {
        break;
      }
    }
  }

  return { success: false, error: lastError };
}

// ========================================
// ROUTE PRINCIPALE /api/chat
// ========================================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, key, devices = [] } = req.body;
    if (key !== AUTH_KEY) return res.status(401).json({ reply: "Clé d'authentification invalide", execute: [], planning_commands: [] });
    if (!message) return res.status(400).json({ reply: "Message requis", execute: [], planning_commands: [] });
    if (API_KEYS.length === 0) return res.status(500).json({ reply: "Erreur: Aucune clé API Gemini configurée.", execute: [], planning_commands: [] });

    console.log('┌────────────────────────────────────────┐');
    console.log('🔥 MESSAGE:', message);
    
    const currentTime = getCurrentTimeFormatted();
    console.log('🕐 HEURE INJECTÉE:', currentTime);

    const startTime = Date.now();
    const result = await chatWithRetry(message, devices, currentTime);

    if (!result.success) {
      console.error('💥 TOUTES LES CLÉS ONT ÉCHOUÉ');
      if (result.error && result.error.name === 'AbortError') return res.status(504).json({ reply: "La demande a pris trop de temps. Veuillez réessayer.", execute: [], planning_commands: [] });
      return res.status(503).json({ reply: "Désolé, le service est temporairement indisponible. Réessayez dans quelques instants.", execute: [], planning_commands: [] });
    }

    const aiText = result.data;
    console.log(`⏱️ Temps de réponse: ${Date.now() - startTime}ms`);

    let aiJson;
    try {
      aiJson = JSON.parse(aiText);
    } catch (parseError) {
      console.error('❌ ERREUR PARSING:', parseError.message);
      const cleaned = aiText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
      try { aiJson = JSON.parse(cleaned); console.log('✅ JSON récupéré après nettoyage'); } 
      catch (secondError) { 
        console.error('❌ ÉCHEC NETTOYAGE:', secondError.message);
        return res.json({ reply: "Désolé, j'ai eu un problème de communication. Pouvez-vous reformuler autrement ?", execute: [], planning_commands: [] });
      }
    }

    if (!aiJson.reply || typeof aiJson.reply !== 'string') aiJson.reply = "Commande reçue.";
    if (!Array.isArray(aiJson.execute)) aiJson.execute = [];
    if (!Array.isArray(aiJson.planning_commands)) aiJson.planning_commands = [];
    
    aiJson.reply = aiJson.reply.replace(/<[^>]*>/g, '').trim();

    console.log('✅ RÉPONSE FINALE:');
    console.log('└────────────────────────────────────────┘\n');

    res.json(aiJson);
    
  } catch (error) {
    console.error('💥 ERREUR SERVEUR:', error.message);
    res.status(500).json({ reply: "Désolé, une erreur s'est produite. Veuillez réessayer.", execute: [], planning_commands: [] });
  }
});

// ========================================
// ROUTE DE SANTÉ (HEALTH CHECK)
// ========================================
app.get('/api/health', (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  res.json({ status: 'ok', version: '3.1', keys: { total: API_KEYS.length, available: availableKeys }, timestamp: new Date().toISOString() });
});

// ========================================
// DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v3.1 - HEURE ACTUELLE OK   ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur démarré sur le port ${PORT}`);
});
