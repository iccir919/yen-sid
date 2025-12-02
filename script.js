const form = document.getElementById('survey-form');
const resultsSection = document.getElementById('results');

form.addEventListener('submit', async function(event) {
    event.preventDefault();

    const userPreferences = {
        land: document.getElementById('land').value,
        hunger: Number(document.getElementById('hunger').value),
        energy: document.getElementById('energy').value,
        thrill: document.getElementById('thrill').value,
        openToShows: document.getElementById('include-shows').checked
    };

    resultsSection.innerHTML = '<p>Finding the best options....</p>';

    try {
        const response = await fetch("/api/wizard", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(userPreferences)
        });

        const data = await response.json();

        if (data.error) {
            resultsSection.innerHTML = `<p>Error: ${data.error}</p>`;
        }

        console.log(data);

    } catch (error) {
        console.error(error);
        resultsSection.innerHTML = `<p>An error occurred while thinking of suggestions.</p>`;    
    }
});