// Import Firebase services
import { db } from './firebase.js';
import {
    collection,
    doc,
    updateDoc,
    onSnapshot,
    query
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL VARIABLES ---
let map;
let geocoder;
const appId = 'cfn-install-tracker';
const customersCollectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'customers');
let allMarkers = []; // To store all marker objects
let customerDataCache = new Map(); // To prevent re-processing
let geocodeQueue = []; // To manage geocoding requests
let isGeocoding = false; // Flag to control the geocoder
let customerUnsubscribe = null; // To stop the Firebase listener

// DOM Elements
const el = {
    legend: document.getElementById('filter-controls'),
    loadingOverlay: document.getElementById('map-loading-overlay'),
};

// --- STATUSES AND COLORS ---
// Must match the workflow in app.js
const STATUS_WORKFLOW = [
    'New Order', 
    'Site Survey Ready', 
    'Tory\'s List', 
    'NID Ready', 
    'Install Ready', 
    'Completed',
    'On Hold'
];

// Color mapping for pins and legend
// Using colors from your style.css
const STATUS_COLORS = {
    'New Order': '#1D4ED8',           // blue
    'Site Survey Ready': '#B45309',  // yellow
    'Tory\'s List': '#3730A3',      // indigo
    'NID Ready': '#991B1B',           // red
    'Install Ready': '#065F46',      // green
    'Completed': '#065F46',           // dark-green
    'On Hold': '#7e1313',             // dark-red
    'Default': '#374151'              // gray
};

/**
 * Gets a color for a given status.
 * @param {string} status - The customer's status.
 * @returns {string} A hex color code.
 */
function getStatusColor(status) {
    return STATUS_COLORS[status] || STATUS_COLORS['Default'];
}

/**
 * Generates a custom SVG map pin icon with a specific color.
 * @param {string} color - The hex color for the pin.
 * @returns {object} A Google Maps Icon object.
 */
function createMapIcon(color) {
    // A simple SVG path for a map pin
    const pinPath = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";
    return {
        path: pinPath,
        fillColor: color,
        fillOpacity: 1,
        strokeWeight: 1,
        strokeColor: '#ffffff',
        scale: 1.5,
        anchor: new google.maps.Point(12, 22),
    };
}

/**
 * Creates the filter checkboxes in the legend.
 */
function createLegend() {
    el.legend.innerHTML = ''; // Clear "Loading..."
    STATUS_WORKFLOW.forEach(status => {
        const color = getStatusColor(status);
        const item = document.createElement('div');
        item.className = 'filter-item';
        item.innerHTML = `
            <input type="checkbox" id="check-${status}" value="${status}" checked>
            <label for="check-${status}">
                <span class="color-swatch" style="background-color: ${color}"></span>
                ${status}
            </label>
        `;
        el.legend.appendChild(item);
    });

    // Add event listener to all checkboxes
    el.legend.addEventListener('change', filterMarkers);
}

/**
 * Shows/hides markers based on legend checkboxes.
 */
function filterMarkers() {
    const checkedStatuses = new Set();
    el.legend.querySelectorAll('input[type="checkbox"]:checked').forEach(input => {
        checkedStatuses.add(input.value);
    });

    allMarkers.forEach(marker => {
        marker.setVisible(checkedStatuses.has(marker.customerStatus));
    });
}

/**
 * Main Google Map initialization function.
 * This is called by the Google Maps API script tag.
 */
window.initMap = function() {
    // Centered on New Paris, IN area
    const mapOptions = {
        center: { lat: 41.50, lng: -85.82 },
        zoom: 11,
    };
    map = new google.maps.Map(document.getElementById('map'), mapOptions);
    geocoder = new google.maps.Geocoder();

    createLegend();
    loadCustomers();
}

/**
 * Attaches the Firebase listener to load and update customers.
 */
