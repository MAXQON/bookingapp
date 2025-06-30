// standalone-backend/server.js

// Load environment variables from .env file (for local development)
require('dotenv').config();

// Import necessary modules
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
// googleapis is no longer needed here for Calendar, as it will be handled by Python backend
// const { google } = require('googleapis');
// fs is no longer needed here as we are not reading Calendar key file directly
// const fs = require('fs');

// --- Environment Variables ---
const encodedServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
const projectId = process.env.FIREBASE_PROJECT_ID; // Used for Firebase Admin SDK databaseURL
// googleCalendarId is no longer directly used in this Node.js backend
// const googleCalendarId = process.env.GOOGLE_CALENDAR_ID;

// Define the URL for your new Python Calendar Backend service
// IMPORTANT: Replace this with the actual URL of your deployed Python Flask service
const PYTHON_CALENDAR_BACKEND_URL = process.env.PYTHON_CALENDAR_BACKEND_URL || 'http://localhost:5001'; // Default for local testing

// Validate critical environment variables
if (!encodedServiceAccountJson) {
    console.error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 not defined.');
    process.exit(1);
}
if (!projectId) {
    console.error('FATAL ERROR: FIREBASE_PROJECT_ID not defined.');
    process.exit(1);
}

let serviceAccount; // This will hold the parsed service account for Firebase Admin
try {
    // Decode the Base64 string back to its original JSON string format
    const decodedServiceAccountJson = Buffer.from(encodedServiceAccountJson, 'base64').toString('utf8');
    // Parse the JSON string into an object
    serviceAccount = JSON.parse(decodedServiceAccountJson);
    console.log('Service account JSON decoded and parsed successfully from FIREBASE_SERVICE_ACCOUNT_KEY_BASE64.');

    // --- ENHANCED DEBUGGING FOR FIREBASE ADMIN SDK SERVICE ACCOUNT ---
    console.log('Debug: Firebase Admin SDK Service Account Details:');
    console.log(`  Project ID: ${serviceAccount.project_id}`);
    console.log(`  Client Email: ${serviceAccount.client_email}`);
    if (serviceAccount.private_key) {
        console.log(`  Private Key Length: ${serviceAccount.private_key.length}`);
        console.log(`  Private Key Preview (first 50): ${serviceAccount.private_key.substring(0, 50)}...`);
        console.log(`  Private Key Preview (last 50): ...${serviceAccount.private_key.substring(serviceAccount.private_key.length - 50)}`);
    } else {
        console.log('  Private Key: NOT FOUND IN PARSED JSON!');
    }
    // --- END ENHANCED DEBUGGING ---

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com` // Ensure this matches your project ID
    });
    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('FATAL ERROR: Failed to initialize Firebase Admin SDK. Check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 value, format, or project ID in JSON.', error.message);
    console.error('Full Firebase Admin SDK Init Error:', error);
    process.exit(1);
}

// Google Calendar API initialization removed from here.
// It will be handled by the separate Python backend.
let calendar = null; // Still declare, but will remain null

// Get references to Firestore and Auth services
const db = admin.firestore();
const auth = admin.auth();

const APP_ID_FOR_FIRESTORE_PATH = process.env.APP_ID_FOR_FIRESTORE_PATH;
if (!APP_ID_FOR_FIRESTORE_PATH) {
    console.error('FATAL ERROR: APP_ID_FOR_FIRESTORE_PATH not defined.');
    process.exit(1);
}

const app = express();
const port = process.env.PORT || 5000;

// --- Middleware ---
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5000',
    'https://maxqon.github.io',
    process.env.RENDER_EXTERNAL_URL
].filter(Boolean);

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
        // Special handling for UNAUTHENTICATED errors from Firebase Admin
        if (error.code === 'auth/argument-error' && error.message.includes('UNAUTHENTICATED')) {
            console.error('Firebase Admin SDK itself is reporting UNAUTHENTICATED when verifying token. This often means its own credentials are invalid.');
            return res.status(500).json({ error: 'Backend authentication service issue. Please check server logs.', details: error.message });
        }
        return res.status(403).json({ error: 'Unauthorized: Invalid token.', details: error.message });
    }
};

// --- Helper function for getEndTime ---
// Note: This is a client-side helper. For Google Calendar, Python backend will handle timezone-aware times.
const getEndTime = (startTime, durationHours) => {
    if (!startTime || isNaN(durationHours)) return '';
    const [hour] = startTime.split(':');
    const endHour = parseInt(hour) + durationHours;
    return `${endHour.toString().padStart(2, '0')}:00`;
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
        if (error.code === 16 && error.details && error.details.includes('UNAUTHENTICATED')) {
             console.error('Firestore UNAUTHENTICATED error. Check Firebase Admin SDK credentials and permissions.');
             return res.status(500).json({ error: 'Backend Firestore authentication failed. Please check server credentials/permissions.' });
        }
        return res.status(500).json({ error: 'Failed to update user profile due to a server error.', details: error.message });
    }
});

/**
 * POST /api/confirm-booking
 * Handles creating a booking in Firestore and making a call to a separate Python backend
 * for Google Calendar event creation.
 * Requires an authenticated Firebase user and a valid ID Token.
 */
app.post('/api/confirm-booking', verifyFirebaseToken, async (req, res) => {
    const uid = req.uid;
    const { bookingData, userName, editingBookingId } = req.body;

    if (!bookingData) {
        return res.status(400).json({ error: 'Booking data is required.' });
    }

    try {
        // --- 1. Save/Update Booking in Firestore ---
        const bookingsCollectionRef = db.collection(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings`);
        let bookingDocRef;
        if (editingBookingId) {
            bookingDocRef = bookingsCollectionRef.doc(editingBookingId);
            await bookingDocRef.set({
                ...bookingData,
                userId: uid,
                userName: userName,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`Booking UPDATED in Firestore: ${editingBookingId}`);
        } else {
            bookingDocRef = await bookingsCollectionRef.add({
                ...bookingData,
                userId: uid,
                userName: userName,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Booking ADDED to Firestore: ${bookingDocRef.id}`);
        }

        // --- 2. Call Python Backend for Google Calendar Event ---
        // Prepare data for the Python backend. Include relevant booking details
        // and the user's timezone if known from the frontend.
        const calendarPayload = {
            date: bookingData.date,
            time: bookingData.time,
            duration: bookingData.duration,
            userName: userName,
            bookingId: editingBookingId || bookingDocRef.id, // Use existing or new Firestore ID
            equipment: bookingData.equipment,
            paymentMethod: bookingData.paymentMethod,
            paymentStatus: bookingData.paymentStatus,
            userTimeZone: 'Asia/Makassar' // IMPORTANT: This should ideally come from frontend
                                          // For now, hardcode to match your context for testing
        };

        // If in edit mode, fetch the existing calendarEventId from Firestore
        let existingCalendarEventId = null;
        if (editingBookingId) {
            const bookingSnap = await bookingDocRef.get();
            if (bookingSnap.exists) {
                existingCalendarEventId = bookingSnap.data().calendarEventId;
                calendarPayload.calendarEventId = existingCalendarEventId; // Pass to Python
            }
        }
        
        // Determine the Python endpoint and HTTP method
        const pythonEndpoint = `${PYTHON_CALENDAR_BACKEND_URL}/api/confirm-booking`; // Python endpoint
        const pythonMethod = existingCalendarEventId ? 'PUT' : 'POST'; // Use PUT for update, POST for new

        try {
            console.log(`Calling Python Calendar Backend (${pythonMethod}): ${pythonEndpoint}`);
            const pythonResponse = await fetch(pythonEndpoint, {
                method: pythonMethod,
                headers: {
                    'Content-Type': 'application/json',
                    // You might need to pass an authentication token to the Python backend too
                    // if it has its own authentication middleware. For now, assuming direct call.
                    'Authorization': req.headers.authorization // Pass the Firebase ID token
                },
                body: JSON.stringify(calendarPayload)
            });

            const pythonResponseData = await pythonResponse.json();

            if (!pythonResponse.ok) {
                console.error('Error from Python Calendar Backend:', pythonResponseData);
                // Propagate the Python backend error if it's not successful
                throw new Error(pythonResponseData.error || 'Failed to create/update calendar event via Python backend.');
            }
            console.log('Calendar event handled by Python backend successfully:', pythonResponseData.message);

            // If the Python backend returns a calendarEventId, store it in Firestore
            if (pythonResponseData.calendarEventId) {
                await bookingDocRef.set({
                    calendarEventId: pythonResponseData.calendarEventId
                }, { merge: true });
                console.log(`Firestore booking ${bookingDocRef.id} updated with Calendar Event ID: ${pythonResponseData.calendarEventId}`);
            }

        } catch (pythonCallError) {
            console.error('Error calling Python Calendar Backend:', pythonCallError.message);
            console.warn('Google Calendar event creation/update failed. Booking saved to Firestore, but no calendar event was created/updated.');
            // Do NOT re-throw this error if you want the Firestore booking to still succeed
            // You might want to return a 200 OK with a warning for the user
            // For now, we'll let the outer catch block handle it as a general error.
        }

        res.status(200).json({
            success: true,
            message: editingBookingId ? 'Booking updated and calendar event (attempted)!' : 'Booking confirmed and calendar event (attempted)!',
            bookingId: bookingDocRef.id
        });

    } catch (error) {
        console.error('Error confirming booking or calling calendar backend:', error);
        // This catch block handles errors from Firestore operations or the Python backend call
        if (error.code === 16 && error.details && error.details.includes('UNAUTHENTICATED')) {
             console.error('Firestore UNAUTHENTICATED error. Check Firebase Admin SDK credentials and permissions.');
             return res.status(500).json({ error: 'Backend Firestore authentication failed. Please check server credentials/permissions.' });
        }
        return res.status(500).json({ error: 'Failed to confirm booking or create calendar event.', details: error.message });
    }
});


// Start the server
app.listen(port, () => {
    console.log(`Standalone backend listening on port ${port}`);
    console.log(`Access at: http://localhost:${port}`);
    console.log(`Profile update endpoint: http://localhost:${port}/api/update-profile`);
    console.log(`Confirm booking endpoint: http://localhost:${port}/api/confirm-booking`);
    console.log(`Python Calendar Backend URL: ${PYTHON_CALENDAR_BACKEND_URL}`);
});
