/* ===========================
   SkyPulse – app.js
   Open-Meteo API (No API key needed, 100% free)
   https://open-meteo.com
   =========================== */

'use strict';

// ─── API Endpoints ────────────────────────────────────────────────────────────
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

// ─── State ────────────────────────────────────────────────────────────────────
let lastLat = null;
let lastLon = null;
let lastCityName = null;
let searchTimeout = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const loadingScreen = $('loadingScreen');
const errorScreen = $('errorScreen');
const weatherContent = $('weatherContent');

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  tryGeolocation();
  bindEvents();
  startClock();
});

// ─── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  $('searchBtn').addEventListener('click', onSearch);
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') onSearch(); });
  $('searchInput').addEventListener('input', onSearchInput);
  // Both location buttons
  $('locationBtn').addEventListener('click', tryGeolocation);
  $('locationBtnTop').addEventListener('click', tryGeolocation);
  $('retryBtn').addEventListener('click', () => {
    if (lastLat !== null) fetchWeather(lastLat, lastLon, lastCityName);
    else tryGeolocation();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-container')) clearSuggestions();
  });
  // Sidebar nav scroll-to
  $('navHourly').addEventListener('click', () => document.querySelector('.hourly-section')?.scrollIntoView({ behavior: 'smooth' }));
  $('navForecast').addEventListener('click', () => document.querySelector('.daily-section')?.scrollIntoView({ behavior: 'smooth' }));
  $('navAirQuality').addEventListener('click', () => $('aqiCard')?.scrollIntoView({ behavior: 'smooth' }));
  $('navWind').addEventListener('click', () => document.querySelector('.wind-panel')?.scrollIntoView({ behavior: 'smooth' }));
}

// ─── Screens ──────────────────────────────────────────────────────────────────
function showScreen(name) {
  loadingScreen.hidden = name !== 'loading';
  errorScreen.hidden = name !== 'error';
  weatherContent.hidden = name !== 'weather';
  if (name === 'loading') loadingScreen.style.display = 'flex';
  if (name === 'error') errorScreen.style.display = 'flex';
}

function showError(msg) {
  $('errorMsg').textContent = msg;
  showScreen('error');
}

// ─── Geolocation ──────────────────────────────────────────────────────────────
function tryGeolocation() {
  showScreen('loading');
  if (!navigator.geolocation) {
    fetchByCity('Mumbai');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      // Reverse geocode with Nominatim (free, no key)
      try {
        const res = await fetch(`${REVERSE_URL}?lat=${lat}&lon=${lon}&format=json`, {
          headers: { 'Accept-Language': 'en' }
        });
        const data = await res.json();
        const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || 'Your Location';
        fetchWeather(lat, lon, city);
      } catch {
        fetchWeather(lat, lon, 'Your Location');
      }
    },
    _err => fetchByCity('Mumbai'),
    { timeout: 8000 }
  );
}

// ─── Fetch by city name ───────────────────────────────────────────────────────
async function fetchByCity(cityName) {
  showScreen('loading');
  try {
    const res = await fetch(`${GEO_URL}?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`);
    const data = await res.json();
    if (!data.results?.length) throw new Error(`City "${cityName}" not found. Try another name.`);
    const r = data.results[0];
    fetchWeather(r.latitude, r.longitude, r.name + (r.country ? `, ${r.country}` : ''));
  } catch (err) {
    showError(err.message || 'City lookup failed.');
  }
}

