import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    collection, getDocs, writeBatch, doc, query, where, limit, addDoc, setDoc, deleteDoc, orderBy, serverTimestamp, getCountFromServer 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let map;
let drawingManager;
let currentPolygons = []; 
let currentAddresses = []; 
let currentCampaignId = null; 
let marketingCollectionRef;
let campaignsCollectionRef;
let customersCollectionRef;
let conversionChart = null;

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
        statusBadge: document.getElementById('status-badge'), // New
        
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
        
        listContainer: document.getElementById('campaign-list-container'),
        gisUpload: document.getElementById('gis-upload')
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

    initDrawingManager();
    setupEventListeners();

    onAuthStateChanged(auth, (user) => {
        if (user) {
            marketingCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'marketing_points');
            campaignsCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'marketing_campaigns');
            customersCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'customers');
            loadCampaignsList();
        } else {
            window.location.href = 'index.html';
        }
    });
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

// --- STATUS LOGIC ---

function calculateStatus(start, end) {
    if (!start || !end) return 'Draft';
    
    const now = new Date();
    now.setHours(0,0,0,0); // Compare dates only
    
    // Parse dates correctly (fixing timezone offsets)
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
    
    // Update classes
    el.statusBadge.className = 'status-display'; // Reset
    if (status === 'Draft') el.statusBadge.classList.add('st-draft');
    else if (status === 'Pending') el.statusBadge.classList.add('st-pending');
    else if (status === 'Active') el.statusBadge.classList.add('st-active');
    else if (status === 'Completed') el.statusBadge.classList.add('st-completed');
}

// --- UI RESET ---

function resetInterface() {
    currentCampaignId = null; 
    el.nameInput.value = "";
    el.dealInput.value = "";
    el.startInput.value = "";
    el.endInput.value = "";
    
    updateStatusUI(); // Reset to Draft

    el.saveBtn.textContent = "Save Campaign";
    el.saveBtn.disabled = false; 
    el.deleteBtn.classList.add('hidden');
    el.performanceSection.classList.add('hidden');
    clearMap();
}

// --- CAMPAIGN CRUD ---

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

        // Calculate status at save time too
        const status = calculateStatus(el.startInput.value, el.endInput.value);

        const campaignData = {
            name: name,
            deal: el.dealInput.value.trim(),
            startDate: el.startInput.value,
            endDate: el.endInput.value,
            status: status, // Save the calculated status
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
            // Recalculate status for display (handle expired campaigns)
            const currentStatus = calculateStatus(data.startDate, data.endDate);
            
            const statusClass = currentStatus === 'Active' ? 'st-active' : (currentStatus === 'Completed' ? 'st-completed' : (currentStatus === 'Pending' ? 'st-pending' : 'st-draft'));
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
    
    updateStatusUI(); // Update badge based on loaded dates

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

// --- EFFECTIVENESS & COLORING ---

async function calculateCampaignStats() {
    if (currentPolygons.length === 0) return;
    
    el.refreshStatsBtn.textContent = "Calcul...";
    el.refreshStatsBtn.disabled = true;
    
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
        el.refreshStatsBtn.textContent = "Refresh";
        el.refreshStatsBtn.disabled = false;
    }
}

function addCustomerDotToMap(customer, category) {
    const feature = new google.maps.Data.Feature({
        geometry: new google.maps.Data.Point({ 
            lat: customer.coordinates.lat, 
            lng: customer.coordinates.lng 
        }),
        properties: {
            type: 'customer',
            category: category
        }
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

            return {
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 5, 
                    fillColor: color,
                    fillOpacity: 1,
                    strokeWeight: 1,
                    strokeColor: '#ffffff'
                },
                zIndex: 10
            };
        } else {
            return {
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 3,
                    fillColor: '#9CA3AF', 
                    fillOpacity: 0.5,
                    strokeWeight: 0
                },
                zIndex: 1
            };
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
                data: [
                    Math.max(0, potential - signups), 
                    breakdown['New Order'], 
                    breakdown['Completed'], 
                    breakdown['Other']
                ],
                backgroundColor: ['#e5e7eb', '#3b82f6', '#059669', '#f59e0b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } }
            }
        }
    });
}

// --- MAP UTILS ---

function initDrawingManager() {
    drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: false,
        polygonOptions: {
            fillColor: "#4F46E5", fillOpacity: 0.15,
            strokeWeight: 2, strokeColor: "#4338ca",
            clickable: true, editable: true, zIndex: 1
        }
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
    const poly = new google.maps.Polygon({
        paths: path,
        fillColor: "#4F46E5", fillOpacity: 0.15,
        strokeWeight: 2, strokeColor: "#4338ca",
        clickable: true, editable: true, zIndex: 1,
        map: map
    });
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

async function fetchAndPlotPoints() {
    if (currentPolygons.length === 0) {
        clearDisplayedDots();
        return;
    }

    showLoading("Updating Map...");
    clearDisplayedDots();
    currentAddresses = [];

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
                    countInside++;
                }
            }
        });

        if(el.selectedCount) el.selectedCount.textContent = countInside;
        if(el.statPotential) el.statPotential.textContent = countInside;
        if(el.selectionStats) el.selectionStats.classList.remove('hidden');
        
        if (countInside > 0) {
            el.exportBtn.disabled = false;
        }

    } catch (error) {
        console.error("Query Error:", error);
    } finally {
        hideLoading();
    }
}

function addDotToMap(pt) {
    const feature = new google.maps.Data.Feature({
        geometry: new google.maps.Data.Point({ lat: pt.lat, lng: pt.lng }),
        properties: {
            type: 'target', 
            ...pt.properties
        }
    });
    map.data.add(feature);
}

function clearMap() {
    currentPolygons.forEach(poly => poly.setMap(null));
    currentPolygons = [];
    clearDisplayedDots();
    currentAddresses = [];
    if(el.selectedCount) el.selectedCount.textContent = "0";
    if(el.selectionStats) el.selectionStats.classList.add('hidden');
    drawingManager.setDrawingMode(null);
}

function clearDisplayedDots() {
    map.data.forEach(f => map.data.remove(f));
}

function exportCurrentSelection() {
    if (currentAddresses.length === 0) { alert("No data to export"); return; }
    const headers = Object.keys(currentAddresses[0]);
    const csvRows = [headers.join(',')];
    currentAddresses.forEach(row => {
        const values = headers.map(header => {
            const val = row[header] || '';
            return `"${String(val).replace(/"/g, '""')}"`;
        });
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