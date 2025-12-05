const PARK_LAND_LOCATIONS = {
    magic_kingdom: {
        parkName: 'Magic Kingdom (FL)',
        parkId: '75ea578a-adc8-4116-a54d-dccb60765ef9',
        coords: { lat: 28.417666, lon: -81.581216 },
        timeZone: 'America/New_York',
        timeZoneAbbr: 'ET',
        lands: {
            castle_hub: 'Cinderella Castle Hub',
            adventureland: 'Adventureland',
            frontierland: 'Frontierland',
            fantasyland: 'Fantasyland',
            tomorrowland: 'Tomorrowland',
            liberty_square: 'Liberty Square',
        }
    },
    disneyland: {
        parkName: 'Disneyland Park (CA)',
        parkId: '7340550b-c14d-4def-80bb-acdb51d49a66',
        coords: { lat: 33.81209, lon: -117.91897 },
        timeZone: 'America/Los_Angeles',
        timeZoneAbbr: 'PT',
        lands: {
            main_street: 'Main Street U.S.A.',
            adventureland: 'Adventureland',
            frontierland: 'Frontierland/Critter Country',
            fantasyland: 'Fantasyland',
            tomorrowland: 'Tomorrowland',
            new_orleans: 'New Orleans Square',
        }
    }
};

const PRIORITY_MODES = [
    { value: 'SCORE_BALANCED', label: 'Balanced (Wait & Distance)' },
    { value: 'WAIT_ONLY', label: 'Shortest Wait Only' },
    { value: 'DISTANCE_ONLY', label: 'Closest Ride Only' },
];

// Mock API endpoints - these will fail as the user environment does not include a mocked server
const APP_ENDPOINT = '/api/wizard';
const BASE_THEMEPARKS_API = 'https://api.themeparks.wiki/v1/entity';
const NWS_API_BASE = 'https://api.weather.gov/points';


// ------------------------------------------------------------
// GLOBAL STATE
// ------------------------------------------------------------

let currentView = 'PARK_SELECT';
let selectedPark = null;
let parkInfo = {};        // { hours, weather }
let finalData = {};       // server results


// ------------------------------------------------------------
// ENTRY POINT
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    buildAppShell();
    renderCurrentView();
});


// ------------------------------------------------------------
// LAYOUT + NAVIGATION
// ------------------------------------------------------------

/**
 * Sets up the main structural elements of the application.
 */
function buildAppShell() {
    const app = document.getElementById('app-container');
    app.innerHTML = `
        <header>
            <h1>Yen Sid's Ride Recommender</h1>
            <p>Your guide to the quickest and closest rides.</p>
        </header>
        <div id="dynamic-content"></div>
    `;
}

/**
 * Renders the content based on the current application view state.
 */
function renderCurrentView() {
    // Map view state keys to their rendering functions
    const viewRenderers = {
        PARK_SELECT: renderParkSelection,
        FORM: renderForm,
        RESULTS_LOADING: renderLoading,
        RESULTS_DISPLAY: () => renderResults(finalData)
    };
    
    const view = viewRenderers[currentView];

    // Clear previous content and render the new view
    const dynamicContent = document.getElementById('dynamic-content');
    if (dynamicContent) {
        dynamicContent.innerHTML = '';
        view();
    }
}

/**
 * Updates the application state and triggers a re-render.
 * @param {string} view The key of the view to navigate to.
 */
function navigateTo(view) {
    currentView = view;
    renderCurrentView();
}


// ------------------------------------------------------------
// VIEW 1 — PARK SELECT
// ------------------------------------------------------------

/**
 * Renders the initial park selection screen.
 */
function renderParkSelection() {
    const container = document.getElementById('dynamic-content');

    container.innerHTML = `
        <div class="card">
            <h2>Step 1: Choose Your Park</h2>
            <div class="park-options">
                ${parkButton('magic_kingdom')}
                ${parkButton('disneyland')}
            </div>
            <p class="small-text">Supports Magic Kingdom (FL) and Disneyland Park (CA).</p>
        </div>
    `;

    // Add event listeners for park selection buttons
    container.querySelectorAll('.park-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            selectedPark = btn.dataset.park;
            parkInfo = {}; // Clear context data
            finalData = {}; // Clear result data
            navigateTo('FORM');
        })
    );
}

