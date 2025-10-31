document.addEventListener('DOMContentLoaded', () => {

    /**
     * @typedef {Object} DOMReferences
     * @property {HTMLElement} statusToggle
     * @property {HTMLElement} searchBtn
     * @property {HTMLElement} homeView
     * @property {HTMLElement} mapView
     * @property {HTMLElement} exitBtn
     * @property {HTMLElement} map
     * @property {HTMLElement} userIdDisplay
     * @property {HTMLElement} ringBtn
     */

    /**
     * @typedef {Object} AppState
     * @property {string} userId
     * @property {string|null} partnerId
     * @property {boolean} isOnline
     * @property {Object.<string, number>} intervals
     */

    /**
     * Central configuration for the application.
     */
    const CONFIG = {
        POLLING_INTERVALS: {
            INCOMING_MATCH: 3000,
            ACTIVE_MATCH_STATE: 4000,
            PARTNER_LOCATION: 5000
        },
        STORAGE_KEYS: {
            USER_ID: 'partnerFinderUserId',
            PARTNER_ID: 'partnerFinderPartnerId',
            IS_ONLINE: 'partnerFinderIsOnline'
        }
    };

    /**
     * Handles all communication with the backend server.
     */
    class ApiService {
        async call(endpoint, body) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (!response.ok) throw new Error(`API Error: ${response.status}`);
                return response.json();
            } catch (error) {
                console.error(`API call to ${endpoint} failed:`, error);
                return null;
            }
        }
        updateLocation(userId, status, lat = 0, lon = 0) { return this.call('/update-location', { userId, status, lat, lon }); }
        findPartner(userId, lat, lon) { return this.call('/find-partner', { userId, lat, lon }); }
        checkStatus(userId) { return this.call('/check-status', { userId }); }
        getPartnerLocation(partnerId) { return this.call('/get-partner-location', { partnerId }); }
        exitMatch(userId, partnerId) { return this.call('/exit-match', { userId, partnerId }); }
        ringPartner(partnerId) { return this.call('/ring-partner', { partnerId }); }
    }

    /**
     * Manages the Leaflet map, markers, and routing polyline.
     */
    class MapService {
        constructor() {
            this.map = null;
            this.userMarker = null;
            this.partnerMarker = null;
            this.routeLine = null;
        }
        initialize(mapDiv, userLat, userLon, partnerLat, partnerLon) {
            if (this.map) this.map.remove();
            
            const userPosition = [userLat, userLon];
            const partnerPosition = [partnerLat, partnerLon];
            const customMarkerHtml = `<div class="location-marker"><div class="fov-cone"></div><div class="wave"></div><div class="dot"></div></div>`;
            const compassIcon = L.divIcon({ html: customMarkerHtml, className: '', iconSize: [20, 20], iconAnchor: [10, 10] });

            this.map = L.map(mapDiv);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
            }).addTo(this.map);
            
            this.userMarker = L.marker(userPosition, { icon: compassIcon }).addTo(this.map);
            this.partnerMarker = L.marker(partnerPosition).addTo(this.map).bindPopup('Partner');
            this.map.fitBounds(L.latLngBounds([userPosition, partnerPosition]).pad(0.5));
        }
        updateUserPosition(position) { if (this.userMarker) this.userMarker.setLatLng(position); }
        updatePartnerPosition(position) { if (this.partnerMarker) this.partnerMarker.setLatLng(position); }
        async drawRoute(start, end) {
            this.clearRoute();
            const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
            const url = `https://router.project-osrm.org/route/v1/walking/${coords}?geometries=geojson`;
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error('OSRM request failed');
                const routeData = await response.json();
                if (routeData?.routes?.length) {
                    this.routeLine = L.geoJSON(routeData.routes[0].geometry, {
                        style: { color: 'rgba(0, 122, 255, 0.8)', weight: 5 }
                    }).addTo(this.map);
                }
            } catch (error) {
                console.error("Error fetching route from OSRM:", error);
                throw error;
            }
        }
        clearRoute() {
            if (this.routeLine) {
                this.map.removeLayer(this.routeLine);
                this.routeLine = null;
            }
        }
    }

    /**
     * Manages the device orientation sensor for the FOV cone.
     */
    class CompassService {
        constructor(ui) {
            this.ui = ui;
            this.isListening = false;
            this.fovConeElement = null;
            this.orientationHandler = this._handleOrientation.bind(this);
        }
        _handleOrientation(event) {
            let heading = null;
            const screenAngle = screen.orientation.angle || 0;
            if (event.webkitCompassHeading) {
                heading = event.webkitCompassHeading;
            } else if (event.alpha !== null) {
                heading = 360 - event.alpha;
            }
            if (heading !== null) {
                const adjustedHeading = heading + screenAngle;
                const normalizedHeading = (adjustedHeading % 360 + 360) % 360;
                if (this.fovConeElement) {
                    window.requestAnimationFrame(() => {
                        this.fovConeElement.style.transform = `translate(-50%, -50%) rotate(${normalizedHeading}deg)`;
                    });
                }
            }
        }
        initialize() {
            if (this.isListening) return;
            this.fovConeElement = document.querySelector('.fov-cone');
            if (!this.fovConeElement) { return; }
            const startListener = () => {
                const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
                window.addEventListener(eventName, this.orientationHandler);
                this.isListening = true;
                console.log(`Compass activated using '${eventName}'.`);
            };
            if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission()
                    .then(state => {
                        if (state === 'granted') {
                            startListener();
                        } else {
                            this.ui.showInfoMessage('Compass permission denied.');
                        }
                    })
                    .catch(err => {
                        console.error(err);
                        this.ui.showInfoMessage('Could not activate compass.');
                    });
            } else if (window.DeviceOrientationEvent) {
                startListener();
            } else {
                this.ui.showInfoMessage('Compass not available on this device.');
            }
        }
        destroy() {
            if (this.isListening) {
                const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
                window.removeEventListener(eventName, this.orientationHandler);
                this.isListening = false;
                this.fovConeElement = null;
                console.log('Compass deactivated.');
            }
        }
    }

    /**
     * Manages all DOM interactions and user feedback.
     */
    class UIService {
        constructor(domRefs) {
            this.DOM = domRefs;
        }
        showInfoMessage(message) {
            const infoBox = document.createElement('div');
            infoBox.textContent = message;
            infoBox.className = 'info-box';
            document.body.appendChild(infoBox);
            setTimeout(() => infoBox.remove(), 3000);
        }
        switchToHomeView() {
            this.DOM.mapView.classList.add('hidden');
            this.DOM.homeView.classList.remove('hidden');
            this.DOM.statusToggle.checked = false;
            this.setSearchButtonState(true);
        }
        switchToMapView() {
            this.DOM.homeView.classList.add('hidden');
            this.DOM.mapView.classList.remove('hidden');
        }
        setSearchButtonState(disabled, text = 'Find Partner') {
            this.DOM.searchBtn.disabled = disabled;
            this.DOM.searchBtn.textContent = text;
        }
        playRingSound() {
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
                oscillator.connect(audioCtx.destination);
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.5);
            } catch (e) { console.error("Web Audio API not supported.", e); }
        }
    }

    /**
     * Manages the application's state and its persistence in localStorage.
     */
    class StateManager {
        constructor() {
            this.state = {
                userId: this._get(CONFIG.STORAGE_KEYS.USER_ID) || 'user-' + Math.random().toString(36).substring(2, 11),
                partnerId: this._get(CONFIG.STORAGE_KEYS.PARTNER_ID) || null,
                isOnline: this._get(CONFIG.STORAGE_KEYS.IS_ONLINE) === 'true',
            };
            this._set(CONFIG.STORAGE_KEYS.USER_ID, this.state.userId);
        }
        _get(key) { return localStorage.getItem(key); }
        _set(key, value) { localStorage.setItem(key, value); }
        _remove(key) { localStorage.removeItem(key); }
        setOnline(isOnline) {
            this.state.isOnline = isOnline;
            this._set(CONFIG.STORAGE_KEYS.IS_ONLINE, isOnline);
        }
        setMatch(partnerId) {
            this.state.partnerId = partnerId;
            this._set(CONFIG.STORAGE_KEYS.PARTNER_ID, partnerId);
            this.setOnline(true);
        }
        clearMatch() {
            this.state.partnerId = null;
            this._remove(CONFIG.STORAGE_KEYS.PARTNER_ID);
        }
    }

    /**
     * The main controller for the entire application.
     */
    class App {
        constructor() {
            this.pollingIntervals = {};
            this._selectDOMElements();
            this.stateManager = new StateManager();
            this.ui = new UIService(this.DOM);
            this.api = new ApiService();
            this.mapService = new MapService();
            this.compassService = new CompassService(this.ui);
        }

        _selectDOMElements() {
            this.DOM = {
                statusToggle: document.getElementById('status-toggle'),
                searchBtn: document.getElementById('search-btn'),
                homeView: document.getElementById('home-view'),
                mapView: document.getElementById('map-view'),
                exitBtn: document.getElementById('exit-btn'),
                map: document.getElementById('map'),
                userIdDisplay: document.getElementById('user-id-display'),
                ringBtn: document.getElementById('ring-btn'),
            };
        }

        bindEventListeners() {
            this.DOM.statusToggle.addEventListener('change', (e) => this.handleStatusToggle(e.target.checked));
            this.DOM.searchBtn.addEventListener('click', () => this.handleFindPartner());
            this.DOM.exitBtn.addEventListener('click', () => this.handleExitMatch());
            this.DOM.ringBtn.addEventListener('click', () => this.handleRingPartner());
            window.addEventListener('beforeunload', () => {
                if (this.stateManager.state.isOnline) {
                    const blob = new Blob([JSON.stringify({ userId: this.stateManager.state.userId, status: 'offline' })], { type: 'application/json' });
                    navigator.sendBeacon('/update-location', blob);
                }
            });
        }

        run() {
            this.DOM.userIdDisplay.textContent = `Your temporary ID: ${this.stateManager.state.userId}`;
            this.bindEventListeners();
            this.DOM.statusToggle.checked = this.stateManager.state.isOnline;

            if (this.stateManager.state.partnerId) {
                this.ui.showInfoMessage('Reconnecting to your session...');
                this.beginMatch(this.stateManager.state.partnerId);
            } else if (this.stateManager.state.isOnline) {
                this.ui.setSearchButtonState(false);
                this.updateUserLocation('online');
                this.startIncomingMatchPolling();
            }
        }

        handleStatusToggle(isOnline) {
            if (isOnline) {
                this.stateManager.setOnline(true);
                this.ui.setSearchButtonState(false);
                this.updateUserLocation('online');
                this.startIncomingMatchPolling();
            } else {
                this.handleExitMatch();
            }
        }

        handleFindPartner() {
            if (!navigator.geolocation) {
                this.ui.showInfoMessage('Geolocation is not supported by your browser.');
                return;
            }
            this.ui.setSearchButtonState(true, 'Searching...');
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const { latitude, longitude } = pos.coords;
                    const data = await this.api.findPartner(this.stateManager.state.userId, latitude, longitude);
                    if (data?.status === 'matched') {
                        this.beginMatch(data.partnerId);
                    } else {
                        this.ui.showInfoMessage('No online partners found. Try again later.');
                        this.ui.setSearchButtonState(false);
                    }
                },
                () => { this.ui.showInfoMessage('Could not get location to find a partner.'); this.ui.setSearchButtonState(false); },
                { enableHighAccuracy: true }
            );
        }

        async beginMatch(partnerId, partnerLocation = null) {
            this.ui.switchToMapView();
            this.stopAllPolling();
            this.stateManager.setMatch(partnerId);

            const partnerData = partnerLocation || await this.api.getPartnerLocation(partnerId);
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    if (partnerData?.lat && partnerData?.lon) {
                        const { latitude, longitude } = pos.coords;
                        this.updateUserLocation('matched');
                        this.mapService.initialize(this.DOM.map, latitude, longitude, partnerData.lat, partnerData.lon);
                        this.compassService.initialize();
                        this.mapService.drawRoute({ lat: latitude, lon: longitude }, { lat: partnerData.lat, lon: partnerData.lon })
                            .catch(() => this.ui.showInfoMessage("Could not calculate route."));
                        this.startActiveMatchPolling();
                    } else {
                        this.ui.showInfoMessage('Could not find partner location.');
                        this.handleExitMatch();
                    }
                },
                () => { this.ui.showInfoMessage('Could not get your location to start match.'); this.handleExitMatch(); }
            );
        }

        handleExitMatch() {
            const { userId, partnerId, isOnline } = this.stateManager.state;
            if (partnerId) {
                this.api.exitMatch(userId, partnerId);
            } else if (isOnline) {
                // This call ensures the server is notified before local state changes.
                this.updateUserLocation('offline');
            }

            this.stopAllPolling();
            this.mapService.clearRoute();
            this.compassService.destroy();
            this.stateManager.clearMatch();
            this.stateManager.setOnline(false); // Now set local state to offline.
            
            this.ui.switchToHomeView();
        }

        updateUserLocation(status) {
            const { userId } = this.stateManager.state;
            if (status === 'offline') {
                this.api.updateLocation(userId, 'offline');
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    this.api.updateLocation(userId, status, pos.coords.latitude, pos.coords.longitude);
                    this.mapService.updateUserPosition([pos.coords.latitude, pos.coords.longitude]);
                },
                () => this.ui.showInfoMessage('Could not update your location.'),
                { enableHighAccuracy: true }
            );
        }
        
        startIncomingMatchPolling() {
            this.stopAllPolling();
            this.pollingIntervals.statusCheck = setInterval(async () => {
                const data = await this.api.checkStatus(this.stateManager.state.userId);
                if (data?.status === 'matched' && data.partnerLocation) {
                    this.stopAllPolling();
                    this.beginMatch(data.partnerId, data.partnerLocation);
                }
            }, CONFIG.POLLING_INTERVALS.INCOMING_MATCH);
        }

        startActiveMatchPolling() {
            this.stopAllPolling();
            const { userId, partnerId } = this.stateManager.state;

            this.pollingIntervals.partnerLocation = setInterval(async () => {
                const data = await this.api.getPartnerLocation(partnerId);
                if (data?.lat) this.mapService.updatePartnerPosition([data.lat, data.lon]);
            }, CONFIG.POLLING_INTERVALS.PARTNER_LOCATION);
            
            this.pollingIntervals.matchState = setInterval(async () => {
                const data = await this.api.checkStatus(userId);
                if (data?.status === 'ringing') {
                    this.ui.playRingSound();
                    alert('Your partner is ringing you!');
                    this.updateUserLocation('matched');
                } else if (data?.status !== 'matched') {
                    this.ui.showInfoMessage('Your partner has ended the session.');
                    this.handleExitMatch();
                }
            }, CONFIG.POLLING_INTERVALS.ACTIVE_MATCH_STATE);
        }

        stopAllPolling() {
            Object.values(this.pollingIntervals).forEach(clearInterval);
            this.pollingIntervals = {};
        }

        handleRingPartner() {
            if (this.stateManager.state.partnerId) {
                this.api.ringPartner(this.stateManager.state.partnerId);
                this.ui.showInfoMessage(`Ringing your partner...`);
            }
        }
    }

    // Initialize and run the application
    const app = new App();
    app.run();
});

