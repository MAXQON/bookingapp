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

# Initialize Flask App
app = Flask(__name__)

# Configure CORS - Allow all origins for development, specify origins for production
# This allows your frontend (e.g., hosted on Render or GitHub Pages) to communicate with this backend.
CORS(app)

# --- Firebase Admin SDK Initialization ---
# Ensure the environment variable is set in Render.
# The service account key JSON is base64 encoded to safely pass it as an environment variable.
firebase_service_account_key_base64 = os.environ.get('FIREBASE_SERVICE_ACCOUNT_KEY_BASE64')

if firebase_service_account_key_base64:
    try:
        # Decode the base64 string to bytes, then decode bytes to UTF-8 string
        service_account_info_str = firebase_service_account_key_base64.encode('utf-8').decode('base64')
        service_account_info = json.loads(service_account_info_str)
        
        # Log service account details for debugging (excluding sensitive parts)
        print("Service account JSON decoded and parsed successfully from FIREBASE_SERVICE_ACCOUNT_KEY_BASE64.")
        print("Debug: Firebase Admin SDK Service Account Details:")
        print(f"  Project ID: {service_account_info.get('project_id', 'N/A')}")
        print(f"  Client Email: {service_account_info.get('client_email', 'N/A')}")
        
        # Only show a preview of the private key, not the whole thing
        private_key_preview = service_account_info.get('private_key', 'N/A')
        if private_key_preview != 'N/A':
            private_key_preview_start = private_key_preview[:50]
            private_key_preview_end = private_key_preview[-50:]
            print(f"  Private Key Length: {len(private_key_preview)}")
            print(f"  Private Key Preview (first 50): {private_key_preview_start}")
            print(f"  Private Key Preview (last 50): {private_key_preview_end}")
        else:
            print("  Private Key: Not found or empty.")
        
        cred = credentials.Certificate(service_account_info)
        firebase_admin.initialize_app(cred)
        db = firestore.client() # Initialize Firestore client
        print("Firebase Admin SDK initialized successfully.")
    except Exception as e:
        print(f"Error initializing Firebase Admin SDK: {e}")
        db = None # Ensure db is None if initialization fails
else:
    print("FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 environment variable not set.")
    print("Firebase Admin SDK will not be initialized. Firestore operations will fail.")
    db = None # Ensure db is None if environment variable is missing

# --- Google Calendar API Initialization ---
# Set these environment variables in Render
GOOGLE_CALENDAR_CLIENT_ID = os.environ.get('GOOGLE_CALENDAR_CLIENT_ID')
GOOGLE_CALENDAR_CLIENT_SECRET = os.environ.get('GOOGLE_CALENDAR_CLIENT_SECRET')
GOOGLE_CALENDAR_REFRESH_TOKEN = os.environ.get('GOOGLE_CALENDAR_REFRESH_TOKEN')
GOOGLE_CALENDAR_CALENDAR_ID = os.environ.get('GOOGLE_CALENDAR_CALENDAR_ID') # The ID of the calendar to manage events

calendar_service = None

if GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET and GOOGLE_CALENDAR_REFRESH_TOKEN:
    try:
        # Create dummy credentials object for refreshing
        creds = Credentials(
            token=None,  # No initial access token, will be refreshed
            refresh_token=GOOGLE_CALENDAR_REFRESH_TOKEN,
            token_uri='https://oauth2.googleapis.com/token',
            client_id=GOOGLE_CALENDAR_CLIENT_ID,
            client_secret=GOOGLE_CALENDAR_CLIENT_SECRET,
            scopes=['https://www.googleapis.com/auth/calendar.events'] # Scope for managing calendar events
        )
        
        # Force refresh the token to get a valid access token
        # This will use the refresh_token to get a new access_token
        creds.refresh(requests.Request(), requests.post)
        
        # Build the Calendar service
        calendar_service = build('calendar', 'v3', credentials=creds)
        print("Google Calendar API service initialized successfully.")
    except Exception as e:
        print(f"Error initializing Google Calendar API service: {e}")
else:
    print("Google Calendar API environment variables (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN) not fully set.")
    print("Google Calendar API functionality will be disabled.")


# --- Middleware to verify Firebase ID Token ---
@app.before_request
def verify_firebase_token():
    # Allow OPTIONS requests to pass through without authentication (for CORS preflight)
    if request.method == 'OPTIONS':
        return

    # Define paths that do NOT require authentication
    unprotected_paths = [
        '/', # Home route
    ]
    if request.path in unprotected_paths:
        request.uid = None # Explicitly set uid to None for unprotected paths
        return

    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"error": "Unauthorized", "message": "Bearer token missing or invalid."}), 401

    id_token = auth_header.split(' ')[1]
    
    try:
        # Verify the ID token using Firebase Admin SDK
        # This also retrieves the user's UID and other claims
        decoded_token = auth.verify_id_token(id_token)
        request.uid = decoded_token['uid']
        request.user_email = decoded_token.get('email')
        request.user_display_name = decoded_token.get('name', request.user_email)
        print(f"Firebase ID token verified for UID: {request.uid}")
    except Exception as e:
        print(f"Error verifying Firebase ID token: {e}")
        return jsonify({"error": "Unauthorized", "message": str(e)}), 401


