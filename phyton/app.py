# main.py

import os
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from google.cloud import firestore
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
import datetime
import pytz # Import pytz for timezone handling
from flask_mail import Mail, Message # Import Flask-Mail components
from dotenv import load_dotenv # Import dotenv

# --- Google Calendar API Imports ---
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# --- Firebase Admin SDK Imports ---
import firebase_admin
from firebase_admin import credentials, auth
# Removed: from firebase_admin import apps # This import caused the ImportError

# Load environment variables from .env file (for local development)
load_dotenv()

app = Flask(__name__)

# --- Flask-Mail Configuration (from Environment Variables) ---
# Ensure these environment variables are set on Render for email functionality
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER')

mail = Mail(app)

# --- CORS Configuration ---
# IMPORTANT: Configure CORS to explicitly allow your frontend domain
CORS(app, origins=["https://maxqoon.github.io", "http://localhost:3000"], supports_credentials=True)

# --- Firebase/Google Cloud Credentials from Render Secret File ---
# Render mounts secret files to /etc/secrets/ by default.
# Ensure your service_account_key.json is mounted as 'google-calendar-key.json'
SERVICE_ACCOUNT_KEY_PATH = '/etc/secrets/google-calendar-key.json'
GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar']

# Global variables to store initialized clients
db = None
calendar_service = None
firebase_admin_app = None # To store the Firebase Admin SDK app instance
FIREBASE_PROJECT_ID = None # Will be derived from service account key

def _initialize_firebase():
    """Initializes Firebase Firestore and Google Calendar clients."""
    global db, calendar_service, firebase_admin_app, FIREBASE_PROJECT_ID

    if db and calendar_service and firebase_admin_app:
        print("Firebase and Google Calendar clients already initialized.")
        return db, calendar_service, firebase_admin_app

    try:
        # Load service account credentials from the mounted secret file
        creds = Credentials.from_service_account_file(
            SERVICE_ACCOUNT_KEY_PATH, scopes=GOOGLE_CALENDAR_SCOPES
        )
        print(f"Loaded credentials from: {SERVICE_ACCOUNT_KEY_PATH}")

        # Initialize Firebase Admin SDK
        # This is the most robust way to check if an app is already initialized
        try:
            firebase_admin_app = firebase_admin.get_app() # Tries to get the default app
            print("Firebase Admin SDK already initialized, reusing existing app.")
        except ValueError: # This error is raised if no default app is initialized
            firebase_admin_app = firebase_admin.initialize_app(creds)
            print("Firebase Admin SDK initialized.")


        # Initialize Firestore DB client
        db = firestore.Client(credentials=creds, project=creds.project_id)
        FIREBASE_PROJECT_ID = creds.project_id # Get project ID from credentials
        print(f"Firestore Client initialized for project: {FIREBASE_PROJECT_ID}")

        # Initialize Google Calendar service
        calendar_service = build('calendar', 'v3', credentials=creds)
        print("Google Calendar service initialized.")

        return db, calendar_service, firebase_admin_app

    except FileNotFoundError:
        print(f"Error: Service account key file not found at {SERVICE_ACCOUNT_KEY_PATH}")
        raise ValueError("Service account key file not found. Cannot initialize Firebase/Google Calendar.")
    except Exception as e:
        print(f"Error initializing Firebase/Google Calendar: {e}")
        raise

# Initialize Firebase and Google Calendar clients on app startup
try:
    db, calendar_service, firebase_admin_app = _initialize_firebase()
except ValueError as e:
    print(f"Fatal Initialization Error: {e}")
    # In a production app, you might want to exit or handle this more gracefully
    # For now, we'll let the app continue, but subsequent calls will fail if clients aren't set.
    db = None
    calendar_service = None
    firebase_admin_app = None


