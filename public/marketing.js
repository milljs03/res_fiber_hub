import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    collection, getDocs, writeBatch, doc, query, where, limit, addDoc, setDoc, deleteDoc, orderBy, serverTimestamp, getCountFromServer, updateDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let map;
let drawingManager;
let geocoder; 
let currentPolygons = []; 
let currentAddresses = []; 
let currentAddressesRaw = []; 
let currentCampaignId = null; 
let marketingCollectionRef;
let activeCustomersCollectionRef; 
let campaignsCollectionRef;
let customersCollectionRef;
let conversionChart = null;

let localActiveCustomers = [];

let el = {};

export function initialize() {
    console.log("Initializing Marketing Dashboard...");

    el = {
        overlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),
        viewCreate: document.getElementById('view-create'),
        viewList: document.getElementById('view-list'),
        modeNewBtn: document.getElementById('mode-new'),
        modeListBtn: document.getElementById('mode-list'),
        
        nameInput: document.getElementById('camp-name'),
        dealInput: document.getElementById('camp-deal'),
        startInput: document.getElementById('camp-start'),
        endInput: document.getElementById('camp-end'),
        statusBadge: document.getElementById('status-badge'), 
        
        selectionStats: document.getElementById('selection-stats'),
        selectedCount: document.getElementById('selected-count'),
        performanceSection: document.getElementById('performance-section'),
        statPotential: document.getElementById('stat-potential'),
        statConverted: document.getElementById('stat-converted'),
        statRate: document.getElementById('stat-rate'),
        
        drawBtn: document.getElementById('draw-poly-btn'),
        saveBtn: document.getElementById('save-btn'),
        deleteBtn: document.getElementById('delete-btn'),
        exportBtn: document.getElementById('export-btn'),
        clearBtn: document.getElementById('clear-btn'),
        refreshStatsBtn: document.getElementById('refresh-stats-btn'),
        includeExistingCb: document.getElementById('include-existing-cb'), 
        includeActiveCustomersCb: document.getElementById('include-active-customers-cb'), 
        
        listContainer: document.getElementById('campaign-list-container'),
        gisUpload: document.getElementById('gis-upload'),
        activeCustomerUpload: document.getElementById('active-customer-upload'),
        taxRecordUpload: document.getElementById('tax-record-upload'),
        taxRecordKosciuskoUpload: document.getElementById('tax-record-kosciusko-upload') // NEW
    };

    const mapElement = document.getElementById("map");
    if (!mapElement) return;

    map = new google.maps.Map(mapElement, {
        center: { lat: 41.50, lng: -85.84 }, 
        zoom: 10,
        mapId: "MARKETING_MAP_ID", 
        streetViewControl: false,
        mapTypeControl: true
    });
    
    geocoder = new google.maps.Geocoder(); 

    initDrawingManager();
    setupEventListeners();

    onAuthStateChanged(auth, (user) => {
        if (user) {
            marketingCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'marketing_points');
            activeCustomersCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'marketing_active_customers');
            campaignsCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'marketing_campaigns');
            customersCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'customers');
            
            loadCampaignsList();
            fetchActiveCustomers(); 
        } else {
            window.location.href = 'index.html';
        }
    });
    
    if (window.lucide) window.lucide.createIcons();
}

function setupEventListeners() {
    if (el.modeNewBtn) el.modeNewBtn.addEventListener('click', () => { resetInterface(); switchView('create'); });
    if (el.modeListBtn) el.modeListBtn.addEventListener('click', () => switchView('list'));

    if (el.drawBtn) el.drawBtn.addEventListener('click', () => {
        drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
    });
    
    if (el.clearBtn) el.clearBtn.addEventListener('click', clearMap);
    if (el.exportBtn) el.exportBtn.addEventListener('click', exportCurrentSelection);
    if (el.saveBtn) el.saveBtn.addEventListener('click', saveCampaign);
    if (el.deleteBtn) el.deleteBtn.addEventListener('click', deleteCampaign);
    if (el.refreshStatsBtn) el.refreshStatsBtn.addEventListener('click', calculateCampaignStats);
    
    if (el.gisUpload) el.gisUpload.addEventListener('change', handleFileUpload);
    if (el.activeCustomerUpload) el.activeCustomerUpload.addEventListener('change', handleActiveCustomerUpload); 
    if (el.taxRecordUpload) el.taxRecordUpload.addEventListener('change', handleTaxRecordUpload);
    if (el.taxRecordKosciuskoUpload) el.taxRecordKosciuskoUpload.addEventListener('change', handleKosciuskoTaxRecordUpload); // NEW
    
    if (el.listContainer) {
        el.listContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.campaign-item');
            if (item) loadCampaignToMap(item.dataset.id);
        });
    }

    // Status listeners
    if (el.startInput) el.startInput.addEventListener('change', updateStatusUI);
    if (el.endInput) el.endInput.addEventListener('change', updateStatusUI);
}

function switchView(mode) {
    if (mode === 'create') {
        el.viewCreate.classList.remove('hidden');
        el.viewList.classList.add('hidden');
        el.modeNewBtn.classList.replace('btn-secondary', 'btn-primary');
        el.modeListBtn.classList.replace('btn-primary', 'btn-secondary');
    } else {
        el.viewCreate.classList.add('hidden');
        el.viewList.classList.remove('hidden');
        el.modeNewBtn.classList.replace('btn-primary', 'btn-secondary');
        el.modeListBtn.classList.replace('btn-secondary', 'btn-primary');
        loadCampaignsList(); 
    }
}