# --- Routes ---

@app.route('/')
def home():
    return "Python Backend for DJ Room Booking App is running!"


@app.route('/api/update-profile', methods=['POST'], endpoint='update_profile')
def update_profile():
    # This route is now protected by verify_firebase_token middleware
    if not hasattr(request, 'uid') or not request.uid:
        return jsonify({"error": "Unauthorized", "message": "User not authenticated."}), 401
    
    if not db:
        return jsonify({"error": "Server Error", "message": "Firestore not initialized."}), 500

    data = request.get_json()
    new_display_name = data.get('displayName')

    if not new_display_name:
        return jsonify({"error": "Bad Request", "message": "Display name is required."}), 400

    try:
        user_profile_ref = db.collection('artifacts').document(
            os.environ.get('APP_ID_FOR_FIRESTORE_PATH', 'default-app-id')
        ).collection('users').document(request.uid).collection('profiles').document('userProfile')

        user_profile_ref.set({
            'displayName': new_display_name,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }, merge=True)
        
        # Also update the user's display name directly in Firebase Auth
        auth.update_user(request.uid, display_name=new_display_name)

        return jsonify({"message": "Profile updated successfully.", "displayName": new_display_name}), 200
    except Exception as e:
        print(f"Error updating profile: {e}")
        return jsonify({"error": "Internal Server Error", "message": str(e)}), 500


@app.route('/api/confirm-booking', methods=['POST'], endpoint='confirm_booking')
def confirm_booking():
    # This route is now protected by verify_firebase_token middleware
    if not hasattr(request, 'uid') or not request.uid:
        return jsonify({"error": "Unauthorized", "message": "User not authenticated."}), 401
    
    if not db:
        return jsonify({"error": "Server Error", "message": "Firestore not initialized."}), 500

    data = request.get_json()
    booking_data = data.get('bookingData')
    user_name = data.get('userName', 'Anonymous User') # Get userName from frontend payload
    editing_booking_id = data.get('editingBookingId')

    if not booking_data:
        return jsonify({"error": "Bad Request", "message": "Booking data is required."}), 400

    try:
        booking_collection_ref = db.collection('artifacts').document(
            os.environ.get('APP_ID_FOR_FIRESTORE_PATH', 'default-app-id')
        ).collection('users').document(request.uid).collection('bookings')

        # Prepare booking data for Firestore
        firestore_data = {
            "userId": request.uid,
            "userName": user_name, # Store userName in booking document
            "date": booking_data['date'],
            "time": booking_data['time'],
            "duration": booking_data['duration'],
            "equipment": booking_data.get('equipment', []),
            "total": booking_data['total'],
            "paymentMethod": booking_data.get('paymentMethod', 'cash'),
            "paymentStatus": booking_data.get('paymentStatus', 'pending'),
            "timestamp": firestore.SERVER_TIMESTAMP,
        }

        calendar_event_id = None
        if calendar_service and GOOGLE_CALENDAR_CALENDAR_ID:
            try:
                # Construct start and end times in user's timezone, then convert to RFC3339 for Google Calendar
                selected_date = booking_data['date'] # YYYY-MM-DD
                selected_time = booking_data['time'] # HH:MM (24-hour)
                duration_hours = booking_data['duration']

                # Use the user's timezone from the frontend or default to 'Asia/Jakarta'
                user_timezone_str = booking_data.get('userTimeZone', 'Asia/Jakarta')
                
                try:
                    user_timezone = pytz.timezone(user_timezone_str)
                except pytz.exceptions.UnknownTimeZoneError:
                    print(f"Unknown timezone from frontend: {user_timezone_str}. Defaulting to Asia/Jakarta.")
                    user_timezone = pytz.timezone('Asia/Jakarta')

                # Parse date and time to a naive datetime object
                start_datetime_naive = datetime.datetime.strptime(f"{selected_date} {selected_time}", "%Y-%m-%d %H:%M")
                
                # Localize the naive datetime object to the user's timezone
                start_datetime_localized = user_timezone.localize(start_datetime_naive)
                
                end_datetime_localized = start_datetime_localized + datetime.timedelta(hours=duration_hours)

                # Convert to RFC3339 format
                start_time_rfc3339 = start_datetime_localized.isoformat()
                end_time_rfc3339 = end_datetime_localized.isoformat()

                event = {
                    'summary': f'DJ Studio Booking: {user_name}',
                    'description': (
                        f'Date: {selected_date}\n'
                        f'Time: {selected_time} for {duration_hours} hours\n'
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
                        {'email': request.user_email if request.user_email else 'your-dj-studio-email@example.com', 'responseStatus': 'accepted'} # Replace with your studio's email
                    ],
                    'reminders': {
                        'useDefault': False,
                        'overrides': [
                            {'method': 'email', 'minutes': 24 * 60}, # 24 hours before
                            {'method': 'popup', 'minutes': 30},   # 30 minutes before
                        ],
                    },
                    # Add a unique identifier for your app to the event (optional, but good for tracking)
                    'extendedProperties': {
                        'private': {
                            'appBookingId': editing_booking_id if editing_booking_id else 'new',
                            'userId': request.uid
                        }
                    }
                }

                if editing_booking_id:
                    # If editing, try to get the existing calendarEventId from Firestore first
                    existing_booking_doc = booking_collection_ref.document(editing_booking_id).get()
                    existing_calendar_event_id = None
                    if existing_booking_doc.exists:
                        existing_calendar_event_id = existing_booking_doc.to_dict().get('calendarEventId')

                    if existing_calendar_event_id:
                        # Update existing event
                        event_result = calendar_service.events().update(
                            calendarId=GOOGLE_CALENDAR_CALENDAR_ID, 
                            eventId=existing_calendar_event_id, 
                            body=event
                        ).execute()
                        print(f"Google Calendar event updated: {event_result.get('htmlLink')}")
                        calendar_event_id = event_result.get('id')
                    else:
                        # Add new event if existing ID not found for update scenario
                        event_result = calendar_service.events().insert(calendarId=GOOGLE_CALENDAR_CALENDAR_ID, body=event).execute()
                        print(f"New Google Calendar event created: {event_result.get('htmlLink')}")
                        calendar_event_id = event_result.get('id')
                else:
                    # Create new event
                    event_result = calendar_service.events().insert(calendarId=GOOGLE_CALENDAR_CALENDAR_ID, body=event).execute()
                    print(f"New Google Calendar event created: {event_result.get('htmlLink')}")
                    calendar_event_id = event_result.get('id')
                
                firestore_data['calendarEventId'] = calendar_event_id

            except Exception as e:
                print(f"Error interacting with Google Calendar API: {e}")
                # Log the error but don't prevent booking confirmation if calendar fails
                # You might want to add a status to the booking indicating calendar sync failed.
                firestore_data['calendarSyncStatus'] = 'failed'
                firestore_data['calendarSyncError'] = str(e)


        if editing_booking_id:
            # Update existing document
            booking_doc_ref = booking_collection_ref.document(editing_booking_id)
            booking_doc_ref.set(firestore_data, merge=True)
            booking_id = editing_booking_id
            print(f"Booking {booking_id} updated in Firestore.")
        else:
            # Add new document
            doc_ref = booking_collection_ref.add(firestore_data)
            booking_id = doc_ref[1].id # doc_ref is a tuple (update_time, document_reference)
            print(f"New booking {booking_id} added to Firestore.")

        return jsonify({"message": "Booking confirmed successfully", "bookingId": booking_id}), 200

    except Exception as e:
        print(f"Error confirming booking or calling calendar backend: {e}")
        return jsonify({"error": "Internal Server Error", "message": str(e)}), 500


