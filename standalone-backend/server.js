// standalone-backend/server.js

// Load environment variables from .env file (for local development)
require('dotenv').config();

// Import necessary modules
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { google } = require('googleapis'); // Import googleapis library
const fs = require('fs'); // Node.js File System module for reading files

// --- Firebase Admin SDK Initialization (still uses Base64 for Firestore Admin) ---
const encodedServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
const projectId = process.env.FIREBASE_PROJECT_ID;
const googleCalendarId = process.env.GOOGLE_CALENDAR_ID;

// Path to the Google Calendar service account key file (from Render Secret Files)
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
// GOOGLE_CALENDAR_ID is checked below in initializeGoogleCalendar, not fatal here.

let serviceAccount; // This will hold the parsed service account for Firebase Admin
try {
    // Decode the Base64 string back to its original JSON string format
    const decodedServiceAccountJson = Buffer.from(encodedServiceAccountJson, 'base64').toString('utf8');
    // Parse the JSON string into an object
    serviceAccount = JSON.parse(decodedServiceAccountJson);
    console.log('Service account JSON decoded and parsed successfully from FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 for Firebase Admin SDK.');

    // Initialize Firebase Admin SDK with the parsed service account object
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com`
    });
    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('FATAL ERROR: Failed to initialize Firebase Admin SDK. Check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 value or format.', error.message);
    process.exit(1);
}

// Initialize Google Calendar API client - Now a named async function
let calendar = null; // Initialize to null

// Define the async function for Google Calendar initialization
async function initializeGoogleCalendar() {
    if (!googleCalendarId) {
        console.warn('GOOGLE_CALENDAR_ID environment variable not set. Google Calendar integration will be skipped.');
        return;
    }
    if (!googleAuthKeyFilePath) {
        console.error('ERROR: GOOGLE_AUTH_KEY_FILE_PATH environment variable not set. Cannot initialize Google Calendar from file.');
        calendar = null;
        return;
    }

    try {
        console.log(`Attempting to read Google Calendar key file from: ${googleAuthKeyFilePath}`);

        // Explicitly read and parse the key file content
        let keyFileContent;
        try {
            keyFileContent = fs.readFileSync(googleAuthKeyFilePath, 'utf8');
            console.log('Google Calendar key file read successfully.');
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                throw new Error(`Key file not found at ${googleAuthKeyFilePath}. Make sure it's correctly mounted in Render Secret Files.`);
            } else {
                throw new Error(`Failed to read key file at ${googleAuthKeyFilePath}: ${readError.message}`);
            }
        }

        let keyFileServiceAccount;
        try {
            keyFileServiceAccount = JSON.parse(keyFileContent);
            console.log('Google Calendar key file JSON parsed successfully.');
        } catch (parseError) {
            throw new Error(`Failed to parse JSON from key file at ${googleAuthKeyFilePath}. Check file content format: ${parseError.message}`);
        }

        // --- Debugging logs for the parsed key file content ---
        console.log(`Debug (Calendar Key File): client_email defined: ${!!keyFileServiceAccount.client_email}`);
        console.log(`Debug (Calendar Key File): private_key defined: ${!!keyFileServiceAccount.private_key}`);
        console.log(`Debug (Calendar Key File): private_key length: ${keyFileServiceAccount.private_key ? keyFileServiceAccount.private_key.length : 'N/A'}`);
        if (keyFileServiceAccount.private_key) {
            console.log(`Debug (Calendar Key File): private_key preview (first 50): ${keyFileServiceAccount.private_key.substring(0, 50)}`);
            console.log(`Debug (Calendar Key File): private_key preview (last 50): ${keyFileServiceAccount.private_key.substring(keyFileServiceAccount.private_key.length - 50)}`);
            console.log(`Debug (Calendar Key File): private_key char at 32: '${keyFileServiceAccount.private_key.charAt(32)}' (should be '\\n')`);
            console.log(`Debug (Calendar Key File): private_key char at length-32: '${keyFileServiceAccount.private_key.charAt(keyFileServiceAccount.private_key.length - 32)}' (should be '\\n')`);
        }
        // --- End Debugging logs ---

        // Robust normalization for the private_key from the file
        if (keyFileServiceAccount.private_key) {
            let cleanedPrivateKey = keyFileServiceAccount.private_key
                .replace(/-----BEGIN PRIVATE KEY-----/, '')
                .replace(/-----END PRIVATE KEY-----/, '')
                .replace(/\s+/g, '') // Remove all whitespace (spaces, tabs, newlines)
                .trim();
            keyFileServiceAccount.private_key = `-----BEGIN PRIVATE KEY-----\n${cleanedPrivateKey}\n-----END PRIVATE KEY-----\n`;
            console.log('Google Calendar private key string normalized from file.');
        }


        console.log('Attempting to create JWT client with normalized private key...');
        const jwtClient = new google.auth.JWT(
            keyFileServiceAccount.client_email,
            null, // keyFile is null because we are providing private_key directly
            keyFileServiceAccount.private_key, // Provide the normalized private_key string
            ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'] // Scopes
        );

        // Await authorization before proceeding
        await jwtClient.authorize();
        console.log('Google Calendar JWT client authorized successfully using provided key data.');

        // Only initialize 'calendar' after successful authorization
        calendar = google.calendar({ version: 'v3', auth: jwtClient });
        console.log('Google Calendar API client initialized and ready.');

    } catch (error) {
        console.error('Error during Google Calendar API authorization or initialization using key file. Calendar functionality disabled:', error.message);
        console.error('Full Google API Auth Error:', error); // Log full error object for more context
        calendar = null; // Ensure calendar remains null if there's an error
    }
}

// Call the Google Calendar initialization function after Firebase Admin SDK is initialized
initializeGoogleCalendar();


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

// --- Helper function for getEndTime ---
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
        // Ensure 'calendar' is not null before attempting to use it
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
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 24 * 60 }, // 24 hours prior
                        { method: 'popup', minutes: 10 },    // 10 minutes prior
                    ],
                },
            };

            const response = await calendar.events.insert({
                calendarId: googleCalendarId,
                resource: event,
                sendUpdates: 'all'
            });
            console.log('Calendar event created:', response.data.htmlLink);

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
```

This updated code will explicitly read the `google-calendar-key.json` file using `fs.readFileSync`, parse its content, and then pass the `client_email` and `private_key` directly as strings to the `google.auth.JWT` constructor. This should give us much more granular detail in the Render logs about exactly what is failing during the key processing, hopefully leading us to the root cause.

Please update your `server.js` with this content, redeploy your Render service, and then share the new lo