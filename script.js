// ===== GLOBAL VARIABLES & STATE =====
const myVisualImages = ['image/gen1.jpg', 'image/gen2.jpg', 'image/gen3.jpg', 'image/gen4.jpg', 'image/gen5.jpg'];
const myAiVideos = ['videos/explainer1.mp4', 'videos/explainer2.mp4', 'videos/explainer3.mp4', 'videos/explainer4.mp4'];
let map, communityMap, drawnItems, drawControl, chart, pollutionChart, lastCalc, communityData = [],
    locationDetected = false,
    currentLanguage = 'en',
    detectedLat = null,
    detectedLon = null;

// ===== API TOKENS =====
const AQI_TOKEN = "344eccebdba6c88cebea99bdd4aeac5f440e0a9b";
const NASA_TOKEN = "i4Vjou3u6oUk3dmcGGDixhSIviXGPDB6pR7gTY0H";

// ===== API FUNCTIONS =====
async function getAQI(lat, lon) {
    const url = `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${AQI_TOKEN}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`AQI Error: ${res.status}`);
        const data = await res.json();
        console.log("AQI Data:", data);
        return data.status === "ok" ? { aqi: data.data.aqi, city: data.data.city.name } : null;
    } catch (e) {
        console.error("AQI Data Fetch Error:", e);
        return null;
    }
}

async function getNasaSolarData(lat, lon) {
    const weatherInfoEl = document.getElementById("weather-info");
    weatherInfoEl.style.display = 'block';
    weatherInfoEl.textContent = translations['nasa_fetching'][currentLanguage];
    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&start=20250901&end=20250921&format=JSON&api_key=${NASA_TOKEN}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`NASA Error: ${res.status}`);
        const data = await res.json();
        console.log("NASA Solar Data:", data);
        const avgInsolation = data.properties.parameter.ALLSKY_SFC_SW_DWN.mean;
        if (avgInsolation > 0) {
            weatherInfoEl.textContent = `☀️ NASA Data: Avg. ${avgInsolation.toFixed(2)} kWh/m²/day.`;
            return { avgInsolation };
        }
        throw new Error('Invalid NASA data');
    } catch (e) {
        console.error("NASA Data Fetch Error:", e);
        weatherInfoEl.textContent = translations['nasa_unavailable'][currentLanguage];
        return { avgInsolation: 4.5 };
    }
}

// Hugging Face API ab isme use nahi ho raha, isliye is function ko ab hum nahi chalaenge.
// async function callHF(prompt) { ... }

async function getAddress(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Geo Error: ${res.status}`);
        const data = await res.json();
        console.log("Address:", data.display_name);
        return data.display_name;
    } catch (e) {
        console.error("Address Fetch Error:", e);
        return "Unknown Location";
    }
}

// ===== INITIALIZATION & EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
    initializeMaps();
    changeLanguage('en');
    setupEventListeners();
});

function initializeMaps() {
    try {
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' });
        map = L.map('map', { layers: [satelliteLayer] }).setView([23.1815, 79.9864], 12);
        L.control.layers({ "Satellite": satelliteLayer, "Street View": osmLayer }).addTo(map);
        drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        drawControl = new L.Control.Draw({
            edit: { featureGroup: drawnItems },
            draw: { polygon: false, polyline: false, circle: false, marker: false, circlemarker: false, rectangle: { shapeOptions: { color: '#ffc857' } } }
        });
        map.addControl(drawControl);
        map.on(L.Draw.Event.CREATED, function(event) {
            const layer = event.layer;
            drawnItems.clearLayers();
            drawnItems.addLayer(layer);
            const areaInSqFt = (L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]) * 10.7639).toFixed(0);
            document.getElementById("roofArea").value = areaInSqFt;
            showMessage(`Roof area selected: ${areaInSqFt} sq ft`, 'success');
        });
        communityMap = L.map('communityMap').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(communityMap);
        autoDetectLocation();
    } catch (e) {
        console.error("Map initialization failed:", e);
    }
}

function setupEventListeners() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            showSection(this.getAttribute('data-target'));
            document.getElementById('navMenu').classList.remove('active');
        });
    });
    document.getElementById('navToggle').addEventListener('click', () => { document.getElementById('navMenu').classList.toggle('active'); });
    document.querySelector('.contact-form').addEventListener('submit', (e) => {
        e.preventDefault();
        showMessage(translations['message_sent_success'][currentLanguage], 'success');
        e.target.reset();
    });
    document.getElementById('addressInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') getLocation(); });
    document.getElementById('langSelect').addEventListener('change', (e) => { changeLanguage(e.target.value); });
}

// ===== CORE APP LOGIC & AI FUNCTIONS =====
function handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    if (username === 'nasa' && password === '1234') {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('main-app').style.display = 'flex';
        showSection('#home');
    } else {
        showMessage(translations['invalid_login'][currentLanguage], 'error');
    }
}

async function calculate() {
    showMessage(translations['calculating_solar'][currentLanguage]);
    const bill = parseFloat(document.getElementById("bill").value);
    const tariff = parseFloat(document.getElementById("tariff").value);
    const costPerKw = parseFloat(document.getElementById("cost").value);
    if (isNaN(bill) || isNaN(tariff) || isNaN(costPerKw) || bill <= 0 || tariff <= 0 || costPerKw <= 0) {
        showMessage(translations['invalid_input'][currentLanguage], "error");
        return;
    }
    const budget = parseFloat(document.getElementById("budget").value) || Infinity;
    const roofArea = parseFloat(document.getElementById("roofArea").value) || Infinity;
    const monthlyIncome = parseFloat(document.getElementById("monthlyIncome").value) || 0;
    const state = document.getElementById("stateSelect").value;
    const bank = document.getElementById("bankSelect").value;
    const panelType = document.getElementById("panelTypeSelect").value;

    const locationData = await getLocation();
    if (!locationData) {
        showMessage(translations['location_not_found'][currentLanguage], 'error');
        return;
    }

    const solarData = await getNasaSolarData(locationData.lat, locationData.lon);
    const aqiData = await getAQI(locationData.lat, locationData.lon);

    const units = bill / tariff;
    let requiredKw = (units / (solarData.avgInsolation * 30));
    if (roofArea !== Infinity && roofArea > 0) {
        const maxKwFromRoof = (roofArea / (panelType === 'MONO' ? 80 : 100));
        if (requiredKw > maxKwFromRoof) {
            requiredKw = maxKwFromRoof;
            showMessage(translations['system_size_adjusted_roof'][currentLanguage], 'success');
        }
    }
    let installCost = (requiredKw * costPerKw);
    if (installCost > budget) {
        requiredKw = (budget / costPerKw);
        installCost = budget;
        showMessage(translations['system_size_adjusted_budget'][currentLanguage], 'success');
    }
    const monthlySavings = (units * tariff * 0.9);
    const payback = (monthlySavings > 0) ? (installCost / (monthlySavings * 12)) : "N/A";
    const co2 = (requiredKw * 1.5);
    const trees = Math.round(co2 * 45);

    const subsidyInfo = checkSubsidyEligibility(state, monthlyIncome, bill, requiredKw, installCost);
    const finalCostAfterSubsidy = installCost - subsidyInfo.subsidyAmount;
    const loanInfo = getLoanInfo(bank, finalCostAfterSubsidy);

    lastCalc = {
        bill, requiredKw: requiredKw.toFixed(2), installCost: installCost.toFixed(0), monthlySavings: monthlySavings.toFixed(0),
        payback: payback !== "N/A" ? payback.toFixed(1) : payback, co2: co2.toFixed(1), trees, aqiData,
        subsidyInfo, loanInfo, finalCostAfterSubsidy: finalCostAfterSubsidy.toFixed(0)
    };

    displayResults(lastCalc);
    displaySubsidyResults(subsidyInfo, installCost, loanInfo);
    updateGamificationResults(lastCalc);
    updateCommunityData({ co2: parseFloat(lastCalc.co2), trees, lat: locationData.lat, lon: locationData.lon });
    displayAqiResults(aqiData);
    changeLanguage(currentLanguage);
}

const scripts = {
    en: (data) => `Hello! Based on your bill of ₹${data.bill}, you'll need an approximate ${data.requiredKw} kilowatt solar system. The estimated cost will be ₹${data.installCost}. You'll save around ₹${data.monthlySavings} per month, and the payback period is ${data.payback} years. This is equivalent to saving ${data.co2} tons of carbon dioxide, which is like planting ${data.trees} trees.`,
    hi: (data) => {
        let script = `नमस्ते! आपके ₹${data.bill} के बिल के आधार पर, आपको लगभग ${data.requiredKw} किलोवाट का सोलर सिस्टम चाहिए। `;
        script += `इसका अनुमानित खर्च ₹${data.installCost} होगा। आप हर महीने लगभग ₹${data.monthlySavings} बचाएंगे `;
        script += `और आपका पैसा ${data.payback} साल में वसूल हो जाएगा। `;
        script += `यह ${data.co2} टन कार्बन डाइऑक्साइड बचाने के बराबर है, जो ${data.trees} पेड़ लगाने जैसा है।`;
        return script;
    }
};

function generateAI() {
    if (!lastCalc) {
        showMessage(translations['explainer_generate_first_message'][currentLanguage], 'error');
        return;
    }
    const scriptText = scripts[currentLanguage](lastCalc);
    document.getElementById('anim-main').textContent = scriptText;
    showSection('#ai-explainer');
    showMessage(translations['explainer_generated_message'][currentLanguage], 'success');
}

