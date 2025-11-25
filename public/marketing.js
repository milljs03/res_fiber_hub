import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    collection, getDocs, writeBatch, doc, query, where, limit, addDoc, setDoc, orderBy, serverTimestamp, getCountFromServer 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let map;
let drawingManager;
let currentPolygons = []; 
let currentAddresses = []; 
let currentCampaignId = null; 
let marketingCollectionRef;
let campaignsCollectionRef;

let el = {};

export function initialize() {
    console.log("Initializing Marketing Dashboard (Fixed Save)...");

    el = {
        overlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),
        viewCreate: document.getElementById('view-create'),
        viewList: document.getElementById('view-list'),
        modeNewBtn: document.getElementById('mode-new'),
        modeListBtn: document.getElementById('mode-list'),
        nameInput: document.getElementById('camp-name'),
        dealInput: document.getElementById('camp-deal'),
        detailsInput: document.getElementById('camp-details'),
        selectionStats: document.getElementById('selection-stats'),
        selectedCount: document.getElementById('selected-count'),
        drawBtn: document.getElementById('draw-poly-btn'),
        saveBtn: document.getElementById('save-btn'),
        exportBtn: document.getElementById('export-btn'),
        clearBtn: document.getElementById('clear-btn'),
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
            loadCampaignsList();
        } else {
            window.location.href = 'index.html';
        }
    });
}

function setupEventListeners() {
    if(el.modeNewBtn) {
        el.modeNewBtn.addEventListener('click', () => {
            resetInterface(); 
            switchView('create');
        });
    }

    if(el.modeListBtn) el.modeListBtn.addEventListener('click', () => switchView('list'));

    if(el.drawBtn) {
        el.drawBtn.addEventListener('click', () => {
            drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
        });
    }
    
    if(el.clearBtn) el.clearBtn.addEventListener('click', clearMap);
    if(el.exportBtn) el.exportBtn.addEventListener('click', exportCurrentSelection);
    if(el.saveBtn) el.saveBtn.addEventListener('click', saveCampaign);
    if(el.gisUpload) el.gisUpload.addEventListener('change', handleFileUpload);
    
    if(el.listContainer) {
        el.listContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.campaign-item');
            if (item) loadCampaignToMap(item.dataset.id);
        });
    }
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

function resetInterface() {
    currentCampaignId = null; 
    el.nameInput.value = "";
    el.dealInput.value = "";
    el.detailsInput.value = "";
    el.saveBtn.textContent = "Save Campaign";
    clearMap();
}

// --- CAMPAIGN LOGIC ---

