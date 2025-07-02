// src/App.jsx

// Import necessary React hooks
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

// Import Moment.js for date/time handling
import moment from 'moment';
import 'moment-timezone'; // Also import moment-timezone

// Import Firebase and Firestore modules
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged,
         createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
         GoogleAuthProvider, signInWithPopup, updateProfile } from 'firebase/auth';
import { getFirestore, collection, query, addDoc, onSnapshot, serverTimestamp,
         doc, deleteDoc, setDoc, getDoc } from 'firebase/firestore';

// --- Firebase Configuration (from Environment Variables) ---
// This is now secure and no longer hardcodes keys.
// For local development, create a .env file in your project root:
// REACT_APP_FIREBASE_API_KEY="AIza..."
// REACT_APP_FIREBASE_AUTH_DOMAIN="..."
// etc.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// --- Canvas Environment Variables ---
const APP_ID_FOR_FIRESTORE_PATH = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const INITIAL_AUTH_TOKEN_FROM_CANVAS = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Backend API Base URL ---
// IMPORTANT: For production, this should also be an environment variable.
const BACKEND_API_BASE_URL = 'https://phyon-back-end.onrender.com';

// --- Constants ---
const DJ_EQUIPMENT = [
    { id: 1, name: 'Pioneer CDJ-3000', type: 'CDJ Player', icon: '🎵', category: 'player' },
    { id: 2, name: 'Technics SL-1200', type: 'Turntable', icon: '💿', category: 'player' },
    { id: 3, name: 'DJM A9', type: 'DJ Mixer', icon: '🎛️', category: 'mixer' },
    { id: 4, name: 'DJM V10', type: 'DJ Mixer', icon: '🎚️', category: 'mixer' }
];
const ROOM_RATE_PER_HOUR = 200000;

