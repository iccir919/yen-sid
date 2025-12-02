
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Only POST allowed' });
    }


    return res.status(200).json({ answer: 'Handler is set up correctly' });

    const { land, hunger, energy, thrill, openToShows } = req.body;
}