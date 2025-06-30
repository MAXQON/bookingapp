// server.js - Enhanced Backend with Firebase, Firestore, and Google Calendar

// --- Core Dependencies ---
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
<<<<<<< HEAD
const admin = require('firebase-admin');
const { google } = require('googleapis'); // Import googleapis library
=======
const helmet = require('helmet'); // For setting security-related HTTP headers
const rateLimit = require('express-rate-limit'); // For protecting against brute-force attacks
const { body, validationResult } = require('express-validator'); // For input validation
const hpp = require('hpp'); // For HTTP Parameter Pollution protection

// --- Firebase Admin SDK & Google APIs ---
const admin = require('firebase-admin');
const { google } = require('googleapis');
const moment = require('moment-timezone'); // For robust timezone handling

// --- Utility Functions ---
/**
 * Calculates the end time given a start time and duration in hours.
 * This is needed for Google Calendar event creation and description.
 * @param {string} startTime - The start time string (e.g., '09:00').
 * @param {number} durationHours - The duration in hours.
 * @returns {string} The end time string (e.g., '11:00').
 */
const getEndTime = (startTime, durationHours) => {
    if (!startTime || isNaN(durationHours)) return '';
    const [hour, minute] = startTime.split(':');
    const start = new Date(); // Using a dummy date, only time is relevant
    start.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
    start.setHours(start.getHours() + durationHours);
    return `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
};
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")

// --- Custom Error Class for Centralized Error Handling ---
class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = isOperational; // Operational errors are expected (e.g., bad input, conflict)
        Error.captureStackTrace(this, this.constructor);
    }
}

// --- Firebase Admin SDK Initialization ---
const encodedServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
const projectId = process.env.FIREBASE_PROJECT_ID;
<<<<<<< HEAD
const googleCalendarId = process.env.GOOGLE_CALENDAR_ID; // New: Get Google Calendar ID

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

<<<<<<< HEAD
let serviceAccount;
=======


let serviceAccount; // This will hold the parsed service account JSON object for Firebase Admin
<<<<<<< HEAD
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
=======
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
try {
    const decodedServiceAccountJson = Buffer.from(encodedServiceAccountJson, 'base64').toString('utf8');
    serviceAccount = JSON.parse(decodedServiceAccountJson);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com`
    });
    console.log('Firebase Admin SDK initialized successfully.');
<<<<<<< HEAD
<<<<<<< HEAD
=======
=======
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
    // Only log the client email for Firebase Admin SDK to confirm it's using the right one
    console.log('Firebase Admin: Client Email from decoded JSON:', serviceAccount.client_email);

>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
} catch (error) {
    console.error('FATAL ERROR: Failed to initialize Firebase Admin SDK.', error.message);
    process.exit(1);
}

// Initialize Google Calendar API client
let calendar;
<<<<<<< HEAD
try {
    const jwtClient = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'] // Scopes for calendar access
    );

    jwtClient.authorize((err, tokens) => {
        if (err) {
            console.error('Error authorizing JWT client for Google Calendar:', err);
            return;
        }
        console.log('Google Calendar JWT client authorized.');
    });

    calendar = google.calendar({ version: 'v3', auth: jwtClient });
    console.log('Google Calendar API client initialized.');
} catch (error) {
    console.error('Error initializing Google Calendar API client:', error.message);
    calendar = null; // Set to null if initialization fails
}

