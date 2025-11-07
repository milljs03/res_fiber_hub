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
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Import Auth functions
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- Global State ---
let currentUserId = null;
let currentAppId = 'default-app-id';
let customersCollectionRef = null;
let selectedCustomerId = null;
let customerUnsubscribe = null;
let allCustomers = []; 
let currentSort = 'name-asc'; 
let currentFilter = 'All';
let previousOnHoldStatus = 'New Order'; 
let autoSaveTimer = null; // For debouncing auto-save

const STATUS_STEPS = ['New Order', 'Site Survey', 'NID', 'Install Scheduled', 'Completed'];

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
    filterPillsContainer: document.getElementById('filter-pills-container'),

    // Details Panel
    detailsContainer: document.getElementById('details-container'),
    detailsTitle: document.getElementById('details-title'),
    detailsForm: document.getElementById('details-form'),
    detailsPlaceholder: document.getElementById('details-placeholder'),
    loadingOverlay: document.getElementById('loading-overlay'),
    
    // UPDATED: Editable Core Fields
    detailsSoNumber: document.getElementById('details-so-number'),
    detailsAddress: document.getElementById('details-address'),
    detailsSpeed: document.getElementById('details-speed'),
    detailsEmail: document.getElementById('details-email'),
    detailsPhone: document.getElementById('details-phone'),
    
    // Buttons
    sendWelcomeEmailBtn: document.getElementById('send-welcome-email-btn'),
    // REMOVED: advanceStageBtn: document.getElementById('advance-stage-btn'),
    onHoldBtn: document.getElementById('on-hold-btn'),
    copyBillingBtn: document.getElementById('copy-billing-btn'),
    deleteCustomerBtn: document.getElementById('delete-customer-btn'),

    // Stepper
    statusStepper: document.getElementById('status-stepper'),
    
    // Detail Pages
    detailsPages: document.querySelectorAll('.details-page'),
    pageNid: document.getElementById('page-nid'),
    
    // Toast
    toast: document.getElementById('toast-notification')
};

// --- 1. AUTHENTICATION ---
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
    handleAutoUpdate(false); // false = no toast
    signOut(auth).catch((error) => console.error("Sign-out error", error));
});


// --- 2. INITIALIZATION ---

