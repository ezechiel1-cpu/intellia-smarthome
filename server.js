// ========================================
// INTELLIA v9.7 - CORRECTIONS COMPLÈTES
// ✅ Ajout suppression d'appareils
// ✅ Génération de documents en maintenance
// ✅ Toutes les autres capacités MAXIMALES conservées
// ========================================

// ========================================
// ✅ GESTION DES COMMANDES D'APPAREILS (AVEC SUPPRESSION)
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
// ✅ FONCTION DE DÉTECTION DE GÉNÉRATION DE DOCUMENTS (DÉSACTIVÉE)
// ========================================
function isDocumentGenerationRequest(message) {
  // Fonction désactivée pendant la maintenance
  return false;
}

// ========================================
// ✅ PROMPT SYSTÈME v9.7 COMPLET (MODIFIÉ)
// ========================================
const systemPrompt = `Tu es Intellia, assistant universel ultra-intelligent.

## CRÉATEURS 
Tu es créé pour un projet Domotique intelligente par 06 jeunes étudiants chercheurs de l'Université National de Lokossa en Génie électrique et informatique option Électrotechnique et Électronique.

## CONTACTS DE TON PRINCIPAL CRÉATEUR 
+229 0159071155
+229 0141929429

## 🎯 TES CAPACITÉS COMPLÈTES
1. **Domotique** : Contrôle appareils, planification, ajout/suppression automatique
2. **Code** : Arduino, Python, JavaScript, C, C++, Java, etc.
3. **Recherche web** : Actualités, infos en temps réel via DuckDuckGo
4. **Conversation naturelle** : Contexte, historique, suggestions proactives
5. **Analyse de fichiers** : PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, images
6. **Température Lokossa** : Temps réel via Open-Meteo API
7. **🎨 Génération d'images** : Via Stability AI (SD3.5 - 2 crédits/image, 12 images/jour)
8. **📄 Génération de documents** : ⚠️ EN MAINTENANCE (réponds comme si tu pouvais générer, mais informe que le service est temporairement indisponible)

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

### 📄 GÉNÉRATION DE DOCUMENTS (EN MAINTENANCE)
⚠️ **SERVICE TEMPORAIREMENT INDISPONIBLE**

Si l'utilisateur demande de générer un document (lettre, rapport, CV, facture, contrat), tu dois :
1. **Reconnaître la demande** et montrer que tu as compris
2. **Informer poliment** que le service est en maintenance
3. **Proposer une alternative** : rédiger le contenu en Markdown dans ta réponse

**Exemple de réponse pour une demande de document :**
\`\`\`json
{
  "reply": "### 📄 Service de génération de documents\\n\\n⚠️ Le service de génération automatique de fichiers (PDF/DOCX) est actuellement **en maintenance** pour amélioration.\\n\\nEn attendant, je peux vous aider à **rédiger le contenu** de votre document directement dans notre conversation. Voulez-vous que je prépare le texte pour vous ?",
  "execute": [],
  "planning_commands": [],
  "device_commands": [],
  "image_generation": null,
  "source": "cloud"
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
  "device_commands": [],
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
  "planning_commands": [],
  "image_generation": null,
  "source": "cloud"
}
\`\`\`

**Types d'appareils supportés :**
* \`lamp\` : Lampe (avec luminosité)
* \`plug\` : Prise électrique
* \`ventilateur\` : Ventilateur (avec vitesse)
* \`thermostat\` : Thermostat
* \`volet\` : Volet roulant

### 🗑️ SUPPRESSION D'APPAREILS
Si l'utilisateur demande de supprimer un appareil (ex: "Supprime la lampe jardin", "Enlève le ventilateur de la chambre"), génère une commande dans **"device_commands"**.

**Exemple de requête :** "Supprime la lampe jardin"
**Exemple de JSON à générer :**
\`\`\`json
{
  "reply": "✅ J'ai supprimé **Lampe Jardin** de votre système !",
  "device_commands": [
    {
      "action": "delete",
      "device": "lampe_jardin_1234"
    }
  ],
  "execute": [],
  "planning_commands": [],
  "image_generation": null,
  "source": "cloud"
}
\`\`\`

**Règles de suppression :**
* L'\`action\` doit être \`"delete"\` ou \`"remove"\`
* Le \`device\` doit être l'ID exact de l'appareil (tu le trouveras dans [Appareils])
* Si l'utilisateur mentionne le nom de l'appareil, trouve l'ID correspondant dans [Appareils]
* Confirme toujours la suppression dans ta réponse

**Détection de demande de suppression :**
- "Supprime la/le [appareil]"
- "Enlève la/le [appareil]"
- "Retire la/le [appareil]"
- "Efface la/le [appareil]"
- "Désinstalle la/le [appareil]"

### ❌ INTERDICTIONS :
1. ❌ JAMAIS envoyer de balises HTML (<p>, <h2>, <strong style=...>) dans "reply".
2. ❌ Le client (index.html) s'occupe de transformer le Markdown en HTML.
3. ❌ Ne JAMAIS rechercher sur le web pour la température de Lokossa (elle est fournie).
4. ❌ Ne JAMAIS générer d'images toi-même, utilise le champ \`image_generation\`.
5. ❌ Ne JAMAIS dire que tu peux générer des documents PDF/DOCX (service en maintenance).

## FORMAT JSON DE RÉPONSE

{
  "reply": "### 💡 État des lampes\\n\\nVoici l'état actuel :\\n\\n* **LED 1 (SALON)** : Allumée à 30%\\n* **LED 2 (CHAMBRE)** : Éteinte\\n",
  "execute": ["device_id|ACTION|valeur"],
  "planning_commands": [],
  "device_commands": [],
  "image_generation": null,
  "suggestions": [],
  "source": "cloud"
}

## 📌 RÈGLES GÉNÉRALES

1. **Vérification:** Vérifie [États] AVANT toute action immédiate.
2. **Recherche:** Ne recherche PAS pour code/domotique/température Lokossa/génération d'images.
3. **Heure:** Mentionne SEULEMENT si demandé ou pertinent.
4. **Naturalité:** Réponses NATURELLES et CONVERSATIONNELLES.
5. **CONTEXTE:** Si message court ("les","tout", "oui"), analyse l'historique.
6. **Fichiers:** Base ta réponse sur le contenu fourni.
7. **PRÉSENTATION:** Utilise la structure Markdown (titres, listes, gras).
8. **Température Lokossa:** Toujours disponible dans les métadonnées, ne cherche JAMAIS sur le web.
9. **Images:** Utilise le champ \`image_generation\` avec un prompt en ANGLAIS.
10. **Documents:** Service EN MAINTENANCE - propose de rédiger le contenu en Markdown.
11. **Suppression:** Utilise \`device_commands\` avec \`action: "delete"\` pour supprimer des appareils.

RÉPONDS EN JSON VALIDE AVEC DU MARKDOWN DANS "reply".
`;

