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
const PDFJS_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs"; 
// NEW: Define the workflow steps
const STEPS_WORKFLOW = ['New Order', 'Site Survey Ready', 'Torys List', 'NID Ready', 'Install Ready', 'Completed'];
// --- END CONSTANTS ---

// --- Global State ---
let currentUserId = null;
let currentAppId = 'default-app-id';
let customersCollectionRef = null;
let mailCollectionRef = null;
let selectedCustomerId = null;
let customerUnsubscribe = null;
let allCustomers = []; 
let currentSort = 'name'; 
let currentFilter = 'All'; 
let currentCompletedFilter = 'All'; 

// Chart instances (declared at top level)
let myChart = null; 
let monthlyAvgChart = null; 
let speedChart = null; 

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
    pdfDropZone: document.getElementById('pdf-drop-zone'),
    pdfUploadInput: document.getElementById('pdf-upload'),
    selectedFileNameDisplay: document.getElementById('selected-file-name'),
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
    completedFilterResults: document.getElementById('completed-filter-results'), // <-- NEW

    // --- DASHBOARD ELEMENTS ---
    statsSummaryActiveWrapper: document.getElementById('stats-summary-active-wrapper'),
    statsSummaryCompletedWrapper: document.getElementById('stats-summary-completed-wrapper'),
    installationsChart: document.getElementById('installations-chart'),
    // KPIs
    overallInstallTimeWrapper: document.getElementById('overall-install-time-wrapper'),
    monthlyInstallChart: document.getElementById('monthly-install-chart'), 
    speedBreakdownChart: document.getElementById('speed-breakdown-chart'), 
    dashboardToggleBtn: document.getElementById('dashboard-toggle-btn'), 
    dashboardContent: document.getElementById('dashboard-content'), 
    dashboardToggleIcon: document.getElementById('dashboard-toggle-icon'), 

    // Details Panel
    detailsContainer: document.getElementById('details-container'),
    detailsForm: document.getElementById('details-form'),
    detailsPlaceholder: document.getElementById('details-placeholder'),
    loadingOverlay: document.getElementById('loading-overlay'),
    
    // Copyable/Editable Fields (UPDATED REFERENCES)
    detailsSoNumberInput: document.getElementById('details-so-number'),
    detailsCustomerNameInput: document.getElementById('details-customer-name'), 
    detailsAddressInput: document.getElementById('details-address'),
    detailsSpeedInput: document.getElementById('details-speed'),
    detailsEmailInput: document.getElementById('details-email'),
    detailsPhoneInput: document.getElementById('details-phone'),
    detailsGeneralNotes: document.getElementById('details-general-notes'), // NEW
    
    // Buttons
    sendWelcomeEmailBtn: document.getElementById('send-welcome-email-btn'),
    headerSaveBtn: document.getElementById('header-save-btn'), 
    headerSaveAndProgressBtn: document.getElementById('header-save-and-progress-btn'), // NEW
    updateCustomerBtn: document.getElementById('update-customer-btn'), 
    saveAndProgressBtn: document.getElementById('save-and-progress-btn'), // NEW
    copyBillingBtn: document.getElementById('copy-billing-btn'),
    deleteCustomerBtn: document.getElementById('delete-customer-btn'),
    onHoldButton: document.getElementById('on-hold-btn'), 
    archiveCustomerBtn: document.getElementById('archive-customer-btn'), // NEW
    unarchiveCustomerBtn: document.getElementById('unarchive-customer-btn'), // NEW
    completedActionsDiv: document.getElementById('completed-actions-div'), // NEW


    // --- UPDATED: Stepper and Pages ---
    statusStepper: document.getElementById('status-stepper'),
    detailsPages: document.querySelectorAll('.details-page'),
    
    // Toast
    toast: document.getElementById('toast-notification')
};

// --- 1. AUTHENTICATION (Updated to set shared collection paths) ---
onAuthStateChanged(auth, (user) => {
    handleAuthentication(user);
});

const handleAuthentication = (user) => {
    if (user && user.email && user.email.endsWith('@nptel.com')) {
        currentUserId = user.uid;
        el.userEmailDisplay.textContent = user.email;
        currentAppId = 'cfn-install-tracker';
        
        // Shared public data path
        customersCollectionRef = collection(db, 'artifacts', currentAppId, 'public', 'data', 'customers');
        // User-specific mail collection
        mailCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'mail');
        
        el.appScreen.classList.remove('hidden');
        el.authScreen.classList.add('hidden');
        initializeApp();
    } else {
        currentUserId = null;
        customersCollectionRef = null;
        mailCollectionRef = null;
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
};

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


// --- DASHBOARD CHART FUNCTIONS ---

const updateCompletedFilterOptions = (allCustomers) => {
    const completedCustomers = allCustomers.filter(c => 
        (c.status === 'Completed' || c.status === 'Archived') && c.installDetails?.installDate
    );

    const yearMap = new Map();
    const monthMap = new Map();

    completedCustomers.forEach(c => {
        const dateString = c.installDetails.installDate; 
        const date = new Date(dateString.replace(/-/g, '/')); 
        
        const yearKey = date.getFullYear().toString();
        const yearValue = yearKey;

        const monthKey = date.toLocaleString('en-US', { month: 'long', year: 'numeric' }); 
        const monthValue = dateString.substring(0, 7); 
        
        yearMap.set(yearValue, `All ${yearValue}`);
        monthMap.set(monthValue, monthKey);
    });
    
    const sortedYears = Array.from(yearMap).map(([value, text]) => ({ value, text }));
    sortedYears.sort((a, b) => b.value.localeCompare(a.value)); // Newest year first
    
    const sortedMonths = Array.from(monthMap).map(([value, text]) => ({ value, text }));
    sortedMonths.sort((a, b) => b.value.localeCompare(a.value)); // Newest month first
    
    el.completedFilterSelect.innerHTML = '';
    
    const allOption = document.createElement('option');
    allOption.value = 'All';
    allOption.textContent = 'All Time'; // Changed text
    el.completedFilterSelect.appendChild(allOption);

    // Add Year Options
    const yearGroup = document.createElement('optgroup');
    yearGroup.label = 'By Year';
    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year.value;
        option.textContent = year.text;
        yearGroup.appendChild(option);
    });
    el.completedFilterSelect.appendChild(yearGroup);

    // Add Month Options
    const monthGroup = document.createElement('optgroup');
    monthGroup.label = 'By Month';
    sortedMonths.forEach(month => {
        const option = document.createElement('option');
        option.value = month.value;
        option.textContent = month.text;
        monthGroup.appendChild(option);
    });
    el.completedFilterSelect.appendChild(monthGroup);
    
    // Ensure the current filter is still valid
    if (!el.completedFilterSelect.querySelector(`option[value="${currentCompletedFilter}"]`)) {
        currentCompletedFilter = 'All';
    }
    el.completedFilterSelect.value = currentCompletedFilter;
};


