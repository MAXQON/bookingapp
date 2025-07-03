# main.py

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from google.cloud import firestore # This is the correct import for firestore client
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
import datetime
import pytz
from flask_mail import Mail, Message
from dotenv import load_dotenv
import json

# --- Google Calendar API Imports ---
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Import firebase_admin and its modules
import firebase_admin
from firebase_admin import credentials, auth

# Load environment variables from .env file (for local development)
load_dotenv()

app = Flask(__name__)

# Configure CORS to allow specific origins and credentials
CORS(app, origins=["https://maxqoon.github.io", "http://localhost:3000"], supports_credentials=True)

# Global variables for Firebase and Calendar services, initialized to None
db = None
FIREBASE_PROJECT_ID = None
calendar_service = None
CALENDAR_ID = os.environ.get('GOOGLE_CALENDAR_ID')

# --- Firebase/Google Cloud Credentials Initialization ---
credentials_info = None
try:
    if "GOOGLE_CREDENTIALS_JSON" in os.environ:
        credentials_info = json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"])
        print("Loaded Google Cloud credentials from GOOGLE_CREDENTIALS_JSON environment variable.")
    elif "GOOGLE_APPLICATION_CREDENTIALS" in os.environ:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if os.path.exists(cred_path):
            with open(cred_path, 'r') as f:
                credentials_info = json.load(f)
            print(f"Loaded Google Cloud credentials from file: {cred_path}")
        else:
            print(f"Warning: GOOGLE_APPLICATION_CREDENTIALS path '{cred_path}' does not exist.")
    else:
        print("Warning: No Google Cloud credentials environment variables found (GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS).")

    if credentials_info:
        if not firebase_admin._apps: # Initialize Firebase Admin SDK only if not already initialized
            cred = credentials.Certificate(credentials_info)
            firebase_admin.initialize_app(cred)
            print("Firebase Admin SDK initialized.")

        # Attempt to initialize Firestore client
        try:
            # This is the standard way. The error indicates 'Client' attribute is missing,
            # which is strange as 'client()' is a method.
            # Adding a fallback to firestore.Client() if firestore.client is truly missing
            # though this is highly unlikely for recent google-cloud-firestore versions.
            if hasattr(firestore, 'client') and callable(firestore.client):
                db = firestore.client()
                print("Firestore client initialized using firestore.client().")
            elif hasattr(firestore, 'Client'): # Fallback for a very old or unusual version
                db = firestore.Client()
                print("Firestore client initialized using firestore.Client(). (Unconventional)")
            else:
                raise AttributeError("Neither firestore.client() nor firestore.Client() found.")

            FIREBASE_PROJECT_ID = db.project
            if not FIREBASE_PROJECT_ID:
                raise ValueError("Firebase project ID could not be determined from Firestore client.")
            print(f"Firestore Client initialized for project: {FIREBASE_PROJECT_ID}")

        except Exception as e:
            print(f"ERROR: Failed to initialize Firestore client: {e}")
            db = None # Ensure db is None if initialization fails

        # Initialize Google Calendar service
        try:
            creds_calendar = Credentials.from_service_account_info(credentials_info, scopes=SCOPES)
            calendar_service = build('calendar', 'v3', credentials=creds_calendar)
            print("Google Calendar service initialized.")
        except Exception as e:
            print(f"Error initializing Google Calendar service: {e}")
    else:
        print("Firebase Admin SDK and Google Calendar service not initialized due to missing credentials.")

except Exception as e:
    print(f"CRITICAL ERROR: Failed during initial credential loading or Firebase/Firestore setup: {e}")
    # Set db and FIREBASE_PROJECT_ID to None if initialization fails
    db = None
    FIREBASE_PROJECT_ID = None


# --- Flask-Mail Configuration ---
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'true').lower() == 'true'
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER')

mail = Mail(app)

# --- Helper function to verify Firebase ID Token ---
def verify_firebase_token(id_token_str):
    try:
        # Verify the ID token while checking that the token is not revoked and
        # that its auth_time is not older than 5 minutes.
        decoded_token = auth.verify_id_token(id_token_str, check_revoked=True)
        return decoded_token
    except ValueError as e:
        raise ValueError(f"Invalid ID token: {e}")
    except Exception as e:
        raise Exception(f"Firebase authentication error: {e}")

