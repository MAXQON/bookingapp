// standalone-backend/server.js

const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = require('./googleCalendar');

// Initialize Firebase Admin SDK
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(bodyParser.json());

const APP_ID_FOR_FIRESTORE_PATH = 'booking-app-1af02';
const ADMIN_EMAIL = 'polarsolutions.warehouse@gmail.com';

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Middleware to authenticate requests
const authenticate = async (req, res, next) => {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).send({ error: 'Unauthorized' });
  }
};

app.post('/api/update-profile', authenticate, async (req, res) => {
  const { displayName } = req.body;
  const { uid } = req.user;

  if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
    return res.status(400).send({ error: 'The "displayName" argument is required and must be a non-empty string.' });
  }

  try {
    await admin.auth().updateUser(uid, {
      displayName: displayName.trim(),
    });

    const userProfileDocRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/profiles/userProfile`);
    await userProfileDocRef.set({
      userId: uid,
      displayName: displayName.trim(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.send({ success: true, message: 'User profile updated successfully!' });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).send({ error: 'Failed to update user profile due to a server error.' });
  }
});

app.post('/api/confirm-booking', authenticate, async (req, res) => {
    const { bookingData, userName, editingBookingId } = req.body;
    const { uid, email } = req.user;

    try {
        let bookingId = editingBookingId;
        if (editingBookingId) {
            const bookingRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings/${editingBookingId}`);
            await bookingRef.update({ ...bookingData, userName, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
            await updateCalendarEvent(bookingId, bookingData);
        } else {
            const bookingRef = await db.collection(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings`).add({
                ...bookingData,
                userName,
                userId: uid,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            bookingId = bookingRef.id;
            await createCalendarEvent(bookingId, bookingData);
        }

        // Send confirmation email to client
        const mailOptionsToClient = {
            from: process.env.GMAIL_USER,
            to: email,
            subject: 'Booking Confirmation',
            text: `Your booking for ${bookingData.date} at ${bookingData.time} is confirmed.`
        };
        transporter.sendMail(mailOptionsToClient);

        // Send notification email to admin
        const confirmationLink = `${process.env.FRONTEND_URL}/confirm-payment?bookingId=${bookingId}`;
        const mailOptionsToAdmin = {
            from: process.env.GMAIL_USER,
            to: ADMIN_EMAIL,
            subject: 'New Booking',
            html: `New booking from ${userName} (${email}) for ${bookingData.date} at ${bookingData.time}.<br/><a href="${confirmationLink}">Confirm Payment</a>`
        };
        transporter.sendMail(mailOptionsToAdmin);

        res.send({ success: true, bookingId });
    } catch (error) {
        console.error('Error confirming booking:', error);
        res.status(500).send({ error: 'Failed to confirm booking.' });
    }
});

app.post('/api/cancel-booking', authenticate, async (req, res) => {
    const { bookingId } = req.body;
    const { uid } = req.user;

    try {
        const bookingRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings/${bookingId}`);
        await bookingRef.delete();
        await deleteCalendarEvent(bookingId);
        res.send({ success: true, message: 'Booking cancelled successfully.' });
    } catch (error) {
        console.error('Error cancelling booking:', error);
        res.status(500).send({ error: 'Failed to cancel booking.' });
    }
});

app.get('/api/check-booked-slots', async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).send({ error: 'Date parameter is required.' });
    }

    try {
        const bookingsSnapshot = await db.collectionGroup('bookings').where('date', '==', date).get();
        const bookedSlots = bookingsSnapshot.docs.map(doc => doc.data());
        res.send({ bookedSlots });
    } catch (error) {
        console.error('Error fetching booked slots:', error);
        res.status(500).send({ error: 'Failed to fetch booked slots.' });
    }
});

app.post('/api/confirm-payment', authenticate, async (req, res) => {
    const { bookingId } = req.body;
    const { uid } = req.user;

    try {
        const bookingRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings/${bookingId}`);
        await bookingRef.update({ paymentStatus: 'paid' });
        res.send({ success: true, message: 'Payment confirmed successfully!' });
    } catch (error) {
        console.error('Error confirming payment:', error);
        res.status(500).send({ error: 'Failed to confirm payment.' });
    }
});

// Admin routes
app.get('/api/admin/bookings', authenticate, async (req, res) => {
    // Add admin role check here in the future
    try {
        const bookingsSnapshot = await db.collectionGroup('bookings').orderBy('date', 'desc').get();
        const bookings = bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.send(bookings);
    } catch (error) {
        console.error('Error fetching all bookings:', error);
        res.status(500).send({ error: 'Failed to fetch all bookings.' });
    }
});

app.post('/api/admin/bookings', authenticate, async (req, res) => {
    // Add admin role check here in the future
    const { bookingData, userName, userEmail } = req.body;

    try {
        const userRecord = await admin.auth().getUserByEmail(userEmail);
        const uid = userRecord.uid;

        const bookingRef = await db.collection(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/bookings`).add({
            ...bookingData,
            userName,
            userId: uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        const bookingId = bookingRef.id;
        await createCalendarEvent(bookingId, bookingData);

        // Send confirmation email to client
        const mailOptionsToClient = {
            from: process.env.GMAIL_USER,
            to: userEmail,
            subject: 'Booking Confirmation',
            text: `Your booking for ${bookingData.date} at ${bookingData.time} is confirmed.`
        };
        transporter.sendMail(mailOptionsToClient);

        res.send({ success: true, bookingId });
    } catch (error) {
        console.error('Error creating booking for user:', error);
        res.status(500).send({ error: 'Failed to create booking for user.' });
    }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});