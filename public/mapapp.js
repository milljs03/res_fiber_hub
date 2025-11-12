// Import initialized services from firebase.js
import { db, auth } from './firebase.js';

// Import necessary Firestore functions
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    query
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Import Auth functions
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- Global State for Map ---
let map;
let geocoder;
let allCustomers = [];
let allMarkers = [];
let customersCollectionRef;
let currentAppId = 'default-app-id'; // Use the same App ID as app.js

// --- UI Elements ---
const el = {
    loadingOverlay: document.getElementById('map-loading-overlay'),
    filterControls: document.getElementById('filter-controls'),
    replotButton: document.getElementById('replot-all-btn') // <-- ADDED BUTTON
};

// --- Status Colors (Must match app.js) ---
const statusColors = {
    'New Order': '#3B82F6',         // Blue
    'Site Survey Ready': '#D97706', // Yellow/Orange
    'Torys List': '#4F46E5',    // Indigo
    'NID Ready': '#DC2626',           // Red
    'Install Ready': '#059669',     // Green
    'Completed': '#b910b0ff',         // Teal/Green
    'On Hold': '#7c7c7cff',           // Orange
    'Archived': '#E5E7EB',           // Gray (from style.css)
    'Default': '#d2f35bff'            // Gray
};

const statusOrder = [
    'New Order',
    'Site Survey Ready',
    'Torys List',
    'NID Ready',
    'Install Ready',
    'Completed',
    'On Hold',
    'Archived' // <-- ADDED
];

/**
 * Main initialization function exported to be called by map.html
 */
export async function initializeMap() {
    // This function is called by `initMap` in map.html
    // `google.maps` is guaranteed to be loaded at this point.
    
    // 1. Initialize Google Maps objects
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 41.500492, lng: -85.829624 }, // <-- UPDATED COORDINATES
        zoom: 12,
        mapId: "CFN_INSTALL_MAP"
    });
    geocoder = new google.maps.Geocoder();

    // 2. Set up Firebase auth listener
    onAuthStateChanged(auth, (user) => {
        if (user && user.email && user.email.endsWith('@nptel.com')) {
            // User is authenticated
            currentAppId = 'cfn-install-tracker';
            customersCollectionRef = collection(db, 'artifacts', currentAppId, 'public', 'data', 'customers');
            loadAndProcessCustomers();
        } else {
            // User not allowed, show message
            el.loadingOverlay.innerHTML = '<p style="color: red; font-weight: bold;">Access Denied. Please sign in on the main tracker page.</p>';
        }
    });

    // 3. <-- ADDED: Event listener for the new button -->
    el.replotButton.addEventListener('click', replotAllCustomers);
}

/**
 * Loads all customers from Firestore
 */
async function loadAndProcessCustomers() {
    if (!customersCollectionRef) {
        el.loadingOverlay.innerHTML = '<p style="color: red; font-weight: bold;">Error: Not connected to Firebase.</p>';
        return;
    }

    try {
        const q = query(customersCollectionRef);
        const snapshot = await getDocs(q);

        allCustomers = [];
        snapshot.forEach((doc) => {
            allCustomers.push({ id: doc.id, ...doc.data() });
        });

        console.log(`Loaded ${allCustomers.length} customers.`);

        // Geocode and plot all customers
        await geocodeAndPlotCustomers(allCustomers);

        // Populate the filter legend
        populateFilterLegend();

        // Hide loading overlay
        el.loadingOverlay.style.display = 'none';

    } catch (error) {
        console.error("Error loading customers: ", error);
        el.loadingOverlay.innerHTML = `<p style="color: red; font-weight: bold;">Error loading customers: ${error.message}</p>`;
    }
}

/**
 * <-- NEW FUNCTION -->
 * Clears all markers and forces a re-geocode of all customers.
 */
async function replotAllCustomers() {
    // Use a custom modal for confirm, since window.confirm is blocked
    if (!await showConfirmModal('This will re-plot all customer pins. This is useful if you have updated addresses, but may take a moment. Continue?')) {
        return;
    }

    console.log("Re-plotting all customers...");

    // 1. Show loading overlay
    el.loadingOverlay.style.display = 'flex';
    el.loadingOverlay.querySelector('p').textContent = 'Forcing re-plot of all customers...';

    // 2. Clear all existing markers from the map and the array
    allMarkers.forEach(marker => marker.setMap(null));
    allMarkers = [];

    // 3. IMPORTANT: Delete the cached coordinates from our local customer data
    // This forces geocodeAndPlotCustomers to re-geocode every address.
    const updatePromises = [];
    allCustomers.forEach(customer => {
        delete customer.coordinates;
        // We also clear them from Firestore to ensure they are re-cached
        const docRef = doc(customersCollectionRef, customer.id);
        updatePromises.push(updateDoc(docRef, { coordinates: null }).catch(err => console.error(`Failed to clear cache for ${customer.id}`, err)));
    });

    await Promise.all(updatePromises); // Wait for all cache-clearing updates to finish
    console.log("Firestore coordinate cache cleared.");

    // 4. Re-run the geocoding and plotting process
    await geocodeAndPlotCustomers(allCustomers);

    // 5. Re-populate the filter legend
    populateFilterLegend();

    // 6. Hide loading overlay
    el.loadingOverlay.style.display = 'none';
    el.loadingOverlay.querySelector('p').textContent = 'Loading Map & Geocoding Customers...';
    console.log("Re-plotting complete.");
}


