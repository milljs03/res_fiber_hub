import { db, auth } from './firebase.js';
import { 
    collection, getDocs, doc, updateDoc, query, where, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

let map;
let geocoder;
let markers = [];
let customersCollectionRef;
let pendingCustomers = [];

// --- Initialization ---
export async function initialize() {
    // 1. Setup Map
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 41.500492, lng: -85.829624 }, 
        zoom: 12,
        mapId: "SPLICING_MAP"
    });
    geocoder = new google.maps.Geocoder();

    // 2. Auth Check
    onAuthStateChanged(auth, (user) => {
        if (user && user.email && user.email.endsWith('@nptel.com')) {
            customersCollectionRef = collection(db, 'artifacts', 'cfn-install-tracker', 'public', 'data', 'customers');
            loadData();
        } else {
            document.getElementById('loading-overlay').innerHTML = '<p style="color:red">Access Denied</p>';
        }
    });
}

// --- Data Loading ---
async function loadData() {
    try {
        const q = query(customersCollectionRef);
        const snapshot = await getDocs(q);
        
        pendingCustomers = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            // Filter: Status "NID Ready" AND not yet assigned
            if (data.status === "NID Ready" && !data.splicingDetails?.assigned) {
                pendingCustomers.push({ id: doc.id, ...data });
            }
        });

        // Sort by oldest drop completion first
        pendingCustomers.sort((a, b) => {
            const dateA = a.torysListChecklist?.completedAt?.seconds || 0;
            const dateB = b.torysListChecklist?.completedAt?.seconds || 0;
            return dateA - dateB;
        });

        console.log(`Found ${pendingCustomers.length} pending splicing assignments.`);
        
        updateUI();
        plotMap(pendingCustomers);
        
        document.getElementById('loading-overlay').style.display = 'none';

    } catch (error) {
        console.error("Error loading data:", error);
        alert("Error loading data");
    }
}

// --- UI Rendering ---
function updateUI() {
    document.getElementById('pending-count').textContent = pendingCustomers.length;
    const container = document.getElementById('splicing-list-container');
    container.innerHTML = '';

    if (pendingCustomers.length === 0) {
        container.innerHTML = '<div class="empty-placeholder">No drops waiting for splicing assignment.</div>';
        return;
    }

    pendingCustomers.forEach(customer => {
        const card = createCard(customer);
        container.appendChild(card);
    });
}

