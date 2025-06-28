// standalone-backend/server.js

// Load environment variables from .env file (for local development)
require('dotenv').config();

// Import necessary modules
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { google } = require('googleapis'); // Import googleapis library
const fs = require('fs'); // Import Node.js File System module

// --- Utility Functions (Copied from Frontend - REQUIRED for Backend Logic) ---
/**
 * Calculates the end time given a start time and duration in hours.
 * This is needed for Google Calendar event creation.
 * @param {string} startTime - The start time string (e.g., '09:00').
 * @param {number} durationHours - The duration in hours.
 * @returns {string} The end time string (e.g., '11:00').
 */
const getEndTime = (startTime, durationHours) => {
    if (!startTime || isNaN(durationHours)) return '';
    const [hour, minute] = startTime.split(':');
    const start = new Date();
    start.setHours(parseInt(hour), parseInt(minute), 0, 0);
    start.setHours(start.getHours() + durationHours);
    // Ensure the output format matches what's needed for the description
    // For description, we need a 24-hour format (e.g., "11:00" or "14:00")
    return `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
};

// --- Firebase Admin SDK Initialization ---
const encodedServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
const projectId = process.env.FIREBASE_PROJECT_ID;
const googleCalendarId = process.env.GOOGLE_CALENDAR_ID; // New: Get Google Calendar ID

// New: Get the path to the Google Service Account key file from environment variable
const googleAuthKeyFilePath = process.env.GOOGLE_AUTH_KEY_FILE_PATH;

// Validate critical environment variables
if (!encodedServiceAccountJson) {
    console.error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 not defined.');
    process.exit(1);
}
if (!projectId) {
    console.error('FATAL ERROR: FIREBASE_PROJECT_ID not defined.');
    process.exit(1);
}
if (!googleCalendarId) {
    console.error('FATAL ERROR: GOOGLE_CALENDAR_ID not defined. Calendar integration will not work.');
    // Do not exit, but log an error, as core app might still function without calendar.
}
if (!googleAuthKeyFilePath) {
    console.error('FATAL ERROR: GOOGLE_AUTH_KEY_FILE_PATH not defined. Google Calendar integration will not work.');
    process.exit(1); // Exit if critical path for Google Calendar is missing
}


let serviceAccount; // This will hold the parsed service account JSON object for Firebase Admin
try {
    const decodedServiceAccountJson = Buffer.from(encodedServiceAccountJson, 'base64').toString('utf8');
    serviceAccount = JSON.parse(decodedServiceAccountJson);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com`
    });
    console.log('Firebase Admin SDK initialized successfully.');
    // Only log the client email for Firebase Admin SDK to confirm it's using the right one
    console.log('Firebase Admin: Client Email from decoded JSON:', serviceAccount.client_email);

} catch (error) {
    console.error('FATAL ERROR: Failed to initialize Firebase Admin SDK.', error.message);
    process.exit(1);
}

// Initialize Google Calendar API client
let calendar;
// Wrap the async initialization in an immediately invoked async function
(async () => {
    try {
        // --- IMPORTANT: Use GoogleAuth with keyFile directly ---
        // This is the most robust way to provide service account credentials
        // when facing persistent "No key or keyFile set" errors.
        console.log(`Google Calendar: Attempting to authorize using key file at: ${googleAuthKeyFilePath}`);
        console.log('Current NODE_ENV:', process.env.NODE_ENV); // Useful for debugging Render vs. local

        const authClient = new google.auth.GoogleAuth({
            keyFile: googleAuthKeyFilePath, // Point directly to the secret file path
            scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'] // Scopes for calendar access
        });

        const authorizedClient = await authClient.getClient(); // Get an authorized client instance
        
        // Log details from the loaded credentials after getClient() resolves
        // These logs were previously showing 'undefined' or 'NOT LOADED' because
        // they were accessed immediately after constructing authClient, before
        // getClient() had a chance to fetch/load credentials.
        console.log('Google Calendar: Client Email (from key file):', authorizedClient.credentials.client_email);
        console.log('Google Calendar: Private Key (from key file, first 50 chars):', authorizedClient.credentials.private_key ? authorizedClient.credentials.private_key.substring(0, 50) + '...' : 'NOT LOADED');
        console.log('Google Calendar: Private Key (from key file, last 50 chars):', authorizedClient.credentials.private_key && authorizedClient.credentials.private_key.length > 50 ? '...' + authorizedClient.credentials.private_key.substring(authorizedClient.credentials.private_key.length - 50) : '');


        calendar = google.calendar({ version: 'v3', auth: authorizedClient });
        console.log('Google Calendar API client initialized successfully using key file.');

    } catch (error) {
        console.error('Error initializing Google Calendar API client:', error.message);
        calendar = null; // Set to null if initialization fails
    }
})(); // End of immediately invoked async function


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
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}.`;
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
        await auth.updateUser(uid, { displayName: displayName.trim() });
        const userProfileDocRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/profiles/userProfile`);
        await userProfileDocRef.set({
            userId: uid,
            displayName: displayName.trim(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        res.status(200).json({ success: true, message: 'User profile updated successfully!' });

    } catch (error) {
        console.error('Error updating user profile:', error);
        return res.status(500).json({ error: 'Failed to update user profile due to a server error.', details: error.message });
    }
});