@app.before_request
def verify_token():
    """Verifies the Firebase ID token from the Authorization header.
    Allows specific routes to bypass token verification."""
    # List of routes that do NOT require authentication
    # Using startswith for robustness, as request.path might include query parameters
    # or have a trailing slash depending on how the request is formed.
    if request.path.startswith('/api/check-booked-slots'):
        return

    auth_header = request.headers.get('Authorization')
    if not auth_header:
        # For all other /api/ routes, an Authorization header is required
        if request.path.startswith('/api/'):
             return jsonify({"error": "Authorization header missing."}), 401
        return # Allow non-API routes (like '/') to proceed without auth

    try:
        id_token_str = auth_header.split(' ')[1]
        # Verify the ID token using Firebase Admin SDK
        decoded_token = auth.verify_id_token(id_token_str)
        g.user_id = decoded_token['uid']
        g.user_name = decoded_token.get('name', decoded_token.get('email', 'Anonymous'))
        print(f"User {g.user_id} authenticated.")
    except Exception as e:
        print(f"Token verification failed: {e}")
        return jsonify({"error": "Invalid or expired token.", "details": str(e)}), 401


@app.route('/api/update-profile', methods=['POST'])
def update_profile():
    """Updates the user's display name in Firebase Authentication and Firestore profile."""
    if not g.user_id:
        return jsonify({"error": "Authentication required."}), 401

    data = request.get_json()
    new_display_name = data.get('displayName')

    if not new_display_name or not new_display_name.strip():
        return jsonify({"error": "Display name cannot be empty."}), 400

    try:
        # Update display name in Firebase Authentication
        auth.update_user(g.user_id, display_name=new_display_name.strip())
        print(f"Firebase Auth profile updated for {g.user_id} to {new_display_name.strip()}")

        # Also update the user's profile document in Firestore
        user_profile_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{g.user_id}/profiles').document('userProfile')
        user_profile_ref.set({
            'displayName': new_display_name.strip(),
            'updatedAt': firestore.SERVER_TIMESTAMP
        }, merge=True)
        print(f"Firestore user profile updated for {g.user_id}")

        return jsonify({"message": "Profile updated successfully."}), 200
    except Exception as e:
        print(f"Error updating profile for {g.user_id}: {e}")
        return jsonify({"error": "Failed to update profile.", "details": str(e)}), 500


@app.route('/api/check-booked-slots', methods=['GET'])
def check_booked_slots():
    """Checks for booked slots on a given date."""
    if not db:
        return jsonify({"error": "Database not initialized."}), 500

    date_str = request.args.get('date')
    if not date_str:
        return jsonify({"error": "Date parameter is required."}), 400

    try:
        # Fetch public bookings for the given date
        bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
        query = bookings_ref.where('date', '==', date_str)
        docs = query.stream()

        booked_slots = []
        for doc in docs:
            booking_data = doc.to_dict()
            # Only consider confirmed/pending bookings that are not cancelled
            if booking_data.get('status') != 'cancelled':
                booked_slots.append({
                    'id': doc.id,
                    'date': booking_data.get('date'),
                    'time': booking_data.get('time'),
                    'duration': booking_data.get('duration'),
                    'userTimeZone': booking_data.get('userTimeZone', 'UTC') # Default to UTC if not specified
                })
        return jsonify({"bookedSlots": booked_slots}), 200
    except Exception as e:
        print(f"Error checking booked slots for date {date_str}: {e}")
        return jsonify({"error": "An internal error occurred while checking slots."}), 500


