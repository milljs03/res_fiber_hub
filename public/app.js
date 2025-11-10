// Import initialized services from firebase.js
import { db, auth, googleProvider, signInWithPopup, signOut } from './firebase.js';

// Import necessary Firestore functions
import {
    collection,
    doc,
    addDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Import Auth functions
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- Constants ---
const PDFJS_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs"; // MOVED TO TOP
// --- END CONSTANTS ---

// --- Global State ---
let currentUserId = null;
let currentAppId = 'default-app-id';
let customersCollectionRef = null;
let selectedCustomerId = null;
let customerUnsubscribe = null;
let allCustomers = []; 
let currentSort = 'name'; 
let currentFilter = 'All'; 
let currentCompletedFilter = 'All'; 
let myChart = null; 

// --- DOM Elements ---
const el = {
    // Auth
    authScreen: document.getElementById('auth-screen'),
    appScreen: document.getElementById('app-screen'),
    signInBtn: document.getElementById('sign-in-btn'),
    signOutBtn: document.getElementById('sign-out-btn'),
    authError: document.getElementById('auth-error'),
    userEmailDisplay: document.getElementById('user-email'),

    // Add Form (in modal)
    addForm: document.getElementById('add-customer-form'),
    soNumberInput: document.getElementById('so-number'),
    customerNameInput: document.getElementById('customer-name'),
    addressInput: document.getElementById('address'),
    customerEmailInput: document.getElementById('customer-email'),
    customerPhoneInput: document.getElementById('customer-phone'),
    serviceSpeedInput: document.getElementById('service-speed'),

    // PDF Processing
    pdfUploadInput: document.getElementById('pdf-upload'),
    processPdfBtn: document.getElementById('process-pdf-btn'),
    pdfStatusMsg: document.getElementById('pdf-status-msg'),

    // Modal Elements
    newCustomerBtn: document.getElementById('new-customer-btn'),
    addCustomerModal: document.getElementById('add-customer-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalBackdrop: document.querySelector('.modal-backdrop'),

    // Customer List
    customerListContainer: document.getElementById('customer-list-container'),
    listLoading: document.getElementById('list-loading'),
    searchBar: document.getElementById('search-bar'),
    sortBy: document.getElementById('sort-by'), 
    filterPillsContainer: document.getElementById('filter-pills'), 
    
    // --- NEW TAB ELEMENTS ---
    mainListTabs: document.getElementById('main-list-tabs'),
    activeControlsGroup: document.getElementById('active-controls-group'),
    completedControlsGroup: document.getElementById('completed-controls-group'),
    
    // --- COMPLETED FILTER ELEMENTS ---
    completedFilterGroup: document.getElementById('completed-filter-group'), 
    completedFilterSelect: document.getElementById('completed-filter-select'), 

    // --- DASHBOARD ELEMENTS ---
    statsSummaryActiveWrapper: document.getElementById('stats-summary-active-wrapper'),
    statsSummaryCompletedWrapper: document.getElementById('stats-summary-completed-wrapper'),
    installationsChart: document.getElementById('installations-chart'),
    // --- END NEW ELEMENTS ---

    // Details Panel
    detailsContainer: document.getElementById('details-container'),
    detailsForm: document.getElementById('details-form'),
    detailsPlaceholder: document.getElementById('details-placeholder'),
    loadingOverlay: document.getElementById('loading-overlay'),
    
    // Copyable/Editable Fields (UPDATED REFERENCES)
    detailsSoNumberInput: document.getElementById('details-so-number'),
    detailsCustomerNameInput: document.getElementById('details-customer-name'), // NEW: Add this to DOM
    detailsAddressInput: document.getElementById('details-address'),
    detailsSpeedInput: document.getElementById('details-speed'),
    detailsEmailInput: document.getElementById('details-email'),
    detailsPhoneInput: document.getElementById('details-phone'),
    
    // Buttons
    sendWelcomeEmailBtn: document.getElementById('send-welcome-email-btn'),
    updateCustomerBtn: document.getElementById('update-customer-btn'),
    copyBillingBtn: document.getElementById('copy-billing-btn'),
    deleteCustomerBtn: document.getElementById('delete-customer-btn'),
    onHoldButton: document.getElementById('on-hold-btn'), 

    // --- UPDATED: Stepper and Pages ---
    statusStepper: document.getElementById('status-stepper'),
    detailsPages: document.querySelectorAll('.details-page'),
    
    // Toast
    toast: document.getElementById('toast-notification')
};

// --- 1. AUTHENTICATION (Unchanged) ---
onAuthStateChanged(auth, (user) => {
    handleAuthentication(user);
});
function handleAuthentication(user) {
    if (user && user.email && user.email.endsWith('@nptel.com')) {
        currentUserId = user.uid;
        el.userEmailDisplay.textContent = user.email;
        currentAppId = 'cfn-install-tracker';
        customersCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'customers');
        el.appScreen.classList.remove('hidden');
        el.authScreen.classList.add('hidden');
        initializeApp();
    } else {
        currentUserId = null;
        customersCollectionRef = null;
        if (customerUnsubscribe) {
            customerUnsubscribe();
            customerUnsubscribe = null;
        }
        el.appScreen.classList.add('hidden');
        el.authScreen.classList.remove('hidden');
        if (user) {
            el.authError.textContent = 'Access restricted to @nptel.com accounts.';
            signOut(auth); 
        } else {
            el.authError.textContent = '';
        }
    }
}
el.signInBtn.addEventListener('click', () => {
    el.authError.textContent = ''; 
    signInWithPopup(auth, googleProvider)
        .then((result) => console.log("Sign-in successful", result.user.email))
        .catch((error) => {
            console.error("Sign-in error", error);
            if (error.code === 'auth/popup-closed-by-user') {
                el.authError.textContent = 'Sign-in cancelled.';
            } else if (error.code !== 'auth/cancelled-popup-request') {
                el.authError.textContent = error.message;
            }
        });
});
el.signOutBtn.addEventListener('click', () => {
    signOut(auth).catch((error) => console.error("Sign-out error", error));
});


// --- 2. INITIALIZATION (Fixed ReferenceError) ---

function initializeApp() {
    // FIX: PDFJS_WORKER_SRC is now defined globally, resolving the ReferenceError.
    if (window.pdfjsLib) {
         window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    }
    
    if (el.addForm.dataset.listenerAttached !== 'true') {
        setupEventListeners();
        el.addForm.dataset.listenerAttached = 'true';
    }
    loadCustomers();
    handleDeselectCustomer();
}

function setupEventListeners() {
    // Modal Listeners
    el.newCustomerBtn.addEventListener('click', openAddCustomerModal);
    el.modalCloseBtn.addEventListener('click', closeAddCustomerModal);
    el.modalBackdrop.addEventListener('click', closeAddCustomerModal);

    // Form submission
    el.addForm.addEventListener('submit', handleAddCustomer);
    
    // --- PDF Processing Listener ---
    el.processPdfBtn.addEventListener('click', handlePdfProcessing);
    // --- END NEW LISTENER ---

    // Search
    el.searchBar.addEventListener('input', (e) => {
        displayCustomers();
    });

    // Sort Listener
    el.sortBy.addEventListener('change', (e) => {
        currentSort = e.target.value;
        displayCustomers();
    });

    // Completed Filter Listener
    el.completedFilterSelect.addEventListener('change', (e) => {
        currentCompletedFilter = e.target.value;
        displayCustomers();
    });
    
    // Primary Tab Listener
    el.mainListTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.main-list-tab');
        if (!tab) return;
        
        // Update active class
        el.mainListTabs.querySelectorAll('.main-list-tab').forEach(t => {
            t.classList.remove('active');
        });
        tab.classList.add('active');

        const mainFilter = tab.dataset.mainFilter;

        // Toggle visibility of control groups and list view class
        if (mainFilter === 'Completed') {
            el.activeControlsGroup.classList.add('hidden');
            el.completedControlsGroup.classList.remove('hidden');
            
            currentFilter = 'Completed'; 
            currentCompletedFilter = el.completedFilterSelect.value;
            el.customerListContainer.classList.add('completed-view');
            
        } else { // Active Orders
            el.activeControlsGroup.classList.remove('hidden');
            el.completedControlsGroup.classList.add('hidden');
            
            // Set the active status filter (default to 'All' which is currently active pill)
            const activePill = el.filterPillsContainer.querySelector('.filter-pill.active');
            currentFilter = activePill ? activePill.dataset.filter : 'All';
            currentCompletedFilter = 'All'; // Reset completed filter state
            el.customerListContainer.classList.remove('completed-view');
        }

        displayCustomers();
    });

    // Secondary Pill Listener (Now only affects Active Status)
    el.filterPillsContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (!pill) return;

        // Only run if we are in the Active view
        if (el.mainListTabs.querySelector('.main-list-tab[data-main-filter="Active"]').classList.contains('active')) {
            // Update active class
            el.filterPillsContainer.querySelectorAll('.filter-pill').forEach(p => {
                p.classList.remove('active');
            });
            pill.classList.add('active');
    
            // Update state and re-render
            currentFilter = pill.dataset.filter; // This will be 'All', 'New Order', etc.
            displayCustomers();
        }
    });

    // List clicks
    el.customerListContainer.addEventListener('click', (e) => {
        const customerItem = e.target.closest('.customer-item');
        if (customerItem) {
            handleSelectCustomer(customerItem.dataset.id, customerItem);
        }
    });

    // Details panel
    el.sendWelcomeEmailBtn.addEventListener('click', handleSendWelcomeEmail);
    el.updateCustomerBtn.addEventListener('click', handleUpdateCustomer);
    el.copyBillingBtn.addEventListener('click', handleCopyBilling);
    el.deleteCustomerBtn.addEventListener('click', handleDeleteCustomer);
    el.detailsForm.addEventListener('click', handleDetailsFormClick);
    
    // Stepper Click Listener
    el.statusStepper.addEventListener('click', (e) => {
        const stepButton = e.target.closest('.step'); 
        if (!stepButton) return;

        e.preventDefault();
        const newStatus = stepButton.dataset.status;
        const pageId = stepButton.dataset.page;

        // Set the hidden input's value
        el.detailsForm['details-status'].value = newStatus;

        // Update the UI
        updateStepperUI(newStatus);
        showDetailsPage(pageId);
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    });

    // On Hold toggle
    el.onHoldButton.addEventListener('click', handleToggleOnHold);
}

