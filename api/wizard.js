import OpenAI from 'openai';
import lands from "../data/lands.js";
import { haversineDistance } from "../lib/geo.js";

const DISNEYLAND_ID = "7340550b-c14d-4def-80bb-acdb51d49a66"; 
const MAGIC_KINGDOM_ID = "75ea578a-adc8-4116-a54d-dccb60765ef9";
const PARK_IDS = {
    'disneyland': DISNEYLAND_ID,
    'magic_kingdom': MAGIC_KINGDOM_ID
};

const WEIGHT_PROFILES = {
    SCORE_BALANCED: { waitFactor: 1.0, distanceFactor: 1.0 }, 
    WAIT_ONLY:      { waitFactor: 100.0, distanceFactor: 0.001 },
    DISTANCE_ONLY:  { waitFactor: 0.001, distanceFactor: 100.0 }
};
const WAIT_DIVISOR = 6;
const DIST_DIVISOR = 100;

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


/**
 * Get recommendations when park is CLOSED - returns all rides sorted by distance only
 */
async function getParkSnapshotClosed(userPrefs, parkId) {
  const parkLandData = parkId === MAGIC_KINGDOM_ID ? lands.magicKingdom : lands.disneyland;
  const userCoords = parkLandData[userPrefs.land];
  
  if (!userCoords) throw new Error(`Invalid land specified: ${userPrefs.land}`);

  try {
    const childrenResponse = await fetchData(`https://api.themeparks.wiki/v1/entity/${parkId}/children`);
    const children = childrenResponse?.children;

    if (!Array.isArray(children)) {
      throw new Error("API returned data in an unexpected format.");
    }

    const snapshot = children.reduce((accum, entity) => {
      // Only include attractions
      if (entity.entityType !== "ATTRACTION") return accum;
      
      // Get location data - skip if missing
      const { latitude: lat, longitude: lon } = entity.location || {};
      if (!lat || !lon) return accum;

      const distance = haversineDistance(userCoords.lat, userCoords.lon, lat, lon);
      
      // Simple distance-only score (lower distance = better)
      const score = distance / DIST_DIVISOR;

      accum.push({
        id: entity.id,
        name: entity.name,
        entityType: entity.entityType,
        status: "CLOSED", // Park is closed, so mark all as closed
        distanceMeters: Math.round(distance),
        listedWaitMinutes: 0, // No wait times when closed
        score
      });

      return accum;
    }, []);

    // Sort by distance (lowest score = closest)
    const recommendations = snapshot
      .sort((a, b) => a.score - b.score)
      .slice(0, 10); // Return more when closed since people are planning
      
    return recommendations;

  } catch(error) {
    console.error("Failed to generate park snapshot (closed):", error);
    throw new Error('Unable to retrieve ride data at this time.');
  }
}


/**
 * Get recommendations when park is OPEN - filters by status and considers wait times
 */
async function getParkSnapshotOpen(userPrefs, parkId) {
  const parkLandData = parkId === MAGIC_KINGDOM_ID ? lands.magicKingdom : lands.disneyland;
  const userCoords = parkLandData[userPrefs.land];
  
  if (!userCoords) throw new Error(`Invalid land specified: ${userPrefs.land}`);

  try {
    const [childrenResponse, liveResponse] = await Promise.all([
      fetchData(`https://api.themeparks.wiki/v1/entity/${parkId}/children`),
      fetchData(`https://api.themeparks.wiki/v1/entity/${parkId}/live`)
    ]);

    const children = childrenResponse?.children;
    const live = liveResponse?.liveData;

    if (!Array.isArray(children) || !Array.isArray(live)) {
      throw new Error("API returned data in an unexpected format.");
    }

    const liveMap = new Map(live.map(l => [l.id, l]));
    
    const snapshot = children.reduce((accum, entity) => {
      // Basic Filters 
      if (entity.entityType !== "ATTRACTION") return accum;
      
      // Get location data - skip if missing
      const { latitude: lat, longitude: lon } = entity.location || {};
      if (!lat || !lon) return accum;

      // Get live data for this attraction
      const liveEntry = liveMap.get(entity.id);
      const status = liveEntry?.status || "UNKNOWN";
      
      // Only include OPERATING attractions when park is open
      if (status !== "OPERATING") return accum;
      
      let listedWaitMinutes = 0;
      if (liveEntry?.queue?.STANDBY?.waitTime != null) {
        listedWaitMinutes = liveEntry.queue.STANDBY.waitTime;
      }

      const distance = haversineDistance(userCoords.lat, userCoords.lon, lat, lon);

      // Scoring Logic
      const profile = WEIGHT_PROFILES[userPrefs.priorityMode] || WEIGHT_PROFILES.SCORE_BALANCED;
      const { waitFactor, distanceFactor } = profile;

      const distanceScore = Math.max(0, (1000 - distance) / DIST_DIVISOR); 
      const waitScore = Math.max(0, (60 - listedWaitMinutes) / WAIT_DIVISOR);
      
      const score = (distanceScore * distanceFactor) + (waitScore * waitFactor);

      accum.push({
        id: entity.id,
        name: entity.name,
        entityType: entity.entityType,
        status: status,
        distanceMeters: Math.round(distance),
        listedWaitMinutes,
        score
      });

      return accum;
    }, []);

    const recommendations = snapshot
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);
      
    return recommendations;

  } catch(error) {
    console.error("Failed to generate park snapshot (open):", error);
    throw new Error('Unable to retrieve ride data at this time.');
  }
}