const renderSpeedBreakdownChart = (speedCounts) => {
    const Chart = window.Chart;
    if (speedChart) {
        speedChart.destroy();
    }
    
    const speedLabels = Object.keys(speedCounts);
    const speedData = Object.values(speedCounts);
    
    const colors = [
        '#4f46e5', // Indigo
        '#065f46', // Green
        '#d97706', // Yellow/Orange
        '#9ca3af'  // Gray (for unknown)
    ];

    speedChart = new Chart(el.speedBreakdownChart, {
        type: 'doughnut',
        data: {
            labels: speedLabels,
            datasets: [{
                data: speedData,
                backgroundColor: speedLabels.map((_, i) => colors[i % colors.length]),
                borderColor: 'white',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'right',
                    align: 'middle',
                    labels: {
                        boxWidth: 10,
                        padding: 10
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
};

const renderMonthlyAverageChart = (monthlyAverages) => {
    const Chart = window.Chart;
    if (monthlyAvgChart) {
        monthlyAvgChart.destroy();
    }
    
    const sortedKeys = Object.keys(monthlyAverages).sort();
    const chartLabels = sortedKeys.map(key => new Date(key.replace(/-/g, '/')).toLocaleString('en-US', { month: 'short', year: '2-digit' }));
    const chartData = sortedKeys.map(key => monthlyAverages[key]);
    
    monthlyAvgChart = new Chart(el.monthlyInstallChart, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Avg Days to Install',
                data: chartData,
                backgroundColor: 'rgba(217, 119, 6, 0.5)',
                borderColor: '#d97706',
                borderWidth: 2,
                tension: 0.2,
                pointRadius: 4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false } },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, maxTicksLimit: 5 },
                    title: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `Avg: ${context.raw} days`
                    }
                }
            }
        }
    });
};

const renderChart = (ytdInstalls, currentYear) => {
    const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    const chartLabels = [];
    const chartData = [];

    for (let i = 1; i <= 12; i++) {
        const monthKey = `${currentYear}-${String(i).padStart(2, '0')}`;
        chartLabels.push(monthNames[i - 1]);
        chartData.push(ytdInstalls[monthKey] || 0);
    }
    
    if (myChart && myChart.canvas.id === 'installations-chart') {
        myChart.destroy();
    }

    if (!el.installationsChart) {
        console.error("Chart canvas (installations-chart) not found.");
        return;
    }

    const Chart = window.Chart;

    myChart = new Chart(el.installationsChart, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Installs',
                data: chartData,
                backgroundColor: '#4f46e5',
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
                        display: false
                    },
                    ticks: {
                        precision: 0,
                        maxTicksLimit: 5
                    }
                }
            }
        }
    });
};


// --- DASHBOARD TOGGLE FUNCTION ---
const handleDashboardToggle = () => {
    const isExpanded = el.dashboardContent.classList.contains('active');
    
    if (isExpanded) {
        el.dashboardContent.classList.remove('active');
        el.dashboardToggleBtn.setAttribute('aria-expanded', 'false');
        // UPDATED ICON PATH
        el.dashboardToggleIcon.src = 'icons/chevron_up.png';
    } else {
        el.dashboardContent.classList.add('active');
        el.dashboardToggleBtn.setAttribute('aria-expanded', 'true');
        // UPDATED ICON PATH
        el.dashboardToggleIcon.src = 'icons/chevron_down.png';
    }
};


// --- 2. INITIALIZATION ---
const initializeApp = () => {
    if (window.pdfjsLib) {
         window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    }
    
    if (el.addForm.dataset.listenerAttached !== 'true') {
        setupEventListeners();
        el.addForm.dataset.listenerAttached = 'true';
    }
    loadCustomers();
    handleDeselectCustomer(false); // Pass false to skip auto-save on init
};

const setupEventListeners = () => {
    // Modal Listeners
    el.newCustomerBtn.addEventListener('click', openAddCustomerModal);
    el.modalCloseBtn.addEventListener('click', closeAddCustomerModal);
    el.modalBackdrop.addEventListener('click', closeAddCustomerModal);

    // Form submission
    el.addForm.addEventListener('submit', handleAddCustomer);
    
    // PDF Processing Listeners (Click & Drag-and-Drop)
    el.processPdfBtn.addEventListener('click', handlePdfProcessing);
    
    // Drag and Drop Events
    el.pdfDropZone.addEventListener('click', () => el.pdfUploadInput.click());
    el.pdfDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.pdfDropZone.classList.add('dragover');
    });
    el.pdfDropZone.addEventListener('dragleave', () => {
        el.pdfDropZone.classList.remove('dragover');
    });
    el.pdfDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        el.pdfDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            el.pdfUploadInput.files = e.dataTransfer.files;
            updateSelectedFileDisplay();
        }
    });
    // Standard file input change event
    el.pdfUploadInput.addEventListener('change', updateSelectedFileDisplay);


    // Dashboard Toggle Listener
    el.dashboardToggleBtn.addEventListener('click', handleDashboardToggle); 

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
        
        el.mainListTabs.querySelectorAll('.main-list-tab').forEach(t => {
            t.classList.remove('active');
        });
        tab.classList.add('active');

        const mainFilter = tab.dataset.mainFilter;

        if (mainFilter === 'Completed') {
            el.activeControlsGroup.classList.add('hidden');
            el.completedControlsGroup.classList.remove('hidden');
            el.completedFilterGroup.querySelector('label').textContent = 'Completed Date';
            
            currentFilter = 'Completed'; 
            currentCompletedFilter = el.completedFilterSelect.value;
            el.customerListContainer.classList.add('completed-view');
            
        } else if (mainFilter === 'Archived') { // NEW
            el.activeControlsGroup.classList.add('hidden');
            el.completedControlsGroup.classList.remove('hidden');
            el.completedFilterGroup.querySelector('label').textContent = 'Archived Date'; // Change label
            
            currentFilter = 'Archived'; 
            currentCompletedFilter = el.completedFilterSelect.value;
            el.customerListContainer.classList.add('completed-view');

        } else { // Active
            el.activeControlsGroup.classList.remove('hidden');
            el.completedControlsGroup.classList.add('hidden');
            
            const activePill = el.filterPillsContainer.querySelector('.filter-pill.active');
            currentFilter = activePill ? activePill.dataset.filter : 'All';
            currentCompletedFilter = 'All'; 
            el.customerListContainer.classList.remove('completed-view');
        }

        displayCustomers();
    });

    // Secondary Pill Listener
    el.filterPillsContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (!pill) return;

        if (el.mainListTabs.querySelector('.main-list-tab[data-main-filter="Active"]').classList.contains('active')) {
            el.filterPillsContainer.querySelectorAll('.filter-pill').forEach(p => {
                p.classList.remove('active');
            });
            pill.classList.add('active');
    
            currentFilter = pill.dataset.filter;
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
    el.headerSaveBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, false)); // Manual save, not progressing
    el.headerSaveAndProgressBtn.addEventListener('click', (e) => handleSaveAndProgress(e)); 
    el.updateCustomerBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, false)); // Manual save, not progressing
    el.saveAndProgressBtn.addEventListener('click', (e) => handleSaveAndProgress(e)); 
    el.copyBillingBtn.addEventListener('click', handleCopyBilling);
    el.deleteCustomerBtn.addEventListener('click', handleDeleteCustomer);
    el.archiveCustomerBtn.addEventListener('click', handleArchiveCustomer); // NEW
    el.unarchiveCustomerBtn.addEventListener('click', handleUnarchiveCustomer); // NEW
    el.detailsForm.addEventListener('click', handleDetailsFormClick);
    
    // Stepper Click Listener
    el.statusStepper.addEventListener('click', (e) => {
        const stepButton = e.target.closest('.step'); 
        if (!stepButton) return;

        e.preventDefault();
        // --- LOGIC CHANGE ---
        // This button now *only* navigates. It does not change the status.
        const pageId = stepButton.dataset.page;
        showDetailsPage(pageId);
        
        // We still update the stepper UI to show what's "active" (selected)
        // but we DO NOT change the form's status value.
        el.statusStepper.querySelectorAll('.step').forEach(btn => btn.classList.remove('active'));
        stepButton.classList.add('active');
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    });

    // On Hold toggle
    el.onHoldButton.addEventListener('click', handleToggleOnHold);
};

