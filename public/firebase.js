// Import the functions you need from the SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// --- Import Auth functions ---
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";

// 1. Use the Firebase config you provided
const firebaseConfig = {
  apiKey: "AIzaSyD74_6SRLrhD0Ygrkiev130wBHKs89oOQs",
  authDomain: "residential-fiber.firebaseapp.com",
  projectId: "residential-fiber",
  storageBucket: "residential-fiber.firebasestorage.app",
  messagingSenderId: "215019522895",
  appId: "1:215019522895:web:00ed15e8b79f7dd549933a",
  measurementId: "G-94W44M2JD7"
};

// 2. Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const analytics = getAnalytics(app); // Initialize Analytics

// --- 3. Create and configure Google Auth Provider ---
const googleProvider = new GoogleAuthProvider();
// This is the magic line that restricts login to your domain
googleProvider.setCustomParameters({
  'hd': 'nptel.com'
});

// 4. Set log level for debugging
setLogLevel('Debug');
console.log("Firebase Initialized in firebase.js");

// 5. Export all the initialized services and methods
export { 
    db, 
    auth, 
    analytics, 
    googleProvider, 
    signInWithPopup, 
    signOut 
};