// ─── Core Weather Fetch ───────────────────────────────────────────────────────
async function fetchWeather(lat, lon, cityLabel) {
  showScreen('loading');
  lastLat = lat; lastLon = lon; lastCityName = cityLabel;

  const weatherParams = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
      'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m',
      'wind_gusts_10m', 'surface_pressure', 'visibility', 'cloud_cover',
      'is_day'
    ].join(','),
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'sunrise', 'sunset', 'precipitation_probability_max', 'wind_speed_10m_max'
    ].join(','),
    wind_speed_unit: 'ms',
    timezone: 'auto',
    forecast_days: 5,
    forecast_hours: 25,
  });

  const airParams = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,sulphur_dioxide',
    timezone: 'auto',
  });

  try {
    const [weatherRes, airRes] = await Promise.all([
      fetch(`${WEATHER_URL}?${weatherParams}`),
      fetch(`${AIR_URL}?${airParams}`),
    ]);

    if (!weatherRes.ok) throw new Error(`Weather fetch failed (${weatherRes.status})`);

    const weather = await weatherRes.json();
    const air = airRes.ok ? await airRes.json() : null;

    renderAll(weather, air, cityLabel);
    showScreen('weather');
    $('lastUpdated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    showError(err.message || 'Failed to fetch weather data. Check your internet connection.');
  }
}

// ─── Render All ───────────────────────────────────────────────────────────────
function renderAll(weather, air, cityLabel) {
  renderCurrent(weather, cityLabel);
  renderHourly(weather);
  renderDaily(weather);
  renderSunriseSunset(weather);
  if (air) renderAQI(air);
  else $('aqiCard').style.display = 'none';
  renderWind(weather.current);
}

// ─── Current Conditions ───────────────────────────────────────────────────────
function renderCurrent(w, cityLabel) {
  const c = w.current;
  const u = w.current_units;
  const isDay = c.is_day === 1;

  const label = cityLabel || 'Your Location';
  $('cityName').textContent = label;
  $('countryName').textContent = `${parseFloat(lastLat).toFixed(2)}°N, ${parseFloat(lastLon).toFixed(2)}°E`;
  $('mainTemp').textContent = `${Math.round(c.temperature_2m)}°C`;
  $('weatherDesc').textContent = wmoDescription(c.weather_code);
  $('feelsLike').textContent = `Feels like ${Math.round(c.apparent_temperature)}°C`;
  $('tempRange').textContent = `Precip: ${c.precipitation} mm`;
  $('humidityVal').textContent = `${c.relative_humidity_2m}%`;
  $('windVal').textContent = `${c.wind_speed_10m} m/s`;
  $('visibilityVal').textContent = c.visibility != null ? `${(c.visibility / 1000).toFixed(1)} km` : '–';
  $('pressureVal').textContent = `${c.surface_pressure} hPa`;
  $('uvVal').textContent = `${c.precipitation} mm`;
  $('cloudinessVal').textContent = `${c.cloud_cover}%`;
  // Update topbar
  $('topbarCity').textContent = label;
  $('topbarDate').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Weather icon from open-meteo WMO code
  $('weatherIconLarge').src = wmoIcon(c.weather_code, isDay);
  $('weatherIconLarge').alt = wmoDescription(c.weather_code);
}

// ─── Hourly Forecast ─────────────────────────────────────────────────────────
function renderHourly(w) {
  const container = $('hourlyScroll');
  container.innerHTML = '';

  // Find current hour index
  const now = new Date();
  const nowHour = now.toISOString().slice(0, 13);
  const times = w.hourly.time;
  let startIdx = times.findIndex(t => t.startsWith(nowHour));
  if (startIdx < 0) startIdx = 0;

  const slots = times.slice(startIdx, startIdx + 9);

  slots.forEach((timeStr, i) => {
    const idx = startIdx + i;
    const time = new Date(timeStr);
    const label = i === 0 ? 'Now' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const temp = Math.round(w.hourly.temperature_2m[idx]);
    const pop = w.hourly.precipitation_probability[idx];
    const code = w.hourly.weather_code[idx];
    const isDay = time.getHours() >= 6 && time.getHours() < 20;

    const card = document.createElement('div');
    card.className = 'hourly-card' + (i === 0 ? ' active' : '');
    card.innerHTML = `
      <span class="hourly-time">${label}</span>
      <img class="hourly-icon" src="${wmoIcon(code, isDay)}" alt="${wmoDescription(code)}" />
      <span class="hourly-temp">${temp}°</span>
      ${pop != null ? `<span class="hourly-rain"><i class="fa-solid fa-droplet"></i> ${pop}%</span>` : ''}
    `;
    container.appendChild(card);
  });
}

