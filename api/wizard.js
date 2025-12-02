import OpenAI from 'openai';
import lands from "../data/lands.js";
import { haversineDistance } from "../lib/geo.js";

const DISNEYLAND_ID = "7340550b-c14d-4def-80bb-acdb51d49a66"; 
const MAGIC_KINGDOM_ID = "75ea578a-adc8-4116-a54d-dccb60765ef9"

const DEFAULT_MAX_DISTANCE_METERS = 800;
const PREFS_WEIGHTS = { distance: 100, wait: 6 };

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

      // Scoring logic
      const distanceScore = Math.max(0, (1000 - distance) / PREFS_WEIGHTS.distance);
      const waitScore = Math.max(0, (60 - listedWaitMinutes) / PREFS_WEIGHTS.wait);

      accum.push({
        id: entity.id,
        name: entity.name,
        entityType: entity.entityType,
        status: liveEntry.status,
        distanceMeters: Math.round(distance),
        listedWaitMinutes,
        score: distanceScore + waitScore
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
  // 1. Method Check
  if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Only POST allowed' });
  }

  // 2. Validate/Parse Request Body
  const userPrefs = request.body?.userPrefs;
  if (!userPrefs || !userPrefs.land || typeof userPrefs.maxDistance !== "number") {
    return response.status(400).json({
      error: "Missing or invalid required userPrefs. Ensure land and maxDistance are provided."
    });
  }

  try {
    // 3. Get Ride Recommendations
    const recommendations = await getParkSnapshot(userPrefs);

    let finalResponse = {
      recommendations
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