// --- PDF PROCESSING FUNCTIONS ---

// Helper to update UI when file is selected
const updateSelectedFileDisplay = () => {
    const file = el.pdfUploadInput.files[0];
    if (file) {
        el.selectedFileNameDisplay.textContent = `Selected: ${file.name}`;
        el.processPdfBtn.disabled = false;
    } else {
        el.selectedFileNameDisplay.textContent = '';
        el.processPdfBtn.disabled = true;
    }
};

const getPdfData = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsArrayBuffer(file);
    });
};

const extractTextFromPdf = async (data) => {
    try {
        if (!window.pdfjsLib) {
             throw new Error("PDF.js library not found.");
        }

        const pdf = await window.pdfjsLib.getDocument({ data }).promise;
        const page = await pdf.getPage(1);
        const textContent = await page.getTextContent();
        return textContent.items.map(item => item.str).join('\n');
    } catch (e) {
        console.error("PDF Text Extraction Error:", e);
        throw new Error("Failed to read text from PDF file. Ensure it is not scanned/image-only.");
    }
};

const parseServiceOrderText = (rawText) => {
    const normalizedText = rawText
        .replace(/(\r\n|\n|\r)/gm, '\n') 
        .replace(/ +/g, ' ')            
        .replace(/ \n/g, '\n')          
        .replace(/\n /g, '\n');         

    const data = {
        serviceOrderNumber: '',
        customerName: '',
        address: '',
        primaryEmail: '',
        primaryPhone: '',
        serviceSpeed: '200 Mbps' 
    };

    const findMatch = (pattern, cleanup = (v) => v.trim()) => {
        const match = normalizedText.match(pattern);
        return match ? cleanup(match[1]) : '';
    };

    data.serviceOrderNumber = findMatch(/Service Order:\s*\n?\s*(\d+)/i);
    if (!data.serviceOrderNumber) {
        data.serviceOrderNumber = findMatch(/Service Order: (\d+)/i);
    }
    
    const addressBlockMatch = normalizedText.match(/Bill To:\s*\n\n(.*?)\n\nRes\/Bus:/s);
    
    if (addressBlockMatch && addressBlockMatch[1]) {
        const addressLines = addressBlockMatch[1].split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        console.log("--- DEBUG PARSING START ---");
        console.log("Address Lines (Cleaned/Trimmed):", addressLines);


        if (addressLines.length >= 2) {
            let lastName = addressLines[0]; 
            let rawAddressAndNames = addressLines.slice(1).join(' '); 
            let firstNames = ''; 
            let finalAddressString = rawAddressAndNames;
            
            console.log("Last Name (Line 1):", lastName);
            console.log("Raw Address/Names (Line 2+):", rawAddressAndNames);
            
            const prefixMatch = rawAddressAndNames.match(/^([^0-9]*?)\s*(\d.*)/);

            if (prefixMatch) {
                firstNames = prefixMatch[1].trim();
                finalAddressString = prefixMatch[2].trim();
                
                console.log("Extracted First Names from Address Prefix:", firstNames);
                console.log("Extracted Street Address Start:", finalAddressString);

            } else {
                console.log("No street number detected at address start. Keeping raw line for address.");
                finalAddressString = rawAddressAndNames;
            }
            
            let combinedNames = '';
            
            if (firstNames.length > 0) {
                combinedNames = `${firstNames} ${lastName}`;
            } else if (lastName.includes(' ')) {
                combinedNames = lastName;
            } else {
                combinedNames = lastName;
            }
            
            data.customerName = combinedNames; 
            
            data.address = finalAddressString
                .replace(/,/g, ' ')        
                .replace(/\s+/g, ' ')      
                .trim();                   

        } else if (addressLines.length === 1) {
            data.customerName = addressLines[0];
            data.address = ""; 
        }
    }

    const cellMatch = normalizedText.match(/CELL\s*\n\s*(\d{10})/);
    if (cellMatch) {
         data.primaryPhone = cellMatch[1];
    }
    
    const emailMatch = normalizedText.match(/EMAIL\s*\n\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
        data.primaryEmail = emailMatch[1];
    }

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
    
    console.log("--- DEBUG PARSING END ---");
    console.log("Final Parsed Data:", data);
    console.log("---------------------------");
    
    return data;
};


const handlePdfProcessing = async () => {
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
        
        const data = parseServiceOrderText(rawText);
        
        el.soNumberInput.value = data.serviceOrderNumber || '';
        el.customerNameInput.value = data.customerName || '';
        el.addressInput.value = data.address || '';
        el.customerEmailInput.value = data.primaryEmail || '';
        el.customerPhoneInput.value = data.primaryPhone || '';
        
        const speed = data.serviceSpeed;
        const options = Array.from(el.serviceSpeedInput.options).map(opt => opt.value);
        const bestMatch = options.find(opt => speed && opt.toLowerCase().includes(speed.toLowerCase()));
        
        el.serviceSpeedInput.value = bestMatch || options.find(opt => opt.includes('200')) || options[0];

        el.pdfStatusMsg.textContent = 'PDF processed and form successfully autofilled! Review details before saving.';
        el.pdfStatusMsg.style.color = '#065F46'; 
        
    } catch (error) {
        console.error("PDF Processing Failed:", error);
        el.pdfStatusMsg.textContent = `Error processing PDF: ${error.message}. Try manual entry.`;
        el.pdfStatusMsg.style.color = '#ef4444'; 
        showToast('PDF processing failed.', 'error');
    } finally {
        el.processPdfBtn.disabled = false;
        // DO NOT clear input here so user sees what they selected.
        // It gets cleared on modal close instead.
    }
};

