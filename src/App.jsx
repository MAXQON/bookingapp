// src/App.jsx

// Import necessary React hooks
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'; // Added useRef

// Import Firebase and Firestore modules
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
         createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
         GoogleAuthProvider, signInWithPopup } from 'firebase/auth'; 
import { getFirestore, collection, query, addDoc, onSnapshot, serverTimestamp, 
         doc, deleteDoc, setDoc } from 'firebase/firestore'; // Added doc, deleteDoc, setDoc

// --- Firebase Configuration ---
const APP_ID_FOR_FIRESTORE_PATH = 'booking-app-1af02'; 
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBWmkv8YDOAtSqrehqEkO1vWNbBvmhs65A",
    authDomain: "booking-app-1af02.firebaseapp.com",
    projectId: "booking-app-1af02",
    storageBucket: "booking-app-1af02.firebasestorage.app",
    messagingSenderId: "909871533345",
    appId: "1:909871533345:web:939fa5b6c8203ad4308260", 
    measurementId: "G-NF4XH5S2QC"
};
const INITIAL_AUTH_TOKEN_FROM_CANVAS = null; 

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
    const [showPaymentSimulationModal, setShowPaymentSimulationModal] = useState(false);

    // Edit/Cancel specific state
    const [editingBookingId, setEditingBookingId] = useState(null); // ID of booking being edited
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [bookingToDelete, setBookingToDelete] = useState(null); // Store the booking object to delete

    // Firebase state
    const [userId, setUserId] = useState(null);
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

    // Ref for scrolling to the booking form
    const bookingFormRef = useRef(null);

    // --- EFFECT 1: Initialize Firebase App, Firestore, and Auth ---
    useEffect(() => {
        try {
            console.log("Initializing Firebase app...");
            const app = initializeApp(FIREBASE_CONFIG);
            const db = getFirestore(app);
            const auth = getAuth(app);
            
            setFirebaseAppInstance(app);
            setDbInstance(db);
            setAuthInstance(auth);
            console.log("Firebase app, DB, Auth instances set.");

        } catch (e) {
            console.error("Firebase Initialization Error:", e);
            setError(`Firebase Initialization Error: ${e.message}`);
            setIsLoadingAuth(false);
        }
    }, []); 

    // --- EFFECT 2: Handle Firebase Authentication State ---
    useEffect(() => {
        if (!authInstance) { 
            console.log("Auth instance not ready, skipping auth state listener.");
            return;
        }

        console.log("Setting up auth state listener...");
        const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
            if (user) {
                setUserId(user.uid);
                setAuthError(null); 
                console.log("Auth state changed: User is signed in. UID:", user.uid);
                setShowAuthModal(false); 
            } else {
                console.log("Auth state changed: User is signed out. No automatic anonymous sign-in.");
                setUserId(null); 
                setAuthError(null); 
            }
            setIsLoadingAuth(false); 
        });

        return () => {
            console.log("Cleaning up auth state listener.");
            unsubscribe();
        };
    }, [authInstance]); 

    // --- EFFECT 3: Firestore Bookings Real-time Listener ---
    useEffect(() => {
        if (!dbInstance || userId === null || isLoadingAuth || authError) { 
            console.log("Firestore listener skipped: DB instance, userId, auth loading, or auth error not ready.", { dbInstance, userId, isLoadingAuth, authError });
            setBookings([]); 
            setIsLoadingBookings(false); 
            return;
        }

        setIsLoadingBookings(true);
        setError(null);

        const collectionPath = `artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${userId}/bookings`;
        console.log("Attempting to listen to Firestore collection:", collectionPath, "with userId:", userId);

        const bookingsCollectionRef = collection(dbInstance, collectionPath);
        const q = query(bookingsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            console.log("Firestore snapshot received.");
            const fetchedBookings = [];
            snapshot.forEach((doc) => {
                fetchedBookings.push({ id: doc.id, ...doc.data() });
            });
            fetchedBookings.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
            setBookings(fetchedBookings);
            setIsLoadingBookings(false);
            console.log("Bookings updated:", fetchedBookings.length, "bookings.");
        }, (firestoreError) => {
            console.error("Firestore Error fetching bookings:", firestoreError);
            setError(`Failed to load bookings: ${firestoreError.message}`);
            setIsLoadingBookings(false);
        });

        return () => {
            console.log("Cleaning up Firestore listener.");
            unsubscribe();
        };
    }, [dbInstance, userId, isLoadingAuth, authError, APP_ID_FOR_FIRESTORE_PATH]); 

    // Memoized values
    const today = useMemo(() => new Date().toISOString().split('T')[0], []);
    const timeSlots = useMemo(() => {
        const slots = [];
        for (let hour = 9; hour <= 23; hour++) {
            const time24 = `${hour.toString().padStart(2, '0')}:00`;
            const time12 = hour > 12 ? `${hour - 12}:00 PM` : hour === 12 ? '12:00 PM' : `${hour}:00 AM`;
            slots.push({ value: time24, label: time12 });
        }
        return slots;
    }, []);
    const calculateTotal = useCallback(() => ROOM_RATE_PER_HOUR * duration, [duration]);
    const players = useMemo(() => DJ_EQUIPMENT.filter(eq => eq.category === 'player'), []);
    const mixers = useMemo(() => DJ_EQUIPMENT.filter(eq => eq.category === 'mixer'), []);

    // --- toggleEquipment function ---
    const toggleEquipment = useCallback((equipment) => {
        setSelectedEquipment(prev => {
            const isSelected = prev.some(item => item.id === equipment.id);
            if (isSelected) {
                return prev.filter(item => item.id !== equipment.id);
            } else {
                return [...prev, equipment];
            }
        });
    }, []); 

    // --- Authentication Handlers ---
    const handleSignUp = useCallback(async () => {
        if (!authInstance) {
            setAuthError("Authentication service not available.");
            return;
        }
        setAuthError(null);
        try {
            await createUserWithEmailAndPassword(authInstance, email, password);
            console.log("User signed up successfully!");
        } catch (error) {
            console.error("Sign-up error:", error);
            setAuthError(`Sign-up failed: ${error.message}`); 
        }
    }, [authInstance, email, password]);

    const handleSignIn = useCallback(async () => {
        if (!authInstance) {
            setAuthError("Authentication service not available.");
            return;
        }
        setAuthError(null);
        try {
            await signInWithEmailAndPassword(authInstance, email, password);
            console.log("User signed in successfully!");
        } catch (error) {
            console.error("Sign-in error:", error);
            setAuthError(`Sign-in failed: ${error.message}`);
        }
    }, [authInstance, email, password]);

    const handleGoogleSignIn = useCallback(async () => {
        if (!authInstance) {
            setAuthError("Authentication service not available.");
            return;
        }
        setAuthError(null);
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(authInstance, provider);
            console.log("User signed in with Google successfully!");
        } catch (error) {
            console.error("Google Sign-in error:", error);
            if (error.code === 'auth/popup-closed-by-user') {
                setAuthError("Google Sign-in popup closed. Please try again.");
            } else if (error.code === 'auth/cancelled-popup-request') {
                setAuthError("Another sign-in attempt was already in progress. Please try again.");
            } else {
                setAuthError(`Google Sign-in failed: ${error.message}`);
            }
        }
    }, [authInstance]);

    const handleLogout = useCallback(async () => {
        if (!authInstance) return;
        try {
            await signOut(authInstance);
            setUserId(null); 
            setBookings([]); 
            console.log("User logged out.");
            // Also reset edit mode when logging out
            setEditingBookingId(null);
            setSelectedDate('');
            setSelectedTime('');
            setDuration(2);
            setSelectedEquipment([]);
            setSelectedPaymentMethod('cash');

        } catch (error) {
            console.error("Logout error:", error);
            setError(`Logout failed: ${error.message}`);
        }
    }, [authInstance]);

    // --- Handle Booking Submission (new/update) ---
    const handleBooking = useCallback(() => {
        if (!selectedDate || !selectedTime) {
            alert('Please select both date and time to proceed with booking.');
            return;
        }
        if (!userId || !dbInstance || authError) { 
            setError("App not ready to book. Please wait for authentication or resolve prior errors.");
            console.error("Booking attempted when userId, dbInstance, or authError not ready.", { userId, dbInstance, authError });
            return;
        }

        if (selectedPaymentMethod === 'online') {
            setShowPaymentSimulationModal(true);
        } else {
            // For cash, default payment status to 'pending'
            confirmBooking('pending'); 
        }
    }, [selectedDate, selectedTime, duration, selectedEquipment, calculateTotal, userId, dbInstance, authError, selectedPaymentMethod]);


    // --- Function to actually confirm and save/update the booking to Firestore ---
    const confirmBooking = useCallback(async (paymentStatus) => {
        try {
            setError(null);
            setIsLoadingBookings(true);
            const totalCost = calculateTotal();
            
            const newBookingData = {
                date: selectedDate,
                time: selectedTime,
                duration: duration,
                equipment: selectedEquipment.map(eq => ({ id: eq.id, name: eq.name, type: eq.type })),
                total: totalCost,
                userId: userId, 
                timestamp: serverTimestamp(),
                paymentMethod: selectedPaymentMethod, 
                paymentStatus: paymentStatus 
            };

            const bookingsCollectionRef = collection(dbInstance, `artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${userId}/bookings`);

            if (editingBookingId) {
                // Update existing document
                const bookingDocRef = doc(bookingsCollectionRef, editingBookingId);
                await setDoc(bookingDocRef, newBookingData, { merge: true }); // Use setDoc with merge to update fields
                console.log("Booking successfully UPDATED with ID:", editingBookingId);
                setCurrentBooking({ ...newBookingData, id: editingBookingId, timestamp: new Date() });
                setShowConfirmation(true);
            } else {
                // Add new document
                const docRef = await addDoc(bookingsCollectionRef, newBookingData);
                console.log("Booking successfully ADDED with ID:", docRef.id);
                setCurrentBooking({ ...newBookingData, id: docRef.id, timestamp: new Date() });
                setShowConfirmation(true);
            }
            
            // Reset form fields and edit mode after successful operation
            setEditingBookingId(null);
            setSelectedDate('');
            setSelectedTime('');
            setDuration(2);
            setSelectedEquipment([]);
            setSelectedPaymentMethod('cash'); 

        } catch (bookingError) {
            console.error(`Error ${editingBookingId ? 'updating' : 'adding'} booking to Firestore:`, bookingError);
            setError(`Failed to ${editingBookingId ? 'update' : 'book'} session: ${bookingError.message}`);
        } finally {
            setIsLoadingBookings(false);
            setShowPaymentSimulationModal(false); 
        }
    }, [selectedDate, selectedTime, duration, selectedEquipment, calculateTotal, userId, dbInstance, selectedPaymentMethod, APP_ID_FOR_FIRESTORE_PATH, editingBookingId]);

    // --- Handle Edit Button Click ---
    const handleEditBooking = useCallback((booking) => {
        setEditingBookingId(booking.id);
        setSelectedDate(booking.date);
        setSelectedTime(booking.time);
        setDuration(booking.duration);
        setSelectedEquipment(booking.equipment || []); // Ensure equipment is an array
        setSelectedPaymentMethod(booking.paymentMethod || 'cash');
        setError(null); // Clear any previous errors

        // Scroll to the top of the form
        if (bookingFormRef.current) {
            bookingFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    // --- Handle Cancel Button Click ---
    const handleCancelBooking = useCallback((booking) => {
        setBookingToDelete(booking);
        setShowDeleteConfirmation(true);
    }, []);

    // --- Confirm Delete Action ---
    const confirmDeleteBooking = useCallback(async () => {
        if (!bookingToDelete || !dbInstance || !userId) return;

        try {
            setError(null);
            setIsLoadingBookings(true);
            const bookingDocRef = doc(collection(dbInstance, `artifacts/${APP_ID_FOR_FIRESTORE_PATH}/users/${userId}/bookings`), bookingToDelete.id);
            await deleteDoc(bookingDocRef);
            console.log("Booking successfully deleted:", bookingToDelete.id);
            // onSnapshot listener will automatically update the state, no need to manually filter
        } catch (deleteError) {
            console.error("Error deleting booking:", deleteError);
            setError(`Failed to delete booking: ${deleteError.message}`);
        } finally {
            setIsLoadingBookings(false);
            setShowDeleteConfirmation(false);
            setBookingToDelete(null);
        }
    }, [bookingToDelete, dbInstance, userId, APP_ID_FOR_FIRESTORE_PATH]);


    // Display loading state for authentication or if Firebase is not initialized, or if auth failed
    if (isLoadingAuth || !firebaseAppInstance || authError) { 
        return (
            <div className="bg-gray-900 min-h-screen flex items-center justify-center text-orange-200 text-2xl p-4 text-center">
                {authError ? `Authentication Error: ${authError}` : "Authenticating Firebase..."}
                <br/>
                {error && <span className="text-red-300 text-base">{error}</span>} 
            </div>
        );
    }

    // Main App Render
    return (
        <div className="bg-gray-900 min-h-screen p-4"> {/* Dark background */}
            <div className="max-w-4xl mx-auto">
                {/* Header Section */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-orange-400 mb-2"> {/* Orange accent */}
                        🎧 DJ Studio Booking
                    </h1>
                    <p className="text-gray-300 text-lg"> {/* Lighter text for dark mode */}
                        Book your professional DJ room with premium equipment
                    </p>
                    <div className="mt-4 flex justify-center gap-4">
                        {userId ? (
                            <>
                                <p className="text-gray-400 text-sm">
                                    Logged In: <span className="font-mono bg-gray-700 p-1 rounded-md text-xs text-orange-200">{userId.substring(0, 8)}...</span> {/* Orange accent for ID */}
                                </p>
                                <button
                                    onClick={handleLogout}
                                    className="px-4 py-2 bg-orange-600 text-white rounded-xl text-sm hover:bg-orange-700 transition duration-200 shadow-lg"
                                >
                                    Logout
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => setShowAuthModal(true)}
                                className="px-6 py-3 bg-orange-600 text-white rounded-xl text-lg font-semibold hover:bg-orange-700 transition duration-200 shadow-lg"
                            >
                                Sign In / Sign Up
                            </button>
                        )}
                    </div>
                </div>

                {/* General Error Display */}
                {error && !authError && ( 
                    <div className="bg-red-800 text-white px-4 py-3 rounded-xl relative mb-4" role="alert"> {/* Darker error for dark mode */}
                        <strong className="font-bold">Error!</strong>
                        <span className="block sm:inline"> {error}</span>
                    </div>
                )}

                {/* Main Booking Card: Date, Time & Summary */}
                <div ref={bookingFormRef} className="bg-gray-800 shadow-2xl rounded-2xl p-8 mb-6 border border-gray-700"> {/* Dark card background */}
                    <div className="grid md:grid-cols-2 gap-8">
                        {/* Date & Time Selection Inputs */}
                        <div className="space-y-6">
                            <h2 className="text-2xl font-semibold text-orange-300 mb-4"> {/* Orange accent */}
                                📅 Schedule Your Session
                            </h2>
                            
                            <div>
                                <label htmlFor="select-date" className="block text-sm font-medium text-gray-300 mb-2">
                                    Select Date
                                </label>
                                <input
                                    id="select-date"
                                    type="date"
                                    min={today}
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent transition duration-200 bg-gray-700 text-white"
                                />
                            </div>

                            <div>
                                <label htmlFor="select-time" className="block text-sm font-medium text-gray-300 mb-2">
                                    Select Time
                                </label>
                                <select
                                    id="select-time"
                                    value={selectedTime}
                                    onChange={(e) => setSelectedTime(e.target.value)}
                                    className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent transition duration-200 bg-gray-700 text-white"
                                >
                                    <option value="">Choose a time...</option>
                                    {timeSlots.map(slot => (
                                        <option key={slot.value} value={slot.value}>
                                            {slot.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label htmlFor="select-duration" className="block text-sm font-medium text-gray-300 mb-2">
                                    Duration (hours)
                                </label>
                                <select
                                    id="select-duration"
                                    value={duration}
                                    onChange={(e) => setDuration(parseInt(e.target.value))}
                                    className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent transition duration-200 bg-gray-700 text-white"
                                >
                                    <option value={1}>1 hour</option>
                                    <option value={2}>2 hours (Default)</option>
                                    <option value={3}>3 hours</option>
                                    <option value={4}>4 hours</option>
                                    <option value={6}>6 hours</option>
                                    <option value={8}>8 hours</option>
                                </select>
                            </div>
                        </div>

                        {/* Booking Summary Display */}
                        <div className="bg-gray-700 rounded-xl p-6 border border-gray-600"> {/* Dark summary background */}
                            <h3 className="text-xl font-semibold text-orange-300 mb-4"> {/* Orange accent */}
                                💰 Booking Summary
                            </h3>
                            
                            <div className="space-y-3 text-gray-300"> {/* Lighter text */}
                                <div className="flex justify-between text-sm">
                                    <span>Room Rate (per hour)</span>
                                    <span>{formatIDR(ROOM_RATE_PER_HOUR)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span>Duration</span>
                                    <span>{duration} hours</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span>Equipment</span>
                                    <span className="text-green-400">Included</span> {/* Green for 'Included' */}
                                </div>
                                <hr className="my-3 border-gray-600" /> {/* Darker divider */}
                                <div className="flex justify-between font-semibold text-lg">
                                    <span>Total</span>
                                    <span className="text-orange-400">{formatIDR(calculateTotal())}</span> {/* Orange for total */}
                                </div>
                            </div>

                            {selectedDate && selectedTime && (
                                <div className="mt-6 p-4 bg-gray-600 rounded-lg text-gray-200"> {/* Darker details background */}
                                    <p className="text-sm text-gray-300">Session Details:</p>
                                    <p className="font-medium">{formatDate(selectedDate)}</p>
                                    <p className="font-medium">
                                        {formatTime(selectedTime)} - {formatTime(getEndTime(selectedTime, duration))}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Equipment Selection Section */}
                <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mb-6 border border-gray-700"> {/* Dark card background */}
                    <h2 className="text-2xl font-semibold text-orange-300 mb-6"> {/* Orange accent */}
                        🎛️ Select Your Preferred Equipment
                    </h2>
                    <p className="text-gray-300 mb-6">All equipment is included in the room price. Please select what you'd like to use:</p>
                    
                    <div className="grid sm:grid-cols-2 gap-6">
                        {/* Players Equipment List */}
                        <div>
                            <h3 className="text-lg font-semibold text-gray-300 mb-4">Players</h3>
                            <div className="space-y-3">
                                {players.map(equipment => {
                                    const isSelected = selectedEquipment.some(item => item.id === equipment.id);
                                    return (
                                        <div
                                            key={equipment.id}
                                            onClick={() => toggleEquipment(equipment)}
                                            className={`p-4 rounded-xl cursor-pointer border-2 transition-all duration-200 hover:translate-y-[-2px] ${
                                                isSelected 
                                                    ? 'border-orange-500 bg-orange-900 shadow-md text-white' // Orange selected
                                                    : 'border-gray-700 bg-gray-700 hover:border-orange-500 hover:shadow-sm text-gray-200' // Dark unselected
                                            }`}
                                        >
                                            <div className="flex items-center space-x-3">
                                                <div className="text-2xl">{equipment.icon}</div>
                                                <div>
                                                    <h4 className="font-semibold">{equipment.name}</h4>
                                                    <p className="text-sm text-gray-400">{equipment.type}</p>
                                                </div>
                                                {isSelected && (
                                                    <div className="ml-auto">
                                                        <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center">
                                                            <span className="text-white text-sm">✓</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Mixers Equipment List */}
                        <div>
                            <h3 className="text-lg font-semibold text-gray-300 mb-4">Mixers</h3>
                            <div className="space-y-3">
                                {mixers.map(equipment => {
                                    const isSelected = selectedEquipment.some(item => item.id === equipment.id);
                                    return (
                                        <div
                                            key={equipment.id}
                                            onClick={() => toggleEquipment(equipment)}
                                            className={`p-4 rounded-xl cursor-pointer border-2 transition-all duration-200 hover:translate-y-[-2px] ${
                                                isSelected 
                                                    ? 'border-orange-500 bg-orange-900 shadow-md text-white' 
                                                    : 'border-gray-700 bg-gray-700 hover:border-orange-500 hover:shadow-sm text-gray-200'
                                            }`}
                                        >
                                            <div className="flex items-center space-x-3">
                                                <div className="text-2xl">{equipment.icon}</div>
                                                <div>
                                                    <h4 className="font-semibold">{equipment.name}</h4>
                                                    <p className="text-sm text-gray-400">{equipment.type}</p>
                                                </div>
                                                {isSelected && (
                                                    <div className="ml-auto">
                                                        <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center">
                                                            <span className="text-white text-sm">✓</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {selectedEquipment.length > 0 && (
                        <div className="mt-6 p-4 bg-green-900 rounded-lg text-green-300 border border-green-700"> {/* Dark green for selected equipment */}
                            <h4 className="font-semibold mb-2">Selected Equipment:</h4>
                            <div className="flex flex-wrap gap-2">
                                {selectedEquipment.map(eq => (
                                    <span key={eq.id} className="bg-green-700 text-green-100 px-3 py-1 rounded-full text-sm">
                                        {eq.icon} {eq.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Payment Method Selection */}
                <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mb-6 border border-gray-700"> {/* Dark card background */}
                    <h2 className="text-2xl font-semibold text-orange-300 mb-6"> {/* Orange accent */}
                        💳 Select Payment Method
                    </h2>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <label className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 w-full ${selectedPaymentMethod === 'online' ? 'border-orange-500 bg-orange-900 text-white shadow-md' : 'border-gray-700 bg-gray-700 hover:border-orange-500 text-gray-200'}`}>
                            <input
                                type="radio"
                                name="paymentMethod"
                                value="online"
                                checked={selectedPaymentMethod === 'online'}
                                onChange={() => setSelectedPaymentMethod('online')}
                                className="form-radio h-5 w-5 text-orange-600"
                            />
                            <span className="ml-3 text-lg font-medium">Online Payment</span>
                        </label>
                        <label className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 w-full ${selectedPaymentMethod === 'cash' ? 'border-orange-500 bg-orange-900 text-white shadow-md' : 'border-gray-700 bg-gray-700 hover:border-orange-500 text-gray-200'}`}>
                            <input
                                type="radio"
                                name="paymentMethod"
                                value="cash"
                                checked={selectedPaymentMethod === 'cash'}
                                onChange={() => setSelectedPaymentMethod('cash')}
                                className="form-radio h-5 w-5 text-orange-600"
                            />
                            <span className="ml-3 text-lg font-medium">Cash on Arrival</span>
                        </label>
                    </div>
                </div>

                {/* Book / Update Button */}
                <div className="text-center">
                    <button
                        onClick={handleBooking}
                        disabled={!selectedDate || !selectedTime || isLoadingBookings || !userId} 
                        className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-200 ${
                            selectedDate && selectedTime && !isLoadingBookings && userId
                                ? 'bg-gradient-to-r from-orange-600 to-orange-800 text-white hover:from-orange-700 hover:to-orange-900 shadow-lg hover:shadow-xl transform hover:scale-105'
                                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                        {isLoadingBookings 
                            ? (editingBookingId ? 'Updating...' : 'Booking...') 
                            : (editingBookingId ? `📝 Update Booking - ${formatIDR(calculateTotal())}` : `🎵 Book DJ Studio - ${formatIDR(calculateTotal())}`)}
                    </button>
                    {editingBookingId && (
                        <button
                            onClick={() => {
                                setEditingBookingId(null);
                                setSelectedDate('');
                                setSelectedTime('');
                                setDuration(2);
                                setSelectedEquipment([]);
                                setSelectedPaymentMethod('cash');
                                setError(null);
                            }}
                            className="ml-4 px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600 transition duration-200"
                        >
                            Cancel Edit
                        </button>
                    )}
                </div>

                {/* Recent Bookings Section */}
                {userId && (isLoadingBookings && bookings.length === 0 && !error) ? ( // Add !error to condition
                    <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mt-6 text-center text-gray-400 border border-gray-700">
                        Loading bookings...
                    </div>
                ) : (userId && bookings.length > 0) && (
                    <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mt-6 border border-gray-700">
                        <h2 className="text-2xl font-semibold text-orange-300 mb-6">
                            📋 Recent Bookings
                        </h2>
                        <div className="space-y-4">
                            {bookings.map(booking => ( // Changed slice to map all bookings
                                <div key={booking.id} className="bg-gray-700 rounded-lg p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center border border-gray-600">
                                    <div className="flex-grow mb-4 sm:mb-0">
                                        <p className="font-medium text-gray-100">Booking ID: <span className="font-mono text-xs text-gray-400">{booking.id}</span></p>
                                        <p className="text-sm text-gray-300">
                                            {formatDate(booking.date)} at {formatTime(booking.time)} ({booking.duration} hours)
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            Equipment: {booking.equipment && booking.equipment.length > 0 ? booking.equipment.map(e => e.name).join(', ') : 'None selected'}
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Payment: {booking.paymentMethod === 'online' ? 'Online' : 'Cash'} 
                                            <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                booking.paymentStatus === 'paid' ? 'bg-green-700 text-green-200' : 'bg-yellow-700 text-yellow-200'
                                            }`}>
                                                {booking.paymentStatus === 'paid' ? 'PAID' : 'PENDING'}
                                            </span>
                                        </p>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        {/* Only show edit/cancel if current user is the booking owner */}
                                        {userId === booking.userId && (
                                            <>
                                                <button
                                                    onClick={() => handleEditBooking(booking)}
                                                    className="px-4 py-2 bg-orange-500 text-white rounded-xl text-sm hover:bg-orange-600 transition duration-200"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleCancelBooking(booking)}
                                                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm hover:bg-red-700 transition duration-200"
                                                >
                                                    Cancel
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {/* Message if no bookings and user is logged in */}
                {userId && !isLoadingBookings && bookings.length === 0 && !error && (
                    <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mt-6 text-center text-gray-400 border border-gray-700">
                        No recent bookings found. Make your first booking above!
                    </div>
                )}
                {/* Message if user is not logged in */}
                {!userId && (
                    <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mt-6 text-center text-gray-400 border border-gray-700">
                        Sign in to view and make bookings.
                    </div>
                )}


                {/* Confirmation Modal */}
                {showConfirmation && currentBooking && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50"> {/* Darker overlay */}
                        <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-white border border-gray-700"> {/* Dark modal */}
                            <div className="text-center">
                                <div className="text-6xl mb-4 pulse-animation">🎉</div>
                                <h2 className="text-2xl font-bold text-orange-400 mb-4">
                                    {editingBookingId ? 'Booking Updated!' : 'Booking Confirmed!'}
                                </h2>
                                <div className="text-left bg-gray-700 rounded-lg p-4 mb-6 text-gray-200"> {/* Dark details background */}
                                    <p><strong>Date:</strong> {formatDate(currentBooking.date)}</p>
                                    <p><strong>Time:</strong> {formatTime(currentBooking.time)}</p>
                                    <p><strong>Duration:</strong> {currentBooking.duration} hours</p>
                                    <p><strong>Equipment:</strong> {currentBooking.equipment && currentBooking.equipment.length > 0 ? currentBooking.equipment.map(e => e.name).join(', ') : 'None selected'}</p>
                                    <p><strong>Total:</strong> {formatIDR(currentBooking.total)}</p>
                                    <p><strong>Booking ID:</strong> <span className="font-mono text-xs text-gray-400">#{currentBooking.id}</span></p>
                                    <p className="mt-2"><strong>Payment Method:</strong> {currentBooking.paymentMethod === 'online' ? 'Online' : 'Cash on Arrival'}</p>
                                    <p><strong>Payment Status:</strong> 
                                        <span className={`ml-1 font-semibold ${currentBooking.paymentStatus === 'paid' ? 'text-green-400' : 'text-yellow-400'}`}>
                                            {currentBooking.paymentStatus === 'paid' ? 'PAID' : 'PENDING'}
                                        </span>
                                    </p>
                                </div>
                                <button
                                    onClick={() => setShowConfirmation(false)}
                                    className="bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition duration-200"
                                >
                                    Awesome! Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Auth Modal */}
                {showAuthModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50"> {/* Darker overlay */}
                        <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-white border border-gray-700"> {/* Dark modal */}
                            <h2 className="text-2xl font-bold text-orange-400 mb-6 text-center"> {/* Orange accent */}
                                {isLoginMode ? 'Sign In' : 'Sign Up'}
                            </h2>
                            {authError && (
                                <div className="bg-red-800 text-white px-4 py-3 rounded-xl relative mb-4 text-sm" role="alert">
                                    {authError}
                                </div>
                            )}
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                                    <input
                                        type="email"
                                        id="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent transition duration-200 bg-gray-700 text-white"
                                        placeholder="your.email@example.com"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                                    <input
                                        type="password"
                                        id="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full p-3 border border-gray-600 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent transition duration-200 bg-gray-700 text-white"
                                        placeholder="********"
                                    />
                                </div>
                            </div>
                            <div className="mt-6 space-y-4">
                                <button
                                    onClick={isLoginMode ? handleSignIn : handleSignUp}
                                    className="w-full px-6 py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700 transition duration-200"
                                >
                                    {isLoginMode ? 'Sign In' : 'Sign Up'}
                                </button>
                                <button
                                    onClick={() => setIsLoginMode(prev => !prev)}
                                    className="w-full px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600 transition duration-200"
                                >
                                    {isLoginMode ? 'Need an account? Sign Up' : 'Already have an account? Sign In'}
                                </button>
                                {/* Google Sign-In Button */}
                                <button
                                    onClick={handleGoogleSignIn}
                                    className="w-full px-6 py-3 bg-red-700 text-white rounded-xl font-semibold hover:bg-red-800 transition duration-200 flex items-center justify-center"
                                >
                                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo" className="w-5 h-5 mr-2" />
                                    Sign In with Google
                                </button>
                                <button
                                    onClick={() => { setShowAuthModal(false); setAuthError(null); setEmail(''); setPassword(''); }}
                                    className="w-full text-sm text-gray-400 hover:text-gray-200 transition duration-200 mt-2"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Payment Simulation Modal */}
                {showPaymentSimulationModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50"> {/* Darker overlay */}
                        <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-white text-center border border-gray-700"> {/* Dark modal */}
                            <h2 className="text-2xl font-bold text-orange-400 mb-4">
                                Simulate Online Payment
                            </h2>
                            <p className="text-gray-300 mb-6">
                                Please confirm payment of **{formatIDR(calculateTotal())}** for your booking on {formatDate(selectedDate)} at {formatTime(selectedTime)}.
                            </p>
                            <div className="flex justify-center gap-4">
                                <button
                                    onClick={() => confirmBooking('paid')}
                                    className="px-6 py-3 bg-green-700 text-white rounded-xl font-semibold hover:bg-green-800 transition duration-200"
                                >
                                    Confirm Payment (Simulated)
                                </button>
                                <button
                                    onClick={() => { setShowPaymentSimulationModal(false); setError("Payment cancelled by user."); }}
                                    className="px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600 transition duration-200"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Delete Confirmation Modal */}
                {showDeleteConfirmation && bookingToDelete && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50"> {/* Darker overlay */}
                        <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-white text-center border border-gray-700"> {/* Dark modal */}
                            <h2 className="text-2xl font-bold text-red-400 mb-4">
                                Confirm Deletion
                            </h2>
                            <p className="text-gray-300 mb-6">
                                Are you sure you want to cancel the booking for **{formatDate(bookingToDelete.date)} at {formatTime(bookingToDelete.time)}** (Booking ID: <span className="font-mono text-xs text-gray-400">{bookingToDelete.id.substring(0,8)}...</span>)? This action cannot be undone.
                            </p>
                            <div className="flex justify-center gap-4">
                                <button
                                    onClick={confirmDeleteBooking}
                                    className="px-6 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition duration-200"
                                >
                                    Yes, Cancel Booking
                                </button>
                                <button
                                    onClick={() => { setShowDeleteConfirmation(false); setBookingToDelete(null); setError(null); }}
                                    className="px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600 transition duration-200"
                                >
                                    No, Keep Booking
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default BookingApp;