// --- PDF PROCESSING FUNCTIONS (NEW, Cost-Free) ---

function getPdfData(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

async function extractTextFromPdf(data) {
    try {
        // Ensure PDF.js is loaded
        if (!window.pdfjsLib) {
             throw new Error("PDF.js library not found.");
        }

        const pdf = await window.pdfjsLib.getDocument({ data }).promise;
        // Concatenate text from all pages if needed, but for a simple SO, page 1 is enough
        const page = await pdf.getPage(1);
        const textContent = await page.getTextContent();
        return textContent.items.map(item => item.str).join('\n');
    } catch (e) {
        console.error("PDF Text Extraction Error:", e);
        throw new Error("Failed to read text from PDF file. Ensure it is not scanned/image-only.");
    }
}

function parseServiceOrderText(rawText) {
    // Clean up excessive whitespace and normalize internal newlines for easier regex matching
    const normalizedText = rawText
        .replace(/(\r\n|\n|\r)/gm, '\n') // Normalize newlines
        .replace(/ +/g, ' ')            // Collapse multiple spaces
        .replace(/ \n/g, '\n')          // Remove trailing spaces before newlines
        .replace(/\n /g, '\n');         // Remove leading spaces after newlines

    const data = {
        serviceOrderNumber: '',
        customerName: '',
        address: '',
        primaryEmail: '',
        primaryPhone: '',
        serviceSpeed: '200 Mbps' // Default to smallest speed if speed parsing fails
    };

    // Helper to find a specific pattern
    const findMatch = (pattern, cleanup = (v) => v.trim()) => {
        const match = normalizedText.match(pattern);
        return match ? cleanup(match[1]) : '';
    };

    // 1. Service Order # (Handles both "Label:\n Value" and "Label: Value" formats)
    data.serviceOrderNumber = findMatch(/Service Order:\s*\n?\s*(\d+)/i);
    // Fallback if the format is "Service Order: 150987"
    if (!data.serviceOrderNumber) {
        data.serviceOrderNumber = findMatch(/Service Order: (\d+)/i);
    }
    
    // 2. Name and Address (Look for the block starting with Bill To: and ending near Res/Bus)
    const addressBlockMatch = normalizedText.match(/Bill To:\s*\n\n(.*?)\n\nRes\/Bus:/s);
    
    if (addressBlockMatch && addressBlockMatch[1]) {
        // Split the block into lines, filtering out empty lines
        const addressLines = addressBlockMatch[1].split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        console.log("--- DEBUG PARSING START ---");
        console.log("Address Lines (Cleaned/Trimmed):", addressLines);


        if (addressLines.length >= 2) {
            // Define all required variables in scope (FIX for ReferenceError)
            let lastName = addressLines[0]; // e.g., HATFIELD or TY MILLER (Line 1)
            let rawAddressAndNames = addressLines.slice(1).join(' '); // e.g., SCOTT & ALYSSA 5382 E CREEKSIDE... (Line 2+)
            let firstNames = ''; 
            let finalAddressString = rawAddressAndNames;
            
            console.log("Last Name (Line 1):", lastName);
            console.log("Raw Address/Names (Line 2+):", rawAddressAndNames);
            
            // --- CORE FIX: Extract names from address prefix based on street number anchor ---
            // Regex: Match 1+ non-digit characters at the start (group 1), followed by 1+ digits (street number)
            const prefixMatch = rawAddressAndNames.match(/^([^0-9]*?)\s*(\d.*)/);

            if (prefixMatch) {
                firstNames = prefixMatch[1].trim(); // e.g., "SCOTT & ALYSSA"
                finalAddressString = prefixMatch[2].trim(); // e.g., "5382 E CREEKSIDE TRL SYRACUSE, IN 46567"
                
                console.log("Extracted First Names from Address Prefix:", firstNames);
                console.log("Extracted Street Address Start:", finalAddressString);

            } else {
                console.log("No street number detected at address start. Keeping raw line for address.");
            }
            
            // 2a. Construct the final customer name
            if (firstNames && firstNames.includes('&')) {
                // Case 1: Joint name (HATFIELD in Line 1, SCOTT & ALYSSA in Line 2 prefix)
                data.customerName = `${firstNames} ${lastName}`;
            } else if (lastName.includes(' ') && !lastName.includes('&')) {
                // Case 2: Single name order (TY MILLER) where the full name is already in Line 1
                 data.customerName = lastName;
            } else if (lastName.length > 0) {
                // Case 3: Single person, only last name found in Line 1 (HATFIELD).
                data.customerName = lastName;
            } else {
                 // Fallback for names in unknown format
                 data.customerName = firstNames || lastName;
            }
            
            // 2c. Final Address Cleanup: Replace commas with spaces and collapse whitespace in the *final* address string.
            data.address = finalAddressString
                .replace(/,/g, ' ')        // 1. Replace all commas with space
                .replace(/\s+/g, ' ')      // 2. Collapse multiple spaces to single space
                .trim();                   // 3. Trim leading/trailing spaces
            // --- END FIX ---

        } else if (addressLines.length === 1) {
            // Case where only the name is found in the block (TY MILLER or HATFIELD)
            data.customerName = addressLines[0];
            data.address = ""; 
        }
    }

    // 3. Phone (Look for the first CELL contact number)
    const cellMatch = normalizedText.match(/CELL\s*\n\s*(\d{10})/);
    if (cellMatch) {
         data.primaryPhone = cellMatch[1];
    }
    
    // 4. Email (Look for the first EMAIL contact)
    const emailMatch = normalizedText.match(/EMAIL\s*\n\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
        data.primaryEmail = emailMatch[1];
    }


    // 5. Service Speed (Look for number next to 'MEG', 'MBPS', or 'GIG')
    // Look in Description: CONNECT 1 GIG FTTH SVC
    const speedMatch = normalizedText.match(/CONNECT\s*(\d+)\s*(MEG|MBPS|GB|GIG)/i);
    if (speedMatch) {
        let speedValue = speedMatch[1].trim();
        let speedUnit = speedMatch[2].toUpperCase();
        
        if (speedUnit === 'GIG' || speedValue === '1' || speedUnit === 'GB') {
            data.serviceSpeed = '1 Gbps';
        } else if (speedUnit === 'MEG' || speedUnit === 'MBPS') {
            data.serviceSpeed = `${speedValue} Mbps`;
        }
    }
    
    // Log the final parsed data for confirmation
    console.log("--- DEBUG PARSING END ---");
    console.log("Final Parsed Data:", data);
    console.log("---------------------------");
    
    return data;
}


async function handlePdfProcessing() {
    if (!window.pdfjsLib) {
         showToast('PDF.js library not loaded. Check network connection.', 'error');
         return;
    }
    
    const file = el.pdfUploadInput.files[0];
    if (!file) {
        showToast('Please select a PDF service order file first.', 'error');
        return;
    }

    el.processPdfBtn.disabled = true;
    el.pdfStatusMsg.style.color = '#4f46e5';
    el.pdfStatusMsg.textContent = 'Processing PDF locally...';
    
    try {
        const arrayBuffer = await getPdfData(file);
        const rawText = await extractTextFromPdf(arrayBuffer);
        
        // Use the highly optimized, cost-free parser
        const data = parseServiceOrderText(rawText);
        
        // --- Autofill the form ---
        el.soNumberInput.value = data.serviceOrderNumber || '';
        el.customerNameInput.value = data.customerName || '';
        el.addressInput.value = data.address || '';
        el.customerEmailInput.value = data.primaryEmail || '';
        el.customerPhoneInput.value = data.primaryPhone || '';
        
        // Attempt to select the service speed if available
        const speed = data.serviceSpeed;
        const options = Array.from(el.serviceSpeedInput.options).map(opt => opt.value);
        const bestMatch = options.find(opt => speed && opt.toLowerCase().includes(speed.toLowerCase()));
        
        // Use best match, or default to 200 Mbps if 500 or 1Gbps aren't found, 
        // OR default to the first option if the speed field is truly empty.
        el.serviceSpeedInput.value = bestMatch || options.find(opt => opt.includes('200')) || options[0];

        el.pdfStatusMsg.textContent = 'PDF processed and form successfully autofilled! Review details before saving.';
        el.pdfStatusMsg.style.color = '#065F46'; // Green success color
        
    } catch (error) {
        console.error("PDF Processing Failed:", error);
        el.pdfStatusMsg.textContent = `Error processing PDF: ${error.message}. Try manual entry.`;
        el.pdfStatusMsg.style.color = '#ef4444'; // Red error color
        showToast('PDF processing failed.', 'error');
    } finally {
        el.processPdfBtn.disabled = false;
        el.pdfUploadInput.value = ''; // Clear file input
    }
}

// --- DASHBOARD FUNCTIONS (Unchanged) ---
function calculateDashboardStats(customers) {
    const statusCounts = {
        'New Order': 0,
        'Site Survey': 0,
        'NID': 0,
        'On Hold': 0,
        'Completed': 0
    };
    
    // YTD installation data (Month/Year => count)
    const ytdInstalls = {};
    const currentYear = new Date().getFullYear();

    customers.forEach(c => {
        if (statusCounts.hasOwnProperty(c.status)) {
            statusCounts[c.status]++;
        }
        
        if (c.status === 'Completed' && c.installDetails?.installDate) {
            const date = c.installDetails.installDate; // YYYY-MM-DD
            const year = date.substring(0, 4);
            
            if (parseInt(year) === currentYear) {
                const month = date.substring(5, 7); // MM
                const key = `${currentYear}-${month}`;
                ytdInstalls[key] = (ytdInstalls[key] || 0) + 1;
            }
        }
    });

    const totalActive = statusCounts['New Order'] + statusCounts['Site Survey'] + statusCounts['NID'] + statusCounts['On Hold'];
    const totalCompleted = statusCounts['Completed'];
    
    renderDashboard(totalActive, totalCompleted, statusCounts);
    renderChart(ytdInstalls, currentYear);
}

function renderDashboard(totalActive, totalCompleted, statusCounts) {
    let breakdownHtml = '';
    const activeStatuses = ['New Order', 'Site Survey', 'NID', 'On Hold'];
    
    // Sort active statuses: New Order, Site Survey, NID, On Hold
    activeStatuses.sort((a, b) => {
        const order = { 'New Order': 1, 'Site Survey': 2, 'NID': 3, 'On Hold': 4 };
        return order[a] - order[b];
    });

    activeStatuses.forEach(status => {
        if (statusCounts[status] > 0) {
            breakdownHtml += `<span>${statusCounts[status]} in ${status}</span>, `;
        }
    });

    // Clean up trailing comma and space
    breakdownHtml = breakdownHtml.replace(/, $/, '');
    if (breakdownHtml === '') {
         breakdownHtml = 'No orders currently in progress.';
    }

    // --- RENDER ACTIVE STAT ---
    el.statsSummaryActiveWrapper.innerHTML = `
        <div class="stat-box" style="background-color: #eef2ff; border: 1px solid #c7d2fe;">
            <div class="stat-main-title">Active Orders</div>
            <div class="stat-main-value" style="color: #4f46e5;">${totalActive}</div>
            <p class="stat-breakdown">${breakdownHtml}</p>
        </div>
    `;

    // --- RENDER COMPLETED STAT ---
    el.statsSummaryCompletedWrapper.innerHTML = `
        <div class="stat-box" style="background-color: #d1fae5; border: 1px solid #a7f3d0;">
            <div class="stat-main-title">Completed Orders</div>
            <div class="stat-main-value" style="color: #065f46;">${totalCompleted}</div>
            <p class="stat-breakdown">Total lifetime installs.</p>
        </div>
    `;
}

function renderChart(ytdInstalls, currentYear) {
    // Standard month mapping for chart labels
    const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    const chartLabels = [];
    const chartData = [];

    // Initialize data for all months of the current year
    for (let i = 1; i <= 12; i++) {
        const monthKey = `${currentYear}-${String(i).padStart(2, '0')}`;
        chartLabels.push(monthNames[i - 1]);
        chartData.push(ytdInstalls[monthKey] || 0);
    }
    
    // If a chart instance exists, destroy it first
    if (myChart) {
        myChart.destroy();
    }

    if (!el.installationsChart) {
        console.error("Chart canvas not found.");
        return;
    }

    // Get the global Chart object (from CDN)
    const Chart = window.Chart;

    myChart = new Chart(el.installationsChart, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Installs',
                data: chartData,
                backgroundColor: '#4f46e5', // Indigo color
                borderColor: '#4f46e5',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: false // Hide title for compactness
                    },
                    ticks: {
                        precision: 0, // Ensure integer ticks
                        maxTicksLimit: 5 // Limit ticks for smaller view
                    }
                }
            }
        }
    });
}
// --- END DASHBOARD FUNCTIONS ---

