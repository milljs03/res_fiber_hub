import { db, auth } from './firebase.js';
import { 
    collection, getDocs, doc, updateDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

let map;
let geocoder;
let markers = [];
let customersCollectionRef;
let allPendingDrops = []; // Store local copy for sorting/filtering

// --- Initialization ---
export async function initialize() {
    // 1. Setup Map
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 41.500492, lng: -85.829624 }, 
        zoom: 12,
        mapId: "DROPS_MAP"
    });
    geocoder = new google.maps.Geocoder();

    // 2. Setup UI Listeners
    document.getElementById('sort-drops').addEventListener('change', () => {
        renderLists(); // Re-render with new sort
    });

    setupDragAndDrop();

    // 3. Auth Check
    onAuthStateChanged(auth, (user) => {
        if (user && user.email && user.email.endsWith('@nptel.com')) {
            customersCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'customers');
            loadDrops();
        } else {
            document.getElementById('loading-overlay').innerHTML = '<p style="color:red">Access Denied</p>';
        }
    });
}

// --- Data Loading ---
async function loadDrops() {
    try {
        const q = query(customersCollectionRef);
        const snapshot = await getDocs(q);
        
        allPendingDrops = [];
        const completedDrops = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            // Filter for Tory's List (handle both spellings)
            if (data.status === "Torys List" || data.status === "Tory's List") {
                allPendingDrops.push({ id: doc.id, ...data });
            }
            // Check for completed drops for analytics
            if (data.torysListChecklist?.completedAt && data.torysListChecklist?.addedAt) {
                completedDrops.push(data);
            }
        });

        console.log(`Found ${allPendingDrops.length} pending drops.`);
        
        calculateAndDisplayAnalytics(completedDrops);
        renderLists(); // Render the UI
        plotDrops(allPendingDrops); // Plot map
        
        document.getElementById('loading-overlay').style.display = 'none';

    } catch (error) {
        console.error("Error loading drops:", error);
        alert("Error loading data");
    }
}

// --- Helper: Get Valid Timestamp ---
function getSortTimestamp(item) {
    // 1. Try the specific time it was added to the list
    if (item.torysListChecklist?.addedAt?.seconds) {
        return item.torysListChecklist.addedAt.seconds;
    }
    // 2. Fallback to when the customer was created
    if (item.createdAt?.seconds) {
        return item.createdAt.seconds;
    }
    // 3. Last resort
    return 0;
}

// --- UI Rendering (Sorting & Splitting) ---
function renderLists() {
    const sortType = document.getElementById('sort-drops').value;
    
    // 1. Sort Data
    allPendingDrops.sort((a, b) => {
        if (sortType === 'name') {
            return (a.customerName || '').localeCompare(b.customerName || '');
        }
        
        const dateA = getSortTimestamp(a);
        const dateB = getSortTimestamp(b);

        if (sortType === 'newest') {
            return dateB - dateA; // Descending
        } else { // oldest
            return dateA - dateB; // Ascending
        }
    });

    // 2. Split into Priority vs Standard
    const priorityDrops = allPendingDrops.filter(c => c.torysListChecklist?.isPriority === true);
    const standardDrops = allPendingDrops.filter(c => !c.torysListChecklist?.isPriority);

    // Update Count
    document.getElementById('drop-count').textContent = allPendingDrops.length;

    // 3. Render Containers
    renderContainer('priority-list-container', priorityDrops, true);
    renderContainer('drops-list-container', standardDrops, false);
}

function renderContainer(containerId, drops, isPriority) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (drops.length === 0) {
        container.innerHTML = `<div class="empty-placeholder">${isPriority ? 'Drag priority drops here' : 'No standard drops pending.'}</div>`;
        return;
    }

    drops.forEach(customer => {
        const card = createCard(customer);
        container.appendChild(card);
    });
}

