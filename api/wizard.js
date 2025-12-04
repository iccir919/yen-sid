import OpenAI from 'openai';
import lands from "../data/lands.js"; // Assuming this file exists and contains land coordinates
import { haversineDistance } from "../lib/geo.js"; // Assuming this function exists

const DISNEYLAND_ID = "7340550b-c14d-4def-80bb-acdb51d49a66"; 
const MAGIC_KINGDOM_ID = "75ea578a-adc8-4116-a54d-dccb60765ef9";
const PARK_IDS = {
    'disneyland': DISNEYLAND_ID,
    'magic_kingdom': MAGIC_KINGDOM_ID
};

const DEFAULT_MAX_DISTANCE_METERS = 800; 
const WEIGHT_PROFILES = {
    SCORE_BALANCED: { waitFactor: 1.0, distanceFactor: 1.0 }, 
    WAIT_ONLY:      { waitFactor: 100.0, distanceFactor: 0.001 },
    DISTANCE_ONLY:  { waitFactor: 0.001, distanceFactor: 100.0 }
};
const WAIT_DIVISOR = 6;
const DIST_DIVISOR = 100;

// Ensure OPEN_API_KEY is set in your Vercel environment variables
const client = new OpenAI({
    apiKey: process.env.OPEN_API_KEY,
});

async function fetchData(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getParkSnapshot(userPrefs, parkId) {
  const parkLandData = parkId === MAGIC_KINGDOM_ID ? lands.magicKingdom : lands.disneyland;

  const userCoords = parkLandData[userPrefs.land];
  if (!userCoords) throw new Error(`Invalid land specified: ${userPrefs.land}`);

  try {
    const [childrenResponse, liveResponse] = await Promise.all([
      fetchData(`https://api.themeparks.wiki/v1/entity/${parkId}/children`),
      fetchData(`https://api.themeparks.wiki/v1/entity/${parkId}/live`)
    ])

    const children = childrenResponse?.children;
    const live = liveResponse?.liveData;

    if (!Array.isArray(children) || !Array.isArray(live)) {
      throw new Error("API returned data in an unexpected format.")
    }

    const liveMap = new Map(live.map(l => [l.id, l]))
    
    const snapshot = children.reduce((accum, entity) => {
      // 1. Basic Filters 
      if (entity.entityType !== "ATTRACTION") return accum;
      const liveEntry = liveMap.get(entity.id);
      if (liveEntry?.status !== "OPERATING") return accum;
      const listedWaitMinutes = liveEntry.queue?.STANDBY?.waitTime ?? null;
      if (listedWaitMinutes === null) return accum;
      const { latitude: lat, longitude: lon } = entity.location || {};
      if (!lat || !lon) return accum;

      const distance = haversineDistance(userCoords.lat, userCoords.lon, lat, lon);

      // 2. Scoring Logic
      const profile = WEIGHT_PROFILES[userPrefs.priorityMode] || WEIGHT_PROFILES.SCORE_BALANCED;
      const { waitFactor, distanceFactor } = profile;

      const distanceScore = Math.max(0, (1000 - distance) / DIST_DIVISOR); 
      const waitScore = Math.max(0, (60 - listedWaitMinutes) / WAIT_DIVISOR);
      
      const score = (distanceScore * distanceFactor) + (waitScore * waitFactor);

      accum.push({
        id: entity.id,
        name: entity.name,
        entityType: entity.entityType,
        status: liveEntry.status,
        distanceMeters: Math.round(distance),
        listedWaitMinutes,
        score
      })

      return accum;
    }, [])

    const recommendations = snapshot
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);
      
    return recommendations;

  } catch(error) {
    console.error("Failed to generate park snapshot:", error);
    throw new Error('Unable to retrieve ride data at this time.');
  }
}


export default async function handler(request, response) {
  if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Only POST allowed' });
  }

  // Destructure 'weather' directly from the body
  const { park, userPrefs, weather } = request.body; 
  const parkId = PARK_IDS[park];

  if (!park || !parkId) {
      return response.status(400).json({ error: 'Missing or invalid park selection.' });
  }

  // VALIDATION: Checks for land and priorityMode
  if (!userPrefs || !userPrefs.land || !userPrefs.priorityMode) {
      return response.status(400).json({ 
          error: 'Missing required userPrefs. Ensure land and priorityMode are provided.' 
      });
  }

  try {
    const recommendations = await getParkSnapshot(userPrefs, parkId);

    let finalResponse = {
      recommendations,
      summary: "Yen Sid's magic is working! Your personalized suggestions are below."
    }

    if (recommendations.length === 0) {
      return response.status(200).json({
          recommendations: [],
          summary: "Yen Sid could not find any suitable or open attractions based on your preferences and location right now. Try adjusting your priority mode or checking back later! 😔"
      });
    }

    if (recommendations.length > 0 && process.env.OPEN_API_KEY) {
        
        const recommendationsText = recommendations.map(r => 
            `Name: ${r.name} | Wait: ${r.listedWaitMinutes} min | Distance: ${r.distanceMeters}m | Score: ${r.score.toFixed(1)}`
        ).join('\n');
        
        let priorityLabel;
        if (userPrefs.priorityMode === 'WAIT_ONLY') priorityLabel = "shortest wait time";
        else if (userPrefs.priorityMode === 'DISTANCE_ONLY') priorityLabel = "closest proximity";
        else priorityLabel = "best balance of wait and proximity";

        // Use the weather variable from the request body
        const currentWeather = weather || "Weather data is unavailable.";
        
        const prompt = `Yen Sid is advising a guest. The primary optimization goal is finding the ${priorityLabel}.
        
        **Current Park Weather:** ${currentWeather}

        Based on the following top-ranked rides (which have already been scored and filtered by wait/distance):
        ${recommendationsText}

        **Your Task:** Review this ranked list and the **current weather**. Write a fun, enthusiastic, one-paragraph summary (max 3 sentences). If the weather suggests **avoiding outdoor rides** (e.g., mention of rain, storms, or extreme heat/cold), prioritize indoor or covered rides from the list. Highlight the **top 1 or 2 suitable and available rides** by name and explain why they are the perfect choice given the current data, weather, and the guest's goal (${priorityLabel}). The response must be addressed from "Yen Sid". Do not include the raw score, wait time, or distance data in the final paragraph.`;

        const completion = await client.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "gpt-3.5-turbo", 
        });

        finalResponse.summary = completion.choices[0].message.content.trim();
    }

    return response.status(200).json(finalResponse)
  } catch(error) {
    console.error("Handler Error:", error.message);
    return response.status(500).json({
      error: "An internal error occurred while processing the request.",
      details: error.message
    })
  }
}