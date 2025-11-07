// --- Import Firebase services from our new file ---
import { 
    db as importedDb, 
    auth as importedAuth,
    googleProvider,
    signInWithPopup,
    signOut
} from './firebase.js';

// --- Import Firebase SDK functions that we need ---
import { 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    addDoc, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot, 
    collection, 
    query 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Firebase & App State ---
let db, auth, userId, appId;
let customersUnsubscribe = null; // To store the onSnapshot listener
let currentSelectedCustomerId = null; // To track the active customer
let localCustomerCache = new Map(); // Cache for customer data

// --- DOM Element References ---
const el = {
    loadingOverlay: document.getElementById('loading-overlay'),
    authScreen: document.getElementById('auth-screen'),
    appScreen: document.getElementById('app-screen'),
    signInBtn: document.getElementById('sign-in-btn'),
    signOutBtn: document.getElementById('sign-out-btn'),
    authError: document.getElementById('auth-error'),
    userEmailDisplay: document.getElementById('user-email-display'),
    userIdDisplay: document.getElementById('user-id-display'),
    addCustomerForm: document.getElementById('add-customer-form'),
    customerList: document.getElementById('customer-list'),
    customerListEmpty: document.getElementById('customer-list-empty'),
    detailsContainer: document.getElementById('customer-details-content'),
    detailsEmpty: document.getElementById('customer-details-empty'),
    detailsForm: document.getElementById('details-form'),
    btnSendWelcome: document.getElementById('btn-send-welcome'),
    btnSaveDetails: document.getElementById('btn-save-details'),
    btnCopyBilling: document.getElementById('btn-copy-billing'),
    copySuccessMsg: document.getElementById('copy-success'),
    detailsCustomerName: document.getElementById('details-customer-name'),
    detailsSoNumber: document.getElementById('details-so-number'),
};

// --- Main Initializer ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Assign imported Firebase services to our global variables
    db = importedDb;
    auth = importedAuth;

    // 2. Get App ID from global scope (provided by the environment)
    appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    
    // 3. Handle Authentication
    handleAuthentication();

    // 4. Attach root event listeners
    setupEventListeners();
});

/**
 * Handles Firebase authentication using token or anonymous sign-in.
 */
async function handleAuthentication() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in, NOW check their email
            if (user.email && user.email.endsWith('@nptel.com')) {
                // User is valid
                userId = user.uid;
                console.log("Verified @nptel.com user:", userId, user.email);
                
                // Update UI
                el.userIdDisplay.textContent = userId;
                el.userEmailDisplay.textContent = user.email;
                el.authScreen.style.display = 'none';
                el.appScreen.style.display = 'block';
                el.authError.textContent = '';
                
                // User is logged in, now we can load their data
                loadCustomers();
            } else {
                // User is signed in but NOT from @nptel.com
                console.warn("Unauthorized user attempted login:", user.email);
                el.authError.textContent = 'Access is restricted to @nptel.com accounts.';
                signOut(auth); // Force sign out
                
                // Ensure app is hidden
                el.authScreen.style.display = 'flex';
                el.appScreen.style.display = 'none';
                el.loadingOverlay.style.display = 'none';
            }
        } else {
            // User is signed out
            console.log("User is not signed in.");
            if (customersUnsubscribe) customersUnsubscribe(); // Stop listening to data
            localCustomerCache.clear();
            el.authScreen.style.display = 'flex';
    
            el.appScreen.style.display = 'none';
            el.loadingOverlay.style.display = 'none';
            el.authError.textContent = '';
        }
    });
}

/**
 * Attaches all primary event listeners for the application.
 */
function setupEventListeners() {
    el.signInBtn.addEventListener('click', () => {
        el.authError.textContent = '';
        signInWithPopup(auth, googleProvider).catch(error => {
            console.error("Google Sign-In Error:", error);
            el.authError.textContent = `Error: ${error.message}`;
        });
    });

    el.signOutBtn.addEventListener('click', () => {
        if (customersUnsubscribe) {
            customersUnsubscribe();
            customersUnsubscribe = null;
        }
        signOut(auth);
    });

    el.addCustomerForm.addEventListener('submit', handleAddCustomer);
    el.btnSaveDetails.addEventListener('click', handleUpdateCustomer);
    el.btnSendWelcome.addEventListener('click', handleSendWelcomeEmail);
    el.btnCopyBilling.addEventListener('click', handleCopyBilling);
}