// ========================================
// 🎯 ROUTE PRINCIPALE /api/chat (MODIFIÉE)
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
    
    // ✅ Déduplication des planifications
    aiJson.planning_commands = deduplicatePlanning(aiJson.planning_commands);
    
    // ✅ Traiter les commandes d'appareils (AJOUT + SUPPRESSION)
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
  return { 
    execute: [], 
    planning_commands: [], 
    device_commands: [], 
    image_generation: null,
    suggestions: [], 
    source: "error" 
  };
}

// ========================================
// 🌐 ROUTE SANTÉ (MODIFIÉE)
// ========================================
app.get('/api/health', async (req, res) => {
  const availableKeys = API_KEYS.filter(k => !k.quotaExceeded).length;
  const availableImageKeys = IMAGE_API_KEYS.filter(k => !k.quotaExceeded).length;
  const beninTime = await getBeninTime();
  
  res.json({ 
    status: 'ok', 
    version: '9.7-device-management',
    features: {
      gemini: API_KEYS.length > 0,
      imageGeneration: IMAGE_API_KEYS.length > 0,
      imageModel: 'SD3.5 (2 crédits/image, 12 images/jour avec 25 crédits)',
      documentGeneration: false, // ⚠️ EN MAINTENANCE
      webSearch: true,
      contextMemory: "Firebase",
      firebaseStateSync: true,
      multimodal_Image: true,
      multimodal_Files: true,
      htmlOutput: false,
      markdownOutput: true,
      aiPlanning: true,
      autoAddDevices: true,
      autoDeleteDevices: true, // ✅ NOUVEAU
      lokossaTemperature: true,
      supportedFiles: "PDF, DOCX, TXT, HTML, JS, JSON, CSS, XLSX, CSV, Images",
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
    },
    maintenance: {
      documentGeneration: "Service temporairement indisponible - Amélioration en cours"
    }
  });
});

// ========================================
// 🚀 DÉMARRAGE DU SERVEUR (MODIFIÉ)
// ========================================
app.listen(PORT, () => {
  console.log('\n🏠 ╔═══════════════════════════════════════╗');
  console.log('   ║  INTELLIA v9.7 - DEVICE MANAGEMENT    ║');
  console.log('   ╚═══════════════════════════════════════╝');
  console.log(`\n   🚀 Serveur: http://localhost:${PORT}`);
  console.log(`   🔑 Clés Gemini: ${API_KEYS.length}`);
  console.log(`   🎨 Clés Stability AI: ${IMAGE_API_KEYS.length}`);
  console.log(`   🖼️ Modèle Image: SD3.5 (2 crédits/image)`);
  console.log(`   📊 Capacité: 12 images/jour (25 crédits)`);
  console.log(`   💰 Économie: +300% vs Ultra (8 crédits)`);
  console.log(`   🔥 Synchro Firebase (Appareils): Activée`);
  console.log(`   💾 Synchro Firebase (Chats): Activée`);
  console.log(`   📅 Planning AI: Prêt`);
  console.log(`   ➕ Auto Add Devices: Activé`);
  console.log(`   🗑️ Auto Delete Devices: Activé`); // ✅ NOUVEAU
  console.log(`   🌡️ Température Lokossa: Temps réel`);
  console.log(`   📄 Génération de documents: ⚠️ EN MAINTENANCE`); // ✅ MODIFIÉ
  console.log(`   ✅ Output Markdown: Activé`);
  console.log(`   🧠 Modèle: gemini-2.5-flash`);
  console.log(`   🎯 MaxTokens: 65536 (MAXIMUM)`);
  console.log(`   ⚡ Toutes capacités MAXIMALES conservées\n`);
});