=======
// Wrap the async initialization in an immediately invoked async function
(async () => {
    try {
        // --- IMPORTANT: Use GoogleAuth with keyFile directly ---
        // This is the most robust way to provide service account credentials
        // when facing persistent "No key or keyFile set" errors.
        console.log(`Google Calendar: Attempting to authorize using key file at: ${googleAuthKeyFilePath}`);
        console.log('Current NODE_ENV:', process.env.NODE_ENV); // Useful for debugging Render vs. local
=======
const googleCalendarId = process.env.GOOGLE_CALENDAR_ID;
const googleAuthKeyFilePath = process.env.GOOGLE_AUTH_KEY_FILE_PATH;
const APP_ID_FOR_FIRESTORE_PATH = process.env.APP_ID_FOR_FIRESTORE_PATH;

// Validate critical environment variables
const validateEnv = () => {
    if (!encodedServiceAccountJson) {
        throw new Error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 not defined.');
    }
    if (!projectId) {
        throw new Error('FATAL ERROR: FIREBASE_PROJECT_ID not defined.');
    }
    // Google Calendar ID is not strictly fatal for the app to run, but calendar features won't work
    if (!googleCalendarId) {
        console.warn('WARNING: GOOGLE_CALENDAR_ID not defined. Google Calendar integration will not work.');
    }
    if (!googleAuthKeyFilePath) {
        throw new Error('FATAL ERROR: GOOGLE_AUTH_KEY_FILE_PATH not defined. Google Calendar integration will not work.');
    }
    if (!APP_ID_FOR_FIRESTORE_PATH) {
        throw new Error('FATAL ERROR: APP_ID_FOR_FIRESTORE_PATH not defined.');
    }
};

let serviceAccount;
let firebaseAdminApp;
let db;
let auth;
let calendar;
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")

const initializeFirebaseAndGoogleCalendar = async () => {
    try {
        validateEnv();

        // Initialize Firebase Admin SDK
        const decodedServiceAccountJson = Buffer.from(encodedServiceAccountJson, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decodedServiceAccountJson);

        firebaseAdminApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: `https://${projectId}.firebaseio.com`
        }, 'mainAppInstance');
        console.log('Firebase Admin SDK initialized successfully with name:', firebaseAdminApp.name);

        db = admin.firestore(firebaseAdminApp);
        auth = admin.auth(firebaseAdminApp);
        console.log('Firestore and Auth services initialized.');

        // Initialize Google Calendar API client
        console.log(`Google Calendar: Attempting to authorize using key file at: ${googleAuthKeyFilePath}`);
        const authClient = new google.auth.GoogleAuth({
            keyFile: googleAuthKeyFilePath, // Point directly to the secret file path
            scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'] // Scopes for calendar access
        });

        const authorizedClient = await authClient.getClient();
<<<<<<< HEAD
        
        console.log('Google Calendar: Client Email (from key file):', authorizedClient.credentials.client_email);
        console.log('Google Calendar: Private Key (from key file, first 50 chars):', authorizedClient.credentials.private_key ? authorizedClient.credentials.private_key.substring(0, 50) + '...' : 'NOT LOADED');
        console.log('Google Calendar: Private Key (from key file, last 50 chars):', authorizedClient.credentials.private_key && authorizedClient.credentials.private_key.length > 50 ? '...' + authorizedClient.credentials.private_key.substring(authorizedClient.credentials.private_key.length - 50) : '');


=======
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
        calendar = google.calendar({ version: 'v3', auth: authorizedClient });
        console.log('Google Calendar API client initialized successfully using key file.');

    } catch (error) {
<<<<<<< HEAD
        console.error('Error initializing Google Calendar API client:', error.message);
        calendar = null; // Set to null if initialization fails
    }
})(); // End of immediately invoked async function

<<<<<<< HEAD
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
=======
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))

// Get references to Firestore and Auth services
const db = admin.firestore();
const auth = admin.auth();

const APP_ID_FOR_FIRESTORE_PATH = process.env.APP_ID_FOR_FIRESTORE_PATH;
if (!APP_ID_FOR_FIRESTORE_PATH) {
    console.error('FATAL ERROR: APP_ID_FOR_FIRESTORE_PATH not defined.');
    process.exit(1);
}
=======
        console.error('FATAL ERROR during Firebase/Google Calendar initialization:', error.message);
        // Exit process if core services fail to initialize
        process.exit(1);
    }
};
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")

// --- Express App Setup ---
const app = express();
const port = process.env.PORT || 5000;