function initializeApp() {
    if (el.addForm.dataset.listenerAttached !== 'true') {
        setupEventListeners();
        el.addForm.dataset.listenerAttached = 'true';
    }
    loadCustomers();
    handleDeselectCustomer();
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const triggerAutoSave = debounce(() => {
    handleAutoUpdate(true); // true = show toast
}, 2000); // 2-second delay


function setupEventListeners() {
    // Modal Listeners
    el.newCustomerBtn.addEventListener('click', openAddCustomerModal);
    el.modalCloseBtn.addEventListener('click', closeAddCustomerModal);
    el.modalBackdrop.addEventListener('click', closeAddCustomerModal);

    // Form submission
    el.addForm.addEventListener('submit', handleAddCustomer);
    
    // List Filtering & Sorting
    el.searchBar.addEventListener('input', () => displayCustomers());
    el.sortBy.addEventListener('change', () => displayCustomers());
    el.filterPillsContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (pill) {
            el.filterPillsContainer.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.dataset.status;
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

    // Details Panel Auto-Save
    el.detailsForm.addEventListener('input', (e) => {
        if (e.target.id !== 'details-status') {
             triggerAutoSave();
        }
    });
    
    // Details Panel Buttons
    el.sendWelcomeEmailBtn.addEventListener('click', handleSendWelcomeEmail);
    // REMOVED: el.advanceStageBtn.addEventListener('click', handleAdvanceStage);
    el.onHoldBtn.addEventListener('click', handleOnHoldToggle);
    el.copyBillingBtn.addEventListener('click', handleCopyBilling);
    el.deleteCustomerBtn.addEventListener('click', handleDeleteCustomer);
    
    // Copy buttons
    el.detailsForm.addEventListener('click', handleDetailsFormClick);

    // NEW: Stepper click listener
    el.statusStepper.addEventListener('click', (e) => {
        const stepButton = e.target.closest('.step');
        if (!stepButton) return;

        e.preventDefault();
        const newStatus = stepButton.dataset.status;
        handleStatusStepClick(newStatus);
    });
}

// --- 3. CUSTOMER LIST (READ) ---

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
        
        displayCustomers();
        
        if (selectedCustomerId) {
            const freshData = allCustomers.find(c => c.id === selectedCustomerId);
            if (freshData) {
                populateDetailsForm(freshData);
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

function displayCustomers() {
    let filteredCustomers = allCustomers;
    if (currentFilter !== 'All') {
        filteredCustomers = allCustomers.filter(c => c.status === currentFilter);
    }
    
    const searchTerm = el.searchBar.value.toLowerCase();
    if (searchTerm) {
        filteredCustomers = filteredCustomers.filter(c => 
            (c.customerName || '').toLowerCase().includes(searchTerm) ||
            (c.address || '').toLowerCase().includes(searchTerm)
        );
    }

    currentSort = el.sortBy.value;
    filteredCustomers.sort((a, b) => {
        const createdA = a.createdAt?.seconds || 0;
        const createdB = b.createdAt?.seconds || 0;
        const nameA = a.customerName || '';
        const nameB = b.customerName || '';

        switch (currentSort) {
            case 'name-asc':
                return nameA.localeCompare(nameB);
            case 'name-desc':
                return nameB.localeCompare(nameA);
            case 'date-desc':
                return createdB - createdA;
            case 'date-asc':
                return createdA - createdB;
            default:
                return 0;
        }
    });

    renderCustomerList(filteredCustomers);
}

function renderCustomerList(customers) {
    el.customerListContainer.innerHTML = ''; 
    el.customerListContainer.appendChild(el.listLoading); 

    if (customers.length === 0) {
        if (currentFilter !== 'All' || el.searchBar.value) {
            el.listLoading.textContent = 'No customers match your filters.';
        } else {
            el.listLoading.textContent = 'No customers found. Add one to get started!';
        }
        el.listLoading.style.display = 'block';
        return;
    }
    
    el.listLoading.style.display = 'none'; 

    customers.forEach(customer => {
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

        item.innerHTML = `
            <div class="customer-item-header">
                <h3 class="customer-item-name">${customer.customerName}</h3>
                <span class="status-pill ${getStatusClass(customer.status)}">${customer.status}</span>
            </div>
            <div class="customer-item-footer">
                <p class="customer-item-address">${customer.address || 'No address'}</p>
                <p class="customer-item-date">${createdDate}</p>
            </div>
            <p class="search-address" style="display: none;">${customer.address || ''}</p>
        `;
        el.customerListContainer.appendChild(item);
    });
}


// --- 4. CUSTOMER (CREATE) ---

function openAddCustomerModal() {
    el.addCustomerModal.classList.add('show');
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function closeAddCustomerModal() {
    el.addCustomerModal.classList.remove('show');
    el.addForm.reset();
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
        serviceSpeed: el.serviceSpeedInput.value,
        status: "New Order",
        previousStatus: "New Order",
        createdAt: serverTimestamp(), 
        preInstallChecklist: {
            welcomeEmailSent: false,
            addedToSiteSurvey: false,
            addedToFiberList: false,
            addedToRepairShoppr: false
        },
        installDetails: {
            siteSurveyDate: "",
            nidLightReading: "",
            installDate: "",
            eeroInfo: "",
            installNotes: "",
            additionalEquipment: "",
            generalNotes: "",
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


// --- 5. DETAILS PANEL (UPDATE / DELETE) ---

async function handleAutoUpdate(showToastNotification = false) {
    clearTimeout(autoSaveTimer);
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) {
        return;
    }
    const docRef = doc(customersCollectionRef, customerId);
    
    try {
        const updatedData = getFormData();
        await updateDoc(docRef, updatedData);
        if (showToastNotification) {
            showToast('Changes saved!', 'autosave');
        }
    } catch (error) {
        console.error("Error auto-updating customer: ", error);
        if (showToastNotification) {
            showToast('Error saving changes.', 'error');
        }
    }
}

function getFormData() {
    // UPDATED: Now includes core customer info
    return {
        // Core Info
        serviceOrderNumber: el.detailsSoNumber.value,
        customerName: el.detailsTitle.textContent, // Title is updated on input
        address: el.detailsAddress.value,
        serviceSpeed: el.detailsSpeed.value,
        'primaryContact.email': el.detailsEmail.value,
        'primaryContact.phone': el.detailsPhone.value,

        // Checklists
        'preInstallChecklist.welcomeEmailSent': el.detailsForm['check-welcome-email'].checked,
        'preInstallChecklist.addedToSiteSurvey': el.detailsForm['check-site-survey'].checked,
        'preInstallChecklist.addedToFiberList': el.detailsForm['check-fiber-list'].checked,
        'preInstallChecklist.addedToRepairShoppr': el.detailsForm['check-repair-shoppr'].checked,
        
        'installDetails.siteSurveyDate': el.detailsForm['site-survey-date'].value,
        'installDetails.nidLightReading': el.detailsForm['nid-light'].value,
        
        'installDetails.installDate': el.detailsForm['install-date'].value,
        'installDetails.eeroInfo': el.detailsForm['eero-info'].value,
        'installDetails.installNotes': el.detailsForm['install-notes'].value,
        'installDetails.additionalEquipment': el.detailsForm['extra-equip'].value,
        'installDetails.generalNotes': el.detailsForm['general-notes'].value,
        
        'postInstallChecklist.removedFromFiberList': el.detailsForm['post-check-fiber'].checked,
        'postInstallChecklist.removedFromSiteSurvey': el.detailsForm['post-check-survey'].checked,
        'postInstallChecklist.updatedRepairShoppr': el.detailsForm['post-check-repair'].checked,
    };
}


async function handleSelectCustomer(customerId, customerItem) {
    if (selectedCustomerId && selectedCustomerId !== customerId) {
        await handleAutoUpdate(false); // Save without toast
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
            const data = docSnap.data();
            populateDetailsForm(data);
            previousOnHoldStatus = data.previousStatus || 'New Order';
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

async function handleDeselectCustomer() {
    if (selectedCustomerId) {
        await handleAutoUpdate(false); // Save without toast
    }

    selectedCustomerId = null;
    document.querySelectorAll('.customer-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    el.detailsPlaceholder.style.display = 'block';
    el.detailsContainer.style.display = 'none';
    el.detailsContainer.dataset.id = '';
    el.detailsTitle.textContent = 'Customer Details'; // Reset title
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function populateDetailsForm(data) {
    // UPDATED: Set values of inputs, not textContent
    el.detailsTitle.textContent = data.customerName || 'Customer Details';
    el.detailsSoNumber.value = data.serviceOrderNumber || '';
    el.detailsAddress.value = data.address || '';
    el.detailsSpeed.value = data.serviceSpeed || '200 Mbps';
    el.detailsEmail.value = data.primaryContact?.email || '';
    el.detailsPhone.value = data.primaryContact?.phone || '';
    
    const currentStatus = data.status || 'New Order';
    el.detailsForm['details-status'].value = currentStatus;
    
    // Checklists
    el.detailsForm['check-welcome-email'].checked = data.preInstallChecklist?.welcomeEmailSent || false;
    el.detailsForm['check-site-survey'].checked = data.preInstallChecklist?.addedToSiteSurvey || false;
    el.detailsForm['check-fiber-list'].checked = data.preInstallChecklist?.addedToFiberList || false;
    el.detailsForm['check-repair-shoppr'].checked = data.preInstallChecklist?.addedToRepairShoppr || false;
    
    el.detailsForm['site-survey-date'].value = data.installDetails?.siteSurveyDate || '';
    el.detailsForm['nid-light'].value = data.installDetails?.nidLightReading || '';
    
    el.detailsForm['install-date'].value = data.installDetails?.installDate || '';
    el.detailsForm['eero-info'].value = data.installDetails?.eeroInfo || '';
    el.detailsForm['install-notes'].value = data.installDetails?.installNotes || '';
    el.detailsForm['extra-equip'].value = data.installDetails?.additionalEquipment || '';
    el.detailsForm['general-notes'].value = data.installDetails?.generalNotes || '';
    
    el.detailsForm['post-check-fiber'].checked = data.postInstallChecklist?.removedFromFiberList || false;
    el.detailsForm['post-check-survey'].checked = data.postInstallChecklist?.removedFromSiteSurvey || false;
    el.detailsForm['post-check-repair'].checked = data.postInstallChecklist?.updatedRepairShoppr || false;

    updateStepperUI(currentStatus);
    setPageForStatus(currentStatus);
}

function showDetailsPage(pageId) {
    el.detailsPages.forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    } else {
        document.getElementById('page-pre-install').classList.add('active');
    }
}

function setPageForStatus(status) {
    switch (status) {
        case 'New Order':
            showDetailsPage('page-pre-install');
            break;
        case 'Site Survey':
            showDetailsPage('page-site-survey');
            break;
        case 'NID': 
            showDetailsPage('page-nid');
            break;
        case 'Install Scheduled':
            showDetailsPage('page-install');
            break;
        case 'Completed':
            showDetailsPage('page-post-install');
            break;
        case 'On Hold':
            setPageForStatus(previousOnHoldStatus);
            break;
        default:
            showDetailsPage('page-pre-install');
    }
}

function updateStepperUI(currentStatus) {
    const allStepButtons = el.statusStepper.querySelectorAll('.step');
    
    allStepButtons.forEach(btn => btn.classList.remove('active', 'completed'));
    el.statusStepper.classList.remove('is-on-hold');
    el.onHoldBtn.classList.remove('active');
    el.onHoldBtn.innerHTML = '<i data-lucide="pause-circle" class="btn-icon"></i>Place On Hold';

    if (currentStatus === 'On Hold') {
        el.statusStepper.classList.add('is-on-hold');
        el.onHoldBtn.classList.add('active');
        el.onHoldBtn.innerHTML = '<i data-lucide="play-circle" class="btn-icon"></i>Remove from Hold';
        
        const statusIndex = STATUS_STEPS.indexOf(previousOnHoldStatus);
        updateStepperProgress(statusIndex);
        
    } else {
        const statusIndex = STATUS_STEPS.indexOf(currentStatus);
        updateStepperProgress(statusIndex);
    }
    
    // REMOVED: Advance Stage Button logic
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function updateStepperProgress(activeIndex) {
    const allStepButtons = el.statusStepper.querySelectorAll('.step');
    allStepButtons.forEach((btn, index) => {
        if (index < activeIndex) {
            btn.classList.add('completed');
        } else if (index === activeIndex) {
            btn.classList.add('active');
        }
    });
}

function handleDetailsFormClick(e) {
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
}


async function handleDeleteCustomer(e) {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    
    const customerName = el.detailsTitle.textContent;
    
    // Create a custom modal for confirmation
    if (confirm(`Are you sure you want to delete customer ${customerName}? This cannot be undone.`)) {
        try {
            el.loadingOverlay.style.display = 'flex';
            const docRef = doc(customersCollectionRef, customerId);
            await deleteDoc(docRef);
            showToast('Customer deleted.', 'success');
            handleDeselectCustomer(); // This will clear the panel
        } catch (error) {
            console.error("Error deleting customer: ", error);
            showToast('Error deleting customer.', 'error');
        } finally {
            el.loadingOverlay.style.display = 'none';
        }
    }
}

// --- 6. ACTIONS ---

/**
 * NEW: Stepper click handler
 */
async function handleStatusStepClick(newStatus) {
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId) return;

    // Prevent changing stage while on hold
    const currentStatus = el.detailsForm['details-status'].value;
    if (currentStatus === 'On Hold') {
        showToast("Remove customer from 'On Hold' to change stages.", 'error');
        return;
    }

    // 1. Save all pending changes first
    await handleAutoUpdate(false); // Save without toast

    // 2. Update the status in Firestore
    try {
        el.loadingOverlay.style.display = 'flex';
        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, {
            status: newStatus,
            previousStatus: currentStatus // Store this for 'On Hold' logic
        });
        showToast(`Status updated to ${newStatus}!`, 'success');
    } catch (error) {
        console.error("Error updating stage: ", error);
        showToast('Error updating stage.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}


async function handleOnHoldToggle() {
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId) return;

    await handleAutoUpdate(false); // Save without toast

    const docRef = doc(customersCollectionRef, customerId);
    const currentStatus = el.detailsForm['details-status'].value;
    let newStatus, newPreviousStatus;

    if (currentStatus === 'On Hold') {
        newStatus = previousOnHoldStatus; // Restore previous status
        newPreviousStatus = previousOnHoldStatus; 
    } else {
        newStatus = 'On Hold';
        newPreviousStatus = currentStatus; // Remember where we were
        previousOnHoldStatus = currentStatus; // Update global state immediately
    }

    try {
        el.loadingOverlay.style.display = 'flex';
        await updateDoc(docRef, {
            status: newStatus,
            previousStatus: newPreviousStatus
        });
        showToast(`Customer status updated to ${newStatus}.`, 'success');
    } catch (error) {
        console.error("Error toggling 'On Hold': ", error);
        showToast('Error updating status.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}


async function handleSendWelcomeEmail(e) {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    
    // UPDATED: Read from input values
    const toEmail = el.detailsEmail.value;
    const customerName = el.detailsTitle.textContent; 
    
    if (!toEmail) {
        showToast('No customer email on file to send to.', 'error');
        return;
    }
    
    if (confirm(`Send welcome email to ${customerName} at ${toEmail}?`)) {
        el.loadingOverlay.style.display = 'flex';
        try {
            const mailCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'mail');
            await addDoc(mailCollectionRef, { // Corrected variable name
                to: [toEmail],
                template: { 
                    name: "cfnWelcome", 
                    data: { customerName: customerName } 
                },
            });

            el.detailsForm['check-welcome-email'].checked = true;
            await handleAutoUpdate(false); // Save without toast

            showToast('Welcome email sent!', 'success');
        } catch (error) {
            console.error("Error sending welcome email: ", error);
            showToast('Error sending email. Check console.', 'error');
        } finally {
            el.loadingOverlay.style.display = 'none';
        }
    }
}

async function handleCopyBilling(e) {
    e.preventDefault();
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId) return;

    try {
        // UPDATED: Read directly from the form fields
        const customerName = el.detailsTitle.textContent;
        const serviceOrder = el.detailsSoNumber.value;
        const address = el.detailsAddress.value;
        const installDate = el.detailsForm['install-date'].value;
        const additionalEquipment = el.detailsForm['extra-equip'].value;
        
        const billingText = `
Customer Name: ${customerName}
Service Order: ${serviceOrder}
Address: ${address || ''}
Install Date: ${installDate || 'N/A'}
Additional Equipment: ${additionalEquipment || 'N/A'}
        `.trim().replace(/^\s+/gm, ''); // Cleans up indentation

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

// --- 7. UTILITIES ---

let toastTimer = null;
function showToast(message, type = 'success') {
    clearTimeout(toastTimer);
    
    el.toast.textContent = message;
    el.toast.classList.remove('success', 'error', 'autosave');
    el.toast.classList.add(type);
    el.toast.classList.add('show');
    
    toastTimer = setTimeout(() => {
        el.toast.classList.remove('show');
    }, 3000);
}