// ... [STATUS LOGIC UNCHANGED] ...
function calculateStatus(start, end) {
    if (!start || !end) return 'Draft';
    const now = new Date();
    now.setHours(0,0,0,0);
    const sParts = start.split('-');
    const sDate = new Date(sParts[0], sParts[1]-1, sParts[2]);
    const eParts = end.split('-');
    const eDate = new Date(eParts[0], eParts[1]-1, eParts[2]);
    if (now < sDate) return 'Pending';
    if (now > eDate) return 'Completed';
    return 'Active';
}

function updateStatusUI() {
    const sVal = el.startInput.value;
    const eVal = el.endInput.value;
    const status = calculateStatus(sVal, eVal);
    el.statusBadge.textContent = status;
    el.statusBadge.className = 'status-display'; 
    if (status === 'Draft') el.statusBadge.classList.add('st-draft');
    else if (status === 'Pending') el.statusBadge.classList.add('st-pending');
    else if (status === 'Active') el.statusBadge.classList.add('st-active');
    else if (status === 'Completed') el.statusBadge.classList.add('st-completed');
}

function resetInterface() {
    currentCampaignId = null; 
    el.nameInput.value = "";
    el.dealInput.value = "";
    el.startInput.value = "";
    el.endInput.value = "";
    updateStatusUI(); 
    el.saveBtn.textContent = "Save Campaign";
    el.saveBtn.disabled = false; 
    el.deleteBtn.classList.add('hidden');
    el.performanceSection.classList.add('hidden');
    clearMap();
    // We do NOT clear active customer points here, they persist in memory but are cleared from map
}

// ... [CAMPAIGN CRUD UNCHANGED] ...
async function saveCampaign() {
    const name = el.nameInput.value.trim();
    if (!name) { alert("Please enter a Campaign Name."); return; }
    if (!currentCampaignId && currentPolygons.length === 0) { 
        alert("Please draw at least one area on the map."); return; 
    }
    showLoading("Saving...");
    try {
        const formattedPolygons = currentPolygons.map(poly => {
            return {
                points: poly.getPath().getArray().map(coord => ({
                    lat: coord.lat(),
                    lng: coord.lng()
                }))
            };
        });
        const status = calculateStatus(el.startInput.value, el.endInput.value);
        const campaignData = {
            name: name,
            deal: el.dealInput.value.trim(),
            startDate: el.startInput.value,
            endDate: el.endInput.value,
            status: status, 
            updatedAt: serverTimestamp(),
            ...(currentAddresses.length > 0 && { addressCount: currentAddresses.length }),
            ...(formattedPolygons.length > 0 && { polygons: formattedPolygons })
        };
        if (currentCampaignId) {
            await setDoc(doc(campaignsCollectionRef, currentCampaignId), campaignData, { merge: true });
            alert("Campaign Updated!");
        } else {
            campaignData.createdAt = serverTimestamp();
            const docRef = await addDoc(campaignsCollectionRef, campaignData);
            currentCampaignId = docRef.id; 
            el.saveBtn.textContent = "Update Campaign";
            el.deleteBtn.classList.remove('hidden');
            el.performanceSection.classList.remove('hidden');
            calculateCampaignStats(); 
            alert("New Campaign Created!");
        }
        hideLoading();
    } catch (error) {
        console.error(error);
        hideLoading();
        alert(`Error saving: ${error.message}`);
    }
}

async function deleteCampaign() {
    if (!currentCampaignId) return;
    if (!confirm("DELETE this campaign? This cannot be undone.")) return;
    showLoading("Deleting...");
    try {
        await deleteDoc(doc(campaignsCollectionRef, currentCampaignId));
        hideLoading();
        alert("Campaign Deleted.");
        resetInterface();
        switchView('list');
    } catch (error) {
        hideLoading();
        console.error(error);
        alert("Delete failed.");
    }
}