// --- Middleware ---
// Security Middleware
app.use(helmet()); // Basic security headers
app.use(hpp()); // Prevent HTTP Parameter Pollution

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5000',
    'https://maxqon.github.io', // Your GitHub Pages or Netlify/Vercel URL
    process.env.RENDER_EXTERNAL_URL // For Render.com deployments
].filter(Boolean); // Remove any falsey values from the array

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}.`;
            console.error('CORS: Blocked origin.', msg);
            return callback(new AppError(msg, 403), false); // Use AppError for consistent handling
        }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    credentials: true,
    optionsSuccessStatus: 204
}));

app.use(express.json()); // For parsing JSON request bodies

// --- Rate Limiting Middleware ---
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Max 100 requests per 15 minutes per IP
    message: 'Too many requests from this IP, please try again after 15 minutes',
    statusCode: 429,
    headers: true,
});

const bookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Max 10 booking confirmations per hour per IP
    message: 'Too many booking attempts from this IP, please try again after an hour',
    statusCode: 429,
    headers: true,
});

app.use(apiLimiter); // Apply to all API routes, or selectively later

// --- Authentication Middleware ---
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new AppError('Unauthorized: No token provided or invalid format.', 401));
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
<<<<<<< HEAD
=======
        if (!auth) {
            console.error('Firebase Auth not initialized when trying to verify token.');
            return next(new AppError('Server authentication service not ready.', 500));
        }
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
        const decodedToken = await auth.verifyIdToken(idToken);
        req.uid = decodedToken.uid;
        req.user = decodedToken; // Store entire decoded token for potential future use (e.g., email)
        next();
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error.message);
        return next(new AppError(`Unauthorized: Invalid token. ${error.message}`, 403));
    }
};

<<<<<<< HEAD
=======
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
<<<<<<< HEAD
=======
    if (!db) {
        throw new AppError("Firestore DB is not initialized.", 500);
    }
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
    try {
        const proposedStart = moment.tz(`${date} ${time}`, userTimeZone);
        const proposedEnd = proposedStart.clone().add(duration, 'hours');

        // Query all 'bookings' across all users for the specific date
        // IMPORTANT: This requires a Firestore Collection Group Index on 'bookings' collection.
        // If you get an error here, check Firebase console for index creation instructions.
        const bookingsQuery = db.collectionGroup('bookings')
<<<<<<< HEAD
            .where('date', '==', date); // Assuming 'date' is stored as YYYY-MM-DD string
=======
            .where('date', '==', date)
            .orderBy('time', 'asc'); // Order by time for easier manual inspection, though not strictly needed for conflict logic
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")

        const querySnapshot = await bookingsQuery.get();
        const conflicting = [];

        querySnapshot.forEach(docSnapshot => {
            const booking = docSnapshot.data();
            // Exclude the booking being edited from conflict check
            if (excludeBookingId && docSnapshot.id === excludeBookingId) {
                return; // Skip the booking being edited
            }

<<<<<<< HEAD
            // Reconstruct existing booking's time in its recorded timezone (or assume userTimeZone)
            // Use userTimeZone for consistency, as we're comparing against the new proposed booking
            const existingStart = moment.tz(`${booking.date} ${booking.time}`, booking.userTimeZone || userTimeZone);
            const existingEnd = existingStart.clone().add(booking.duration, 'hours');

            // Check for overlap:
            // (proposedStart < existingEnd AND proposedEnd > existingStart)
=======
            // Fallback to userTimeZone if booking.userTimeZone is missing, though it should ideally be stored
            const existingStart = moment.tz(`${booking.date} ${booking.time}`, booking.userTimeZone || userTimeZone);
            const existingEnd = existingStart.clone().add(booking.duration, 'hours');

            // Check for overlap: [start1, end1) and [start2, end2) overlap if start1 < end2 AND start2 < end1
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
            if (proposedStart.isBefore(existingEnd) && proposedEnd.isAfter(existingStart)) {
                conflicting.push({ id: docSnapshot.id, ...booking });
            }
        });
        return conflicting;
    } catch (error) {
        console.error('Error getting conflicting bookings:', error);
<<<<<<< HEAD
        throw new Error('Failed to check for booking conflicts.');
    }
};


>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
=======
        throw new AppError('Failed to check for conflicting bookings.', 500);
    }
};

>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
// --- Routes ---
app.get('/', (req, res) => {
    res.status(200).json({ message: 'DJ Booking Backend is running!' });
});

<<<<<<< HEAD
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

<<<<<<< HEAD
=======
    const { date, time, duration, userTimeZone } = bookingData;

    if (!date || !time || isNaN(duration) || !userTimeZone) {
        return res.status(400).json({ error: 'Date, time, duration, and userTimeZone are required booking data.' });
    }

>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
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
=======
app.post(
    '/api/update-profile',
    verifyFirebaseToken,
    [
        body('displayName')
            .trim()
            .notEmpty().withMessage('Display name is required.')
            .isString().withMessage('Display name must be a string.')
            .isLength({ min: 2, max: 50 }).withMessage('Display name must be between 2 and 50 characters.')
    ],
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return next(new AppError('Validation failed: ' + errors.array().map(e => e.msg).join(', '), 400));
        }

        const uid = req.uid;
        const { displayName } = req.body;

        if (!auth) return next(new AppError('Authentication service not initialized.', 500));
        if (!db) return next(new AppError('Database service not initialized.', 500));

        try {
            await auth.updateUser(uid, { displayName });
            const userProfileDocRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/profiles/userProfile`);
            await userProfileDocRef.set({
                userId: uid,
                displayName,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            res.status(200).json({ success: true, message: 'User profile updated successfully!' });

        } catch (error) {
            console.error('Error updating user profile:', error);
            next(new AppError('Failed to update user profile due to a server error.', 500));
        }
    }
);

