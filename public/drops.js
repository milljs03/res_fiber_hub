import { db, auth } from './firebase.js';
import { 
    collection, getDocs, doc, updateDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

let map;
let geocoder;
let markers = [];
let customersCollectionRef;
// let dropsData = []; // This will now hold only PENDING drops

// --- Initialization ---
export async function initialize() {
    // 1. Setup Map
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 41.500492, lng: -85.829624 }, // Center on New Paris/Syracuse area
        zoom: 12,
        mapId: "DROPS_MAP"
    });
    geocoder = new google.maps.Geocoder();

    // 2. Auth Check
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
        
        const pendingDrops = [];
        const completedDrops = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            // Filter for Tory's List (handle both spellings)
            if (data.status === "Torys List" || data.status === "Tory's List") {
                pendingDrops.push({ id: doc.id, ...data });
            }
            // Check for completed drops
            if (data.torysListChecklist?.completedAt && data.torysListChecklist?.addedAt) {
                completedDrops.push(data);
            }
        });

        console.log(`Found ${pendingDrops.length} pending drops.`);
        console.log(`Found ${completedDrops.length} completed drops for analytics.`);
        
        calculateAndDisplayAnalytics(completedDrops);
        updateUI(pendingDrops); // Pass pending drops to the UI function
        document.getElementById('loading-overlay').style.display = 'none';

    } catch (error) {
        console.error("Error loading drops:", error);
        alert("Error loading data");
    }
}

// --- NEW: Analytics Function ---
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


// --- UI Updates ---
// Modified to accept pendingDrops as an argument
function updateUI(pendingDrops) {
    // Update Count
    document.getElementById('drop-count').textContent = pendingDrops.length;
    
    // Render List
    const container = document.getElementById('drops-list-container');
    container.innerHTML = '';
    
    if (pendingDrops.length === 0) {
        container.innerHTML = '<p class="loading-text">No active drops found.</p>';
        return;
    }

    pendingDrops.forEach(customer => {
        const card = document.createElement('div');
        card.className = 'drop-card';
        card.dataset.id = customer.id;
        
        // Updated card.innerHTML to include a placeholder for notes
        card.innerHTML = `
            <div class="card-header">
                <h3 class="customer-name">${customer.customerName}</h3>
            </div>
            <p class="customer-address">${customer.address}</p>
            <p class="drop-notes"></p> <!-- NEW: Notes placeholder -->
            <button class="btn-mark-done" onclick="event.stopPropagation()">
                <img src="icons/check.png" style="width:16px; height:16px; filter: brightness(0) invert(1);" />
                Mark Drop Done
            </button>
        `;

        // NEW: Safely populate the drop notes
        const notesEl = card.querySelector('.drop-notes');
        const dropNotes = customer.installDetails?.dropNotes;
        if (dropNotes && dropNotes.trim() !== "") {
            notesEl.textContent = dropNotes;
        } else {
            notesEl.textContent = "No drop notes.";
            notesEl.classList.add('no-notes'); // Add class for styling
        }

        // Card Click -> Pan Map
        card.addEventListener('click', () => {
            highlightCustomer(customer.id);
        });

        // Button Click -> Mark Done
        const btn = card.querySelector('.btn-mark-done');
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card click
            handleMarkDone(customer);
        });

        container.appendChild(card);
    });

    // Render Map Pins
    plotDrops(pendingDrops); // Pass pending drops to plotting
}