/**
 * Geocodes and plots all customers on the map.
 * Caches coordinates back to Firestore to save API calls.
 */
async function geocodeAndPlotCustomers(customers) {
    const geocodePromises = customers.map(customer => {
        // If we already have coordinates, just plot the marker
        if (customer.coordinates && customer.coordinates.lat && customer.coordinates.lng) {
            return createMarker(customer, customer.coordinates);
        }

        // If no address, skip
        if (!customer.address) {
            console.warn(`Skipping customer ${customer.id} (no address).`);
            return Promise.resolve();
        }

        // --- Geocoding needed ---
        // Add "New Paris, IN" to the address for better accuracy
        const fullAddress = `${customer.address}`;
        
        return new Promise((resolve) => {
            // Use a short delay to avoid hitting rate limits "OVER_QUERY_LIMIT"
            setTimeout(() => {
                geocoder.geocode({ address: fullAddress }, async (results, status) => {
                    if (status === 'OK') {
                        const location = results[0].geometry.location;
                        const coords = { lat: location.lat(), lng: location.lng() };
                        
                        // Create the marker
                        createMarker(customer, coords);

                        // ** Save coordinates back to Firestore to cache them **
                        try {
                            const docRef = doc(customersCollectionRef, customer.id);
                            await updateDoc(docRef, { coordinates: coords });
                            console.log(`Geocoded and cached: ${customer.customerName}`);
                        } catch (err) {
                            console.error("Error caching coordinates: ", err);
                        }
                        
                    } else if (status === 'OVER_QUERY_LIMIT') {
                         console.warn(`Geocode failed (OVER_QUERY_LIMIT) for: ${customer.customerName}. Will retry...`);
                         // This simple retry logic is basic. A more robust solution
                         // would use exponential backoff, but this often works for small batches.
                         setTimeout(() => geocodeAndPlotCustomers([customer]).then(resolve), 2000);
                         return; // Don't resolve yet, wait for retry
                    } else {
                        console.error(`Geocode failed for ${customer.customerName} (${customer.address}): ${status}`);
                    }
                    resolve(); // Resolve the promise even if geocoding failed
                });
            }, 250); // Stagger requests
        });
    });

    await Promise.all(geocodePromises);
    console.log("All customers geocoded and plotted.");
}

/**
 * Creates a single map marker for a customer
 */
