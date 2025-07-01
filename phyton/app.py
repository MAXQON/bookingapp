# phyton/app.py

import os
import firebase_admin
from firebase_admin import credentials, auth, firestore
from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import requests
import google.auth
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import datetime
import pytz
import base64
from google.auth.transport.requests import Request as GoogleAuthRequest # Explicitly import Request and alias it

# Initialize Flask App
app = Flask(__name__)

# Configure CORS - Allow all origins for development, specify origins for production
CORS(app, resources={r"/api/*": {"origins": [
    "http://localhost:5173", # Your local frontend dev server
    "https://maxqon.github.io", # Root GitHub Pages domain
    "https://maxqon.github.io/bookingapp", # Specific GitHub Pages path
    os.environ.get('RENDER_EXTERNAL_URL') # Render's own URL for the backend
]}})

# --- Firebase Admin SDK Initialization ---
firebase_service_account_key_base64 = os.environ.get('FIREBASE_SERVICE_ACCOUNT_KEY_BASE64')
# Get Firebase Project ID for audience verification in ID token and Firestore paths
FIREBASE_PROJECT_ID = os.environ.get('FIREBASE_PROJECT_ID', 'booking-app-1af02') # Default if not set

if firebase_service_account_key_base64:
    try:
        service_account_info_str = base64.b64decode(firebase_service_account_key_base64).decode('utf-8')
        service_account_info = json.loads(service_account_info_str)
        
        print("Service account JSON decoded and parsed successfully from FIREBASE_SERVICE_ACCOUNT_KEY_BASE64.")
        print("Debug: Firebase Admin SDK Service Account Details:")
        print(f"  Project ID: {service_account_info.get('project_id', 'N/A')}")
        print(f"  Client Email: {service_account_info.get('client_email', 'N/A')}")
        
        cred = credentials.Certificate(service_account_info)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("Firebase Admin SDK initialized successfully.")
    except Exception as e:
        print(f"Error initializing Firebase Admin SDK: {e}")
        db = None
else:
    print("FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 environment variable not set.")
    print("Firebase Admin SDK will not be initialized. Firestore operations will fail.")
    db = None

# --- Google Calendar API Initialization ---
GOOGLE_CALENDAR_CLIENT_ID = os.environ.get('GOOGLE_CALENDAR_CLIENT_ID')
GOOGLE_CALENDAR_CLIENT_SECRET = os.environ.get('GOOGLE_CALENDAR_CLIENT_SECRET')
GOOGLE_CALENDAR_REFRESH_TOKEN = os.environ.get('GOOGLE_CALENDAR_REFRESH_TOKEN')
GOOGLE_CALENDAR_CALENDAR_ID = os.environ.get('GOOGLE_CALENDAR_CALENDAR_ID')

# Initialize creds and calendar_service globally, but we'll refresh creds per request
calendar_creds = None
calendar_service = None

# Print the values of Google Calendar env vars for debugging
print("\n--- Google Calendar Environment Variables Check ---")
print(f"GOOGLE_CALENDAR_CLIENT_ID: {'SET' if GOOGLE_CALENDAR_CLIENT_ID else 'NOT SET'}")
print(f"GOOGLE_CALENDAR_CLIENT_SECRET: {'SET' if GOOGLE_CALENDAR_CLIENT_SECRET else 'NOT SET'}")
print(f"GOOGLE_CALENDAR_REFRESH_TOKEN: {'SET' if GOOGLE_CALENDAR_REFRESH_TOKEN else 'NOT SET'}")
print(f"GOOGLE_CALENDAR_CALENDAR_ID: {'SET' if GOOGLE_CALENDAR_CALENDAR_ID else 'NOT SET'}")
print("--------------------------------------------------\n")


if GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET and GOOGLE_CALENDAR_REFRESH_TOKEN:
    try:
        calendar_creds = Credentials(
            token=None,
            refresh_token=GOOGLE_CALENDAR_REFRESH_TOKEN,
            token_uri='https://oauth2.googleapis.com/token',
            client_id=GOOGLE_CALENDAR_CLIENT_ID,
            client_secret=GOOGLE_CALENDAR_CLIENT_SECRET,
            scopes=['https://www.googleapis.com/auth/calendar.events']
        )
        # Attempt initial refresh at startup
        calendar_creds.refresh(GoogleAuthRequest())
        calendar_service = build('calendar', 'v3', credentials=calendar_creds)
        print("Google Calendar API service initialized successfully.")
    except Exception as e:
        print(f"Error initializing Google Calendar API service: {e}")