// --- NEW HELPER FUNCTION: Populates Month/Year Filter (Unchanged) ---
function updateCompletedFilterOptions() {
    // Filter down to only completed customers with an install date
    const completedCustomers = allCustomers.filter(c => 
        c.status === 'Completed' && c.installDetails?.installDate
    );

    // Get unique 'YYYY-MM' strings
    const dateMap = new Map(); 
    completedCustomers.forEach(c => {
        const dateString = c.installDetails.installDate; // format: 'YYYY-MM-DD'
        const date = new Date(dateString.replace(/-/g, '/')); // Use forward slashes for cross-browser compatibility
        // Using 'en-US' or similar to get locale month name, and full year
        const monthYearKey = date.toLocaleString('en-US', { month: 'long', year: 'numeric' }); 
        const monthYearValue = dateString.substring(0, 7); // 'YYYY-MM'
        
        dateMap.set(monthYearValue, monthYearKey);
    });

    // Convert Map entries to a list of objects for sorting and rendering
    const sortedDates = Array.from(dateMap).map(([value, text]) => ({ value, text }));

    // Sort newest to oldest (reverse alphabetical on YYYY-MM)
    sortedDates.sort((a, b) => b.value.localeCompare(a.value));
    
    // Render options
    el.completedFilterSelect.innerHTML = '';
    
    // Add "All" option
    const allOption = document.createElement('option');
    allOption.value = 'All';
    allOption.textContent = 'All Completed Orders';
    el.completedFilterSelect.appendChild(allOption);

    sortedDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date.value;
        option.textContent = date.text;
        el.completedFilterSelect.appendChild(option);
    });
    
    // Ensure the filter state is valid after update
    if (!el.completedFilterSelect.querySelector(`option[value="${currentCompletedFilter}"]`)) {
        currentCompletedFilter = 'All';
    }
    el.completedFilterSelect.value = currentCompletedFilter;
}