// ─── Daily Forecast ───────────────────────────────────────────────────────────
function renderDaily(w) {
  const container = $('dailyGrid');
  container.innerHTML = '';
  const todayStr = new Date().toDateString();

  w.daily.time.forEach((dateStr, i) => {
    const date = new Date(dateStr + 'T12:00:00');
    const isToday = date.toDateString() === todayStr;
    const dayLabel = isToday ? 'Today' : date.toLocaleDateString([], { weekday: 'short' });
    const high = Math.round(w.daily.temperature_2m_max[i]);
    const low = Math.round(w.daily.temperature_2m_min[i]);
    const code = w.daily.weather_code[i];
    const pop = w.daily.precipitation_probability_max[i];

    const card = document.createElement('div');
    card.className = 'daily-card' + (isToday ? ' today' : '');
    card.innerHTML = `
      <span class="daily-day">${dayLabel}</span>
      <img class="daily-icon" src="${wmoIcon(code, true)}" alt="${wmoDescription(code)}" />
      <span class="daily-desc">${wmoDescription(code)}</span>
      <div class="daily-temps">
        <span class="daily-high">${high}°</span>
        <span class="daily-low">${low}°</span>
      </div>
      ${pop != null ? `<span class="daily-rain"><i class="fa-solid fa-droplet"></i> ${pop}%</span>` : ''}
    `;
    container.appendChild(card);
  });
}

// ─── Sunrise / Sunset ─────────────────────────────────────────────────────────
function renderSunriseSunset(w) {
  const sunrise = new Date(w.daily.sunrise[0]);
  const sunset = new Date(w.daily.sunset[0]);
  const now = new Date();

  $('sunriseTime').textContent = sunrise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('sunsetTime').textContent = sunset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Animate sun dot along SVG arc path
  const progress = Math.max(0, Math.min(1, (now - sunrise) / (sunset - sunrise)));
  const t = progress;
  const cx = (1 - t) * (1 - t) * 10 + 2 * (1 - t) * t * 100 + t * t * 190;
  const cy = (1 - t) * (1 - t) * 90 + 2 * (1 - t) * t * 10 + t * t * 90;
  const dot = $('sunDot');
  dot.setAttribute('cx', cx.toFixed(1));
  dot.setAttribute('cy', cy.toFixed(1));
}

// ─── Air Quality Index ────────────────────────────────────────────────────────
function renderAQI(air) {
  const aqi = air.current?.european_aqi;
  if (aqi == null) { $('aqiCard').style.display = 'none'; return; }

  // European AQI: 0-20 Good, 20-40 Fair, 40-60 Moderate, 60-80 Poor, 80-100 Very Poor, 100+ Extremely Poor
  let label, color, pct;
  if (aqi <= 20) { label = 'Good'; color = '#34d399'; pct = (aqi / 20) * 20; }
  else if (aqi <= 40) { label = 'Fair'; color = '#a3e635'; pct = 20 + ((aqi - 20) / 20) * 20; }
  else if (aqi <= 60) { label = 'Moderate'; color = '#facc15'; pct = 40 + ((aqi - 40) / 20) * 20; }
  else if (aqi <= 80) { label = 'Poor'; color = '#f97316'; pct = 60 + ((aqi - 60) / 20) * 20; }
  else if (aqi <= 100) { label = 'Very Poor'; color = '#ef4444'; pct = 80 + ((aqi - 80) / 20) * 20; }
  else { label = 'Extremely Poor'; color = '#8b5cf6'; pct = 100; }

  $('aqiValue').textContent = Math.round(aqi);
  $('aqiValue').style.color = color;
  $('aqiLabel').textContent = label;
  $('aqiLabel').style.color = color;
  $('aqiIndicator').style.left = `${Math.min(pct, 97)}%`;

  const c = air.current;
  const pollutants = [
    { name: 'PM2.5', val: c.pm2_5 },
    { name: 'PM10', val: c.pm10 },
    { name: 'NO₂', val: c.nitrogen_dioxide },
    { name: 'O₃', val: c.ozone },
    { name: 'CO', val: c.carbon_monoxide },
    { name: 'SO₂', val: c.sulphur_dioxide },
  ];
  $('aqiPollutants').innerHTML = pollutants.map(p => `
    <div class="pollutant-item">
      <span class="pollutant-name">${p.name}</span>
      <span class="pollutant-val">${p.val != null ? Number(p.val).toFixed(1) : '–'} μg/m³</span>
    </div>
  `).join('');
}

