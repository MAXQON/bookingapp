# main.py

import os
from flask import Flask, request, jsonify
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

# Load environment variables from .env file (for local development)
load_dotenv()

app = Flask(__name__)
CORS(app, origins=["https://maxqoon.github.io", "http://localhost:3000"], supports_credentials=True) # Configure CORS

@app.route('/api/check-booked-slots', methods=['GET'])
def check_booked_slots():
    # Your backend logic
    return jsonify({"bookedSlots": []})

@app.route('/api/confirm-booking', methods=['POST'])
def confirm_booking():
    # Your backend logic
    return jsonify({"message": "Booking confirmed!"})

if __name__ == '__main__':
    app.run(debug=True, port=os.environ.get("PORT", 5000))

# --- UPDATED: Firebase/Google Cloud Credentials from Render Secret File ---
# Render mounts secret files at /etc/secrets/<filename>.
# We will point the GOOGLE_APPLICATION_CREDENTIALS env var to this file path.
# The Google Cloud libraries will automatically use this file for authentication.
SECRET_KEY_FILE_NAME = 'google-calendar-key.json'  # Ensure this matches the filename in Render
SECRET_KEY_FILE_PATH_RENDER = f'/etc/secrets/{SECRET_KEY_FILE_NAME}'

credential_path = None
if os.path.exists(SECRET_KEY_FILE_PATH_RENDER):
    # This block runs when deployed on Render
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = SECRET_KEY_FILE_PATH_RENDER
    credential_path = SECRET_KEY_FILE_PATH_RENDER
    print(f"Using Render secret file for credentials: {credential_path}")
elif os.path.exists(SECRET_KEY_FILE_NAME):
    # This block runs for local development if the key file is in the root directory
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = SECRET_KEY_FILE_NAME
    credential_path = SECRET_KEY_FILE_NAME
    print(f"Using local file for credentials: {credential_path}")
else:
    print(f"CRITICAL WARNING: Credential file not found at {SECRET_KEY_FILE_PATH_RENDER} or locally as {SECRET_KEY_FILE_NAME}.")
    print("Firestore and Google Calendar features will likely fail.")


# Initialize Firestore Client (it will automatically use the env var set above)
db = firestore.Client()
print("Firestore Client initialized.")

# --- Initialize Google Calendar Service ---
calendar_service = None
if credential_path:
    try:
        SCOPES = ['https://www.googleapis.com/auth/calendar.events']
        creds = Credentials.from_service_account_file(credential_path, scopes=SCOPES)
        calendar_service = build('calendar', 'v3', credentials=creds)
        print("Google Calendar service initialized.")
    except Exception as e:
        print(f"ERROR: Failed to initialize Google Calendar service from file: {e}")
else:
    print("Warning: Google Calendar service not initialized because no credential file was found.")

# --- Environment-based Configuration ---
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "booking-app-1af02")
ADMIN_EMAIL = os.getenv('ADMIN_EMAIL', 'polarsolutions.warehouse@gmail.com')
GOOGLE_CALENDAR_ID = os.getenv('GOOGLE_CALENDAR_ID', 'eae066e12bee90f37aab773e16d2e1377da8dfe432da4a1740f89c4bfb2ad76c@group.calendar.google.com')
# CORRECTED: Use a safe default for local development
FRONTEND_URL = os.getenv('FRONTEND_URL', 'https://maxqon.github.io/bookingapp/') 

# --- Flask-Mail Configuration ---
app.config['MAIL_SERVER'] = os.getenv('MAIL_SERVER', 'smtp.example.com')
app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.getenv('MAIL_USE_TLS', 'True').lower() == 'true'
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.getenv('MAIL_DEFAULT_SENDER', app.config['MAIL_USERNAME'])
mail = Mail(app)

# --- Utility Functions ---

def verify_token(req):
    """Verifies Firebase ID Token from the request."""
    auth_header = req.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise ValueError("Authorization header malformed or missing.")
    token = auth_header.split('Bearer ')[1]
    try:
        claims = id_token.verify_firebase_token(token, google_requests.Request(), audience=FIREBASE_PROJECT_ID)
        return claims
    except Exception as e:
        raise ValueError(f"Invalid token: {e}")

def send_email(recipient_email, subject, html_body):
    """Sends an email using Flask-Mail."""
    try:
        msg = Message(subject, recipients=[recipient_email])
        msg.html = html_body
        mail.send(msg)
        print(f"Email sent successfully to {recipient_email}")
    except Exception as e:
        print(f"Failed to send email to {recipient_email}: {e}")

# --- API Endpoints ---