async function loadCampaignsList() {
    if (!el.listContainer) return;
    el.listContainer.innerHTML = '<p style="text-align: center; color: #9ca3af; margin-top: 2rem;">Loading...</p>';
    try {
        const q = query(campaignsCollectionRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        el.listContainer.innerHTML = '';
        if (snapshot.empty) {
            el.listContainer.innerHTML = '<p style="text-align: center; color: #9ca3af;">No campaigns saved.</p>';
            return;
        }
        snapshot.forEach(doc => {
            const data = doc.data();
            const currentStatus = calculateStatus(data.startDate, data.endDate);
            const bgStyle = currentStatus === 'Active' ? 'background:#dcfce7; color:#166534;' : 
                           (currentStatus === 'Completed' ? 'background:#dbeafe; color:#1e40af;' : 
                           (currentStatus === 'Pending' ? 'background:#fef3c7; color:#b45309;' : 'background:#e5e7eb; color:#374151;'));
            const div = document.createElement('div');
            div.className = 'campaign-item';
            div.dataset.id = doc.id;
            div.dataset.json = JSON.stringify(data); 
            div.innerHTML = `
                <span class="list-badge" style="${bgStyle}">${currentStatus}</span>
                <h3 class="campaign-title">${data.name}</h3>
                <div class="campaign-meta">
                    ${data.addressCount || 0} Targets • ${data.deal || 'No Offer'}
                </div>
            `;
            el.listContainer.appendChild(div);
        });
    } catch (error) {
        console.error(error);
        el.listContainer.innerHTML = '<p style="color: red; text-align: center;">Error loading list.</p>';
    }
}

async function loadCampaignToMap(campaignId) {
    const item = el.listContainer.querySelector(`.campaign-item[data-id="${campaignId}"]`);
    if (!item) return;
    const data = JSON.parse(item.dataset.json);
    switchView('create');
    currentCampaignId = campaignId; 
    el.saveBtn.textContent = "Update Campaign";
    el.saveBtn.disabled = false; 
    el.deleteBtn.classList.remove('hidden');
    el.performanceSection.classList.remove('hidden');
    el.nameInput.value = data.name;
    el.dealInput.value = data.deal || "";
    el.startInput.value = data.startDate || "";
    el.endInput.value = data.endDate || "";
    updateStatusUI(); 
    el.statPotential.textContent = data.addressCount || 0;
    el.statConverted.textContent = "-";
    el.statRate.textContent = "-";
    clearMap();
    let pathsToLoad = [];
    if (data.polygons) {
        pathsToLoad = data.polygons.map(p => p.points);
    } else if (data.polygonPath) {
        pathsToLoad = [data.polygonPath];
    }
    if (pathsToLoad.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        pathsToLoad.forEach(pathData => {
            if (!Array.isArray(pathData)) return;
            const path = pathData.map(pt => new google.maps.LatLng(pt.lat, pt.lng));
            path.forEach(p => bounds.extend(p));
            const newPoly = createPolygon(path);
            currentPolygons.push(newPoly);
        });
        map.fitBounds(bounds);
        fetchAndPlotPoints();
        setTimeout(calculateCampaignStats, 1000);
    }
}

// ... [STATS LOGIC UNCHANGED] ...
async function calculateCampaignStats() {
    if (currentPolygons.length === 0) return;
    el.refreshStatsBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:12px; height:12px; margin-right:4px;"></i> Calcul...';
    el.refreshStatsBtn.disabled = true;
    if (window.lucide) window.lucide.createIcons();
    
    try {
        const q = query(customersCollectionRef);
        const snapshot = await getDocs(q);
        let actualSignups = 0;
        let statusBreakdown = { 'New Order': 0, 'Completed': 0, 'Other': 0 };
        snapshot.forEach(doc => {
            const cust = doc.data();
            if (cust.coordinates && cust.coordinates.lat && cust.coordinates.lng) {
                const latLng = new google.maps.LatLng(cust.coordinates.lat, cust.coordinates.lng);
                let isInside = false;
                for (const poly of currentPolygons) {
                    if (google.maps.geometry.poly.containsLocation(latLng, poly)) {
                        isInside = true;
                        break;
                    }
                }
                if (isInside) {
                    actualSignups++;
                    let cat = 'Other';
                    if (cust.status === 'New Order') cat = 'New Order';
                    else if (cust.status === 'Completed') cat = 'Completed';
                    else if (['Install Ready', 'NID Ready', 'Torys List', 'Site Survey Ready'].includes(cust.status)) cat = 'New Order';
                    if (cat === 'New Order') statusBreakdown['New Order']++;
                    else if (cat === 'Completed') statusBreakdown['Completed']++;
                    else statusBreakdown['Other']++;
                    addCustomerDotToMap(cust, cat);
                }
            }
        });
        const potential = parseInt(el.statPotential.textContent) || currentAddresses.length;
        const rate = potential > 0 ? ((actualSignups / potential) * 100).toFixed(1) : 0;
        el.statConverted.textContent = actualSignups;
        el.statRate.textContent = `${rate}%`;
        renderConversionChart(potential, actualSignups, statusBreakdown);
    } catch (error) {
        console.error("Stats Error:", error);
    } finally {
        el.refreshStatsBtn.innerHTML = '<i data-lucide="refresh-cw" style="width:12px; height:12px; margin-right:4px;"></i> Refresh';
        el.refreshStatsBtn.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }
}

// ... [MAP RENDER UNCHANGED] ...
function addCustomerDotToMap(customer, category) {
    const feature = new google.maps.Data.Feature({
        geometry: new google.maps.Data.Point({ lat: customer.coordinates.lat, lng: customer.coordinates.lng }),
        properties: { type: 'customer', category: category }
    });
    map.data.add(feature);
}

function updateMapStyle() {
    map.data.setStyle(feature => {
        const type = feature.getProperty('type');
        const category = feature.getProperty('category');
        if (type === 'customer') {
            let color = '#F59E0B'; 
            if (category === 'New Order') color = '#3B82F6';
            if (category === 'Completed') color = '#059669';
            return { icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: color, fillOpacity: 1, strokeWeight: 1, strokeColor: '#ffffff' }, zIndex: 10 };
        } else if (type === 'active_customer') {
            return { icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4, fillColor: '#1e40af', fillOpacity: 0.8, strokeWeight: 1, strokeColor: '#ffffff' }, zIndex: 5 };
        } else {
            return { icon: { path: google.maps.SymbolPath.CIRCLE, scale: 3, fillColor: '#9CA3AF', fillOpacity: 0.5, strokeWeight: 0 }, zIndex: 1 };
        }
    });
}