/**
 * Loads the customer list from Firestore and listens for real-time updates.
 */
function loadCustomers() {
    if (customersUnsubscribe) {
        customersUnsubscribe(); // Detach old listener if it exists
    }
    
    const customersCollectionPath = `artifacts/${appId}/users/${userId}/customers`;
    const q = query(collection(db, customersCollectionPath));

    console.log(`Listening for customers at: ${customersCollectionPath}`);

    customersUnsubscribe = onSnapshot(q, (snapshot) => {
        console.log(`Received ${snapshot.docs.length} customer docs.`);
        localCustomerCache.clear(); // Clear cache
        const docs = [];
        snapshot.forEach(doc => {
            localCustomerCache.set(doc.id, doc.data()); // Update cache
            docs.push(doc);
        });
        
        displayCustomerList(docs); // Re-render list

        // If a customer was selected, refresh their details
        if (currentSelectedCustomerId && localCustomerCache.has(currentSelectedCustomerId)) {
            populateDetailsForm(currentSelectedCustomerId);
        } else if (currentSelectedCustomerId) {
            // The selected customer was deleted
            clearDetailsForm();
        }
        
        // Only hide loading *after* first snapshot
        if (el.loadingOverlay.style.display !== 'none') {
            el.loadingOverlay.style.display = 'none';
        }
    }, (error) => {
        console.error("Error loading customers:", error);
        el.loadingOverlay.innerText = "Error loading data.";
    });
}

/**
 * Renders the customer list in the UI.
 * @param {Array} docs - Array of Firestore document snapshots.
 */
function displayCustomerList(docs) {
    el.customerList.innerHTML = ''; // Clear list
    if (docs.length === 0) {
        el.customerListEmpty.style.display = 'block';
        return;
    }

    el.customerListEmpty.style.display = 'none';
    
    // Sort docs by customer name (in-memory sort)
    docs.sort((a, b) => {
        const nameA = a.data().customerName || '';
        const nameB = b.data().customerName || '';
        return nameA.localeCompare(nameB);
    });

    docs.forEach(doc => {
        const customer = doc.data();
        const customerId = doc.id;
        
        const isActive = (customerId === currentSelectedCustomerId);
        const cardClasses = isActive 
            ? 'bg-sky-100 border-sky-500' 
            : 'bg-white hover:bg-gray-50';

        const card = document.createElement('div');
        card.className = `p-4 rounded-lg shadow border cursor-pointer ${cardClasses}`;
        card.dataset.id = customerId; // Store doc ID
        card.innerHTML = `
            <h3 class="font-semibold text-gray-900">${customer.customerName}</h3>
            <p class="text-sm text-gray-600">${customer.serviceOrderNumber}</p>
            <p class="text-xs text-sky-700 font-medium mt-1">${customer.status || 'New Order'}</p>
        `;
        
        // Add click listener to show details
        card.addEventListener('click', () => {
            currentSelectedCustomerId = customerId;
            populateDetailsForm(customerId);
            // Re-render list to show active state
            displayCustomerList(docs); 
        });
        
        el.customerList.appendChild(card);
    });
}

/**
 * Handles the "Add Customer" form submission.
 * @param {Event} e - The form submit event.
 */