// --- 3. CUSTOMER LIST (READ) (Unchanged) ---

function loadCustomers() {
    if (!customersCollectionRef) return;
    if (customerUnsubscribe) customerUnsubscribe();

    const q = query(customersCollectionRef);
    customerUnsubscribe = onSnapshot(q, (snapshot) => {
        el.listLoading.style.display = 'none';
        
        allCustomers = []; 
        snapshot.forEach((doc) => {
            allCustomers.push({ id: doc.id, ...doc.data() });
        });
        
        // --- NEW: Calculate/Render Dashboard ---
        calculateDashboardStats(allCustomers);
        
        // Update the completed filter options
        updateCompletedFilterOptions();
        
        displayCustomers();
        
        if (selectedCustomerId) {
            const freshData = allCustomers.find(c => c.id === selectedCustomerId);
            if (freshData) {
                populateDetailsForm(freshData);
                setPageForStatus(el.detailsForm['details-status'].value);
            } else {
                handleDeselectCustomer();
            }
        }
    }, (error) => {
        console.error("Error loading customers: ", error);
        el.listLoading.textContent = 'Error loading customers.';
        showToast('Error loading customers.', 'error');
    });
}

// --- NEW CENTRAL RENDER FUNCTION (Unchanged) ---
function displayCustomers() {
    const searchTerm = el.searchBar.value.toLowerCase();
    
    let filteredCustomers = [...allCustomers];
    let isCompletedList = (currentFilter === 'Completed');

    // 1. Apply Stage Filter (Handles isolating Completed list from active lists)
    if (isCompletedList) {
        // Only show 'Completed' customers
        filteredCustomers = filteredCustomers.filter(c => c.status === 'Completed');
        
        // Apply Month/Year Filter (only if Completed is selected)
        if (currentCompletedFilter !== 'All') {
            filteredCustomers = filteredCustomers.filter(c => 
                (c.installDetails?.installDate || '').startsWith(currentCompletedFilter)
            );
        }

    } else if (currentFilter !== 'All') {
        // Show only the selected active status (New Order, Site Survey, NID, On Hold)
        filteredCustomers = filteredCustomers.filter(c => c.status === currentFilter);
        
    } else {
        // 'All' filter selected: Show all EXCEPT 'Completed' (active list view)
        filteredCustomers = filteredCustomers.filter(c => c.status !== 'Completed');
    }

    // 2. Apply Search Filter
    if (searchTerm) {
        filteredCustomers = filteredCustomers.filter(c => 
            (c.customerName || '').toLowerCase().includes(searchTerm) || 
            (c.address || '').toLowerCase().includes(searchTerm)
        );
    }

    // 3. Apply Sort (Modified to prioritize Completed date sort)
    if (isCompletedList) {
        // Sort Completed list by Install Date (newest first)
        filteredCustomers.sort((a, b) => {
            const dateA = a.installDetails?.installDate || '0000-00-00';
            const dateB = b.installDetails?.installDate || '0000-00-00';
            // Simple date string comparison works for YYYY-MM-DD (newest date is greatest string)
            return dateB.localeCompare(dateA); 
        });
    } else if (currentSort === 'name') {
        filteredCustomers.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    } else if (currentSort === 'date') {
        filteredCustomers.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } else if (currentSort === 'date-oldest') { 
        filteredCustomers.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    }

    // 4. Render the final list
    renderCustomerList(filteredCustomers, searchTerm);
}