function renderConversionChart(potential, signups, breakdown) {
    const ctx = document.getElementById('conversion-chart');
    if (!ctx) return;
    if (conversionChart) conversionChart.destroy();
    conversionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Remaining Targets', 'New Orders', 'Completed', 'Other'],
            datasets: [{
                data: [Math.max(0, potential - signups), breakdown['New Order'], breakdown['Completed'], breakdown['Other']],
                backgroundColor: ['#e5e7eb', '#3b82f6', '#059669', '#f59e0b'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
    });
}

// ... [INIT DRAWING UNCHANGED] ...
function initDrawingManager() {
    drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: false,
        polygonOptions: { fillColor: "#4F46E5", fillOpacity: 0.15, strokeWeight: 2, strokeColor: "#4338ca", clickable: true, editable: true, zIndex: 1 }
    });
    drawingManager.setMap(map);
    google.maps.event.addListener(drawingManager, 'overlaycomplete', function(event) {
        const newShape = event.overlay;
        currentPolygons.push(newShape);
        addEditListeners(newShape);
        drawingManager.setDrawingMode(null);
        fetchAndPlotPoints();
    });
    updateMapStyle();
}

function createPolygon(path) {
    const poly = new google.maps.Polygon({ paths: path, fillColor: "#4F46E5", fillOpacity: 0.15, strokeWeight: 2, strokeColor: "#4338ca", clickable: true, editable: true, zIndex: 1, map: map });
    addEditListeners(poly);
    return poly;
}

function addEditListeners(poly) {
    const path = poly.getPath();
    ['set_at', 'insert_at', 'remove_at'].forEach(evt => {
        google.maps.event.addListener(path, evt, () => {
            clearTimeout(poly.timer);
            poly.timer = setTimeout(() => fetchAndPlotPoints(), 500);
        });
    });
    google.maps.event.addListener(poly, 'dragend', () => fetchAndPlotPoints());
    google.maps.event.addListener(poly, 'dblclick', () => {
        poly.setMap(null);
        currentPolygons = currentPolygons.filter(p => p !== poly);
        fetchAndPlotPoints();
    });
}

// --- FETCH POINTS (MARKETING DB) ---
async function fetchAndPlotPoints() {
    if (currentPolygons.length === 0) {
        clearDisplayedDots();
        return;
    }
    showLoading("Updating Map...");
    clearDisplayedDots(); 
    currentAddresses = [];
    currentAddressesRaw = []; 

    const bounds = new google.maps.LatLngBounds();
    currentPolygons.forEach(poly => {
        poly.getPath().forEach(p => bounds.extend(p));
    });

    const minLat = bounds.getSouthWest().lat();
    const maxLat = bounds.getNorthEast().lat();
    const minLng = bounds.getSouthWest().lng();
    const maxLng = bounds.getNorthEast().lng();

    try {
        const q = query(
            marketingCollectionRef, 
            where("lat", ">=", minLat),
            where("lat", "<=", maxLat)
        );

        const snapshot = await getDocs(q);
        let countInside = 0;

        snapshot.forEach(doc => {
            const pt = doc.data();
            if (pt.lng >= minLng && pt.lng <= maxLng) {
                const latLng = new google.maps.LatLng(pt.lat, pt.lng);
                let isInsideAny = false;
                for (const poly of currentPolygons) {
                    if (google.maps.geometry.poly.containsLocation(latLng, poly)) {
                        isInsideAny = true;
                        break; 
                    }
                }
                if (isInsideAny) {
                    addDotToMap(pt);
                    currentAddresses.push(pt.properties);
                    currentAddressesRaw.push(pt); 
                    countInside++;
                }
            }
        });

        if (localActiveCustomers.length > 0) {
            localActiveCustomers.forEach(ac => {
                if (ac.lat >= minLat && ac.lat <= maxLat && ac.lng >= minLng && ac.lng <= maxLng) {
                    const latLng = new google.maps.LatLng(ac.lat, ac.lng);
                    let isInsideAny = false;
                    for (const poly of currentPolygons) {
                        if (google.maps.geometry.poly.containsLocation(latLng, poly)) {
                            isInsideAny = true;
                            break; 
                        }
                    }
                    if (isInsideAny) {
                        addActiveCustomerDotToMap(ac);
                    }
                }
            });
        }

        if(el.selectedCount) el.selectedCount.textContent = countInside;
        if(el.statPotential) el.statPotential.textContent = countInside;
        if(el.selectionStats) el.selectionStats.classList.remove('hidden');
        if (countInside > 0) { el.exportBtn.disabled = false; }

    } catch (error) {
        console.error("Query Error:", error);
    } finally {
        hideLoading();
    }
}

function addDotToMap(pt) {
    const feature = new google.maps.Data.Feature({
        geometry: new google.maps.Data.Point({ lat: pt.lat, lng: pt.lng }),
        properties: { type: 'target', ...pt.properties }
    });
    map.data.add(feature);
}

function addActiveCustomerDotToMap(pt) {
    const feature = new google.maps.Data.Feature({
        geometry: new google.maps.Data.Point({ lat: pt.lat, lng: pt.lng }),
        properties: { type: 'active_customer' }
    });
    map.data.add(feature);
}

function clearMap() {
    currentPolygons.forEach(poly => poly.setMap(null));
    currentPolygons = [];
    clearDisplayedDots();
    currentAddresses = [];
    currentAddressesRaw = [];
    if(el.selectedCount) el.selectedCount.textContent = "0";
    if(el.selectionStats) el.selectionStats.classList.add('hidden');
    drawingManager.setDrawingMode(null);
}

function clearDisplayedDots() {
    map.data.forEach(f => map.data.remove(f));
}