app.post(
    '/api/confirm-booking',
    verifyFirebaseToken,
    bookingLimiter, // Apply booking specific rate limiting
    [
        // Validate bookingData
        body('bookingData').exists().withMessage('Booking data is required.'),
        body('bookingData.date').isDate({ format: 'YYYY-MM-DD' }).withMessage('Invalid date format (YYYY-MM-DD).'),
        body('bookingData.time').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Invalid time format (HH:MM).'),
        body('bookingData.duration').isFloat({ min: 0.5, max: 24 }).withMessage('Duration must be a number between 0.5 and 24 hours.'),
        body('bookingData.userTimeZone').notEmpty().withMessage('User timezone is required.'),
        body('bookingData.equipment').isArray().withMessage('Equipment must be an array.'),
        body('bookingData.paymentMethod').notEmpty().withMessage('Payment method is required.'),
        body('bookingData.paymentStatus').notEmpty().withMessage('Payment status is required.'),
        body('userName').notEmpty().withMessage('User name is required for the booking record.')
    ],
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return next(new AppError('Validation failed: ' + errors.array().map(e => e.msg).join(', '), 400));
        }

        const uid = req.uid;
        const { bookingData, userName, editingBookingId } = req.body;
        const { date, time, duration, userTimeZone } = bookingData;

        if (!db) return next(new AppError('Database service not initialized.', 500));

        try {
            // --- CONFLICT CHECK ---
            const conflictingBookings = await getConflictingBookings(date, time, duration, userTimeZone, editingBookingId);
            if (conflictingBookings.length > 0) {
                console.log(`Booking conflict detected for user ${uid}:`, conflictingBookings);
                return next(new AppError('The selected time slot is already booked. Please choose another time.', 409, {
                    conflictingSlots: conflictingBookings.map(b => ({
                        date: b.date,
                        time: b.time,
                        duration: b.duration,
                        userName: b.userName
                    }))
                }));
            }

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
                    // If the original doc doesn't exist, treat it as a new booking
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

            // --- 2. Update/Set Firestore Booking Data (after determining docRef) ---
            await bookingDocRef.set({
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
                ...bookingData,
                userId: uid,
                userName: userName,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`Firestore booking ${bookingDocRef.id} updated/set.`);

<<<<<<< HEAD
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
<<<<<<< HEAD
        console.error('Error confirming booking or creating calendar event:', error);
=======
        console.error('Error confirming booking or creating calendar event (Firestore/overall):', error);
<<<<<<< HEAD
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
=======
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
        return res.status(500).json({ error: 'Failed to confirm booking or create calendar event.', details: error.message });
=======
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
                                { method: 'email', minutes: 24 * 60 }, // 24 hours prior
                                { method: 'popup', minutes: 10 },    // 10 minutes prior
                            ],
                        },
                    };

                    let response;
                    if (existingCalendarEventId) {
                        response = await calendar.events.update({
                            calendarId: googleCalendarId,
                            eventId: existingCalendarEventId,
                            resource: eventResource,
                            sendUpdates: 'all' // Send notifications to attendees if updated
                        });
                        newOrUpdatedCalendarEventId = response.data.id;
                        console.log('Calendar event UPDATED:', response.data.htmlLink, 'Event ID:', newOrUpdatedCalendarEventId);
                    } else {
                        response = await calendar.events.insert({
                            calendarId: googleCalendarId,
                            resource: eventResource,
                            sendUpdates: 'all' // Send notifications to attendees if created
                        });
                        newOrUpdatedCalendarEventId = response.data.id;
                        console.log('Calendar event CREATED:', response.data.htmlLink, 'Event ID:', newOrUpdatedCalendarEventId);
                    }

                    // Update Firestore with the calendar event ID
                    await bookingDocRef.set({ calendarEventId: newOrUpdatedCalendarEventId }, { merge: true });
                    console.log(`Firestore booking ${bookingDocRef.id} updated with calendarEventId: ${newOrUpdatedCalendarEventId}`);

                } catch (calendarError) {
                    console.error(`Error ${existingCalendarEventId ? 'updating' : 'creating'} Google Calendar event:`, calendarError.message);
                    // Log the error but don't stop the booking process, as Firestore is primary
                    // The client can be informed that calendar sync failed
                    // You might want to queue a retry or send an alert here
                }
            } else {
                console.warn('Google Calendar API not initialized or calendar ID not set. Skipping calendar event creation/update.');
            }

            res.status(200).json({
                success: true,
                message: editingBookingId ? 'Booking updated successfully! Calendar sync attempted.' : 'Booking confirmed! Calendar sync attempted.',
                bookingId: bookingDocRef.id,
                calendarEventId: newOrUpdatedCalendarEventId
            });

        } catch (error) {
            console.error('Error in confirm-booking route:', error);
            next(error); // Pass to centralized error handler
        }
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
    }
);

