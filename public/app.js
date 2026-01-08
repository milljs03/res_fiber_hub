// Import initialized services from firebase.js
import { db, auth, googleProvider, signInWithPopup, signOut } from './firebase.js';

// Import necessary Firestore functions
import {
    collection, doc, addDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, serverTimestamp, setDoc
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
let settingsCollectionRef = null; // New for general notes
let selectedCustomerId = null;
let allCustomers = []; 
let currentSort = 'date'; 
let currentFilter = 'All'; // Corresponds to Pills
let currentMainTab = 'Active'; // Active, Billing, Archived
const storage = getStorage();
let tempUploadedPdfUrl = null;
let notesDebounceTimer = null; // For autosave

// Charts
let monthlyChart = null;
let speedChart = null;
let townChart = null; // New

// Temporary Contact State (for Modal and Details)
let modalContacts = [];
let detailsContacts = [];

// --- HELPER FUNCTIONS (Hoisted) ---

function isChecked(id) { return document.getElementById(id)?.checked || false; }
function setCheck(id, val) { if(document.getElementById(id)) document.getElementById(id).checked = !!val; }
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setVal(id, val) { if(document.getElementById(id)) document.getElementById(id).value = val || ''; }

function toTitleCase(str) {
    if (!str) return '';
    return str.replace(
        /\w\S*/g,
        (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
}

function showToast(msg, type) {
    el.toast.textContent = msg;
    el.toast.className = type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white';
    el.toast.classList.add('show');
    // Re-trigger styles for the toast content if needed
    el.toast.style.padding = '12px 24px';
    el.toast.style.borderRadius = '8px';
    el.toast.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    
    setTimeout(() => el.toast.classList.remove('show'), 3000);
}

function copyToClipboard(btn) {
    const targetId = btn.dataset.target;
    // Handle both input elements and text content if target is a data attribute on the button itself or passed directly
    let textToCopy = '';
    
    if (targetId) {
        const element = document.getElementById(targetId);
        if(element) {
            textToCopy = element.value || element.textContent;
        }
    } else if (btn.dataset.text) {
        // Fallback: Use data-text attribute directly
        textToCopy = btn.dataset.text;
    }

    if(textToCopy) {
        navigator.clipboard.writeText(textToCopy);
        btn.classList.add('text-green-500');
        // If it's an icon button, maybe change the icon momentarily?
        // For now just color change
        setTimeout(() => btn.classList.remove('text-green-500'), 1500);
        showToast('Copied to clipboard', 'success');
    }
}

// --- CONTACTS HELPERS ---
function addContact(list, contact) {
    if (!contact.id) contact.id = Date.now().toString();
    list.push(contact);
}

function removeContact(list, id) {
    const idx = list.findIndex(c => c.id === id);
    if (idx !== -1) list.splice(idx, 1);
}

function handleDeleteContact(e, list, container) {
    const btn = e.target.closest('.delete-contact-btn');
    if (btn) {
        e.stopPropagation(); // Prevent bubbling if container has click listeners
        removeContact(list, btn.dataset.id);
        renderContacts(container, list, true);
    }
}

// Handle copying contact info
function handleCopyContact(e) {
    const btn = e.target.closest('.copy-contact-btn');
    if (btn) {
        e.stopPropagation();
        copyToClipboard(btn);
    }
}

function renderContacts(container, list, isEditable) {
    container.innerHTML = '';
    
    // Remove previous event listeners to avoid duplication if any (though innerHTML clears children)
    // We'll attach a single delegation listener to the container once in setupEventListeners instead of here
    // But for simplicity in this specific render function, we rely on the onclick attributes or delegated listeners setup elsewhere.
    // Since we are adding buttons dynamically, let's ensure the container handles the clicks.
    
    if (list.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 italic">No contacts added.</div>';
        return;
    }
    
    list.forEach(c => {
        const card = document.createElement('div');
        card.className = 'contact-card group relative'; // Added group for hover effects if needed
        let icon = 'phone';
        if (c.type === 'Work') icon = 'briefcase';
        else if (c.type === 'Home') icon = 'home';
        else if (c.type === 'Mobile') icon = 'smartphone';
        
        card.innerHTML = `
            <div class="contact-icon-wrapper"><i data-lucide="${icon}" width="16" height="16"></i></div>
            <div class="contact-info">
                <span class="contact-type-badge">${c.type}</span>
                <div class="flex items-center gap-2">
                    <a href="tel:${c.number}" class="contact-number hover:underline">${c.number}</a>
                    <button type="button" class="copy-contact-btn text-gray-400 hover:text-blue-500 transition p-1 rounded" data-text="${c.number}" title="Copy Number">
                        <i data-lucide="copy" width="12" height="12"></i>
                    </button>
                </div>
                <div class="contact-name">${c.name || ''}</div>
            </div>
            <div class="contact-actions">
                ${isEditable ? `<button type="button" class="btn-icon-sm delete-contact-btn text-gray-400 hover:text-red-500" data-id="${c.id}"><i data-lucide="trash-2" width="14" height="14"></i></button>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
    if(window.lucide) window.lucide.createIcons();
}

// --- DOM Elements Mapping ---
const el = {
    // Auth & Navigation
    authScreen: document.getElementById('auth-screen'),
    appScreen: document.getElementById('app-screen'),
    signInBtn: document.getElementById('sign-in-btn'),
    signOutBtn: document.getElementById('sign-out-btn'),
    authError: document.getElementById('auth-error'),
    userEmailDisplay: document.getElementById('user-email'),
    themeToggleBtn: document.getElementById('theme-toggle-btn'),
    toggleAnalyticsBtn: document.getElementById('toggle-analytics-btn'), // New

    // Analytics
    analyticsDashboard: document.getElementById('analytics-dashboard'), // New
    analyticsStagesList: document.getElementById('analytics-stages-list'), // New
    analyticsTotalPipeline: document.getElementById('analytics-total-pipeline'), // New
    chartMonthlyInstalls: document.getElementById('chart-monthly-installs'), // New
    chartSpeedTiers: document.getElementById('chart-speed-tiers'), // New
    chartTowns: document.getElementById('chart-towns'), // New
    analyticsAvgTime: document.getElementById('analytics-avg-time'), // New
    analyticsTotalCustomers: document.getElementById('analytics-total-customers'), // New

    // General Notes
    appGeneralNotes: document.getElementById('app-general-notes'), // New
    notesStatus: document.getElementById('notes-status'), // New

    // Add Form (Modal)
    addCustomerModal: document.getElementById('add-customer-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    newCustomerBtn: document.getElementById('new-customer-btn'),
    addForm: document.getElementById('add-customer-form'),
    // Add Form Inputs
    soNumberInput: document.getElementById('so-number'),
    customerNameInput: document.getElementById('customer-name'),
    addressInput: document.getElementById('address'),
    customerEmailInput: document.getElementById('customer-email'),
    serviceSpeedInput: document.getElementById('service-speed'),
    
    // Modal Contacts UI
    modalContactsList: document.getElementById('modal-contacts-list'),
    modalShowAddContactBtn: document.getElementById('modal-show-add-contact-btn'),
    modalAddContactForm: document.getElementById('modal-add-contact-form'),
    modalConfirmAddContact: document.getElementById('modal-confirm-add-contact'),
    modalCancelAddContact: document.getElementById('modal-cancel-add-contact'),
    modalNewContactType: document.getElementById('modal-new-contact-type'),
    modalNewContactNumber: document.getElementById('modal-new-contact-number'),
    modalNewContactName: document.getElementById('modal-new-contact-name'),

    // PDF Processing
    pdfDropZone: document.getElementById('pdf-drop-zone'),
    pdfUploadInput: document.getElementById('pdf-upload'),
    selectedFileNameDisplay: document.getElementById('selected-file-name'),
    processPdfBtn: document.getElementById('process-pdf-btn'),
    pdfStatusMsg: document.getElementById('pdf-status-msg'),

    // Dashboard Controls
    contractsTable: document.getElementById('contractsTable'), // The Tbody
    tableEmptyState: document.getElementById('table-empty-state'),
    tableLoading: document.getElementById('table-loading'),
    loadingOverlay: document.getElementById('loading-overlay'),
    searchBar: document.getElementById('search-bar'),
    mainListTabs: document.getElementById('main-list-tabs'),
    filterPillsContainer: document.getElementById('filter-pills'),

    // DETAILS MODAL
    detailsModal: document.getElementById('details-container-modal'),
    detailsModalCloseBtn: document.getElementById('details-modal-close-btn'),
    detailsContainer: document.getElementById('details-container'),
    detailsForm: document.getElementById('details-form'),

    // Details Header
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

    // Details Inputs
    detailsCustomerNameInput: document.getElementById('details-customer-name'), 
    detailsSoNumberInput: document.getElementById('details-so-number'),
    detailsAddressInput: document.getElementById('details-address'),
    detailsSpeedInput: document.getElementById('details-speed'),
    detailsEmailInput: document.getElementById('details-email'),
    detailsGeneralNotes: document.getElementById('details-general-notes'),

    // Details Contacts UI
    detailsContactsList: document.getElementById('details-contacts-list'),
    detailsShowAddContactBtn: document.getElementById('details-show-add-contact-btn'),
    detailsAddContactForm: document.getElementById('details-add-contact-form'),
    detailsConfirmAddContact: document.getElementById('details-confirm-add-contact'),
    detailsCancelAddContact: document.getElementById('details-cancel-add-contact'),
    detailsNewContactType: document.getElementById('details-new-contact-type'),
    detailsNewContactNumber: document.getElementById('details-new-contact-number'),
    detailsNewContactName: document.getElementById('details-new-contact-name'),

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
        
        customersCollectionRef = collection(db, 'artifacts', currentAppId, 'public', 'data', 'customers');
        mailCollectionRef = collection(db, 'artifacts', currentAppId, 'users', currentUserId, 'mail');
        settingsCollectionRef = collection(db, 'artifacts', currentAppId, 'public', 'data', 'settings'); // Use settings for general notes

        el.appScreen.classList.remove('hidden');
        el.authScreen.classList.add('hidden');
        initializeApp();
    } else {
        currentUserId = null;
        el.appScreen.classList.add('hidden');
        el.authScreen.classList.remove('hidden');
        if (user) {
            el.authError.textContent = 'Access restricted to @nptel.com accounts.';
            signOut(auth);
        }
    }
});

const initializeApp = () => {
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    
    // Check local storage for theme
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    setupEventListeners();
    loadCustomers();
    loadGeneralNotes();
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
    // Theme Toggle
    el.themeToggleBtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        localStorage.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    });

    // Analytics Toggle
    el.toggleAnalyticsBtn.addEventListener('click', () => {
        el.analyticsDashboard.classList.toggle('hidden');
        if (!el.analyticsDashboard.classList.contains('hidden')) {
            renderAnalytics();
        }
    });

    // General Notes Autosave and Auto-expand
    el.appGeneralNotes.addEventListener('input', () => {
        // Auto-expand
        el.appGeneralNotes.style.height = 'auto';
        el.appGeneralNotes.style.height = (el.appGeneralNotes.scrollHeight) + 'px';

        // Autosave Logic
        el.notesStatus.textContent = 'Saving...';
        el.notesStatus.classList.remove('opacity-0');
        
        clearTimeout(notesDebounceTimer);
        notesDebounceTimer = setTimeout(saveGeneralNotes, 1500);
    });

    // Add Modal logic
    el.newCustomerBtn.addEventListener('click', openAddCustomerModal);
    el.modalCloseBtn.addEventListener('click', closeAddCustomerModal);
    el.addCustomerModal.addEventListener('click', (e) => {
        if (e.target === el.addCustomerModal) closeAddCustomerModal();
    });
    el.addForm.addEventListener('submit', handleAddCustomer);

    // Modal Contacts Logic
    el.modalShowAddContactBtn.addEventListener('click', () => {
        el.modalShowAddContactBtn.classList.add('hidden');
        el.modalAddContactForm.classList.remove('hidden');
    });
    el.modalCancelAddContact.addEventListener('click', () => {
        el.modalAddContactForm.classList.add('hidden');
        el.modalShowAddContactBtn.classList.remove('hidden');
        el.modalNewContactNumber.value = '';
        el.modalNewContactName.value = '';
    });
    el.modalConfirmAddContact.addEventListener('click', () => {
        const type = el.modalNewContactType.value;
        const number = el.modalNewContactNumber.value.trim();
        const name = el.modalNewContactName.value.trim();
        if (number) {
            addContact(modalContacts, { type, number, name });
            renderContacts(el.modalContactsList, modalContacts, true);
            el.modalNewContactNumber.value = '';
            el.modalNewContactName.value = '';
            el.modalAddContactForm.classList.add('hidden');
            el.modalShowAddContactBtn.classList.remove('hidden');
        }
    });

    // Details Contacts Logic
    el.detailsShowAddContactBtn.addEventListener('click', () => {
        el.detailsShowAddContactBtn.classList.add('hidden');
        el.detailsAddContactForm.classList.remove('hidden');
    });
    el.detailsCancelAddContact.addEventListener('click', () => {
        el.detailsAddContactForm.classList.add('hidden');
        el.detailsShowAddContactBtn.classList.remove('hidden');
        el.detailsNewContactNumber.value = '';
        el.detailsNewContactName.value = '';
    });
    el.detailsConfirmAddContact.addEventListener('click', () => {
        const type = el.detailsNewContactType.value;
        const number = el.detailsNewContactNumber.value.trim();
        const name = el.detailsNewContactName.value.trim();
        if (number) {
            addContact(detailsContacts, { type, number, name });
            renderContacts(el.detailsContactsList, detailsContacts, true);
            el.detailsNewContactNumber.value = '';
            el.detailsNewContactName.value = '';
            el.detailsAddContactForm.classList.add('hidden');
            el.detailsShowAddContactBtn.classList.remove('hidden');
        }
    });
    // Contact Deletion & Copy (using Delegation)
    const handleContactListAction = (e, list, container) => {
        if (e.target.closest('.delete-contact-btn')) {
            handleDeleteContact(e, list, container);
        } else if (e.target.closest('.copy-contact-btn')) {
            handleCopyContact(e);
        }
    };

    el.modalContactsList.addEventListener('click', (e) => handleContactListAction(e, modalContacts, el.modalContactsList));
    el.detailsContactsList.addEventListener('click', (e) => handleContactListAction(e, detailsContacts, el.detailsContactsList));

    // PDF Processing
    el.processPdfBtn.addEventListener('click', handlePdfProcessing);
    el.pdfDropZone.addEventListener('click', () => el.pdfUploadInput.click());
    el.pdfDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.pdfDropZone.classList.add('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/30');
    });
    el.pdfDropZone.addEventListener('dragleave', () => {
        el.pdfDropZone.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/30');
    });
    el.pdfDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        el.pdfDropZone.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/30');
        if (e.dataTransfer.files.length > 0) {
            el.pdfUploadInput.files = e.dataTransfer.files;
            updateSelectedFileDisplay();
        }
    });
    el.pdfUploadInput.addEventListener('change', updateSelectedFileDisplay);

    // Filter Logic
    el.searchBar.addEventListener('input', displayCustomers);

    // Main Tabs (Active / Billing / Archived)
    el.mainListTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        el.mainListTabs.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentMainTab = btn.dataset.mainFilter;
        if(currentMainTab !== 'Active') resetPills();
        displayCustomers();
    });

    // Pills (Stages)
    el.filterPillsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.pill');
        if (!btn) return;
        el.filterPillsContainer.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        displayCustomers();
    });

    // Details Modal Logic
    el.detailsModalCloseBtn.addEventListener('click', closeDetailsModal);
    el.detailsModal.addEventListener('click', (e) => { if(e.target === el.detailsModal) closeDetailsModal(); });
    
    // Details Actions
    el.mobileBackBtn.addEventListener('click', closeDetailsModal);
    el.updateCustomerBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, 0));
    el.saveAndProgressBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, 1));
    el.headerMoveBackBtn.addEventListener('click', (e) => handleUpdateCustomer(e, false, -1));
    el.onHoldButton.addEventListener('click', handleToggleOnHold);
    el.deleteCustomerBtn.addEventListener('click', handleDeleteCustomer);
    
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

