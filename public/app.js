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

// --- Global State ---
let currentUserId = null;
let currentAppId = 'default-app-id';
let customersCollectionRef = null;
let selectedCustomerId = null;
let customerUnsubscribe = null;
let allCustomers = []; 
let currentSort = 'name'; 
let currentFilter = 'All'; // --- ADDED ---

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
    filterPillsContainer: document.getElementById('filter-pills'), // --- ADDED ---

    // Details Panel
    detailsContainer: document.getElementById('details-container'),
    detailsForm: document.getElementById('details-form'),
    detailsPlaceholder: document.getElementById('details-placeholder'),
    loadingOverlay: document.getElementById('loading-overlay'),
    
    // Copyable Static Fields
    detailsSoNumber: document.getElementById('details-so-number'),
    detailsAddress: document.getElementById('details-address'),
    detailsSpeed: document.getElementById('details-speed'),
    detailsEmail: document.getElementById('details-email'),
    detailsPhone: document.getElementById('details-phone'),
    
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

function setupEventListeners() {
    // Modal Listeners
    el.newCustomerBtn.addEventListener('click', openAddCustomerModal);
    el.modalCloseBtn.addEventListener('click', closeAddCustomerModal);
    el.modalBackdrop.addEventListener('click', closeAddCustomerModal);

    // Form submission
    el.addForm.addEventListener('submit', handleAddCustomer);
    
    // Search
    el.searchBar.addEventListener('input', (e) => {
        // --- MODIFIED ---
        displayCustomers();
    });

    // Sort Listener
    el.sortBy.addEventListener('change', (e) => {
        currentSort = e.target.value;
        // --- MODIFIED ---
        displayCustomers();
    });

    // --- ADDED ---
    // Filter Pill Listener
    el.filterPillsContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (!pill) return;

        // Update active class
        el.filterPillsContainer.querySelectorAll('.filter-pill').forEach(p => {
            p.classList.remove('active');
        });
        pill.classList.add('active');

        // Update state and re-render
        currentFilter = pill.dataset.filter;
        displayCustomers();
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
    
    // --- NEW Stepper Click Listener ---
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

    // --- ADDED ---
    // New listener for the moved toggle button
    el.onHoldButton.addEventListener('click', handleToggleOnHold);
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
        
        // --- MODIFIED ---
        displayCustomers();
        
        if (selectedCustomerId) {
            const freshData = allCustomers.find(c => c.id === selectedCustomerId);
            if (freshData) {
                populateDetailsForm(freshData);
                // --- RENAMED FUNCTION CALL ---
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

// --- NEW CENTRAL RENDER FUNCTION ---
function displayCustomers() {
    const searchTerm = el.searchBar.value.toLowerCase();
    
    let filteredCustomers = [...allCustomers];

    // 1. Apply Stage Filter
    if (currentFilter !== 'All') {
        filteredCustomers = filteredCustomers.filter(c => c.status === currentFilter);
    }

    // 2. Apply Search Filter
    if (searchTerm) {
        filteredCustomers = filteredCustomers.filter(c => 
            (c.customerName || '').toLowerCase().includes(searchTerm) || 
            (c.address || '').toLowerCase().includes(searchTerm)
        );
    }

    // 3. Apply Sort
    if (currentSort === 'name') {
        filteredCustomers.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    } else if (currentSort === 'date') {
        filteredCustomers.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } else if (currentSort === 'date-oldest') { // --- ADDED ---
        filteredCustomers.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    }

    // 4. Render the final list
    renderCustomerList(filteredCustomers, searchTerm);
}

// --- MODIFIED: renderCustomerList (removed sorting, added searchterm) ---
function renderCustomerList(customersToRender, searchTerm = '') {
    el.customerListContainer.innerHTML = '';
    el.customerListContainer.appendChild(el.listLoading); 

    if (customersToRender.length === 0) {
        if (searchTerm) {
            el.listLoading.textContent = `No customers found matching "${searchTerm}".`;
        } else if (currentFilter !== 'All') {
            el.listLoading.textContent = `No customers found in stage "${currentFilter}".`;
        } else {
            el.listLoading.textContent = 'No customers found. Add one to get started!';
        }
        el.listLoading.style.display = 'block';
        return;
    }
    el.listLoading.style.display = 'none'; 

    // --- REMOVED Sorting logic from here ---

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

        let createdDate = ''; // Default to empty string
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

// --- REMOVED: filterCustomerList function ---
// --- End Revamp ---


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
            eeroInfo: "",
            nidLightReading: "",
            additionalEquipment: "",
            generalNotes: "",
            siteSurveyNotes: "",
            installNotes: "" // --- ADDED ---
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
            // --- RENAMED FUNCTION CALL ---
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
    // Static fields
    el.detailsSoNumber.textContent = data.serviceOrderNumber || '';
    el.detailsAddress.textContent = data.address || '';
    el.detailsSpeed.textContent = data.serviceSpeed || '';
    el.detailsEmail.textContent = data.primaryContact?.email || '';
    el.detailsPhone.textContent = data.primaryContact?.phone || '';
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
    el.detailsForm['eero-info'].value = data.installDetails?.eeroInfo || '';
    el.detailsForm['nid-light'].value = data.installDetails?.nidLightReading || '';
    el.detailsForm['extra-equip'].value = data.installDetails?.additionalEquipment || '';
    el.detailsForm['general-notes'].value = data.installDetails?.generalNotes || '';
    el.detailsForm['install-notes'].value = data.installDetails?.installNotes || ''; // --- ADDED ---
    // Post-Install
    el.detailsForm['post-check-fiber'].checked = data.postInstallChecklist?.removedFromFiberList || false;
    el.detailsForm['post-check-survey'].checked = data.postInstallChecklist?.removedFromSiteSurvey || false;
    el.detailsForm['post-check-repair'].checked = data.postInstallChecklist?.updatedRepairShoppr || false;

    // --- ADDED ---
    // This will style the stepper correctly when a customer is loaded
    updateStepperUI(data.status || 'New Order');
}

function showDetailsPage(pageId) {
    el.detailsPages.forEach(page => page.classList.remove('active'));
    // --- REMOVED tab link logic ---
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
    
    // --- REMOVED tab link logic ---
}

// --- RENAMED and UPDATED ---
function setPageForStatus(status) {
    switch (status) {
        case 'Site Survey':
            showDetailsPage('page-site-survey');
            break;
        case 'Install':
            showDetailsPage('page-install');
            break;
        case 'Completed':
            showDetailsPage('page-post-install');
            break;
        case 'New Order':
        case 'On Hold':
        default:
            showDetailsPage('page-pre-install');
    }
}

// --- NEW FUNCTION ---
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

// --- MODIFIED FUNCTION ---
function updateStepperUI(currentStatus) {
    const steps = ['New Order', 'Site Survey', 'Install', 'Completed'];
    const allStepButtons = el.statusStepper.querySelectorAll('.step');

    // Reset all styles
    allStepButtons.forEach(btn => {
        btn.classList.remove('active', 'completed');
    });

    // --- NEW LOGIC for the moved button ---
    const onHoldBtnText = el.onHoldButton.querySelector('span');

    if (currentStatus === 'On Hold') {
        // Handle "On Hold" state
        el.onHoldButton.classList.add('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Status: On Hold';
        el.statusStepper.classList.add('is-on-hold'); // Keep this style to dim stepper
        
    } else {
        // Handle main progression states
        el.onHoldButton.classList.remove('active');
        if (onHoldBtnText) onHoldBtnText.textContent = 'Toggle On Hold';
        el.statusStepper.classList.remove('is-on-hold'); // Remove dimming

        const statusIndex = steps.indexOf(currentStatus);
        if (statusIndex !== -1) {
            for (let i = 0; i < allStepButtons.length; i++) {
                const stepButton = allStepButtons[i];
                if (i < statusIndex) {
                    stepButton.classList.add('completed');
                } else if (i === statusIndex) {
                    stepButton.classList.add('active');
                }
            }
        } else {
            // Default to New Order if status is unknown (e.g., null)
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

async function handleUpdateCustomer(e) {
    e.preventDefault();
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;

    const updatedData = {
        // --- UPDATED to use the hidden input ---
        'status': el.detailsForm['details-status'].value,
        'preInstallChecklist.welcomeEmailSent': el.detailsForm['check-welcome-email'].checked,
        'preInstallChecklist.addedToSiteSurvey': el.detailsForm['check-site-survey'].checked,
        'preInstallChecklist.addedToFiberList': el.detailsForm['check-fiber-list'].checked,
        'preInstallChecklist.addedToRepairShoppr': el.detailsForm['check-repair-shoppr'].checked,
        'installDetails.siteSurveyNotes': el.detailsForm['site-survey-notes'].value,
        'installDetails.installDate': el.detailsForm['install-date'].value,
        'installDetails.eeroInfo': el.detailsForm['eero-info'].value,
        'installDetails.nidLightReading': el.detailsForm['nid-light'].value,
        'installDetails.additionalEquipment': el.detailsForm['extra-equip'].value,
        'installDetails.generalNotes': el.detailsForm['general-notes'].value,
        'installDetails.installNotes': el.detailsForm['install-notes'].value, // --- ADDED ---
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
    const customerName = el.detailsSoNumber.textContent;
    
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

// --- 6. ACTIONS ---
async function handleSendWelcomeEmail(e) {
    e.preventDefault(); 
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    const toEmail = el.detailsEmail.textContent;
    const customerName = document.querySelector(`.customer-item[data-id="${customerId}"] .customer-item-name`).textContent; 
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
        const customerName = document.querySelector(`.customer-item[data-id="${customerId}"] .customer-item-name`).textContent; 
        
        // --- MODIFIED BILLING TEXT ---
        const billingText = `
Customer Name: ${customerName}
Address: ${data.address || 'N/A'}
Service Order: ${data.serviceOrderNumber || 'N/A'}
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

// --- 7. UTILITIES ---

function showToast(message, type = 'success') {
    el.toast.textContent = message;
    el.toast.classList.remove('success', 'error');
    el.toast.classList.add(type === 'error' ? 'error' : 'success');
    el.toast.classList.add('show');
    setTimeout(() => el.toast.classList.remove('show'), 3000);
}