<<<<<<< HEAD
<<<<<<< HEAD
=======
/**
 * GET /api/check-booked-slots
 * Returns all currently booked time slots for a given date.
 * Query parameter: `date` (YYYY-MM-DD).
 * Requires authentication.
 */
app.get('/api/check-booked-slots', verifyFirebaseToken, async (req, res) => {
    const { date } = req.query; // Get date from query parameters
=======
app.get('/api/check-booked-slots', verifyFirebaseToken, async (req, res, next) => {
    const { date } = req.query;
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")

    if (!date || !moment(date, 'YYYY-MM-DD', true).isValid()) {
        return next(new AppError('Date query parameter is required and must be in YYYY-MM-DD format.', 400));
    }
<<<<<<< HEAD
=======
    if (!db) {
        return next(new AppError('Database service not initialized.', 500));
    }
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")

    try {
        // Query all 'bookings' across all users for the specific date
        // IMPORTANT: This requires a Firestore Collection Group Index on 'bookings' collection.
        const bookingsQuery = db.collectionGroup('bookings')
<<<<<<< HEAD
            .where('date', '==', date);
=======
            .where('date', '==', date)
            .orderBy('time', 'asc');
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")

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
<<<<<<< HEAD
                userName: booking.userName || 'Unknown User' // Include user name for display
=======
                userName: booking.userName || 'Unknown User',
                userTimeZone: booking.userTimeZone || 'Asia/Jakarta' // Default timezone if not stored
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
            });
        });

        res.status(200).json({ bookedSlots: bookedSlots });

    } catch (error) {
        console.error('Error fetching booked slots:', error);
<<<<<<< HEAD
        return res.status(500).json({ error: 'Failed to fetch booked slots.' });
=======
        next(new AppError('Failed to fetch booked slots.', 500));
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
    }
});

