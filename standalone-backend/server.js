// server.js - Enhanced Backend with Firebase, Firestore, and Google Calendar

// --- Core Dependencies ---
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
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
            keyFile: googleAuthKeyFilePath,
            scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar']
        });

        const authorizedClient = await authClient.getClient();
        calendar = google.calendar({ version: 'v3', auth: authorizedClient });
        console.log('Google Calendar API client initialized successfully using key file.');

    } catch (error) {
        console.error('FATAL ERROR during Firebase/Google Calendar initialization:', error.message);
        // Exit process if core services fail to initialize
        process.exit(1);
    }
};

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
        if (!auth) {
            console.error('Firebase Auth not initialized when trying to verify token.');
            return next(new AppError('Server authentication service not ready.', 500));
        }
        const decodedToken = await auth.verifyIdToken(idToken);
        req.uid = decodedToken.uid;
        req.user = decodedToken; // Store entire decoded token for potential future use (e.g., email)
        next();
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error.message);
        return next(new AppError(`Unauthorized: Invalid token. ${error.message}`, 403));
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
    if (!db) {
        throw new AppError("Firestore DB is not initialized.", 500);
    }
    try {
        const proposedStart = moment.tz(`${date} ${time}`, userTimeZone);
        const proposedEnd = proposedStart.clone().add(duration, 'hours');

        const bookingsQuery = db.collectionGroup('bookings')
            .where('date', '==', date)
            .orderBy('time', 'asc'); // Order by time for easier manual inspection, though not strictly needed for conflict logic

        const querySnapshot = await bookingsQuery.get();
        const conflicting = [];

        querySnapshot.forEach(docSnapshot => {
            const booking = docSnapshot.data();
            if (excludeBookingId && docSnapshot.id === excludeBookingId) {
                return; // Skip the booking being edited
            }

            // Fallback to userTimeZone if booking.userTimeZone is missing, though it should ideally be stored
            const existingStart = moment.tz(`${booking.date} ${booking.time}`, booking.userTimeZone || userTimeZone);
            const existingEnd = existingStart.clone().add(booking.duration, 'hours');

            // Check for overlap: [start1, end1) and [start2, end2) overlap if start1 < end2 AND start2 < end1
            if (proposedStart.isBefore(existingEnd) && proposedEnd.isAfter(existingStart)) {
                conflicting.push({ id: docSnapshot.id, ...booking });
            }
        });
        return conflicting;
    } catch (error) {
        console.error('Error getting conflicting bookings:', error);
        throw new AppError('Failed to check for conflicting bookings.', 500);
    }
};

// --- Routes ---
app.get('/', (req, res) => {
    res.status(200).json({ message: 'DJ Booking Backend is running!' });
});

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
    }
);

app.get('/api/check-booked-slots', verifyFirebaseToken, async (req, res, next) => {
    const { date } = req.query;

    if (!date || !moment(date, 'YYYY-MM-DD', true).isValid()) {
        return next(new AppError('Date query parameter is required and must be in YYYY-MM-DD format.', 400));
    }
    if (!db) {
        return next(new AppError('Database service not initialized.', 500));
    }

    try {
        const bookingsQuery = db.collectionGroup('bookings')
            .where('date', '==', date)
            .orderBy('time', 'asc');

        const querySnapshot = await bookingsQuery.get();
        const bookedSlots = [];

        querySnapshot.forEach(docSnapshot => {
            const booking = docSnapshot.data();
            bookedSlots.push({
                id: docSnapshot.id,
                date: booking.date,
                time: booking.time,
                duration: booking.duration,
                userName: booking.userName || 'Unknown User',
                userTimeZone: booking.userTimeZone || 'Asia/Jakarta' // Default timezone if not stored
            });
        });

        res.status(200).json({ bookedSlots: bookedSlots });

    } catch (error) {
        console.error('Error fetching booked slots:', error);
        next(new AppError('Failed to fetch booked slots.', 500));
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