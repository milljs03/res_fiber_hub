import { db, auth } from './firebase.js';
import { 
    collection, getDocs, doc, updateDoc, query, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

let map;
let geocoder;
let markers = [];
let customersCollectionRef;
let allAssignedJobs = [];
let currentSplicer = 'Greg'; // Default changed from Rusty to Greg

// --- Initialization ---
export async function initialize() {
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 41.500492, lng: -85.829624 }, 
        zoom: 12,
        mapId: "SPLICER_MAP"
    });
    geocoder = new google.maps.Geocoder();

    // Tab Listeners
    document.querySelectorAll('.splicer-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.splicer-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentSplicer = e.target.dataset.splicer;
            renderList();
        });
    });

    onAuthStateChanged(auth, (user) => {
        if (user && user.email && user.email.endsWith('@nptel.com')) {
            customersCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'customers');
            loadData();
        } else {
            document.getElementById('loading-overlay').innerHTML = '<p style="color:red">Access Denied</p>';
        }
    });
    
    // Ensure initial icons render
    if (window.lucide) window.lucide.createIcons();
}

// --- Load Data ---
async function loadData() {
    try {
        const q = query(customersCollectionRef);
        const snapshot = await getDocs(q);
        
        allAssignedJobs = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            // Filter: NID Ready + Assigned + NOT Completed
            if (data.status === "NID Ready" && 
                data.splicingDetails?.assigned === true && 
                !data.splicingDetails?.completed) {
                
                allAssignedJobs.push({ id: doc.id, ...data });
            }
        });

        console.log(`Loaded ${allAssignedJobs.length} assigned jobs.`);
        renderList();
        document.getElementById('loading-overlay').style.display = 'none';

    } catch (error) {
        console.error("Error loading data:", error);
        alert("Error loading data");
    }
}

// --- Render ---
function renderList() {
    const container = document.getElementById('splicer-list-container');
    container.innerHTML = '';
    
    // Filter for current splicer tab
    const splicerJobs = allAssignedJobs.filter(job => 
        job.splicingDetails?.assignedSplicer === currentSplicer
    );

    document.getElementById('queue-count').textContent = splicerJobs.length;

    // Plot only these jobs
    plotMap(splicerJobs);

    if (splicerJobs.length === 0) {
        container.innerHTML = `<div class="empty-placeholder">No active jobs for ${currentSplicer}.</div>`;
        return;
    }

    splicerJobs.forEach(customer => {
        const card = createCard(customer);
        container.appendChild(card);
    });
    
    // Refresh icons for new cards
    if (window.lucide) window.lucide.createIcons();
}

function createCard(customer) {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.dataset.id = customer.id;

    const details = customer.splicingDetails || {};

    card.innerHTML = `
        <div class="card-header">
            <h3 class="customer-name">${customer.customerName}</h3>
        </div>
        <p class="customer-address">${customer.address}</p>
        
        <div class="job-details">
            <div class="detail-row">
                <span class="label">Handhole:</span>
                <span class="value">${details.handhole || 'N/A'}</span>
            </div>
            <div class="detail-row">
                <span class="label">Strand:</span>
                <span class="value">${details.strand || 'N/A'}</span>
            </div>
            <div class="detail-row full">
                <span class="label">Notes:</span>
                <p class="notes-text">${details.notes || 'No notes.'}</p>
            </div>
        </div>

        <button class="btn-complete" onclick="event.stopPropagation()">
            <i data-lucide="check" style="width:16px; height:16px; margin-right: 6px;"></i>
            Mark Splice Complete
        </button>
    `;

    card.addEventListener('click', () => highlightCustomer(customer.id));

    const btn = card.querySelector('.btn-complete');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleComplete(customer);
    });

    return card;
}

// --- Actions ---
async function handleComplete(customer) {
    if (!confirm(`Mark splice for ${customer.customerName} as COMPLETE?`)) return;

    try {
        // Optimistic UI removal
        const btn = document.querySelector(`.job-card[data-id="${customer.id}"] .btn-complete`);
        if(btn) { btn.textContent = "Completing..."; btn.disabled = true; }

        const docRef = doc(customersCollectionRef, customer.id);
        await updateDoc(docRef, {
            'splicingDetails.completed': true,
            'splicingDetails.completedAt': serverTimestamp()
            // We KEEP the status as "NID Ready" or optionally move to "Install Ready" here.
            // Based on request, we just mark it complete so it goes to Admin Completed tab.
        });

        // Remove locally
        allAssignedJobs = allAssignedJobs.filter(c => c.id !== customer.id);
        renderList(); // Re-render current tab

    } catch (error) {
        console.error("Error completing splice:", error);
        alert("Failed to update.");
        loadData(); // Reload on error
    }
}

// --- Map Helpers ---
async function plotMap(customers) {
    markers.forEach(m => m.setMap(null));
    markers = [];

    for (const customer of customers) {
        let coords = customer.coordinates;
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
                    fillColor: "#4F46E5",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                }
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `<div style="padding:5px; font-weight:600;">${customer.customerName}</div>`
            });

            marker.addListener('click', () => {
                markers.forEach(m => m.infoWindow.close());
                infoWindow.open(map, marker);
                scrollToCard(customer.id);
            });

            markers.push({ id: customer.id, marker, infoWindow });
        }
    }
}

async function geocodeAddress(address, docId) {
    return new Promise((resolve) => {
        geocoder.geocode({ address: address }, async (results, status) => {
            if (status === 'OK') {
                const loc = results[0].geometry.location;
                const coords = { lat: loc.lat(), lng: loc.lng() };
                try { updateDoc(doc(customersCollectionRef, docId), { coordinates: coords }); } catch(e){}
                resolve(coords);
            } else {
                resolve(null);
            }
        });
    });
}

function highlightCustomer(id) {
    document.querySelectorAll('.job-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.job-card[data-id="${id}"]`);
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
    document.querySelectorAll('.job-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.job-card[data-id="${id}"]`);
    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add('active');
    }
}