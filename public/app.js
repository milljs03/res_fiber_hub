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
    
    // Buttons
    sendWelcomeEmailBtn: document.getElementById('send-welcome-email-btn'),
    headerSaveBtn: document.getElementById('header-save-btn'), 
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
        c.status === 'Completed' && c.installDetails?.installDate
    );

    const dateMap = new Map(); 
    completedCustomers.forEach(c => {
        const dateString = c.installDetails.installDate; 
        const date = new Date(dateString.replace(/-/g, '/')); 
        const monthYearKey = date.toLocaleString('en-US', { month: 'long', year: 'numeric' }); 
        const monthYearValue = dateString.substring(0, 7); 
        
        dateMap.set(monthYearValue, monthYearKey);
    });

    const sortedDates = Array.from(dateMap).map(([value, text]) => ({ value, text }));
    sortedDates.sort((a, b) => b.value.localeCompare(a.value));
    
    el.completedFilterSelect.innerHTML = '';
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
        el.dashboardToggleIcon.src = 'chevron_up.png';
    } else {
        el.dashboardContent.classList.add('active');
        el.dashboardToggleBtn.setAttribute('aria-expanded', 'true');
        el.dashboardToggleIcon.src = 'chevron_down.png';
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
    handleDeselectCustomer();
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
            
            currentFilter = 'Completed'; 
            currentCompletedFilter = el.completedFilterSelect.value;
            el.customerListContainer.classList.add('completed-view');
            
        } else { 
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
    el.headerSaveBtn.addEventListener('click', (e) => handleUpdateCustomer(e));
    el.updateCustomerBtn.addEventListener('click', (e) => handleUpdateCustomer(e));
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

        el.detailsForm['details-status'].value = newStatus;

        updateStepperUI(newStatus);
        showDetailsPage(pageId);
        
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
        'Site Survey': 0,
        'NID': 0,
        'On Hold': 0,
        'Completed': 0
    };
    
    let totalInstallDays = 0;
    let completedCount = 0;
    const monthlyInstallTimes = {}; 
    const speedCounts = {}; 
    
    const ytdInstalls = {};
    const currentYear = new Date().getFullYear();

    customers.forEach(c => {
        if (statusCounts.hasOwnProperty(c.status)) {
            statusCounts[c.status]++;
        }
        
        const speed = c.serviceSpeed || 'Unknown';
        speedCounts[speed] = (speedCounts[speed] || 0) + 1;

        if (c.status === 'Completed' && c.installDetails?.installDate && c.createdAt?.seconds) {
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

    const totalActive = statusCounts['New Order'] + statusCounts['Site Survey'] + statusCounts['NID'] + statusCounts['On Hold'];
    const totalCompleted = statusCounts['Completed'];
    
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
    const activeStatuses = ['New Order', 'Site Survey', 'NID', 'On Hold'];
    
    activeStatuses.sort((a, b) => {
        const order = { 'New Order': 1, 'Site Survey': 2, 'NID': 3, 'On Hold': 4 };
        return order[a] - order[b];
    });

    if (totalActive > 0) {
        const pillsHtml = activeStatuses.map(status => {
            if (statusCounts[status] > 0) {
                const statusSlug = status.toLowerCase().replace(/ /g, '-');
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
            <div class="stat-main-value" style="color: #065f46;">${totalCompleted}</div>
            <p class="stat-breakdown">Total lifetime installs.</p>
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
            allCustomers.push({ id: doc.id, ...doc.data() });
        });
        
        calculateDashboardStats(allCustomers);
        
        const activeMainTab = el.mainListTabs.querySelector('.main-list-tab.active');
        const activePill = el.filterPillsContainer.querySelector('.filter-pill.active');

        if (activeMainTab && activeMainTab.dataset.mainFilter === 'Completed') {
            currentFilter = 'Completed';
            currentCompletedFilter = el.completedFilterSelect.value;
        } else {
            currentFilter = activePill ? activePill.dataset.filter : 'All';
            currentCompletedFilter = 'All';
        }
        
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
};

const displayCustomers = () => {
    const searchTerm = el.searchBar.value.toLowerCase();
    
    let filteredCustomers = [...allCustomers];
    let isCompletedList = (currentFilter === 'Completed');

    if (isCompletedList) {
        filteredCustomers = filteredCustomers.filter(c => c.status === 'Completed');
        
        if (currentCompletedFilter !== 'All') {
            filteredCustomers = filteredCustomers.filter(c => 
                (c.installDetails?.installDate || '').startsWith(currentCompletedFilter)
            );
        }

    } else if (currentFilter !== 'All') {
        filteredCustomers = filteredCustomers.filter(c => c.status === currentFilter);
        
    } else {
        filteredCustomers = filteredCustomers.filter(c => c.status !== 'Completed');
    }

    if (searchTerm) {
        filteredCustomers = filteredCustomers.filter(c => 
            (c.customerName || '').toLowerCase().includes(searchTerm) || 
            (c.address || '').toLowerCase().includes(searchTerm)
        );
    }

    if (isCompletedList) {
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
};


// --- 4. CUSTOMER (CREATE) ---

const openAddCustomerModal = () => {
    el.addCustomerModal.classList.add('show');
    el.pdfStatusMsg.textContent = ''; 
    // Ensure selected file text is cleared on re-open
    el.selectedFileNameDisplay.textContent = '';
    el.processPdfBtn.disabled = true;

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
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
};


// --- 5. DETAILS PANEL (UPDATE / DELETE) ---
const handleSelectCustomer = async (customerId, customerItem) => {
    if (selectedCustomerId && selectedCustomerId !== customerId) {
        await handleUpdateCustomer(null, true);
    }

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
};

const handleDeselectCustomer = async () => {
    if (selectedCustomerId) {
        await handleUpdateCustomer(null, true);
    }

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
};

const populateDetailsForm = (data) => {
    el.detailsCustomerNameInput.value = data.customerName || ''; 
    el.detailsSoNumberInput.value = data.serviceOrderNumber || '';
    el.detailsAddressInput.value = data.address || '';
    el.detailsSpeedInput.value = data.serviceSpeed || '';
    el.detailsEmailInput.value = data.primaryContact?.email || '';
    el.detailsPhoneInput.value = data.primaryContact?.phone || '';
    
    el.detailsForm['details-status'].value = data.status || 'New Order';
    
    el.detailsForm['check-welcome-email'].checked = data.preInstallChecklist?.welcomeEmailSent || false;
    el.detailsForm['check-site-survey'].checked = data.preInstallChecklist?.addedToSiteSurvey || false;
    el.detailsForm['check-fiber-list'].checked = data.preInstallChecklist?.addedToFiberList || false;
    el.detailsForm['check-repair-shoppr'].checked = data.preInstallChecklist?.addedToRepairShoppr || false;
    
    el.detailsForm['site-survey-notes'].value = data.installDetails?.siteSurveyNotes || '';
    
    el.detailsForm['install-date'].value = data.installDetails?.installDate || '';
    el.detailsForm['eero-info'].checked = data.installDetails?.eeroInfo || false; 
    el.detailsForm['nid-light'].value = data.installDetails?.nidLightReading || '';
    el.detailsForm['extra-equip'].value = data.installDetails?.additionalEquipment || '';
    el.detailsForm['general-notes'].value = data.installDetails?.generalNotes || '';
    el.detailsForm['install-notes'].value = data.installDetails?.installNotes || ''; 
    
    el.detailsForm['post-check-fiber'].checked = data.postInstallChecklist?.removedFromFiberList || false;
    el.detailsForm['post-check-survey'].checked = data.postInstallChecklist?.removedFromSiteSurvey || false;
    el.detailsForm['post-check-repair'].checked = data.postInstallChecklist?.updatedRepairShoppr || false;

    updateStepperUI(data.status || 'New Order');
};

const showDetailsPage = (pageId) => {
    el.detailsPages.forEach(page => page.classList.remove('active'));
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
};

const setPageForStatus = (status) => {
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
};

const handleToggleOnHold = (e) => {
    e.preventDefault(); 
    const currentStatus = el.detailsForm['details-status'].value;

    if (currentStatus === 'On Hold') {
        const statusToRestore = el.detailsForm.dataset.statusBeforeHold || 'New Order';
        el.detailsForm['details-status'].value = statusToRestore;
        updateStepperUI(statusToRestore);
        setPageForStatus(statusToRestore);
    } else {
        el.detailsForm.dataset.statusBeforeHold = currentStatus;
        el.detailsForm['details-status'].value = 'On Hold';
        updateStepperUI('On Hold');
        setPageForStatus('On Hold'); 
    }
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
};

const updateStepperUI = (currentStatus) => {
    const steps = ['New Order', 'Site Survey', 'NID', 'Completed']; 
    const allStepButtons = el.statusStepper.querySelectorAll('.step');

    allStepButtons.forEach(btn => {
        btn.classList.remove('active', 'completed');
    });

    const onHoldBtnText = el.onHoldButton.querySelector('span');

    if (currentStatus === 'On Hold') {
        el.onHoldButton.classList.add('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Status: On Hold';
        el.statusStepper.classList.add('is-on-hold'); 
        
    } else {
        el.onHoldButton.classList.remove('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Toggle On Hold';
        el.statusStepper.classList.remove('is-on-hold'); 

        const statusIndex = steps.indexOf(currentStatus);
        if (statusIndex !== -1) {
            for (let i = 0; i < allStepButtons.length; i++) {
                const stepButton = allStepButtons[i];
                if (stepButton.dataset.status === steps[i]) {
                    if (i < statusIndex) {
                        stepButton.classList.add('completed');
                    } else if (i === statusIndex) {
                        stepButton.classList.add('active');
                    }
                }
            }
        } else {
            const newOrderButton = el.statusStepper.querySelector('.step[data-status="New Order"]');
            if (newOrderButton) {
                newOrderButton.classList.add('active');
            }
        }
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

const handleUpdateCustomer = async (e = null, isAutoSave = false) => {
    if (e) {
        e.preventDefault();
    }
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;

    const updatedData = {
        customerName: el.detailsCustomerNameInput.value,
        serviceOrderNumber: el.detailsSoNumberInput.value,
        address: el.detailsAddressInput.value,
        serviceSpeed: el.detailsSpeedInput.value,
        'primaryContact.email': el.detailsEmailInput.value,
        'primaryContact.phone': el.detailsPhoneInput.value,
        
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
        
        if (!isAutoSave) {
            showToast('Customer updated!', 'success');
        }
    } catch (error) {
        console.error("Error updating customer: ", error);
        showToast('Error updating customer.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
};

const handleDeleteCustomer = async (e) => {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    const customerName = el.detailsCustomerNameInput.value;
    
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
    if (!confirm(`Send welcome email to ${customerName} at ${toEmail}?`)) {
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
        
        const billingText = `
Customer Name: ${customerName}
Address: ${data.address || 'N/A'}
Service Order: ${data.serviceOrderNumber || 'N/A'}
Date Installed: ${data.installDetails.installDate || 'N/A'}
Additional Equipment: ${data.installDetails.additionalEquipment || 'N/A'}
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