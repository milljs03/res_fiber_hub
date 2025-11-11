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
    filterControls: document.getElementById('filter-controls')
};

// --- Status Colors (Must match app.js) ---
const statusColors = {
    'New Order': '#3B82F6',         // Blue
    'Site Survey Ready': '#D97706', // Yellow/Orange
    'Tory\'s List': '#4F46E5',    // Indigo
    'NID Ready': '#DC2626',           // Red
    'Install Ready': '#059669',     // Green
    'Completed': '#10B981',         // Teal/Green
    'On Hold': '#F97316',           // Orange
    'Default': '#6B7280'            // Gray
};

const statusOrder = [
    'New Order',
    'Site Survey Ready',
    'Tory\'s List',
    'NID Ready',
    'Install Ready',
    'Completed',
    'On Hold'
];

/**
 * Main initialization function exported to be called by map.html
 */
export async function initializeMap() {
    // This function is called by `initMap` in map.html
    // `google.maps` is guaranteed to be loaded at this point.
    
    // 1. Initialize Google Maps objects
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 41.5647, lng: -85.9940 }, // Centered on New Paris, IN
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
    const color = statusColors[status] || statusColors['Default'];

    // Use Google's PinElement for modern markers
    const { PinElement } = await google.maps.importLibrary("marker");

    const pin = new PinElement({
        background: color,
        borderColor: "#000",
        glyphColor: "#000",
    });

    const marker = new google.maps.Marker({
        position: coordinates,
        map: map,
        title: `${customer.customerName}\nStatus: ${status}\nAddress: ${customer.address}`,
        content: pin.element,
        // Store customer data on the marker object
        customerStatus: status,
        customerId: customer.id
    });

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