else:
    print("Google Calendar API environment variables (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN) not fully set.")
    print("Google Calendar API functionality will be disabled.")

# --- Middleware to verify Firebase ID Token ---
@app.before_request
def verify_firebase_token():
    if request.method == 'OPTIONS':
        return

    unprotected_paths = ['/']
    if request.path in unprotected_paths:
        request.uid = None
        return

    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"error": "Unauthorized", "message": "Bearer token missing or invalid."}), 401

    id_token = auth_header.split(' ')[1]
    
    try:
        # Verify the ID token using the Firebase project ID as audience
        decoded_token = auth.verify_id_token(id_token, audience=FIREBASE_PROJECT_ID)
        request.uid = decoded_token['uid']
        request.user_email = decoded_token.get('email')
        # Prioritize 'name' from token, then 'email', then default to UID
        request.user_display_name = decoded_token.get('name', decoded_token.get('email', request.uid))
        print(f"Firebase ID token verified for UID: {request.uid}, Display Name: {request.user_display_name}")
    except Exception as e:
        print(f"Error verifying Firebase ID token: {e}")
        return jsonify({"error": "Unauthorized", "message": str(e)}), 401

# --- Routes ---
@app.route('/')
def home():
    return "Python Backend for DJ Room Booking App is running!"

@app.route('/api/update-profile', methods=['POST'], endpoint='update_profile')
def update_profile():
    if not hasattr(request, 'uid') or not request.uid:
        return jsonify({"error": "Unauthorized", "message": "User not authenticated."}), 401
    
    if not db:
        return jsonify({"error": "Server Error", "message": "Firestore not initialized."}), 500

    data = request.get_json()
    new_display_name = data.get('displayName')

    if not new_display_name:
        return jsonify({"error": "Bad Request", "message": "Display name is required."}), 400

    try:
        # Update Firebase Auth profile
        auth.update_user(request.uid, display_name=new_display_name)
        print(f"Firebase Auth display name updated for {request.uid} to {new_display_name}")

        # Update Firestore userProfile document
        user_profile_ref = db.collection('artifacts').document(
            FIREBASE_PROJECT_ID
        ).collection('users').document(request.uid).collection('profiles').document('userProfile')

        user_profile_ref.set({
            'displayName': new_display_name,
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'userId': request.uid # Ensure userId is also stored
        }, merge=True)
        print(f"Firestore user profile updated for {request.uid}")

        return jsonify({"message": "Profile updated successfully.", "displayName": new_display_name}), 200
    except Exception as e:
        print(f"Error updating profile: {e}")
        return jsonify({"error": "Internal Server Error", "message": str(e)}), 500