@app.route('/api/cancel-calendar-event', methods=['DELETE'], endpoint='cancel_calendar_event')
def cancel_calendar_event():
    # This route is now protected by verify_firebase_token middleware
    if not hasattr(request, 'uid') or not request.uid:
        return jsonify({"error": "Unauthorized", "message": "User not authenticated."}), 401

    if not calendar_service or not GOOGLE_CALENDAR_CALENDAR_ID:
        return jsonify({"error": "Server Error", "message": "Google Calendar API not initialized or calendar ID missing."}), 500

    data = request.get_json()
    calendar_event_id = data.get('calendarEventId')

    if not calendar_event_id:
        return jsonify({"error": "Bad Request", "message": "Calendar event ID is required."}), 400

    try:
        # Delete the event from Google Calendar
        calendar_service.events().delete(
            calendarId=GOOGLE_CALENDAR_CALENDAR_ID, 
            eventId=calendar_event_id
        ).execute()
        print(f"Google Calendar event {calendar_event_id} deleted successfully.")
        return jsonify({"message": f"Calendar event {calendar_event_id} cancelled successfully."}), 200
    except Exception as e:
        print(f"Error deleting Google Calendar event {calendar_event_id}: {e}")
        return jsonify({"error": "Internal Server Error", "message": str(e)}), 500


if __name__ == '__main__':
    # When deploying on Render, Render sets the PORT environment variable.
    # Flask's default run command might not pick it up.
    # It's better to run with `gunicorn` or `waitress` in production,
    # but for local testing or simple Render deployment, this works if you
    # define `CMD` as `python app.py` or similar.
    # Render's "start command" in the web service settings usually overrides this.
    port = int(os.environ.get('PORT', 5000))
    print(f"Python Calendar Backend listening on port {port}")
    app.run(host='0.0.0.0', port=port)