const resetPills = () => {
    el.filterPillsContainer.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    const allBtn = el.filterPillsContainer.querySelector('[data-filter="All"]');
    if(allBtn) allBtn.classList.add('active');
    currentFilter = 'All';
};

// --- 3. DATA & LIST LOGIC ---

const loadCustomers = () => {
    if (!customersCollectionRef) return;
    const q = query(customersCollectionRef);
    onSnapshot(q, (snapshot) => {
        el.tableLoading.classList.add('hidden');
        allCustomers = [];
        snapshot.forEach((doc) => {
            let data = doc.data();
            if (data.status === "Tory's List") data.status = "Torys List";
            allCustomers.push({ id: doc.id, ...data });
        });
        displayCustomers();
        if (!el.analyticsDashboard.classList.contains('hidden')) {
            renderAnalytics();
        }
        
        // Refresh selected if open
        if (selectedCustomerId) {
            const fresh = allCustomers.find(c => c.id === selectedCustomerId);
            if (fresh) populateDetailsForm(fresh);
            else closeDetailsModal();
        }
    }, (error) => {
        console.error(error);
        el.tableLoading.innerHTML = `<p class="text-red-500">Error loading data.</p>`;
    });
};

const loadGeneralNotes = () => {
    if (!settingsCollectionRef) return;
    const notesDocRef = doc(settingsCollectionRef, 'general_notes');
    onSnapshot(notesDocRef, (docSnap) => {
        if (docSnap.exists()) {
            // Only update value if not currently focused to avoid overwriting typing
            if (document.activeElement !== el.appGeneralNotes) {
                el.appGeneralNotes.value = docSnap.data().content || '';
                // Adjust height after loading content
                el.appGeneralNotes.style.height = 'auto';
                el.appGeneralNotes.style.height = (el.appGeneralNotes.scrollHeight) + 'px';
            }
        }
    });
};

