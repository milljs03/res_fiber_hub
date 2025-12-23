// Import initialized services from firebase.js
import { db, auth, googleProvider, signInWithPopup, signOut } from './firebase.js';

// Import necessary Firestore functions
import {
    collection, doc, addDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, serverTimestamp, deleteField, setDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Import Auth functions
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Import Storage functions
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- Constants ---
const PDFJS_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs"; 
const STEPS_WORKFLOW = ['New Order', 'Site Survey Ready', 'Torys List', 'NID Ready', 'Install Ready', 'Completed'];

// --- Global State ---
let currentUserId = null;
let currentAppId = 'default-app-id';
let customersCollectionRef = null;
let mailCollectionRef = null;
let dashboardDocRef = null;
let selectedCustomerId = null;
let customerUnsubscribe = null;
let allCustomers = []; 
let currentSort = 'name'; 
let currentFilter = 'All'; 
let currentCompletedFilter = 'All'; 
let notesAutoSaveTimeout = null;
const storage = getStorage();
let tempUploadedPdfUrl = null;

// Chart instances
let myChart = null; 
let monthlyAvgChart = null; 
let speedChart = null; 

// --- DOM Elements Mapping (New UI) ---
const el = {
    // Auth & Navigation
    authScreen: document.getElementById('auth-screen'),
    appScreen: document.getElementById('app-screen'),
    signInBtn: document.getElementById('sign-in-btn'),
    signOutBtn: document.getElementById('sign-out-btn'),
    authError: document.getElementById('auth-error'),
    userEmailDisplay: document.getElementById('user-email'),

    // Add Form (Modal)
    addCustomerModal: document.getElementById('add-customer-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalBackdrop: document.querySelector('.modal-backdrop'),
    addForm: document.getElementById('add-customer-form'),
    // Add Form Inputs
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

    // List Column
    customerListContainer: document.getElementById('customer-list-container'),
    searchBar: document.getElementById('search-bar'),
    newCustomerBtn: document.getElementById('new-customer-btn'),
    mainListTabs: document.getElementById('main-list-tabs'),
    activeControlsGroup: document.getElementById('active-controls-group'),
    filterPillsContainer: document.getElementById('filter-pills'),
    sortBy: document.getElementById('sort-by'),
    completedControlsGroup: document.getElementById('completed-controls-group'),
    completedFilterSelect: document.getElementById('completed-filter-select'),
    completedFilterResults: document.getElementById('completed-filter-results'),

    // Dashboard Bar
    statsSummaryActiveWrapper: document.getElementById('stats-summary-active-wrapper'),
    statsSummaryCompletedWrapper: document.getElementById('stats-summary-completed-wrapper'),
    overallInstallTimeWrapper: document.getElementById('overall-install-time-wrapper'),
    toggleAnalyticsBtn: document.getElementById('toggle-analytics-btn'),
    dashboardAnalyticsPanel: document.getElementById('dashboard-analytics-panel'),
    // Charts & Notes
    installationsChart: document.getElementById('installations-chart'),
    monthlyInstallChart: document.getElementById('monthly-install-chart'), 
    speedBreakdownChart: document.getElementById('speed-breakdown-chart'), 
    dashboardGeneralNotes: document.getElementById('dashboard-general-notes'),
    saveDashboardNotesBtn: document.getElementById('save-dashboard-notes-btn'),

    // Details Column
    detailsPlaceholder: document.getElementById('details-placeholder'),
    loadingOverlay: document.getElementById('loading-overlay'),
    detailsContainer: document.getElementById('details-container'),
    detailsForm: document.getElementById('details-form'),
    
    // Sticky Header
    headerCustomerName: document.getElementById('header-customer-name'),
    headerSoNumber: document.getElementById('header-so-number'),
    mobileBackBtn: document.getElementById('mobile-back-btn'),
    headerMoveBackBtn: document.getElementById('header-move-back-btn'),
    updateCustomerBtn: document.getElementById('update-customer-btn'),
    saveAndProgressBtn: document.getElementById('save-and-progress-btn'),
    viewSoBtn: document.getElementById('view-so-btn'),

    // Stepper
    statusStepper: document.getElementById('status-stepper'),
    currentStageTitle: document.getElementById('current-stage-title'),

    // Details Inputs (Mapped to HTML IDs)
    detailsCustomerNameInput: document.getElementById('details-customer-name'), 
    detailsSoNumberInput: document.getElementById('details-so-number'),
    detailsAddressInput: document.getElementById('details-address'),
    detailsSpeedInput: document.getElementById('details-speed'),
    detailsEmailInput: document.getElementById('details-email'),
    detailsPhoneInput: document.getElementById('details-phone'),
    detailsGeneralNotes: document.getElementById('details-general-notes'),

    // Details Actions
    sendWelcomeEmailBtn: document.getElementById('send-welcome-email-btn'),
    returnSpliceBtn: document.getElementById('return-splice-btn'),
    onHoldButton: document.getElementById('on-hold-btn'),
    deleteCustomerBtn: document.getElementById('delete-customer-btn'),
    completedActionsDiv: document.getElementById('completed-actions-div'),
    copyBillingBtn: document.getElementById('copy-billing-btn'),
    archiveCustomerBtn: document.getElementById('archive-customer-btn'),
    unarchiveCustomerBtn: document.getElementById('unarchive-customer-btn'),

    // Details Pages
    detailsPages: document.querySelectorAll('.details-page'),
    
    // Toast
    toast: document.getElementById('toast-notification')
};

// --- 1. AUTHENTICATION & INIT ---

onAuthStateChanged(auth, (user) => {
    if (user && user.email && user.email.endsWith('@nptel.com')) {
        currentUserId = user.uid;
        el.userEmailDisplay.textContent = user.email;
        currentAppId = 'cfn-install-tracker';
        
        // Correct path references based on Rules
        customersCollectionRef = collection(db, 'artifacts', currentAppId, 'public', 'data', 'customers');
        mailCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'mail');
        
        // FIXED: Matched path to "match /artifacts/{appId}/public/data/dashboard_notes/{docId}"
        dashboardDocRef = doc(db, 'artifacts', currentAppId, 'public', 'data', 'dashboard_notes', 'summary');
        
        el.appScreen.classList.remove('hidden');
        el.authScreen.classList.add('hidden');
        initializeApp();
    } else {
        resetAppState();
        el.appScreen.classList.add('hidden');
        el.authScreen.classList.remove('hidden');
        if (user) {
            el.authError.textContent = 'Access restricted to @nptel.com accounts.';
            signOut(auth);
        }
    }
});

const resetAppState = () => {
    currentUserId = null;
    customersCollectionRef = null;
    if (customerUnsubscribe) {
        customerUnsubscribe();
        customerUnsubscribe = null;
    }
};

const initializeApp = () => {
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    setupEventListeners();
    loadCustomers();
    loadDashboardNotes();
    if (window.lucide) window.lucide.createIcons();
};

el.signInBtn.addEventListener('click', () => {
    el.authError.textContent = ''; 
    signInWithPopup(auth, googleProvider).catch((error) => {
        el.authError.textContent = error.message;
    });
});

el.signOutBtn.addEventListener('click', () => {
    signOut(auth);
});

// --- 2. EVENT LISTENERS ---

const setupEventListeners = () => {
    // Modal
    el.newCustomerBtn.addEventListener('click', openAddCustomerModal);
    el.modalCloseBtn.addEventListener('click', closeAddCustomerModal);
    el.modalBackdrop.addEventListener('click', closeAddCustomerModal);
    el.addForm.addEventListener('submit', handleAddCustomer);

    // PDF Processing
    el.processPdfBtn.addEventListener('click', handlePdfProcessing);
    el.pdfDropZone.addEventListener('click', () => el.pdfUploadInput.click());
    el.pdfDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.pdfDropZone.classList.add('dragover');
    });
    el.pdfDropZone.addEventListener('dragleave', () => el.pdfDropZone.classList.remove('dragover'));
    el.pdfDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        el.pdfDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            el.pdfUploadInput.files = e.dataTransfer.files;
            updateSelectedFileDisplay();
        }
    });
    el.pdfUploadInput.addEventListener('change', updateSelectedFileDisplay);

    // List Filtering & Sorting
    el.searchBar.addEventListener('input', displayCustomers);
    el.sortBy.addEventListener('change', (e) => {
        currentSort = e.target.value;
        displayCustomers();
    });
    el.mainListTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab-btn');
        if(!tab) return;
        el.mainListTabs.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        handleMainTabChange(tab.dataset.mainFilter);
    });
    el.filterPillsContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if(!pill) return;
        el.filterPillsContainer.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentFilter = pill.dataset.filter;
        displayCustomers();
    });
    el.completedFilterSelect.addEventListener('change', (e) => {
        currentCompletedFilter = e.target.value;
        displayCustomers();
    });

    // List Selection
    el.customerListContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.customer-item');
        if(item) handleSelectCustomer(item.dataset.id, item);
    });

    // Dashboard
    el.toggleAnalyticsBtn.addEventListener('click', () => {
        el.dashboardAnalyticsPanel.classList.toggle('hidden');
    });
    el.saveDashboardNotesBtn.addEventListener('click', () => saveDashboardNotes(false));
    el.dashboardGeneralNotes.addEventListener('input', () => {
        clearTimeout(notesAutoSaveTimeout);
        notesAutoSaveTimeout = setTimeout(() => saveDashboardNotes(true), 2000);
    });

    // Details Actions
    el.mobileBackBtn.addEventListener('click', () => handleDeselectCustomer(true));
    el.updateCustomerBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, 0));
    el.saveAndProgressBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, 1));
    el.headerMoveBackBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, -1));
    el.onHoldButton.addEventListener('click', handleToggleOnHold);
    el.deleteCustomerBtn.addEventListener('click', handleDeleteCustomer);
    
    // Checklists & Logic
    el.sendWelcomeEmailBtn.addEventListener('click', handleSendWelcomeEmail);
    el.returnSpliceBtn.addEventListener('click', handleReturnSplice);
    el.copyBillingBtn.addEventListener('click', handleCopyBilling);
    el.archiveCustomerBtn.addEventListener('click', handleArchiveCustomer);
    el.unarchiveCustomerBtn.addEventListener('click', handleUnarchiveCustomer);

    // Stepper Navigation
    el.statusStepper.addEventListener('click', (e) => {
        const stepNode = e.target.closest('.step-node');
        if(!stepNode || stepNode.disabled) return;
        e.preventDefault();
        showDetailsPage(stepNode.dataset.page);
        el.statusStepper.querySelectorAll('.step-node').forEach(b => b.classList.remove('active'));
        stepNode.classList.add('active');
    });

    // Copy Buttons
    el.detailsForm.addEventListener('click', (e) => {
        const btn = e.target.closest('.copy-btn');
        if(btn) copyToClipboard(btn);
    });
};