const calculateDashboardStats = (customers) => {
    const statusCounts = {
        'New Order': 0,
        'Site Survey Ready': 0,
        'Torys List': 0,
        'NID Ready': 0,
        'Install Ready': 0,
        'On Hold': 0,
        'Completed': 0,
        'Archived': 0 // NEW
    };
    
    let totalInstallDays = 0;
    let completedCount = 0;
    const monthlyInstallTimes = {}; 
    const speedCounts = {}; 
    
    const ytdInstalls = {};
    const currentYear = new Date().getFullYear();

    customers.forEach(c => {
        // --- DATA NORMALIZATION ---
        let status = c.status;
        if (status === "Tory's List") {
            status = "Torys List";
        }
        // --- END NORMALIZATION ---

        if (statusCounts.hasOwnProperty(status)) {
            statusCounts[status]++;
        }
        
        // Speed breakdown should include all customers, even archived
        const speed = c.serviceSpeed || 'Unknown';
        speedCounts[speed] = (speedCounts[speed] || 0) + 1;

        // --- MODIFICATION: Check for exemption
        // Stats should only be calculated on *Completed* customers, not Archived
        if (status === 'Completed' && !c.exemptFromStats && c.installDetails?.installDate && c.createdAt?.seconds) {
            const dateInstalled = new Date(c.installDetails.installDate.replace(/-/g, '/'));
            const dateCreated = new Date(c.createdAt.seconds * 1000);

            const diffTime = Math.abs(dateInstalled - dateCreated);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            totalInstallDays += diffDays;
            completedCount++;

            const installYear = dateInstalled.getFullYear();
            const installMonth = String(dateInstalled.getMonth() + 1).padStart(2, '0');
            const monthKey = `${installYear}-${installMonth}`;
            
            if (!monthlyInstallTimes[monthKey]) {
                monthlyInstallTimes[monthKey] = { totalDays: 0, count: 0 };
            }
            monthlyInstallTimes[monthKey].totalDays += diffDays;
            monthlyInstallTimes[monthKey].count++;
            
            if (installYear === currentYear) {
                const key = `${installYear}-${installMonth}`;
                ytdInstalls[key] = (ytdInstalls[key] || 0) + 1;
            }
        }
    });

    const totalActive = statusCounts['New Order'] + statusCounts['Site Survey Ready'] + statusCounts['Torys List'] + statusCounts['NID Ready'] + statusCounts['Install Ready'] + statusCounts['On Hold'];
    const totalCompleted = statusCounts['Completed']; // Does not include Archived
    
    const overallAvgTime = completedCount > 0 ? (totalInstallDays / completedCount).toFixed(1) : 'N/A';
    
    const finalMonthlyAverages = {};
    for (const monthKey in monthlyInstallTimes) {
        const data = monthlyInstallTimes[monthKey];
        finalMonthlyAverages[monthKey] = (data.totalDays / data.count).toFixed(1);
    }
    
    renderDashboard(totalActive, totalCompleted, statusCounts, overallAvgTime);
    renderChart(ytdInstalls, currentYear);
    renderMonthlyAverageChart(finalMonthlyAverages);
    renderSpeedBreakdownChart(speedCounts); 
    updateCompletedFilterOptions(customers); 
};