export default async function handler(request, response) {
  if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Only POST allowed' });
  }

  const { park, userPrefs, weather, parkStatus, isOpen, ticketedEvent } = request.body; 
  const parkId = PARK_IDS[park];

  if (!park || !parkId) {
      return response.status(400).json({ error: 'Missing or invalid park selection.' });
  }

  if (!userPrefs || !userPrefs.land || !userPrefs.priorityMode) {
      return response.status(400).json({ 
          error: 'Missing required userPrefs. Ensure land and priorityMode are provided.' 
      });
  }

  try {
    // Choose the appropriate function based on park status
    let recommendations;
    if (parkStatus === "CLOSED" || isOpen === false) {
      // Park is closed - use distance-only function
      recommendations = await getParkSnapshotClosed(userPrefs, parkId);
    } else {
      // Park is open - use full logic with wait times
      recommendations = await getParkSnapshotOpen(userPrefs, parkId);
    }

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

    // Generate AI summary if OpenAI key is available
    if (recommendations.length > 0 && process.env.OPEN_API_KEY) {
        
        const recommendationsText = recommendations.map(r => 
            `Name: ${r.name} | Wait: ${r.listedWaitMinutes} min | Distance: ${r.distanceMeters}m | Score: ${r.score.toFixed(1)}`
        ).join('\n');
        
        let priorityLabel;
        if (userPrefs.priorityMode === 'WAIT_ONLY') priorityLabel = "shortest wait time";
        else if (userPrefs.priorityMode === 'DISTANCE_ONLY') priorityLabel = "closest proximity";
        else priorityLabel = "best balance of wait and proximity";

        const currentWeather = weather || "Weather data is unavailable.";
        
        // Build park status context
        let parkStatusContext = "";
        if (parkStatus === "CLOSED" || isOpen === false) {
            parkStatusContext = "**IMPORTANT: The park is currently CLOSED.** These are all available attractions sorted by distance from the guest's current land. No wait times are shown because the park is not operating. Frame your recommendations as helpful planning for a future visit, and express hope that these suggestions will be useful when the guest returns. Emphasize that these are the closest attractions to explore when the park reopens.";
        } else if (ticketedEvent) {
            parkStatusContext = `**SPECIAL EVENT ALERT:** There is currently a ticketed event happening: "${ticketedEvent.description}". Mention this special event and how it might affect the guest's experience or create a magical atmosphere.`;
        }
        
        const prompt = `Yen Sid is advising a guest. The primary optimization goal is finding the ${priorityLabel}.
        
        **Current Park Weather:** ${currentWeather}
        
        ${parkStatusContext}

        Based on the following top-ranked rides (which have already been scored and filtered by wait/distance):
        ${recommendationsText}

        **Your Task:** Review this ranked list and the **current weather**${parkStatusContext ? " and **park status**" : ""}. Write a fun, enthusiastic, one-paragraph summary (max 3 sentences). If the weather suggests **avoiding outdoor rides** (e.g., mention of rain, storms, or extreme heat/cold), prioritize indoor or covered rides from the list. ${parkStatus === "CLOSED" ? "Since the park is closed, highlight the top 2-3 closest attractions and mention they'll be great to visit when the park reopens." : "Highlight the **top 1 or 2 suitable and available rides** by name and explain why they are the perfect choice given the current data, weather, and the guest's goal."} The response must be addressed from "Yen Sid". Do not include the raw score, wait time, or distance data in the final paragraph.`;

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