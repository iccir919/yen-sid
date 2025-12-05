import OpenAI from 'openai';
import lands from "../data/lands.js";
import { haversineDistance } from "../lib/geo.js";

const DISNEYLAND_ID = "7340550b-c14d-4def-80bb-acdb51d49a66"; 
const MAGIC_KINGDOM_ID = "75ea578a-adc8-4116-a54d-dccb60765ef9";
const PARK_IDS = {
    'disneyland': DISNEYLAND_ID,
    'magic_kingdom': MAGIC_KINGDOM_ID
};

// Scoring configuration
const WEIGHT_PROFILES = {
    SCORE_BALANCED: { waitFactor: 1.0, distanceFactor: 1.0 }, 
    WAIT_ONLY:      { waitFactor: 100.0, distanceFactor: 0.001 },
    DISTANCE_ONLY:  { waitFactor: 0.001, distanceFactor: 100.0 }
};

// Score normalization divisors
const WAIT_DIVISOR = 6;  // Normalizes wait times (0-60 min range)
const DIST_DIVISOR = 100; // Normalizes distances (0-1000m range)

const client = new OpenAI({
    apiKey: process.env.OPEN_API_KEY,
});

/**
 * Fetches data from a URL and handles errors uniformly
 * @param {string} url - The API endpoint to fetch from
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If the request fails
 */
async function fetchData(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}


/**
 * Get recommendations when park is CLOSED - returns all rides sorted by distance only
 * @param {Object} userPrefs - User preferences (land, priorityMode)
 * @param {string} parkId - The park identifier
 * @returns {Promise<Array>} Array of ride recommendations
 */