const renderDashboard = (totalActive, totalCompleted, statusCounts, overallAvgTime) => {
    let breakdownHtml = '';
    const activeStatuses = ['New Order', 'Site Survey Ready', 'Torys List', 'NID Ready', 'Install Ready', 'On Hold'];
    
    activeStatuses.sort((a, b) => {
        const order = { 'New Order': 1, 'Site Survey Ready': 2, 'Torys List': 3, 'NID Ready': 4, 'Install Ready': 5, 'On Hold': 6 };
        return order[a] - order[b];
    });

    if (totalActive > 0) {
        const pillsHtml = activeStatuses.map(status => {
            if (statusCounts[status] > 0) {
                // --- APOSTROPHE FIX ---
                const statusSlug = status.toLowerCase().replace(/'/g, '').replace(/ /g, '-');
                return `<span class="status-pill status-${statusSlug}">${status} - ${statusCounts[status]}</span>`;
            }
            return '';
        }).join('');

        breakdownHtml = `<div class="active-breakdown-grid">${pillsHtml}</div>`;
    } else {
         breakdownHtml = 'No orders currently in progress.';
    }

    el.statsSummaryActiveWrapper.innerHTML = `
        <div class="stat-box" style="background-color: #eef2ff; border: 1px solid #c7d2fe;">
            <div class="stat-main-title">Active Orders</div>
            <div class="stat-main-value" style="color: #4f46e5;">${totalActive}</div>
            <p class="stat-breakdown">${breakdownHtml}</p>
        </div>
    `;

    el.statsSummaryCompletedWrapper.innerHTML = `
        <div class="stat-box" style="background-color: #d1fae5; border: 1px solid #a7f3d0;">
            <div class="stat-main-title">Completed Orders</div>
            <div class="stat-main-value" style="color: #065f46;">${totalCompleted + 2673}</div>
            <p class="stat-breakdown">Total lifetime installs (excluding archived).</p>
        </div>
    `;
    
    el.overallInstallTimeWrapper.innerHTML = `
        <div class="stat-box" style="background-color: #fffbeb; border: 1px solid #fde68a;">
            <div class="stat-main-title">Avg Install Time</div>
            <div class="stat-main-value" style="color: #d97706;">${overallAvgTime} days</div>
            <p class="stat-breakdown">From order creation to installation complete.</p>
        </div>
    `;
};


// --- 3. CUSTOMER LIST (READ) ---

const loadCustomers = () => {
    if (!customersCollectionRef) return;
    if (customerUnsubscribe) customerUnsubscribe();

    const q = query(customersCollectionRef);
    customerUnsubscribe = onSnapshot(q, (snapshot) => {
        el.listLoading.style.display = 'none';
        
        allCustomers = []; 
        snapshot.forEach((doc) => {
            let data = doc.data();
            // --- DATA NORMALIZATION ---
            if (data.status === "Tory's List") {
                data.status = "Torys List";
            }
            // --- END NORMALIZATION ---
            allCustomers.push({ id: doc.id, ...data });
        });
        
        calculateDashboardStats(allCustomers);
        
        const activeMainTab = el.mainListTabs.querySelector('.main-list-tab.active');
        const activePill = el.filterPillsContainer.querySelector('.filter-pill.active');

        if (activeMainTab && activeMainTab.dataset.mainFilter === 'Completed') {
            currentFilter = 'Completed';
            currentCompletedFilter = el.completedFilterSelect.value;
        } else if (activeMainTab && activeMainTab.dataset.mainFilter === 'Archived') { // NEW
            currentFilter = 'Archived';
            currentCompletedFilter = el.completedFilterSelect.value;
        } else {
            currentFilter = activePill ? activePill.dataset.filter : 'All';
            currentCompletedFilter = 'All';
        }
        
        displayCustomers();
        
        if (selectedCustomerId) {
            const freshData = allCustomers.find(c => c.id === selectedCustomerId);
            if (freshData) {
                // Re-populate form but maintain current view
                const currentStatus = el.detailsForm.dataset.currentStatus; // Get the "real" status
                populateDetailsForm(freshData); // This resets the form
                updateStepperUI(currentStatus); // Re-apply the "real" status to the stepper
                
                // Re-select the correct page if it was changed
                const activeStep = el.statusStepper.querySelector('.step.active');
                if (activeStep) {
                    showDetailsPage(activeStep.dataset.page);
                }
            } else {
                handleDeselectCustomer(false); // Pass false to skip auto-save
            }
        }
        
        // --- NEW: Check for customerId from URL ---
        const urlParams = new URLSearchParams(window.location.search);
        const customerIdFromUrl = urlParams.get('customerId');
        if (customerIdFromUrl) {
            const customerToSelect = allCustomers.find(c => c.id === customerIdFromUrl);
            const customerItem = document.querySelector(`.customer-item[data-id="${customerIdFromUrl}"]`);
            
            if (customerToSelect && customerItem) {
                handleSelectCustomer(customerToSelect.id, customerItem);
                // Scroll to the item in the list
                customerItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            // Clean up the URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        // --- END NEW ---

    }, (error) => {
        console.error("Error loading customers: ", error);
        el.listLoading.textContent = 'Error loading customers.';
        showToast('Error loading customers.', 'error');
    });
};

const displayCustomers = () => {
    const searchTerm = el.searchBar.value.toLowerCase();
    
    let filteredCustomers = [...allCustomers];
    let isCompletedList = (currentFilter === 'Completed');
    let isArchivedList = (currentFilter === 'Archived'); // NEW

    if (isCompletedList) {
        filteredCustomers = filteredCustomers.filter(c => c.status === 'Completed');
        
        if (currentCompletedFilter !== 'All') {
            filteredCustomers = filteredCustomers.filter(c => 
                (c.installDetails?.installDate || '').startsWith(currentCompletedFilter)
            );
        }

    } else if (isArchivedList) { // NEW
        filteredCustomers = filteredCustomers.filter(c => c.status === 'Archived');
        
        if (currentCompletedFilter !== 'All') {
            filteredCustomers = filteredCustomers.filter(c => 
                (c.installDetails?.installDate || '').startsWith(currentCompletedFilter)
            );
        }
    
    } else if (currentFilter !== 'All') {
        filteredCustomers = filteredCustomers.filter(c => c.status === currentFilter);
        
    } else { // "All" Active
        filteredCustomers = filteredCustomers.filter(c => c.status !== 'Completed' && c.status !== 'Archived');
    }

    if (searchTerm) {
        filteredCustomers = filteredCustomers.filter(c => 
            (c.customerName || '').toLowerCase().includes(searchTerm) || 
            (c.address || '').toLowerCase().includes(searchTerm)
        );
    }

    // Sort Completed and Archived lists the same way (by date)
    if (isCompletedList || isArchivedList) {
        filteredCustomers.sort((a, b) => {
            const dateA = a.installDetails?.installDate || '0000-00-00';
            const dateB = b.installDetails?.installDate || '0000-00-00';
            return dateB.localeCompare(dateA); 
        });
    } else if (currentSort === 'name') {
        filteredCustomers.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    } else if (currentSort === 'date') {
        filteredCustomers.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } else if (currentSort === 'date-oldest') { 
        filteredCustomers.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    }

    renderCustomerList(filteredCustomers, searchTerm);
};

const renderCustomerList = (customersToRender, searchTerm = '') => {
    el.customerListContainer.innerHTML = '';
    el.customerListContainer.appendChild(el.listLoading); 

    let totalCount = customersToRender.length;
    let countMessage = '';

    const filterText = el.completedFilterSelect.options[el.completedFilterSelect.selectedIndex].text;

    if (currentFilter === 'Completed') {
        countMessage = `Found ${totalCount} completed order(s) for: ${filterText}`;
        el.completedFilterResults.textContent = countMessage;
        el.completedFilterResults.classList.remove('hidden');
    } else if (currentFilter === 'Archived') {
        countMessage = `Found ${totalCount} archived order(s) for: ${filterText}`;
        el.completedFilterResults.textContent = countMessage;
        el.completedFilterResults.classList.remove('hidden');
    } else {
        el.completedFilterResults.classList.add('hidden');
    }

    if (customersToRender.length === 0) {
        if (searchTerm) {
            el.listLoading.textContent = `No customers found matching "${searchTerm}".`;
        } else if (currentFilter === 'Completed' && currentCompletedFilter !== 'All') {
             el.listLoading.textContent = `No completed orders found in this period.`;
        } else if (currentFilter === 'Archived' && currentCompletedFilter !== 'All') {
             el.listLoading.textContent = `No archived orders found in this period.`;
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
            // --- APOSTROPHE FIX ---
            const statusSlug = status.toLowerCase().replace(/'/g, '').replace(/ /g, '-');
            // NEW: Add archived case
            switch (statusSlug) {
                case 'new-order': return 'status-new-order';
                case 'site-survey-ready': return 'status-site-survey-ready';
                case 'torys-list': return 'status-torys-list';
                case 'nid-ready': return 'status-nid-ready';
                case 'install-ready': return 'status-install-ready';
                case 'completed': return 'status-completed';
                case 'on-hold': return 'status-on-hold';
                case 'archived': return 'status-archived';
                default: return 'status-default';
            }
        };

        let createdDate = ''; 
        if (customer.createdAt && customer.createdAt.seconds) {
            createdDate = new Date(customer.createdAt.seconds * 1000).toLocaleDateString();
        }
        
        const dateDisplay = ( (customer.status === 'Completed' || customer.status === 'Archived') && customer.installDetails?.installDate) 
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
};


// --- 4. CUSTOMER (CREATE) ---

const openAddCustomerModal = () => {
    el.addCustomerModal.classList.add('show');
    el.pdfStatusMsg.textContent = ''; 
    // Ensure selected file text is cleared on re-open
    el.selectedFileNameDisplay.textContent = '';
    el.processPdfBtn.disabled = true;

    // Use default JS icon logic if lucide fails
    try {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } catch(e) {
        console.warn("Lucide icons not available in modal.", e);
    }
};

const closeAddCustomerModal = () => {
    el.addCustomerModal.classList.remove('show');
    el.addForm.reset();
    el.pdfStatusMsg.textContent = ''; 
    el.selectedFileNameDisplay.textContent = '';
    el.processPdfBtn.disabled = true;
    el.pdfUploadInput.value = '';
};

const handleAddCustomer = async (e) => {
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
        generalNotes: "", // MOVED TO TOP LEVEL
        exemptFromStats: false, // NEW
        createdAt: serverTimestamp(), 
        preInstallChecklist: {
            welcomeEmailSent: false,
            addedToSiteSurvey: false,
            addedToFiberList: false,
            addedToRepairShoppr: false
        },
        torysListChecklist: { // NEW
            added: false
        },
        installReadyChecklist: { // NEW
            ready: false
        },
        installDetails: {
            installDate: "",
            eeroInfo: false, 
            nidLightReading: "",
            additionalEquipment: "",
            // generalNotes MOVED to top level
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
};


// --- 5. DETAILS PANEL (UPDATE / DELETE) ---
const handleSelectCustomer = async (customerId, customerItem) => {
    // --- LOGIC CHANGE: Auto-save previous customer *without* progressing ---
    if (selectedCustomerId && selectedCustomerId !== customerId) {
        await handleUpdateCustomer(null, true, false); // auto-save, do NOT progress
    }

    if (selectedCustomerId === customerId) {
        handleDeselectCustomer(true); // pass true to auto-save on deselect
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
            let data = docSnap.data();
            // --- DATA NORMALIZATION ---
            if (data.status === "Tory's List") {
                data.status = "Torys List";
            }
            // --- END NORMALIZATION ---
            
            populateDetailsForm(data);
            // --- LOGIC CHANGE: Set page AND "real" status ---
            const currentStatus = data.status || 'New Order';
            el.detailsForm.dataset.currentStatus = currentStatus; // Store the "real" status
            el.detailsForm.dataset.statusBeforeHold = data.statusBeforeHold || 'New Order';
            setPageForStatus(currentStatus);
            updateStepperUI(currentStatus); // Set stepper to "real" status
        } else {
            showToast('Could not find customer data.', 'error');
            handleDeselectCustomer(false); // Do not save, just deselect
        }
    } catch (error) {
        console.error("Error fetching document:", error);
        showToast('Error fetching customer details.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
        
        // Use default JS icon logic if lucide fails
        try {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        } catch(e) {
            console.warn("Lucide icons not available in details.", e);
        }
    }
};

const handleDeselectCustomer = async (autoSave = false) => {
    // --- LOGIC CHANGE: Auto-save previous customer *without* progressing ---
    if (autoSave && selectedCustomerId) {
        await handleUpdateCustomer(null, true, false); // auto-save, do NOT progress
    }

    selectedCustomerId = null;
    document.querySelectorAll('.customer-item').forEach(item => {
        item.classList.remove('selected');
    });
    el.detailsPlaceholder.style.display = 'block';
    el.detailsContainer.style.display = 'none';
    el.detailsContainer.dataset.id = '';
    el.detailsForm.dataset.currentStatus = ''; // Clear stored status
    el.detailsForm.dataset.statusBeforeHold = '';
    
    // Use default JS icon logic if lucide fails
    try {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } catch(e) {
        console.warn("Lucide icons not available in placeholder.", e);
    }
};

const populateDetailsForm = (data) => {
    // Hide completed-specific buttons by default
    el.completedActionsDiv.classList.add('hidden');

    el.detailsCustomerNameInput.value = data.customerName || ''; 
    el.detailsSoNumberInput.value = data.serviceOrderNumber || '';
    el.detailsAddressInput.value = data.address || '';
    el.detailsSpeedInput.value = data.serviceSpeed || '';
    el.detailsEmailInput.value = data.primaryContact?.email || '';
    el.detailsPhoneInput.value = data.primaryContact?.phone || '';
    
    // --- LOGIC CHANGE: This field no longer exists ---
    // el.detailsForm['details-status'].value = data.status || 'New Order';
    
    el.detailsForm['check-welcome-email'].checked = data.preInstallChecklist?.welcomeEmailSent || false;
    el.detailsForm['check-site-survey'].checked = data.preInstallChecklist?.addedToSiteSurvey || false;
    el.detailsForm['check-fiber-list'].checked = data.preInstallChecklist?.addedToFiberList || false;
    el.detailsForm['check-repair-shoppr'].checked = data.preInstallChecklist?.addedToRepairShoppr || false;
    
    el.detailsForm['site-survey-notes'].value = data.installDetails?.siteSurveyNotes || '';
    
    el.detailsForm['check-torys-list'].checked = data.torysListChecklist?.added || false; // NEW
    
    el.detailsForm['nid-light'].value = data.installDetails?.nidLightReading || '';

    el.detailsForm['check-install-ready'].checked = data.installReadyChecklist?.ready || false; // NEW
    
    el.detailsForm['install-date'].value = data.installDetails?.installDate || '';
    el.detailsForm['eero-info'].checked = data.installDetails?.eeroInfo || false; 
    // el.detailsForm['nid-light'].value = data.installDetails?.nidLightReading || ''; // This is a duplicate line
    el.detailsForm['extra-equip'].value = data.installDetails?.additionalEquipment || '';
    el.detailsGeneralNotes.value = data.generalNotes || ''; // UPDATED
    el.detailsForm['install-notes'].value = data.installDetails?.installNotes || ''; 
    
    el.detailsForm['check-exempt-from-stats'].checked = data.exemptFromStats || false; // NEW
    
    el.detailsForm['post-check-fiber'].checked = data.postInstallChecklist?.removedFromFiberList || false;
    el.detailsForm['post-check-survey'].checked = data.postInstallChecklist?.removedFromSiteSurvey || false;
    el.detailsForm['post-check-repair'].checked = data.postInstallChecklist?.updatedRepairShoppr || false;
    el.detailsForm['bill-info'].checked = data.postInstallChecklist?.emailSentToBilling || false;

    // --- LOGIC CHANGE: This is now handled by handleSelectCustomer ---
    // updateStepperUI(data.status || 'New Order');
};

const showDetailsPage = (pageId) => {
    el.detailsPages.forEach(page => page.classList.remove('active'));
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
};

const setPageForStatus = (status) => {
    // Archived customers are read-only and should show the 'Completed' page
    if (status === 'Archived') {
        showDetailsPage('page-install');
        return;
    }

    switch (status) {
        case 'Site Survey Ready':
            showDetailsPage('page-site-survey');
            break;
        case 'Torys List': // NEW (No apostrophe)
            showDetailsPage('page-torys-list');
            break;
        case 'NID Ready': 
            showDetailsPage('page-nid');
            break;
        case 'Install Ready': // NEW
            showDetailsPage('page-install-ready');
            break;
        case 'Completed': 
            showDetailsPage('page-install');
            break;
        case 'New Order':
        case 'On Hold':
        default:
            showDetailsPage('page-pre-install');
    }
};

const handleToggleOnHold = (e) => {
    e.preventDefault(); 
    // --- LOGIC CHANGE: Get status from dataset ---
    const currentStatus = el.detailsForm.dataset.currentStatus;

    if (currentStatus === 'On Hold') {
        const statusToRestore = el.detailsForm.dataset.statusBeforeHold || 'New Order';
        el.detailsForm.dataset.currentStatus = statusToRestore; // Set "real" status
        updateStepperUI(statusToRestore);
        setPageForStatus(statusToRestore);
    } else {
        el.detailsForm.dataset.statusBeforeHold = currentStatus; // Store old status
        el.detailsForm.dataset.currentStatus = 'On Hold'; // Set "real" status
        updateStepperUI('On Hold');
        setPageForStatus('On Hold'); 
    }
    
    // Use default JS icon logic if lucide fails
    try {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } catch(e) {
        console.warn("Lucide icons not available in on-hold.", e);
    }
};

const updateStepperUI = (currentStatus) => {
    const allStepButtons = el.statusStepper.querySelectorAll('.step');

    // Hide all action buttons by default
    el.completedActionsDiv.classList.add('hidden');
    el.updateCustomerBtn.classList.add('hidden');
    el.saveAndProgressBtn.classList.add('hidden');
    el.onHoldButton.classList.add('hidden');
    el.deleteCustomerBtn.classList.add('hidden');
    el.headerSaveBtn.classList.add('hidden');
    el.headerSaveAndProgressBtn.classList.add('hidden');
    // NEW: also hide archive/unarchive buttons by default
    el.archiveCustomerBtn.classList.add('hidden');
    el.unarchiveCustomerBtn.classList.add('hidden');


    allStepButtons.forEach(btn => {
        btn.classList.remove('active', 'completed');
    });

    const onHoldBtnText = el.onHoldButton.querySelector('span');

    // If Archived, show read-only view
    if (currentStatus === 'Archived') {
        el.onHoldButton.classList.remove('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Toggle On Hold';
        el.statusStepper.classList.remove('is-on-hold');

        // Mark all steps as completed
        allStepButtons.forEach(btn => btn.classList.add('completed'));
        
        // MODIFICATION: Disable form fields but NOT stepper buttons
        // This allows navigation
        el.detailsForm.querySelectorAll('input, textarea, select').forEach(elem => {
            elem.disabled = true;
        });
        
        // Disable all action buttons, but NOT stepper buttons
        el.detailsForm.querySelectorAll('button').forEach(elem => {
            if (!elem.closest('#status-stepper') && !elem.closest('.header-button-group')) {
                elem.disabled = true;
            }
        });
        
        // Show "Unarchive" button
        el.completedActionsDiv.classList.remove('hidden'); // Show the container
        el.unarchiveCustomerBtn.classList.remove('hidden'); // Show UNarchive
        el.unarchiveCustomerBtn.disabled = false; // Explicitly enable it
        el.archiveCustomerBtn.classList.add('hidden');   // Hide archive

        return; // No other action buttons should be visible
    }

    // If not Archived, re-enable forms
    el.detailsForm.querySelectorAll('input, textarea, select, button').forEach(elem => {
        elem.disabled = false;
    });
    
    // Show standard action buttons
    el.updateCustomerBtn.classList.remove('hidden');
    el.saveAndProgressBtn.classList.remove('hidden');
    el.onHoldButton.classList.remove('hidden');
    el.deleteCustomerBtn.classList.remove('hidden');
    el.headerSaveBtn.classList.remove('hidden');
    el.headerSaveAndProgressBtn.classList.remove('hidden');


    if (currentStatus === 'On Hold') {
        el.onHoldButton.classList.add('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Status: On Hold';
        el.statusStepper.classList.add('is-on-hold'); 
        
    } else {
        el.onHoldButton.classList.remove('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Toggle On Hold';
        el.statusStepper.classList.remove('is-on-hold'); 

        const statusIndex = STEPS_WORKFLOW.indexOf(currentStatus);
        
        if (statusIndex !== -1) {
            for (let i = 0; i < allStepButtons.length; i++) {
                const stepButton = allStepButtons[i];
                if (stepButton.dataset.status === STEPS_WORKFLOW[i]) {
                    if (i < statusIndex) {
                        stepButton.classList.add('completed');
                    } else if (i === statusIndex) {
                        stepButton.classList.add('active');
                    }
                }
            }
        } else {
            // Default to first step if status is unknown
            const newOrderButton = el.statusStepper.querySelector('.step[data-status="New Order"]');
            if (newOrderButton) {
                newOrderButton.classList.add('active');
            }
        }
    }
    
    // Show completed actions only on the 'Completed' step
    if (currentStatus === 'Completed') {
        el.completedActionsDiv.classList.remove('hidden');
        el.archiveCustomerBtn.classList.remove('hidden'); // Show Archive
        el.unarchiveCustomerBtn.classList.add('hidden'); // Hide Unarchive
    }
};

const handleDetailsFormClick = (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return; 
    const targetId = copyBtn.dataset.target;
    if (!targetId) return;
    const targetElement = document.getElementById(targetId);
    if (!targetElement) return;
    const textToCopy = (targetElement.tagName === 'SPAN') ? targetElement.textContent : targetElement.value;
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
};

// MODIFIED: Added `progressStatus` parameter
const handleUpdateCustomer = async (e = null, isAutoSave = false, progressStatus = false) => {
    if (e) {
        e.preventDefault();
    }
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;

    // --- LOGIC CHANGE: Determine the status to save ---
    let statusToSave;
    let statusBeforeHoldToSave = el.detailsForm.dataset.statusBeforeHold || 'New Order';

    const currentSavedStatus = el.detailsForm.dataset.currentStatus;

    if (progressStatus) {
        // This was a "Save & Progress" click
        let statusToProgressFrom = currentSavedStatus;
        if (currentSavedStatus === 'On Hold') {
            statusToProgressFrom = statusBeforeHoldToSave;
        }
        
        const currentIndex = STEPS_WORKFLOW.indexOf(statusToProgressFrom);
        if (currentIndex !== -1 && currentIndex < STEPS_WORKFLOW.length - 1) {
            statusToSave = STEPS_WORKFLOW[currentIndex + 1]; // Progress to the next step
        } else {
            statusToSave = statusToProgressFrom; // Already at end, so just save
        }
    } else {
        // This was a "Save" or "Auto-save" click
        statusToSave = currentSavedStatus; // Keep the status as it was
    }
    
    // If we are saving "On Hold", we must also save the status from before.
    if (statusToSave === 'On Hold') {
        statusBeforeHoldToSave = el.detailsForm.dataset.statusBeforeHold;
    }
    // --- END LOGIC CHANGE ---

    const updatedData = {
        customerName: el.detailsCustomerNameInput.value,
        serviceOrderNumber: el.detailsSoNumberInput.value,
        address: el.detailsAddressInput.value,
        serviceSpeed: el.detailsSpeedInput.value,
        'primaryContact.email': el.detailsEmailInput.value,
        'primaryContact.phone': el.detailsPhoneInput.value,
        
        'status': statusToSave, // Use the determined status
        'statusBeforeHold': statusBeforeHoldToSave, // Save this just in case
        'generalNotes': el.detailsGeneralNotes.value, 
        'exemptFromStats': el.detailsForm['check-exempt-from-stats'].checked, 
        'preInstallChecklist.welcomeEmailSent': el.detailsForm['check-welcome-email'].checked,
        'preInstallChecklist.addedToSiteSurvey': el.detailsForm['check-site-survey'].checked,
        'preInstallChecklist.addedToFiberList': el.detailsForm['check-fiber-list'].checked,
        'preInstallChecklist.addedToRepairShoppr': el.detailsForm['check-repair-shoppr'].checked,
        'installDetails.siteSurveyNotes': el.detailsForm['site-survey-notes'].value,
        'torysListChecklist.added': el.detailsForm['check-torys-list'].checked, 
        'installDetails.nidLightReading': el.detailsForm['nid-light'].value, 
        'installReadyChecklist.ready': el.detailsForm['check-install-ready'].checked, 
        'installDetails.installDate': el.detailsForm['install-date'].value,
        'installDetails.eeroInfo': el.detailsForm['eero-info'].checked, 
        'installDetails.additionalEquipment': el.detailsForm['extra-equip'].value,
        'installDetails.installNotes': el.detailsForm['install-notes'].value, 
        'postInstallChecklist.removedFromFiberList': el.detailsForm['post-check-fiber'].checked,
        'postInstallChecklist.removedFromSiteSurvey': el.detailsForm['post-check-survey'].checked,
        'postInstallChecklist.updatedRepairShoppr': el.detailsForm['post-check-repair'].checked,
        'postInstallChecklist.emailSentToBilling': el.detailsForm['bill-info'].checked
    };

    try {
        if (!isAutoSave) {
            el.loadingOverlay.style.display = 'flex';
        }
        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, updatedData);
        
        // --- LOGIC CHANGE: Update UI after save ---
        if (progressStatus) {
            el.detailsForm.dataset.currentStatus = statusToSave;
            setPageForStatus(statusToSave);
            updateStepperUI(statusToSave);
            
            // Use default JS icon logic if lucide fails
            try {
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            } catch(e) { console.warn("Lucide icons not available.", e); }
        }
        
        if (!isAutoSave && !progressStatus) {
            showToast('Customer updated!', 'success');
        } else if (progressStatus) {
            showToast(`Saved & Progressed to "${statusToSave}"!`, 'success');
        }
        
    } catch (error) {
        console.error("Error updating customer: ", error);
        showToast('Error updating customer.', 'error');
    } finally {
        if (!isAutoSave) {
            el.loadingOverlay.style.display = 'none';
        }
    }
};

// NEW: Save and Progress Logic
const handleSaveAndProgress = async (e) => {
    e.preventDefault();
    await handleUpdateCustomer(e, false, true); // Manual save, *with* progressing
};

const handleDeleteCustomer = async (e) => {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    const customerName = el.detailsCustomerNameInput.value;
    
    // Use a custom modal for confirm, since window.confirm is blocked
    if (await showConfirmModal(`Are you sure you want to delete customer ${customerName}? This cannot be undone.`)) {
        try {
            el.loadingOverlay.style.display = 'flex';
            const docRef = doc(customersCollectionRef, customerId);
            await deleteDoc(docRef);
            showToast('Customer deleted.', 'success');
            handleDeselectCustomer(false); // Do not auto-save, just clear
        } catch (error) {
            console.error("Error deleting customer: ", error);
            showToast('Error deleting customer.', 'error');
        } finally {
            el.loadingOverlay.style.display = 'none';
        }
    }
};

// --- NEW: Archive Customer Function ---
const handleArchiveCustomer = async (e) => {
    e.preventDefault();
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    const customerName = el.detailsCustomerNameInput.value;

    if (await showConfirmModal(`Are you sure you want to archive ${customerName}? This will move them from the 'Completed' list to the 'Archived' list.`)) {
        try {
            el.loadingOverlay.style.display = 'flex';
            const docRef = doc(customersCollectionRef, customerId);
            await updateDoc(docRef, { status: "Archived" });
            showToast('Customer archived.', 'success');
            handleDeselectCustomer(false); // Clear panel
        } catch (error) {
            console.error("Error archiving customer: ", error);
            showToast('Error archiving customer.', 'error');
        } finally {
            el.loadingOverlay.style.display = 'none';
        }
    }
};

const handleUnarchiveCustomer = async (e) => {
    e.preventDefault();
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    const customerName = el.detailsCustomerNameInput.value;

    if (await showConfirmModal(`Are you sure you want to unarchive ${customerName}? This will move them back to the 'Completed' list.`)) {
        try {
            el.loadingOverlay.style.display = 'flex';
            const docRef = doc(customersCollectionRef, customerId);
            // Set status back to "Completed"
            await updateDoc(docRef, { status: "Completed" });
            showToast('Customer unarchived.', 'success');
            
            // Manually update the UI to reflect the new "Completed" state
            el.detailsForm.dataset.currentStatus = "Completed";
            setPageForStatus("Completed");
            updateStepperUI("Completed");
            
        } catch (error) {
            console.error("Error unarchiving customer: ", error);
            showToast('Error unarchiving customer.', 'error');
        } finally {
            el.loadingOverlay.style.display = 'none';
        }
    }
};
// --- 6. ACTIONS ---
const handleSendWelcomeEmail = async (e) => {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !mailCollectionRef) return;
    const toEmail = el.detailsEmailInput.value;
    const customerName = el.detailsCustomerNameInput.value;
    
    if (!toEmail) {
        showToast('No customer email on file to send to.', 'error');
        return;
    }
    
    // Use a custom modal for confirm, since window.confirm is blocked
    if (!await showConfirmModal(`Send welcome email to ${customerName} at ${toEmail}?`)) {
        return;
    }
    
    el.loadingOverlay.style.display = 'flex';
    try {
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
};

const handleCopyBilling = async (e) => {
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
        const customerName = el.detailsCustomerNameInput.value;
        
        // --- START NEW BILLING FORMAT ---
        let formattedDate = 'N/A';
        const installDateStr = data.installDetails.installDate; // "YYYY-MM-DD"
        if (installDateStr) {
            // Using replace(/-/g, '/') ensures correct parsing in Safari/Firefox
            const date = new Date(installDateStr.replace(/-/g, '/')); 
            const month = String(date.getMonth() + 1); // GetMonth is 0-indexed
            const day = String(date.getDate());
            const year = date.getFullYear();
            formattedDate = `${month}/${day}/${year}`; // Format as M/D/YYYY
        }

        const billingText = `
${customerName} was officially turned up for service, below are the details:

Customer Name: ${customerName}
Address: ${data.address || 'N/A'}
Service Order: ${data.serviceOrderNumber || 'N/A'}
Date Installed: ${formattedDate}
Additional Equipment: ${data.installDetails.additionalEquipment || 'N/A'}

Thanks,
Lincoln
        `.trim().replace(/^\s+\n/gm, '\n');

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
};

// --- 7. UTILITIES ---

const showToast = (message, type = 'success') => {
    el.toast.textContent = message;
    el.toast.classList.remove('success', 'error');
    el.toast.classList.add(type === 'error' ? 'error' : 'success');
    el.toast.classList.add('show');
    setTimeout(() => el.toast.classList.remove('show'), 3000);
};

/**
 * --- NEW FUNCTION ---
 * Shows a custom confirmation modal, as window.confirm() is blocked.
 * @param {string} message - The message to display.
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if cancelled.
 */
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
        // Apply existing button styles from style.css
        cancelBtn.className = 'btn btn-secondary';
        
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Continue';
         // Apply existing button styles from style.css
        confirmBtn.className = 'btn btn-danger'; // Use danger for delete
        
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