function createCard(customer) {
    const card = document.createElement('div');
    card.className = 'splice-card';
    card.dataset.id = customer.id;

    let dropDateStr = "Unknown";
    if (customer.torysListChecklist?.completedAt) {
        const date = new Date(customer.torysListChecklist.completedAt.seconds * 1000);
        dropDateStr = date.toLocaleDateString();
    }

    const currentDropNotes = customer.installDetails?.dropNotes || "";

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
                    <input type="text" class="form-input-sm input-handhole" placeholder="HH-000">
                </div>
                <div class="form-group-half">
                    <label>Strand #</label>
                    <input type="text" class="form-input-sm input-strand" placeholder="Strand #">
                </div>
            </div>
            
            <div class="form-group-full">
                <label>Assign Splicer</label>
                <select class="form-select-sm input-splicer">
                    <option value="" disabled selected>Select Splicer</option>
                    <option value="Rusty">Rusty</option>
                    <option value="Greg">Greg</option>
                    <option value="Scott">Scott</option>
                </select>
            </div>

            <div class="form-group-full">
                <label>Splicing Notes (Internal)</label>
                <textarea class="form-textarea-sm input-notes" rows="2" placeholder="Notes for splicer..."></textarea>
            </div>

            <div class="btn-row">
                <button class="btn-return" onclick="event.stopPropagation()">
                    <img src="icons/savecont.png" style="width:14px; height:14px; filter: brightness(0) invert(1); transform: rotate(180deg);" />
                    Return to Drop Layer
                </button>
                <button class="btn-release" onclick="event.stopPropagation()">
                    <img src="icons/check.png" style="width:14px; height:14px; filter: brightness(0) invert(1);" />
                    Release to Splicers
                </button>
            </div>
        </div>
    `;

    card.addEventListener('click', () => highlightCustomer(customer.id));

    const btnRelease = card.querySelector('.btn-release');
    btnRelease.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRelease(customer.id, card);
    });

    const btnReturn = card.querySelector('.btn-return');
    btnReturn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleReturn(customer, currentDropNotes);
    });

    return card;
}

// --- Action: Release to Splicers ---
async function handleRelease(customerId, cardElement) {
    const handhole = cardElement.querySelector('.input-handhole').value.trim();
    const strand = cardElement.querySelector('.input-strand').value.trim();
    const splicer = cardElement.querySelector('.input-splicer').value; // No trim needed for select
    const notes = cardElement.querySelector('.input-notes').value.trim();

    if (!handhole || !splicer) {
        alert("Please enter at least a Handhole Number and select a Splicer.");
        return;
    }

    if (!confirm(`Confirm release for ${cardElement.querySelector('.customer-name').textContent}?\nAssigned to: ${splicer}`)) {
        return;
    }

    try {
        const btn = cardElement.querySelector('.btn-release');
        btn.disabled = true;
        btn.textContent = "Releasing...";

        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, {
            'splicingDetails.handhole': handhole,
            'splicingDetails.strand': strand,
            'splicingDetails.assignedSplicer': splicer,
            'splicingDetails.notes': notes,
            'splicingDetails.assigned': true,
            'splicingDetails.assignedAt': serverTimestamp()
        });

        removeCustomerFromList(customerId);

    } catch (error) {
        console.error("Error releasing customer:", error);
        alert("Failed to update record.");
        const btn = cardElement.querySelector('.btn-release');
        btn.disabled = false;
        btn.textContent = "Release to Splicers";
    }
}

// --- Action: Return to Drop Layer (Reject) ---
async function handleReturn(customer, currentNotes) {
    const reason = await showPromptModal(
        `Return ${customer.customerName} to Tory?`,
        "Enter a reason/note for the drop crew:"
    );

    if (!reason) return; 

    try {
        const timestamp = new Date().toLocaleDateString();
        const newNoteEntry = `\n[Admin Returned ${timestamp}]: ${reason}`;
        const updatedNotes = currentNotes ? currentNotes + newNoteEntry : `[Admin Returned ${timestamp}]: ${reason}`;

        const docRef = doc(customersCollectionRef, customer.id);
        await updateDoc(docRef, {
            status: "Torys List",
            'installDetails.dropNotes': updatedNotes,
            'torysListChecklist.completedAt': deleteField(),
            'torysListChecklist.isPriority': true
        });

        console.log(`Returned ${customer.id} to Drop List.`);
        removeCustomerFromList(customer.id);

    } catch (error) {
        console.error("Error returning customer:", error);
        alert("Failed to return customer.");
    }
}

function removeCustomerFromList(id) {
    pendingCustomers = pendingCustomers.filter(c => c.id !== id);
    updateUI();
    const markerObj = markers.find(m => m.id === id);
    if (markerObj) markerObj.marker.setMap(null);
}

// --- Map Logic ---
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
                    scale: 8,
                    fillColor: "#DC2626",
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
                try {
                    updateDoc(doc(customersCollectionRef, docId), { coordinates: coords });
                } catch(e) {}
                resolve(coords);
            } else {
                resolve(null);
            }
        });
    });
}

function highlightCustomer(id) {
    document.querySelectorAll('.splice-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.splice-card[data-id="${id}"]`);
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
    document.querySelectorAll('.splice-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.splice-card[data-id="${id}"]`);
    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add('active');
    }
}

// --- Custom Prompt Modal ---
async function showPromptModal(titleText, labelText) {
    return new Promise((resolve) => {
        const oldModal = document.getElementById('prompt-modal-wrapper');
        if (oldModal) oldModal.remove();

        const modalWrapper = document.createElement('div');
        modalWrapper.id = 'prompt-modal-wrapper';
        modalWrapper.style = `position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background-color: rgba(0, 0, 0, 0.5); font-family: 'Inter', sans-serif;`;
        
        const modalPanel = document.createElement('div');
        modalPanel.style = `background-color: white; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); max-width: 400px; width: 90%; display: flex; flex-direction: column; gap: 1rem;`;
        
        const title = document.createElement('h3');
        title.textContent = titleText;
        title.style = 'margin: 0; font-size: 1.125rem; font-weight: 600; color: #1f2937;';
        
        const label = document.createElement('label');
        label.textContent = labelText;
        label.style = 'font-size: 0.875rem; color: #4b5563;';
        
        const input = document.createElement('textarea');
        input.rows = 3;
        input.style = 'width: 100%; border: 1px solid #d1d5db; border-radius: 0.375rem; padding: 0.5rem; font-family: inherit; box-sizing: border-box;';
        input.placeholder = "Type reason here...";
        
        const btnGroup = document.createElement('div');
        btnGroup.style = 'display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem;';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn btn-secondary';
        
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Return Drop';
        confirmBtn.className = 'btn btn-warning'; 
        
        cancelBtn.onclick = () => { modalWrapper.remove(); resolve(null); };
        confirmBtn.onclick = () => { 
            const val = input.value.trim();
            if (val) {
                modalWrapper.remove(); 
                resolve(val);
            } else {
                input.style.borderColor = 'red';
            }
        };
        
        btnGroup.append(cancelBtn, confirmBtn);
        modalPanel.append(title, label, input, btnGroup);
        modalWrapper.append(modalPanel);
        document.body.append(modalWrapper);
        input.focus();
    });
}