import { db, auth } from './firebase.js';
import { 
    collection, getDocs, doc, updateDoc, query, where, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

let map;
let geocoder;
let markers = [];
let customersCollectionRef;
let allData = [];
let currentView = 'pending'; // 'pending' or 'completed'

export async function initialize() {
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 41.500492, lng: -85.829624 }, 
        zoom: 12,
        mapId: "SPLICING_MAP"
    });
    geocoder = new google.maps.Geocoder();

    // Tab Logic
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentView = e.target.dataset.view;
            renderUI();
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
}

async function loadData() {
    try {
        const q = query(customersCollectionRef);
        const snapshot = await getDocs(q);
        
        allData = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === "NID Ready") {
                allData.push({ id: doc.id, ...data });
            }
        });

        console.log(`Loaded ${allData.length} NID Ready customers.`);
        renderUI();
        document.getElementById('loading-overlay').style.display = 'none';

    } catch (error) {
        console.error("Error loading data:", error);
        alert("Error loading data");
    }
}

function renderUI() {
    let customersToShow = [];

    if (currentView === 'pending') {
        // Not assigned yet
        customersToShow = allData.filter(c => !c.splicingDetails?.assigned);
        // Sort oldest drop completion first
        customersToShow.sort((a, b) => (a.torysListChecklist?.completedAt?.seconds || 0) - (b.torysListChecklist?.completedAt?.seconds || 0));
    } else {
        // Completed by splicer
        customersToShow = allData.filter(c => c.splicingDetails?.completed === true);
        // Sort newest completion first
        customersToShow.sort((a, b) => (b.splicingDetails?.completedAt?.seconds || 0) - (a.splicingDetails?.completedAt?.seconds || 0));
    }

    document.getElementById('pending-count').textContent = customersToShow.length;
    
    const container = document.getElementById('splicing-list-container');
    container.innerHTML = '';

    if (customersToShow.length === 0) {
        container.innerHTML = '<div class="empty-placeholder">No records found for this view.</div>';
        plotMap([]);
        return;
    }

    customersToShow.forEach(customer => {
        const card = createCard(customer, currentView);
        container.appendChild(card);
    });

    plotMap(customersToShow);
}

function createCard(customer, viewType) {
    const card = document.createElement('div');
    card.className = 'splice-card';
    card.dataset.id = customer.id;
    const details = customer.splicingDetails || {};

    if (viewType === 'pending') {
        let dropDateStr = "Unknown";
        if (customer.torysListChecklist?.completedAt) {
            dropDateStr = new Date(customer.torysListChecklist.completedAt.seconds * 1000).toLocaleDateString();
        }
        const currentDropNotes = customer.installDetails?.dropNotes || "";

        // Pre-select splicer if exists
        const splicerOptions = `
            <option value="" disabled ${!details.assignedSplicer ? 'selected' : ''}>Select Splicer</option>
            <option value="Rusty" ${details.assignedSplicer === 'Rusty' ? 'selected' : ''}>Rusty</option>
            <option value="Greg" ${details.assignedSplicer === 'Greg' ? 'selected' : ''}>Greg</option>
            <option value="Scott" ${details.assignedSplicer === 'Scott' ? 'selected' : ''}>Scott</option>
        `;

        card.innerHTML = `
            <div class="card-header">
                <h3 class="customer-name">${customer.customerName}</h3>
                <span class="date-badge">Drop Done: ${dropDateStr}</span>
            </div>
            <p class="customer-address">${customer.address}</p>
            <div class="splicing-form">
                <div class="form-row">
                    <div class="form-group-half">
                        <label>Handhole #</label>
                        <input type="text" class="form-input-sm input-handhole" placeholder="HH-000" value="${details.handhole || ''}">
                    </div>
                    <div class="form-group-half">
                        <label>Strand #</label>
                        <input type="text" class="form-input-sm input-strand" placeholder="Strand #" value="${details.strand || ''}">
                    </div>
                </div>
                <div class="form-group-full">
                    <label>Assign Splicer</label>
                    <select class="form-select-sm input-splicer">
                        ${splicerOptions}
                    </select>
                </div>
                <div class="form-group-full">
                    <label>Splicing Notes</label>
                    <textarea class="form-textarea-sm input-notes" rows="2" placeholder="Notes for splicer...">${details.notes || ''}</textarea>
                </div>
                <div class="btn-row">
                    <button class="btn-return" onclick="event.stopPropagation()">
                        <img src="icons/savecont.png" style="width:14px; height:14px; filter: brightness(0) invert(1); transform: rotate(180deg);" />
                        Return Drop
                    </button>
                    <button class="btn-release" onclick="event.stopPropagation()">
                        <img src="icons/check.png" style="width:14px; height:14px; filter: brightness(0) invert(1);" />
                        Release
                    </button>
                </div>
            </div>
        `;

        card.querySelector('.btn-release').addEventListener('click', (e) => {
            e.stopPropagation(); handleRelease(customer.id, card);
        });
        card.querySelector('.btn-return').addEventListener('click', (e) => {
            e.stopPropagation(); handleReturn(customer, currentDropNotes);
        });

    } else {
        // Completed View
        let doneDateStr = "Unknown";
        if (customer.splicingDetails?.completedAt) {
            doneDateStr = new Date(customer.splicingDetails.completedAt.seconds * 1000).toLocaleString();
        }

        card.innerHTML = `
            <div class="card-header">
                <h3 class="customer-name">${customer.customerName}</h3>
                <span class="date-badge" style="background:#dcfce7; color:#166534;">Done: ${doneDateStr}</span>
            </div>
            <p class="customer-address">${customer.address}</p>
            <div class="job-details" style="background:#f9fafb; padding:0.75rem; border-radius:0.375rem; font-size:0.875rem;">
                <div><strong>Splicer:</strong> ${details.assignedSplicer}</div>
                <div><strong>Handhole:</strong> ${details.handhole}</div>
                <div><strong>Strand:</strong> ${details.strand}</div>
                <div style="margin-top:0.25rem;"><strong>Notes:</strong> <em style="color:#4b5563;">${details.notes || 'None'}</em></div>
            </div>
            <div class="btn-row">
                <button class="btn-resplice" onclick="event.stopPropagation()">
                    <img src="icons/refresh.png" style="width:14px; height:14px; filter: brightness(0) invert(1);" />
                    Re-Splice (Reset)
                </button>
            </div>
        `;

        card.querySelector('.btn-resplice').addEventListener('click', (e) => {
            e.stopPropagation();
            handleReSplice(customer);
        });
    }

    card.addEventListener('click', () => highlightCustomer(customer.id));
    return card;
}

