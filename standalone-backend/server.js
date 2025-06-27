// standalone-backend/server.js

// Load environment variables from .env file (for local development)
require('dotenv').config();

// Import necessary modules
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- Firebase Admin SDK Initialization ---
// For Render deployment, we will now use a Base64 encoded service account key.
const encodedServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
const projectId = process.env.FIREBASE_PROJECT_ID;

// Validate that the Base64 encoded service account JSON is provided
if (!encodedServiceAccountJson) {
    console.error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 not defined in environment variables.');
    console.error('For local development, ensure it is in your .env file or passed via `npm start` script.');
    console.error('For Render, ensure it is set as an environment variable in the Render dashboard.');
    process.exit(1); // Exit if critical config is missing
}

let serviceAccount;
try {
    // Decode the Base64 string
    const decodedServiceAccountJson = Buffer.from(encodedServiceAccountJson, 'base64').toString('utf8');
    // Parse the JSON string
    serviceAccount = JSON.parse(decodedServiceAccountJson);
    console.log('Service account JSON decoded and parsed successfully.');

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com` // Optional: specify if using Realtime Database
    });
    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('FATAL ERROR: Failed to initialize Firebase Admin SDK. Check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 format or value.', error);
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
const allowedOrigins = [
    'http://localhost:5173',          // Your local frontend dev server (Vite default)
    'http://localhost:5000',          // Your local backend itself
    'https://maxqon.github.io',       // Your deployed GitHub Pages frontend (root domain)
    process.env.RENDER_EXTERNAL_URL   // Render provides its own URL here
].filter(Boolean); // Filter out any undefined/null values

app.use(cors({
    origin: function (origin, callback) {
        console.log('CORS Request Origin:', origin);
        if (!origin) {
            console.log('CORS: Origin is null/undefined, allowing.');
            return callback(null, true);
        }
        
        if (allowedOrigins.includes(origin)) {
            console.log('CORS: Origin is allowed:', origin);
            return callback(null, true);
        } else {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`;
            console.error('CORS: Blocked origin.', msg);
            return callback(new Error(msg), false);
        }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    credentials: true,
    optionsSuccessStatus: 204
}));

// Parse JSON request bodies
app.use(express.json());

// --- Authentication Middleware ---
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('Unauthorized: No Bearer token provided.');
        return res.status(401).json({ error: 'Unauthorized: No token provided.' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        req.uid = decodedToken.uid;
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error.message);
        return res.status(403).json({ error: 'Unauthorized: Invalid token.', details: error.message });
    }
};

// --- Routes ---
app.get('/', (req, res) => {
    res.status(200).json({ message: 'DJ Booking Backend is running!' });
});

app.post('/api/update-profile', verifyFirebaseToken, async (req, res) => {
    const uid = req.uid;
    const { displayName } = req.body;

    if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
        return res.status(400).json({ error: 'Display name is required and must be a non-empty string.' });
    }

    try {
        await auth.updateUser(uid, {
            displayName: displayName.trim(),
        });
        console.log(`Firebase Auth profile updated for user ${uid}: ${displayName}`);

        const userProfileDocRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/profiles/userProfile`);
        await userProfileDocRef.set({
            userId: uid,
            displayName: displayName.trim(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`Firestore profile document updated for user ${uid}: ${displayName}`);

        res.status(200).json({ success: true, message: 'User profile updated successfully!' });

    } catch (error) {
        console.error('Error updating user profile:', error);
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