async function createMarker(customer, coordinates) {
    const status = customer.status || 'Default';
    const color = statusColors[status] || statusColors['Default']; // <-- This line is correct

    console.log(`Plotting marker for ${customer.customerName} with status: ${status} (Color: ${color})`);

    // --- START: REPLACEMENT MARKER LOGIC ---

    // We are replacing the PinElement with a dynamic SVG icon,
    // as PinElement seems to be failing to render the background color.
    const pinIcon = {
        path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z", // Standard Google pin SVG path
        fillColor: color, // Use the dynamic status color
        fillOpacity: 1,
        strokeWeight: 1,
        strokeColor: "#000000", // Black border
        scale: 1.5, // Make it a bit bigger
        anchor: new google.maps.Point(12, 24), // Anchor at the bottom tip
    };

    const marker = new google.maps.Marker({
        position: coordinates,
        map: map,
        title: `${customer.customerName}\nStatus: ${status}\nAddress: ${customer.address}`,
        icon: pinIcon, // <-- Use the new SVG icon
        // Store customer data on the marker object
        customerStatus: status,
        customerId: customer.id
    });

    // --- END: REPLACEMENT MARKER LOGIC ---

    // Add info window
    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="font-family: 'Inter', sans-serif; padding: 5px;">
                <h4 style="margin: 0 0 5px 0;">${customer.customerName}</h4>
                <p style="margin: 0 0 3px 0; font-size: 0.8rem;">${customer.address}</p>
                <p style="margin: 0 0 8px 0; font-size: 0.8rem;"><strong>Status:</strong> ${status}</p>
                <a href="index.html?customerId=${customer.id}" target="_blank">View Details</a>
            </div>
        `
    });

    marker.addListener("click", () => {
        infoWindow.open(map, marker);
    });

    allMarkers.push(marker);
}

/**
 * Populates the filter legend with checkboxes
 */
function populateFilterLegend() {
    el.filterControls.innerHTML = ''; // Clear "Loading..."
    
    // Add "Show All" toggle
    el.filterControls.appendChild(createFilterItem('All', 'Show All', null, true));
    
    // Add items for each status
    const statusesToShow = statusOrder.filter(status => 
        allMarkers.some(m => m.customerStatus === status)
    );
    
    statusesToShow.forEach(status => {
        const color = statusColors[status] || statusColors['Default'];
        el.filterControls.appendChild(createFilterItem(status, status, color, true));
    });
    
    // Add "On Hold" if not already added
    if (!statusesToShow.includes('On Hold') && allMarkers.some(m => m.customerStatus === 'On Hold')) {
         el.filterControls.appendChild(createFilterItem('On Hold', 'On Hold', statusColors['On Hold'], true));
    }

    // Add listener for filter changes
    el.filterControls.addEventListener('change', handleFilterChange);
}

/**
 * Helper to create a single checkbox filter item
 */
function createFilterItem(id, label, color, isChecked) {
    const filterItem = document.createElement('div');
    filterItem.className = 'filter-item';
    
    let colorSwatch = '';
    if (color) {
        colorSwatch = `<span class="color-swatch" style="background-color: ${color};"></span>`;
    }
    
    filterItem.innerHTML = `
        <input type="checkbox" id="filter-${id}" data-status="${id}" ${isChecked ? 'checked' : ''}>
        <label for="filter-${id}">
            ${colorSwatch}
            ${label}
        </label>
    `;
    return filterItem;
}

/**
 * Handles toggling markers based on checkbox filters
 */
function handleFilterChange(e) {
    const checkbox = e.target;
    const statusToToggle = checkbox.dataset.status;
    const isChecked = checkbox.checked;

    if (statusToToggle === 'All') {
        // "Show All" was clicked, check/uncheck all others
        const allCheckboxes = el.filterControls.querySelectorAll('input[type="checkbox"]');
        allCheckboxes.forEach(cb => {
            cb.checked = isChecked;
        });
        // Now filter all markers
        allMarkers.forEach(marker => {
            marker.setMap(isChecked ? map : null);
        });
    } else {
        // A specific status was clicked
        allMarkers.forEach(marker => {
            if (marker.customerStatus === statusToToggle) {
                marker.setMap(isChecked ? map : null);
            }
        });
        
        // Update "Show All" checkbox state
        const allAreChecked = Array.from(el.filterControls.querySelectorAll('input[type="checkbox"]:not([data-status="All"])'))
            .every(cb => cb.checked);
        document.getElementById('filter-All').checked = allAreChecked;
    }
}

/**
 * --- NEW FUNCTION ---
 * Shows a custom confirmation modal, as window.confirm() is blocked.
 * @param {string} message - The message to display.
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if cancelled.
 */
function showConfirmModal(message) {
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
            position: fixed;
            inset: 0;
            z-index: 2000;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.5);
            font-family: 'Inter', sans-serif;
        `;

        const modalPanel = document.createElement('div');
        modalPanel.style = `
            background-color: white;
            padding: 1.5rem;
            border-radius: 0.75rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            max-width: 400px;
            width: 90%;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Confirm Action';
        title.style = 'font-size: 1.25rem; font-weight: 600; margin-top: 0; margin-bottom: 0.75rem; color: #1f2937;';

        const messageP = document.createElement('p');
        messageP.textContent = message;
        messageP.style = 'font-size: 0.875rem; color: #4b5563; margin-bottom: 1.5rem;';

        const buttonGroup = document.createElement('div');
        buttonGroup.style = 'display: flex; gap: 0.75rem; justify-content: flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn btn-secondary'; // Use existing styles

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Continue';
        confirmBtn.className = 'btn btn-danger'; // Use existing styles
        
        // Event listeners
        cancelBtn.onclick = () => {
            modalWrapper.remove();
            resolve(false);
        };

        confirmBtn.onclick = () => {
            modalWrapper.remove();
            resolve(true);
        };
        
        // Assemble modal
        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(confirmBtn);
        modalPanel.appendChild(title);
        modalPanel.appendChild(messageP);
        modalPanel.appendChild(buttonGroup);
        modalWrapper.appendChild(modalPanel);
        document.body.appendChild(modalWrapper);
    });
}