function createCard(customer) {
    const card = document.createElement('div');
    card.className = 'drop-card';
    card.draggable = true; // Enable dragging
    card.dataset.id = customer.id;
    
    // Calculate Time Outstanding
    let timeString = "Just added";
    let timeClass = "time-green";
    
    // Use our helper to get the best available time
    const timestamp = getSortTimestamp(customer);
    
    if (timestamp > 0) {
        const now = new Date();
        const added = new Date(timestamp * 1000);
        const diffTime = Math.abs(now - added);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        if (diffDays > 1) timeString = `${diffDays} days`;
        else if (diffDays === 1) timeString = "1 day";
        else timeString = "Today";

        if (diffDays > 14) timeClass = "time-red";
        else if (diffDays > 7) timeClass = "time-yellow";
    }

    card.innerHTML = `
        <div class="card-header">
            <h3 class="customer-name">${customer.customerName}</h3>
            <span class="time-badge ${timeClass}">${timeString}</span>
        </div>
        <p class="customer-address">${customer.address}</p>
        <p class="drop-notes ${!customer.installDetails?.dropNotes ? 'no-notes' : ''}">
            ${customer.installDetails?.dropNotes || 'No drop notes.'}
        </p>
        <button class="btn-mark-done" onclick="event.stopPropagation()">
            <img src="icons/check.png" style="width:16px; height:16px; filter: brightness(0) invert(1);" />
            Mark Drop Done
        </button>
    `;

    // Drag Events
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', customer.id);
        card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
    });

    // Click Events
    card.addEventListener('click', () => highlightCustomer(customer.id));
    card.querySelector('.btn-mark-done').addEventListener('click', (e) => {
        e.stopPropagation();
        handleMarkDone(customer);
    });

    return card;
}

// --- Drag and Drop Logic ---
function setupDragAndDrop() {
    const priorityZone = document.getElementById('priority-section');
    const standardZone = document.getElementById('standard-section');

    [priorityZone, standardZone].forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault(); // Allow drop
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', async (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            
            const customerId = e.dataTransfer.getData('text/plain');
            const isPriorityZone = zone.id === 'priority-section';
            
            await updatePriorityStatus(customerId, isPriorityZone);
        });
    });
}

async function updatePriorityStatus(customerId, isPriority) {
    // 1. Optimistic UI Update
    const customerIndex = allPendingDrops.findIndex(c => c.id === customerId);
    if (customerIndex === -1) return;

    // If status hasn't changed, do nothing
    if (!!allPendingDrops[customerIndex].torysListChecklist?.isPriority === isPriority) return;

    // Update local data
    if (!allPendingDrops[customerIndex].torysListChecklist) {
        allPendingDrops[customerIndex].torysListChecklist = {};
    }
    allPendingDrops[customerIndex].torysListChecklist.isPriority = isPriority;
    
    // Re-render immediately
    renderLists();

    // 2. Update Firestore
    try {
        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, {
            'torysListChecklist.isPriority': isPriority
        });
        console.log(`Updated ${customerId} priority to ${isPriority}`);
    } catch (error) {
        console.error("Error updating priority:", error);
        alert("Failed to save priority status.");
        // Revert on error (optional complexity)
    }
}

// --- Analytics ---
function calculateAndDisplayAnalytics(completedDrops) {
    let totalDropSeconds = 0;
    let dropsDoneYTD = 0;
    const currentYear = new Date().getFullYear();

    completedDrops.forEach(drop => {
        const added = drop.torysListChecklist.addedAt.seconds;
        const completed = drop.torysListChecklist.completedAt.seconds;
        totalDropSeconds += (completed - added);

        const completedDate = new Date(completed * 1000);
        if (completedDate.getFullYear() === currentYear) {
            dropsDoneYTD++;
        }
    });

    let avgDays = "N/A";
    if (completedDrops.length > 0) {
        const avgSeconds = totalDropSeconds / completedDrops.length;
        const avgDaysCalc = avgSeconds / (60 * 60 * 24);
        avgDays = avgDaysCalc.toFixed(1) + " days";
    }

    document.getElementById('avg-drop-time').textContent = avgDays;
    document.getElementById('drops-done-ytd').textContent = dropsDoneYTD;
}