function playSpeech() {
    const text = document.getElementById('anim-main').textContent;
    if (!text || text.includes(translations['explainer_placeholder'][currentLanguage])) {
        showMessage(translations['explainer_generate_first_message'][currentLanguage], "error");
        return;
    }
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    
    utterance.lang = currentLanguage === 'hi' ? 'hi-IN' : 'en-US';

    if (currentLanguage === 'hi') {
        const hindiVoice = speechSynthesis.getVoices().find(voice => voice.lang.includes('hi') || voice.name.includes('Hindi'));
        if (hindiVoice) {
            utterance.voice = hindiVoice;
        } else {
            console.warn("Hindi voice not found. Falling back to default.");
        }
    }
    
    // Numbers ko sahi se padhne ke liye ek chota sa fix
    if (currentLanguage === 'hi') {
        const numbers = text.match(/\d+/g);
        if (numbers) {
            let processedText = text;
            numbers.forEach(num => {
                processedText = processedText.replace(`₹${num}`, `rupees ${num}`);
            });
            utterance.text = processedText;
        }
    }

    speechSynthesis.speak(utterance);
}

function pauseSpeech() {
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
}

async function autoDetectLocation() {
    if (locationDetected) return;
    locationDetected = true;
    showMessage(translations['location_detecting'][currentLanguage]);
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude, longitude } = pos.coords;
                map.setView([latitude, longitude], 18);
                detectedLat = latitude;
                detectedLon = longitude;
                try {
                    const address = await getAddress(latitude, longitude);
                    document.getElementById('addressInput').value = address;
                    showMessage(translations['location_gps_success'][currentLanguage], 'success');
                    addMarker([latitude, longitude], address);
                } catch (e) {
                    showMessage(translations['location_gps_fail'][currentLanguage], 'warning');
                    addMarker([latitude, longitude], translations['location_detected_label'][currentLanguage]);
                }
            },
            async () => {
                showMessage(translations['location_ip_try'][currentLanguage]);
                try {
                    const response = await fetch('https://ipapi.co/json/');
                    const data = await response.json();
                    if (data.latitude && data.longitude) {
                        map.setView([data.latitude, data.longitude], 12);
                        document.getElementById('addressInput').value = `${data.city}, ${data.region}`;
                        detectedLat = data.latitude;
                        detectedLon = data.longitude;
                        showMessage(translations['location_ip_success'][currentLanguage].replace('{city}', data.city), 'success');
                        addMarker([data.latitude, data.longitude], translations['location_approximate_label'][currentLanguage].replace('{city}', data.city));
                    } else {
                        showMessage(translations['location_autodetect_fail'][currentLanguage], 'error');
                    }
                } catch (ipErr) {
                    showMessage(translations['location_autodetect_fail'][currentLanguage], 'error');
                }
            }
        );
    } else {
        showMessage(translations['location_not_supported'][currentLanguage], "error");
    }
}

function addMarker(latlng, title) {
    if (map) {
        if (map.marker) {
            map.removeLayer(map.marker);
        }
        map.marker = L.marker(latlng).addTo(map);
        map.marker.bindPopup(title).openPopup();
    }
}