/**
 * Generates the HTML for a single park selection button.
 * @param {string} key The key for the park in PARK_LAND_LOCATIONS.
 * @returns {string} HTML button string.
 */
function parkButton(key) {
    const park = PARK_LAND_LOCATIONS[key];
    const icon = key === 'magic_kingdom' ? '🏰' : '👑'; // Simple emojis for visual appeal
    return `<button class="park-btn" data-park="${key}">${park.parkName} ${icon}</button>`;
}


// ------------------------------------------------------------
// VIEW 2 — FORM + PARK CONTEXT
// ------------------------------------------------------------

/**
 * Renders the preference form and loads dynamic park context (hours/weather).
 */
async function renderForm() {
    const container = document.getElementById('dynamic-content');
    const park = PARK_LAND_LOCATIONS[selectedPark];

    container.innerHTML = formTemplate(park);

    // Set up navigation and submission listeners
    document.getElementById('back-btn').addEventListener('click', () => navigateTo('PARK_SELECT'));
    document.getElementById('recommendation-form').addEventListener('submit', handleFormSubmit);

    // Load dynamic data (hours and weather)
    await loadParkContext(park);
}

/**
 * Generates the HTML template for the preference form.
 * @param {object} park The park's configuration object.
 * @returns {string} HTML form string.
 */
function formTemplate(park) {
    return `
        <!-- Back button above the card -->
        <div class="button-group-top">
            <button type="button" id="back-btn" class="secondary-btn">← Change Park</button>
        </div>

        <!-- Form card -->
        <form id="recommendation-form" class="card">
            <h2>Step 2: ✨ Let's Find Your Perfect Ride at ${park.parkName}</h2>

            <!-- Dynamic Context Area -->
            <div id="park-context" class="park-details-container loading">
                <p>Loading park info...</p>
                <div class="spinner"></div>
            </div>

            <!-- Form Fields -->
            ${selectTemplate("land", "Where are you in the park?", park.lands)}
            ${selectTemplate("priorityMode", "Recommendation Priority", priorityModeOptions())}

            <!-- Submit button full width -->
            <div class="button-group">
                <button type="submit" id="submit-btn" disabled class="primary-btn full-width">Find the Magic!</button>
            </div>
        </form>
    `;
}

/**
 * Generates the HTML for a standard select input.
 * @param {string} id The element's ID and name.
 * @param {string} label The user-facing label text.
 * @param {(object|string)} options Object of value:label pairs or a pre-generated option string.
 * @returns {string} HTML form group string.
 */
function selectTemplate(id, label, options) {
    let optionsHtml = '<option value="" disabled selected>Select...</option>'; // Add a default disabled option

    // If options is an object (like park.lands)
    if (!Array.isArray(options) && typeof options === "object") {
        optionsHtml += Object.entries(options)
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join("");
    }
    // If options is a pre-formatted string (like priorityModeOptions)
    else if (typeof options === "string") {
        optionsHtml += options;
    }

    return `
        <div class="form-group">
            <label for="${id}">${label}</label>
            <select id="${id}" name="${id}" required>
                ${optionsHtml}
            </select>
        </div>
    `;
}

/**
 * Generates the HTML options for the priority mode select field.
 * @returns {string} HTML option strings.
 */
function priorityModeOptions() {
    return PRIORITY_MODES.map(
        m => `<option value="${m.value}" ${m.value === 'SCORE_BALANCED' ? 'selected' : ''}>${m.label}</option>`
    ).join('');
}

/**
 * Fetches and displays park context (hours and weather) and enables the form.
 * @param {object} park The park's configuration object.
 */
