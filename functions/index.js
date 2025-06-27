// functions/index.js

// Import the Firebase Admin SDK to interact with Firebase services from the backend.
const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the Firebase Admin SDK. This enables server-side access to Firebase services.
// It will automatically pick up credentials when deployed to Cloud Functions.
admin.initializeApp();

// Get a reference to the Firestore database.
const db = admin.firestore();

// Define a constant for your APP_ID_FOR_FIRESTORE_PATH for consistent paths.
// This should match the APP_ID_FOR_FIRESTORE_PATH in your frontend App.jsx.
const APP_ID_FOR_FIRESTORE_PATH = 'booking-app-1af02';

/**
 * HTTPS Callable Function to update a user's display name.
 *
 * This function is called directly from your client-side React app.
 * It's secure because:
 * 1. It automatically verifies Firebase Authentication (context.auth is available).
 * 2. Sensitive operations (like updating auth profile and writing to specific Firestore paths)
 * are performed on the server with Admin SDK privileges, not directly from the client.
 * 3. It prevents clients from directly manipulating data they shouldn't.
 *
 * @param {object} data - The data sent from the client. Expected: { displayName: string }
 * @param {object} context - The context of the function call, including authentication info.
 * @returns {object} A success or error message.
 */
exports.updateUserProfile = functions.https.onCall(async (data, context) => {
    // 1. Authenticate the user: Ensure the user is logged in.
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const uid = context.auth.uid; // Get the authenticated user's UID
    const newDisplayName = data.displayName; // Get the new display name from the client

    // 2. Validate input: Ensure the new display name is provided and not empty.
    if (!newDisplayName || typeof newDisplayName !== 'string' || newDisplayName.trim() === '') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'The "displayName" argument is required and must be a non-empty string.'
        );
    }

    try {
        // 3. Update the user's display name in Firebase Authentication.
        await admin.auth().updateUser(uid, {
            displayName: newDisplayName.trim(),
        });
        console.log(`Firebase Auth profile updated for user ${uid}: ${newDisplayName}`);

        // 4. Update or create the user's profile document in Firestore.
        // This path must match the one used in your frontend's useEffect for fetching/creating profiles.
        const userProfileDocRef = db.doc(`artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${uid}/profiles/userProfile`);

        await userProfileDocRef.set({
            userId: uid,
            displayName: newDisplayName.trim(),
            // You might want to update or add a lastUpdated timestamp here
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }); // Use merge: true to update existing fields without overwriting the whole document.
        console.log(`Firestore profile document updated for user ${uid}: ${newDisplayName}`);

        // 5. Return a success response to the client.
        return { success: true, message: 'User profile updated successfully!' };

    } catch (error) {
        console.error('Error updating user profile:', error);

        // Convert Firebase errors into HttpsError for client-side consumption.
        if (error.code === 'auth/user-not-found') {
            throw new functions.https.HttpsError('not-found', 'User not found.');
        } else if (error.code === 'auth/invalid-argument') {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid argument provided to auth.updateUser.');
        }
        // Generic error for other issues.
        throw new functions.https.HttpsError(
            'internal',
            'Failed to update user profile due to a server error.',
            error.message // Optionally pass the original error message for debugging
        );
    }
});