@app.route('/api/confirm-booking', methods=['POST'])
def confirm_booking():
    """Handles new booking creation and existing booking updates."""
    if not db or not calendar_service:
        return jsonify({"error": "Services not initialized."}), 500
    if not g.user_id:
        return jsonify({"error": "Authentication required."}), 401

    data = request.get_json()
    booking_data = data.get('bookingData')
    user_name = data.get('userName', 'Anonymous User') # Use authenticated user name
    editing_booking_id = data.get('editingBookingId')

    if not booking_data:
        return jsonify({"error": "Booking data is missing."}), 400

    # Validate required fields
    required_fields = ['date', 'time', 'duration', 'equipment', 'total', 'paymentMethod', 'paymentStatus', 'userTimeZone']
    if not all(field in booking_data for field in required_fields):
        return jsonify({"error": "Missing required booking data fields."}), 400

    try:
        # Create a timezone-aware datetime object for the booking start
        user_tz = pytz.timezone(booking_data['userTimeZone'])
        booking_start_dt = user_tz.localize(
            datetime.datetime.strptime(f"{booking_data['date']} {booking_data['time']}", "%Y-%m-%d %H:%M")
        )
        booking_end_dt = booking_start_dt + datetime.timedelta(hours=booking_data['duration'])

        # Convert to UTC for Google Calendar
        utc_booking_start = booking_start_dt.astimezone(pytz.utc)
        utc_booking_end = booking_end_dt.astimezone(pytz.utc)

        event_body = {
            'summary': f'DJ Studio Booking by {user_name}',
            'description': (
                f'Date: {booking_data["date"]}\n'
                f'Time: {booking_data["time"]} (Local Time)\n'
                f'Duration: {booking_data["duration"]} hours\n'
                f'Equipment: {", ".join([eq["name"] for eq in booking_data["equipment"]])}\n'
                f'Total: {booking_data["total"]}\n'
                f'Status: {booking_data["paymentStatus"]}\n'
                f'User ID: {g.user_id}'
            ),
            'start': {
                'dateTime': utc_booking_start.isoformat(),
                'timeZone': 'UTC',
            },
            'end': {
                'dateTime': utc_booking_end.isoformat(),
                'timeZone': 'UTC',
            },
            'attendees': [
                {'email': 'firebase-adminsdk-fbsvc@booking-app-1af02.iam.gserviceaccount.com', 'responseStatus': 'accepted'}, # Service account email
                # Add user's email if available and you want to invite them
            ],
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'email', 'minutes': 24 * 60}, # 24 hours before
                    {'method': 'popup', 'minutes': 60},     # 1 hour before
                ],
            },
            'conferenceData': {
                'createRequest': {
                    'requestId': f'booking-{g.user_id}-{datetime.datetime.now().timestamp()}'
                }
            }
        }

        calendar_id = os.environ.get('GOOGLE_CALENDAR_ID') # Ensure this env var is set on Render
        if not calendar_id:
            raise ValueError("GOOGLE_CALENDAR_ID environment variable is not set.")

        # Add common booking fields
        common_booking_fields = {
            'userId': g.user_id,
            'userName': user_name,
            'date': booking_data['date'],
            'time': booking_data['time'],
            'duration': booking_data['duration'],
            'equipment': booking_data['equipment'],
            'total': booking_data['total'],
            'paymentMethod': booking_data['paymentMethod'],
            'paymentStatus': booking_data['paymentStatus'],
            'userTimeZone': booking_data['userTimeZone'],
            'createdAt': firestore.SERVER_TIMESTAMP,
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'status': 'pending' # Default status
        }

        if editing_booking_id:
            # Update existing booking
            public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(editing_booking_id)
            user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{g.user_id}/bookings').document(editing_booking_id)

            # Get existing event ID
            existing_booking_snap = public_booking_ref.get()
            existing_booking_data = existing_booking_snap.to_dict()
            google_event_id = existing_booking_data.get('googleEventId')

            # Update Google Calendar event
            if google_event_id:
                updated_event = calendar_service.events().update(
                    calendarId=calendar_id, eventId=google_event_id, body=event_body
                ).execute()
                print(f"Google Calendar event updated: {updated_event.get('htmlLink')}")
                common_booking_fields['googleEventId'] = updated_event.get('id')
                common_booking_fields['googleEventLink'] = updated_event.get('htmlLink')
            else:
                # If no event ID, create a new one (shouldn't happen for updates, but as fallback)
                event = calendar_service.events().insert(
                    calendarId=calendar_id, body=event_body, conferenceDataVersion=1
                ).execute()
                print(f"New Google Calendar event created during update: {event.get('htmlLink')}")
                common_booking_fields['googleEventId'] = event.get('id')
                common_booking_fields['googleEventLink'] = event.get('htmlLink')

            public_booking_ref.update(common_booking_fields)
            user_booking_ref.update(common_booking_fields)
            booking_id = editing_booking_id
            print(f"Booking {booking_id} updated in Firestore.")
        else:
            # Create new booking
            # Add to public collection
            public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
            new_public_doc_ref = public_booking_ref.document() # Let Firestore generate ID
            booking_id = new_public_doc_ref.id # Get the ID for consistency

            # Create Google Calendar event
            event = calendar_service.events().insert(
                calendarId=calendar_id, body=event_body, conferenceDataVersion=1
            ).execute()
            print(f"Google Calendar event created: {event.get('htmlLink')}")

            common_booking_fields['googleEventId'] = event.get('id')
            common_booking_fields['googleEventLink'] = event.get('htmlLink')

            # Set data in both collections using the same generated ID
            new_public_doc_ref.set(common_booking_fields)
            db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{g.user_id}/bookings').document(booking_id).set(common_booking_fields)
            print(f"New booking {booking_id} created in Firestore.")

        # Send confirmation email
        send_booking_confirmation_email(
            to_email=request.args.get('email', g.user_id), # Use user's email if available, else user_id
            booking_details=booking_data,
            booking_id=booking_id,
            is_update=bool(editing_booking_id)
        )

        return jsonify({"message": "Booking confirmed successfully!", "bookingId": booking_id}), 200

    except ValueError as e:
        print(f"Validation Error in confirm_booking: {e}")
        return jsonify({"error": str(e)}), 400
    except HttpError as e:
        print(f"Google Calendar API Error: {e.content}")
        return jsonify({"error": "Failed to interact with Google Calendar.", "details": e.content.decode()}), 500
    except Exception as e:
        print(f"Error confirming booking: {e}")
        return jsonify({"error": "An internal error occurred.", "details": str(e)}), 500