// --- Utility Functions ---
const formatIDR = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
const formatTime = (timeString) => {
    if (!timeString) return '';
    const [hour, minute] = timeString.split(':');
    const hourNum = parseInt(hour);
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
    return `${displayHour}:${minute.padStart(2, '0')} ${ampm}`;
};
const getEndTime = (startTime, durationHours) => {
    if (!startTime || isNaN(durationHours)) return '';
    const [hour, minute] = startTime.split(':');
    const start = new Date();
    start.setHours(parseInt(hour), parseInt(minute), 0, 0);
    start.setHours(start.getHours() + durationHours);
    return `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
};

// --- Main Booking Application Component ---
function BookingApp() {
    // UI state
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedTime, setSelectedTime] = useState('');
    const [duration, setDuration] = useState(2);
    const [selectedEquipment, setSelectedEquipment] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [currentBooking, setCurrentBooking] = useState(null);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('cash');
    const [paymentConfirmMessage, setPaymentConfirmMessage] = useState(null);

    // Edit/Cancel specific state
    const [editingBookingId, setEditingBookingId] = useState(null);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [bookingToDelete, setBookingToDelete] = useState(null);

    // Conflict Check state
    const [showConflictModal, setShowConflictModal] = useState(false);
    const [conflictError, setConflictError] = useState(null);
    const [conflictingSlots, setConflictingSlots] = useState([]);
    const [bookedSlotsForDate, setBookedSlotsForDate] = useState([]);

    // Firebase state
    const [userId, setUserId] = useState(null);
    const [userName, setUserName] = useState('');
    const [firebaseAppInstance, setFirebaseAppInstance] = useState(null);
    const [dbInstance, setDbInstance] = useState(null);
    const [authInstance, setAuthInstance] = useState(null);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [isLoadingBookings, setIsLoadingBookings] = useState(false);
    const [error, setError] = useState(null);
    const [authError, setAuthError] = useState(null);

    // Authentication UI State
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoginMode, setIsLoginMode] = useState(true);

    // Profile Management State
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [newDisplayName, setNewDisplayName] = useState('');
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState(null);

    // Ref for scrolling to the booking form
    const bookingFormRef = useRef(null);

    // --- EFFECT 1: Initialize Firebase App, Firestore, and Auth ---
    useEffect(() => {
        if (!firebaseAppInstance) {
            try {
                console.log("Initializing Firebase app...");
                if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
                    throw new Error("Firebase configuration is missing. Ensure REACT_APP_FIREBASE_PROJECT_ID and REACT_APP_FIREBASE_API_KEY are set in your environment.");
                }

                const app = initializeApp(firebaseConfig);
                const db = getFirestore(app);
                const auth = getAuth(app);

                setFirebaseAppInstance(app);
                setDbInstance(db);
                setAuthInstance(auth);
                console.log("Firebase app, DB, Auth instances set.");

                if (INITIAL_AUTH_TOKEN_FROM_CANVAS) {
                    signInWithCustomToken(auth, INITIAL_AUTH_TOKEN_FROM_CANVAS)
                        .then(() => console.log("Signed in with custom token."))
                        .catch((error) => {
                            console.error("Error signing in with custom token:", error);
                            signInAnonymously(auth).then(() => console.log("Fell back to anonymous sign-in.")).catch(console.error);
                        });
                } else {
                    signInAnonymously(auth).then(() => console.log("Signed in anonymously.")).catch(console.error);
                }

            } catch (e) {
                console.error("Firebase Initialization Error:", e);
                setError(`Firebase Initialization Error: ${e.message}`);
                setIsLoadingAuth(false);
            }
        }
    }, [firebaseAppInstance]);


    // --- EFFECT 2: Handle Firebase Authentication State & User Profile ---
    useEffect(() => {
        if (!authInstance || !dbInstance) {
            return;
        }

        console.log("Setting up auth state listener...");
        const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
            if (user) {
                setUserId(user.uid);
                setAuthError(null);
                setShowAuthModal(false);

                try {
                    setProfileLoading(true);
                    setProfileError(null);
                    const userProfileDocRef = doc(dbInstance, `artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${user.uid}/profiles/userProfile`);
                    const userProfileSnap = await getDoc(userProfileDocRef);

                    let displayNameToUse = user.displayName || user.email || 'New User';
                    if (userProfileSnap.exists()) {
                        const profileData = userProfileSnap.data();
                        displayNameToUse = profileData.displayName || displayNameToUse;
                    } else {
                        await setDoc(userProfileDocRef, {
                            userId: user.uid,
                            displayName: displayNameToUse,
                            createdAt: serverTimestamp()
                        }, { merge: true });
                        console.log("Created new user profile in Firestore.");
                    }
                    setUserName(displayNameToUse);
                    setNewDisplayName(displayNameToUse);
                    console.log("Auth state changed: User is signed in. UID:", user.uid, "Name:", displayNameToUse);

                } catch (profileFetchError) {
                    console.error("Error fetching/creating user profile:", profileFetchError);
                    setProfileError(`Failed to load profile: ${profileFetchError.message}`);
                    setUserName(user.uid);
                } finally {
                    setProfileLoading(false);
                }

            } else {
                console.log("Auth state changed: User is signed out.");
                setUserId(null);
                setUserName('');
                setNewDisplayName('');
                setAuthError(null);
                setProfileError(null);
            }
            setIsLoadingAuth(false);
        });

        return () => {
            console.log("Cleaning up auth state listener.");
            unsubscribe();
        };
    }, [authInstance, dbInstance]);

    // --- EFFECT 3: Firestore Bookings Real-time Listener (User-specific) ---
    useEffect(() => {
        if (!dbInstance || !userId || isLoadingAuth) {
            setBookings([]);
            return;
        }

        setIsLoadingBookings(true);
        setError(null);

        const collectionPath = `artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${userId}/bookings`;
        const q = query(collection(dbInstance, collectionPath));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedBookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            fetchedBookings.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
            setBookings(fetchedBookings);
            setIsLoadingBookings(false);
        }, (firestoreError) => {
            console.error("Firestore Error fetching bookings:", firestoreError);
            setError(`Failed to load your bookings: ${firestoreError.message}`);
            setIsLoadingBookings(false);
        });

        return () => unsubscribe();
    }, [dbInstance, userId, isLoadingAuth]);

    // --- EFFECT 4: Fetch Booked Slots for Selected Date from Backend ---
    useEffect(() => {
        const fetchBookedSlots = async () => {
            if (!selectedDate || !userId || !authInstance || isLoadingAuth) {
                setBookedSlotsForDate([]);
                return;
            }

            try {
                const idToken = await authInstance.currentUser.getIdToken();
                const response = await fetch(`${BACKEND_API_BASE_URL}/api/check-booked-slots?date=${selectedDate}`, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to fetch booked slots.');
                }

                const data = await response.json();
                setBookedSlotsForDate(data.bookedSlots);
            } catch (fetchError) {
                console.error("Error fetching booked slots:", fetchError);
            }
        };

        fetchBookedSlots();
    }, [selectedDate, userId, authInstance, isLoadingAuth]);

    // --- EFFECT 5: Handle Payment Confirmation Link ---
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const bookingIdFromUrl = urlParams.get('bookingId');
        const confirmPaymentFromUrl = async () => {
            if (!bookingIdFromUrl || !authInstance?.currentUser) return;
            
            history.replaceState({}, document.title, window.location.pathname);
            setPaymentConfirmMessage('Confirming payment...');
            try {
                const idToken = await authInstance.currentUser.getIdToken();
                const response = await fetch(`${BACKEND_API_BASE_URL}/api/confirm-payment`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({ bookingId: bookingIdFromUrl })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to confirm payment.');
                setPaymentConfirmMessage(data.message || 'Payment confirmed successfully!');
            } catch (err) {
                console.error("Error confirming payment from URL:", err);
                setPaymentConfirmMessage(`Error confirming payment: ${err.message}`);
            } finally {
                setTimeout(() => setPaymentConfirmMessage(null), 5000);
            }
        };

        if (bookingIdFromUrl && authInstance && !isLoadingAuth) {
            confirmPaymentFromUrl();
        }
    }, [authInstance, isLoadingAuth]);


    // Memoized values
    const today = useMemo(() => new Date().toISOString().split('T')[0], []);
    const timeSlots = useMemo(() => Array.from({ length: 8 }, (_, i) => {
        const hour = 9 + i;
        const time24 = `${hour.toString().padStart(2, '0')}:00`;
        const time12 = moment(time24, 'HH:mm').format('h:mm A');
        return { value: time24, label: time12 };
    }), []);

    const availableTimeSlotsForDisplay = useMemo(() => {
        const closingTime = moment(`${selectedDate} 18:00`, 'YYYY-MM-DD HH:mm');
        return timeSlots.map(slot => {
            const slotStartMoment = moment(`${selectedDate} ${slot.value}`, 'YYYY-MM-DD HH:mm');
            const proposedEndMoment = slotStartMoment.clone().add(duration, 'hours');
            let isDisabled = false;
            let disabledReason = '';

            if (proposedEndMoment.isAfter(closingTime)) {
                isDisabled = true;
                disabledReason = `Ends past ${closingTime.format('h:mm A')}`;
            } else if (selectedDate === today && slotStartMoment.isBefore(moment())) {
                isDisabled = true;
                disabledReason = 'Past time';
            } else if (bookedSlotsForDate.length > 0) {
                const isConflicting = bookedSlotsForDate.some(bookedSlot => {
                    if (editingBookingId && bookedSlot.id === editingBookingId) return false;
                    const bookedStartMoment = moment.tz(`${bookedSlot.date} ${bookedSlot.time}`, bookedSlot.userTimeZone || 'UTC');
                    const bookedEndMoment = bookedStartMoment.clone().add(bookedSlot.duration, 'hours');
                    return slotStartMoment.isBefore(bookedEndMoment) && proposedEndMoment.isAfter(bookedStartMoment);
                });
                if (isConflicting) {
                    isDisabled = true;
                    disabledReason = 'Booked';
                }
            }
            return { ...slot, label: slot.label + (isDisabled ? ` (${disabledReason})` : ''), disabled: isDisabled };
        });
    }, [selectedDate, bookedSlotsForDate, timeSlots, duration, editingBookingId, today]);

    const calculateTotal = useCallback(() => ROOM_RATE_PER_HOUR * duration, [duration]);
    const players = useMemo(() => DJ_EQUIPMENT.filter(eq => eq.category === 'player'), []);
    const mixers = useMemo(() => DJ_EQUIPMENT.filter(eq => eq.category === 'mixer'), []);

    const handleDateChange = useCallback((e) => {
        setSelectedDate(e.target.value);
        setSelectedTime('');
    }, []);

    const toggleEquipment = useCallback((equipment) => {
        setSelectedEquipment(prev => prev.some(item => item.id === equipment.id)
            ? prev.filter(item => item.id !== equipment.id)
            : [...prev, equipment]
        );
    }, []);

    // --- Authentication Handlers ---
    const handleAuthAction = useCallback(async (action) => {
        if (!authInstance) {
            setAuthError("Auth service not ready.");
            return;
        }
        setAuthError(null);
        try {
            const userCredential = await action();
            if (!isLoginMode) { // After sign-up
                await updateProfile(userCredential.user, { displayName: email.split('@')[0] || 'New User' });
            }
        } catch (error) {
            console.error(`${isLoginMode ? 'Sign-in' : 'Sign-up'} error:`, error);
            setAuthError(`Failed: ${error.message}`);
        }
    }, [authInstance, email, password, isLoginMode]);

    const handleGoogleSignIn = useCallback(async () => {
        if (!authInstance) return;
        setAuthError(null);
        try {
            await signInWithPopup(authInstance, new GoogleAuthProvider());
        } catch (error) {
            console.error("Google Sign-in error:", error);
            setAuthError(`Google Sign-in failed: ${error.message}`);
        }
    }, [authInstance]);

    // --- IMPROVED LOGOUT HANDLER ---
    const handleLogout = useCallback(async () => {
        if (!authInstance) return;
        try {
            await signOut(authInstance);
            // Reset all relevant application state for a clean slate
            setUserId(null);
            setUserName('');
            setNewDisplayName('');
            setBookings([]);
            setBookedSlotsForDate([]);
            setEditingBookingId(null);
            setSelectedDate('');
            setSelectedTime('');
            setDuration(2);
            setSelectedEquipment([]);
            setSelectedPaymentMethod('cash');
            setError(null);
            setAuthError(null);
            setProfileError(null);
            setCurrentBooking(null);
            setShowConfirmation(false);
            setShowDeleteConfirmation(false);
            setShowAuthModal(false);
            setShowProfileModal(false);
            console.log("User logged out and state reset.");
        } catch (error) {
            console.error("Logout error:", error);
            setError(`Logout failed: ${error.message}`);
        }
    }, [authInstance]);

    // --- Handle User Profile Update ---
    const handleUpdateProfile = useCallback(async () => {
        if (!userId || !authInstance.currentUser || !newDisplayName.trim()) return;
        setProfileLoading(true);
        setProfileError(null);
        try {
            const idToken = await authInstance.currentUser.getIdToken();
            const response = await fetch(`${BACKEND_API_BASE_URL}/api/update-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ displayName: newDisplayName.trim() })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to update profile.');
            setUserName(newDisplayName.trim());
            setShowProfileModal(false);
        } catch (error) {
            console.error("Error updating profile:", error);
            setProfileError(`Failed to update profile: ${error.message}`);
        } finally {
            setProfileLoading(false);
        }
    }, [userId, authInstance, newDisplayName]);

    // --- Handle Booking Submission (new/update) ---
    const handleBooking = useCallback(async () => {
        if (!selectedDate || !selectedTime || !userId || !authInstance.currentUser) {
            setError('Please select date, time and be logged in to book.');
            return;
        }
        setIsLoadingBookings(true);
        setError(null);
        try {
            const idToken = await authInstance.currentUser.getIdToken();
            const bookingDataToSend = {
                date: selectedDate, time: selectedTime, duration,
                equipment: selectedEquipment.map(eq => ({ id: eq.id, name: eq.name, type: eq.type })),
                total: calculateTotal(), paymentMethod: selectedPaymentMethod,
                paymentStatus: 'pending',
                userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            };
            const response = await fetch(`${BACKEND_API_BASE_URL}/api/confirm-booking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ bookingData: bookingDataToSend, userName, editingBookingId })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to confirm booking.');
            
            setCurrentBooking({ ...bookingDataToSend, id: data.bookingId, timestamp: new Date() });
            setShowConfirmation(true);
            setEditingBookingId(null);
            setSelectedDate('');
            setSelectedTime('');
            setDuration(2);
            setSelectedEquipment([]);
        } catch (bookingError) {
            console.error("Error calling backend for booking:", bookingError);
            setError(`Failed to book session: ${bookingError.message}`);
        } finally {
            setIsLoadingBookings(false);
        }
    }, [selectedDate, selectedTime, duration, selectedEquipment, calculateTotal, userId, authInstance, userName, editingBookingId, selectedPaymentMethod]);

    const handleEditBooking = useCallback((booking) => {
        setEditingBookingId(booking.id);
        setSelectedDate(booking.date);
        setSelectedTime(booking.time);
        setDuration(booking.duration);
        setSelectedEquipment(booking.equipment || []);
        setSelectedPaymentMethod(booking.paymentMethod || 'cash');
        setError(null);
        bookingFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const handleCancelBooking = useCallback((booking) => {
        setBookingToDelete(booking);
        setShowDeleteConfirmation(true);
    }, []);

    // --- UPDATED DELETE/CANCEL LOGIC ---
    const confirmDeleteBooking = useCallback(async () => {
        if (!bookingToDelete || !authInstance?.currentUser) return;
        setIsLoadingBookings(true);
        setError(null);
        try {
            const idToken = await authInstance.currentUser.getIdToken();
            // This now calls the backend to handle all deletions atomically
            const response = await fetch(`${BACKEND_API_BASE_URL}/api/cancel-booking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ bookingId: bookingToDelete.id })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to cancel booking.');
            }
            console.log("Booking cancellation processed by backend:", bookingToDelete.id);
            // The onSnapshot listener will automatically remove the booking from the UI
        } catch (deleteError) {
            console.error("Error cancelling booking:", deleteError);
            setError(`Failed to cancel booking: ${deleteError.message}`);
        } finally {
            setIsLoadingBookings(false);
            setShowDeleteConfirmation(false);
            setBookingToDelete(null);
        }
    }, [bookingToDelete, authInstance]);

    if (isLoadingAuth || !firebaseAppInstance) {
        return (
            <div className="bg-gray-900 min-h-screen flex items-center justify-center text-orange-200 text-2xl p-4 text-center">
                {error ? `Initialization Error: ${error}` : "Authenticating Firebase..."}
            </div>
        );
    }

    // Main App Render
    return (
        <div className="bg-gray-900 min-h-screen p-4 font-sans">
            <div className="max-w-4xl mx-auto">
                {/* Header Section */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-orange-400 mb-2">🎧 DJ Studio Booking</h1>
                    <p className="text-gray-300 text-lg">Book your professional DJ room with premium equipment</p>
                    <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
                        {userId ? (
                            <>
                                <p className="text-gray-400 text-sm">Logged In: <span className="font-semibold text-orange-200">{userName}</span></p>
                                <button onClick={() => setShowProfileModal(true)} className="px-4 py-2 bg-orange-600 text-white rounded-xl text-sm hover:bg-orange-700 transition shadow-lg">Edit Profile</button>
                                <button onClick={handleLogout} className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm hover:bg-red-700 transition shadow-lg">Logout</button>
                            </>
                        ) : (
                            <button onClick={() => setShowAuthModal(true)} className="px-6 py-3 bg-orange-600 text-white rounded-xl text-lg font-semibold hover:bg-orange-700 transition shadow-lg">Sign In / Sign Up</button>
                        )}
                    </div>
                </div>

                {/* General Error/Message Display */}
                {(error || profileError || paymentConfirmMessage) && (
                    <div className={`px-4 py-3 rounded-xl relative mb-4 ${paymentConfirmMessage ? (paymentConfirmMessage.includes('Error') ? 'bg-red-800' : 'bg-green-800') : 'bg-red-800'} text-white`} role="alert">
                        <strong className="font-bold">{paymentConfirmMessage ? 'Status:' : 'Error!'}</strong>
                        <span className="block sm:inline"> {error || profileError || paymentConfirmMessage}</span>
                    </div>
                )}

                {/* Main Booking Card */}
                <div ref={bookingFormRef} className="bg-gray-800 shadow-2xl rounded-2xl p-8 mb-6 border border-gray-700">
                    <div className="grid md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <h2 className="text-2xl font-semibold text-orange-300 mb-4">📅 Schedule Your Session</h2>
                            <div>
                                <label htmlFor="select-date" className="block text-sm font-medium text-gray-300 mb-2">Select Date</label>
                                <input id="select-date" type="date" min={today} value={selectedDate} onChange={handleDateChange} className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 bg-gray-700 text-white"/>
                            </div>
                            <div>
                                <label htmlFor="select-time" className="block text-sm font-medium text-gray-300 mb-2">Select Time</label>
                                <select id="select-time" value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)} className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 bg-gray-700 text-white">
                                    <option value="">Choose a time...</option>
                                    {availableTimeSlotsForDisplay.map(slot => (
                                        <option key={slot.value} value={slot.value} disabled={slot.disabled} className={slot.disabled ? 'text-gray-500' : ''}>{slot.label}</option>
                                    ))}
                                </select>
                                {selectedDate && availableTimeSlotsForDisplay.every(s => s.disabled) && <p className="text-red-300 text-sm mt-2">No available slots for this date with the selected duration.</p>}
                            </div>
                            <div>
                                <label htmlFor="select-duration" className="block text-sm font-medium text-gray-300 mb-2">Duration (hours)</label>
                                <select id="select-duration" value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 bg-gray-700 text-white">
                                    <option value={2}>2 hours</option>
                                    <option value={3}>3 hours</option>
                                    <option value={4}>4 hours</option>
                                </select>
                            </div>
                        </div>
                        <div className="bg-gray-700 rounded-xl p-6 border border-gray-600">
                            <h3 className="text-xl font-semibold text-orange-300 mb-4">💰 Booking Summary</h3>
                            <div className="space-y-3 text-gray-300">
                                <div className="flex justify-between text-sm"><span>Room Rate (per hour)</span><span>{formatIDR(ROOM_RATE_PER_HOUR)}</span></div>
                                <div className="flex justify-between text-sm"><span>Duration</span><span>{duration} hours</span></div>
                                <div className="flex justify-between text-sm"><span>Equipment</span><span className="text-green-400">Included</span></div>
                                <hr className="my-3 border-gray-600" />
                                <div className="flex justify-between font-semibold text-lg"><span>Total</span><span className="text-orange-400">{formatIDR(calculateTotal())}</span></div>
                            </div>
                            {selectedDate && selectedTime && (
                                <div className="mt-6 p-4 bg-gray-600 rounded-lg text-gray-200">
                                    <p className="font-medium">{formatDate(selectedDate)}</p>
                                    <p className="font-medium">{formatTime(selectedTime)} - {formatTime(getEndTime(selectedTime, duration))}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Equipment & Payment */}
                <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mb-6 border border-gray-700">
                    <h2 className="text-2xl font-semibold text-orange-300 mb-6">🎛️ Select Equipment & Payment</h2>
                    <div className="grid md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-gray-300 mb-2">Players</h3>
                            {players.map(eq => <EquipmentItem key={eq.id} equipment={eq} isSelected={selectedEquipment.some(i => i.id === eq.id)} onToggle={toggleEquipment} />)}
                            <h3 className="text-lg font-semibold text-gray-300 mb-2 mt-4">Mixers</h3>
                            {mixers.map(eq => <EquipmentItem key={eq.id} equipment={eq} isSelected={selectedEquipment.some(i => i.id === eq.id)} onToggle={toggleEquipment} />)}
                        </div>
                        <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-gray-300 mb-2">Payment Method</h3>
                            <PaymentOption value="online" label="Online Payment" selected={selectedPaymentMethod} onSelect={setSelectedPaymentMethod} />
                            <PaymentOption value="cash" label="Cash on Arrival" selected={selectedPaymentMethod} onSelect={setSelectedPaymentMethod} />
                        </div>
                    </div>
                </div>

                {/* Book / Update Button */}
                <div className="text-center">
                    <button onClick={handleBooking} disabled={!selectedDate || !selectedTime || isLoadingBookings || !userId || availableTimeSlotsForDisplay.find(s => s.value === selectedTime)?.disabled}
                        className="px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-200 bg-gradient-to-r from-orange-600 to-orange-800 text-white hover:from-orange-700 hover:to-orange-900 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:bg-gray-600 disabled:from-gray-600 disabled:to-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed disabled:transform-none">
                        {isLoadingBookings ? (editingBookingId ? 'Updating...' : 'Booking...') : (editingBookingId ? `📝 Update Booking - ${formatIDR(calculateTotal())}` : `🎵 Book DJ Studio - ${formatIDR(calculateTotal())}`)}
                    </button>
                    {editingBookingId && <button onClick={() => setEditingBookingId(null)} className="ml-4 px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600">Cancel Edit</button>}
                </div>

                {/* Recent Bookings Section */}
                {userId && (
                    <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mt-6 border border-gray-700">
                        <h2 className="text-2xl font-semibold text-orange-300 mb-6">📋 Your Bookings</h2>
                        {isLoadingBookings && bookings.length === 0 ? <p className="text-gray-400">Loading bookings...</p> :
                         bookings.length > 0 ? (
                            <div className="space-y-4">
                                {bookings.map(booking => (
                                    <div key={booking.id} className="bg-gray-700 rounded-lg p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center border border-gray-600">
                                        <div className="flex-grow mb-4 sm:mb-0">
                                            <p className="font-medium text-gray-100">{formatDate(booking.date)} at {formatTime(booking.time)}</p>
                                            <p className="text-xs text-gray-400 mt-1">Payment: {booking.paymentMethod} - <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${booking.paymentStatus === 'paid' ? 'bg-green-700 text-green-200' : 'bg-yellow-700 text-yellow-200'}`}>{booking.paymentStatus}</span></p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-orange-400">{formatIDR(booking.total)}</p>
                                            <button onClick={() => handleEditBooking(booking)} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">Edit</button>
                                            <button onClick={() => handleCancelBooking(booking)} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Cancel</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                         ) : <p className="text-gray-400">No bookings yet. Make one above!</p>
                        }
                    </div>
                )}

                {/* Modals */}
                <AuthModal show={showAuthModal} onClose={() => setShowAuthModal(false)} isLoginMode={isLoginMode} setIsLoginMode={setIsLoginMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} handleAuthAction={handleAuthAction} handleGoogleSignIn={handleGoogleSignIn} authError={authError} />
                <ProfileModal show={showProfileModal} onClose={() => setShowProfileModal(false)} newDisplayName={newDisplayName} setNewDisplayName={setNewDisplayName} handleUpdateProfile={handleUpdateProfile} profileLoading={profileLoading} profileError={profileError} />
                <ConfirmationModal show={showConfirmation} onClose={() => setShowConfirmation(false)} booking={currentBooking} isUpdate={!!editingBookingId} />
                <DeleteConfirmationModal show={showDeleteConfirmation} onClose={() => setShowDeleteConfirmation(false)} booking={bookingToDelete} onConfirm={confirmDeleteBooking} />
            </div>
        </div>
    );
}

// --- Sub-components for Modals and UI elements for better readability ---

const EquipmentItem = ({ equipment, isSelected, onToggle }) => (
    <div onClick={() => onToggle(equipment)} className={`p-3 rounded-xl cursor-pointer border-2 transition-all ${isSelected ? 'border-orange-500 bg-orange-900' : 'border-gray-700 bg-gray-700 hover:border-orange-400'}`}>
        <div className="flex items-center space-x-3">
            <div className="text-2xl">{equipment.icon}</div>
            <div>
                <h4 className="font-semibold text-white">{equipment.name}</h4>
                <p className="text-sm text-gray-400">{equipment.type}</p>
            </div>
            {isSelected && <div className="ml-auto w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-white">✓</div>}
        </div>
    </div>
);

const PaymentOption = ({ value, label, selected, onSelect }) => (
    <div onClick={() => onSelect(value)} className={`p-4 rounded-xl cursor-pointer border-2 transition-all ${selected === value ? 'border-orange-500 bg-orange-900' : 'border-gray-700 bg-gray-700 hover:border-orange-400'}`}>
        <label className="flex items-center space-x-3 cursor-pointer">
            <input type="radio" name="paymentMethod" value={value} checked={selected === value} onChange={() => onSelect(value)} className="form-radio h-5 w-5 text-orange-600 bg-gray-800 border-gray-600 focus:ring-orange-500" />
            <span className="font-medium text-white">{label}</span>
        </label>
    </div>
);

const Modal = ({ show, onClose, title, children }) => {
    if (!show) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-white border border-gray-700" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold text-orange-400 mb-6 text-center">{title}</h2>
                {children}
            </div>
        </div>
    );
};

const AuthModal = ({ show, onClose, isLoginMode, setIsLoginMode, email, setEmail, password, setPassword, handleAuthAction, handleGoogleSignIn, authError }) => (
    <Modal show={show} onClose={onClose} title={isLoginMode ? 'Sign In' : 'Sign Up'}>
        {authError && <div className="bg-red-800 text-white px-4 py-2 rounded-lg mb-4 text-sm">{authError}</div>}
        <div className="space-y-4">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="w-full p-3 border border-gray-600 rounded-xl bg-gray-700 text-white" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="w-full p-3 border border-gray-600 rounded-xl bg-gray-700 text-white" />
        </div>
        <div className="mt-6 space-y-3">
            <button onClick={() => handleAuthAction(isLoginMode ? () => signInWithEmailAndPassword(getAuth(), email, password) : () => createUserWithEmailAndPassword(getAuth(), email, password))} className="w-full py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700">
                {isLoginMode ? 'Sign In' : 'Sign Up'}
            </button>
            <button onClick={handleGoogleSignIn} className="w-full py-3 bg-red-700 text-white rounded-xl font-semibold hover:bg-red-800 flex items-center justify-center gap-2">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo" className="w-5 h-5" /> Sign In with Google
            </button>
            <button onClick={() => setIsLoginMode(p => !p)} className="w-full py-2 text-sm text-gray-400 hover:text-white">{isLoginMode ? 'Need an account? Sign Up' : 'Have an account? Sign In'}</button>
        </div>
    </Modal>
);

const ProfileModal = ({ show, onClose, newDisplayName, setNewDisplayName, handleUpdateProfile, profileLoading, profileError }) => (
    <Modal show={show} onClose={onClose} title="Manage Profile">
        {profileError && <div className="bg-red-800 text-white px-4 py-2 rounded-lg mb-4 text-sm">{profileError}</div>}
        <input type="text" value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="Your Display Name" className="w-full p-3 border border-gray-600 rounded-xl bg-gray-700 text-white" />
        <div className="mt-6 flex gap-4">
            <button onClick={onClose} className="w-full py-3 bg-gray-600 text-white rounded-xl font-semibold hover:bg-gray-700">Cancel</button>
            <button onClick={handleUpdateProfile} disabled={profileLoading} className="w-full py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700 disabled:bg-gray-500">{profileLoading ? 'Updating...' : 'Update'}</button>
        </div>
    </Modal>
);

const ConfirmationModal = ({ show, onClose, booking, isUpdate }) => {
    if (!booking) return null;
    return (
        <Modal show={show} onClose={onClose} title={isUpdate ? 'Booking Updated!' : 'Booking Confirmed!'}>
            <div className="text-center">
                <div className="text-6xl mb-4 pulse-animation">🎉</div>
                <div className="text-left bg-gray-700 rounded-lg p-4 mb-6 text-gray-200 space-y-1">
                    <p><strong>Date:</strong> {formatDate(booking.date)}</p>
                    <p><strong>Time:</strong> {formatTime(booking.time)}</p>
                    <p><strong>Total:</strong> {formatIDR(booking.total)}</p>
                    <p><strong>Status:</strong> <span className="font-semibold text-yellow-400">PENDING</span></p>
                </div>
                <button onClick={onClose} className="bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 w-full">Awesome!</button>
            </div>
        </Modal>
    );
};

const DeleteConfirmationModal = ({ show, onClose, booking, onConfirm }) => {
    if (!booking) return null;
    return (
        <Modal show={show} onClose={onClose} title="Confirm Cancellation">
            <p className="text-gray-300 mb-6 text-center">Are you sure you want to cancel your booking for {formatDate(booking.date)} at {formatTime(booking.time)}?</p>
            <div className="flex justify-center gap-4">
                <button onClick={onClose} className="px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600 w-full">No, Keep It</button>
                <button onClick={onConfirm} className="px-6 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 w-full">Yes, Cancel</button>
            </div>
        </Modal>
    );
};

export default BookingApp;
