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
    query
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Import Auth functions
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- Global State ---
let currentUserId = null; // Will be set after auth
let currentAppId = 'default-app-id'; // Placeholder
let customersCollectionRef = null; // Will be set after auth
let selectedCustomerId = null; // ID of the currently viewed customer
let customerUnsubscribe = null; // Function to detach Firestore listener

// --- DOM Elements ---
const el = {
    // Auth
    authScreen: document.getElementById('auth-screen'),
    appScreen: document.getElementById('app-screen'),
    signInBtn: document.getElementById('sign-in-btn'),
    signOutBtn: document.getElementById('sign-out-btn'),
    authError: document.getElementById('auth-error'),
    userEmailDisplay: document.getElementById('user-email'),

    // Add Form
    addForm: document.getElementById('add-customer-form'),
    soNumberInput: document.getElementById('so-number'),
    customerNameInput: document.getElementById('customer-name'),
    addressInput: document.getElementById('address'), // <-- NEW
    customerEmailInput: document.getElementById('customer-email'),
    customerPhoneInput: document.getElementById('customer-phone'),
    serviceSpeedInput: document.getElementById('service-speed'),

    // Customer List
    customerListContainer: document.getElementById('customer-list-container'),
    listLoading: document.getElementById('list-loading'),
    searchBar: document.getElementById('search-bar'),

    // Details Panel
    detailsContainer: document.getElementById('details-container'),
    detailsForm: document.getElementById('details-form'),
    detailsPlaceholder: document.getElementById('details-placeholder'),
    loadingOverlay: document.getElementById('loading-overlay'),
    
    // Copyable Static Fields (NEW)
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
    
    // Toast
    toast: document.getElementById('toast-notification')
};

// --- 1. AUTHENTICATION ---

// Listen for auth state changes
onAuthStateChanged(auth, (user) => {
    handleAuthentication(user);
});

function handleAuthentication(user) {
    if (user && user.email && user.email.endsWith('@nptel.com')) {
        // User is signed in and from the correct domain
        currentUserId = user.uid;
        el.userEmailDisplay.textContent = user.email;

        // --- This is where we define the user-specific database path ---
        currentAppId = 'cfn-install-tracker'; // Unique ID for this app
        // This path matches the firestore.rules
        customersCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'customers');
        // --- End Database Path ---

        // Show app, hide auth screen
        el.appScreen.classList.remove('hidden');
        el.authScreen.classList.add('hidden');

        // Initialize app listeners and load data
        initializeApp();
        
    } else {
        // User is not signed in or not from the correct domain
        currentUserId = null;
        customersCollectionRef = null;
        
        // Detach any existing Firestore listener
        if (customerUnsubscribe) {
            customerUnsubscribe();
            customerUnsubscribe = null;
        }

        // Show auth screen, hide app
        el.appScreen.classList.add('hidden');
        el.authScreen.classList.remove('hidden');
        
        if (user) {
            // User is logged in but with wrong domain
            el.authError.textContent = 'Access restricted to @nptel.com accounts.';
            signOut(auth); // Log them out
        } else {
            el.authError.textContent = ''; // Clear error on successful sign-out
        }
    }
}

// Handle Sign-In button click
el.signInBtn.addEventListener('click', () => {
    el.authError.textContent = ''; // Clear error on new attempt
    signInWithPopup(auth, googleProvider)
        .then((result) => {
            // onAuthStateChanged will handle the rest
            console.log("Sign-in successful", result.user.email);
        })
        .catch((error) => {
            // Handle Errors here.
            console.error("Sign-in error", error);
            if (error.code === 'auth/popup-closed-by-user') {
                el.authError.textContent = 'Sign-in cancelled.';
            } else if (error.code === 'auth/cancelled-popup-request') {
                // Ignore this, it happens on rapid clicks
            } else {
                el.authError.textContent = error.message;
            }
        });
});

// Handle Sign-Out button click
el.signOutBtn.addEventListener('click', () => {
    signOut(auth).catch((error) => {
        console.error("Sign-out error", error);
    });
});


// --- 2. INITIALIZATION ---

// This function is now called *after* successful login
function initializeApp() {
    console.log(`App initialized for user ${currentUserId}.`);
    
    // Ensure listeners are only set up once
    if (el.addForm.dataset.listenerAttached !== 'true') {
        setupEventListeners();
        el.addForm.dataset.listenerAttached = 'true';
    }
    
    // Start listening for customer data
    loadCustomers();
    
    // Hide details panel by default
    handleDeselectCustomer();
}

