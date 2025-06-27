// standalone-backend/server.js

// Load environment variables from .env file (for local development)
require('dotenv').config();

// Import necessary modules
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- Firebase Admin SDK Initialization ---
// For Render deployment, we will pass the service account key as a JSON string via an environment variable.
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
const projectId = process.env.FIREBASE_PROJECT_ID;

// Validate that the service account JSON is provided
if (!serviceAccountJson) {
    console.error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY_JSON not defined in environment variables.');
    console.error('For local development, ensure it is in your .env file or passed via `npm start` script.');
    console.error('For Render, ensure it is set as an environment variable in the Render dashboard.');
    process.exit(1); // Exit if critical config is missing
}

try {
    // Parse the JSON string from the environment variable
    const serviceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com` // Optional: specify if using Realtime Database
    });
    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('FATAL ERROR: Failed to initialize Firebase Admin SDK. Check FIREBASE_SERVICE_ACCOUNT_KEY_JSON format or value.', error);
    process.exit(1); // Exit if initialization fails
}

// Get references to Firestore and Auth services
const db = admin.firestore();
const auth = admin.auth();

// Define a constant for your APP_ID_FOR_FIRESTORE_PATH
// This must match the APP_ID_FOR_FIRESTORE_PATH used in your frontend App.jsx.
const APP_ID_FOR_FIRESTORE_PATH = process.env.APP_ID_FOR_FIRESTORE_PATH;
if (!APP_ID_FOR_FIRESTORE_PATH) {
    console.error('FATAL ERROR: APP_ID_FOR_FIRESTORE_PATH not defined in .env or environment variables.');
    process.exit(1);
}

// Create Express app
const app = express();
// Render automatically provides a PORT environment variable. We should listen on this.
const port = process.env.PORT || 5000; // Use Render's PORT or default to 5000 for local development

// --- Middleware ---
// Configure CORS more robustly.
// Ensure your Render backend URL is in this list for self-testing if needed,
// and your GitHub Pages URL (root domain) must be here.
const allowedOrigins = [
    'http://localhost:5173',          // Your local frontend dev server
    'http://localhost:5000',          // Your local backend itself
    'https://maxqon.github.io',       // Your deployed GitHub Pages frontend (root domain)
    // Add your Render backend's actual public URL here as well
    // e.g., 'https://your-backend-name.onrender.com'
    // This is important if you ever have service-to-service calls or testing
    process.env.RENDER_EXTERNAL_URL // Render provides its own URL here
].filter(Boolean); // Filter out any undefined/null values from process.env.RENDER_EXTERNAL_URL if not present

app.use(cors({
    origin: function (origin, callback) {
        console.log('CORS Request Origin:', origin); // Log the incoming origin for debugging
        // Allow requests with no origin (like same-origin requests or mobile apps/curl requests)
        if (!origin) {
            console.log('CORS: Origin is null/undefined, allowing.');
            return callback(null, true);
        }
        
        // Check if the origin is in our allowed list
        if (allowedOrigins.includes(origin)) {
            console.log('CORS: Origin is allowed:', origin);
            return callback(null, true);
        } else {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`;
            console.error('CORS: Blocked origin.', msg);
            return callback(new Error(msg), false);
        }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'], // Explicitly list allowed HTTP methods
    credentials: true, // Allow cookies/auth headers to be sent
    optionsSuccessStatus: 204 // For pre-flight requests
}));

// Parse JSON request bodies
app.use(express.json());

// --- Authentication Middleware ---
// This middleware verifies the Firebase ID Token sent from the client.
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('Unauthorized: No Bearer token provided.');
        return res.status(401).json({ error: 'Unauthorized: No token provided.' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        // Verify the ID token using the Firebase Admin SDK
        const decodedToken = await auth.verifyIdToken(idToken);
        req.uid = decodedToken.uid; // Attach the user's UID to the request object
        req.user = decodedToken; // Optionally attach the full decoded token
        next(); // Proceed to the next middleware or route handler
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error.message);
        return res.status(403).json({ error: 'Unauthorized: Invalid token.', details: error.message });
    }
};

// --- Routes ---

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ message: 'DJ Booking Backend is running!' });
});

/**
 * POST /api/update-profile
 * Updates a user's display name in Firebase Auth and their Firestore profile document.
 * Requires an authenticated Firebase user and a valid ID Token in the Authorization header.
 */
app.post('/api/update-profile', verifyFirebaseToken, async (req, res) => {
    const uid = req.uid; // User ID from the verified token
    const { displayName } = req.body;

    // Validate input
    if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
        return res.status(400).json({ error: 'Display name is required and must be a non-empty string.' });
    }

    try {
        // 1. Update Firebase Auth profile
        await auth.updateUser(uid, {
            displayName: displayName.trim(),
        });
        console.log(`Firebase Auth profile updated for user ${uid}: ${displayName}`);

        // 2. Update or create the user's profile document in Firestore
        // Path must match frontend and Firestore Security Rules:
        // /artifacts/{appId}/users/{userId}/profiles/userProfile
        const userProfileDocRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/profiles/userProfile`);

        await userProfileDocRef.set({
            userId: uid,
            displayName: displayName.trim(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }); // Use merge: true to update existing fields without overwriting the whole document.
        console.log(`Firestore profile document updated for user ${uid}: ${displayName}`);

        res.status(200).json({ success: true, message: 'User profile updated successfully!' });

    } catch (error) {
        console.error('Error updating user profile:', error);
        // Provide more generic error messages for the client to avoid leaking internal details
        if (error.code === 'auth/user-not-found') {
            return res.status(404).json({ error: 'User not found for profile update.' });
        }
        return res.status(500).json({ error: 'Failed to update user profile due to a server error.', details: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Standalone backend listening on port ${port}`);
    console.log(`Access at: http://localhost:${port}`);
    console.log(`Profile update endpoint: http://localhost:${port}/api/update-profile`);
});