async function loadParkContext(park) {
    const ctx = document.getElementById('park-context');
    const submitBtn = document.getElementById('submit-btn');
    const prioritySelect = document.getElementById('priorityMode');

    // Reset initial state
    submitBtn.disabled = true;
    if (prioritySelect) prioritySelect.disabled = false; 

    try {
        // Fetch data in parallel
        const [hoursResult, weather] = await Promise.all([
            fetchParkHours(selectedPark, park.parkId),
            fetchWeatherForecast(park.coords.lat, park.coords.lon)
        ]);

        // Store complete park information
        parkInfo = {
            hours: hoursResult.message,
            weather: weather,
            status: hoursResult.status,
            isOpen: hoursResult.isOpen,
            ticketedEvent: hoursResult.ticketedEvent
        };

        // Update UI with fetched data
        let contextHtml = `
            <p>${hoursResult.message}</p>
            <p>${weather}</p>
        `;

        ctx.classList.remove('loading');
        
        if (hoursResult.status === 'CLOSED') {
            // Park is closed, force distance-only mode, but allow submission
            if (prioritySelect) {
                prioritySelect.value = 'DISTANCE_ONLY';
                prioritySelect.disabled = true;
            }
            contextHtml += `
                <p class="text-xs text-indigo-600 mt-2">
                    Park is closed. Wait times are unavailable, but you can still submit 
                    to find the <strong>Closest Ride Only</strong>.
                </p>
            `;
            submitBtn.disabled = false;
        } else if (hoursResult.status === 'OPEN') {
            // Park is open, enable submission and priority selection
            submitBtn.disabled = false;
            if (prioritySelect) prioritySelect.disabled = false;
        } else {
            // Data unavailable case (status === 'UNKNOWN'), keep disabled
            submitBtn.disabled = true;
            if (prioritySelect) prioritySelect.disabled = true;
        }

        ctx.innerHTML = contextHtml;

    } catch (e) {
        console.error("Context load failed:", e);
        ctx.innerHTML = `<p class="error-text">Failed to load park info. Check console for details.</p>`;
        if (prioritySelect) prioritySelect.disabled = true;
    }
}

// ------------------------------------------------------------
// VIEW 3 — LOADING
// ------------------------------------------------------------

/**
 * Renders the loading screen while waiting for the server response.
 */
function renderLoading() {
    const container = document.getElementById('dynamic-content');
    container.innerHTML = `
        <div class="card">
            <h2>Yen Sid is Conjuring...</h2>
            <div class="summary">
                ${parkInfo.hours || 'Loading Hours...'}<br>
                ${parkInfo.weather || ''}<br><br>
                Finding the best rides... Please wait.
            </div>
            <div class="spinner"></div>
        </div>
    `;
}


// ------------------------------------------------------------
// API FETCH HELPERS
// ------------------------------------------------------------

function getDateInTimeZone(timeZone) {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    // Format comes like "2025-12-04"
    return formatter.format(now);
}

async function fetchParkHours(parkKey, parkId) {
    const park = PARK_LAND_LOCATIONS[parkKey];
    const url = `${BASE_THEMEPARKS_API}/${parkId}/schedule`;
    
    const formatting = {
        hour: "numeric",
        minute: "2-digit",
        timeZone: park.timeZone,
        hour12: true
    };

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("API call failed.");

        const data = await res.json();
        
        // Get today's date in the PARK'S timezone, not UTC
        const now = Date.now();
        const todayInParkTz = new Date().toLocaleString("en-US", {
            timeZone: park.timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        });
        
        // Convert to YYYY-MM-DD format
        const [month, day, year] = todayInParkTz.split(/[/,\s]+/);
        const today = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

        const todaySchedules = (data.schedule || []).filter(s => s.date === today);

        if (!todaySchedules.length) {
            return {
                status: "UNKNOWN",
                message: "Hours: Data unavailable.",
                isOpen: false,
                ticketedEvent: null
            };
        }

        // Find operating windows
        const operatingWindows = todaySchedules
            .filter(s => s.type === "OPERATING")
            .map(s => ({
                openTime: new Date(s.openingTime).getTime(),
                closeTime: new Date(s.closingTime).getTime(),
                display: {
                    open: new Date(s.openingTime).toLocaleTimeString("en-US", formatting),
                    close: new Date(s.closingTime).toLocaleTimeString("en-US", formatting)
                }
            }))
            .sort((a, b) => a.openTime - b.openTime);

        if (!operatingWindows.length) {
            return {
                status: "CLOSED",
                message: "Hours: No operating hours today.",
                isOpen: false,
                ticketedEvent: null
            };
        }

        // Check if park is currently open
        const currentWindow = operatingWindows.find(w => now >= w.openTime && now <= w.closeTime);

        if (currentWindow) {
            // Check if there's a ticketed event right now
            const ticketedNow = todaySchedules
                .filter(s => s.type === "TICKETED_EVENT")
                .find(s => now >= new Date(s.openingTime).getTime() && now <= new Date(s.closingTime).getTime());

            const ticketedMessage = ticketedNow ? ` | Ticketed Event: ${ticketedNow.description}` : "";

            return {
                status: "OPEN",
                message: `Hours: <strong>${currentWindow.display.open}</strong> – <strong>${currentWindow.display.close}</strong> (Currently Open)${ticketedMessage}`,
                isOpen: true,
                ticketedEvent: ticketedNow ? {
                    description: ticketedNow.description,
                    openingTime: ticketedNow.openingTime,
                    closingTime: ticketedNow.closingTime
                } : null
            };
        }

        // Park not currently open - check if we're before first opening
        const nextWindow = operatingWindows.find(w => now < w.openTime);
        if (nextWindow) {
            return {
                status: "CLOSED",
                message: `Hours: <strong>Opens at ${nextWindow.display.open}</strong> ${park.timeZoneAbbr}`,
                isOpen: false,
                ticketedEvent: null
            };
        }

        // All operating windows passed
        const lastWindow = operatingWindows[operatingWindows.length - 1];
        return {
            status: "CLOSED",
            message: `Hours: Park closed since ${lastWindow.display.close} ${park.timeZoneAbbr}`,
            isOpen: false,
            ticketedEvent: null
        };

    } catch (error) {
        console.error("Error fetching park hours:", error);
        return {
            status: "UNKNOWN",
            message: "Hours: Data unavailable.",
            isOpen: false,
            ticketedEvent: null
        };
    }
}