async function saveCampaign() {
    const name = el.nameInput.value.trim();
    if (!name) { alert("Please enter a Campaign Name."); return; }
    if (currentPolygons.length === 0) { alert("Please draw at least one area."); return; }

    showLoading("Saving Campaign...");

    try {
        // FIX: Wrap array in an object to avoid "Nested arrays" error in Firestore
        const formattedPolygons = currentPolygons.map(poly => {
            return {
                points: poly.getPath().getArray().map(coord => ({
                    lat: coord.lat(),
                    lng: coord.lng()
                }))
            };
        });

        const campaignData = {
            name: name,
            deal: el.dealInput.value.trim(),
            details: el.detailsInput.value.trim(),
            updatedAt: serverTimestamp(),
            addressCount: currentAddresses.length,
            polygons: formattedPolygons // Now Array of Objects
        };

        if (currentCampaignId) {
            await setDoc(doc(campaignsCollectionRef, currentCampaignId), campaignData, { merge: true });
            alert("Campaign Updated!");
        } else {
            campaignData.createdAt = serverTimestamp();
            const docRef = await addDoc(campaignsCollectionRef, campaignData);
            currentCampaignId = docRef.id; 
            el.saveBtn.textContent = "Update Campaign";
            alert("New Campaign Created!");
        }
        
        hideLoading();
        switchView('list'); 

    } catch (error) {
        console.error(error);
        hideLoading();
        alert(`Error saving campaign: ${error.message}`);
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
            el.listContainer.innerHTML = '<p style="text-align: center; color: #9ca3af;">No campaigns saved yet.</p>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
            
            const div = document.createElement('div');
            div.className = 'campaign-item';
            div.dataset.id = doc.id;
            div.dataset.json = JSON.stringify(data); 
            
            div.innerHTML = `
                <h3 class="campaign-title">${data.name}</h3>
                <div class="campaign-meta">
                    ${date} • ${data.addressCount || 0} Addresses<br>
                    ${data.deal || ''}
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
    
    document.querySelectorAll('.campaign-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const data = JSON.parse(item.dataset.json);

    switchView('create');
    
    currentCampaignId = campaignId; 
    el.saveBtn.textContent = "Update Campaign";

    el.nameInput.value = data.name;
    el.dealInput.value = data.deal || "";
    el.detailsInput.value = data.details || "";

    clearMap();

    // Logic to handle New Format (Array of Objects) vs Legacy (Single Array)
    let pathsToLoad = [];

    if (data.polygons) {
        // New format: Array of { points: [...] }
        pathsToLoad = data.polygons.map(p => p.points);
    } else if (data.polygonPath) {
        // Legacy format: Array of lat/lngs
        pathsToLoad = [data.polygonPath];
    }

    const bounds = new google.maps.LatLngBounds();

    pathsToLoad.forEach(pathData => {
        // Ensure pathData is valid array
        if (!Array.isArray(pathData)) return;

        const path = pathData.map(pt => new google.maps.LatLng(pt.lat, pt.lng));
        path.forEach(p => bounds.extend(p));

        const newPoly = createPolygon(path);
        currentPolygons.push(newPoly);
    });

    map.fitBounds(bounds);
    fetchAndPlotPoints(); 
}

// --- MAP & DRAWING ---

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
}

async function fetchAndPlotPoints() {
    if (currentPolygons.length === 0) return;

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
        if(el.selectionStats) el.selectionStats.classList.remove('hidden');
        
        if (countInside > 0) {
            el.saveBtn.disabled = false;
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
        properties: pt.properties
    });
    map.data.add(feature);
    map.data.setStyle({
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 3,
            fillColor: '#059669',
            fillOpacity: 1,
            strokeWeight: 1,
            strokeColor: '#ffffff'
        }
    });
}

function clearMap() {
    currentPolygons.forEach(poly => poly.setMap(null));
    currentPolygons = [];
    
    clearDisplayedDots();
    currentAddresses = [];
    
    if(el.selectedCount) el.selectedCount.textContent = "0";
    if(el.selectionStats) el.selectionStats.classList.add('hidden');
    if(el.saveBtn) el.saveBtn.disabled = true;
    if(el.exportBtn) el.exportBtn.disabled = true;
    
    drawingManager.setDrawingMode(null);
}

function clearDisplayedDots() {
    map.data.forEach(f => map.data.remove(f));
}

// --- EXPORT & UPLOAD ---

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

    if (confirm("This will REPLACE your address database. Continue?")) {
        showLoading("Parsing...");
        setTimeout(() => {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: res => uploadToFirestore(res.data),
                error: err => { hideLoading(); alert("CSV Error: " + err.message); }
            });
        }, 100);
    } else {
        event.target.value = '';
    }
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
            if (!isNaN(lat) && !isNaN(lng)) {
                pointsToUpload.push({ lat, lng, properties: cleanRow });
            }
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
        alert("Upload failed. Check console.");
    }
}

// --- HELPERS ---
function showLoading(text) {
    if (el.loadingText) el.loadingText.textContent = text;
    if (el.overlay) el.overlay.style.display = 'flex';
}
function hideLoading() {
    if (el.overlay) el.overlay.style.display = 'none';
}