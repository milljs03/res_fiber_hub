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

    // Tab Navigation Elements
    detailsTabs: document.getElementById('details-tabs'),
    tabLinks: document.querySelectorAll('.tab-link'),
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
        filterCustomerList(e.target.value.toLowerCase());
    });

    // Sort Listener
    el.sortBy.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderCustomerList(allCustomers);
        filterCustomerList(el.searchBar.value.toLowerCase());
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
    
    // Tab and Status Listeners
    el.detailsTabs.addEventListener('click', (e) => {
        const tabLink = e.target.closest('.tab-link');
        if (tabLink) {
            e.preventDefault();
            showDetailsPage(tabLink.dataset.page);
        }
    });
    el.detailsForm['details-status'].addEventListener('change', (e) => {
        syncPageToStatus(e.target.value);
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
        
        renderCustomerList(allCustomers);
        filterCustomerList(el.searchBar.value.toLowerCase());
        
        if (selectedCustomerId) {
            const freshData = allCustomers.find(c => c.id === selectedCustomerId);
            if (freshData) {
                populateDetailsForm(freshData);
                syncPageToStatus(el.detailsForm['details-status'].value);
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

// --- REVAMPED: renderCustomerList ---
function renderCustomerList(customers) {
    el.customerListContainer.innerHTML = '';
    el.customerListContainer.appendChild(el.listLoading); 

    if (customers.length === 0) {
        el.listLoading.textContent = 'No customers found. Add one to get started!';
        el.listLoading.style.display = 'block';
        return;
    }
    el.listLoading.style.display = 'none'; 

    const customersToRender = [...customers];

    if (currentSort === 'name') {
        customersToRender.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    } else if (currentSort === 'date') {
        customersToRender.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    }

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

        let createdDate = 'N/A';
        if (customer.createdAt && customer.createdAt.seconds) {
            createdDate = new Date(customer.createdAt.seconds * 1000).toLocaleDateString();
        }

        // --- UPDATED: New 2-line HTML structure ---
        item.innerHTML = `
            <div class="customer-item-header">
                <h3 class="customer-item-name">${customer.customerName}</h3>
                <span class="status-pill ${getStatusClass(customer.status)}">${customer.status}</span>
            </div>
            <div class="customer-item-footer">
                <p class="customer-item-address">${customer.address || 'No address'}</p>
                <p class="customer-item-date">${createdDate !== 'N/A' ? `Added: ${createdDate}` : ''}</p>
            </div>
            <p class="search-address" style="display: none;">${customer.address || ''}</p>
        `;
        el.customerListContainer.appendChild(item);
    });
}

function filterCustomerList(searchTerm) {
    const items = el.customerListContainer.querySelectorAll('.customer-item');
    let visibleCount = 0;
    
    items.forEach(item => {
        const name = item.querySelector('.customer-item-name').textContent.toLowerCase();
        const addressElement = item.querySelector('.search-address');
        const address = addressElement ? addressElement.textContent.toLowerCase() : '';
        
        if (name.includes(searchTerm) || address.includes(searchTerm)) {
            item.style.display = 'block';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    if (visibleCount === 0 && items.length > 0) {
        el.listLoading.textContent = `No customers found matching "${searchTerm}".`;
        el.listLoading.style.display = 'block';
    } else if (visibleCount > 0) {
        el.listLoading.style.display = 'none';
    } else if (visibleCount === 0 && items.length === 0) {
        el.listLoading.textContent = 'No customers found. Add one to get started!';
        el.listLoading.style.display = 'block';
    }
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
        secondaryContact: { name: "", phone: "" },
        serviceSpeed: el.serviceSpeedInput.value,
        status: "New Order",
        createdAt: serverTimestamp(), // Add server timestamp
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
            siteSurveyNotes: ""
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
            syncPageToStatus(docSnap.data().status);
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
    // Post-Install
    el.detailsForm['post-check-fiber'].checked = data.postInstallChecklist?.removedFromFiberList || false;
    el.detailsForm['post-check-survey'].checked = data.postInstallChecklist?.removedFromSiteSurvey || false;
    el.detailsForm['post-check-repair'].checked = data.postInstallChecklist?.updatedRepairShoppr || false;
}

function showDetailsPage(pageId) {
    el.detailsPages.forEach(page => page.classList.remove('active'));
    el.tabLinks.forEach(link => link.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
    const targetLink = el.detailsTabs.querySelector(`.tab-link[data-page="${pageId}"]`);
    if (targetLink) targetLink.classList.add('active');
}

function syncPageToStatus(status) {
    switch (status) {
        case 'New Order':
            showDetailsPage('page-pre-install');
            break;
        case 'Site Survey':
            showDetailsPage('page-site-survey');
            break;
        case 'Install Scheduled':
            showDetailsPage('page-install');
            break;
        case 'Completed':
            showDetailsPage('page-post-install');
            break;
        case 'On Hold':
            showDetailsPage('page-pre-install');
            break;
        default:
            showDetailsPage('page-pre-install');
    }
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

async function handleUpdateCustomer(e) {
    e.preventDefault();
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;

    const updatedData = {
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
    
    if (window.confirm(`Are you sure you want to delete customer ${customerName}? This cannot be undone.`)) {
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
    if (!window.confirm(`Send welcome email to ${customerName} at ${toEmail}?`)) {
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
        const billingText = `
Customer Name: ${customerName}
Service Order: ${data.serviceOrderNumber}
Address: ${data.address || ''}
Service: ${data.serviceSpeed}

Site Survey Notes:
${data.installDetails.siteSurveyNotes || 'N/A'}

Install Date: ${data.installDetails.installDate || 'N/A'}
Eero Info: ${data.installDetails.eeroInfo || 'N/A'}
NID Light Reading: ${data.installDetails.nidLightReading || 'N/A'}
Additional Equipment: ${data.installDetails.additionalEquipment || 'N/A'}

General Notes:
${data.installDetails.generalNotes || 'N/A'}

Post-Install Checklist:
- Removed from Fiber List: ${data.postInstallChecklist.removedFromFiberList ? 'YES' : 'NO'}
- Removed from Site Survey: ${data.postInstallChecklist.removedFromSiteSurvey ? 'YES' : 'NO'}
- Updated Repair Shoppr: ${data.postInstallChecklist.updatedRepairShoppr ? 'YES' : 'NO'}
        `.trim();
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