@app.route('/api/confirm-booking', methods=['POST'], endpoint='confirm_booking')
def confirm_booking():
    if not hasattr(request, 'uid') or not request.uid:
        return jsonify({"error": "Unauthorized", "message": "User not authenticated."}), 401
    
    if not db:
        return jsonify({"error": "Server Error", "message": "Firestore not initialized."}), 500

    # Wrap the entire function logic in a try-except block
    try: 
        data = request.get_json()
        booking_data = data.get('bookingData')
        # Use the user_display_name from the verified token, or fallback to 'Anonymous User'
        user_name_from_token = request.user_display_name 
        editing_booking_id = data.get('editingBookingId')

        if not booking_data:
            return jsonify({"error": "Bad Request", "message": "Booking data is required."}), 400

        # Extract necessary booking details for conflict check and calendar
        selected_date_str = booking_data['date']
        selected_time_str = booking_data['time']
        duration_hours = booking_data['duration']
        user_timezone_str = booking_data.get('userTimeZone', 'Asia/Jakarta') # Default to Asia/Jakarta

        try:
            user_timezone = pytz.timezone(user_timezone_str)
            naive_start_dt = datetime.datetime.strptime(f"{selected_date_str} {selected_time_str}", '%Y-%m-%d %H:%M')
            booking_start_dt_local = user_timezone.localize(naive_start_dt)
            booking_end_dt_local = booking_start_dt_local + datetime.timedelta(hours=duration_hours)
        except pytz.exceptions.UnknownTimeZoneError:
            print(f"Unknown timezone from frontend: {user_timezone_str}. Defaulting to Asia/Jakarta.")
            user_timezone = pytz.timezone('Asia/Jakarta')
            naive_start_dt = datetime.datetime.strptime(f"{selected_date_str} {selected_time_str}", '%Y-%m-%d %H:%M')
            booking_start_dt_local = user_timezone.localize(naive_start_dt)
            booking_end_dt_local = booking_start_dt_local + datetime.timedelta(hours=duration_hours)
        except Exception as e:
            print(f"Error parsing date/time for conflict check: {e}")
            return jsonify({"error": "Invalid date or time format."}), 400

        # --- Conflict Check (using the public collection for all bookings) ---
        public_bookings_collection_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
        
        # Query for bookings on the same date
        date_query = public_bookings_collection_ref.where('date', '==', selected_date_str).stream()
        
        conflicting_slots = []
        for doc_snap in date_query:
            existing_booking = doc_snap.to_dict()
            existing_booking_id = doc_snap.id

            # If editing, skip the current booking from conflict check
            if editing_booking_id and existing_booking_id == editing_booking_id:
                continue

            existing_user_timezone = existing_booking.get('userTimeZone', 'Asia/Jakarta')
            try:
                existing_local_tz = pytz.timezone(existing_user_timezone)
                naive_existing_start_dt = datetime.datetime.strptime(f"{existing_booking['date']} {existing_booking['time']}", '%Y-%m-%d %H:%M')
                existing_start_dt_local = existing_local_tz.localize(naive_existing_start_dt)
                existing_end_dt_local = existing_start_dt_local + datetime.timedelta(hours=existing_booking['duration'])
            except Exception as e:
                print(f"Error converting existing booking time for conflict check: {e}")
                continue # Skip this existing booking if its time data is malformed

            # Check for overlap: (StartA < EndB) and (EndA > StartB)
            if (booking_start_dt_local < existing_end_dt_local and
                booking_end_dt_local > existing_start_dt_local):
                conflicting_slots.append({
                    "id": existing_booking_id,
                    "time": existing_booking['time'],
                    "duration": existing_booking['duration'],
                    "userName": existing_booking.get('userName', 'Another User'),
                    "userTimeZone": existing_user_timezone
                })

        if conflicting_slots:
            print(f"Booking conflict detected for user {request.uid}: {conflicting_slots}")
            return jsonify({
                "error": "Selected time slot conflicts with an existing booking.",
                "conflictingSlots": conflicting_slots
            }), 409 # HTTP 409 Conflict

        # --- Prepare Firestore Data (now includes userEmail and userTimeZone) ---
        firestore_data = {
            "userId": request.uid,
            "userName": user_name_from_token, # Use the name from the verified token
            "userEmail": request.user_email, # Use the email from the verified token
            "date": selected_date_str,
            "time": selected_time_str,
            "duration": duration_hours,
            "equipment": booking_data.get('equipment', []),
            "total": booking_data['total'],
            "paymentMethod": booking_data.get('paymentMethod', 'cash'),
            "paymentStatus": booking_data.get('paymentStatus', 'pending'),
            "timestamp": firestore.SERVER_TIMESTAMP,
            "userTimeZone": user_timezone_str # Store the user's timezone
        }

        calendar_event_id = None
        
        print(f"\nAttempting Google Calendar Integration for booking {editing_booking_id if editing_booking_id else 'NEW'}.")
        print(f"Calendar service initialized: {calendar_service is not None}")
        print(f"Google Calendar ID set: {GOOGLE_CALENDAR_CALENDAR_ID}")

        # --- Handle Firestore Save/Update FIRST to get a booking_id ---
        booking_id = editing_booking_id
        if editing_booking_id:
            # Check if the document exists in the user's collection
            user_booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{request.uid}/bookings').document(editing_booking_id)
            existing_user_booking_snap = user_booking_doc_ref.get()

            if existing_user_booking_snap.exists:
                # Update existing user booking
                existing_calendar_event_id = existing_user_booking_snap.to_dict().get('calendarEventId')
                firestore_data['calendarEventId'] = existing_calendar_event_id # Carry over existing calendar ID
                user_booking_doc_ref.set(firestore_data, merge=True)
                print(f"Existing user booking {booking_id} updated in Firestore.")
            else:
                # If editing_booking_id was provided but doc not found in user's collection,
                # it means it's a new booking for this user (e.g., if ID was manually typed or from public list not owned).
                # Treat as new for this user.
                new_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{request.uid}/bookings').add(firestore_data)
                booking_id = new_booking_ref[1].id
                print(f"Booking {editing_booking_id} not found in user's collection, created as NEW with ID: {booking_id}")
        else:
            # Add new booking to user's private collection
            new_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{request.uid}/bookings').add(firestore_data)
            booking_id = new_booking_ref[1].id
            print(f"New booking {booking_id} added to user's private Firestore collection.")

        # Always update the public collection with the latest data and the determined booking_id
        public_booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        public_booking_doc_ref.set(firestore_data, merge=True)
        print(f"Public booking record {booking_id} updated/created in Firestore.")

        # --- Google Calendar Integration ---
        if calendar_service and GOOGLE_CALENDAR_CALENDAR_ID and calendar_creds:
            try:
                print("Attempting to refresh Google Calendar token before API call...")
                calendar_creds.refresh(GoogleAuthRequest())
                print("Google Calendar token refreshed successfully.")

                start_time_rfc3339 = booking_start_dt_local.isoformat()
                end_time_rfc3339 = booking_end_dt_local.isoformat()

                event = {
                    'summary': f'DJ Studio Booking: {user_name_from_token}', # Use the name from token
                    'description': (
                        f'Booking ID: {booking_id}\n' # Include the Firestore booking ID
                        f'Date: {selected_date_str}\n'
                        f'Time: {selected_time_str} - {booking_end_dt_local.strftime("%H:%M")}\n' # Show end time
                        f'Duration: {duration_hours} hours\n'
                        f'Equipment: {", ".join([eq["name"] for eq in booking_data.get("equipment", [])]) if booking_data.get("equipment") else "None"}\n'
                        f'Total: {booking_data["total"]}\n'
                        f'Payment: {booking_data.get("paymentMethod", "cash")} ({booking_data.get("paymentStatus", "pending")})'
                    ),
                    'start': {
                        'dateTime': start_time_rfc3339,
                        'timeZone': user_timezone_str,
                    },
                    'end': {
                        'dateTime': end_time_rfc3339,
                        'timeZone': user_timezone_str,
                    },
                    'attendees': [
                        {'email': request.user_email if request.user_email else 'your-dj-studio-email@example.com', 'responseStatus': 'accepted'}
                    ],
                    'reminders': {
                        'useDefault': False,
                        'overrides': [
                            {'method': 'email', 'minutes': 24 * 60},
                            {'method': 'popup', 'minutes': 30},
                        ],
                    },
                    'extendedProperties': {
                        'private': {
                            'appBookingId': booking_id, # Use the actual Firestore booking ID
                            'userId': request.uid
                        }
                    }
                }
                print(f"Google Calendar event object prepared:\n{json.dumps(event, indent=2)}")

                # Use the existing calendarEventId if it was carried over from an update
                current_calendar_event_id = firestore_data.get('calendarEventId')

                if current_calendar_event_id:
                    print(f"Attempting to UPDATE Google Calendar event with ID: {current_calendar_event_id}")
                    event_result = calendar_service.events().update(
                        calendarId=GOOGLE_CALENDAR_CALENDAR_ID, 
                        eventId=current_calendar_event_id, 
                        body=event
                    ).execute()
                    print(f"Google Calendar event updated: {event_result.get('htmlLink')}")
                    calendar_event_id = event_result.get('id')
                else:
                    print("Attempting to INSERT NEW Google Calendar event.")
                    event_result = calendar_service.events().insert(calendarId=GOOGLE_CALENDAR_CALENDAR_ID, body=event).execute()
                    print(f"New Google Calendar event created: {event_result.get('htmlLink')}")
                    calendar_event_id = event_result.get('id')
                
                # Update Firestore with the final calendar event ID
                public_booking_doc_ref.set({'calendarEventId': calendar_event_id}, merge=True)
                user_booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{request.uid}/bookings').document(booking_id)
                user_booking_doc_ref.set({'calendarEventId': calendar_event_id}, merge=True)
                print(f"Firestore booking {booking_id} updated with calendarEventId: {calendar_event_id}")

            except Exception as e:
                print(f"CRITICAL ERROR during Google Calendar API interaction: {e}")
                import traceback
                traceback.print_exc()
                # Log calendar sync failure in Firestore
                public_booking_doc_ref.set({'calendarSyncStatus': 'failed', 'calendarSyncError': str(e)}, merge=True)
                user_booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{request.uid}/bookings').document(booking_id)
                user_booking_doc_ref.set({'calendarSyncStatus': 'failed', 'calendarSyncError': str(e)}, merge=True)
        else:
            print("Google Calendar API client or calendar ID is not ready. Skipping calendar event creation.")


        return jsonify({"message": "Booking confirmed successfully", "bookingId": booking_id}), 200

    except Exception as e: # This is the main exception handler for the entire function
        print(f"Overall error confirming booking or calling calendar backend: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal Server Error", "message": str(e)}), 500