// --- MODIFIED: renderCustomerList (Unchanged) ---
function renderCustomerList(customersToRender, searchTerm = '') {
    el.customerListContainer.innerHTML = '';
    el.customerListContainer.appendChild(el.listLoading); 

    if (customersToRender.length === 0) {
        if (searchTerm) {
            el.listLoading.textContent = `No customers found matching "${searchTerm}".`;
        } else if (currentFilter === 'Completed' && currentCompletedFilter !== 'All') {
             el.listLoading.textContent = `No completed orders found in the selected month.`;
        } else if (currentFilter !== 'All') {
            el.listLoading.textContent = `No customers found in stage "${currentFilter}".`;
        } else {
            el.listLoading.textContent = 'No customers found. Add one to get started!';
        }
        el.listLoading.style.display = 'block';
        return;
    }
    el.listLoading.style.display = 'none'; 

    customersToRender.forEach(customer => {
        const item = document.createElement('div');
        item.className = 'customer-item';
        item.dataset.id = customer.id;
        if (customer.id === selectedCustomerId) {
            item.classList.add('selected');
        }

        const getStatusClass = (status) => {
            if (!status) return 'status-default';
            const statusSlug = status.toLowerCase().replace(/ /g, '-');
            return `status-${statusSlug}`;
        };

        let createdDate = ''; 
        if (customer.createdAt && customer.createdAt.seconds) {
            createdDate = new Date(customer.createdAt.seconds * 1000).toLocaleDateString();
        }
        
        // Use Install Date for Completed list view
        const dateDisplay = (customer.status === 'Completed' && customer.installDetails?.installDate) 
            ? new Date(customer.installDetails.installDate.replace(/-/g, '/')).toLocaleDateString() : createdDate;

        item.innerHTML = `
            <div class="customer-item-header">
                <h3 class="customer-item-name">${customer.customerName}</h3>
                <span class="status-pill ${getStatusClass(customer.status)}">${customer.status}</span>
            </div>
            <div class="customer-item-footer">
                <p class="customer-item-address">${customer.address || 'N/A'}</p>
                <p class="customer-item-date">${dateDisplay}</p>
            </div>
            <p class="search-address" style="display: none;">${customer.address || ''}</p>
        `;
        el.customerListContainer.appendChild(item);
    });
}