// ─── Wind Compass ─────────────────────────────────────────────────────────────
function renderWind(c) {
  if (!c) return;
  const deg = c.wind_direction_10m || 0;
  $('compassNeedle').style.transform = `translateX(-50%) rotate(${deg}deg)`;
  $('wdSpeed').textContent = `${c.wind_speed_10m} m/s`;
  $('wdGust').textContent = c.wind_gusts_10m ? `${c.wind_gusts_10m} m/s` : '–';
  $('wdDir').textContent = degToCompass(deg);
}

// ─── Search Autocomplete ──────────────────────────────────────────────────────
function onSearchInput() {
  const q = $('searchInput').value.trim();
  clearTimeout(searchTimeout);
  if (q.length < 2) { clearSuggestions(); return; }
  searchTimeout = setTimeout(() => fetchSuggestions(q), 350);
}

async function fetchSuggestions(q) {
  try {
    const res = await fetch(`${GEO_URL}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
    const data = await res.json();
    renderSuggestions(data.results || []);
  } catch { clearSuggestions(); }
}

function renderSuggestions(results) {
  const list = $('suggestionsList');
  list.innerHTML = '';
  if (!results.length) return;
  results.forEach(r => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const parts = [r.name, r.admin1, r.country].filter(Boolean);
    li.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${parts.join(', ')}`;
    li.addEventListener('click', () => {
      $('searchInput').value = r.name;
      clearSuggestions();
      fetchWeather(r.latitude, r.longitude, parts.join(', '));
    });
    list.appendChild(li);
  });
}

function clearSuggestions() { $('suggestionsList').innerHTML = ''; }

function onSearch() {
  const q = $('searchInput').value.trim();
  if (!q) return;
  clearSuggestions();
  fetchByCity(q);
}

// ─── Live Clock ────────────────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const el = $('dateTime');
    if (el && !weatherContent.hidden) {
      el.textContent = new Date().toLocaleDateString([], {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }) + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  tick();
  setInterval(tick, 30000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function degToCompass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ─── WMO Weather Code → Description ──────────────────────────────────────────
function wmoDescription(code) {
  const map = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Icy fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
    85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail',
  };
  return map[code] || 'Unknown';
}

// ─── WMO Weather Code → Icon URL (wttr.in icons, no key needed) ──────────────
function wmoIcon(code, isDay = true) {
  // Using open-meteo's recommended icon mapping via wttr.in or static emoji-style PNGs
  // We'll use a clean mapping to OpenWeatherMap icon set (publicly accessible images)
  const iconMap = {
    0: isDay ? '01d' : '01n',   // Clear sky
    1: isDay ? '01d' : '01n',   // Mainly clear
    2: isDay ? '02d' : '02n',   // Partly cloudy
    3: '04d',                    // Overcast
    45: '50d', 48: '50d',        // Fog
    51: '09d', 53: '09d', 55: '09d', // Drizzle
    61: '10d', 63: '10d', 65: '10d', // Rain
    71: '13d', 73: '13d', 75: '13d', 77: '13d', // Snow
    80: '09d', 81: '09d', 82: '09d', // Showers
    85: '13d', 86: '13d',         // Snow showers
    95: '11d', 96: '11d', 99: '11d', // Thunderstorm
  };
  const icon = iconMap[code] || (isDay ? '01d' : '01n');
  return `https://openweathermap.org/img/wn/${icon}@2x.png`;
}