async function getParkSnapshot(userPrefs, parkId) {
  const url = `${BASE_THEMEPARKS_API}/${parkId}/live`;
  const data = await fetchData(url);

  if (!data?.liveData) {
    return [];
  }

  const landData = lands[userPrefs.land];
  if (!landData) {
    throw new Error(`Unknown land: ${userPrefs.land}`);
  }

  const targetCoords = landData.coords;
  const profile = WEIGHT_PROFILES[userPrefs.priorityMode] || WEIGHT_PROFILES.SCORE_BALANCED;

  // Filter and map rides
  const rides = data.liveData
    .filter(item => {
      // Only include ATTRACTION entity types
      if (item.entityType !== 'ATTRACTION') return false;
      
      // Check if this attraction is in the selected land
      const attractionLandData = lands[item.id];
      if (!attractionLandData) return false;
      
      // IMPORTANT: Include rides regardless of status (OPERATING or CLOSED)
      // This allows users to see recommendations even when park is closed
      return true;
    })
    .map(item => {
      const attractionLandData = lands[item.id];
      const dist = haversineDistance(
        targetCoords.lat,
        targetCoords.lon,
        attractionLandData.coords.lat,
        attractionLandData.coords.lon
      );

      // Handle wait times - use 0 if not available (when closed)
      let waitMinutes = 0;
      
      // Only try to get wait time if ride is OPERATING
      if (item.status === 'OPERATING' && item.queue?.STANDBY?.waitTime != null) {
        waitMinutes = item.queue.STANDBY.waitTime;
      }

      // Calculate score with the profile weights
      const waitScore = waitMinutes / WAIT_DIVISOR;
      const distScore = dist / DIST_DIVISOR;
      const score = (
        profile.waitFactor * waitScore +
        profile.distanceFactor * distScore
      );

      return {
        id: item.id,
        name: item.name,
        status: item.status, // Include status so frontend knows if closed
        listedWaitMinutes: waitMinutes,
        distanceMeters: Math.round(dist),
        score: score
      };
    });

  // Sort by score (lower is better)
  rides.sort((a, b) => a.score - b.score);

  // Return top 5 recommendations
  return rides.slice(0, 5);
}

/**
 * Fetches the current weather forecast using the NWS API.
 * @param {number} lat Latitude of the park.
 * @param {number} lon Longitude of the park.
 * @returns {Promise<string>} Formatted weather string or an error message.
 */