function setupEventListeners() {
    // Form submissions
    el.addForm.addEventListener('submit', handleAddCustomer);
    
    // Search
    el.searchBar.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterCustomerList(searchTerm);
    });

    // List clicks (using event delegation)
    el.customerListContainer.addEventListener('click', (e) => {
        const customerItem = e.target.closest('.customer-item');
        if (customerItem) {
            const customerId = customerItem.dataset.id;
            handleSelectCustomer(customerId, customerItem);
        }
    });

    // Details panel button clicks
    el.sendWelcomeEmailBtn.addEventListener('click', handleSendWelcomeEmail);
    el.updateCustomerBtn.addEventListener('click', handleUpdateCustomer);
    el.copyBillingBtn.addEventListener('click', handleCopyBilling);
    el.deleteCustomerBtn.addEventListener('click', handleDeleteCustomer);
    
    // NEW: Details form click handler for copy icons
    el.detailsForm.addEventListener('click', handleDetailsFormClick);
}

// --- 3. CUSTOMER LIST (READ) ---

function loadCustomers() {
    if (!customersCollectionRef) {
        console.error("Customer collection ref is not set. Cannot load customers.");
        return;
    }

    // Detach old listener if it exists
    if (customerUnsubscribe) {
        customerUnsubscribe();
    }

    // Query to get all customers, order by name
    const q = query(customersCollectionRef);

    customerUnsubscribe = onSnapshot(q, (snapshot) => {
        el.listLoading.style.display = 'none';
        const customers = [];
        snapshot.forEach((doc) => {
            customers.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort customers alphabetically by name
        customers.sort((a, b) => {
            const nameA = a.customerName || '';
            const nameB = b.customerName || '';
            return nameA.localeCompare(nameB);
        });

        renderCustomerList(customers);
        
        // After rendering, re-apply the search filter if one exists
        filterCustomerList(el.searchBar.value.toLowerCase());
        
        // If a customer was selected, refresh their details
        if (selectedCustomerId) {
            const freshData = customers.find(c => c.id === selectedCustomerId);
            if (freshData) {
                populateDetailsForm(freshData);
            } else {
                // The selected customer was deleted
                handleDeselectCustomer();
            }
        }
        
    }, (error) => {
        console.error("Error loading customers: ", error);
        el.listLoading.textContent = 'Error loading customers.';
        showToast('Error loading customers.', 'error');
    });
}

function renderCustomerList(customers) {
    // Clear list, but keep the loading text element (it's hidden)
    el.customerListContainer.innerHTML = '';
    el.customerListContainer.appendChild(el.listLoading); // Re-add hidden loading element

    if (customers.length === 0) {
        el.listLoading.textContent = 'No customers found. Add one to get started!';
        el.listLoading.style.display = 'block';
        return;
    }
    el.listLoading.style.display = 'none'; // Hide loading text

    customers.forEach(customer => {
        const item = document.createElement('div');
        item.className = 'customer-item'; // Styles are in style.css
        item.dataset.id = customer.id;
        
        // Add "selected" class if this is the currently selected customer
        if (customer.id === selectedCustomerId) {
            item.classList.add('selected');
        }

        item.innerHTML = `
            <h3>${customer.customerName}</h3>
            <p>SO: ${customer.serviceOrderNumber}</p>
            <p>Status: <span>${customer.status}</span></p>
        `;
        el.customerListContainer.appendChild(item);
    });
    
    // Call lucide.createIcons() after adding new HTML
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function filterCustomerList(searchTerm) {
    const items = el.customerListContainer.querySelectorAll('.customer-item');
    let visibleCount = 0;
    
    items.forEach(item => {
        const name = item.querySelector('h3').textContent.toLowerCase();
        const so = item.querySelector('p').textContent.toLowerCase();
        
        if (name.includes(searchTerm) || so.includes(searchTerm)) {
            item.style.display = 'block';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    // Show "no results" message if search yields nothing
    if (visibleCount === 0 && items.length > 0) {
        el.listLoading.textContent = `No customers found matching "${searchTerm}".`;
        el.listLoading.style.display = 'block';
    } else if (visibleCount > 0) {
        el.listLoading.style.display = 'none';
    } else if (visibleCount === 0 && items.length === 0) {
        // This is handled by renderCustomerList, but good to be defensive
        el.listLoading.textContent = 'No customers found. Add one to get started!';
        el.listLoading.style.display = 'block';
    }
}


// --- 4. CUSTOMER (CREATE) ---

async function handleAddCustomer(e) {
    e.preventDefault();
    if (!customersCollectionRef) return;

    const newCustomer = {
        serviceOrderNumber: el.soNumberInput.value,
        customerName: el.customerNameInput.value,
        address: el.addressInput.value, // <-- NEW
        primaryContact: {
            email: el.customerEmailInput.value,
            phone: el.customerPhoneInput.value
        },
        secondaryContact: { // Add empty secondary contact object
            name: "",
            phone: ""
        },
        serviceSpeed: el.serviceSpeedInput.value,
        status: "New Order",
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
            generalNotes: ""
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
        el.addForm.reset();
        // onSnapshot will automatically update the list
    } catch (error) {
        console.error("Error adding customer: ", error);
        showToast('Error adding customer.', 'error');
    }
}


// --- 5. DETAILS PANEL (UPDATE / DELETE) ---

async function handleSelectCustomer(customerId, customerItem) {
    if (selectedCustomerId === customerId) {
        // If clicking the already selected customer, deselect them
        handleDeselectCustomer();
        return;
    }

    selectedCustomerId = customerId;

    // Update list item styles
    document.querySelectorAll('.customer-item').forEach(item => {
        item.classList.remove('selected');
    });
    customerItem.classList.add('selected');

    // Show details panel, hide placeholder
    el.detailsPlaceholder.style.display = 'none';
    el.detailsContainer.style.display = 'block';
    el.detailsContainer.dataset.id = customerId; // Store ID for update actions
    el.loadingOverlay.style.display = 'flex'; // Show spinner

    // Fetch the single customer's data to populate the form
    try {
        const docRef = doc(customersCollectionRef, customerId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            populateDetailsForm(docSnap.data());
        } else {
            showToast('Could not find customer data.', 'error');
            handleDeselectCustomer();
        }
    } catch (error) {
        console.error("Error fetching document:", error);
        showToast('Error fetching customer details.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
        
        // Call lucide.createIcons() after adding new HTML
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
}

function handleDeselectCustomer() {
    selectedCustomerId = null;
    
    // Remove "selected" from all list items
    document.querySelectorAll('.customer-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Hide details, show placeholder
    el.detailsPlaceholder.style.display = 'block';
    el.detailsContainer.style.display = 'none';
    el.detailsContainer.dataset.id = '';
    
    // Call lucide.createIcons() after adding new HTML
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function populateDetailsForm(data) {
    // This function now just populates the form
    // The data is passed in from the onSnapshot listener or getDoc
    
    // --- Populate NEW static fields ---
    el.detailsSoNumber.textContent = data.serviceOrderNumber || '';
    el.detailsAddress.textContent = data.address || '';
    el.detailsSpeed.textContent = data.serviceSpeed || '';
    el.detailsEmail.textContent = data.primaryContact?.email || '';
    el.detailsPhone.textContent = data.primaryContact?.phone || '';

    // Populate editable fields
    el.detailsForm['details-status'].value = data.status || 'New Order';
    
    // Pre-Install
    el.detailsForm['check-welcome-email'].checked = data.preInstallChecklist?.welcomeEmailSent || false;
    el.detailsForm['check-site-survey'].checked = data.preInstallChecklist?.addedToSiteSurvey || false;
    el.detailsForm['check-fiber-list'].checked = data.preInstallChecklist?.addedToFiberList || false;
    el.detailsForm['check-repair-shoppr'].checked = data.preInstallChecklist?.addedToRepairShoppr || false;
    
    // Install Details
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

// --- NEW: Click handler for all copy buttons ---
function handleDetailsFormClick(e) {
    const copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return; // Click wasn't on a copy button

    const targetId = copyBtn.dataset.target;
    if (!targetId) return;

    let textToCopy = '';
    
    // Find the target element
    const targetElement = document.getElementById(targetId);
    if (!targetElement) return;

    // Get text from either a <span> or an <input>/<textarea>
    if (targetElement.tagName === 'SPAN') {
        textToCopy = targetElement.textContent;
    } else {
        textToCopy = targetElement.value;
    }
    
    if (!textToCopy) {
        showToast('Nothing to copy.', 'error');
        return;
    }

    // --- Clipboard Copy Logic ---
    try {
        // Create a temporary textarea to securely copy
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        
        // Show visual feedback on the button
        copyBtn.classList.add('copied');
        // Reset all other copy buttons
        el.detailsForm.querySelectorAll('.copy-btn').forEach(btn => {
            if (btn !== copyBtn) btn.classList.remove('copied');
        });

        setTimeout(() => {
            copyBtn.classList.remove('copied');
        }, 1500); // Show checkmark for 1.5 seconds

    } catch (err) {
        console.error('Failed to copy text: ', err);
        showToast('Failed to copy.', 'error');
    }
}

async function handleUpdateCustomer(e) {
    e.preventDefault(); // Prevent form from submitting
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;

    // Construct the update object using dot notation
    // This is safer and prevents overwriting entire maps
    const updatedData = {
        'status': el.detailsForm['details-status'].value,
        
        'preInstallChecklist.welcomeEmailSent': el.detailsForm['check-welcome-email'].checked,
        'preInstallChecklist.addedToSiteSurvey': el.detailsForm['check-site-survey'].checked,
        'preInstallChecklist.addedToFiberList': el.detailsForm['check-fiber-list'].checked,
        'preInstallChecklist.addedToRepairShoppr': el.detailsForm['check-repair-shoppr'].checked,
        
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
        // onSnapshot will handle refreshing the data
    }
}

async function handleDeleteCustomer(e) {
    e.preventDefault(); // Prevent form from submitting
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;

    const customerName = el.detailsSoNumber.textContent; // Use SO# or name
    
    if (window.confirm(`Are you sure you want to delete customer ${customerName}? This cannot be undone.`)) {
        try {
            el.loadingOverlay.style.display = 'flex';
            const docRef = doc(customersCollectionRef, customerId);
            await deleteDoc(docRef);
            showToast('Customer deleted.', 'success');
            handleDeselectCustomer(); // Clear panel
            // onSnapshot will update the list
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
    e.preventDefault(); // Prevent form from submitting
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId || !customersCollectionRef) return;
    
    // Get the email and name from the populated (but disabled) form fields
    const toEmail = el.detailsEmail.textContent;
    const customerName = document.querySelector(`.customer-item[data-id="${customerId}"] h3`).textContent;
    
    if (!toEmail) {
        showToast('No customer email on file to send to.', 'error');
        return;
    }

    if (!window.confirm(`Send welcome email to ${customerName} at ${toEmail}?`)) {
        return;
    }

    el.loadingOverlay.style.display = 'flex';
    
    // 1. Create the email document in the 'mail' collection
    try {
        // We use the *user's* UID path for the mail collection,
        // which matches the new firestore.rules
        const mailCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'mail');
        
        await addDoc(mailCollectionRef, {
            to: [toEmail],
            // cc: ["billing@example.com"], // Add CCs here if needed
            template: {
                name: "cfnWelcome", // Use a template name
                data: {
                    customerName: customerName,
                },
            },
        });

        // 2. If email doc is created, update the customer's checklist
        const docRef = doc(customersCollectionRef, customerId);
        await updateDoc(docRef, {
            "preInstallChecklist.welcomeEmailSent": true
        });
        
        showToast('Welcome email sent!', 'success');
        // onSnapshot will update the checkbox
        
    } catch (error) {
        console.error("Error sending welcome email: ", error);
        showToast('Error sending email. Check console.', 'error');
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}

async function handleCopyBilling(e) {
    e.preventDefault(); // Prevent form from submitting
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId) return;

    // Fetch the latest data to ensure we copy the most up-to-date info
    try {
        const docRef = doc(customersCollectionRef, customerId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            showToast('Could not find customer data to copy.', 'error');
            return;
        }
        
        const data = docSnap.data();
        const customerName = document.querySelector(`.customer-item[data-id="${customerId}"] h3`).textContent;

        // Build the text block
        const billingText = `
Customer Name: ${customerName}
Service Order: ${data.serviceOrderNumber}
Address: ${data.address || ''}
Service: ${data.serviceSpeed}

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

        // Copy to clipboard
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
    
    // Reset classes
    el.toast.classList.remove('success', 'error');
    
    if (type === 'error') {
        el.toast.classList.add('error');
    } else {
        el.toast.classList.add('success');
    }
    el.toast.classList.add('show');

    // Hide after 3 seconds
    setTimeout(() => {
        el.toast.classList.remove('show');
    }, 3000);
}