// --- FETCH ACTIVE CUSTOMERS ---
async function fetchActiveCustomers() {
    try {
        const snapshot = await getDocs(query(activeCustomersCollectionRef));
        localActiveCustomers = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.lat && data.lng) {
                localActiveCustomers.push(data);
            }
        });
        console.log(`Loaded ${localActiveCustomers.length} active customer locations (hidden).`);
    } catch (error) {
        console.error("Error fetching active customers:", error);
    }
}

// --- UPDATED: Tax Record Logic with FUZZY FALLBACK ---
function handleTaxRecordUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (confirm("Process Elkhart Tax Records (New Format)?")) {
        showLoading("Parsing Elkhart Tax Records...");
        
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            delimiter: ",", 
            complete: async (results) => {
                await processTaxRecords(results.data);
            },
            error: err => { hideLoading(); alert("CSV Error: " + err.message); }
        });
    } else { 
        event.target.value = ''; 
    }
}

async function processTaxRecords(csvData) {
    // Maps for different matching strategies
    const taxRecordMap = new Map();         // Key: Strict Physical Address
    const taxRecordMailingMap = new Map();  // Key: Strict Mailing Address
    const houseNumberMap = new Map();       // Key: House Number (For fuzzy matching)

    let validRecordsCount = 0;
    console.log("Processing CSV Rows...");

    // Helper: Standardize abbreviations for fuzzy matching comparison
    // Converts "COUNTY ROAD" -> "CR", etc.
    const standardizeAddr = (str) => {
        if (!str) return "";
        let s = str.toUpperCase();
        // Standard replacements
        s = s.replace(/\bCOUNTY\s*ROAD\b/g, "CR");
        s = s.replace(/\bROAD\b/g, "RD");
        s = s.replace(/\bSTREET\b/g, "ST");
        s = s.replace(/\bAVENUE\b/g, "AVE");
        s = s.replace(/\bDRIVE\b/g, "DR"); 
        s = s.replace(/\bLANE\b/g, "LN");   
        s = s.replace(/\bNORTH\b/g, "N");
        s = s.replace(/\bSOUTH\b/g, "S");
        s = s.replace(/\bEAST\b/g, "E");
        s = s.replace(/\bWEST\b/g, "W");
        
        // Ordinals to Numerics
        s = s.replace(/\bFIRST\b/g, "1ST");
        s = s.replace(/\bSECOND\b/g, "2ND");
        s = s.replace(/\bTHIRD\b/g, "3RD");
        s = s.replace(/\bFOURTH\b/g, "4TH");
        s = s.replace(/\bFIFTH\b/g, "5TH");
        s = s.replace(/\bSIXTH\b/g, "6TH");
        s = s.replace(/\bSEVENTH\b/g, "7TH");
        s = s.replace(/\bEIGHTH\b/g, "8TH");
        s = s.replace(/\bNINTH\b/g, "9TH");
        s = s.replace(/\bTENTH\b/g, "10TH");
        
        return normalizeAddress(s); 
    };

    csvData.forEach(row => {
        const getCol = (pats) => {
            const key = Object.keys(row).find(k => pats.some(p => p.test(k)));
            return key ? row[key] : null;
        };

        const name = getCol([/owner/i, /name/i]);
        const mailingAddr = getCol([/mailingaddress/i, /mailing_address/i]);
        const mailingCity = getCol([/mailingcity/i, /mailing_city/i]);
        const mailingState = getCol([/mailingstate/i, /mailing_state/i]);
        const mailingZip = getCol([/mailingzip/i, /mailing_zip/i]);
        const physicalAddr = getCol([/physicaladdress/i, /physical_address/i, /^address$/i]);

        if (name) {
            // Build Full Mailing String
            let fullMailingString = "";
            if (mailingAddr) {
                fullMailingString = `${mailingAddr}, ${mailingCity || ''} ${mailingState || ''} ${mailingZip || ''}`.trim();
            } else if (physicalAddr) {
                fullMailingString = `${physicalAddr}, ${mailingCity || ''} ${mailingState || ''} ${mailingZip || ''}`.trim();
            }
            fullMailingString = fullMailingString.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').replace(/,$/, '');

            const recordData = {
                name: toTitleCase(name.trim()),
                mailing_full: fullMailingString,
                original_physical: physicalAddr || ""
            };

            let added = false;

            // 1. Populate Maps
            if (physicalAddr) {
                const normKey = normalizeAddress(physicalAddr);
                if (normKey) {
                    taxRecordMap.set(normKey, recordData);
                    
                    // Populate Fuzzy Map (Index by House Number)
                    const houseNumMatch = physicalAddr.match(/^\d+/);
                    if (houseNumMatch) {
                        const hn = houseNumMatch[0];
                        if (!houseNumberMap.has(hn)) houseNumberMap.set(hn, []);
                        
                        // Store standard version for comparison later
                        houseNumberMap.get(hn).push({
                            record: recordData,
                            stdAddr: standardizeAddr(physicalAddr)
                        });
                    }
                    added = true;
                }
            }

            if (mailingAddr) {
                const normMailingKey = normalizeAddress(mailingAddr);
                if (normMailingKey) {
                    taxRecordMailingMap.set(normMailingKey, recordData);
                    added = true;
                }
            }
            
            if (added) validRecordsCount++;
        }
    });

    if (validRecordsCount === 0) {
        hideLoading();
        alert("No valid records found.");
        return;
    }

    showLoading(`Loaded ${validRecordsCount} records. Matching against Database...`);
    
    try {
        const snapshot = await getDocs(marketingCollectionRef);
        
        let batch = writeBatch(db);
        let batchCount = 0;
        let matchCount = 0;
        let processedCount = 0;
        const totalDocs = snapshot.size;
        
        const docs = [];
        snapshot.forEach(docSnap => docs.push(docSnap));
        const PROCESS_CHUNK_SIZE = 1000; 

        for (let i = 0; i < docs.length; i += PROCESS_CHUNK_SIZE) {
            const chunk = docs.slice(i, i + PROCESS_CHUNK_SIZE);
            
            chunk.forEach(docSnap => {
                const data = docSnap.data();
                const props = data.properties || {};
                
                const dbAddress = findAddressValue(props);
                
                if (dbAddress) {
                    const normDbAddr = normalizeAddress(dbAddress);
                    
                    // --- MATCHING STRATEGY ---
                    // 1. Strict Physical Match
                    let record = taxRecordMap.get(normDbAddr);
                    
                    // 2. Strict Mailing Match
                    if (!record) {
                        record = taxRecordMailingMap.get(normDbAddr);
                    }

                    // 3. Fuzzy Physical Match (If strict failed)
                    // Logic: Match House Number -> Check if street name is substring
                    if (!record) {
                        const hnMatch = dbAddress.match(/^\d+/);
                        if (hnMatch) {
                            const hn = hnMatch[0];
                            const candidates = houseNumberMap.get(hn);
                            if (candidates) {
                                const dbStd = standardizeAddr(dbAddress);
                                // Check if normalized strings contain each other (e.g., "JAC" in "JACKSON")
                                const match = candidates.find(c => 
                                    c.stdAddr.includes(dbStd) || dbStd.includes(c.stdAddr)
                                );
                                if (match) record = match.record;
                            }
                        }
                    }
                    
                    if (record) {
                        const docRef = doc(marketingCollectionRef, docSnap.id);
                        const updateData = {};
                        let needsUpdate = false;

                        if (props.resident_name !== record.name) {
                            updateData["properties.resident_name"] = record.name;
                            needsUpdate = true;
                        }

                        if (props.mailing_address !== record.mailing_full) {
                            updateData["properties.mailing_address"] = record.mailing_full;
                            needsUpdate = true;
                        }
                        
                        if (needsUpdate) {
                            batch.update(docRef, updateData);
                            batchCount++;
                            matchCount++;
                        }
                    }
                }
            });

            if (batchCount >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
            }

            processedCount += chunk.length;
            showLoading(`Matching... ${Math.round((processedCount / totalDocs) * 100)}%`);
            await new Promise(r => setTimeout(r, 20)); 
        }

        if (batchCount > 0) {
            await batch.commit();
        }
        
        hideLoading();
        alert(`Success! Matched and updated ${matchCount} properties out of ${validRecordsCount} CSV records.`);

    } catch (error) {
        console.error("Error updating records:", error);
        hideLoading();
        alert("Error: " + error.message);
    }
}