// --- Map Logic ---
// Modified to accept pendingDrops as an argument
async function plotDrops(pendingDrops) {
    // Clear existing markers
    markers.forEach(m => m.setMap(null));
    markers = [];

    for (const customer of pendingDrops) {
        let coords = customer.coordinates;

        // If no coords cached, geocode (and cache if possible)
        if (!coords || !coords.lat) {
            if (customer.address) {
                coords = await geocodeAddress(customer.address, customer.id);
            }
        }

        if (coords) {
            const marker = new google.maps.Marker({
                position: coords,
                map: map,
                title: customer.customerName,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 10,
                    fillColor: "#4F46E5", // Indigo (Tory's List color)
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                }
            });

            // Add Info Window
            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="padding:5px; font-family: 'Inter', sans-serif;">
                        <b style="font-size: 1rem;">${customer.customerName}</b><br>
                        ${customer.address}
                        <p style="font-style: italic; margin: 4px 0 0 0; color: #374151;">${customer.installDetails?.dropNotes || ''}</p>
                    </div>
                `
            });

            marker.addListener('click', () => {
                // Close all other info windows
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
                
                // Cache it asynchronously
                try {
                    const docRef = doc(customersCollectionRef, docId);
                    updateDoc(docRef, { coordinates: coords });
                } catch(e) { console.error("Cache error", e); }

                resolve(coords);
            } else {
                console.warn("Geocode failed:", status);
                resolve(null);
            }
        });
    });
}

// --- Action Handlers ---
async function handleMarkDone(customer) {
    // UPDATED: Use custom modal instead of confirm()
    if (!await showConfirmModal(`Mark drop for ${customer.customerName} as DONE? This will move them to 'NID Ready'.`)) {
        return;
    }

    try {
        // Show loading state on button
        const btn = document.querySelector(`.drop-card[data-id="${customer.id}"] .btn-mark-done`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Updating...";
        }

        // Update Firestore
        const docRef = doc(customersCollectionRef, customer.id);
        await updateDoc(docRef, { 
            status: "NID Ready",
            'torysListChecklist.completedAt': serverTimestamp() // NEW: Stop the clock
        });

        // RE-LOAD all data to update stats and list
        loadDrops();
        
    } catch (error) {
        console.error("Error updating status:", error);
        alert("Failed to update status.");
        // Re-enable button if it exists
        const btn = document.querySelector(`.drop-card[data-id="${customer.id}"] .btn-mark-done`);
        if (btn) {
             btn.disabled = false;
             // Restore button content
             btn.innerHTML = `<img src="icons/check.png" style="width:16px; height:16px; filter: brightness(0) invert(1);" /> Mark Drop Done`;
        }
    }
}

// --- Interaction Helpers ---
function highlightCustomer(id) {
    // 1. Highlight List Item
    document.querySelectorAll('.drop-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.drop-card[data-id="${id}"]`);
    if (card) {
        card.classList.add('active');
    }

    // 2. Highlight Map Marker
    const markerObj = markers.find(m => m.id === id);
    if (markerObj) {
        map.panTo(markerObj.marker.getPosition());
        map.setZoom(15);
        
        // Close other info windows
        markers.forEach(m => m.infoWindow.close());
        markerObj.infoWindow.open(map, markerObj.marker);
    }
}

function scrollToCard(id) {
    // 1. Highlight List Item
    document.querySelectorAll('.drop-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.drop-card[data-id="${id}"]`);
    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add('active');
    }

    // 2. Also open map marker
    const markerObj = markers.find(m => m.id === id);
    if (markerObj) {
        // Close other info windows
        markers.forEach(m => m.infoWindow.close());
        markerObj.infoWindow.open(map, markerObj.marker);
    }
}

// --- Custom Confirm Modal (copied from app.js) ---
async function showConfirmModal(message) {
    return new Promise((resolve) => {
        // Check if a modal already exists, remove it
        const oldModal = document.getElementById('confirm-modal-wrapper');
        if (oldModal) {
            oldModal.remove();
        }

        // Create modal elements
        const modalWrapper = document.createElement('div');
        modalWrapper.id = 'confirm-modal-wrapper';
        modalWrapper.style = `
            position: fixed; inset: 0; z-index: 2000;
            display: flex; align-items: center; justify-content: center;
            background-color: rgba(0, 0, 0, 0.5);
            font-family: 'Inter', sans-serif;
        `;

        const modalPanel = document.createElement('div');
        modalPanel.style = `
            background-color: white; padding: 1.5rem;
            border-radius: 0.75rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            max-width: 400px; width: 90%;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Confirm Action';
        title.style = 'font-size: 1.25rem; font-weight: 600; margin-top: 0; margin-bottom: 0.75rem;';
        
        const messageP = document.createElement('p');
        messageP.textContent = message;
        messageP.style = 'font-size: 0.875rem; color: #4b5563; margin-bottom: 1.5rem;';
        
        const buttonGroup = document.createElement('div');
        buttonGroup.style = 'display: flex; gap: 0.75rem; justify-content: flex-end;';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn btn-secondary'; // Assuming .btn styles are in style.css
        
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Continue';
        confirmBtn.className = 'btn btn-danger'; // Assuming .btn styles are in style.css

        // Manually apply btn styles if style.css isn't fully loaded
        const baseBtnStyles = `
            display: inline-flex; align-items: center; justify-content: center;
            border-radius: 0.375rem; border: 1px solid transparent;
            padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            transition: all 0.2s; cursor: pointer;
        `;
        
        cancelBtn.style = baseBtnStyles + `
            border-color: #d1d5db; background-color: white; color: #374151;
        `;
        confirmBtn.style = baseBtnStyles + `
            background-color: #ef4444; color: white; border-color: #ef4444;
        `;

        cancelBtn.onmouseover = () => { cancelBtn.style.backgroundColor = '#f9fafb'; };
        cancelBtn.onmouseout = () => { cancelBtn.style.backgroundColor = 'white'; };
        
        confirmBtn.onmouseover = () => { confirmBtn.style.backgroundColor = '#dc2626'; };
        confirmBtn.onmouseout = () => { confirmBtn.style.backgroundColor = '#ef4444'; };


        cancelBtn.onclick = () => { modalWrapper.remove(); resolve(false); };
        confirmBtn.onclick = () => { modalWrapper.remove(); resolve(true); };
        
        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(confirmBtn);
        modalPanel.appendChild(title);
        modalPanel.appendChild(messageP);
        modalPanel.appendChild(buttonGroup);
        modalWrapper.appendChild(modalPanel);
        document.body.appendChild(modalWrapper);
    });
}