/**
 * POST /api/confirm-booking
 * Handles creating a booking in Firestore and adding an event to Google Calendar.
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

        // --- 2. Create/Update Google Calendar Event ---
        if (calendar && googleCalendarId) {
            const { date, time, duration } = bookingData;
            const startDate = new Date(`${date}T${time}:00`); // Parse date and time
            const endDate = new Date(startDate.getTime() + duration * 60 * 60 * 1000); // Add duration in hours

            const event = {
                summary: `DJ Studio Booking by ${userName}`,
                description: `Booking ID: ${bookingDocRef.id}\nDate: ${date}\nTime: ${time} - ${getEndTime(time, duration)}\nDuration: ${duration} hours\nEquipment: ${bookingData.equipment.map(eq => eq.name).join(', ')}\nPayment: ${bookingData.paymentMethod} (${bookingData.paymentStatus})`,
                start: {
                    dateTime: startDate.toISOString(),
                    timeZone: 'Asia/Makassar', // Assuming WITA timezone based on your context
                },
                end: {
                    dateTime: endDate.toISOString(),
                    timeZone: 'Asia/Makassar', // Assuming WITA timezone
                },
                // Optional: Add attendees, reminders, etc.
                // attendees: [{ email: 'your_email@example.com' }], // Add your own email to receive invitations
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 24 * 60 }, // 24 hours prior
                        { method: 'popup', minutes: 10 },    // 10 minutes prior
                    ],
                },
            };

            // If it's an update, try to find and update existing event (requires storing eventId)
            // For simplicity here, we'll always create a new one unless you add eventId to booking data
            // Or, if editing, you could try to search for the event by title/description and update it.
            // For this basic implementation, we'll add a new event or handle the case where we don't update directly.
            // A more advanced solution would store the calendarEventId in Firestore with the booking.

            const response = await calendar.events.insert({
                calendarId: googleCalendarId,
                resource: event,
                sendUpdates: 'all' // 'all' sends email updates to attendees, 'none' does not
            });
            console.log('Calendar event created:', response.data.htmlLink);
            // You might want to store response.data.id (calendarEventId) in your Firestore booking document
            // for future updates or deletions of the calendar event.

        } else {
            console.warn('Google Calendar API not initialized or calendar ID not set. Skipping calendar event creation.');
        }

        res.status(200).json({
            success: true,
            message: editingBookingId ? 'Booking updated and calendar event added!' : 'Booking confirmed and calendar event added!',
            bookingId: bookingDocRef.id
        });

    } catch (error) {
        console.error('Error confirming booking or creating calendar event:', error);
        return res.status(500).json({ error: 'Failed to confirm booking or create calendar event.', details: error.message });
    }
});


// Start the server
app.listen(port, () => {
    console.log(`Standalone backend listening on port ${port}`);
    console.log(`Access at: http://localhost:${port}`);
    console.log(`Profile update endpoint: http://localhost:${port}/api/update-profile`);
    console.log(`Confirm booking endpoint: http://localhost:${port}/api/confirm-booking`);
});