// --- 4. CUSTOMER (CREATE) (Unchanged) ---

function openAddCustomerModal() {
    el.addCustomerModal.classList.add('show');
    el.pdfStatusMsg.textContent = ''; // Clear status message on open
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function closeAddCustomerModal() {
    el.addCustomerModal.classList.remove('show');
    el.addForm.reset();
    el.pdfStatusMsg.textContent = ''; // Clear status message on close
    el.processPdfBtn.disabled = false;
    el.pdfUploadInput.value = '';
}

async function handleAddCustomer(e) {
    e.preventDefault();
    if (!customersCollectionRef) return;

    const newCustomer = {
        serviceOrderNumber: el.soNumberInput.value,
        customerName: el.customerNameInput.value,
        address: el.addressInput.value, 
        primaryContact: {
            email: el.customerEmailInput.value,
            phone: el.customerPhoneInput.value
        },
        secondaryContact: { name: "", phone: "" },
        serviceSpeed: el.serviceSpeedInput.value,
        status: "New Order",
        createdAt: serverTimestamp(), 
        preInstallChecklist: {
            welcomeEmailSent: false,
            addedToSiteSurvey: false,
            addedToFiberList: false,
            addedToRepairShoppr: false
        },
        installDetails: {
            installDate: "",
            eeroInfo: false, 
            nidLightReading: "",
            additionalEquipment: "",
            generalNotes: "",
            siteSurveyNotes: "",
            installNotes: "" 
        },
        postInstallChecklist: {
            removedFromFiberList: false,
            removedFromSiteSurvey: false,
            updatedRepairShoppr: false
        }
    };

    try {
        await addDoc(customersCollectionRef, newCustomer);
        showToast('Customer added successfully!', 'success');
        closeAddCustomerModal();
    } catch (error) {
        console.error("Error adding customer: ", error);
        showToast('Error adding customer.', 'error');
    }
}


// --- 5. DETAILS PANEL (UPDATE / DELETE) (Unchanged) ---
async function handleSelectCustomer(customerId, customerItem) {
    if (selectedCustomerId === customerId) {
        handleDeselectCustomer();
        return;
    }
    selectedCustomerId = customerId;
    document.querySelectorAll('.customer-item').forEach(item => {
        item.classList.remove('selected');
    });
    customerItem.classList.add('selected');
    el.detailsPlaceholder.style.display = 'none';
    el.detailsContainer.style.display = 'block';
    el.detailsContainer.dataset.id = customerId; 
    el.loadingOverlay.style.display = 'flex'; 

    try {
        const docRef = doc(customersCollectionRef, customerId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            populateDetailsForm(docSnap.data());
            setPageForStatus(docSnap.data().status);
        } else {
            showToast('Could not find customer data.', 'error');
            handleDeselectCustomer();
        }
    } catch (error) {
        console.error("Error fetching document:", error);
        showToast('Error fetching customer details.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
}

function handleDeselectCustomer() {
    selectedCustomerId = null;
    document.querySelectorAll('.customer-item').forEach(item => {
        item.classList.remove('selected');
    });
    el.detailsPlaceholder.style.display = 'block';
    el.detailsContainer.style.display = 'none';
    el.detailsContainer.dataset.id = '';
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function populateDetailsForm(data) {
    // Editable fields (UPDATED TO USE .value)
    el.detailsSoNumberInput.value = data.serviceOrderNumber || '';
    el.detailsCustomerNameInput.value = data.customerName || ''; // NEW
    el.detailsAddressInput.value = data.address || '';
    el.detailsSpeedInput.value = data.serviceSpeed || '';
    el.detailsEmailInput.value = data.primaryContact?.email || '';
    el.detailsPhoneInput.value = data.primaryContact?.phone || '';
    
    // Status
    el.detailsForm['details-status'].value = data.status || 'New Order';
    // Pre-Install
    el.detailsForm['check-welcome-email'].checked = data.preInstallChecklist?.welcomeEmailSent || false;
    el.detailsForm['check-site-survey'].checked = data.preInstallChecklist?.addedToSiteSurvey || false;
    el.detailsForm['check-fiber-list'].checked = data.preInstallChecklist?.addedToFiberList || false;
    el.detailsForm['check-repair-shoppr'].checked = data.preInstallChecklist?.addedToRepairShoppr || false;
    // Site Survey
    el.detailsForm['site-survey-notes'].value = data.installDetails?.siteSurveyNotes || '';
    // Install
    el.detailsForm['install-date'].value = data.installDetails?.installDate || '';
    el.detailsForm['eero-info'].checked = data.installDetails?.eeroInfo || false; 
    el.detailsForm['nid-light'].value = data.installDetails?.nidLightReading || '';
    el.detailsForm['extra-equip'].value = data.installDetails?.additionalEquipment || '';
    el.detailsForm['general-notes'].value = data.installDetails?.generalNotes || '';
    el.detailsForm['install-notes'].value = data.installDetails?.installNotes || ''; 
    // Post-Install
    el.detailsForm['post-check-fiber'].checked = data.postInstallChecklist?.removedFromFiberList || false;
    el.detailsForm['post-check-survey'].checked = data.postInstallChecklist?.removedFromSiteSurvey || false;
    el.detailsForm['post-check-repair'].checked = data.postInstallChecklist?.updatedRepairShoppr || false;

    // This will style the stepper correctly when a customer is loaded
    updateStepperUI(data.status || 'New Order');
}

function showDetailsPage(pageId) {
    el.detailsPages.forEach(page => page.classList.remove('active'));
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
}

// --- RENAMED and UPDATED (Unchanged) ---
function setPageForStatus(status) {
    switch (status) {
        case 'Site Survey':
            showDetailsPage('page-site-survey');
            break;
        case 'NID': 
            showDetailsPage('page-nid');
            break;
        case 'Completed': 
        case 'Install': 
            showDetailsPage('page-install');
            break;
        case 'New Order':
        case 'On Hold':
        default:
            showDetailsPage('page-pre-install');
    }
}

// --- NEW FUNCTION (Unchanged) ---
function handleToggleOnHold(e) {
    e.preventDefault(); // It's in a form
    const currentStatus = el.detailsForm['details-status'].value;

    if (currentStatus === 'On Hold') {
        // TOGGLE OFF
        // Get the status we saved, or default to 'New Order'
        const statusToRestore = el.detailsForm.dataset.statusBeforeHold || 'New Order';
        el.detailsForm['details-status'].value = statusToRestore;
        updateStepperUI(statusToRestore);
        setPageForStatus(statusToRestore);
    } else {
        // TOGGLE ON
        // Save the current status before setting to "On Hold"
        el.detailsForm.dataset.statusBeforeHold = currentStatus;
        el.detailsForm['details-status'].value = 'On Hold';
        updateStepperUI('On Hold');
        setPageForStatus('On Hold'); // Shows pre-install page
    }
    
    // Refresh lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// --- MODIFIED FUNCTION (Unchanged) ---
function updateStepperUI(currentStatus) {
    const steps = ['New Order', 'Site Survey', 'NID', 'Completed']; 
    const allStepButtons = el.statusStepper.querySelectorAll('.step');

    // Reset all styles
    allStepButtons.forEach(btn => {
        btn.classList.remove('active', 'completed');
    });

    // On Hold button text/style logic
    const onHoldBtnText = el.onHoldButton.querySelector('span');

    if (currentStatus === 'On Hold') {
        // Handle "On Hold" state
        el.onHoldButton.classList.add('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Status: On Hold';
        el.statusStepper.classList.add('is-on-hold'); 
        
    } else {
        // Handle main progression states
        el.onHoldButton.classList.remove('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Toggle On Hold';
        el.statusStepper.classList.remove('is-on-hold'); 

        const statusIndex = steps.indexOf(currentStatus);
        if (statusIndex !== -1) {
            for (let i = 0; i < allStepButtons.length; i++) {
                const stepButton = allStepButtons[i];
                // Check if the button's data-status matches the progression steps
                if (stepButton.dataset.status === steps[i]) {
                    if (i < statusIndex) {
                        stepButton.classList.add('completed');
                    } else if (i === statusIndex) {
                        stepButton.classList.add('active');
                    }
                }
            }
        } else {
            // Default to New Order if status is unknown (e.g., old 'Install' data)
            const newOrderButton = el.statusStepper.querySelector('.step[data-status="New Order"]');
            if (newOrderButton) {
                newOrderButton.classList.add('active');
            }
        }
    }
}
// --- END MODIFIED FUNCTION ---


function handleDetailsFormClick(e) {
    const copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return; 
    const targetId = copyBtn.dataset.target;
    if (!targetId) return;
    const targetElement = document.getElementById(targetId);
    if (!targetElement) return;
    // --- UPDATED: Check if the element is an input/textarea (value) or span (textContent) ---
    const textToCopy = (targetElement.tagName === 'SPAN' || targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA') ? targetElement.value : targetElement.textContent;
    if (!textToCopy) {
        showToast('Nothing to copy.', 'error');
        return;
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyBtn.classList.add('copied');
        el.detailsForm.querySelectorAll('.copy-btn').forEach(btn => {
            if (btn !== copyBtn) btn.classList.remove('copied');
        });
        setTimeout(() => copyBtn.classList.remove('copied'), 1500); 
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showToast('Failed to copy.', 'error');
    }
}

async function handleUpdateCustomer(e) {
    e.preventDefault();
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;

    const updatedData = {
        // Editable fields (UPDATED TO READ FROM INPUTS)
        'serviceOrderNumber': el.detailsSoNumberInput.value,
        'customerName': el.detailsCustomerNameInput.value, // NEW
        'address': el.detailsAddressInput.value,
        'serviceSpeed': el.detailsSpeedInput.value,
        'primaryContact.email': el.detailsEmailInput.value,
        'primaryContact.phone': el.detailsPhoneInput.value,
        
        // Checklist/Status fields (UNCHANGED)
        'status': el.detailsForm['details-status'].value,
        'preInstallChecklist.welcomeEmailSent': el.detailsForm['check-welcome-email'].checked,
        'preInstallChecklist.addedToSiteSurvey': el.detailsForm['check-site-survey'].checked,
        'preInstallChecklist.addedToFiberList': el.detailsForm['check-fiber-list'].checked,
        'preInstallChecklist.addedToRepairShoppr': el.detailsForm['check-repair-shoppr'].checked,
        'installDetails.siteSurveyNotes': el.detailsForm['site-survey-notes'].value,
        'installDetails.installDate': el.detailsForm['install-date'].value,
        'installDetails.eeroInfo': el.detailsForm['eero-info'].checked, 
        'installDetails.nidLightReading': el.detailsForm['nid-light'].value, 
        'installDetails.additionalEquipment': el.detailsForm['extra-equip'].value,
        'installDetails.generalNotes': el.detailsForm['general-notes'].value,
        'installDetails.installNotes': el.detailsForm['install-notes'].value, 
        'postInstallChecklist.removedFromFiberList': el.detailsForm['post-check-fiber'].checked,
        'postInstallChecklist.removedFromSiteSurvey': el.detailsForm['post-check-survey'].checked,
        'postInstallChecklist.updatedRepairShoppr': el.detailsForm['post-check-repair'].checked
    };

    try {
        el.loadingOverlay.style.display = 'flex';
        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, updatedData);
        showToast('Customer updated!', 'success');
    } catch (error) {
        console.error("Error updating customer: ", error);
        showToast('Error updating customer.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}

async function handleDeleteCustomer(e) {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    const customerName = el.detailsSoNumberInput.value; // UPDATED reference
    
    // --- NOTE: Changed from window.confirm to a simple confirm for this environment ---
    if (confirm(`Are you sure you want to delete customer ${customerName}? This cannot be undone.`)) {
        try {
            el.loadingOverlay.style.display = 'flex';
            const docRef = doc(customersCollectionRef, customerId);
            await deleteDoc(docRef);
            showToast('Customer deleted.', 'success');
            handleDeselectCustomer();
        } catch (error) {
            console.error("Error deleting customer: ", error);
            showToast('Error deleting customer.', 'error');
        } finally {
            el.loadingOverlay.style.display = 'none';
        }
    }
}

// --- 6. ACTIONS (Unchanged) ---
async function handleSendWelcomeEmail(e) {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    const toEmail = el.detailsEmailInput.value; // UPDATED reference
    const customerName = el.detailsCustomerNameInput.value; // UPDATED reference
    if (!toEmail) {
        showToast('No customer email on file to send to.', 'error');
        return;
    }
    // --- NOTE: Changed from window.confirm to a simple confirm for this environment ---
    if (!confirm(`Send welcome email to ${customerName} at ${toEmail}?`)) {
        return;
    }
    el.loadingOverlay.style.display = 'flex';
    try {
        const mailCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'mail');
        await addDoc(mailCollectionRef, {
            to: [toEmail],
            template: { name: "cfnWelcome", data: { customerName: customerName } },
        });
        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, { "preInstallChecklist.welcomeEmailSent": true });
        showToast('Welcome email sent!', 'success');
    } catch (error) {
        console.error("Error sending welcome email: ", error);
        showToast('Error sending email. Check console.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}

async function handleCopyBilling(e) {
    e.preventDefault();
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId) return;
    try {
        const docRef = doc(customersCollectionRef, customerId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            showToast('Could not find customer data to copy.', 'error');
            return;
        }
        const data = docSnap.data();
        // Use current values from the form for billing info
        const customerName = el.detailsCustomerNameInput.value; 
        const address = el.detailsAddressInput.value;
        const soNumber = el.detailsSoNumberInput.value;

        // --- MODIFIED BILLING TEXT ---
        const billingText = `
Customer Name: ${customerName || 'N/A'}
Address: ${address || 'N/A'}
Service Order: ${soNumber || 'N/A'}
Date Installed: ${data.installDetails.installDate || 'N/A'}
Additional Equipment: ${data.installDetails.additionalEquipment || 'N/A'}
        `.trim().replace(/^\s+\n/gm, '\n'); // Clean up whitespace

        const ta = document.createElement('textarea');
        ta.value = billingText;
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Billing info copied to clipboard!', 'success');
    } catch (error) {
        console.error("Error copying billing info: ", error);
        showToast('Error copying info.', 'error');
    }
}

// --- 7. UTILITIES (Unchanged) ---

function showToast(message, type = 'success') {
    el.toast.textContent = message;
    el.toast.classList.remove('success', 'error');
    el.toast.classList.add(type === 'error' ? 'error' : 'success');
    el.toast.classList.add('show');
    setTimeout(() => el.toast.classList.remove('show'), 3000);
}