@app.route('/api/cancel-booking', methods=['POST'])
def cancel_booking():
    """Cancels a booking by ID."""
    if not db or not calendar_service:
        return jsonify({"error": "Services not initialized."}), 500
    if not g.user_id:
        return jsonify({"error": "Authentication required."}), 401

    data = request.get_json()
    booking_id = data.get('bookingId')

    if not booking_id:
        return jsonify({"error": "Booking ID is required."}), 400

    try:
        # Get booking details to retrieve Google Calendar Event ID
        public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        booking_snap = public_booking_ref.get()

        if not booking_snap.exists:
            return jsonify({"error": "Booking not found."}), 404

        booking_data = booking_snap.to_dict()

        # Ensure the user has permission to cancel this booking
        if booking_data.get('userId') != g.user_id:
            return jsonify({"error": "Unauthorized to cancel this booking."}), 403

        # Delete from Google Calendar
        google_event_id = booking_data.get('googleEventId')
        calendar_id = os.environ.get('GOOGLE_CALENDAR_ID')
        if calendar_id and google_event_id:
            try:
                calendar_service.events().delete(calendarId=calendar_id, eventId=google_event_id).execute()
                print(f"Google Calendar event {google_event_id} deleted.")
            except HttpError as e:
                if e.resp.status == 404:
                    print(f"Google Calendar event {google_event_id} not found, likely already deleted.")
                else:
                    raise # Re-raise other HttpErrors
        else:
            print("No Google Calendar Event ID or Calendar ID found for this booking, skipping calendar deletion.")

        # Update status in Firestore (instead of direct delete, for history)
        update_data = {
            'status': 'cancelled',
            'cancelledAt': firestore.SERVER_TIMESTAMP
        }
        public_booking_ref.update(update_data)
        db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{g.user_id}/bookings').document(booking_id).update(update_data)

        print(f"Booking {booking_id} cancelled in Firestore.")
        return jsonify({"message": "Booking cancelled successfully."}), 200

    except Exception as e:
        print(f"Error cancelling booking {booking_id}: {e}")
        return jsonify({"error": "An internal error occurred.", "details": str(e)}), 500


