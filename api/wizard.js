import OpenAI from 'openai';
import lands from "../data/lands.js";
import { haversineDistance } from "../lib/geo.js";

const DISNEYLAND_ID = "7340550b-c14d-4def-80bb-acdb51d49a66"; 
const MAGIC_KINGDOM_ID = "75ea578a-adc8-4116-a54d-dccb60765ef9"

const DEFAULT_MAX_DISTANCE_METERS = 800;
const WEIGHT_PROFILES = {
    SCORE_BALANCED: { waitFactor: 1.0, distanceFactor: 1.0 }, // Standard (50/50 importance)
    WAIT_ONLY:      { waitFactor: 100.0, distanceFactor: 0.001 }, // Prioritize wait heavily
    DISTANCE_ONLY:  { waitFactor: 0.001, distanceFactor: 100.0 }  // Prioritize distance heavily
};
const WAIT_DIVISOR = 6;  // Used in original scoring: (60 - wait) / 6
const DIST_DIVISOR = 100; // Used in original scoring: (1000 - distance) / 100

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


async function getParkSnapshot(userPrefs) {
  const userCoords = lands.magicKingdom[userPrefs.land];
  if (!userCoords) throw new Error(`Invalid land specified: ${userPrefs.land}`);

  const maxDistance = userPrefs.maxDistance ?? DEFAULT_MAX_DISTANCE_METERS;

  try {
    // 1. Extract the nested arrays
    const [childrenResponse, liveResponse] = await Promise.all([
      fetchData(`https://api.themeparks.wiki/v1/entity/${MAGIC_KINGDOM_ID}/children`),
      fetchData(`https://api.themeparks.wiki/v1/entity/${MAGIC_KINGDOM_ID}/live`)
    ])

    const children = childrenResponse?.children;
    const live = liveResponse?.liveData;

    if (!Array.isArray(children) || !Array.isArray(live)) {
      throw new Error("API returned data in an unexpected format.")
    }

    // 2. Map creation and processing
    const liveMap = new Map(live.map(l => [l.id, l]))
    
    const snapshot = children.reduce((accum, entity) => {
      if (entity.entityType !== "ATTRACTION") return accum;

      const liveEntry = liveMap.get(entity.id);
      if (liveEntry?.status !== "OPERATING") return accum;

      const listedWaitMinutes = liveEntry.queue?.STANDBY?.waitTime ?? null;
      if (listedWaitMinutes === null) return accum;

      const { latitude: lat, longitude: lon } = entity.location || {};
      if (!lat || !lon) return accum;

      const distance = haversineDistance(userCoords.lat, userCoords.lon, lat, lon);
      if (distance > maxDistance) return accum;

      const profile = WEIGHT_PROFILES[userPrefs.priorityMode] || WEIGHT_PROFILES.SCORE_BALANCED;
      const { waitFactor, distanceFactor } = profile;

      // Scoring Logic: Apply the dynamic factor to each component
      const distanceScore = Math.max(0, (1000 - distance) / DIST_DIVISOR);
      const waitScore = Math.max(0, (60 - listedWaitMinutes) / WAIT_DIVISOR);
      
      // Apply factors based on priorityMode
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
    console.log(recommendations)
    return recommendations;

  } catch(error) {
    console.error("Failed to generate park snapshot:", error);
    throw new Error('Unable to retrieve ride data at this time.');
  }
}


export default async function handler(request, response) {
  // 1. Method Check
  if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Only POST allowed' });
  }

  // 2. Validate/Parse Request Body
  const userPrefs = request.body?.userPrefs;
  if (!userPrefs || !userPrefs.land || typeof userPrefs.maxDistance !== 'number' || !userPrefs.groupType || !userPrefs.priorityMode) {
      return response.status(400).json({ 
          error: 'Missing required userPrefs. Ensure all fields are provided.' 
      });
  }


  try {
    // 3. Get Ride Recommendations
    const recommendations = await getParkSnapshot(userPrefs);

    let finalResponse = {
      recommendations,
      summary: "Yen Sid's magic is working! Your personalized suggestions are below."
    }

    if (recommendations.length === 0) {
      return response.status(200).json({
          recommendations: [],
          summary: "Yen Sid could not find any suitable or open attractions based on your preferences and location right now. Try expanding your walking distance or checking back later! 😔"
      });
    }

    // 2. OpenAI Integration for Natural Language Summary
    if (recommendations.length > 0 && process.env.OPEN_API_KEY) {
        
        const recommendationsText = recommendations.map(r => 
            // We include all necessary details: name, wait time, distance, and the score.
            `[${r.name}] Wait: ${r.listedWaitMinutes} min | Distance: ${r.distanceMeters}m | Score: ${r.score.toFixed(1)}`
        ).join('\n');
        
        let priorityLabel;
        if (userPrefs.priorityMode === 'WAIT_ONLY') priorityLabel = "shortest wait time";
        else if (userPrefs.priorityMode === 'DISTANCE_ONLY') priorityLabel = "closest proximity";
        else priorityLabel = "best balance of wait and proximity";

        // Craft the detailed prompt
        const prompt = `Yen Sid is advising a guest. The group type is "${userPrefs.groupType}". The primary optimization goal is finding the ${priorityLabel}.

        Based on the following top-ranked rides (which have already been scored and filtered):
        ${recommendationsText}

        **Your Task:** Review this ranked list. Filter out any ride that is unsuitable or inappropriate for a group of type "${userPrefs.groupType}". Write a fun, enthusiastic, one-paragraph summary (max 3 sentences). Highlight the **top 1 or 2 suitable and available rides** by name and explain why they are the perfect choice given the current data and the guest's goal (${priorityLabel}). The response must be addressed from "Yen Sid". Do not include the raw score, wait time, or distance data in the final paragraph.`;

        // Call the OpenAI API
        const completion = await client.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "gpt-3.5-turbo", 
        });

        // Update the summary with the AI's response
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