// --- Map Logic ---
async function plotDrops(pendingDrops) {
    // Clear existing markers
    markers.forEach(m => m.setMap(null));
    markers = [];

    for (const customer of pendingDrops) {
        let coords = customer.coordinates;

        if (!coords || !coords.lat) {
            if (customer.address) {
                coords = await geocodeAddress(customer.address, customer.id);
            }
        }

        if (coords) {
            // Determine color based on priority
            const isPriority = customer.torysListChecklist?.isPriority;
            const pinColor = isPriority ? "#DC2626" : "#4F46E5"; // Red for Priority, Indigo for standard

            const marker = new google.maps.Marker({
                position: coords,
                map: map,
                title: customer.customerName,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: isPriority ? 12 : 10,
                    fillColor: pinColor,
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                }
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="padding:5px; font-family: 'Inter', sans-serif;">
                        <b style="font-size: 1rem;">${customer.customerName}</b>
                        ${isPriority ? '<br><span style="color:#DC2626; font-weight:bold;">PRIORITY</span>' : ''}
                        <br>${customer.address}
                        <p style="font-style: italic; margin: 4px 0 0 0; color: #374151;">${customer.installDetails?.dropNotes || ''}</p>
                    </div>
                `
            });

            marker.addListener('click', () => {
                markers.forEach(m => m.infoWindow.close());
                infoWindow.open(map, marker);
                scrollToCard(customer.id);
            });

            markers.push({ id: customer.id, marker: marker, infoWindow: infoWindow });
        }
    }
}

// --- Geocoding Helper ---
async function geocodeAddress(address, docId) {
    return new Promise((resolve) => {
        geocoder.geocode({ address: address }, async (results, status) => {
            if (status === 'OK') {
                const loc = results[0].geometry.location;
                const coords = { lat: loc.lat(), lng: loc.lng() };
                try {
                    const docRef = doc(customersCollectionRef, docId);
                    updateDoc(docRef, { coordinates: coords });
                } catch(e) { console.error("Cache error", e); }
                resolve(coords);
            } else {
                resolve(null);
            }
        });
    });
}

// --- Actions & Helpers ---
async function handleMarkDone(customer) {
    if (!await showConfirmModal(`Mark drop for ${customer.customerName} as DONE?`)) {
        return;
    }
    try {
        const btn = document.querySelector(`.drop-card[data-id="${customer.id}"] .btn-mark-done`);
        if (btn) { btn.disabled = true; btn.textContent = "Updating..."; }

        const docRef = doc(customersCollectionRef, customer.id);
        await updateDoc(docRef, { 
            status: "NID Ready",
            'torysListChecklist.completedAt': serverTimestamp() 
        });
        loadDrops();
    } catch (error) {
        console.error("Error updating:", error);
        alert("Failed.");
    }
}

function highlightCustomer(id) {
    document.querySelectorAll('.drop-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.drop-card[data-id="${id}"]`);
    if (card) card.classList.add('active');

    const markerObj = markers.find(m => m.id === id);
    if (markerObj) {
        map.panTo(markerObj.marker.getPosition());
        map.setZoom(15);
        markers.forEach(m => m.infoWindow.close());
        markerObj.infoWindow.open(map, markerObj.marker);
    }
}

function scrollToCard(id) {
    document.querySelectorAll('.drop-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.drop-card[data-id="${id}"]`);
    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add('active');
    }
    const markerObj = markers.find(m => m.id === id);
    if (markerObj) {
        markers.forEach(m => m.infoWindow.close());
        markerObj.infoWindow.open(map, markerObj.marker);
    }
}

async function showConfirmModal(message) {
    return new Promise((resolve) => {
        const oldModal = document.getElementById('confirm-modal-wrapper');
        if (oldModal) oldModal.remove();

        const modalWrapper = document.createElement('div');
        modalWrapper.id = 'confirm-modal-wrapper';
        modalWrapper.style = `position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background-color: rgba(0, 0, 0, 0.5); font-family: 'Inter', sans-serif;`;
        const modalPanel = document.createElement('div');
        modalPanel.style = `background-color: white; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); max-width: 400px; width: 90%;`;
        modalPanel.innerHTML = `<h3 style="font-size:1.25rem;font-weight:600;margin:0 0 0.75rem 0;">Confirm Action</h3><p style="font-size:0.875rem;color:#4b5563;margin-bottom:1.5rem;">${message}</p>`;
        const btnGroup = document.createElement('div');
        btnGroup.style = `display:flex;gap:0.75rem;justify-content:flex-end;`;
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.style = `padding:0.5rem 1rem;border:1px solid #d1d5db;background:white;border-radius:0.375rem;cursor:pointer;`;
        const confirm = document.createElement('button');
        confirm.textContent = 'Continue';
        confirm.style = `padding:0.5rem 1rem;border:none;background:#ef4444;color:white;border-radius:0.375rem;cursor:pointer;`;
        
        cancel.onclick = () => { modalWrapper.remove(); resolve(false); };
        confirm.onclick = () => { modalWrapper.remove(); resolve(true); };
        
        btnGroup.append(cancel, confirm);
        modalPanel.append(btnGroup);
        modalWrapper.append(modalPanel);
        document.body.append(modalWrapper);
    });
}