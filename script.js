document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("survey-form");
    const maxDistanceInput = document.getElementById("maxDistance");
    const distanceLabel = document.getElementById("distance-label");
    const resultsSection = document.getElementById("results");

    // Helper to estimate walking time for the label
    const estimateWalkTime = (meters) => {
        // Assuming average walking speed is 1.3 meters/second
        const seconds = meters / 1.3;
        const minutes = Math.ceil(seconds / 60);
        return `${minutes} min walk`;
    }

    // Initial label update
    distanceLabel.textContent = `${maxDistanceInput.value} meters (${estimateWalkTime(maxDistanceInput.value)})`; 

    // Event listener for the slider
    maxDistanceInput.addEventListener("input", (event) => {
        const meters = event.target.value;
        distanceLabel.textContent = `${meters} meters (${estimateWalkTime(meters)})`;
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        // 1. Collect Data (Only current land and max distance)
        const formData = new FormData(form);
        const userPrefs = {
            land: formData.get("land"),
            maxDistance: parseInt(formData.get("maxDistance"), 10)
        }
        console.log(userPrefs)
        resultsSection.innerHTML = `<p class="loading">Casting a spell.. please wait.</p>`;

        try {
            const response = await fetch("/api/wizard", {
                method: "POST", 
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ userPrefs })
            });

            const data = await response.json();

            if (!response.ok) {
                resultsSection.innerHTML = `<p class="error">Error: ${data.details}</p>`;
            }
            console.log("data", data)
            // 3. Display Results
            displayResults(data.recommendations);

        } catch(error) {
            console.error("Fetch error", error);
            resultsSection.innerHTML = '<p class="error">Network error. Check your connection.</p>';
        }
    });

    const displayResults = (recommendations) => {
        resultsSection.innerHTML = `
            <h2>Your personalized suggestions have arrived!</h2>
            <ul class="recommendations-list">
                ${recommendations.map(recommendation => `
                    <li>
                        <strong>${recommendation.name}</strong>
                        <span class="wait">Wait: ${recommendation.listedWaitMinutes} min</span> 
                        <span class="distance">Distance: ${recommendation.distanceMeters} m</span>
                    </li>
                `).join("")}
            </ul>
        `;
    }
});