// --- Kosciusko Logic ---
function handleKosciuskoTaxRecordUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (confirm("Process Kosciusko Tax Records?")) {
        showLoading("Parsing Kosciusko Records...");
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            delimiter: "", 
            complete: async (results) => {
                await processTaxRecords(results.data); // Reuse same logic
            },
            error: err => { hideLoading(); alert("CSV Error: " + err.message); }
        });
    } else { 
        event.target.value = ''; 
    }
}

// Helper Utils for Matching
function toTitleCase(str) {
    return str.replace(/\w\S*/g, function(txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
}

function findAddressValue(props) {
    // Common keys in GIS data
    const patterns = [/geofulladd/i, /full_?add/i, /address/i, /addr/i, /street/i];
    for (const pat of patterns) {
        const foundKey = Object.keys(props).find(k => pat.test(k));
        if (foundKey && props[foundKey]) return props[foundKey];
    }
    return null;
}

function normalizeAddress(addr) {
    if (!addr) return "";
    return String(addr).toUpperCase()
        .replace(/[^A-Z0-9]/g, '') // Remove non-alphanumeric (spaces, punctuation)
        .replace(/^0+/, '');       // Remove leading zeros
}

// ... [Active Customer Upload Logic remains same] ...
function handleActiveCustomerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (confirm("REPLACE active customer list?")) {
        showLoading("Parsing Active Customers...");
        setTimeout(() => {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                delimiter: "", 
                complete: res => uploadActiveCustomersToFirestore(res.data),
                error: err => { hideLoading(); alert("CSV Error: " + err.message); }
            });
        }, 100);
    } else { event.target.value = ''; }
}