const saveGeneralNotes = async () => {
    if (!settingsCollectionRef) return;
    const content = el.appGeneralNotes.value;
    const notesDocRef = doc(settingsCollectionRef, 'general_notes');
    
    try {
        await setDoc(notesDocRef, { content: content }, { merge: true });
        el.notesStatus.textContent = 'Saved';
        setTimeout(() => {
            el.notesStatus.classList.add('opacity-0');
        }, 2000);
    } catch (err) {
        console.error("Error saving notes:", err);
        el.notesStatus.textContent = 'Error saving';
    }
};

const displayCustomers = () => {
    const term = el.searchBar.value.toLowerCase();
    let filtered = [...allCustomers];

    // Main Tab Filter
    if (currentMainTab === 'Archived') {
        filtered = filtered.filter(c => c.status === 'Archived');
    } else if (currentMainTab === 'Billing') {
        filtered = filtered.filter(c => 
            c.status === 'Completed' && 
            (!c.postInstallChecklist || !c.postInstallChecklist.emailSentToBilling)
        );
    } else {
        // Active
        filtered = filtered.filter(c => c.status !== 'Archived' && c.status !== 'Completed');
    }

    // Pill Filter
    if (currentFilter !== 'All') {
        filtered = filtered.filter(c => c.status === currentFilter);
    }

    // Search
    if (term) {
        filtered = filtered.filter(c => 
            (c.customerName || '').toLowerCase().includes(term) || 
            (c.address || '').toLowerCase().includes(term) ||
            (c.serviceOrderNumber || '').toLowerCase().includes(term)
        );
    }

    // Sort
    filtered.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    renderCustomerList(filtered);
};