# --- API Endpoints ---

@app.route('/api/check-booked-slots', methods=['GET'])
def check_booked_slots():
    # Ensure db is initialized before proceeding
    if db is None or FIREBASE_PROJECT_ID is None:
        print("Backend services not initialized for check_booked_slots.")
        return jsonify({"error": "Backend services not initialized. Please check server logs for Firebase/Firestore errors."}), 500
    
    try:
        selected_date_str = request.args.get('date')
        if not selected_date_str:
            return jsonify({"error": "Date parameter is required."}), 400

        # Query public bookings for the selected date
        public_bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
        docs = public_bookings_ref.where('date', '==', selected_date_str).stream()

        booked_slots = []
        for doc in docs:
            booking_data = doc.to_dict()
            booked_slots.append({
                "id": doc.id,
                "date": booking_data.get("date"),
                "time": booking_data.get("time"),
                "duration": booking_data.get("duration")
            })
        return jsonify({"bookedSlots": booked_slots}), 200
    except Exception as e:
        print(f"Error checking booked slots: {e}")
        return jsonify({"error": "An internal error occurred while checking slots."}), 500


@app.route('/api/confirm-booking', methods=['POST'])
def confirm_booking():
    # Ensure db is initialized before proceeding
    if db is None or FIREBASE_PROJECT_ID is None:
        print("Backend services not initialized for confirm_booking.")
        return jsonify({"error": "Backend services not initialized. Please check server logs for Firebase/Firestore errors."}), 500

    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id = decoded_token['uid']
        user_email = decoded_token.get('email', 'anonymous@example.com')
        user_name = request.json.get('userName', 'Guest User')

        booking_data = request.json.get('bookingData')
        editing_booking_id = request.json.get('editingBookingId')

        if not booking_data:
            return jsonify({"error": "Booking data is required."}), 400

        booking_data['timestamp'] = firestore.SERVER_TIMESTAMP
        booking_data['userId'] = user_id
        booking_data['userEmail'] = user_email
        booking_data['userName'] = user_name

        if editing_booking_id:
            user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(editing_booking_id)
            public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(editing_booking_id)

            user_booking_ref.update(booking_data)
            public_booking_ref.update(booking_data)
            booking_id = editing_booking_id
            message = "Booking updated successfully!"
        else:
            user_bookings_collection = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings')
            public_bookings_collection = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')

            user_doc_ref = user_bookings_collection.add(booking_data)
            booking_id = user_doc_ref[1].id

            public_bookings_collection.document(booking_id).set(booking_data)
            message = "Booking confirmed successfully!"

        if calendar_service and CALENDAR_ID:
            try:
                start_time_str = f"{booking_data['date']}T{booking_data['time']}:00"
                end_time_obj = datetime.datetime.strptime(start_time_str, "%Y-%m-%dT%H:%M:%S") + datetime.timedelta(hours=booking_data['duration'])
                end_time_str = end_time_obj.strftime("%Y-%m-%dT%H:%M:%S")

                event = {
                    'summary': f'DJ Studio Booking - {user_name}',
                    'description': f'Booked by: {user_email}\nTotal: {booking_data["total"]}\nEquipment: {", ".join([eq["name"] for eq in booking_data["equipment"]])}',
                    'start': {
                        'dateTime': start_time_str,
                        'timeZone': booking_data.get('userTimeZone', 'UTC'),
                    },
                    'end': {
                        'dateTime': end_time_str,
                        'timeZone': booking_data.get('userTimeZone', 'UTC'),
                    },
                    'attendees': [
                        {'email': user_email},
                    ],
                    'reminders': {
                        'useDefault': False,
                        'overrides': [
                            {'method': 'email', 'minutes': 24 * 60},
                            {'method': 'popup', 'minutes': 10},
                        ],
                    },
                }
                event = calendar_service.events().insert(calendarId=CALENDAR_ID, body=event).execute()
                print(f"Event created: {event.get('htmlLink')}")
            except HttpError as error:
                print(f"An error occurred with Google Calendar: {error}")
            except Exception as e:
                print(f"Error creating Google Calendar event: {e}")

        try:
            # Define local formatting functions for email if not imported globally
            def format_idr_local(amount):
                return f"Rp {amount:,.0f}".replace(",", ".")

            def format_date_local(date_str):
                return datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%A, %B %d, %Y")

            def format_time_local(time_str):
                return datetime.datetime.strptime(time_str, "%H:%M").strftime("%I:%M %p")

            msg = Message("Booking Confirmation", recipients=[user_email])
            msg.body = f"""
            Dear {user_name},

            Your DJ Studio booking has been successfully confirmed!

            Date: {format_date_local(booking_data['date'])}
            Time: {format_time_local(booking_data['time'])} for {booking_data['duration']} hours
            Total: {format_idr_local(booking_data['total'])}
            Payment Method: {booking_data['paymentMethod']}
            Status: {booking_data['paymentStatus']}

            Thank you for choosing POLAR SHOWROOM.

            Best regards,
            The POLAR SHOWROOM Team
            """
            mail.send(msg)
            print(f"Confirmation email sent to {user_email}")
        except Exception as e:
            print(f"Error sending email: {e}")

        return jsonify({"message": message, "bookingId": booking_id}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in confirm_booking: {e}")
        return jsonify({"error": "An internal error occurred."}), 500


@app.route('/api/cancel-booking', methods=['POST'])
def cancel_booking():
    # Ensure db is initialized before proceeding
    if db is None or FIREBASE_PROJECT_ID is None:
        print("Backend services not initialized for cancel_booking.")
        return jsonify({"error": "Backend services not initialized. Please check server logs for Firebase/Firestore errors."}), 500

    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id = decoded_token['uid']

        booking_id = request.json.get('bookingId')
        if not booking_id:
            return jsonify({"error": "Booking ID is required."}), 400

        user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(booking_id)
        user_booking_ref.delete()

        public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        public_booking_ref.delete()

        return jsonify({"message": "Booking cancelled successfully."}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in cancel_booking: {e}")
        return jsonify({"error": "An internal error occurred."}), 500

@app.route('/api/update-profile', methods=['POST'])
def update_profile():
    # Ensure db is initialized before proceeding
    if db is None or FIREBASE_PROJECT_ID is None:
        print("Backend services not initialized for update_profile.")
        return jsonify({"error": "Backend services not initialized. Please check server logs for Firebase/Firestore errors."}), 500

    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id = decoded_token['uid']

        new_display_name = request.json.get('displayName')
        if not new_display_name:
            return jsonify({"error": "Display name is required."}), 400

        auth.update_user(user_id, display_name=new_display_name)

        user_profile_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/profiles').document('userProfile')
        user_profile_ref.set({'displayName': new_display_name}, merge=True)

        return jsonify({"message": "Profile updated successfully."}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in update_profile: {e}")
        return jsonify({"error": "An internal error occurred."}), 500

@app.route('/api/confirm-payment', methods=['POST'])
def confirm_payment():
    # Ensure db is initialized before proceeding
    if db is None or FIREBASE_PROJECT_ID is None:
        print("Backend services not initialized for confirm_payment.")
        return jsonify({"error": "Backend services not initialized. Please check server logs for Firebase/Firestore errors."}), 500

    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id_from_token = decoded_token['uid']

        booking_id = request.json.get('bookingId')
        if not booking_id:
            return jsonify({"error": "Booking ID is required."}), 400

        public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        booking_snap = public_booking_ref.get()

        if not booking_snap.exists:
            return jsonify({"error": "Booking not found."}), 404
        
        booking_data = booking_snap.to_dict()
        if booking_data.get('paymentStatus') == 'paid':
            return jsonify({"message": "Payment already confirmed."}), 200

        update_data = {'paymentStatus': 'paid', 'paymentConfirmedAt': firestore.SERVER_TIMESTAMP}
        public_booking_ref.update(update_data)
        
        user_id_of_booking = booking_data.get('userId')
        if user_id_of_booking:
            user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id_of_booking}/bookings').document(booking_id)
            user_booking_ref.update(update_data)

        return jsonify({"message": "Payment confirmed successfully."}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in confirm_payment: {e}")
        return jsonify({"error": "An internal error occurred."}), 500


if __name__ == '__main__':
    app.run(debug=True, port=os.environ.get("PORT", 5000))