async function uploadActiveCustomersToFirestore(rawData) {
    let useGeocoding = confirm("Do you want to Geocode addresses via Google Maps (Recommended if file coords are bad)?\n\nClick OK to Geocode (Takes time).\nClick Cancel to use 'Latitude'/'Longitude' columns from file.");
    const pointsToUpload = [];
    
    if (useGeocoding) {
        const getCol = (row, patterns) => {
            const key = Object.keys(row).find(k => patterns.some(p => p.test(k)));
            return key ? row[key] : '';
        };
        const queue = [];
        rawData.forEach(row => {
            let addr1 = getCol(row, [/^address 1$/i, /^address$/i, /^service address$/i, /^addr 1$/i, /^street$/i]);
            let addr2 = getCol(row, [/^address 2$/i, /^addr 2$/i, /^mailing address$/i]);
            let city = getCol(row, [/city/i, /serv address city/i]);
            let state = getCol(row, [/state/i]);
            let zip = getCol(row, [/zip/i]);
            let targetAddr = '';
            if (addr1 && String(addr1).trim().length > 0) targetAddr = addr1;
            else if (addr2 && String(addr2).trim().length > 0) targetAddr = addr2;
            if (targetAddr) {
                 let fullAddr = `${targetAddr}, ${city || ''} ${state || ''} ${zip || ''}`.trim();
                 fullAddr = fullAddr.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').replace(/^,/, '').replace(/,$/, '');
                 queue.push({ address: fullAddr });
            }
        });
        if (queue.length === 0) {
            hideLoading();
            alert("No address columns found to geocode.");
            return;
        }
        if (!confirm(`Found ${queue.length} addresses to geocode. This might take some time. Proceed?`)) {
            hideLoading();
            return;
        }
        await processGeocodingQueue(queue);
        return;
    } else {
        rawData.forEach(row => {
            const keys = Object.keys(row);
            const latKey = keys.find(k => /lat/i.test(k));
            const lonKey = keys.find(k => /lon|lng/i.test(k));
            if (latKey && lonKey) {
                const lat = parseFloat(row[latKey]);
                const lng = parseFloat(row[lonKey]);
                if (!isNaN(lat) && !isNaN(lng)) pointsToUpload.push({ lat, lng });
            }
        });
        if (pointsToUpload.length === 0) { hideLoading(); alert("No valid lat/lng found in file."); return; }
        await batchUploadPoints(pointsToUpload);
    }
}

