import OpenAI from 'openai';
import lands from "../data/lands.js";
import { haversineDistance } from "../lib/geo.js";

const DISNEYLAND_ID = "7340550b-c14d-4def-80bb-acdb51d49a66"; 
const MAGIC_KINGDOM_ID = "75ea578a-adc8-4116-a54d-dccb60765ef9"

// const client = new OpenAI({
//     apiKey: process.env.OPEN_API_KEY,
// });

const userPrefs = {
  land: 'adventureland',
  openToShows: false,
  hasLightningLane: true
};


function calculateEffectiveWait(liveEntry, userPrefs, now) {

}


async function getParkSnapshot(userPrefs) {
    const userCoords = lands.magicKingdom[userPrefs.land];
    if (!userCoords) throw new Error('Invalid land specified');

  const [parkRes, liveRes] = await Promise.all([
    fetch(`https://api.themeparks.wiki/v1/entity/${MAGIC_KINGDOM_ID}/children`),
    fetch(`https://api.themeparks.wiki/v1/entity/${MAGIC_KINGDOM_ID}/live`)
  ]);
  const park = await parkRes.json();
  const live = await liveRes.json();
  const liveDataMap = new Map(live.liveData.map(l => [l.id, l]));

  const now = new Date();
  let snapshot = park.children
    .filter(entity => entity.entityType !== "RESTAURANT")
    .map(entity => {
      const liveEntry = liveDataMap.get(entity.id);
      // const effectiveWait = calculateEffectiveWait(liveEntry, userPrefs, now);
      
      const lat = entity.location?.latitude;
      const lon = entity.location?.longitude;
      const distance = (lat && lon) ? haversineDistance(userCoords.lat, userCoords.lon, lat, lon) : null;

      return {
        id: entity.id,
        name: entity.name,
        type: entity.entityType,
        status: liveEntry.status,
        distanceMeters: distance,
      };
    })
  console.log(snapshot);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Only POST allowed' });
    }

    


    return res.status(200).json({ answer: 'Handler is set up correctly' });
}

await getParkSnapshot(userPrefs)