async function getLocation() {
    const addressText = document.getElementById('addressInput').value;
    if (addressText.length > 0 && detectedLat && detectedLon && addressText.includes('Chhindwara')) {
        return { lat: detectedLat, lon: detectedLon };
    }

    if (addressText.length > 0) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressText)}`);
            const data = await response.json();
            if (data && data.length > 0) {
                const loc = data[0];
                map.setView([loc.lat, loc.lon], 16);
                addMarker([loc.lat, loc.lon], loc.display_name);
                return { lat: parseFloat(loc.lat), lon: parseFloat(loc.lon) };
            } else {
                showMessage(translations['location_address_not_found'][currentLanguage], "error");
                return null;
            }
        } catch (e) {
            console.error("Geocoding Error:", e);
            return null;
        }
    } else {
        showMessage(translations['location_prompt'][currentLanguage], "error");
        return null;
    }
}

function showSection(targetId) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const target = document.querySelector(targetId);
    if (target) target.classList.add('active');
    if (targetId === '#dashboard') renderDashboard();
}

function showMessage(message, type = '') {
    const box = document.getElementById('messageBox');
    box.textContent = message;
    box.className = 'message-box';
    if (type) box.classList.add(type);
    box.classList.add('show');
    setTimeout(() => { box.classList.remove('show'); }, 4000);
}

function resetAll() {
    document.getElementById("bill").value = 2000;
    document.getElementById("budget").value = "";
    document.getElementById("roofArea").value = "";
    document.getElementById("addressInput").value = "";
    document.getElementById("results").style.display = "none";
    document.getElementById("subsidy-results").style.display = "none";
    document.getElementById("gamification-results").style.display = "none";
    document.getElementById("weather-info").style.display = "none";
    document.getElementById("emi-title").style.display = "none";
    document.getElementById("pollution-title").style.display = "none";
    document.querySelectorAll('.chart-container').forEach(c => c.style.display = 'none');
    if (chart) chart.destroy();
    if (pollutionChart) pollutionChart.destroy();
    drawnItems.clearLayers();
    showMessage(translations['reset_message'][currentLanguage], 'success');
}

function displayResults(data) {
    document.getElementById("results").style.display = "grid";
    document.getElementById("results").innerHTML = `<div class="result-stat-card"><h3>${data.requiredKw} kW</h3><p>${translations['size_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>₹${data.installCost}</h3><p>${translations['cost_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>₹${data.monthlySavings}</h3><p>${translations['savings_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>${data.payback} yrs</h3><p>${translations['payback_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>${data.co2} t/yr</h3><p>${translations['co2_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>${data.trees}</h3><p>${translations['trees_label'][currentLanguage]}</p></div>`;

    const emiChartEl = document.getElementById("emiChart");
    const emiTitleEl = document.getElementById("emi-title");

    emiTitleEl.style.display = 'block';
    emiChartEl.parentElement.style.display = 'block';

    if (chart) chart.destroy();
    chart = new Chart(emiChartEl.getContext("2d"), { type: "bar", data: { labels: [translations['emi_label_12'][currentLanguage], translations['emi_label_24'][currentLanguage], translations['emi_label_36'][currentLanguage]], datasets: [{ label: translations['monthly_payment_label'][currentLanguage], data: [(data.finalCostAfterSubsidy / 12).toFixed(0), (data.finalCostAfterSubsidy / 24).toFixed(0), (data.finalCostAfterSubsidy / 36).toFixed(0)], backgroundColor: ["#ff9d00", "#00c6ff", "#0072ff"] }] } });

    if (data.aqiData && data.aqiData.aqi) {
        displayPollutionChart(data.aqiData.aqi, data.co2);
    }
}

function displayPollutionChart(aqi, co2Saved) {
    const pollutionChartEl = document.getElementById("pollutionChart");
    const pollutionTitleEl = document.getElementById("pollution-title");

    pollutionTitleEl.style.display = 'block';
    pollutionChartEl.parentElement.style.display = 'block';

    const aqiReduction = co2Saved * 5;
    const newAqi = Math.max(0, (aqi - aqiReduction));

    if (pollutionChart) pollutionChart.destroy();
    pollutionChart = new Chart(pollutionChartEl.getContext("2d"), { type: "doughnut", data: { labels: [translations['pollution_remaining'][currentLanguage], translations['pollution_reduced'][currentLanguage]], datasets: [{ label: translations['aqi_label'][currentLanguage], data: [newAqi, aqiReduction], backgroundColor: ["#ff9d00", "#23d160"], hoverOffset: 4 }] }, options: { responsive: true, plugins: { legend: { position: 'top' }, title: { display: true, text: `${translations['original_aqi'][currentLanguage]}: ${aqi}` } } } });
}

function updateGamificationResults(data) {
    const annualKwh = data.requiredKw * 4.5 * 365;
    const roverDays = (annualKwh / 2.5).toFixed(0);
    const issSeconds = ((data.requiredKw / 120) * 3600).toFixed(0);
    const gamificationEl = document.getElementById("gamification-results");
    gamificationEl.style.display = "block";
    gamificationEl.innerHTML = `<div class="gamification-results-card"><h3>🚀 ${translations['gamification_title'][currentLanguage]}</h3><p>${translations['gamification_rover'][currentLanguage].replace('{roverDays}', roverDays)}</p><p>${translations['gamification_iss'][currentLanguage].replace('{issSeconds}', issSeconds)}</p><button class="btn" style="width:auto; margin-top:15px;" onclick="showColonistModal()">${translations['gamification_button'][currentLanguage]}</button></div>`;
}

function showColonistModal() {
    if (!lastCalc) { showMessage(translations['colonist_error'][currentLanguage], 'error'); return; }
    const kw = parseFloat(lastCalc.requiredKw);
    document.getElementById('mars-kw').textContent = `${(kw * 2.3).toFixed(2)} kW`;
    document.getElementById('mars-battery').textContent = `${(kw * 10 * 5).toFixed(1)} kWh`;
    document.getElementById('moon-kw').textContent = `${(kw * 1.1).toFixed(2)} kW`;
    document.getElementById('moon-battery').textContent = `${(kw * 10 * 20).toFixed(1)} kWh`;
    document.getElementById('colonist-modal').style.display = 'flex';
}

function closeColonistModal() {
    document.getElementById('colonist-modal').style.display = 'none';
}

function updateCommunityData(data) {
    communityData.push(data);
    if (document.querySelector('#dashboard').classList.contains('active')) {
        renderDashboard();
    }
}

function renderDashboard() {
    let totalCo2 = 0, totalTrees = 0;
    communityData.forEach(item => {
        totalCo2 += item.co2;
        totalTrees += item.trees;
    });
    document.getElementById("totalCo2").textContent = `${totalCo2.toFixed(1)} t/yr`;
    document.getElementById("totalTrees").textContent = totalTrees;
    document.getElementById("totalUsers").textContent = communityData.length;
    if (communityData.length > 0) {
        const latest = communityData[communityData.length - 1];
        L.circleMarker([latest.lat, latest.lon], { radius: 8, fillColor: "#ff9d00", color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.8 }).addTo(communityMap);
    }
}

function displayAqiResults(aqiData) {
    const aqiContainer = document.getElementById('aqi-container');
    const aqiEl = document.getElementById('aqi-results');
    if (!aqiData || typeof aqiData.aqi === 'undefined') {
        aqiContainer.style.display = 'none';
        return;
    }
    let quality = '', color = '';
    if (aqiData.aqi <= 50) { quality = translations['aqi_good'][currentLanguage]; color = '#23d160'; }
    else if (aqiData.aqi <= 100) { quality = translations['aqi_moderate'][currentLanguage]; color = '#ff9d00'; }
    else { quality = translations['aqi_unhealthy'][currentLanguage]; color = '#ff3860'; }
    aqiEl.innerHTML = `<p style="margin-bottom: 0.5rem;"><strong>${translations['aqi_city'][currentLanguage]}:</strong> ${aqiData.city.split(',')[0]}</p><h3 style="font-size: 2.5rem; color: ${color}; margin: 0.5rem 0;">${aqiData.aqi}</h3><p style="color: ${color};"><strong>${quality}</strong></p>`;
    aqiContainer.style.display = 'block';
}

function displaySubsidyResults(subsidyInfo, totalCost, loanInfo) {
    const subsidyEl = document.getElementById("subsidy-results");
    subsidyEl.style.display = "block";
    if (!subsidyInfo.isEligible) {
        subsidyEl.innerHTML = `<div class="gamification-results-card" style="border-left: 4px solid #ff3860;"><h3>❌ ${translations['subsidy_not_eligible_title'][currentLanguage]}</h3><p>${translations['subsidy_not_eligible_desc'][currentLanguage]}</p></div>`;
    } else {
        let loanDetails = '';
        if (loanInfo.bankName !== 'No Loan' && loanInfo.bankName !== translations['no_loan'][currentLanguage]) {
            const monthlyEMI = loanInfo.monthlyEMI.toFixed(0);
            loanDetails = `<p>${translations['subsidy_loan_details'][currentLanguage].replace('{bankName}', loanInfo.bankName).replace('{monthlyEMI}', monthlyEMI.toLocaleString()).replace('{loanTenure}', loanInfo.loanTenure)}</p>`;
        }
        subsidyEl.innerHTML = `<div class="gamification-results-card"><h3>💰 ${translations['subsidy_eligible_title'][currentLanguage]}</h3><p>${translations['subsidy_eligible_desc'][currentLanguage].replace('{schemeName}', subsidyInfo.schemeName)}</p><p>${translations['subsidy_amount'][currentLanguage].replace('{subsidyAmount}', subsidyInfo.subsidyAmount.toLocaleString())}</p><p>${translations['subsidy_cost_after'][currentLanguage].replace('{finalCost}', (totalCost - subsidyInfo.subsidyAmount).toLocaleString())}</p>${loanDetails}<p class="small-text">${translations['subsidy_disclaimer'][currentLanguage]}</p></div>`;
    }
}

function checkSubsidyEligibility(state, income, monthlyBill, systemSize, totalCost) {
    let subsidyAmount = 0;
    let schemeName = translations['no_scheme_found'][currentLanguage];
    let isEligible = false;
    if (monthlyBill >= 500) { isEligible = true; }
    else { return { isEligible: false, schemeName, subsidyAmount: 0 }; }

    if (state === 'MP') {
        if (income <= 25000 && systemSize <= 3) {
            subsidyAmount = Math.min(60000, totalCost * 0.4);
            schemeName = "PM Surya Ghar (Madhya Pradesh)";
        } else if (systemSize > 3 && systemSize <= 10) {
            subsidyAmount = Math.min(78000, totalCost * 0.3);
            schemeName = "PM Surya Ghar (Madhya Pradesh)";
        }
    } else if (state === 'UP') {
        if (income <= 20000) {
            subsidyAmount = Math.min(50000, totalCost * 0.35);
            schemeName = translations['up_scheme'][currentLanguage];
        }
    } else if (state === 'GUJ') {
        if (systemSize <= 3) {
            subsidyAmount = Math.min(80000, totalCost * 0.5);
            schemeName = translations['gujarat_scheme'][currentLanguage];
        }
    }
    return { isEligible, schemeName, subsidyAmount };
}

function getLoanInfo(bank, costAfterSubsidy) {
    if (bank === 'NONE') { return { bankName: translations['no_loan'][currentLanguage], loanAmount: 0, loanTenure: 0, monthlyEMI: 0 }; }
    let loanRate = 0, loanTenure = 5;
    const loanAmount = costAfterSubsidy;
    if (bank === 'SBI') { loanRate = 8.5; }
    else if (bank === 'HDFC') { loanRate = 9.2; }
    else if (bank === 'PNB') { loanRate = 8.8; }
    const monthlyRate = loanRate / 12 / 100;
    const numberOfMonths = loanTenure * 12;
    const monthlyEMI = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numberOfMonths) / (Math.pow(1 + monthlyRate, numberOfMonths) - 1);
    return { bankName: bank, loanAmount, loanTenure, monthlyEMI };
}

function generateExplainerVisual() {
    if (!lastCalc) { showMessage(translations['visual_error'][currentLanguage], 'error'); return; }
    const visualEl = document.getElementById('aiVisual');
    const placeholder = document.querySelector('.ai-visual-placeholder');
    const randomIndex = Math.floor(Math.random() * myVisualImages.length);
    visualEl.src = myVisualImages[randomIndex];
    placeholder.style.display = 'none';
    visualEl.style.display = 'block';
    showMessage(translations['visual_generated'][currentLanguage], 'success');
}

function generateExplainerVideo() {
    if (!lastCalc) { showMessage(translations['video_error'][currentLanguage], 'error'); return; }
    const videoEl = document.getElementById('aiVideo');
    const placeholder = document.querySelector('.ai-video-placeholder');
    const randomIndex = Math.floor(Math.random() * myAiVideos.length);
    videoEl.src = myAiVideos[randomIndex];
    placeholder.style.display = 'none';
    videoEl.style.display = 'block';
    videoEl.load();
    videoEl.play();
    showMessage(translations['video_generated'][currentLanguage], 'success');
}

function addMessageToLog(content, type) {
    const chatLog = document.getElementById('chatLog');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}`;
    const sanitizedContent = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    messageDiv.innerHTML = sanitizedContent;
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function handleChatInput(event) {
    if (event.key === 'Enter') {
        askChatbot();
    }
}

async function askChatbot() {
    const inputEl = document.getElementById('chatInput');
    const input = inputEl.value.trim();
    if (!input) return;

    addMessageToLog(input, 'user-msg');
    inputEl.value = '';
    inputEl.disabled = true;
    const typingIndicator = document.getElementById('typing-indicator');
    typingIndicator.style.display = 'flex';

    // सबसे पहले आम सवालों के लिए लोकल जवाब देखें
    const lowerCaseInput = input.toLowerCase();
    const isHindi = currentLanguage === 'hi';
    let botReply = '';

    for (const key in translations['chatbot_fallback_answers']) {
        const questionKeywords = translations['chatbot_fallback_answers'][key].keywords;
        const answer = isHindi ? translations['chatbot_fallback_answers'][key].answer_hi : translations['chatbot_fallback_answers'][key].answer_en;
        
        if (questionKeywords.some(keyword => lowerCaseInput.includes(keyword.toLowerCase()))) {
            botReply = answer;
            break;
        }
    }

    if (botReply) {
        // अगर लोकल जवाब मिल गया, तो तुरंत उसे दिखाएं
        await new Promise(resolve => setTimeout(resolve, 500));
        addMessageToLog(botReply, 'bot-msg');
        typingIndicator.style.display = 'none';
        inputEl.disabled = false;
        inputEl.focus();
        return;
    }

    // अगर लोकल जवाब नहीं मिला, तो server error message दिखाएं
    await new Promise(resolve => setTimeout(resolve, 500));
    addMessageToLog(translations['chatbot_no_answer'][currentLanguage], 'bot-msg');

    typingIndicator.style.display = 'none';
    inputEl.disabled = false;
    inputEl.focus();
}

const translations = {
    // Navigational & Static Text
    app_title: { en: "SOLAR FOR ALL", hi: "SOLAR FOR ALL" },
    login_username_placeholder: { en: "Enter Username", hi: "यूजरनेम दर्ज करें" },
    login_password_placeholder: { en: "Enter Password", hi: "पासवर्ड दर्ज करें" },
    nav_home: { en: "Home", hi: "होम" },
    nav_dashboard: { en: "Mission Control", hi: "मिशन कंट्रोल" },
    nav_calculator: { en: "Calculator", hi: "कैलकुलेटर" },
    nav_chatbot: { en: "AI Chatbot", hi: "AI चैटबॉट" },
    nav_ai_explainer: { en: "Solar Analysis", hi: "सोलर विश्लेषण" },
    nav_ai_visual: { en: "Your Solar Vision", hi: "आपका सोलर विजन" },
    nav_ai_video: { en: "Installation Preview", hi: "इंस्टॉलेशन पूर्वावलोकन" },
    nav_help: { en: "Help", hi: "सहायता" },
    nav_contact: { en: "Contact", hi: "संपर्क" },
    login_welcome: { en: "Welcome! Please log in to continue.", hi: "स्वागत है! जारी रखने के लिए कृपया लॉग इन करें।" },
    login_btn: { en: "Login", hi: "लॉग इन करें" },
    home_title: { en: "Light up Your Future with Solar Energy!", hi: "सौर ऊर्जा से अपने भविष्य को रोशन करें!" },
    home_subtitle: { en: "Reduce your electricity bills, protect the environment, and move towards a self-reliant energy future. Our 'SOLAR FOR ALL' calculator and AI will guide you every step of the way.", hi: "अपने बिजली के बिल कम करें, पर्यावरण की रक्षा करें और आत्मनिर्भर ऊर्जा भविष्य की ओर बढ़ें। हमारा 'सोलर फॉर ऑल' कैलकुलेटर और AI हर कदम पर आपका मार्गदर्शन करेंगे।" },
    home_card1_title: { en: "Instant Calculation", hi: "तुरंत गणना" },
    home_card1_desc: { en: "Estimate your system size, cost, and savings in seconds.", hi: "सेकंडों में अपने सिस्टम का आकार, लागत और बचत का अनुमान लगाएं।" },
    home_card1_btn: { en: "Go to Calculator", hi: "कैलकुलेटर पर जाएं" },
    home_card2_title: { en: "AI Assistant", hi: "AI सहायक" },
    home_card2_desc: { en: "Ask our AI chatbot anything about solar technology, subsidies, and maintenance.", hi: "हमारे AI चैटबॉट से सौर प्रौद्योगिकी, सब्सिडी और रखरखाव के बारे में कुछ भी पूछें।" },
    home_card2_btn: { en: "Chat Now", hi: "अभी चैट करें" },
    home_card3_title: { en: "Your Solar Vision", hi: "आपका सोलर विजन" },
    home_card3_desc: { en: "Visualize your environmental impact with AI-generated reports and visuals.", hi: "AI-जनरेटेड रिपोर्ट और विज़ुअल के साथ अपने पर्यावरणीय प्रभाव की कल्पना करें।" },
    home_card3_btn: { en: "See Visual", hi: "विज़ुअल देखें" },
    home_card4_title: { en: "Community Impact", hi: "सामुदायिक प्रभाव" },
    home_card4_desc: { en: "See the real-time environmental impact of our solar guardians worldwide.", hi: "दुनिया भर में हमारे सौर संरक्षकों के वास्तविक समय के पर्यावरणीय प्रभाव को देखें।" },
    home_card4_btn: { en: "See Impact", hi: "प्रभाव देखें" },
    gallery_title: { en: "Explore the World of Solar Energy", hi: "सौर ऊर्जा की दुनिया का अन्वेषण करें" },
    gallery1_title: { en: "Rural Village with Solar Panels on Rooftops", hi: "छतों पर सौर पैनलों वाला ग्रामीण गाँव" },
    gallery1_desc: { en: "This image shows a village where individual homes are equipped with rooftop solar panels.", hi: "यह छवि एक गाँव को दिखाती है जहाँ अलग-अलग घरों में छत पर सौर पैनल लगे हुए हैं।" },
    gallery2_title: { en: "Village School with Solar Panels", hi: "सौर पैनलों वाला गाँव का स्कूल" },
    gallery2_desc: { en: "This image highlights a village school powered by solar energy, enabling lighting and computers for students.", hi: "यह छवि सौर ऊर्जा से चलने वाले एक गाँव के स्कूल को दर्शाती है, जो छात्रों के लिए रोशनी और कंप्यूटर को संभव बनाता है।" },
    gallery3_title: { en: "Agricultural Village with Solar-Powered Water Pump", hi: "सौर-संचालित जल पंप वाला कृषि गाँव" },
    gallery3_desc: { en: "This image shows a solar-powered pump irrigating fields, reducing reliance on fossil fuels.", hi: "यह छवि खेतों की सिंचाई करते हुए एक सौर-संचालित पंप को दिखाती है, जिससे जीवाश्म ईंधन पर निर्भरता कम होती है।" },
    gallery4_title: { en: "Night View of a Village Lit by Solar Streetlights", hi: "सौर स्ट्रीटलाइट्स से रोशन एक गाँव का रात का दृश्य" },
    gallery4_desc: { en: "Solar streetlights enhance safety and extend evening activities in villages after dark.", hi: "सौर स्ट्रीटलाइट्स सुरक्षा बढ़ाती हैं और अँधेरा होने के बाद गाँवों में शाम की गतिविधियों का विस्तार करती हैं।" },
    dashboard_title: { en: "Mission Control: Community Impact", hi: "मिशन कंट्रोल: सामुदायिक प्रभाव" },
    dashboard_stat1_title: { en: "Collective CO₂ Saved", hi: "सामूहिक CO₂ की बचत" },
    dashboard_stat2_title: { en: "Guardians Joined", hi: "जुड़े हुए संरक्षक" },
    dashboard_stat3_title: { en: "Equivalent Trees Planted", hi: "लगाए गए पेड़ों के बराबर" },
    map_placeholder: { en: "Initializing Global Connection...", hi: "वैश्विक कनेक्शन शुरू हो रहा है..." },
    did_you_know_title: { en: "NASA Tech on Your Roof!", hi: "आपकी छत पर NASA तकनीक!" },
    did_you_know_desc: { en: "The highly efficient solar cell technology we use today was pioneered by NASA to power satellites and spacecraft. By installing solar, you're using space-age tech to protect Earth!", hi: "आज हम जिस अत्यधिक कुशल सौर सेल तकनीक का उपयोग करते हैं, उसकी शुरुआत NASA ने उपग्रहों और अंतरिक्ष यान को बिजली देने के लिए की थी। सौर ऊर्जा लगाकर, आप पृथ्वी की रक्षा के लिए अंतरिक्ष-युग की तकनीक का उपयोग कर रहे हैं!" },
    calc_title: { en: "Your Solar Calculator", hi: "आपका सोलर कैलकुलेटर" },
    surveyor_title: { en: "Virtual Roof Surveyor", hi: "वर्चुअल छत सर्वेक्षक" },
    surveyor_address_label: { en: "Enter your exact address or just your city name.", hi: "अपना सही पता या सिर्फ शहर का नाम दर्ज करें।" },
    address_input_placeholder: { en: "Detecting your location automatically...", hi: "आपकी लोकेशन का स्वतः पता लगाया जा रहा है..." },
    map_load_placeholder: { en: "Map will load here...", hi: "यहां मैप लोड होगा..." },
    surveyor_instructions: { en: "Use the draw tool (■) on the map for exact area.", hi: "सटीक क्षेत्र के लिए मैप पर ड्रॉ टूल (■) का उपयोग करें।" },
    calc_heading: { en: "SOLAR FOR ALL", hi: "सभी के लिए सौर" },
    calc_subtitle: { en: "Enter your bill/units to get system size, cost, and savings.", hi: "सिस्टम का आकार, लागत और बचत जानने के लिए अपना बिल/यूनिट्स दर्ज करें।" },
    calc_bill_label: { en: "Monthly Bill (₹)", hi: "मासिक बिल (₹)" },
    calc_budget_label: { en: "Budget (₹)", hi: "बजट (₹)" },
    budget_placeholder: { en: "Optional", hi: "वैकल्पिक" },
    calc_tariff_label: { en: "Tariff (₹/unit)", hi: "टैरिफ (₹/यूनिट)" },
    calc_cost_label: { en: "Cost per kW (₹)", hi: "लागत प्रति किलोवाट (₹)" },
    calc_roof_label: { en: "Roof Area (sq ft)", hi: "छत का क्षेत्रफल (वर्ग फुट)" },
    roof_placeholder: { en: "Auto-filled from map", hi: "मैप से स्वतः भरेगा" },
    calc_lang_label: { en: "Language", hi: "भाषा" },
    schemes_title: { en: "Government Schemes & Subsidy", hi: "सरकारी योजनाएं और सब्सिडी" },
    schemes_subtitle: { en: "Get an estimate of your government subsidy.", hi: "अपनी सरकारी सब्सिडी का अनुमान लगाएं।" },
    schemes_state: { en: "State", hi: "राज्य" },
    schemes_income: { en: "Monthly Income (₹)", hi: "मासिक आय (₹)" },
    income_placeholder: { en: "e.g., 20000", hi: "उदाहरण, 20000" },
    schemes_bank: { en: "Loan Bank", hi: "ऋण बैंक" },
    no_loan_option: { en: "No Loan", hi: "कोई ऋण नहीं" },
    schemes_panel: { en: "Panel Type", hi: "पैनल का प्रकार" },
    calc_calc_btn: { en: "Calculate", hi: "गणना करें" },
    calc_reset_btn: { en: "Reset", hi: "रीसेट" },
    aqi_title: { en: "Live Air Quality", hi: "लाइव वायु गुणवत्ता" },
    calc_emi_title: { en: "EMI Comparison", hi: "EMI की तुलना" },
    pollution_title: { en: "Pollution Reduction Impact", hi: "प्रदूषण कम करने का प्रभाव" },
    explainer_generate_btn: { en: "Generate Solar Analysis", hi: "सोलर विश्लेषण उत्पन्न करें" },
    explainer_generate_btn_text: { en: "Generate Solar Analysis", hi: "सोलर विश्लेषण उत्पन्न करें" },
    chat_title: { en: "Ask Your Solar Bot 🤖", hi: "अपने सोलर बॉट से पूछें 🤖" },
    chat_welcome: { en: "Hello! I'm here to answer your questions about solar energy.", hi: "नमस्ते! मैं सौर ऊर्जा के बारे में आपके सवालों का जवाब देने के लिए यहाँ हूँ।" },
    chat_placeholder: { en: "e.g., How much does solar energy cost?", hi: "जैसे, सौर ऊर्जा की लागत कितनी है?" },
    chat_send_btn: { en: "Send", hi: "भेजें" },
    explainer_title: { en: "Solar Analysis", hi: "सोलर विश्लेषण" },
    explainer_subtitle: { en: "Here is your personalized analysis and voice-over script.", hi: "यह आपका व्यक्तिगत विश्लेषण और वॉइस-ओवर स्क्रिप्ट है।" },
    explainer_placeholder: { en: "Your generated script will appear here after calculation.", hi: "गणना के बाद आपका जेनरेट किया गया स्क्रिप्ट यहाँ दिखाई देगा।" },
    explainer_play_btn: { en: "Play", hi: "चलाएँ" },
    explainer_stop_btn: { en: "Stop", hi: "रोकें" },
    visual_title: { en: "Your Solar Vision", hi: "आपका सोलर विजन" },
    visual_subtitle: { en: "Here you can view a personalized visual based on your solar energy calculation. Just click 'Generate Visual'!", hi: "यहाँ आप अपनी सौर ऊर्जा गणना के आधार पर एक व्यक्तिगत विज़ुअल देख सकते हैं। बस 'विज़ुअल उत्पन्न करें' पर क्लिक करें!" },
    visual_placeholder: { en: "Visual will appear here", hi: "विज़ुअल यहाँ दिखाई देगा" },
    visual_generate_btn: { en: "Generate Visual", hi: "विज़ुअल उत्पन्न करें" },
    video_title: { en: "Installation Preview", hi: "इंस्टॉलेशन पूर्वावलोकन" },
    video_subtitle: { en: "Here you can watch a personalized video based on your solar energy calculation. Just click 'Generate Video'!", hi: "यहाँ आप अपनी सौर ऊर्जा गणना के आधार पर एक व्यक्तिगत वीडियो देख सकते हैं। बस 'वीडियो उत्पन्न करें' पर क्लिक करें!" },
    video_placeholder: { en: "Video will appear here", hi: "वीडियो यहाँ दिखाई देगा" },
    video_generate_btn: { en: "Generate Video", hi: "वीडियो उत्पन्न करें" },
    help_title: { en: "Help Center", hi: "सहायता केंद्र" },
    help_subtitle1: { en: "Here you will find answers to frequently asked questions about solar energy, our calculator, and services.", hi: "यहाँ आपको सौर ऊर्जा, हमारे कैलकुलेटर और सेवाओं के बारे में अक्सर पूछे जाने वाले सवालों के जवाब मिलेंगे।" },
    faq1_q: { en: "What is solar energy?", hi: "सौर ऊर्जा क्या है?" },
    faq1_a: { en: "Solar energy is energy generated by converting sunlight into electricity, typically using photovoltaic (PV) panels.", hi: "सौर ऊर्जा वह ऊर्जा है जो सूर्य के प्रकाश को बिजली में बदलकर उत्पन्न होती है, आमतौर पर फोटोवोल्टिक (PV) पैनलों का उपयोग करके।" },
    faq2_q: { en: "What are the benefits of solar energy?", hi: "सौर ऊर्जा के क्या फायदे हैं?" },
    faq2_a: { en: "Solar energy reduces electricity bills, decreases the carbon footprint, and provides energy independence.", hi: "सौर ऊर्जा बिजली के बिल को कम करती है, कार्बन फुटप्रिंट को घटाती है और ऊर्जा स्वतंत्रता प्रदान करती है।" },
    contact_title: { en: "Contact Us", hi: "संपर्क" },
    contact_subtitle: { en: "Contact us to learn more about our solar energy solutions or for any inquiries.", hi: "हमारे सौर ऊर्जा समाधानों के बारे में अधिक जानने या किसी भी पूछताछ के लिए हमसे संपर्क करें।" },
    contact_name_placeholder: { en: "Your Name", hi: "आपका नाम" },
    contact_email_placeholder: { en: "Your Email", hi: "आपका ईमेल" },
    contact_message_placeholder: { en: "Your Message", hi: "आपका संदेश" },
    contact_send_btn: { en: "Send Message", hi: "संदेश भेजें" },
    footer_text: { en: "&copy; 2025 SOLAR FOR ALL.", hi: "&copy; 2025 SOLAR FOR ALL" },
    colonist_title: { en: "🚀 Solar Colonist Mode", hi: "🚀 सौर उपनिवेशक मोड" },
    colonist_subtitle: { en: "Here's the solar setup your home would need to survive off-world.", hi: "यह सौर सेटअप है जिसकी आपके घर को बाहरी दुनिया में जीवित रहने के लिए ज़रूरत होगी।" },
    mars_description: { en: "Due to a thin atmosphere and dust storms, you'd need a robust system.", hi: "पतले वायुमंडल और धूल भरी आँधियों के कारण, आपको एक मजबूत सिस्टम की ज़रूरत होगी।" },
    moon_description: { en: "To survive the 14-day lunar night, massive energy storage is critical.", hi: "14-दिवसीय चंद्र रात में जीवित रहने के लिए, बड़े पैमाने पर ऊर्जा भंडारण महत्वपूर्ण है।" },
    system_size_label: { en: "System Size", hi: "सिस्टम का आकार" },
    battery_storage_label: { en: "Battery Storage", hi: "बैटरी स्टोरेज" },
    
    // Calculator & Result Translations
    invalid_input: { en: "Please enter valid positive numbers for bill, tariff, and cost.", hi: "कृपया बिल, टैरिफ और लागत के लिए वैध सकारात्मक संख्याएं दर्ज करें।" },
    system_size_adjusted_roof: { en: "System size adjusted to fit your roof area.", hi: "सिस्टम का आकार आपकी छत के क्षेत्रफल के अनुसार समायोजित किया गया है।" },
    system_size_adjusted_budget: { en: "System size adjusted to fit your budget.", hi: "सिस्टम का आकार आपके बजट के अनुसार समायोजित किया गया है।" },
    location_not_found: { en: "Location not found. Please enter a valid address.", hi: "स्थान नहीं मिला। कृपया एक वैध पता दर्ज करें।" },
    size_label: { en: "System Size", hi: "सिस्टम का आकार" },
    cost_label: { en: "Total Cost", hi: "कुल लागत" },
    savings_label: { en: "Monthly Savings", hi: "मासिक बचत" },
    payback_label: { en: "Payback", hi: "रिकवरी" },
    co2_label: { en: "CO₂ Saved", hi: "बचाई गई CO₂" },
    trees_label: { en: "Trees Equivalent", hi: "पेड़ों के बराबर" },
    monthly_payment_label: { en: "Monthly Payment (₹)", hi: "मासिक भुगतान (₹)" },
    emi_label_12: { en: "12 EMI", hi: "12 EMI" },
    emi_label_24: { en: "24 EMI", hi: "24 EMI" },
    emi_label_36: { en: "36 EMI", hi: "36 EMI" },
    pollution_remaining: { en: "Remaining AQI", hi: "शेष AQI" },
    pollution_reduced: { en: "AQI Reduced by Solar", hi: "सौर ऊर्जा से कम हुआ AQI" },
    aqi_label: { en: "Air Quality Index (AQI)", hi: "वायु गुणवत्ता सूचकांक (AQI)" },
    original_aqi: { en: "Original AQI", hi: "मूल AQI" },
    gamification_title: { en: "🚀 Your Mission Impact", hi: "🚀 आपके मिशन का प्रभाव" },
    gamification_rover: { en: "Your annual energy could power NASA's <strong>Perseverance Rover on Mars for {roverDays} days!</strong>", hi: "आपकी वार्षिक ऊर्जा नासा के <strong>पर्सिवरेंस रोवर को मंगल ग्रह पर {roverDays} दिनों तक चला सकती है!</strong>" },
    gamification_iss: { en: "It could also power the <strong>International Space Station for {issSeconds} seconds!</strong>", hi: "यह <strong>अंतर्राष्ट्रीय अंतरिक्ष स्टेशन को {issSeconds} सेकंड तक भी चला सकती है!</strong>" },
    gamification_button: { en: "Activate Solar Colonist Mode", hi: "सौर उपनिवेशक मोड सक्रिय करें" },
    colonist_error: { en: "Please calculate your Earth-based system first!", hi: "कृपया पहले अपने पृथ्वी-आधारित सिस्टम की गणना करें!" },
    subsidy_not_eligible_title: { en: "❌ Not Eligible for Subsidy", hi: "❌ सब्सिडी के लिए पात्र नहीं" },
    subsidy_not_eligible_desc: { en: "Your electricity bill is very low, which suggests solar energy might not be the most economical option for you right now.", hi: "आपका बिजली बिल बहुत कम है, जो दर्शाता है कि सौर ऊर्जा अभी आपके लिए सबसे किफायती विकल्प नहीं हो सकती है।" },
    subsidy_eligible_title: { en: "💰 Your Subsidy Potential", hi: "💰 आपकी सब्सिडी की संभावना" },
    subsidy_eligible_desc: { en: "Based on your details, you may be eligible for the <strong>{schemeName}</strong>.", hi: "आपके विवरण के आधार पर, आप <strong>{schemeName}</strong> के लिए पात्र हो सकते हैं।" },
    subsidy_amount: { en: "Estimated Subsidy Amount: <strong>₹{subsidyAmount}</strong>", hi: "अनुमानित सब्सिडी राशि: <strong>₹{subsidyAmount}</strong>" },
    subsidy_cost_after: { en: "Cost after subsidy: <strong>₹{finalCost}</strong>", hi: "सब्सिडी के बाद लागत: <strong>₹{finalCost}</strong>" },
    subsidy_loan_details: { en: "Your estimated <strong>{bankName}</strong> EMI is <strong>₹{monthlyEMI}/month</strong> for a period of {loanTenure} years.", hi: "आपकी अनुमानित <strong>{bankName}</strong> EMI {loanTenure} साल की अवधि के लिए <strong>₹{monthlyEMI}/महीना</strong> है।" },
    subsidy_disclaimer: { en: "This is an estimate. Final amount may vary. Apply on the official government portal.", hi: "यह एक अनुमान है। अंतिम राशि भिन्न हो सकती है। आधिकारिक सरकारी पोर्टल पर आवेदन करें।" },
    no_scheme_found: { en: "No specific scheme found", hi: "कोई विशेष योजना नहीं मिली" },
    up_scheme: { en: "UP Solar Rooftop Subsidy Scheme", hi: "यूपी सोलर रूफटॉप सब्सिडी योजना" },
    gujarat_scheme: { en: "Gujarat Solar Subsidy Scheme", hi: "गुजरात सोलर सब्सिडी योजना" },
    no_loan: { en: "No Loan", hi: "कोई ऋण नहीं" },
    visual_error: { en: "Please run a calculation first.", hi: "कृपया पहले एक गणना चलाएँ।" },
    visual_generated: { en: "AI visual generated!", hi: "AI विज़ुअल उत्पन्न हुआ!" },
    video_error: { en: "Please run a calculation first.", hi: "कृपया पहले एक गणना चलाएँ।" },
    video_generated: { en: "AI video generated!", hi: "AI वीडियो उत्पन्न हुआ!" },
    chatbot_error: { en: "Sorry, I am having trouble connecting. Please try again later.", hi: "क्षमा करें, मुझे कनेक्ट करने में समस्या हो रही है। कृपया बाद में पुनः प्रयास करें।" },
    // New Translations for messages
    message_sent_success: { en: "Message sent successfully!", hi: "संदेश सफलतापूर्वक भेजा गया!" },
    invalid_login: { en: "Invalid username or password.", hi: "अवैध उपयोगकर्ता नाम या पासवर्ड।" },
    calculating_solar: { en: "Calculating your solar potential...", hi: "आपकी सौर क्षमता की गणना की जा रही है..." },
    explainer_generated_message: { en: "AI Solar Analysis Generated!", hi: "AI सौर विश्लेषण उत्पन्न हुआ!" },
    explainer_generate_first_message: { en: "Please run a calculation first to generate an AI explainer.", hi: "कृपया पहले एक गणना चलाएँ ताकि AI एक्सप्लेनर उत्पन्न हो सके।" },
    location_detecting: { en: "Attempting to auto-detect your location...", hi: "आपकी लोकेशन का स्वतः पता लगाने का प्रयास किया जा रहा है..." },
    location_gps_success: { en: "GPS location detected!", hi: "जीपीएस लोकेशन का पता चला!" },
    location_gps_fail: { en: "GPS location detected, but could not find address.", hi: "जीपीएस लोकेशन का पता चला, लेकिन पता नहीं मिल सका।" },
    location_detected_label: { en: "Detected Location", hi: "पता लगाया गया स्थान" },
    location_ip_try: { en: "GPS failed. Trying to find city via IP address...", hi: "जीपीएस विफल। आईपी एड्रेस के माध्यम से शहर खोजने का प्रयास किया जा रहा है..." },
    location_ip_success: { en: "Approximate location found: {city}", hi: "अनुमानित लोकेशन मिली: {city}" },
    location_approximate_label: { en: "Approximate location: {city}", hi: "अनुमानित स्थान: {city}" },
    location_autodetect_fail: { en: "Automatic location detection failed.", hi: "स्वचालित लोकेशन का पता लगाना विफल रहा।" },
    location_not_supported: { en: "Geolocation is not supported by your browser.", hi: "आपके ब्राउज़र द्वारा जियोलोकेशन समर्थित नहीं है।" },
    location_prompt: { en: "Please enter an address or enable location services.", hi: "कृपया एक पता दर्ज करें या लोकेशन सेवाएँ सक्षम करें।" },
    location_address_not_found: { en: "Could not find location from entered address.", hi: "दर्ज किए गए पते से लोकेशन नहीं मिल सका।" },
    nasa_fetching: { en: "Fetching data from NASA...", hi: "नासा से डेटा प्राप्त किया जा रहा है..." },
    nasa_unavailable: { en: "⚠️ NASA data unavailable. Using estimate (4.5 kWh).", hi: "⚠️ नासा डेटा उपलब्ध नहीं है। अनुमान का उपयोग किया जा रहा है (4.5 kWh)。" },
    reset_message: { en: "Form has been reset.", hi: "फॉर्म रीसेट हो गया है।" },
    aqi_good: { en: "Good", hi: "अच्छा" },
    aqi_moderate: { en: "Moderate", hi: "मध्यम" },
    aqi_unhealthy: { en: "Unhealthy", hi: "अस्वास्थ्यकर" },
    aqi_city: { en: "City", hi: "शहर" },
    chatbot_no_answer: { en: "I'm sorry, I can only answer questions from my knowledge base. Please ask about solar energy.", hi: "क्षमा करें, मैं केवल अपने ज्ञानकोष के प्रश्नों का उत्तर दे सकता हूँ। कृपया सौर ऊर्जा के बारे में पूछें।" },

    // Final Q&A for Chatbot
    chatbot_fallback_answers: {
        // 1. Greetings / General Conversation
        greetings: {
            keywords: ["hi", "hello", "hey", "namaste", "namaskar"],
            answer_en: "Hello! I am a solar energy assistant. How can I help you with solar today?",
            answer_hi: "नमस्ते! मैं एक सौर ऊर्जा सहायक हूँ। आज मैं सौर ऊर्जा से संबंधित आपकी क्या मदद कर सकता हूँ?"
        },
        how_are_you: {
            keywords: ["how are you", "kaise ho", "kya haal hai"],
            answer_en: "I'm doing great! How can I help you with solar power today?",
            answer_hi: "मैं बहुत अच्छा हूँ! मैं आज सौर ऊर्जा से संबंधित आपकी क्या मदद कर सकता हूँ?"
        },
        who_are_you: {
            keywords: ["who are you", "tum kon ho", "ap kon ho"],
            answer_en: "I am a helpful AI assistant designed to provide information about solar energy, subsidies, and installation.",
            answer_hi: "मैं एक सहायक AI हूँ जिसे सौर ऊर्जा, सब्सिडी और इंस्टॉलेशन के बारे में जानकारी देने के लिए डिज़ाइन किया गया है।"
        },
        what_can_you_do: {
            keywords: ["what can you do", "kya kar sakte ho", "tum kya kar sakte ho"],
            answer_en: "I can help you calculate your solar potential, find subsidies, and answer common questions about solar energy.",
            answer_hi: "मैं आपकी सौर क्षमता की गणना करने, सब्सिडी खोजने और सौर ऊर्जा के बारे में सामान्य प्रश्नों का उत्तर देने में आपकी मदद कर सकता हूँ।"
        },
        are_you_a_solar_chatbot: {
            keywords: ["are you a solar chatbot", "kya tum solar chatbot ho"],
            answer_en: "Yes, I am a specialized chatbot for solar energy.",
            answer_hi: "हाँ, मैं सौर ऊर्जा के लिए एक विशेष चैटबॉट हूँ।"
        },
        // 2. Basic Solar Knowledge
        what_is_solar_energy: {
            keywords: ["what is solar energy", "solar urja kya hai", "kya hai solar energy", "solar energy kya hai"],
            answer_en: "Solar energy is energy from the sun that is converted into thermal or electrical energy. It is a clean and renewable resource.",
            answer_hi: "सौर ऊर्जा सूर्य से प्राप्त होने वाली ऊर्जा है जिसे तापीय या विद्युत ऊर्जा में परिवर्तित किया जाता है। यह एक स्वच्छ और नवीकरणीय संसाधन है।"
        },
        how_does_solar_energy_work: {
            keywords: ["how does solar energy work", "solar energy kaise kaam karta hai", "kaise kaam karti hai solar energy"],
            answer_en: "Solar panels absorb sunlight and convert it into direct current (DC) electricity through the photovoltaic effect. An inverter then converts this DC into alternating current (AC) for home use.",
            answer_hi: "सोलर पैनल सूर्य के प्रकाश को अवशोषित करते हैं और इसे फोटोवोल्टिक प्रभाव के माध्यम से सीधे करंट (DC) बिजली में परिवर्तित करते हैं। फिर एक इन्वर्टर इस DC को घरों में उपयोग के लिए अल्टरनेटिंग करंट (AC) में बदल देता है।"
        },
        benefits_of_solar_energy: {
            keywords: ["benefits of solar energy", "solar ke fayde", "solar energy ke kya fayde hain"],
            answer_en: "The main benefits are reduced electricity bills, a lower carbon footprint, energy independence, and increased property value.",
            answer_hi: "मुख्य लाभों में कम बिजली बिल, कम कार्बन फुटप्रिंट, ऊर्जा आत्मनिर्भरता और संपत्ति के मूल्य में वृद्धि शामिल है।"
        },
        types_of_solar_energy: {
            keywords: ["types of solar energy", "solar energy kitne prakar ki hoti hai"],
            answer_en: "The two main types are solar thermal for heating and solar photovoltaic (PV) for generating electricity.",
            answer_hi: "दो मुख्य प्रकार हैं: हीटिंग के लिए सौर तापीय (solar thermal) और बिजली पैदा करने के लिए सौर फोटोवोल्टिक (PV)।"
        },
        how_do_solar_panels_work: {
            keywords: ["how do solar panels work", "solar panel kaise kaam karte", "solar panel how to", "kaise kam karta hai"],
            answer_en: "Solar panels convert sunlight directly into electricity. When sunlight hits the panels, the solar cells inside them generate power.",
            answer_hi: "सोलर पैनल सूरज की रोशनी को सीधे बिजली में बदलते हैं। जब सूरज की रोशनी पैनलों पर पड़ती है, तो उनमें मौजूद सोलर सेल बिजली पैदा करते हैं।"
        },
        difference_solar_power_energy: {
            keywords: ["difference between solar power and solar energy"],
            answer_en: "Solar energy refers to the radiant light and heat from the sun. Solar power refers to the conversion of this energy into electricity.",
            answer_hi: "सौर ऊर्जा सूर्य से निकलने वाली प्रकाश और गर्मी को संदर्भित करती है। सौर ऊर्जा इस ऊर्जा को बिजली में बदलने को संदर्भित करती है।"
        },
        // 3. Solar Panels
        what_are_solar_panels: {
            keywords: ["what are solar panels", "solar panel kya hote hain", "solar panels kya hai"],
            answer_en: "Solar panels are devices that convert sunlight into electricity. They are made of multiple solar cells connected together.",
            answer_hi: "सोलर पैनल ऐसे उपकरण हैं जो सूर्य के प्रकाश को बिजली में बदलते हैं। वे एक साथ जुड़े हुए कई सोलर सेल से बने होते हैं।"
        },
        types_of_solar_panels: {
            keywords: ["types of solar panels", "solar panel ke prakar", "mono", "poly", "thin-film"],
            answer_en: "The most common types are Monocrystalline (Mono-PERC), Polycrystalline, and Thin-film. Monocrystalline are generally the most efficient for homes.",
            answer_hi: "सबसे सामान्य प्रकार मोनोक्रिस्टलाइन (Mono-PERC), पॉलीक्रिस्टलाइन और थिन-फिल्म हैं। मोनोक्रिस्टलाइन आमतौर पर घरों के लिए सबसे कुशल होते हैं।"
        },
        best_panel_for_home: {
            keywords: ["which solar panel is best for home", "ghar ke liye sabse accha solar panel"],
            answer_en: "Monocrystalline panels are often considered the best for homes due to their high efficiency and compact size.",
            answer_hi: "मोनोक्रिस्टलाइन पैनलों को उनकी उच्च दक्षता और कॉम्पैक्ट आकार के कारण अक्सर घरों के लिए सबसे अच्छा माना जाता है।"
        },
        efficiency_of_solar_panels: {
            keywords: ["efficiency of solar panels", "solar panel kitna efficient hai"],
            answer_en: "Modern solar panels typically have an efficiency of 17-22%. Higher efficiency means more power generation from the same amount of sunlight.",
            answer_hi: "आधुनिक सोलर पैनलों की दक्षता आमतौर पर 17-22% होती है। उच्च दक्षता का मतलब है कि सूरज की रोशनी की समान मात्रा से अधिक बिजली उत्पादन।"
        },
        lifespan_of_solar_panels: {
            keywords: ["life span of solar panels", "solar panel kitne saal chalta hai"],
            answer_en: "Quality solar panels can last for 25 years or more, and they continue to generate power throughout their lifespan.",
            answer_hi: "अच्छे सोलर पैनल 25 साल या उससे ज़्यादा चल सकते हैं, और वे इस दौरान बिजली पैदा करते रहते हैं।"
        },
        cost_of_solar_panels_india: {
            keywords: ["cost of solar panels in india", "india me solar panel ka kharcha"],
            answer_en: "The cost in India is approximately ₹50,000 to ₹70,000 per kilowatt, but this can vary by state and brand. Our calculator can give you a better estimate.",
            answer_hi: "भारत में लागत प्रति किलोवाट लगभग ₹50,000 से ₹70,000 है, लेकिन यह राज्य और ब्रांड के अनुसार भिन्न हो सकती है। हमारा कैलकुलेटर आपको एक बेहतर अनुमान दे सकता है।"
        },
        how_many_panels_for_house: {
            keywords: ["how many solar panels do I need for my house", "ghar ke liye kitne panel chahiye"],
            answer_en: "The number of panels depends on your electricity usage and the available roof area. Our calculator can help you find the right system size for your needs.",
            answer_hi: "पैनलों की संख्या आपकी बिजली की खपत और उपलब्ध छत के क्षेत्रफल पर निर्भर करती है। हमारा कैलकुलेटर आपकी ज़रूरतों के लिए सही सिस्टम का आकार खोजने में आपकी मदद कर सकता है।"
        },
        // 4. Solar System Installation
        how_to_install_solar_panels: {
            keywords: ["how to install solar panels", "installation process", "solar panel kaise lagayein"],
            answer_en: "Installation involves mounting the panels on your roof, connecting them to an inverter, and integrating the system with your home's electrical grid. It's best to hire a certified professional for this.",
            answer_hi: "इंस्टॉलेशन में पैनलों को आपकी छत पर लगाना, उन्हें इन्वर्टर से जोड़ना, और सिस्टम को आपके घर की बिजली ग्रिड के साथ एकीकृत करना शामिल है। इसके लिए किसी प्रमाणित पेशेवर को किराए पर लेना सबसे अच्छा है।"
        },
        space_required_for_solar_panels: {
            keywords: ["space required for solar panels", "kitni jagah chahiye solar panel ke liye"],
            answer_en: "A 1 kW solar system generally requires about 100 sq ft of shadow-free roof area. The space needed depends on the system size.",
            answer_hi: "1 किलोवाट सौर प्रणाली के लिए आमतौर पर लगभग 100 वर्ग फुट छाया-मुक्त छत क्षेत्र की आवश्यकता होती है। आवश्यक स्थान सिस्टम के आकार पर निर्भर करता है।"
        },
        on_grid_vs_off_grid: {
            keywords: ["on-grid vs off-grid", "on-grid", "off-grid", "hybrid system"],
            answer_en: "On-grid systems are connected to the public power grid. Off-grid systems are independent and use batteries. Hybrid systems combine both for maximum reliability.",
            answer_hi: "ऑन-ग्रिड सिस्टम सार्वजनिक पावर ग्रिड से जुड़े होते हैं। ऑफ-ग्रिड सिस्टम स्वतंत्र होते हैं और बैटरी का उपयोग करते हैं। हाइब्रिड सिस्टम अधिकतम विश्वसनीयता के लिए दोनों को जोड़ते हैं।"
        },
        cost_of_system_size: {
            keywords: ["cost of installing a 1kw, 3kw, 5kw system", "1kw ka kharcha", "3kw ka kharcha", "5kw ka kharcha"],
            answer_en: "The cost per kilowatt is between ₹50,000 to ₹70,000. So, a 1kW system costs around ₹50-70k, a 3kW system around ₹1.5-2.1 lakh, and a 5kW system around ₹2.5-3.5 lakh.",
            answer_hi: "प्रति किलोवाट लागत ₹50,000 से ₹70,000 के बीच है। इसलिए, 1kW सिस्टम की लागत लगभग ₹50-70k, 3kW सिस्टम की लगभग ₹1.5-2.1 लाख, और 5kW सिस्टम की लगभग ₹2.5-3.5 लाख होती है।"
        },
        government_subsidy: {
            keywords: ["government subsidy for solar installation", "sarkari subsidy", "solar subsidy india"],
            answer_en: "Yes, the Indian government offers subsidies under the 'PM Surya Ghar Muft Bijli Yojana'. Our calculator can help you estimate your subsidy amount.",
            answer_hi: "हाँ, भारत सरकार 'पीएम सूर्य घर मुफ्त बिजली योजना' के तहत सब्सिडी प्रदान करती है। हमारा कैलकुलेटर आपकी सब्सिडी राशि का अनुमान लगाने में आपकी मदद कर सकता है।"
        },
        // 5. Solar Maintenance & Issues
        how_to_clean_solar_panels: {
            keywords: ["how to clean solar panels", "solar panel kaise saaf karein"],
            answer_en: "Solar panels should be cleaned regularly to remove dust and dirt. You can use a soft brush and water, but avoid harsh chemicals.",
            answer_hi: "धूल और गंदगी हटाने के लिए सोलर पैनलों को नियमित रूप से साफ करना चाहिए। आप एक नरम ब्रश और पानी का उपयोग कर सकते हैं, लेकिन कठोर रसायनों से बचें।"
        },
        do_solar_panels_work_at_night: {
            keywords: ["do solar panels work at night", "raat me solar kaam karta hai"],
            answer_en: "No, solar panels do not generate electricity at night. However, if you have a battery backup system, you can use the stored power.",
            answer_hi: "नहीं, सोलर पैनल रात में बिजली पैदा नहीं करते हैं। हालाँकि, यदि आपके पास बैटरी बैकअप सिस्टम है, तो आप संग्रहीत बिजली का उपयोग कर सकते हैं।"
        },
        do_solar_panels_work_on_cloudy_days: {
            keywords: ["do solar panels work on cloudy days", "badal me solar kaam karta hai"],
            answer_en: "Yes, solar panels still work on cloudy days, but their output is reduced. They can typically generate 10-25% of their normal output.",
            answer_hi: "हाँ, सोलर पैनल बादलों वाले दिनों में भी काम करते हैं, लेकिन उनका उत्पादन कम हो जाता है। वे आमतौर पर अपने सामान्य उत्पादन का 10-25% उत्पन्न कर सकते हैं।"
        },
        common_problems_in_solar_panels: {
            keywords: ["common problems in solar panels", "solar panel ki samasyayein"],
            answer_en: "Common problems include dirt buildup, inverter issues, and physical damage. Regular maintenance can prevent most of these.",
            answer_hi: "सामान्य समस्याओं में धूल का जमाव, इन्वर्टर की समस्याएं और भौतिक क्षति शामिल हैं। नियमित रखरखाव इनमें से अधिकांश को रोक सकता है।"
        },
        maintenance_cost: {
            keywords: ["maintenance cost of solar panels", "solar panel ka maintenance kharcha"],
            answer_en: "Solar panels have very low maintenance costs, mainly for cleaning and occasional check-ups. A professional check-up might cost between ₹500 to ₹1500 per year.",
            answer_hi: "सोलर पैनलों का रखरखाव खर्च बहुत कम होता है, मुख्य रूप से सफाई और कभी-कभी जांच के लिए। एक पेशेवर जांच में प्रति वर्ष ₹500 से ₹1500 के बीच खर्च आ सकता है।"
        },
        how_long_do_solar_batteries_last: {
            keywords: ["how long do solar batteries last", "solar battery kitne saal chalti hai"],
            answer_en: "Solar batteries typically last for 5 to 15 years, depending on the type and usage. Lithium-ion batteries have a longer lifespan than lead-acid batteries.",
            answer_hi: "सोलर बैटरी आमतौर पर 5 से 15 साल तक चलती हैं, जो उनके प्रकार और उपयोग पर निर्भर करता है। लिथियम-आयन बैटरी की उम्र लेड-एसिड बैटरी की तुलना में लंबी होती है।"
        },
        // 6. Solar Batteries & Inverters
        what_is_a_solar_inverter: {
            keywords: ["what is a solar inverter", "solar inverter kya hota hai"],
            answer_en: "A solar inverter is a device that converts the direct current (DC) electricity from solar panels into alternating current (AC) electricity that can be used by your home appliances.",
            answer_hi: "एक सोलर इन्वर्टर एक ऐसा उपकरण है जो सोलर पैनलों से आने वाली डायरेक्ट करंट (DC) बिजली को अल्टरनेटिंग करंट (AC) बिजली में परिवर्तित करता है जिसका उपयोग आपके घर के उपकरण कर सकते हैं।"
        },
        types_of_solar_inverters: {
            keywords: ["types of solar inverters", "solar inverter ke prakar"],
            answer_en: "Main types include string inverters, micro-inverters, and hybrid inverters. The choice depends on your system size and needs.",
            answer_hi: "मुख्य प्रकारों में स्ट्रिंग इन्वर्टर, माइक्रो-इन्वर्टर और हाइब्रिड इन्वर्टर शामिल हैं। चुनाव आपके सिस्टम के आकार और जरूरतों पर निर्भर करता है।"
        },
        best_inverter_for_home: {
            keywords: ["best inverter for home solar system", "ghar ke liye sabse accha inverter"],
            answer_en: "For most homes, a good quality hybrid inverter is recommended as it can manage both solar and grid power and support a battery backup.",
            answer_hi: "अधिकांश घरों के लिए, एक अच्छी गुणवत्ता वाला हाइब्रिड इन्वर्टर अनुशंसित है क्योंकि यह सौर और ग्रिड दोनों बिजली का प्रबंधन कर सकता है और बैटरी बैकअप का समर्थन कर सकता है।"
        },
        what_is_a_solar_battery: {
            keywords: ["what is a solar battery", "solar battery kya hai"],
            answer_en: "A solar battery is a device that stores excess electricity generated by your solar panels for later use, especially at night or during power outages.",
            answer_hi: "एक सोलर बैटरी एक ऐसा उपकरण है जो आपके सोलर पैनलों द्वारा उत्पन्न अतिरिक्त बिजली को बाद में उपयोग के लिए संग्रहीत करता है, खासकर रात में या बिजली गुल होने के दौरान।"
        },
        // 7. Financial & Environmental Aspects
        how_much_money_can_i_save: {
            keywords: ["how much money can i save with solar", "solar se kitna paisa bacha sakta hu", "kitni bachat"],
            answer_en: "The savings depend on your electricity consumption and the size of your solar system. Our calculator can give you an estimate of your monthly savings.",
            answer_hi: "बचत आपकी बिजली की खपत और आपके सौर ऊर्जा सिस्टम के आकार पर निर्भर करती है। हमारा कैलकुलेटर आपको आपकी मासिक बचत का अनुमान दे सकता है।"
        },
        payback_period: {
            keywords: ["payback period of solar system", "solar ka kharcha kitne saal me wapas aayega", "payback period"],
            answer_en: "The payback period is typically 4 to 6 years, but this can vary depending on the initial cost, your electricity tariff, and available subsidies.",
            answer_hi: "रिकवरी अवधि आमतौर पर 4 से 6 साल होती है, लेकिन यह प्रारंभिक लागत, आपके बिजली टैरिफ और उपलब्ध सब्सिडी के आधार पर भिन्न हो सकती है।"
        },
        how_does_solar_help_environment: {
            keywords: ["how does solar help the environment", "solar se paryavaran ko kaise fayda"],
            answer_en: "Solar energy reduces carbon emissions by using a clean, renewable energy source instead of fossil fuels. It helps combat climate change and air pollution.",
            answer_hi: "सौर ऊर्जा जीवाश्म ईंधन के बजाय एक स्वच्छ, नवीकरणीय ऊर्जा स्रोत का उपयोग करके कार्बन उत्सर्जन को कम करती है। यह जलवायु परिवर्तन और वायु प्रदूषण से लड़ने में मदद करती है।"
        },
        // 8. Advanced & Technical Questions
        what_is_solar_cell_efficiency: {
            keywords: ["what is solar cell efficiency", "solar cell efficiency kya hai"],
            answer_en: "Solar cell efficiency is the percentage of solar energy that a solar cell converts into usable electricity. Higher efficiency means better performance.",
            answer_hi: "सौर सेल दक्षता वह प्रतिशत है जो एक सौर सेल सौर ऊर्जा को उपयोग योग्य बिजली में परिवर्तित करता है। उच्च दक्षता का मतलब बेहतर प्रदर्शन है।"
        },
        what_is_net_metering: {
            keywords: ["what is net metering", "net metering kya hai"],
            answer_en: "Net metering is a billing mechanism that credits solar energy system owners for the electricity they add to the power grid. It allows you to use your solar power and get credit for the surplus you generate.",
            answer_hi: "नेट मीटरिंग एक बिलिंग प्रणाली है जो सौर ऊर्जा प्रणाली के मालिकों को उनके द्वारा पावर ग्रिड में जोड़ी गई बिजली के लिए क्रेडिट देती है। यह आपको अपनी सौर ऊर्जा का उपयोग करने और आपके द्वारा उत्पन्न अतिरिक्त बिजली के लिए क्रेडिट प्राप्त करने की अनुमति देती है।"
        },
        what_factors_affect_efficiency: {
            keywords: ["what factors affect solar panel efficiency", "kaun se factor efficiency ko affect karte hain"],
            answer_en: "Efficiency is affected by sunlight intensity, temperature, panel type, and dirt buildup. Cleaning panels regularly helps maintain efficiency.",
            answer_hi: "दक्षता सूर्य के प्रकाश की तीव्रता, तापमान, पैनल के प्रकार और धूल के जमाव से प्रभावित होती है। पैनलों को नियमित रूप से साफ करने से दक्षता बनाए रखने में मदद मिलती है।"
        },
        // 9. Location & Weather Based
        does_solar_work_in_rainy_season: {
            keywords: ["does solar work in rainy season", "baarish me solar kaam karta hai"],
            answer_en: "Solar panels work during the rainy season, but their output is lower due to reduced sunlight. A battery backup is essential during this time.",
            answer_hi: "सौर पैनल बरसात के मौसम में काम करते हैं, लेकिन कम धूप के कारण उनका उत्पादन कम होता है। इस दौरान बैटरी बैकअप आवश्यक है।"
        },
        best_location_for_panels: {
            keywords: ["best location for solar panels", "solar panels lagane ki sabse acchi jagah"],
            answer_en: "The best location is a south-facing rooftop with no shadows from trees or buildings throughout the day.",
            answer_hi: "सबसे अच्छी जगह एक दक्षिण की ओर वाली छत है जिस पर पूरे दिन पेड़ों या इमारतों की छाया न पड़े।"
        },
        // 10. Fun & Random Questions
        can_solar_power_a_car: {
            keywords: ["can solar power a car", "kya solar se car chala sakte hain"],
            answer_en: "Yes, electric cars can be charged using solar energy, either through solar panels on a charging station or at your home.",
            answer_hi: "हाँ, इलेक्ट्रिक कारों को सौर ऊर्जा का उपयोग करके चार्ज किया जा सकता है, या तो चार्जिंग स्टेशन पर लगे सोलर पैनलों के माध्यम से या आपके घर पर।"
        },
        who_invented_solar_panels: {
            keywords: ["who invented solar panels", "solar panel kisne banaya"],
            answer_en: "The photovoltaic effect was discovered by Edmond Becquerel in 1839. The first practical solar cell was developed by Bell Labs in 1954.",
            answer_hi: "फोटोवोल्टिक प्रभाव की खोज 1839 में एडमंड बेकरेल ने की थी। पहला व्यावहारिक सौर सेल 1954 में बेल लैब्स द्वारा विकसित किया गया था।"
        },
        can_i_run_ac_on_solar: {
            keywords: ["can i run ac on solar", "kya solar se ac chala sakte hain"],
            answer_en: "Yes, you can run an AC on solar, but it requires a large solar system with sufficient battery backup to handle the high power consumption.",
            answer_hi: "हाँ, आप सौर ऊर्जा पर एसी चला सकते हैं, लेकिन इसके लिए उच्च बिजली की खपत को संभालने के लिए पर्याप्त बैटरी बैकअप के साथ एक बड़ी सौर प्रणाली की आवश्यकता होती है।"
        },
    }
};

function changeLanguage(lang) {
    currentLanguage = lang;
    document.querySelectorAll('[data-lang-key]').forEach(element => {
        const key = element.getAttribute('data-lang-key');
        if (translations[key] && translations[key][lang]) {
            let text = translations[key][lang];
            if (lastCalc) {
                text = text.replace('{roverDays}', lastCalc.roverDays || '');
                text = text.replace('{issSeconds}', lastCalc.issSeconds || '');
                text = text.replace('{schemeName}', lastCalc.subsidyInfo.schemeName || '');
                text = text.replace('{subsidyAmount}', lastCalc.subsidyInfo.subsidyAmount.toLocaleString() || '');
                text = text.replace('{finalCost}', lastCalc.finalCostAfterSubsidy.toLocaleString() || '');
                text = text.replace('{bankName}', lastCalc.loanInfo.bankName || '');
                text = text.replace('{loanTenure}', lastCalc.loanInfo.loanTenure || '');
                text = text.replace('{monthlyEMI}', lastCalc.loanInfo.monthlyEMI ? lastCalc.loanInfo.monthlyEMI.toFixed(0).toLocaleString() : '');
            }
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = text;
            } else {
                element.innerHTML = text;
            }
        }
    });

    // EMI chart labels update
    if (chart) {
        chart.data.labels = [translations['emi_label_12'][currentLanguage], translations['emi_label_24'][currentLanguage], translations['emi_label_36'][currentLanguage]];
        chart.data.datasets[0].label = translations['monthly_payment_label'][currentLanguage];
        chart.update();
    }

    // Pollution chart labels update
    if (pollutionChart) {
        pollutionChart.data.labels = [translations['pollution_remaining'][currentLanguage], translations['pollution_reduced'][currentLanguage]];
        pollutionChart.data.datasets[0].label = translations['aqi_label'][currentLanguage];
        if (lastCalc && lastCalc.aqiData) {
            pollutionChart.options.plugins.title.text = `${translations['original_aqi'][currentLanguage]}: ${lastCalc.aqiData.aqi}`;
        }
        pollutionChart.update();
    }
    
    if (document.querySelector('#ai-explainer').classList.contains('active') && lastCalc) {
        generateAI();
    }
}