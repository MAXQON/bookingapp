# app.py or your_backend_file.py
import os
import json
import pytz # Import pytz for timezone handling
from datetime import datetime, timedelta

from flask import Flask, request, jsonify
from flask_cors import CORS # For handling Cross-Origin Resource Sharing

# Google API Python Client imports
from google.oauth2 import service_account
from googleapiclient.discovery import build
from google.auth.transport.requests import Request as GoogleAuthRequest

# --- Flask App Setup ---
app = Flask(__name__)
CORS(app) # Enable CORS for all routes, allowing your frontend to connect

# --- Configuration ---
# Firebase Admin SDK credentials (replace with your actual path or environment variable)
# It's recommended to use environment variables in production.
# For local development, ensure this JSON file is in your project directory
# or provide the full path.
FIREBASE_ADMIN_SDK_PATH = os.environ.get('FIREBASE_ADMIN_SDK_PATH', 'firebase-admin-sdk.json')

# Google Calendar API credentials (replace with your actual path or environment variable)
# This service account should have access to create/manage events on the target calendar.
GOOGLE_CALENDAR_SERVICE_ACCOUNT_PATH = os.environ.get('GOOGLE_CALENDAR_SERVICE_ACCOUNT_PATH', 'google-calendar-service-account.json')

# The ID of the Google Calendar you want to manage (e.g., your primary calendar email or calendar ID)
GOOGLE_CALENDAR_ID = os.environ.get('GOOGLE_CALENDAR_ID', 'your-calendar-id@group.calendar.google.com') # REPLACE THIS

# --- Firebase Admin SDK Initialization ---
# This initializes Firebase Admin for backend authentication verification
import firebase_admin
from firebase_admin import credentials, auth, firestore