app.delete(
    '/api/cancel-booking/:bookingId', // Changed to use URL parameter for ID
    verifyFirebaseToken,
    async (req, res, next) => {
        const { bookingId } = req.params; // Get bookingId from URL parameters
        const uid = req.uid;

        if (!bookingId) {
            return next(new AppError('Booking ID is required.', 400));
        }
        if (!db) {
            return next(new AppError('Database service not initialized.', 500));
        }

        try {
            const bookingDocRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings/${bookingId}`);
            const bookingSnap = await bookingDocRef.get();

            if (!bookingSnap.exists) {
                return next(new AppError('Booking not found or you do not have permission to delete it.', 404));
            }

            const bookingData = bookingSnap.data();
            const calendarEventId = bookingData.calendarEventId;

            // Delete from Firestore first
            await bookingDocRef.delete();
            console.log(`Firestore booking ${bookingId} deleted successfully.`);

            // Attempt to delete from Google Calendar if event ID exists
            if (calendarEventId && calendar && googleCalendarId) {
                try {
                    await calendar.events.delete({
                        calendarId: googleCalendarId,
                        eventId: calendarEventId
                    });
                    console.log(`Google Calendar event ${calendarEventId} deleted successfully.`);
                } catch (calendarError) {
                    console.error(`Error deleting Google Calendar event ${calendarEventId}:`, calendarError.message);
                    // Log the error but don't throw, as Firestore deletion succeeded
                    // You might want to queue a retry or send an alert here
                }
            } else {
                console.warn('No Google Calendar event ID found for booking or Calendar API not initialized. Skipping calendar event deletion.');
            }

            res.status(200).json({ success: true, message: 'Booking cancelled successfully. Calendar event deletion attempted.' });

        } catch (error) {
            console.error('Error cancelling booking:', error);
            next(new AppError('Failed to cancel booking due to a server error.', 500));
        }
    }
);


// --- Centralized Error Handling Middleware ---
app.use((err, req, res, next) => {
    // Default to 500 if status code is not set or is a programming error
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Log the error for debugging
    console.error(`ERROR ${err.statusCode} (${err.status}):`, err);

    // Send a consistent error response to the client
    res.status(err.statusCode).json({
        status: err.status,
        message: err.isOperational ? err.message : 'Something went wrong!', // Hide internal errors from client
        ...(err.details && { details: err.details }), // Include custom details if available
        // In development, you might want to send more error details for debugging
        // ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

<<<<<<< HEAD
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))

// Start the server
app.listen(port, () => {
    console.log(`Standalone backend listening on port ${port}`);
    console.log(`Access at: http://localhost:${port}`);
    console.log(`Profile update endpoint: http://localhost:${port}/api/update-profile`);
    console.log(`Confirm booking endpoint: http://localhost:${port}/api/confirm-booking`);
<<<<<<< HEAD
<<<<<<< HEAD
=======
    console.log(`Cancel calendar event endpoint: http://localhost:${port}/api/cancel-calendar-event`);
    console.log(`Check booked slots endpoint: http://localhost:${port}/api/check-booked-slots`);
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
=======
    console.log(`Cancel calendar event endpoint: http://localhost:${port}/api/cancel-calendar-event`);
    console.log(`Check booked slots endpoint: http://localhost:${port}/api/check-booked-slots`);
>>>>>>> parent of ced1bc8 (Index Troubleshooting Attempt (Delay + Logging))
});
=======
// --- Start the Server ---
const startServer = async () => {
    // Ensure Firebase and Google Calendar are initialized before starting the server
    await initializeFirebaseAndGoogleCalendar();

    app.listen(port, () => {
        console.log(`Standalone backend listening on port ${port}`);
        console.log(`Access at: http://localhost:${port}`);
        console.log(`Profile update endpoint: http://localhost:${port}/api/update-profile`);
        console.log(`Confirm booking endpoint: http://localhost:${port}/api/confirm-booking`);
        console.log(`Check booked slots endpoint: http://localhost:${port}/api/check-booked-slots?date=YYYY-MM-DD`);
        console.log(`Cancel booking endpoint: DELETE http://localhost:${port}/api/cancel-booking/:bookingId`);
    });
};

// Execute server start
startServer();
>>>>>>> parent of f91c523 (Revert "refactored and improved version of your server.js")