@app.route('/api/confirm-payment', methods=['POST'])
def confirm_payment():
    """Confirms payment for a booking."""
    if not db:
        return jsonify({"error": "Database not initialized."}), 500
    if not g.user_id:
        return jsonify({"error": "Authentication required."}), 401

    data = request.get_json()
    booking_id = data.get('bookingId')

    if not booking_id:
        return jsonify({"error": "Booking ID is required."}), 400

    try:
        public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        booking_snap = public_booking_ref.get()

        if not booking_snap.exists:
            return jsonify({"error": "Booking not found."}), 404

        booking_data = booking_snap.to_dict()
        # Ensure the user confirming payment is the owner of the booking or an admin (if applicable)
        if booking_data.get('userId') != g.user_id:
            return jsonify({"error": "Unauthorized to confirm payment for this booking."}), 403

        if booking_data.get('paymentStatus') == 'paid':
            return jsonify({"message": "Payment already confirmed."}), 200

        # Update payment status in both collections
        update_data = {'paymentStatus': 'paid', 'paymentConfirmedAt': firestore.SERVER_TIMESTAMP}
        public_booking_ref.update(update_data)

        # Update user's private booking as well
        user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{g.user_id}/bookings').document(booking_id)
        user_booking_ref.update(update_data)

        print(f"Payment confirmed for booking {booking_id}.")
        # Send confirmation email to client (omitted for brevity)
        # ...
        send_booking_confirmation_email(
            to_email=request.args.get('email', g.user_id), # Use user's email if available, else user_id
            booking_details=booking_data,
            booking_id=booking_id,
            is_payment_confirmation=True
        )

        return jsonify({"message": "Payment confirmed successfully."}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in confirm_payment: {e}")
        return jsonify({"error": "An internal error occurred.", "details": str(e)}), 500


def send_booking_confirmation_email(to_email, booking_details, booking_id, is_update=False, is_payment_confirmation=False):
    """Sends a booking confirmation email."""
    if not app.config.get('MAIL_SERVER'):
        print("Email configuration missing. Skipping email send.")
        return

    subject = ""
    body = ""

    if is_payment_confirmation:
        subject = f"Payment Confirmed for Your DJ Studio Booking #{booking_id}"
        body = (
            f"Dear customer,\n\n"
            f"Your payment for booking #{booking_id} has been successfully confirmed.\n\n"
            f"Booking Details:\n"
            f"Date: {booking_details.get('date')}\n"
            f"Time: {booking_details.get('time')}\n"
            f"Duration: {booking_details.get('duration')} hours\n"
            f"Total: {booking_details.get('total')}\n"
            f"Payment Method: {booking_details.get('paymentMethod')}\n"
            f"Status: PAID\n\n"
            f"Thank you for your booking!\n"
            f"The DJ Studio Team"
        )
    elif is_update:
        subject = f"Your DJ Studio Booking #{booking_id} Has Been Updated"
        body = (
            f"Dear customer,\n\n"
            f"Your booking #{booking_id} has been successfully updated.\n\n"
            f"New Booking Details:\n"
            f"Date: {booking_details.get('date')}\n"
            f"Time: {booking_details.get('time')}\n"
            f"Duration: {booking_details.get('duration')} hours\n"
            f"Total: {booking_details.get('total')}\n"
            f"Payment Method: {booking_details.get('paymentMethod')}\n"
            f"Status: {booking_details.get('paymentStatus')}\n\n"
            f"Thank you for your booking!\n"
            f"The DJ Studio Team"
        )
    else:
        subject = f"Your DJ Studio Booking #{booking_id} Confirmation"
        body = (
            f"Dear customer,\n\n"
            f"Thank you for booking the DJ Studio! Your booking details are as follows:\n\n"
            f"Booking ID: {booking_id}\n"
            f"Date: {booking_details.get('date')}\n"
            f"Time: {booking_details.get('time')}\n"
            f"Duration: {booking_details.get('duration')} hours\n"
            f"Total: {booking_details.get('total')}\n"
            f"Payment Method: {booking_details.get('paymentMethod')}\n"
            f"Status: {booking_details.get('paymentStatus')}\n\n"
            f"We look forward to seeing you!\n"
            f"The DJ Studio Team"
        )

    try:
        msg = Message(
            subject,
            recipients=[to_email],
            body=body
        )
        mail.send(msg)
        print(f"Booking confirmation email sent to {to_email} for booking {booking_id}.")
    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")


if __name__ == '__main__':
    # Ensure all services are initialized before running the app
    if not db or not calendar_service or not firebase_admin_app:
        print("Required services (Firestore, Calendar, Firebase Admin) not initialized. Exiting.")
        exit(1) # Exit if critical services failed to initialize

    app.run(debug=True, port=os.environ.get("PORT", 5000))