try:
    cred = credentials.Certificate(FIREBASE_ADMIN_SDK_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase Admin SDK initialized successfully.")
except Exception as e:
    print(f"Error initializing Firebase Admin SDK: {e}")
    # Exit or handle the error appropriately if Firebase is critical for your app
    # For a web server, you might want to log and continue, but flag the issue.

# --- Google Calendar API Initialization ---
# This initializes the Google Calendar service for event management
calendar_service = None
try:
    # Authenticate with the Google Calendar service account
    calendar_scopes = ['https://www.googleapis.com/auth/calendar']
    calendar_creds = service_account.Credentials.from_service_account_file(
        GOOGLE_CALENDAR_SERVICE_ACCOUNT_PATH, scopes=calendar_scopes)
    calendar_service = build('calendar', 'v3', credentials=calendar_creds)
    print("Google Calendar API service initialized successfully.")
except Exception as e:
    print(f"Error initializing Google Calendar API: {e}")
    # This is a critical error if calendar functionality is core.

# --- Middleware for Firebase Authentication ---
@app.before_request
def verify_auth_token():
    # Allow OPTIONS requests to pass through (pre-flight requests for CORS)
    if request.method == 'OPTIONS':
        return

    # Skip auth for public routes if you have any (e.g., status checks)
    # For this app, all routes require auth since they involve user data.
    
    id_token = request.headers.get('Authorization')
    if not id_token:
        request.uid = None # No token, mark user as unauthenticated
        print("No Authorization header provided. Skipping token verification.")
        return # Allow unauthenticated access if needed for certain routes, otherwise return 401

    if id_token.startswith('Bearer '):
        id_token = id_token.split(' ')[1]

    try:
        # Verify the ID token using Firebase Admin SDK
        decoded_token = auth.verify_id_token(id_token)
        request.uid = decoded_token['uid']
        request.user_name = decoded_token.get('name', decoded_token.get('email', 'Anonymous'))
        print(f"Token verified for UID: {request.uid}")
    except Exception as e:
        print(f"Error verifying Firebase ID token: {e}")
        request.uid = None # Mark as unauthenticated if verification fails
        # Consider returning an error response here for unauthorized access
        # return jsonify({"error": "Unauthorized"}), 401


# --- Helper function to check if user is authenticated ---
def require_auth(f):
    def decorated_function(*args, **kwargs):
        if not request.uid:
            return jsonify({"error": "Authentication required. Please sign in."}), 401
        return f(*args, **kwargs)
    return decorated_function

# --- Firebase Firestore Constants ---
FIRESTORE_ARTIFACTS_PATH = 'artifacts'
FIRESTORE_USERS_COLLECTION = 'users'
FIRESTORE_BOOKINGS_COLLECTION = 'bookings'
FIRESTORE_PROFILES_COLLECTION = 'profiles'
FIRESTORE_PROFILE_DOC = 'userProfile' # Fixed document ID for user profile

# --- Backend API Endpoints ---

@app.route('/api/confirm-booking', methods=['POST'])
@require_auth
def confirm_booking():
    if not db or not calendar_service:
        return jsonify({"error": "Backend services not initialized."}), 500

    data = request.get_json()
    booking_data = data.get('bookingData')
    user_name = data.get('userName', 'A User')
    editing_booking_id = data.get('editingBookingId')

    if not booking_data:
        return jsonify({"error": "Booking data is required"}), 400

    # Extract data with user's provided timezone
    selected_date = booking_data['date'] # e.g., '2025-06-30'
    selected_time = booking_data['time'] # e.g., '12:00'
    duration = booking_data['duration'] # e.g., 2
    user_time_zone_str = booking_data.get('userTimeZone') # e.g., 'Asia/Makassar'

    if not user_time_zone_str:
        # Fallback to a default timezone if not provided by frontend (less ideal)
        user_time_zone_str = 'Asia/Jakarta' # Or your server's default/UTC
        print(f"User timezone not provided, defaulting to {user_time_zone_str}")

    try:
        user_tz = pytz.timezone(user_time_zone_str)
    except pytz.UnknownTimeZoneError:
        print(f"Unknown timezone: {user_time_zone_str}. Falling back to UTC.")
        user_tz = pytz.utc # Fallback to UTC if timezone is invalid
        user_time_zone_str = 'UTC'


    # Construct timezone-aware datetime objects for Google Calendar
    # Combine date and time strings, then parse as local and localize to user's timezone
    try:
        start_dt_str = f"{selected_date}T{selected_time}:00"
        # Parse without timezone, then localize. This assumes selected_time is local.
        start_local = datetime.fromisoformat(start_dt_str)
        start_aware = user_tz.localize(start_local)

        end_aware = start_aware + timedelta(hours=duration)

        # Format for Google Calendar API
        start_gcal_format = {
            'dateTime': start_aware.isoformat(),
            'timeZone': user_time_zone_str,
        }
        end_gcal_format = {
            'dateTime': end_aware.isoformat(),
            'timeZone': user_time_zone_str,
        }
    except Exception as e:
        print(f"Error creating timezone-aware datetimes: {e}")
        return jsonify({"error": f"Invalid date/time or timezone: {e}"}), 400


    booking_ref = None
    calendar_event_id = None

    try:
        # Get a reference to the user's booking collection
        user_bookings_collection_ref = db.collection(
            FIRESTORE_ARTIFACTS_PATH
        ).document(app.config.get('APP_ID_FOR_FIRESTORE_PATH', 'default-app-id')).collection(
            FIRESTORE_USERS_COLLECTION
        ).document(request.uid).collection(
            FIRESTORE_BOOKINGS_COLLECTION
        )

        if editing_booking_id:
            booking_ref = user_bookings_collection_ref.document(editing_booking_id)
            booking_doc = booking_ref.get()
            if booking_doc.exists:
                existing_data = booking_doc.to_dict()
                calendar_event_id = existing_data.get('calendarEventId')
                print(f"Editing booking {editing_booking_id}. Existing calendarEventId: {calendar_event_id}")
            else:
                print(f"Booking {editing_booking_id} not found for update, creating new event.")
                editing_booking_id = None # Treat as new if not found

        # Create/Update Google Calendar Event
        event = {
            'summary': f'DJ Studio Booking by {user_name}',
            'location': 'Your DJ Studio Location', # Customize this
            'description': (
                f'Booking ID: {editing_booking_id if editing_booking_id else "New"}\n'
                f'Date: {selected_date}\n'
                f'Time: {selected_time} - {end_aware.strftime("%H:%M")}\n' # Display local time in description
                f'Duration: {duration} hours\n'
                f'Equipment: {", ".join([eq["name"] for eq in booking_data["equipment"]])}\n'
                f'Payment: {booking_data["paymentMethod"]} ({booking_data["paymentStatus"]})'
            ),
            'start': start_gcal_format,
            'end': end_gcal_format,
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'email', 'minutes': 24 * 60}, # 24 hours before
                    {'method': 'popup', 'minutes': 60},      # 1 hour before
                ],
            },
        }

        if calendar_event_id:
            # Update existing event
            updated_event = calendar_service.events().update(
                calendarId=GOOGLE_CALENDAR_ID, eventId=calendar_event_id, body=event
            ).execute()
            calendar_event_id = updated_event['id']
            print(f"Calendar event UPDATED: {updated_event.get('htmlLink')} Event ID: {calendar_event_id}")
        else:
            # Insert new event
            created_event = calendar_service.events().insert(
                calendarId=GOOGLE_CALENDAR_ID, body=event
            ).execute()
            calendar_event_id = created_event['id']
            print(f"Calendar event CREATED: {created_event.get('htmlLink')} Event ID: {calendar_event_id}")

        # Prepare Firestore data to save/update
        firestore_booking_data = {
            'date': selected_date,
            'time': selected_time,
            'duration': duration,
            'equipment': booking_data['equipment'],
            'total': booking_data['total'],
            'userId': request.uid,
            'userName': user_name,
            'paymentMethod': booking_data['paymentMethod'],
            'paymentStatus': booking_data['paymentStatus'],
            'calendarEventId': calendar_event_id, # Store the Google Calendar Event ID
            'userTimeZone': user_time_zone_str, # Store the user's timezone for reference
            'timestamp': firestore.SERVER_TIMESTAMP # Use server timestamp
        }

        if editing_booking_id:
            booking_ref.set(firestore_booking_data, merge=True)
            print(f"Firestore booking {editing_booking_id} updated/set.")
            return jsonify({"message": "Booking and calendar event updated successfully!", "bookingId": editing_booking_id}), 200
        else:
            new_doc_ref = user_bookings_collection_ref.add(firestore_booking_data)[1] # add() returns (datetime, doc_ref)
            new_booking_id = new_doc_ref.id
            print(f"Booking ADDED to Firestore: {new_booking_id}")
            # Update the Firestore document with the actual event ID if it was new
            # and we want to ensure the event ID is associated with the Firestore doc ID.
            # This handles the scenario where Firestore generates an ID, then Calendar API creates one.
            new_doc_ref.set({'calendarEventId': calendar_event_id}, merge=True)
            print(f"Firestore booking {new_booking_id} updated with calendarEventId: {calendar_event_id}")
            return jsonify({"message": "Booking and calendar event confirmed successfully!", "bookingId": new_booking_id}), 201

    except Exception as e:
        print(f"Error processing booking: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/cancel-calendar-event', methods=['DELETE'])
@require_auth
def cancel_calendar_event():
    if not calendar_service:
        return jsonify({"error": "Google Calendar service not initialized."}), 500

    data = request.get_json()
    calendar_event_id = data.get('calendarEventId')

    if not calendar_event_id:
        return jsonify({"error": "calendarEventId is required"}), 400

    try:
        calendar_service.events().delete(calendarId=GOOGLE_CALENDAR_ID, eventId=calendar_event_id).execute()
        print(f"Google Calendar event {calendar_event_id} deleted successfully.")
        return jsonify({"message": f"Calendar event {calendar_event_id} deleted successfully."}), 200
    except Exception as e:
        print(f"Error deleting Google Calendar event {calendar_event_id}: {e}")
        return jsonify({"error": f"Failed to delete calendar event: {e}"}), 500

@app.route('/api/update-profile', methods=['POST'])
@require_auth
def update_profile():
    if not db:
        return jsonify({"error": "Firestore database not initialized."}), 500

    data = request.get_json()
    display_name = data.get('displayName')

    if not display_name:
        return jsonify({"error": "Display name is required"}), 400

    try:
        # Update Firebase Auth profile
        auth.update_user(request.uid, display_name=display_name)
        
        # Update Firestore user profile document
        user_profile_doc_ref = db.collection(
            FIRESTORE_ARTIFACTS_PATH
        ).document(app.config.get('APP_ID_FOR_FIRESTORE_PATH', 'default-app-id')).collection(
            FIRESTORE_USERS_COLLECTION
        ).document(request.uid).collection(
            FIRESTORE_PROFILES_COLLECTION
        ).document(FIRESTORE_PROFILE_DOC)
        
        user_profile_doc_ref.set({'displayName': display_name, 'updatedAt': firestore.SERVER_TIMESTAMP}, merge=True)
        
        print(f"User profile updated for UID: {request.uid} with Display Name: {display_name}")
        return jsonify({"message": "Profile updated successfully!"}), 200
    except Exception as e:
        print(f"Error updating user profile: {e}")
        return jsonify({"error": str(e)}), 500

# --- Health Check Route ---
@app.route('/api/status', methods=['GET'])
def status():
    return jsonify({"status": "Backend is running!"}), 200

# To run this Flask app:
# 1. Save it as e.g., app.py
# 2. pip install Flask Flask-Cors google-api-python-client firebase-admin pytz
# 3. Set environment variables for your Firebase and Google Calendar service account JSON paths and calendar ID.
#    e.g., export FIREBASE_ADMIN_SDK_PATH='./firebase-admin-sdk.json'
#          export GOOGLE_CALENDAR_SERVICE_ACCOUNT_PATH='./google-calendar-service-account.json'
#          export GOOGLE_CALENDAR_ID='your-calendar-id@group.calendar.google.com'
# 4. flask run -p 5000 (or gunicorn for production)