async function processGeocodingQueue(queue) {
    showLoading("Cleaning Active DB...");
    try {
        while (true) {
            const snap = await getDocs(query(activeCustomersCollectionRef, limit(400)));
            if (snap.empty) break;
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
    } catch (err) { console.error("Clear DB Error", err); }

    const total = queue.length;
    let processed = 0;
    let success = 0;
    let currentBatch = writeBatch(db);
    let batchCount = 0;
    const BATCH_SIZE = 400;

    const processItem = async (index) => {
        if (index >= total) {
            try { if (batchCount > 0) await currentBatch.commit(); } catch (err) { console.error("Final commit fail", err); }
            hideLoading();
            alert(`Geocoding Complete! Successfully added ${success}/${total} addresses.`);
            fetchActiveCustomers();
            return;
        }
        const item = queue[index];
        const geocode = async (retries = 3) => {
            try {
                const result = await new Promise((resolve, reject) => {
                    geocoder.geocode({ address: item.address }, (results, status) => {
                        if (status === 'OK') resolve(results[0]);
                        else reject(status);
                    });
                });
                const loc = result.geometry.location;
                const docRef = doc(activeCustomersCollectionRef); 
                currentBatch.set(docRef, { lat: loc.lat(), lng: loc.lng(), address: item.address });
                batchCount++;
                success++;
                if (batchCount >= BATCH_SIZE) {
                    await currentBatch.commit();
                    currentBatch = writeBatch(db);
                    batchCount = 0;
                }
            } catch (status) {
                if (status === 'OVER_QUERY_LIMIT' && retries > 0) {
                    console.log(`Rate limit hit at ${index}. Waiting...`);
                    await new Promise(r => setTimeout(r, 2500));
                    return geocode(retries - 1);
                }
                console.warn(`Geocode failed for ${item.address}: ${status}`);
            }
        };
        try { await geocode(); } catch(e) { console.error("Geocode wrapper error", e); }
        processed++;
        if (processed % 5 === 0 || processed === total) showLoading(`Geocoding... ${processed}/${total} (${Math.round(processed/total*100)}%)`);
        setTimeout(() => processItem(index + 1), 650); 
    };
    processItem(0);
}

async function batchUploadPoints(points) {
    try {
        showLoading("Cleaning Active DB...");
        while (true) {
            const snap = await getDocs(query(activeCustomersCollectionRef, limit(400)));
            if (snap.empty) break;
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        const BATCH_SIZE = 400;
        const totalBatches = Math.ceil(points.length / BATCH_SIZE);
        for (let i = 0; i < totalBatches; i++) {
            const batch = writeBatch(db);
            const chunk = points.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
            chunk.forEach(pt => batch.set(doc(activeCustomersCollectionRef), pt));
            await batch.commit();
            showLoading(`Uploading Active... ${Math.round(((i+1)/totalBatches)*100)}%`);
        }
        await fetchActiveCustomers();
        hideLoading();
        alert("Active Customer List Updated!");
    } catch (e) {
        console.error(e);
        hideLoading();
        alert("Upload failed.");
    }
}

// --- EXPORT LOGIC WITH UPDATED COLUMNS ---
function exportCurrentSelection() {
    if (currentAddresses.length === 0) { alert("No data to export"); return; }

    // Define the specific headers requested
    const headers = ['Name', 'Mailing Address', 'City', 'State', 'Zip', 'Full Address'];
    const csvRows = [headers.join(',')];

    currentAddresses.forEach(row => {
        // Helper to find keys case-insensitively since DB keys might vary slightly
        const getVal = (searchKey) => {
            const foundKey = Object.keys(row).find(k => k.toLowerCase() === searchKey.toLowerCase());
            return foundKey ? row[foundKey] : '';
        };

        // specific logic to find 'Address' or 'Physical Address' for the concatenation
        const physAddr = getVal('Address') || getVal('Physical Address') || getVal('Street');
        const city = getVal('City');
        const state = getVal('State');
        const zip = getVal('Zip');

        // Concatenate "Full Address" (e.g., "68495 Jackson St. New Paris, IN 46553")
        const fullAddressString = `${physAddr} ${city}, ${state} ${zip}`.trim();

        // Build the row array matching the 'headers' order
        const values = [
            `"${(getVal('Name') || '').replace(/"/g, '""')}"`,
            `"${(getVal('Mailing Address') || getVal('Mailing') || '').replace(/"/g, '""')}"`,
            `"${(city || '').replace(/"/g, '""')}"`,
            `"${(state || '').replace(/"/g, '""')}"`,
            `"${(zip || '').replace(/"/g, '""')}"`,
            `"${fullAddressString.replace(/"/g, '""')}"`
        ];

        csvRows.push(values.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${el.nameInput.value || 'campaign'}_addresses.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function parseMailingString(str) {
    if (!str) return { street: "", city: "", state: "", zip: "" };
    
    // Check for our constructed format "Street, City State Zip"
    const parts = str.split(',');
    if (parts.length > 1) {
        const street = parts[0].trim();
        const rest = parts.slice(1).join(',').trim(); 
        
        // Regex for "CITY STATE ZIP"
        // Zip is last (5-10 chars), State is 2 chars before it
        const match = rest.match(/^(.*?)\s+([A-Za-z]{2})\s+([\d-]+)$/);
        if (match) {
            return { street, city: match[1], state: match[2], zip: match[3] };
        }
        
        // Fallback split logic
        const tokens = rest.split(/\s+/);
        const zip = tokens.length > 0 && /[\d-]/.test(tokens[tokens.length-1]) ? tokens.pop() : "";
        const state = tokens.length > 0 && tokens[tokens.length-1].length === 2 ? tokens.pop() : "";
        const city = tokens.join(" ");
        return { street, city, state, zip };
    }
    
    // No comma structure found, return whole string as street
    return { street: str, city: "", state: "", zip: "" };
}

function formatName(name) {
    if (!name) return "COMMUNITY MEMBER";
    
    // 1. Basic Clean: Upper case, trim
    let clean = name.toUpperCase().trim();
    
    // 2. Remove specific unwanted strings
    // User asked for (H&W). I'll also catch H&W without parens just in case, and standard variants.
    // Replacements with space ensure we don't merge words, but we'll normalize spaces later.
    clean = clean.replace(/\(H&W\)/g, " "); 
    clean = clean.replace(/\bH&W\b/g, " ");
    
    // Normalize spaces
    clean = clean.replace(/\s+/g, " ").trim();
    
    const parts = clean.split(" ");
    
    // Edge case: Single word name (Company?) or empty
    if (parts.length <= 1) return clean;
    
    const firstWord = parts[0];
    const lastWord = parts[parts.length - 1];
    
    // Logic: Remove first word. 
    // If original last word == first word, we are done.
    // If not, append first word to end.
    
    const remainder = parts.slice(1).join(" ");
    
    if (lastWord === firstWord) {
        return remainder;
    } else {
        return `${remainder} ${firstWord}`;
    }
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (confirm("REPLACE address database?")) {
        showLoading("Parsing...");
        setTimeout(() => {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: res => uploadToFirestore(res.data),
                error: err => { hideLoading(); alert("CSV Error: " + err.message); }
            });
        }, 100);
    } else { event.target.value = ''; }
}

async function uploadToFirestore(rawData) {
    const pointsToUpload = [];
    rawData.forEach(row => {
        const cleanRow = {};
        Object.keys(row).forEach(k => {
            const val = row[k];
            if(val !== undefined && val !== null) cleanRow[k.replace(/\./g, '_').trim()] = val;
        });
        const keys = Object.keys(row);
        const latKey = keys.find(k => /lat/i.test(k));
        const lonKey = keys.find(k => /lon|lng/i.test(k));
        if (latKey && lonKey) {
            const lat = parseFloat(row[latKey]);
            const lng = parseFloat(row[lonKey]);
            if (!isNaN(lat) && !isNaN(lng)) pointsToUpload.push({ lat, lng, properties: cleanRow });
        }
    });
    if (pointsToUpload.length === 0) { hideLoading(); alert("No valid data."); return; }
    try {
        showLoading("Cleaning DB...");
        while (true) {
            const snap = await getDocs(query(marketingCollectionRef, limit(400)));
            if (snap.empty) break;
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        const BATCH_SIZE = 400;
        const totalBatches = Math.ceil(pointsToUpload.length / BATCH_SIZE);
        for (let i = 0; i < totalBatches; i++) {
            const batch = writeBatch(db);
            const chunk = pointsToUpload.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
            chunk.forEach(pt => batch.set(doc(marketingCollectionRef), pt));
            await batch.commit();
            showLoading(`Uploading... ${Math.round(((i+1)/totalBatches)*100)}%`);
        }
        hideLoading();
        alert("Database Updated Successfully!");
    } catch (e) {
        console.error(e);
        hideLoading();
        alert("Upload failed.");
    }
}

function showLoading(text) {
    if (el.loadingText) el.loadingText.textContent = text;
    if (el.overlay) el.overlay.style.display = 'flex';
}
function hideLoading() {
    if (el.overlay) el.overlay.style.display = 'none';
}