// --- Actions ---
async function handleRelease(customerId, cardElement) {
    const handhole = cardElement.querySelector('.input-handhole').value.trim();
    const strand = cardElement.querySelector('.input-strand').value.trim();
    const splicer = cardElement.querySelector('.input-splicer').value;
    const notes = cardElement.querySelector('.input-notes').value.trim();

    if (!handhole || !splicer) { alert("Handhole and Splicer required."); return; }
    if (!confirm(`Release to ${splicer}?`)) return;

    try {
        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, {
            'splicingDetails.handhole': handhole,
            'splicingDetails.strand': strand,
            'splicingDetails.assignedSplicer': splicer,
            'splicingDetails.notes': notes,
            'splicingDetails.assigned': true,
            'splicingDetails.assignedAt': serverTimestamp()
        });
        loadData(); 
    } catch (error) { alert("Failed."); }
}

async function handleReturn(customer, currentNotes) {
    const reason = prompt("Enter reason for return:");
    if (!reason) return;

    try {
        const timestamp = new Date().toLocaleDateString();
        const updatedNotes = (currentNotes || "") + `\n[Return ${timestamp}]: ${reason}`;
        const docRef = doc(customersCollectionRef, customer.id);
        
        await updateDoc(docRef, {
            status: "Torys List",
            'installDetails.dropNotes': updatedNotes,
            'torysListChecklist.completedAt': deleteField(),
            'torysListChecklist.isPriority': true
        });
        loadData();
    } catch (e) { alert("Failed"); }
}

// NEW: Re-Splice (Reset) Action
async function handleReSplice(customer) {
    if (!confirm(`Re-Splice ${customer.customerName}? This will move them back to Pending Assignment.`)) return;

    try {
        const docRef = doc(customersCollectionRef, customer.id);
        await updateDoc(docRef, {
            'splicingDetails.assigned': false, // Move back to pending list
            'splicingDetails.completed': deleteField(), // Clear completed flag
            'splicingDetails.completedAt': deleteField(), // Clear timestamp
            // We leave handhole/strand/notes so admin can edit them easily
        });
        loadData();
    } catch (e) {
        console.error(e);
        alert("Failed to reset.");
    }
}

// --- Map ---
async function plotMap(customers) {
    markers.forEach(m => m.setMap(null));
    markers = [];
    for (const customer of customers) {
        let coords = customer.coordinates;
        if (!coords || !coords.lat) {
            if (customer.address) coords = await geocodeAddress(customer.address, customer.id);
        }
        if (coords) {
            const isCompleted = customer.splicingDetails?.completed;
            const marker = new google.maps.Marker({
                position: coords, map: map, title: customer.customerName,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE, scale: 8,
                    fillColor: isCompleted ? "#059669" : "#DC2626", 
                    fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2
                }
            });
            const infoWindow = new google.maps.InfoWindow({ content: `<div style="padding:5px;font-weight:600;">${customer.customerName}</div>` });
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
    return new Promise(resolve => {
        geocoder.geocode({ address }, (results, status) => {
            if (status === 'OK') {
                const loc = results[0].geometry.location;
                const coords = { lat: loc.lat(), lng: loc.lng() };
                try { updateDoc(doc(customersCollectionRef, docId), { coordinates: coords }); } catch(e){}
                resolve(coords);
            } else resolve(null);
        });
    });
}

function highlightCustomer(id) {
    document.querySelectorAll('.splice-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.splice-card[data-id="${id}"]`);
    if (card) card.classList.add('active');
    const m = markers.find(m => m.id === id);
    if (m) { map.panTo(m.marker.getPosition()); map.setZoom(15); m.infoWindow.open(map, m.marker); }
}

function scrollToCard(id) {
    document.querySelectorAll('.splice-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.splice-card[data-id="${id}"]`);
    if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); card.classList.add('active'); }
}