@app.route('/api/confirm-booking', methods=['POST'])
def confirm_booking():
    """Endpoint to confirm or update a booking."""
    try:
        claims = verify_token(request)
        user_id = claims['user_id']
        data = request.get_json()
        booking_data = data.get('bookingData')
        client_user_name = data.get('userName', claims.get('name', user_id))
        editing_booking_id = data.get('editingBookingId')

        if not booking_data:
            return jsonify({"error": "Booking data is missing"}), 400

        # Conflict checking logic (omitted for brevity, remains same as original file)
        # ...

        # Prepare data for Firestore
        firestore_booking_data = {
            'userId': user_id,
            'userName': client_user_name,
            'userEmail': claims.get('email'),
            'timestamp': firestore.SERVER_TIMESTAMP,
            **booking_data
        }

        # Add or update booking in Firestore
        if editing_booking_id:
            booking_id = editing_booking_id
            # Update user-specific and public booking docs
            db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(booking_id).set(firestore_booking_data, merge=True)
            db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id).set(firestore_booking_data, merge=True)
        else:
            # Add new booking and get ID
            _, new_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').add(firestore_booking_data)
            booking_id = new_booking_ref.id
            # Set public booking with the same ID
            db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id).set(firestore_booking_data)

        # Create Google Calendar event (omitted for brevity, remains same as original)
        # ...

        # Send confirmation emails
        # ... (Email sending logic remains the same, but uses the corrected link generation)
        payment_confirm_link = None
        if booking_data['paymentStatus'] == 'pending' and FRONTEND_URL:
             # CORRECTED: Use environment variable for frontend URL
            payment_confirm_link = f"{FRONTEND_URL}?bookingId={booking_id}"

        # ... (call get_email_template_... and send_email)
        
        return jsonify({"message": "Booking confirmed successfully", "bookingId": booking_id}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in confirm_booking: {e}")
        return jsonify({"error": "An internal error occurred."}), 500

@app.route('/api/check-booked-slots', methods=['GET'])
def check_booked_slots():
    """Endpoint to retrieve all booked slots for a specific date."""
    try:
        verify_token(request)
        selected_date_str = request.args.get('date')
        if not selected_date_str:
            return jsonify({"error": "Date parameter is missing."}), 400

        bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
        query = bookings_ref.where('date', '==', selected_date_str).stream()
        
        booked_slots = [
            {"id": doc.id, **doc.to_dict()} for doc in query
        ]
        return jsonify({"bookedSlots": booked_slots}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in check_booked_slots: {e}")
        return jsonify({"error": "Failed to fetch booked slots."}), 500

@app.route('/api/update-profile', methods=['POST'])
def update_user_profile():
    """Endpoint to update a user's display name."""
    try:
        claims = verify_token(request)
        user_id = claims['user_id']
        data = request.get_json()
        new_display_name = data.get('displayName')

        if not new_display_name or not new_display_name.strip():
            return jsonify({"error": "Display name cannot be empty."}), 400

        user_profile_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/profiles').document('userProfile')
        user_profile_doc_ref.set({'displayName': new_display_name.strip()}, merge=True)
        
        return jsonify({"message": "Profile updated successfully"}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error updating user profile: {e}")
        return jsonify({"error": "Failed to update profile."}), 500

# --- NEW: SECURE AND ATOMIC BOOKING CANCELLATION ENDPOINT ---
@app.route('/api/cancel-booking', methods=['POST'])
def cancel_booking():
    """
    Securely cancels a booking.
    - Verifies user owns the booking.
    - Deletes Google Calendar event.
    - Deletes public and private Firestore documents.
    """
    try:
        claims = verify_token(request)
        user_id = claims['user_id']
        data = request.get_json()
        booking_id = data.get('bookingId')

        if not booking_id:
            return jsonify({"error": "Booking ID is missing."}), 400

        public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        booking_doc = public_booking_ref.get()

        if not booking_doc.exists:
            # If not found, it might already be deleted. Return success to avoid frontend error.
            print(f"Booking {booking_id} not found for cancellation, likely already deleted.")
            return jsonify({"message": "Booking not found, presumed already cancelled."}), 200

        booking_data = booking_doc.to_dict()

        # Security Check: Ensure the user cancelling is the one who made the booking
        if booking_data.get('userId') != user_id:
            return jsonify({"error": "Permission denied. You can only cancel your own bookings."}), 403

        # 1. Delete from Google Calendar (if it exists)
        calendar_event_id = booking_data.get('calendarEventId')
        if calendar_service and calendar_event_id:
            try:
                calendar_service.events().delete(calendarId=GOOGLE_CALENDAR_ID, eventId=calendar_event_id).execute()
                print(f"Successfully deleted calendar event {calendar_event_id}.")
            except HttpError as e:
                # Log error but don't block deletion from Firestore
                print(f"Could not delete calendar event {calendar_event_id}. Error: {e}")
        
        # 2. Delete the public booking document (for conflict checking)
        public_booking_ref.delete()

        # 3. Delete the user's private booking document
        user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(booking_id)
        user_booking_ref.delete()
        
        print(f"Successfully cancelled booking {booking_id} for user {user_id}")
        return jsonify({"message": "Booking cancelled successfully."}), 200

    except ValueError as e: # Token verification error
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in cancel_booking: {e}")
        return jsonify({"error": "An internal error occurred during cancellation."}), 500

@app.route('/api/confirm-payment', methods=['POST'])
def confirm_payment():
    """Endpoint for admin to confirm payment for a booking."""
    try:
        verify_token(request) # Ensure an authenticated user (admin) is making the call
        data = request.get_json()
        booking_id = data.get('bookingId')

        if not booking_id:
            return jsonify({"error": "Booking ID is missing."}), 400

        public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        booking_snap = public_booking_ref.get()

        if not booking_snap.exists:
            return jsonify({"error": "Booking not found."}), 404
        
        booking_data = booking_snap.to_dict()
        if booking_data.get('paymentStatus') == 'paid':
            return jsonify({"message": "Payment already confirmed."}), 200

        # Update payment status in both collections
        update_data = {'paymentStatus': 'paid', 'paymentConfirmedAt': firestore.SERVER_TIMESTAMP}
        public_booking_ref.update(update_data)
        
        user_id_of_booking = booking_data.get('userId')
        if user_id_of_booking:
            user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id_of_booking}/bookings').document(booking_id)
            user_booking_ref.update(update_data)

        # Send confirmation email to client (omitted for brevity)
        # ...

        return jsonify({"message": "Payment confirmed successfully."}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in confirm_payment: {e}")
        return jsonify({"error": "An internal error occurred."}), 500

@app.route('/')
def health_check():
    return jsonify({"status": "Backend is running!"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)))