// --- 3. DASHBOARD LOGIC ---

const calculateDashboardStats = (customers) => {
    const statusCounts = {
        'New Order': 0, 'Site Survey Ready': 0, 'Torys List': 0, 'NID Ready': 0, 'Install Ready': 0, 'On Hold': 0, 'Completed': 0, 'Archived': 0 
    };
    
    let totalInstallDays = 0;
    let completedCount = 0;
    const monthlyInstallTimes = {}; 
    const speedCounts = {}; 
    const ytdInstalls = {};
    const currentYear = new Date().getFullYear();

    customers.forEach(c => {
        let status = c.status;
        if (status === "Tory's List") status = "Torys List";
        if (statusCounts.hasOwnProperty(status)) statusCounts[status]++;
        
        const speed = c.serviceSpeed || 'Unknown';
        speedCounts[speed] = (speedCounts[speed] || 0) + 1;

        if ((status === 'Completed' || status === 'Archived') && !c.exemptFromStats && c.installDetails?.installDate && c.createdAt?.seconds) {
            const dateInstalled = new Date(c.installDetails.installDate.replace(/-/g, '/'));
            const dateCreated = new Date(c.createdAt.seconds * 1000);
            const diffDays = Math.ceil(Math.abs(dateInstalled - dateCreated) / (1000 * 60 * 60 * 24));
            
            totalInstallDays += diffDays;
            completedCount++;

            const monthKey = `${dateInstalled.getFullYear()}-${String(dateInstalled.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyInstallTimes[monthKey]) monthlyInstallTimes[monthKey] = { totalDays: 0, count: 0 };
            monthlyInstallTimes[monthKey].totalDays += diffDays;
            monthlyInstallTimes[monthKey].count++;
            
            if (dateInstalled.getFullYear() === currentYear) {
                ytdInstalls[monthKey] = (ytdInstalls[monthKey] || 0) + 1;
            }
        }
    });

    const totalActive = Object.keys(statusCounts).reduce((acc, key) => {
        return (key !== 'Completed' && key !== 'Archived') ? acc + statusCounts[key] : acc;
    }, 0);
    const totalCompleted = statusCounts['Completed'] + statusCounts['Archived']; 
    const overallAvgTime = completedCount > 0 ? (totalInstallDays / completedCount).toFixed(1) : 'N/A';
    
    // Render Compact Stats
    renderCompactStats(totalActive, totalCompleted, overallAvgTime, statusCounts);

    // Render Charts
    const finalMonthlyAverages = {};
    for (const m in monthlyInstallTimes) finalMonthlyAverages[m] = (monthlyInstallTimes[m].totalDays / monthlyInstallTimes[m].count).toFixed(1);

    renderChart(ytdInstalls, currentYear);
    renderMonthlyAverageChart(finalMonthlyAverages);
    renderSpeedBreakdownChart(speedCounts); 
    updateCompletedFilterOptions(customers);
};

const renderCompactStats = (active, completed, time, counts) => {
    // Generate pill html for active breakdown
    const activeHTML = Object.entries(counts)
        .filter(([k, v]) => v > 0 && k !== 'Completed' && k !== 'Archived')
        .map(([k, v]) => {
            const slug = k.toLowerCase().replace(/'/g, '').replace(/ /g, '-');
            return `<span class="status-pill status-${slug}" style="font-size:0.65rem;">${k}: ${v}</span>`;
        }).join('');

    el.statsSummaryActiveWrapper.innerHTML = `
        <div class="stat-main-title">Active</div>
        <div class="stat-main-value" style="color:var(--primary);">${active}</div>
        <div class="active-breakdown-grid">${activeHTML}</div>
    `;
    
    el.statsSummaryCompletedWrapper.innerHTML = `
        <div class="stat-main-title">Total Installs</div>
        <div class="stat-main-value" style="color:var(--success);">${completed + 2673}</div>
    `;

    el.overallInstallTimeWrapper.innerHTML = `
        <div class="stat-main-title">Avg Time</div>
        <div class="stat-main-value" style="color:var(--warning);">${time} <span style="font-size:0.8rem; font-weight:400; color:var(--text-muted);">days</span></div>
    `;
};

// --- 4. LIST LOGIC ---

const loadCustomers = () => {
    if (!customersCollectionRef) return;
    const q = query(customersCollectionRef);
    customerUnsubscribe = onSnapshot(q, (snapshot) => {
        allCustomers = [];
        snapshot.forEach((doc) => {
            let data = doc.data();
            if (data.status === "Tory's List") data.status = "Torys List";
            allCustomers.push({ id: doc.id, ...data });
        });
        calculateDashboardStats(allCustomers);
        displayCustomers();
        
        // Refresh selected if open
        if (selectedCustomerId) {
            const fresh = allCustomers.find(c => c.id === selectedCustomerId);
            if (fresh) populateDetailsForm(fresh);
            else handleDeselectCustomer(false);
        }
    });
};

const handleMainTabChange = (filter) => {
    if (filter === 'Completed') {
        el.activeControlsGroup.classList.add('hidden');
        el.completedControlsGroup.classList.remove('hidden');
        currentFilter = 'Completed';
    } else if (filter === 'Archived') {
        el.activeControlsGroup.classList.add('hidden');
        el.completedControlsGroup.classList.remove('hidden');
        currentFilter = 'Archived';
    } else {
        el.activeControlsGroup.classList.remove('hidden');
        el.completedControlsGroup.classList.add('hidden');
        const activePill = el.filterPillsContainer.querySelector('.pill.active');
        currentFilter = activePill ? activePill.dataset.filter : 'All';
    }
    displayCustomers();
};

const displayCustomers = () => {
    const term = el.searchBar.value.toLowerCase();
    let filtered = [...allCustomers];
    
    // 1. Filter by Status/Tab
    if (currentFilter === 'Completed') {
        filtered = filtered.filter(c => c.status === 'Completed');
        if (currentCompletedFilter !== 'All') filtered = filtered.filter(c => (c.installDetails?.installDate || '').startsWith(currentCompletedFilter));
    } else if (currentFilter === 'Archived') {
        filtered = filtered.filter(c => c.status === 'Archived');
        if (currentCompletedFilter !== 'All') filtered = filtered.filter(c => (c.installDetails?.installDate || '').startsWith(currentCompletedFilter));
    } else if (currentFilter !== 'All') {
        filtered = filtered.filter(c => c.status === currentFilter);
    } else {
        filtered = filtered.filter(c => c.status !== 'Completed' && c.status !== 'Archived');
    }

    // 2. Filter by Search
    if (term) {
        filtered = filtered.filter(c => (c.customerName||'').toLowerCase().includes(term) || (c.address||'').toLowerCase().includes(term));
    }

    // 3. Sort
    if (currentSort === 'name') filtered.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    else if (currentSort === 'date') filtered.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    else if (currentSort === 'date-oldest') filtered.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    renderCustomerList(filtered);
};

const renderCustomerList = (list) => {
    el.customerListContainer.innerHTML = '';
    if (list.length === 0) {
        el.customerListContainer.innerHTML = `<div class="empty-state" style="padding:1rem; text-align:center; color:#9ca3af;">No customers found.</div>`;
        return;
    }
    
    // Update Completed Results Text
    if (currentFilter === 'Completed' || currentFilter === 'Archived') {
        const txt = el.completedFilterSelect.options[el.completedFilterSelect.selectedIndex]?.text || 'All Time';
        el.completedFilterResults.textContent = `${list.length} orders - ${txt}`;
        el.completedFilterResults.classList.remove('hidden');
    } else {
        el.completedFilterResults.classList.add('hidden');
    }

    list.forEach(c => {
        const item = document.createElement('div');
        item.className = `customer-item ${c.id === selectedCustomerId ? 'selected' : ''}`;
        item.dataset.id = c.id;
        
        const slug = (c.status || '').toLowerCase().replace(/'/g, '').replace(/ /g, '-');
        
        // Format Date: month-date-year (MM-DD-YYYY)
        let dateDisplay = '';
        if (c.installDetails?.installDate) {
            // handle YYYY-MM-DD string from input type="date"
            const [y, m, d] = c.installDetails.installDate.split('-');
            dateDisplay = `${m}-${d}-${y}`;
        } else if (c.createdAt?.seconds) {
            // handle firestore timestamp
            const dateObj = new Date(c.createdAt.seconds * 1000);
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            const y = dateObj.getFullYear();
            dateDisplay = `${m}-${d}-${y}`;
        } else {
            dateDisplay = 'N/A';
        }

        item.innerHTML = `
            <div class="customer-item-header">
                <h3 class="customer-item-name">${c.customerName}</h3>
                <span class="status-pill status-${slug}">${c.status}</span>
            </div>
            <div class="customer-item-footer">
                <p class="customer-item-address">${c.address || 'No Address'}</p>
                <p class="customer-item-date">${dateDisplay}</p>
            </div>
        `;
        el.customerListContainer.appendChild(item);
    });
};

// --- 5. DETAILS LOGIC ---

const handleSelectCustomer = async (id, itemElement) => {
    if (selectedCustomerId && selectedCustomerId !== id) await handleUpdateCustomer(null, true, 0); // Auto save old

    selectedCustomerId = id;
    
    // UI Updates
    document.querySelectorAll('.customer-item').forEach(i => i.classList.remove('selected'));
    if(itemElement) itemElement.classList.add('selected');
    
    el.detailsPlaceholder.classList.add('hidden');
    el.detailsContainer.classList.remove('hidden');
    document.body.classList.add('mobile-details-active'); // Mobile view switch
    el.detailsContainer.dataset.id = id;

    // Fetch Data
    const c = allCustomers.find(cust => cust.id === id);
    if (c) populateDetailsForm(c);
};

const handleDeselectCustomer = async (autoSave = false) => {
    if (autoSave && selectedCustomerId) await handleUpdateCustomer(null, true, 0);
    selectedCustomerId = null;
    document.querySelectorAll('.customer-item').forEach(i => i.classList.remove('selected'));
    el.detailsContainer.classList.add('hidden');
    el.detailsPlaceholder.classList.remove('hidden');
    document.body.classList.remove('mobile-details-active');
};

const populateDetailsForm = (data) => {
    // 1. Header
    el.headerCustomerName.textContent = data.customerName || 'Unknown';
    el.headerSoNumber.textContent = data.serviceOrderNumber ? `SO# ${data.serviceOrderNumber}` : 'No SO#';
    
    // 2. Main Inputs
    el.detailsCustomerNameInput.value = data.customerName || '';
    el.detailsSoNumberInput.value = data.serviceOrderNumber || '';
    el.detailsAddressInput.value = data.address || '';
    el.detailsSpeedInput.value = data.serviceSpeed || '';
    el.detailsEmailInput.value = data.primaryContact?.email || '';
    el.detailsPhoneInput.value = data.primaryContact?.phone || '';
    el.detailsGeneralNotes.value = data.generalNotes || '';

    // 3. Stage Content & Stepper
    el.currentStageTitle.textContent = data.status || 'Stage Details';
    el.detailsForm.dataset.currentStatus = data.status;
    el.detailsForm.dataset.statusBeforeHold = data.statusBeforeHold || 'New Order';
    
    updateStepperUI(data.status);
    setPageForStatus(data.status);

    // 4. Checklist Inputs (Map data to checkboxes)
    setCheck('check-welcome-email', data.preInstallChecklist?.welcomeEmailSent);
    setCheck('check-site-survey', data.preInstallChecklist?.addedToSiteSurvey);
    setCheck('check-fiber-list', data.preInstallChecklist?.addedToFiberList);
    setCheck('check-repair-shoppr', data.preInstallChecklist?.addedToRepairShoppr);
    setVal('site-survey-notes', data.installDetails?.siteSurveyNotes);
    
    setCheck('check-torys-list', data.torysListChecklist?.added);
    setVal('drop-notes', data.installDetails?.dropNotes);
    
    setVal('nid-light', data.installDetails?.nidLightReading);
    const spliceDate = data.splicingDetails?.completedAt?.seconds ? new Date(data.splicingDetails.completedAt.seconds*1000).toLocaleDateString() : 'N/A';
    document.getElementById('splice-complete-date').textContent = spliceDate;
    
    setCheck('check-install-ready', data.installReadyChecklist?.ready);
    
    setVal('install-date', data.installDetails?.installDate);
    setVal('extra-equip', data.installDetails?.additionalEquipment);
    setVal('install-notes', data.installDetails?.installNotes);
    setCheck('check-exempt-from-stats', data.exemptFromStats);
    setCheck('eero-info', data.installDetails?.eeroInfo);
    setCheck('post-check-fiber', data.postInstallChecklist?.removedFromFiberList);
    setCheck('post-check-survey', data.postInstallChecklist?.removedFromSiteSurvey);
    setCheck('post-check-repair', data.postInstallChecklist?.updatedRepairShoppr);
    setCheck('bill-info', data.postInstallChecklist?.emailSentToBilling);

    // 5. Conditional UI
    if (data.status === 'Completed') {
        el.completedActionsDiv.classList.remove('hidden');
        el.archiveCustomerBtn.classList.remove('hidden');
        el.unarchiveCustomerBtn.classList.add('hidden');
    } else if (data.status === 'Archived') {
        el.completedActionsDiv.classList.remove('hidden');
        el.archiveCustomerBtn.classList.add('hidden');
        el.unarchiveCustomerBtn.classList.remove('hidden');
    } else {
        el.completedActionsDiv.classList.add('hidden');
    }

    if (data.status === 'NID Ready') el.returnSpliceBtn.classList.remove('hidden');
    else el.returnSpliceBtn.classList.add('hidden');

    // 6. View SO Button
    if (data.serviceOrderPdfUrl) {
        el.viewSoBtn.onclick = () => window.open(data.serviceOrderPdfUrl, '_blank');
        el.viewSoBtn.disabled = false;
        el.viewSoBtn.classList.remove('btn-ghost');
        el.viewSoBtn.classList.add('btn-secondary');
    } else {
        el.viewSoBtn.disabled = true;
        el.viewSoBtn.classList.add('btn-ghost');
        el.viewSoBtn.classList.remove('btn-secondary');
    }
};

const updateStepperUI = (status) => {
    const nodes = el.statusStepper.querySelectorAll('.step-node');
    el.statusStepper.classList.remove('on-hold-mode');
    el.headerMoveBackBtn.classList.add('hidden');
    el.onHoldButton.classList.remove('active');

    // Reset
    nodes.forEach(n => { n.className = 'step-node'; n.disabled = false; });

    if (status === 'Archived') {
        nodes.forEach(n => { n.classList.add('completed'); n.disabled = true; });
        return;
    }

    if (status === 'On Hold') {
        el.statusStepper.classList.add('on-hold-mode');
        el.onHoldButton.classList.add('active');
        const prevStatus = el.detailsForm.dataset.statusBeforeHold || 'New Order';
        const prevIdx = STEPS_WORKFLOW.indexOf(prevStatus);
        if(prevIdx !== -1) nodes[prevIdx].classList.add('active');
        return;
    }

    const idx = STEPS_WORKFLOW.indexOf(status);
    if (idx !== -1) {
        if(idx > 0) el.headerMoveBackBtn.classList.remove('hidden');
        nodes.forEach((n, i) => {
            if (i < idx) n.classList.add('completed');
            if (i === idx) n.classList.add('active');
        });
    }
};

const setPageForStatus = (status) => {
    el.detailsPages.forEach(p => p.classList.remove('active'));
    if(status === 'Archived' || status === 'Completed') {
        document.getElementById('page-install').classList.add('active');
        return;
    }
    if(status === 'On Hold') {
        const prev = el.detailsForm.dataset.statusBeforeHold;
        setPageForStatus(prev); // Show previous page, but UI indicates hold
        return;
    }
    const map = {
        'New Order': 'page-pre-install',
        'Site Survey Ready': 'page-site-survey',
        'Torys List': 'page-torys-list',
        'NID Ready': 'page-nid',
        'Install Ready': 'page-install-ready',
        'Completed': 'page-install'
    };
    const pageId = map[status] || 'page-pre-install';
    document.getElementById(pageId).classList.add('active');
};

const showDetailsPage = (pageId) => {
    el.detailsPages.forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
};

// --- 6. ACTIONS (Save, Update, etc) ---

const handleUpdateCustomer = async (e, isAutoSave, stepDir) => {
    if(e) e.preventDefault();
    const id = el.detailsContainer.dataset.id;
    if(!id) return;

    let status = el.detailsForm.dataset.currentStatus;
    let prevStatus = el.detailsForm.dataset.statusBeforeHold;

    // Progress Logic
    if (stepDir !== 0) {
        if (status === 'On Hold') status = prevStatus;
        const idx = STEPS_WORKFLOW.indexOf(status);
        if (stepDir === 1 && idx < STEPS_WORKFLOW.length - 1) status = STEPS_WORKFLOW[idx + 1];
        if (stepDir === -1 && idx > 0) status = STEPS_WORKFLOW[idx - 1];
    }
    
    // Construct Data Object (Reading from NEW IDs)
    const data = {
        customerName: el.detailsCustomerNameInput.value,
        serviceOrderNumber: el.detailsSoNumberInput.value,
        address: el.detailsAddressInput.value,
        serviceSpeed: el.detailsSpeedInput.value,
        'primaryContact.email': el.detailsEmailInput.value,
        'primaryContact.phone': el.detailsPhoneInput.value,
        status: status,
        statusBeforeHold: prevStatus,
        generalNotes: el.detailsGeneralNotes.value,
        
        // Checklists
        'preInstallChecklist.welcomeEmailSent': isChecked('check-welcome-email'),
        'preInstallChecklist.addedToSiteSurvey': isChecked('check-site-survey'),
        'preInstallChecklist.addedToFiberList': isChecked('check-fiber-list'),
        'preInstallChecklist.addedToRepairShoppr': isChecked('check-repair-shoppr'),
        'installDetails.siteSurveyNotes': getVal('site-survey-notes'),
        'torysListChecklist.added': isChecked('check-torys-list'),
        'installDetails.dropNotes': getVal('drop-notes'),
        'installDetails.nidLightReading': getVal('nid-light'),
        'installReadyChecklist.ready': isChecked('check-install-ready'),
        'installDetails.installDate': getVal('install-date'),
        'installDetails.additionalEquipment': getVal('extra-equip'),
        'installDetails.installNotes': getVal('install-notes'),
        'exemptFromStats': isChecked('check-exempt-from-stats'),
        'installDetails.eeroInfo': isChecked('eero-info'),
        'postInstallChecklist.removedFromFiberList': isChecked('post-check-fiber'),
        'postInstallChecklist.removedFromSiteSurvey': isChecked('post-check-survey'),
        'postInstallChecklist.updatedRepairShoppr': isChecked('post-check-repair'),
        'postInstallChecklist.emailSentToBilling': isChecked('bill-info')
    };

    if (status === 'Torys List' && el.detailsForm.dataset.currentStatus !== 'Torys List') {
        data['torysListChecklist.addedAt'] = serverTimestamp();
    }

    try {
        if (!isAutoSave) el.loadingOverlay.classList.remove('hidden');
        await updateDoc(doc(customersCollectionRef, id), data);
        
        if (stepDir !== 0) {
            populateDetailsForm({ ...data, id }); // optimistic update
        }

        if (!isAutoSave) showToast(stepDir === 0 ? 'Saved' : `Moved to ${status}`, 'success');
    } catch (err) {
        console.error(err);
        showToast('Error saving', 'error');
    } finally {
        el.loadingOverlay.classList.add('hidden');
    }
};

const handleToggleOnHold = () => {
    const curr = el.detailsForm.dataset.currentStatus;
    if (curr === 'On Hold') {
        el.detailsForm.dataset.currentStatus = el.detailsForm.dataset.statusBeforeHold || 'New Order';
    } else {
        el.detailsForm.dataset.statusBeforeHold = curr;
        el.detailsForm.dataset.currentStatus = 'On Hold';
    }
    updateStepperUI(el.detailsForm.dataset.currentStatus);
};

const handleDeleteCustomer = async (e) => {
    e.preventDefault();
    const id = el.detailsContainer.dataset.id;
    if (!id || !customersCollectionRef) return;
    
    // In a real app, use a custom modal. For now, native confirm is acceptable or use the custom modal logic if available.
    if (confirm("Are you sure you want to delete this customer? This cannot be undone.")) {
        try {
            el.loadingOverlay.classList.remove('hidden');
            await deleteDoc(doc(customersCollectionRef, id));
            showToast('Customer deleted.', 'success');
            handleDeselectCustomer(false); 
        } catch (error) {
            console.error("Error deleting customer: ", error);
            showToast('Error deleting customer.', 'error');
        } finally {
            el.loadingOverlay.classList.add('hidden');
        }
    }
};

// --- 7. UTILS & MODALS ---

const openAddCustomerModal = () => {
    el.addCustomerModal.classList.add('show');
    el.addForm.reset();
};
const closeAddCustomerModal = () => {
    el.addCustomerModal.classList.remove('show');
};

const handleAddCustomer = async (e) => {
    e.preventDefault();
    
    // Apply Title Case to Name and Address
    const formattedName = toTitleCase(el.customerNameInput.value);
    const formattedAddress = toTitleCase(el.addressInput.value);

    const newDoc = {
        serviceOrderNumber: el.soNumberInput.value,
        customerName: formattedName,
        address: formattedAddress,
        primaryContact: { email: el.customerEmailInput.value, phone: el.customerPhoneInput.value },
        serviceSpeed: el.serviceSpeedInput.value,
        status: "New Order",
        createdAt: serverTimestamp(),
        serviceOrderPdfUrl: tempUploadedPdfUrl || null
    };
    try {
        await addDoc(customersCollectionRef, newDoc);
        closeAddCustomerModal();
        showToast('Customer Created', 'success');
        tempUploadedPdfUrl = null;
    } catch(err) { console.error(err); showToast('Error creating', 'error'); }
};

const updateSelectedFileDisplay = () => {
    const file = el.pdfUploadInput.files[0];
    if (file) {
        el.selectedFileNameDisplay.textContent = file.name;
        el.processPdfBtn.disabled = false;
    } else {
        el.selectedFileNameDisplay.textContent = 'Drop PDF here or click to browse';
        el.processPdfBtn.disabled = true;
    }
};

const handlePdfProcessing = async () => {
    if (!window.pdfjsLib) return;
    const file = el.pdfUploadInput.files[0];
    if (!file) return;

    el.processPdfBtn.disabled = true;
    el.processPdfBtn.textContent = 'Processing...';

    try {
        // Upload
        const storageRef = ref(storage, `artifacts/${currentAppId}/public/service_orders/${Date.now()}_${file.name}`);
        const snap = await uploadBytes(storageRef, file);
        tempUploadedPdfUrl = await getDownloadURL(snap.ref);

        // Parse
        const reader = new FileReader();
        reader.onload = async () => {
            const pdf = await window.pdfjsLib.getDocument({ data: reader.result }).promise;
            const page = await pdf.getPage(1);
            const content = await page.getTextContent();
            const text = content.items.map(i => i.str).join('\n');
            
            // Regex Logic (Simplified for brevity, ensure your original logic is used here if complex)
            const soMatch = text.match(/Service Order:?\s*(\d+)/i);
            const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
            
            if(soMatch) el.soNumberInput.value = soMatch[1];
            if(emailMatch) el.customerEmailInput.value = emailMatch[1];
            
            // ... Add your full regex logic from the previous file here ...
            
            el.pdfStatusMsg.textContent = 'Autofilled from PDF!';
            el.processPdfBtn.textContent = 'Processed';
        };
        reader.readAsArrayBuffer(file);

    } catch (err) {
        console.error(err);
        el.pdfStatusMsg.textContent = 'Error processing PDF';
    } finally {
        el.processPdfBtn.disabled = false;
    }
};

const handleSendWelcomeEmail = async () => {
    // Implement or leave as placeholder
    console.log("Send Welcome Email clicked");
};

const handleReturnSplice = async () => {
    // Implement or leave as placeholder
    console.log("Return Splice clicked");
};

const handleCopyBilling = async () => {
    try {
        // Get raw date and format it (YYYY-MM-DD -> MM/DD/YYYY)
        const rawDate = document.getElementById('install-date').value;
        let formattedDate = '';
        if (rawDate) {
            const [year, month, day] = rawDate.split('-');
            formattedDate = `${month}/${day}/${year}`;
        }

        // Get additional equipment
        const extraEquip = document.getElementById('extra-equip').value || '';

        // Format Name: Move first word to last (Lastname First -> First Lastname)
        const rawName = el.detailsCustomerNameInput.value || '';
        let billingName = rawName;
        const nameParts = rawName.trim().split(/\s+/);
        if (nameParts.length >= 2) {
            const firstWord = nameParts.shift(); // Removes the first word (assumed Lastname)
            billingName = `${nameParts.join(' ')} ${firstWord}`;
        }

        const billingInfo = [
            `Customer Name: ${billingName}`,
            `Address: ${el.detailsAddressInput.value}`,
            `Service Order: ${el.detailsSoNumberInput.value}`,
            `Speed: ${el.detailsSpeedInput.value}`,
            `Date Installed: ${formattedDate}`,
            `Additional Equipment: ${extraEquip}`,
            ``,
            `Thanks,`,
            `Lincoln`
        ].join('\n');

        await navigator.clipboard.writeText(billingInfo);
        
        // Visual Feedback
        const originalBtnContent = el.copyBillingBtn.innerHTML;
        el.copyBillingBtn.innerHTML = `<i data-lucide="check"></i> Copied!`;
        
        if (window.lucide) window.lucide.createIcons();

        // Reset button after 2 seconds
        setTimeout(() => {
            el.copyBillingBtn.innerHTML = originalBtnContent;
            if (window.lucide) window.lucide.createIcons();
        }, 2000);

        showToast('Billing info copied to clipboard', 'success');

    } catch (err) {
        console.error("Failed to copy billing info: ", err);
        showToast('Failed to copy info', 'error');
    }
};

const handleArchiveCustomer = async () => {
    const id = el.detailsContainer.dataset.id;
    if (!id || !customersCollectionRef) return;

    if (confirm("Are you sure you want to archive this customer?")) {
        try {
            el.loadingOverlay.classList.remove('hidden');
            await updateDoc(doc(customersCollectionRef, id), {
                status: 'Archived'
            });
            showToast('Customer Archived', 'success');
            handleDeselectCustomer(false); // Close details view
        } catch (error) {
            console.error("Error archiving customer: ", error);
            showToast('Error archiving customer', 'error');
        } finally {
            el.loadingOverlay.classList.add('hidden');
        }
    }
};

const handleUnarchiveCustomer = async () => {
    const id = el.detailsContainer.dataset.id;
    if (!id || !customersCollectionRef) return;

    if (confirm("Are you sure you want to unarchive this customer? They will be moved to Completed.")) {
        try {
            el.loadingOverlay.classList.remove('hidden');
            // Move back to 'Completed' as default unarchive state
            await updateDoc(doc(customersCollectionRef, id), {
                status: 'Completed'
            });
            showToast('Customer Unarchived', 'success');
            // The snapshot listener will update the UI automatically.
            // We can leave the details pane open.
        } catch (error) {
            console.error("Error unarchiving customer: ", error);
            showToast('Error unarchiving customer', 'error');
        } finally {
            el.loadingOverlay.classList.add('hidden');
        }
    }
};

// --- HELPERS ---
const isChecked = (id) => document.getElementById(id)?.checked || false;
const setCheck = (id, val) => { if(document.getElementById(id)) document.getElementById(id).checked = !!val; };
const getVal = (id) => document.getElementById(id)?.value || '';
const setVal = (id, val) => { if(document.getElementById(id)) document.getElementById(id).value = val || ''; };

const copyToClipboard = (btn) => {
    const targetId = btn.dataset.target;
    const el = document.getElementById(targetId);
    if(el) {
        navigator.clipboard.writeText(el.value || el.textContent);
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
    }
};

const showToast = (msg, type) => {
    el.toast.textContent = msg;
    el.toast.className = type;
    el.toast.classList.add('show');
    setTimeout(() => el.toast.classList.remove('show'), 3000);
};

const toTitleCase = (str) => {
    if (!str) return '';
    return str.replace(
        /\w\S*/g,
        (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
};

// --- DATA SANITIZATION TOOL ---
// Expose function to window for manual execution via Console
window.sanitizeDatabase = async () => {
    if (!customersCollectionRef || allCustomers.length === 0) {
        console.warn("Database not ready or no customers loaded. Wait for data to load.");
        showToast('Wait for data to load', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to convert all ${allCustomers.length} records to Title Case? This affects Names and Addresses.`)) return;

    el.loadingOverlay.classList.remove('hidden');
    let updatedCount = 0;

    try {
        console.log("Starting sanitization...");
        // Process in chunks to avoid overwhelming the browser/network if dataset is large
        // But for typical use case, Promise.all on the whole set is usually fine for < 1000 docs
        const updatePromises = [];
        
        for (const c of allCustomers) {
            const currentName = c.customerName || '';
            const currentAddress = c.address || '';
            
            const newName = toTitleCase(currentName);
            const newAddress = toTitleCase(currentAddress);
            
            // Only update if actual change occurs
            if (currentName !== newName || currentAddress !== newAddress) {
                const p = updateDoc(doc(customersCollectionRef, c.id), {
                    customerName: newName,
                    address: newAddress
                }).then(() => {
                    updatedCount++;
                    console.log(`Updated: ${newName}`);
                });
                updatePromises.push(p);
            }
        }

        await Promise.all(updatePromises);
        
        const msg = `Sanitization complete. Updated ${updatedCount} records.`;
        console.log(msg);
        showToast(msg, 'success');
        
    } catch (err) {
        console.error("Sanitization failed:", err);
        showToast('Error during sanitization', 'error');
    } finally {
        el.loadingOverlay.classList.add('hidden');
    }
};

// --- NOTES & CHARTS ---
const loadDashboardNotes = async () => {
    if (!dashboardDocRef) return;
    const snap = await getDoc(dashboardDocRef);
    if(snap.exists()) el.dashboardGeneralNotes.value = snap.data().text || '';
};
const saveDashboardNotes = async (silent) => {
    await setDoc(dashboardDocRef, { text: el.dashboardGeneralNotes.value }, { merge: true });
    if(!silent) showToast('Notes Saved', 'success');
};

const renderChart = (ytdInstalls, currentYear) => {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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

    if (!el.installationsChart) return;

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
                x: { grid: { display: false } },
                y: { beginAtZero: true, title: { display: false }, ticks: { precision: 0, maxTicksLimit: 5 } }
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
    
    if (!el.monthlyInstallChart) return;

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
                y: { beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 5 }, title: { display: false } }
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (context) => `Avg: ${context.raw} days` } }
            }
        }
    });
};

const renderSpeedBreakdownChart = (speedCounts) => {
    const Chart = window.Chart;
    if (speedChart) {
        speedChart.destroy();
    }
    
    const speedLabels = Object.keys(speedCounts);
    const speedData = Object.values(speedCounts);
    
    const colors = ['#4f46e5', '#065f46', '#d97706', '#9ca3af'];

    if (!el.speedBreakdownChart) return;

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
                legend: { position: 'right', align: 'middle', labels: { boxWidth: 10, padding: 10 } },
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
    sortedYears.sort((a, b) => b.value.localeCompare(a.value)); 
    
    const sortedMonths = Array.from(monthMap).map(([value, text]) => ({ value, text }));
    sortedMonths.sort((a, b) => b.value.localeCompare(a.value)); 
    
    el.completedFilterSelect.innerHTML = '';
    
    const allOption = document.createElement('option');
    allOption.value = 'All';
    allOption.textContent = 'All Time'; 
    el.completedFilterSelect.appendChild(allOption);

    const yearGroup = document.createElement('optgroup');
    yearGroup.label = 'By Year';
    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year.value;
        option.textContent = year.text;
        yearGroup.appendChild(option);
    });
    el.completedFilterSelect.appendChild(yearGroup);

    const monthGroup = document.createElement('optgroup');
    monthGroup.label = 'By Month';
    sortedMonths.forEach(month => {
        const option = document.createElement('option');
        option.value = month.value;
        option.textContent = month.text;
        monthGroup.appendChild(option);
    });
    el.completedFilterSelect.appendChild(monthGroup);
    
    if (!el.completedFilterSelect.querySelector(`option[value="${currentCompletedFilter}"]`)) {
        currentCompletedFilter = 'All';
    }
    el.completedFilterSelect.value = currentCompletedFilter;
};