async function getParkSnapshotClosed(userPrefs, parkId) {
  const parkLandData = parkId === MAGIC_KINGDOM_ID ? lands.magicKingdom : lands.disneyland;
  const userCoords = parkLandData[userPrefs.land];
  
  if (!userCoords) {
    throw new Error(`Invalid land specified: ${userPrefs.land}`);
  }

  try {
    const childrenResponse = await fetchData(
      `https://api.themeparks.wiki/v1/entity/${parkId}/children`
    );
    
    const children = childrenResponse?.children;

    if (!Array.isArray(children)) {
      throw new Error("API returned data in an unexpected format.");
    }

    // Build snapshot of all attractions
    const snapshot = children.reduce((accum, entity) => {
      // Only include attractions
      if (entity.entityType !== "ATTRACTION") return accum;
      
      // Get location data - skip if missing
      const { latitude: lat, longitude: lon } = entity.location || {};
      if (!lat || !lon) return accum;

      const distance = haversineDistance(
        userCoords.lat, 
        userCoords.lon, 
        lat, 
        lon
      );
      
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

    // Sort by distance (lowest score = closest) and return top 10
    return snapshot
      .sort((a, b) => a.score - b.score)
      .slice(0, 10); // Return more when closed since people are planning

  } catch(error) {
    console.error("Failed to generate park snapshot (closed):", error);
    throw new Error('Unable to retrieve ride data at this time.');
  }
}


/**
 * Get recommendations when park is OPEN - filters by status and considers wait times
 * @param {Object} userPrefs - User preferences (land, priorityMode)
 * @param {string} parkId - The park identifier
 * @returns {Promise<Array>} Array of ride recommendations
 */
async function getParkSnapshotOpen(userPrefs, parkId) {
  const parkLandData = parkId === MAGIC_KINGDOM_ID ? lands.magicKingdom : lands.disneyland;
  const userCoords = parkLandData[userPrefs.land];
  
  if (!userCoords) {
    throw new Error(`Invalid land specified: ${userPrefs.land}`);
  }

  try {
    // Fetch both static and live data in parallel
    const [childrenResponse, liveResponse] = await Promise.all([
      fetchData(`https://api.themeparks.wiki/v1/entity/${parkId}/children`),
      fetchData(`https://api.themeparks.wiki/v1/entity/${parkId}/live`)
    ]);

    const children = childrenResponse?.children;
    const live = liveResponse?.liveData;

    if (!Array.isArray(children) || !Array.isArray(live)) {
      throw new Error("API returned data in an unexpected format.");
    }

    // Create a Map for O(1) lookup of live data by attraction ID
    const liveMap = new Map(live.map(l => [l.id, l]));
    
    const snapshot = children.reduce((accum, entity) => {
      // Only include attractions
      if (entity.entityType !== "ATTRACTION") return accum;
      
      // Get location data - skip if missing
      const { latitude: lat, longitude: lon } = entity.location || {};
      if (!lat || !lon) return accum;

      // Get live data for this attraction
      const liveEntry = liveMap.get(entity.id);
      const status = liveEntry?.status || "UNKNOWN";
      
      // Only include OPERATING attractions when park is open
      if (status !== "OPERATING") return accum;
      
      // Extract wait time (default to 0 if unavailable)
      let listedWaitMinutes = 0;
      if (liveEntry?.queue?.STANDBY?.waitTime != null) {
        listedWaitMinutes = liveEntry.queue.STANDBY.waitTime;
      }

      // Calculate distance from user's location
      const distance = haversineDistance(
        userCoords.lat, 
        userCoords.lon, 
        lat, 
        lon
      );

      // Apply user's priority profile to calculate final score
      const profile = WEIGHT_PROFILES[userPrefs.priorityMode] || WEIGHT_PROFILES.SCORE_BALANCED;
      const { waitFactor, distanceFactor } = profile;

      // Normalize metrics and calculate weighted score (higher is better)
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

    // Sort by score (highest first) and return top 7
    return snapshot
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);

  } catch(error) {
    console.error("Failed to generate park snapshot (open):", error);
    throw new Error('Unable to retrieve ride data at this time.');
  }
}


/**
 * Generates the AI-powered summary text using OpenAI
 * @param {Array} recommendations - Array of ride recommendations
 * @param {Object} userPrefs - User preferences
 * @param {string} weather - Current weather description
 * @param {string} parkStatus - Park status (OPEN/CLOSED)
 * @param {Object|null} ticketedEvent - Special event info if applicable
 * @returns {Promise<string>} AI-generated summary text
 */
async function generateAISummary(recommendations, userPrefs, weather, parkStatus, ticketedEvent) {
  const recommendationsText = recommendations
    .map(r => `Name: ${r.name} | Wait: ${r.listedWaitMinutes} min | Distance: ${r.distanceMeters}m | Score: ${r.score.toFixed(1)}`)
    .join('\n');
  
  // Map priority mode to human-readable label
  const priorityLabels = {
    'WAIT_ONLY': "shortest wait time",
    'DISTANCE_ONLY': "closest proximity",
    'SCORE_BALANCED': "best balance of wait and proximity"
  };
  const priorityLabel = priorityLabels[userPrefs.priorityMode] || "best balance of wait and proximity";

  const currentWeather = weather || "Weather data is unavailable.";
  
  // Build context for special park conditions
  let parkStatusContext = "";
  if (parkStatus === "CLOSED") {
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

  return completion.choices[0].message.content.trim();
}


/**
 * Main API handler for ride recommendations
 */
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
    // Route to appropriate snapshot function based on park status
    const isParkClosed = parkStatus === "CLOSED" || isOpen === false;
    const recommendations = isParkClosed
      ? await getParkSnapshotClosed(userPrefs, parkId)
      : await getParkSnapshotOpen(userPrefs, parkId);

    // Handle case where no recommendations found
    if (recommendations.length === 0) {
      return response.status(200).json({
        recommendations: [],
        summary: "Yen Sid could not find any suitable or open attractions based on your preferences and location right now. Try adjusting your priority mode or checking back later! 😔"
      });
    }

    // Build response object
    const finalResponse = {
      recommendations,
      summary: "Yen Sid's magic is working! Your personalized suggestions are below."
    };

    // Generate AI summary if OpenAI key is configured
    if (process.env.OPEN_API_KEY) {
      try {
        finalResponse.summary = await generateAISummary(
          recommendations,
          userPrefs,
          weather,
          parkStatus,
          ticketedEvent
        );
      } catch (aiError) {
        console.error("AI summary generation failed:", aiError);
        // Keep the default summary if AI generation fails
      }
    }

    return response.status(200).json(finalResponse);

  } catch(error) {
    console.error("Handler Error:", error.message);
    return response.status(500).json({
      error: "An internal error occurred while processing the request.",
      details: error.message
    });
  }
}