async function fetchWeatherForecast(lat, lon) {
    try {
        // Step 1: Get the forecast endpoint URL
        const pointsRes = await fetch(`${NWS_API_BASE}/${lat.toFixed(4)},${lon.toFixed(4)}`);
        if (!pointsRes.ok) throw new Error("NWS points lookup failed.");

        const points = await pointsRes.json();
        const forecastUrl = points.properties.forecast;

        // Step 2: Get the forecast data
        const forecastRes = await fetch(forecastUrl);
        const forecast = await forecastRes.json();
        const period = forecast.properties.periods[0]; // Today's/Current period

        if (!period) return "Weather: Not available.";

        return `Forecast: <strong>${period.temperature}°${period.temperatureUnit}</strong>, ${period.shortForecast}`;
    } catch {
        return "Weather: Data unavailable.";
    }
}


// ------------------------------------------------------------
// SUBMISSION → SERVER (Mocked)
// ------------------------------------------------------------

/**
 * Handles the form submission, navigates to loading, and simulates a server call.
 * @param {Event} e The form submission event.
 */

async function handleFormSubmit(e) {
    e.preventDefault();

    navigateTo('RESULTS_LOADING');

    const form = e.target;

    const payload = {
        park: selectedPark,
        weather: parkInfo.weather,
        parkStatus: parkInfo.status,
        isOpen: parkInfo.isOpen,
        ticketedEvent: parkInfo.ticketedEvent,
        userPrefs: {
            land: form.land.value,
            priorityMode: form.priorityMode.value,
        }
    };

    // In a real environment, you would use this logic:
    try {
        const res = await fetch("/api/wizard", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        finalData = await res.json();
        if (!res.ok) finalData.error = finalData.error || "Server error.";

    } catch (err) {
        finalData = { error: err.message, recommendations: [] };
    }

    navigateTo('RESULTS_DISPLAY');
}


// ------------------------------------------------------------
// VIEW 4 — RESULTS
// ------------------------------------------------------------

/**
 * Renders the final results screen, showing recommendations or an error.
 * @param {object} data The final data object from the server (or mock).
 */
function renderResults(data) {
    const container = document.getElementById('dynamic-content');
    const park = PARK_LAND_LOCATIONS[selectedPark];

    if (data.error) {
        container.innerHTML = errorTemplate(data.error);
    } else {
        container.innerHTML = resultsTemplate(park, data);
    }

    // Listener for starting over
    document.getElementById('start-over-btn').addEventListener('click', () => navigateTo('PARK_SELECT'));
}

/**
 * Generates the HTML for an error message.
 * @param {string} message The error message to display.
 * @returns {string} HTML string.
 */
function errorTemplate(message) {
    return `
        <div class="card">
            <h2>Error</h2>
            <p class="error-text">An error occurred while finding recommendations: ${message}</p>
            <button id="start-over-btn" class="primary-btn full-width">Start Over</button>
        </div>
    `;
}

/**
 * Generates the HTML for the successful results display.
 * @param {object} park The selected park's config.
 * @param {object} data The recommendation data.
 * @returns {string} HTML string.
 */
function resultsTemplate(park, data) {
    return `
        <div class="card">
            <h2>Recommendations for ${park.parkName}</h2>
            
            <!-- Park Context Display -->
            <div class="park-details-container">
                <p>${parkInfo.hours}</p>
                <p>${parkInfo.weather}</p>
            </div>

            <!-- Summary Text -->
            <h3>Yen Sid's Advice</h3>
            <div class="summary">${data.summary || "No summary provided."}</div>

            <!-- List of Recommendations -->
            <h3>Top Recommendations</h3>
            <ul class="recommendations-list">
                ${data.recommendations?.length
                    ? data.recommendations.map(r => recItem(r)).join('')
                    : `<li>No rides matched your current location and preferences.</li>`}
            </ul>

            <button id="start-over-btn" class="primary-btn full-width">Start New Plan</button>
        </div>
    `;
}

/**
 * Generates the HTML for a single recommendation list item.
 * @param {object} r The recommendation object.
 * @returns {string} HTML list item string.
 */
function recItem(r) {
    return `
        <li>
            <strong class="text-lg">${r.name}</strong>
            <div class="space-x-2 text-base">
                <span class="wait-time">⏳ ${r.listedWaitMinutes} min</span>
                <span class="distance">📍 ${r.distanceMeters}m away</span>
            </div>
        </li>
    `;
}