const renderCustomerList = (list) => {
    el.contractsTable.innerHTML = '';
    
    if (list.length === 0) {
        el.tableEmptyState.classList.remove('hidden');
        return;
    }
    el.tableEmptyState.classList.add('hidden');

    list.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 dark:hover:bg-gray-700 transition cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-0";
        tr.onclick = () => handleSelectCustomer(c.id);

        let dateDisplay = '-';
        if (c.createdAt?.seconds) {
            dateDisplay = new Date(c.createdAt.seconds * 1000).toLocaleDateString();
        }

        const slug = (c.status || '').toLowerCase().replace(/'/g, '').replace(/ /g, '-');
        let displayStatus = c.status;
        if (displayStatus === "Torys List") displayStatus = "Construction";

        // Calculate days in current stage
        let daysInStage = 0;
        let lastStatusChange = c.createdAt?.seconds * 1000;
        
        if (c.status === "Torys List" && c.torysListChecklist?.addedAt) {
            lastStatusChange = c.torysListChecklist.addedAt.seconds * 1000;
        } 

        const diffTime = Math.abs(Date.now() - lastStatusChange);
        daysInStage = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-semibold text-gray-900 dark:text-white">${c.customerName || 'Unknown'}</div>
                <div class="text-xs text-gray-400 dark:text-gray-500">SO# ${c.serviceOrderNumber || 'N/A'}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                <div class="max-w-[200px] truncate" title="${c.address || ''}">${c.address || '-'}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                ${c.serviceSpeed || '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                ${dateDisplay}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="status-badge status-${slug}">
                    ${displayStatus} - ${daysInStage} days
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button class="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 transition">
                    <i data-lucide="chevron-right" class="w-5 h-5"></i>
                </button>
            </td>
        `;
        el.contractsTable.appendChild(tr);
    });
    
    if(window.lucide) window.lucide.createIcons();
};

// --- ANALYTICS LOGIC ---

const renderAnalytics = () => {
    // 1. Stage Counts
    const counts = {
        'New Order': 0,
        'Site Survey Ready': 0,
        'Torys List': 0,
        'NID Ready': 0,
        'Install Ready': 0,
        'On Hold': 0
    };
    
    let totalPipelineCount = 0;
    
    // Only count non-archived/non-completed for the pipeline view
    allCustomers.forEach(c => {
        if (c.status !== 'Archived' && c.status !== 'Completed') {
            if (counts[c.status] !== undefined) {
                counts[c.status]++;
                totalPipelineCount++;
            }
        }
    });

    el.analyticsStagesList.innerHTML = '';
    Object.keys(counts).forEach(stage => {
        let displayStage = stage;
        if (stage === 'Torys List') displayStage = 'Construction';
        if (stage === 'Site Survey Ready') displayStage = 'Survey';
        
        const count = counts[stage];
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center text-sm border-b border-gray-100 dark:border-gray-700 pb-1 last:border-0';
        row.innerHTML = `
            <span class="text-gray-600 dark:text-gray-300">${displayStage}</span>
            <span class="font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full text-xs">${count}</span>
        `;
        el.analyticsStagesList.appendChild(row);
    });
    
    // Display total pipeline count
    if (el.analyticsTotalPipeline) {
        el.analyticsTotalPipeline.textContent = totalPipelineCount;
    }

    // 2. Monthly Installs (Archived customers with Install Date)
    const monthlyData = {};
    let totalInstallTimeDays = 0;
    let installTimeCount = 0;
    let totalCustomersAllTime = 0; // NEW: Track total customers

    // 4. Town Counts
    const townCounts = {};
    const validTowns = ['goshen', 'new paris', 'nappanee', 'syracuse', 'milford', 'bristol', 'middlebury', 'elkhart', 'wakarusa'];

    allCustomers.forEach(c => {
        // Count total customers (active, completed, AND archived)
        totalCustomersAllTime++;
        
        // Town Extraction
        if (c.address) {
            const addrLower = c.address.toLowerCase();
            let foundTown = null;
            
            for (const town of validTowns) {
                // Simple inclusion check, might need regex for strict word boundaries if collisions occur (e.g. "new paris" vs "paris")
                // Given the specific list, simple inclusion usually works, but check longest matches first if needed.
                if (addrLower.includes(town)) {
                    foundTown = town;
                    break; 
                }
            }

            if (foundTown) {
                const displayTown = toTitleCase(foundTown);
                townCounts[displayTown] = (townCounts[displayTown] || 0) + 1;
            } else {
                // Optional: categorize as 'Other' or ignore
                // townCounts['Other'] = (townCounts['Other'] || 0) + 1;
            }
        }

        // Consider Archived customers
        if (c.status === 'Archived') {
            
            // Logic for Monthly Chart based on Install Date
            if (c.installDetails?.installDate) {
                // YYYY-MM-DD
                const dateStr = c.installDetails.installDate;
                const monthKey = dateStr.substring(0, 7); // YYYY-MM
                monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1;

                // Logic for Average Install Time (Creation to Install Date)
                if (c.createdAt?.seconds) {
                    const createdDate = new Date(c.createdAt.seconds * 1000);
                    // Install date string is YYYY-MM-DD, parse manually to avoid timezone issues or use simple new Date
                    const [y, m, d] = dateStr.split('-');
                    const installDate = new Date(y, m - 1, d);
                    
                    const timeDiff = installDate - createdDate;
                    const dayDiff = timeDiff / (1000 * 3600 * 24);
                    
                    if (dayDiff >= 0) { // sanity check
                        totalInstallTimeDays += dayDiff;
                        installTimeCount++;
                    }
                }
            }
        }
    });
    
    // Display total customers count
    if (el.analyticsTotalCustomers) {
        el.analyticsTotalCustomers.textContent = totalCustomersAllTime;
    }
    
    // Sort months
    const sortedMonths = Object.keys(monthlyData).sort();
    // Take last 6 months for chart clarity
    const recentMonths = sortedMonths.slice(-6);
    
    const monthlyLabels = recentMonths.map(m => {
        const [y, mon] = m.split('-');
        const date = new Date(y, mon - 1);
        return date.toLocaleDateString('default', { month: 'short' });
    });
    const monthlyValues = recentMonths.map(m => monthlyData[m]);

    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(el.chartMonthlyInstalls, {
        type: 'bar',
        data: {
            labels: monthlyLabels,
            datasets: [{
                label: 'Installs',
                data: monthlyValues,
                backgroundColor: '#3b82f6',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#e5e7eb' }, ticks: { stepSize: 1 } },
                x: { grid: { display: false } }
            }
        }
    });

    // 3. Speed Tier Distribution
    const speedCounts = {};
    allCustomers.forEach(c => {
        // Count all customers or just active? Let's count all non-archived to see demand
        if (c.status !== 'Archived') {
            const speed = c.serviceSpeed || 'Unknown';
            speedCounts[speed] = (speedCounts[speed] || 0) + 1;
        }
    });

    const speedLabels = Object.keys(speedCounts);
    const speedValues = Object.values(speedCounts);

    if (speedChart) speedChart.destroy();
    speedChart = new Chart(el.chartSpeedTiers, {
        type: 'doughnut',
        data: {
            labels: speedLabels,
            datasets: [{
                data: speedValues,
                backgroundColor: [
                    '#3b82f6', // blue
                    '#10b981', // green
                    '#f59e0b', // amber
                    '#6366f1', // indigo
                    '#ec4899'  // pink
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }
            },
            cutout: '60%'
        }
    });

    // Town Chart
    const townLabels = Object.keys(townCounts);
    const townValues = Object.values(townCounts);

    if (townChart) townChart.destroy();
    townChart = new Chart(el.chartTowns, {
        type: 'bar',
        data: {
            labels: townLabels,
            datasets: [{
                label: 'Customers',
                data: townValues,
                backgroundColor: '#10b981', // Emerald green
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#e5e7eb' }, ticks: { stepSize: 1 } },
                x: { grid: { display: false } }
            }
        }
    });

    // 4. Update Average Install Time UI
    if (installTimeCount > 0) {
        const avgDays = Math.round(totalInstallTimeDays / installTimeCount);
        el.analyticsAvgTime.textContent = `${avgDays} Days`;
    } else {
        el.analyticsAvgTime.textContent = `-- Days`;
    }
};

// --- 5. DETAILS LOGIC ---

const handleSelectCustomer = async (id) => {
    selectedCustomerId = id;
    el.detailsModal.classList.remove('hidden');
    el.detailsContainer.dataset.id = id;

    const c = allCustomers.find(cust => cust.id === id);
    if (c) populateDetailsForm(c);
};

const closeDetailsModal = () => {
    selectedCustomerId = null;
    el.detailsModal.classList.add('hidden');
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
    
    // Populate Contacts
    detailsContacts = data.contacts || []; 
    // Fallback if no contacts array but old string exists
    if(detailsContacts.length === 0 && data.primaryContact?.phone) {
        detailsContacts.push({ type: 'Mobile', number: data.primaryContact.phone, name: 'Primary' });
    }
    renderContacts(el.detailsContactsList, detailsContacts, true);
    
    el.detailsGeneralNotes.value = data.generalNotes || '';

    // 3. Stage Content & Stepper
    el.currentStageTitle.textContent = data.status || 'Stage Details';
    el.detailsForm.dataset.currentStatus = data.status;
    el.detailsForm.dataset.statusBeforeHold = data.statusBeforeHold || 'New Order';
    
    updateStepperUI(data.status);
    setPageForStatus(data.status); // <--- RESTORED: Shows only relevant page

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
    setCheck('post-check-billing', data.postInstallChecklist?.emailSentToBilling);
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

// --- RESTORED: Logic to show only ONE page at a time in the modal ---
const setPageForStatus = (status) => {
    el.detailsPages.forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden'); // Ensure hidden by default
    });
    
    if(status === 'Archived' || status === 'Completed') {
        const p = document.getElementById('page-install');
        p.classList.remove('hidden');
        p.classList.add('active');
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
    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.remove('hidden');
        activePage.classList.add('active');
    }
};

const showDetailsPage = (pageId) => {
    el.detailsPages.forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
    });
    const p = document.getElementById(pageId);
    if(p) {
        p.classList.remove('hidden');
        p.classList.add('active');
    }
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
    
    // Construct Data Object
    // For backward compatibility, save first contact phone to primaryContact.phone
    const primaryPhone = detailsContacts.length > 0 ? detailsContacts[0].number : '';

    const data = {
        customerName: el.detailsCustomerNameInput.value,
        serviceOrderNumber: el.detailsSoNumberInput.value,
        address: el.detailsAddressInput.value,
        serviceSpeed: el.detailsSpeedInput.value,
        'primaryContact.email': el.detailsEmailInput.value,
        'primaryContact.phone': primaryPhone,
        contacts: detailsContacts, // Save array
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
        
        // Refresh analytics if open
        if(!el.analyticsDashboard.classList.contains('hidden')) renderAnalytics();

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
    
    if (confirm("Are you sure you want to delete this customer? This cannot be undone.")) {
        try {
            el.loadingOverlay.classList.remove('hidden');
            await deleteDoc(doc(customersCollectionRef, id));
            showToast('Customer deleted.', 'success');
            closeDetailsModal();
        } catch (error) {
            console.error("Error deleting customer: ", error);
            showToast('Error deleting customer.', 'error');
        } finally {
            el.loadingOverlay.classList.add('hidden');
        }
    }
};

// --- RESTORED: Welcome Email Logic ---
const handleSendWelcomeEmail = async () => {
    const email = el.detailsEmailInput.value;
    const name = el.detailsCustomerNameInput.value;

    if (!email) {
        showToast('No email address found.', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to automatically send the welcome email to ${email}?`)) return;

    try {
        el.loadingOverlay.classList.remove('hidden');

        // Trigger Cloud Function via Firestore trigger
        await addDoc(mailCollectionRef, {
            to: [email],
            template: {
                data: {
                    customerName: name
                }
            },
            sent: false,
            createdAt: serverTimestamp()
        });

        // Optimistically update UI and DB
        const welcomeCheckbox = document.getElementById('check-welcome-email');
        if (welcomeCheckbox && !welcomeCheckbox.checked) {
            welcomeCheckbox.checked = true;
            await handleUpdateCustomer(null, true, 0); 
        }
        
        showToast('Welcome email queued successfully.', 'success');

    } catch (err) {
        console.error("Error queueing welcome email:", err);
        showToast('Failed to queue email.', 'error');
    } finally {
        el.loadingOverlay.classList.add('hidden');
    }
};