function loadCustomers() {
    if (customerUnsubscribe) customerUnsubscribe(); // Stop any previous listener

    const q = query(customersCollectionRef);
    customerUnsubscribe = onSnapshot(q, (snapshot) => {
        el.loadingOverlay.style.display = 'flex'; // Show loading
        let geocodeTasks = [];

        snapshot.docChanges().forEach(change => {
            const customer = { id: change.doc.id, ...change.doc.data() };

            if (change.type === 'removed') {
                // Find and remove the marker
                const index = allMarkers.findIndex(m => m.customerId === customer.id);
                if (index > -1) {
                    allMarkers[index].setMap(null); // Remove from map
                    allMarkers.splice(index, 1); // Remove from array
                }
                customerDataCache.delete(customer.id);
            } else {
                // This is 'added' or 'modified'
                const oldData = customerDataCache.get(customer.id);
                // Only process if it's new or the address/status changed
                if (!oldData || oldData.address !== customer.address || oldData.status !== customer.status) {
                    geocodeTasks.push(processCustomer(customer));
                    customerDataCache.set(customer.id, customer); // Update cache
                }
            }
        });

        // Once all processing is queued, filter and hide loading
        Promise.all(geocodeTasks).then(() => {
            filterMarkers(); // Apply filters
            el.loadingOverlay.style.display = 'none'; // Hide loading
        });

    }, (error) => {
        console.error("Error loading customers: ", error);
        el.loadingOverlay.querySelector('p').textContent = 'Error loading customers.';
    });
}

/**
 * Processes a single customer: geocodes if needed, then creates/updates their map marker.
 * @param {object} customer - The customer data from Firestore.
 */
async function processCustomer(customer) {
    // Find existing marker
    const existingMarker = allMarkers.find(m => m.customerId === customer.id);

    // 1. Check if we need to geocode
    if (!customer.lat || !customer.lng) {
        // No location data. Geocode it.
        try {
            const location = await geocodeAddress(customer.address);
            if (location) {
                // Save coordinates back to Firestore for next time
                const docRef = doc(customersCollectionRef, customer.id);
                await updateDoc(docRef, { lat: location.lat, lng: location.lng });
                
                // Update our local object too
                customer.lat = location.lat;
                customer.lng = location.lng;
            } else {
                console.warn(`Could not geocode address for ${customer.customerName}: ${customer.address}`);
                return; // Skip this customer
            }
        } catch (error) {
            console.error(`Geocoding error for ${customer.id}:`, error);
            return; // Skip on error
        }
    }

    // 2. We have location data (either new or existing)
    const position = { lat: customer.lat, lng: customer.lng };
    const icon = createMapIcon(getStatusColor(customer.status));

    if (existingMarker) {
        // Update existing marker
        existingMarker.setPosition(position);
        existingMarker.setIcon(icon);
        existingMarker.customerStatus = customer.status;
    } else {
        // Create new marker
        const newMarker = new google.maps.Marker({
            position: position,
            map: map,
            icon: icon,
            title: `${customer.customerName}\n${customer.address}\nStatus: ${customer.status}`,
            customerId: customer.id,
            customerStatus: customer.status,
        });

        // Add click listener to open the main app with this customer selected
        newMarker.addListener('click', () => {
            window.location.href = `index.html?customerId=${customer.id}`;
        });

        allMarkers.push(newMarker);
    }
}

/**
 * Geocodes a single address.
 * @param {string} address - The address to geocode.
 * @returns {Promise<object|null>} A promise that resolves to {lat, lng} or null.
 */
function geocodeAddress(address) {
    // Add this request to the queue
    return new Promise((resolve) => {
        geocodeQueue.push({ address, resolve });
        processGeocodeQueue(); // Start the queue processor if it's not running
    });
}

/**
 * Processes the geocoding queue one by one to avoid API rate limits.
 */
async function processGeocodeQueue() {
    if (isGeocoding || geocodeQueue.length === 0) {
        return; // Already running or queue is empty
    }
    isGeocoding = true;

    const { address, resolve } = geocodeQueue.shift(); // Get the next item

    geocoder.geocode({ 'address': address }, (results, status) => {
        if (status == 'OK') {
            const location = results[0].geometry.location;
            resolve({ lat: location.lat(), lng: location.lng() });
        } else {
            console.warn(`Geocode was not successful for "${address}": ${status}`);
            if (status === 'OVER_QUERY_LIMIT') {
                // If we hit the limit, put it back in the queue and wait
                geocodeQueue.unshift({ address, resolve });
            } else {
                resolve(null); // Other error, resolve as null
            }
        }
        
        // Wait a bit before processing the next item to respect rate limits
        setTimeout(() => {
            isGeocoding = false;
            processGeocodeQueue(); // Process next item
        }, 300); // 300ms delay between requests
    });
}