async function handleAddCustomer(e) {
    e.preventDefault();
    const formData = new FormData(el.addCustomerForm);
    
    const newCustomer = {
        serviceOrderNumber: formData.get('so-number'),
        customerName: formData.get('customer-name'),
        serviceSpeed: formData.get('service-speed'),
        status: "New Order",
        primaryContact: {
            email: formData.get('primary-email'),
            phone: formData.get('primary-phone'),
        },
        secondaryContact: {
            name: formData.get('secondary-name'),
            phone: formData.get('secondary-phone'),
        },
        preInstallChecklist: {
            welcomeEmailSent: false,
            addedToSiteSurvey: false,
            addedToFiberList: false,
            addedToRepairShoppr: false,
        },
        installDetails: {
            installDate: "",
            eeroInfo: "",
            nidLightReading: "",
            additionalEquipment: "",
            generalNotes: "",
        },
        postInstallChecklist: {
            removedFromFiberList: false,
            removedFromSiteSurvey: false,
            updatedRepairShoppr: false,
        },
        // Add createdAt timestamp
        createdAt: new Date().toISOString()
    };

    try {
        const collectionPath = `artifacts/${appId}/users/${userId}/customers`;
        el.loadingOverlay.style.display = 'flex';
        await addDoc(collection(db, collectionPath), newCustomer);
        console.log("Customer added!");
        el.addCustomerForm.reset();
    } catch (error) {
        console.error("Error adding customer: ", error);
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}

/**
 * Populates the details form with data for a specific customer.
 * @param {string} customerId - The Firestore document ID of the customer.
 */
function populateDetailsForm(customerId) {
    const customer = localCustomerCache.get(customerId);
    if (!customer) {
        console.warn(`No customer data in cache for ID: ${customerId}`);
        return;
    }

    el.detailsContainer.dataset.id = customerId; // Store current ID on the form
    el.detailsContainer.style.display = 'block';
    el.detailsEmpty.style.display = 'none';

    // --- Fill Form ---
    el.detailsCustomerName.textContent = customer.customerName;
    el.detailsSoNumber.textContent = customer.serviceOrderNumber;

    // Status
    el.detailsForm['details-status'].value = customer.status || 'New Order';

    // Read-only info
    el.detailsForm['details-service-speed'].value = customer.serviceSpeed || '';
    el.detailsForm['details-primary-email'].value = customer.primaryContact?.email || '';

    // Pre-Install Checklist
    el.detailsForm['check-welcome-email'].checked = customer.preInstallChecklist?.welcomeEmailSent || false;
    el.detailsForm['check-site-survey'].checked = customer.preInstallChecklist?.addedToSiteSurvey || false;
    el.detailsForm['check-fiber-list'].checked = customer.preInstallChecklist?.addedToFiberList || false;
    el.detailsForm['check-repair-shoppr'].checked = customer.preInstallChecklist?.addedToRepairShoppr || false;
    
    // Manage welcome email button state
    el.btnSendWelcome.disabled = customer.preInstallChecklist?.welcomeEmailSent || false;

    // Install Details
    el.detailsForm['install-date'].value = customer.installDetails?.installDate || '';
    el.detailsForm['eero-info'].value = customer.installDetails?.eeroInfo || '';
    el.detailsForm['nid-light'].value = customer.installDetails?.nidLightReading || '';
    el.detailsForm['extra-equip'].value = customer.installDetails?.additionalEquipment || '';
    el.detailsForm['general-notes'].value = customer.installDetails?.generalNotes || '';

    // Post-Install Checklist
    el.detailsForm['post-check-fiber'].checked = customer.postInstallChecklist?.removedFromFiberList || false;
    el.detailsForm['post-check-survey'].checked = customer.postInstallChecklist?.removedFromSiteSurvey || false;
    el.detailsForm['post-check-repair'].checked = customer.postInstallChecklist?.updatedRepairShoppr || false;
}

/**
 * Clears and hides the customer details form.
 */
function clearDetailsForm() {
    currentSelectedCustomerId = null;
    el.detailsContainer.style.display = 'none';
    el.detailsEmpty.style.display = 'block';
    el.detailsContainer.dataset.id = '';
    el.detailsForm.reset();
}

/**
 * Saves all data from the details form back to Firestore.
 */
async function handleUpdateCustomer() {
    const customerId = el.detailsContainer.dataset.id;
    if (!customerId) return;

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
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/customers`, customerId);
        await updateDoc(docRef, updatedData);
        console.log("Customer updated!");
    } catch (error) {
        console.error("Error updating customer: ", error);
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}

/**
 * Simulates sending a welcome email by creating a 'mail' doc
 * and updating the customer's 'welcomeEmailSent' flag.
 * * This relies on the "Trigger Email" Firebase Extension.
 * An alternative (like your contract-generator) is to call a custom
 * Cloud Function here instead.
 */
async function handleSendWelcomeEmail() {
    const customerId = el.detailsContainer.dataset.id;
    const customer = localCustomerCache.get(customerId);
    if (!customer) return;

    // 1. Create the 'mail' document for the Trigger Email extension
    const mailRequest = {
        to: customer.primaryContact.email,
        template: {
            name: 'welcome', // This name must match a template in your Firestore
            data: {
                customerName: customer.customerName,
                serviceOrderNumber: customer.serviceOrderNumber,
                serviceSpeed: customer.serviceSpeed
                // any other template variables
            },
        },
    };

    try {
        el.loadingOverlay.style.display = 'flex';
        
        // Path for mail doc (can be public or private, depends on rules)
        // Using a user-private path here:
        const mailCollectionPath = `artifacts/${appId}/users/${userId}/mail`;
        await addDoc(collection(db, mailCollectionPath), mailRequest);
        console.log("Mail request added (for Trigger Email extension).");

        // 2. Update the customer document
        const customerDocRef = doc(db, `artifacts/${appId}/users/${userId}/customers`, customerId);
        await updateDoc(customerDocRef, {
            "preInstallChecklist.welcomeEmailSent": true
        });
        
        console.log("Customer flag 'welcomeEmailSent' set to true.");
        // The onSnapshot listener will automatically update the UI
        
    } catch (error) {
        console.error("Error sending welcome email (simulation):", error);
    } finally {
        el.loadingOverlay.style.display = 'none';
    }
}

/**
 * Gathers all customer data and copies it to the clipboard
 * in a formatted string for billing.
 */
function handleCopyBilling() {
    const customerId = el.detailsContainer.dataset.id;
    const customer = localCustomerCache.get(customerId);
    if (!customer) return;

    // Use the *current* form state for copy, in case changes were made
    const installDate = el.detailsForm['install-date'].value;
    const eeroInfo = el.detailsForm['eero-info'].value;
    const nidLight = el.detailsForm['nid-light'].value;
    const extraEquip = el.detailsForm['extra-equip'].value;
    const generalNotes = el.detailsForm['general-notes'].value;
    
    // Create the formatted text block
    const billingInfo = `
--- BILLING & COMPLETION SUMMARY ---

Customer Name: ${customer.customerName}
Service Order #: ${customer.serviceOrderNumber}
Service: ${customer.serviceSpeed}

--- Contact Info ---
Primary Email: ${customer.primaryContact?.email}
Primary Phone: ${customer.primaryContact?.phone}

--- Install Details ---
Install Date: ${installDate || 'N/A'}
Eero Insight Info: ${eeroInfo || 'N/A'}
NID Light Reading: ${nidLight || 'N/A'}
Additional Equipment: ${extraEquip || 'N/A'}

--- General Notes ---
${generalNotes || 'N/A'}

--- Post-Install Checklist ---
Removed from Fiber List: ${el.detailsForm['post-check-fiber'].checked}
Removed from Site Survey: ${el.detailsForm['post-check-survey'].checked}
Updated Repair Shoppr: ${el.detailsForm['post-check-repair'].checked}
`;

    // Copy to clipboard
    copyToClipboard(billingInfo.trim());

    // Show success message
    el.copySuccessMsg.style.display = 'block';
    setTimeout(() => {
        el.copySuccessMsg.style.display = 'none';
    }, 2000);
}

/**
 * Helper function to copy text to the clipboard, with fallback.
 * @param {string} text - The text to copy.
 */
function copyToClipboard(text) {
    // Modern way (if in secure context)
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(err => {
            console.warn('Modern copy failed, using fallback.', err);
            fallbackCopy(text);
        });
    } else {
        // Fallback for http or iframes
        fallbackCopy(text);
    }
}

/**
 * Fallback method for copying text to clipboard.
 */
function fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            console.log('Fallback: Copying text command was successful');
        } else {
            console.error('Fallback: Copying text command was unsuccessful');
        }
    } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
    }

    document.body.removeChild(textArea);
}