// --- 7. UTILS & MODALS ---

const openAddCustomerModal = () => {
    el.addCustomerModal.classList.remove('hidden');
    el.addForm.reset();
    modalContacts = [];
    renderContacts(el.modalContactsList, modalContacts, true);
};
const closeAddCustomerModal = () => {
    el.addCustomerModal.classList.add('hidden');
};

const handleAddCustomer = async (e) => {
    e.preventDefault();
    
    // Apply Title Case to Name and Address
    const formattedName = toTitleCase(el.customerNameInput.value);
    const formattedAddress = toTitleCase(el.addressInput.value);
    
    // Fallback phone if no contacts added
    const primaryPhone = modalContacts.length > 0 ? modalContacts[0].number : '';

    const newDoc = {
        serviceOrderNumber: el.soNumberInput.value,
        customerName: formattedName,
        address: formattedAddress,
        primaryContact: { email: el.customerEmailInput.value, phone: primaryPhone },
        contacts: modalContacts, // Save array
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
        const storageRef = ref(storage, `artifacts/${currentAppId}/public/service_orders/${Date.now()}_${file.name}`);
        const snap = await uploadBytes(storageRef, file);
        tempUploadedPdfUrl = await getDownloadURL(snap.ref);

        const reader = new FileReader();
        reader.onload = async () => {
            const pdf = await window.pdfjsLib.getDocument({ data: reader.result }).promise;
            const page = await pdf.getPage(1);
            const content = await page.getTextContent();
            
            const text = content.items.map(i => i.str).join('\n');

            console.log("--- START PDF EXTRACT ---");
            console.log(text);
            console.log("--- END PDF EXTRACT ---");

            // --- 1. SERVICE ORDER ---
            const soMatch = text.match(/Service Order:\s*(\d+)/i);
            if (soMatch) el.soNumberInput.value = soMatch[1];

            // --- 2. ADDRESS (Service Point Street + Bill To City/State/Zip) ---
            let street = '';
            // Try Service Point first (often cleaner)
            const servicePointMatch = text.match(/Service\s+Point:\s*(?:NEW\s*|GOSH\s*)?([\s\S]+?)City\/Serv/i);
            if (servicePointMatch) {
                let rawStreet = servicePointMatch[1].replace(/\n/g, ' ').trim();
                // FIX: Remove specific prefixes seen in examples
                rawStreet = rawStreet.replace(/^(GOSH|NEW|NAPP|SYR|MILF|BRIS|MIDD|ELKH|WAKA)\s+/i, '').trim();
                // Also remove any leading numbers that might be route prefixes if they exist (though less common in examples)
                street = rawStreet;
            }

            let cityStateZip = '';
            const billToBlockMatch = text.match(/Bill\s+To:\s*([\s\S]*?)Res\/Bus/i);
            let nameLines = [];
            
            if (billToBlockMatch) {
                const lines = billToBlockMatch[1].split('\n').map(l => l.trim()).filter(l => l);
                
                let addressStartIndex = -1;
                // Find where the address digits start or PO Box
                for(let i=0; i<lines.length; i++) {
                     if (/^\d/.test(lines[i]) || /^P\.?O\.?\s*Box/i.test(lines[i])) {
                        addressStartIndex = i;
                        break;
                    }
                }
                
                if (addressStartIndex > -1) {
                    nameLines = lines.slice(0, addressStartIndex);
                    const addressLines = lines.slice(addressStartIndex);
                    
                    // Search for Zip line from bottom up
                    const zipRegex = /\b\d{5}(?:-\d{4})?\b/;
                    let zipLineIndex = -1;
                    for (let i = addressLines.length - 1; i >= 0; i--) {
                        if (zipRegex.test(addressLines[i])) {
                            zipLineIndex = i;
                            break;
                        }
                    }
                    
                    if (zipLineIndex !== -1) {
                        let zipPart = addressLines[zipLineIndex].match(zipRegex)[0];
                        let statePart = '';
                        let cityPart = '';
                        
                        // Combine lines around zip to form the tail
                        // If zip line has text before it (e.g. "GOSHEN, IN 46528"), use that line
                        // If zip line is isolated, look above it
                        
                        // Strategy: gather lines from zip line upwards until we hit the street line?
                        // Better: Look for State Match in the same line or previous line
                        
                        let candidateText = addressLines[zipLineIndex];
                        if (zipLineIndex > 0) {
                            candidateText = addressLines[zipLineIndex - 1] + " " + candidateText;
                        }
                        
                        // Parse from candidate text
                        const stateMatch = candidateText.match(/[\s,]+(IN|INDIANA|MI|MICHIGAN|OH|OHIO|IL|ILLINOIS)\b/i);
                        
                        if (stateMatch) {
                            statePart = stateMatch[1]; // IN
                            const splitIndex = stateMatch.index;
                            if (splitIndex > 0) {
                                let rawCity = candidateText.substring(0, splitIndex).trim();
                                rawCity = rawCity.replace(/,$/, '').trim();
                                
                                // Heuristic: if rawCity contains digits, it likely includes the street part.
                                // We want just the city. 
                                // Address: "16144 CR 18 GOSHEN" -> City "GOSHEN"
                                // Address: "57767 COUNTY ROAD 31 GOSHEN"
                                
                                // Check if rawCity has address-like numbers at the start.
                                // If so, assume the last word(s) are the city.
                                // BUT some streets are named "County Road 23".
                                // This is hard without a city list or strict delimiters.
                                
                                // LUCKILY, the validTowns list helps!
                                const validTowns = ['goshen', 'new paris', 'nappanee', 'syracuse', 'milford', 'bristol', 'middlebury', 'elkhart', 'wakarusa'];
                                let foundTown = "";
                                
                                // Check from end of string backwards
                                for (const town of validTowns) {
                                    if (rawCity.toLowerCase().endsWith(town)) {
                                        foundTown = town;
                                        break;
                                    }
                                }
                                
                                if (foundTown) {
                                    cityPart = toTitleCase(foundTown);
                                    // If we found the city here, we might want to ensure street part didn't get mixed in previously
                                } else {
                                    // Fallback: take the whole thing if no known town match
                                    cityPart = rawCity; 
                                }
                            }
                        }
                        
                        if(cityPart && statePart && zipPart) {
                            cityStateZip = `${cityPart}, ${statePart} ${zipPart}`;
                        } else {
                           // Fallback if parsing fails: just use the raw text found
                           cityStateZip = candidateText;
                        }
                    } else {
                        // Zip not found? just join address lines
                        cityStateZip = addressLines.join(' ');
                    }
                } else {
                    nameLines = lines;
                }
            }

            const fullAddr = [street, cityStateZip].filter(Boolean).join(', ');
            if (fullAddr) el.addressInput.value = toTitleCase(fullAddr);

            // --- 3. CUSTOMER NAME ---
            if (nameLines.length > 0) {
                 const parsedNames = nameLines.map(n => {
                    const parts = n.split(/\s+/);
                    if(parts.length > 1) {
                        const last = parts.pop();
                        const first = parts.join(' ');
                        return { first, last };
                    }
                    return { first: n, last: '' };
                 });
                 
                 if (parsedNames.length === 2) {
                      if (parsedNames[0].last && parsedNames[1].last && 
                          parsedNames[0].last.toUpperCase() === parsedNames[1].last.toUpperCase()) {
                          el.customerNameInput.value = toTitleCase(`${parsedNames[0].last} ${parsedNames[0].first} & ${parsedNames[1].first}`);
                      } else {
                          el.customerNameInput.value = toTitleCase(nameLines.join(' & '));
                      }
                 } else if (parsedNames.length === 1) {
                      if (parsedNames[0].last) {
                          el.customerNameInput.value = toTitleCase(`${parsedNames[0].last} ${parsedNames[0].first}`);
                      } else {
                          el.customerNameInput.value = toTitleCase(parsedNames[0].first);
                      }
                 } else {
                      el.customerNameInput.value = toTitleCase(nameLines.join(' & '));
                 }
            }

            // --- 4. CONTACTS ---
            const contactTypes = ['WORK', 'CELL', 'other', 'HOME'];
            modalContacts = []; 
            
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const matchedType = contactTypes.find(t => line.toUpperCase() === t.toUpperCase());
                
                if (matchedType) {
                    let type = matchedType.charAt(0).toUpperCase() + matchedType.slice(1).toLowerCase(); 
                    if(type === 'Other') type = 'Other'; 
                    if(type === 'Cell') type = 'Mobile'; 

                    let number = "";
                    let name = "";
                    
                    if (i + 1 < lines.length) {
                        const nextLine = lines[i+1];
                        if (/[0-9]/.test(nextLine)) {
                            number = nextLine.replace(/\/$/, '').trim(); 
                        }
                    }
                    
                    if (i + 2 < lines.length) {
                         const nameLine = lines[i+2];
                         if (!contactTypes.some(t => nameLine.toUpperCase() === t.toUpperCase()) && nameLine !== 'Customer') {
                             name = toTitleCase(nameLine);
                         }
                    }

                    if (number) {
                        addContact(modalContacts, { type, number, name });
                    }
                }
            }
            renderContacts(el.modalContactsList, modalContacts, true);

            // --- 5. SPEED ---
            if (/1\s*(?:GIG|GBPS)/i.test(text)) {
                el.serviceSpeedInput.value = '1 Gbps';
            } else if (/500\s*(?:MG|MBPS)/i.test(text)) {
                el.serviceSpeedInput.value = '500 Mbps';
            } else if (/200\s*(?:MG|MBPS)/i.test(text)) {
                el.serviceSpeedInput.value = '200 Mbps';
            }
            
            // EMAIL
            const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
            if(emailMatch) el.customerEmailInput.value = emailMatch[1];
            
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

const handleReturnSplice = async () => {
    // Implement or leave as placeholder
    console.log("Return Splice clicked");
};

const handleCopyBilling = async () => {
    try {
        const rawDate = document.getElementById('install-date').value;
        let formattedDate = '';
        if (rawDate) {
            const [year, month, day] = rawDate.split('-');
            formattedDate = `${month}/${day}/${year}`;
        }

        const extraEquip = document.getElementById('extra-equip').value || '';

        const rawName = el.detailsCustomerNameInput.value || '';
        let billingName = rawName;
        const nameParts = rawName.trim().split(/\s+/);
        if (nameParts.length >= 2) {
            const firstWord = nameParts.shift();
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
        
        const originalBtnContent = el.copyBillingBtn.innerHTML;
        el.copyBillingBtn.innerHTML = `<i data-lucide="check"></i> Copied!`;
        
        if (window.lucide) window.lucide.createIcons();

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
            handleDeselectCustomer(false); 
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
            await updateDoc(doc(customersCollectionRef, id), {
                status: 'Completed'
            });
            showToast('Customer Unarchived', 'success');
        } catch (error) {
            console.error("Error unarchiving customer: ", error);
            showToast('Error unarchiving customer', 'error');
        } finally {
            el.loadingOverlay.classList.add('hidden');
        }
    }
};