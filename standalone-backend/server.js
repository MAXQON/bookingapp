// standalone-backend/server.js

// Load environment variables from .env file (for local development)
require('dotenv').config();

// Import necessary modules
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { google } = require('googleapis'); // Import googleapis library
const fs = require('fs'); // Import Node.js File System module
const moment = require('moment-timezone'); // Import moment-timezone

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

        const authorizedClient = await authClient.getClient();
        
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

// --- Helper Function for Conflict Checking ---
/**
 * Checks for overlapping bookings for a given date and time range.
 * This performs a collection group query for 'bookings' across all users.
 * @param {string} date - The date in YYYY-MM-DD format.
 * @param {string} time - The start time in HH:MM format.
 * @param {number} duration - The duration in hours.
 * @param {string} userTimeZone - The IANA timezone string (e.g., 'Asia/Makassar').
 * @param {string} [excludeBookingId=null] - Optional ID of a booking to exclude from conflict check (for edits).
 * @returns {Array} An array of conflicting booking data, or empty array if no conflicts.
 */
const getConflictingBookings = async (date, time, duration, userTimeZone, excludeBookingId = null) => {
    try {
        const proposedStart = moment.tz(`${date} ${time}`, userTimeZone);
        const proposedEnd = proposedStart.clone().add(duration, 'hours');

        // Query all 'bookings' across all users for the specific date
        // IMPORTANT: This requires a Firestore Collection Group Index on 'bookings' collection.
        // If you get an error here, check Firebase console for index creation instructions.
        const bookingsQuery = db.collectionGroup('bookings')
            .where('date', '==', date); // Assuming 'date' is stored as YYYY-MM-DD string

        const querySnapshot = await bookingsQuery.get();
        const conflicting = [];

        querySnapshot.forEach(docSnapshot => {
            const booking = docSnapshot.data();
            // Exclude the booking being edited from conflict check
            if (excludeBookingId && docSnapshot.id === excludeBookingId) {
                return;
            }

            // Reconstruct existing booking's time in its recorded timezone (or assume userTimeZone)
            // Use userTimeZone for consistency, as we're comparing against the new proposed booking
            const existingStart = moment.tz(`${booking.date} ${booking.time}`, booking.userTimeZone || userTimeZone);
            const existingEnd = existingStart.clone().add(booking.duration, 'hours');

            // Check for overlap:
            // (proposedStart < existingEnd AND proposedEnd > existingStart)
            if (proposedStart.isBefore(existingEnd) && proposedEnd.isAfter(existingStart)) {
                conflicting.push({ id: docSnapshot.id, ...booking });
            }
        });
        return conflicting;
    } catch (error) {
        console.error('Error getting conflicting bookings:', error);
        throw new Error('Failed to check for booking conflicts.');
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
 * Handles creating or updating a booking in Firestore and adding/updating an event to Google Calendar.
 * Includes conflict checking.
 * Requires an authenticated Firebase user and a valid ID Token.
 */
app.post('/api/confirm-booking', verifyFirebaseToken, async (req, res) => {
    const uid = req.uid;
    const { bookingData, userName, editingBookingId } = req.body;

    if (!bookingData) {
        return res.status(400).json({ error: 'Booking data is required.' });
    }

    const { date, time, duration, userTimeZone } = bookingData;

    if (!date || !time || isNaN(duration) || !userTimeZone) {
        return res.status(400).json({ error: 'Date, time, duration, and userTimeZone are required booking data.' });
    }

    try {
        // --- CONFLICT CHECK ---
        const conflictingBookings = await getConflictingBookings(date, time, duration, userTimeZone, editingBookingId);
        if (conflictingBookings.length > 0) {
            console.log(`Booking conflict detected for user ${uid}:`, conflictingBookings);
            // Return 409 Conflict status
            return res.status(409).json({
                error: 'The selected time slot is already booked. Please choose another time.',
                conflictingSlots: conflictingBookings.map(b => ({
                    date: b.date,
                    time: b.time,
                    duration: b.duration,
                    userName: b.userName
                }))
            });
        }
        // --- END CONFLICT CHECK ---


        // --- 1. Determine Firestore Document Reference and existing calendarEventId ---
        const bookingsCollectionRef = db.collection(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings`);
        let bookingDocRef;
        let existingCalendarEventId = null;

        if (editingBookingId) {
            bookingDocRef = bookingsCollectionRef.doc(editingBookingId);
            const existingBookingSnap = await bookingDocRef.get();
            if (existingBookingSnap.exists) {
                const existingBookingData = existingBookingSnap.data();
                existingCalendarEventId = existingBookingData.calendarEventId || null;
                console.log(`Editing booking ${editingBookingId}. Existing calendarEventId: ${existingCalendarEventId}`);
            } else {
                console.warn(`Attempted to edit booking ${editingBookingId} but it does not exist in Firestore. Creating as new.`);
                bookingDocRef = await bookingsCollectionRef.add({
                    ...bookingData,
                    userId: uid,
                    userName: userName,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`Booking ${editingBookingId} not found, created as new with ID: ${bookingDocRef.id}`);
            }
        } else {
            bookingDocRef = await bookingsCollectionRef.add({
                ...bookingData,
                userId: uid,
                userName: userName,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Booking ADDED to Firestore: ${bookingDocRef.id}`);
        }

        // --- 2. Update Firestore Booking Data (after determining docRef) ---
        await bookingDocRef.set({
            ...bookingData,
            userId: uid,
            userName: userName,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`Firestore booking ${bookingDocRef.id} updated/set.`);


        // --- 3. Create/Update Google Calendar Event ---
        let newOrUpdatedCalendarEventId = existingCalendarEventId; 
        if (calendar && googleCalendarId) {
            try {
                const startMoment = moment.tz(`${date} ${time}`, userTimeZone);
                const endMoment = startMoment.clone().add(duration, 'hours');

                const eventResource = {
                    summary: `DJ Studio Booking by ${userName}`,
                    description: `Booking ID: ${bookingDocRef.id}\nDate: ${date}\nTime: ${time} - ${endMoment.format('HH:mm')}\nDuration: ${duration} hours\nEquipment: ${bookingData.equipment.map(eq => eq.name).join(', ')}\nPayment: ${bookingData.paymentMethod} (${bookingData.paymentStatus})`,
                    start: {
                        dateTime: startMoment.toISOString(),
                        timeZone: userTimeZone,
                    },
                    end: {
                        dateTime: endMoment.toISOString(),
                        timeZone: userTimeZone,
                    },
                    reminders: {
                        useDefault: false,
                        overrides: [
                            { method: 'email', minutes: 24 * 60 },
                            { method: 'popup', minutes: 10 },    
                        ],
                    },
                };

                let response;
                if (existingCalendarEventId) {
                    response = await calendar.events.update({
                        calendarId: googleCalendarId,
                        eventId: existingCalendarEventId,
                        resource: eventResource,
                        sendUpdates: 'all'
                    });
                    newOrUpdatedCalendarEventId = response.data.id;
                    console.log('Calendar event UPDATED:', response.data.htmlLink, 'Event ID:', newOrUpdatedCalendarEventId);
                } else {
                    response = await calendar.events.insert({
                        calendarId: googleCalendarId,
                        resource: eventResource,
                        sendUpdates: 'all'
                    });
                    newOrUpdatedCalendarEventId = response.data.id;
                    console.log('Calendar event CREATED:', response.data.htmlLink, 'Event ID:', newOrUpdatedCalendarEventId);
                }

                await bookingDocRef.set({ calendarEventId: newOrUpdatedCalendarEventId }, { merge: true });
                console.log(`Firestore booking ${bookingDocRef.id} updated with calendarEventId: ${newOrUpdatedCalendarEventId}`);

            } catch (calendarError) {
                console.error(`Error ${existingCalendarEventId ? 'updating' : 'creating'} Google Calendar event:`, calendarError.message);
            }

        } else {
            console.warn('Google Calendar API not initialized or calendar ID not set. Skipping calendar event creation/update.');
        }

        res.status(200).json({
            success: true,
            message: editingBookingId ? 'Booking updated and calendar event (attempted)!' : 'Booking confirmed and calendar event (attempted)!',
            bookingId: bookingDocRef.id,
            calendarEventId: newOrUpdatedCalendarEventId 
        });

    } catch (error) {
        console.error('Error confirming booking or creating calendar event (Firestore/overall):', error);
        return res.status(500).json({ error: 'Failed to confirm booking or create calendar event.', details: error.message });
    }
});

/**
 * GET /api/check-booked-slots
 * Returns all currently booked time slots for a given date.
 * Query parameter: `date` (YYYY-MM-DD).
 * Requires authentication.
 */
app.get('/api/check-booked-slots', verifyFirebaseToken, async (req, res) => {
    const { date } = req.query; // Get date from query parameters

    if (!date) {
        return res.status(400).json({ error: 'Date query parameter is required (YYYY-MM-DD).' });
    }

    try {
        // Query all 'bookings' across all users for the specific date
        // IMPORTANT: This requires a Firestore Collection Group Index on 'bookings' collection.
        const bookingsQuery = db.collectionGroup('bookings')
            .where('date', '==', date);

        const querySnapshot = await bookingsQuery.get();
        const bookedSlots = [];

        querySnapshot.forEach(docSnapshot => {
            const booking = docSnapshot.data();
            // Return simplified booking data for booked slots
            bookedSlots.push({
                id: docSnapshot.id,
                date: booking.date,
                time: booking.time,
                duration: booking.duration,
                userName: booking.userName || 'Unknown User' // Include user name for display
            });
        });

        res.status(200).json({ bookedSlots: bookedSlots });

    } catch (error) {
        console.error('Error fetching booked slots:', error);
        return res.status(500).json({ error: 'Failed to fetch booked slots.' });
    }
});


/**
 * DELETE /api/cancel-calendar-event
 * Handles deleting an event from Google Calendar.
 * Requires an authenticated Firebase user and a valid ID Token.
 */
app.delete('/api/cancel-calendar-event', verifyFirebaseToken, async (req, res) => {
    const { calendarEventId } = req.body;

    if (!calendarEventId) {
        return res.status(400).json({ error: 'Calendar event ID is required.' });
    }

    if (!calendar || !googleCalendarId) {
        console.warn('Google Calendar API not initialized or calendar ID not set. Cannot delete event.');
        return res.status(500).json({ error: 'Backend calendar service not ready.' });
    }

    try {
        await calendar.events.delete({
            calendarId: googleCalendarId,
            eventId: calendarEventId
        });
        console.log(`Google Calendar event ${calendarEventId} deleted successfully.`);
        res.status(200).json({ success: true, message: 'Calendar event deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting Google Calendar event ${calendarEventId}:`, error.message);
        return res.status(500).json({ error: 'Failed to delete calendar event.', details: error.message });
    }
});


// Start the server
app.listen(port, () => {
    console.log(`Standalone backend listening on port ${port}`);
    console.log(`Access at: http://localhost:${port}`);
    console.log(`Profile update endpoint: http://localhost:${port}/api/update-profile`);
    console.log(`Confirm booking endpoint: http://localhost:${port}/api/confirm-booking`);
    console.log(`Cancel calendar event endpoint: http://localhost:${port}/api/cancel-calendar-event`);
    console.log(`Check booked slots endpoint: http://localhost:${port}/api/check-booked-slots`);
});