@app.route('/api/cancel-calendar-event', methods=['DELETE'], endpoint='cancel_calendar_event')
def cancel_calendar_event():
    if not hasattr(request, 'uid') or not request.uid:
        return jsonify({"error": "Unauthorized", "message": "User not authenticated."}), 401

    data = request.get_json()
    calendar_event_id = data.get('calendarEventId')

    if not calendar_event_id:
        return jsonify({"error": "Bad Request", "message": "Calendar event ID is required."}), 400

    print(f"\nAttempting to DELETE Google Calendar Event with ID: {calendar_event_id}")
    print(f"Calendar service initialized: {calendar_service is not None}")
    print(f"Google Calendar ID set: {GOOGLE_CALENDAR_CALENDAR_ID}")

    if calendar_service and GOOGLE_CALENDAR_CALENDAR_ID and calendar_creds: # Ensure calendar_creds is available
        try:
            # AGGRESSIVE REFRESH: Attempt to refresh token right before use
            print("Attempting to refresh Google Calendar token before API call for deletion...")
            calendar_creds.refresh(GoogleAuthRequest())
            print("Google Calendar token refreshed successfully for deletion.")

            calendar_service.events().delete(
                calendarId=GOOGLE_CALENDAR_CALENDAR_ID, 
                eventId=calendar_event_id
            ).execute()
            print(f"Google Calendar event {calendar_event_id} deleted successfully.")
            return jsonify({"message": f"Calendar event {calendar_event_id} cancelled successfully."}), 200
        except Exception as e:
            print(f"CRITICAL ERROR deleting Google Calendar event {calendar_event_id}: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({"error": "Internal Server Error", "message": str(e)}), 500
    else:
        print("Google Calendar API client, calendar ID, or credentials are not ready. Cannot delete event.")
        return jsonify({"error": "Server Error", "message": "Google Calendar API not initialized or calendar ID missing."}), 500

@app.route('/api/check-booked-slots', methods=['GET'])
def check_booked_slots():
    """
    Endpoint to retrieve all booked slots for a specific date from the public collection.
    This is used by the frontend to display available times and for conflict checking.
    """
    try:
        if not db:
            return jsonify({"error": "Server Error", "message": "Firestore not initialized."}), 500

        selected_date_str = request.args.get('date')
        if not selected_date_str:
            return jsonify({"error": "Date parameter is missing."}), 400

        # Fetch bookings from the public collection
        bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
        query = bookings_ref.where('date', '==', selected_date_str).stream()

        booked_slots = []
        for doc_snap in query:
            booking = doc_snap.to_dict()
            booked_slots.append({
                "id": doc_snap.id,
                "time": booking['time'],
                "duration": booking['duration'],
                "userName": booking.get('userName', 'N/A'), # Ensure userName is included
                "userTimeZone": booking.get('userTimeZone', 'Asia/Jakarta') # Ensure timezone is included
            })
        
        return jsonify({"bookedSlots": booked_slots}), 200

    except Exception as e:
        print(f"Error in check_booked_slots: {e}")
        return jsonify({"error": "Failed to fetch booked slots."}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Python Calendar Backend listening on port {port}")
    app.run(host='0.0.0.0', port=port)
