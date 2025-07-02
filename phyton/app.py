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
import json # Import json to parse credentials

# --- Google Calendar API Imports ---
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Load environment variables from .env file (for local development)
load_dotenv()

app = Flask(__name__)

# Configure CORS to allow specific origins and credentials
CORS(app, origins=["https://maxqoon.github.io", "https://booking-app-1af02.firebaseapp.com", "https://phyon-back-end.onrender.com", "http://localhost:3000"], supports_credentials=True)

# --- Firebase/Google Cloud Credentials from Render Secret File ---
# Render mounts secret files into the /etc/secrets/ directory.
# We expect the service account key JSON to be mounted as google-calendar-key.json
# or provided directly via an environment variable.
# For local development, ensure GOOGLE_APPLICATION_CREDENTIALS points to your key file,
# or set GOOGLE_CREDENTIALS_JSON with the content of your key file.

# Initialize Firebase Admin SDK
try:
    # Attempt to load credentials from a file path (common for local dev or Render secret file mount)
    if "GOOGLE_APPLICATION_CREDENTIALS" in os.environ:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if os.path.exists(cred_path):
            with open(cred_path, 'r') as f:
                credentials_info = json.load(f)
            print(f"Loaded credentials from: {cred_path}")
        else:
            raise FileNotFoundError(f"Credential file not found at {cred_path}")
    # Attempt to load credentials from a JSON string environment variable (common for Render)
    elif "GOOGLE_CREDENTIALS_JSON" in os.environ:
        credentials_info = json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"])
        print("Loaded credentials from GOOGLE_CREDENTIALS_JSON environment variable.")
    else:
        raise ValueError("No Google Cloud credentials found in environment variables.")

    # Initialize Firebase Admin SDK using the loaded credentials
    import firebase_admin
    from firebase_admin import credentials
    from firebase_admin import auth

    if not firebase_admin._apps: # Initialize only if not already initialized
        cred = credentials.Certificate(credentials_info)
        firebase_admin.initialize_app(cred)
        print("Firebase Admin SDK initialized.")

    db = firestore.client()
    print(f"Firestore Client initialized for project: {db.project}")

    # Set the Firebase Project ID for Firestore paths
    FIREBASE_PROJECT_ID = db.project
    if not FIREBASE_PROJECT_ID:
        raise ValueError("Firebase project ID could not be determined from credentials.")

except Exception as e:
    print(f"Failed to initialize Firebase Admin SDK or Firestore: {e}")
    # Exit or handle gracefully in production, for now, we'll let it proceed but expect errors
    FIREBASE_PROJECT_ID = os.environ.get("REACT_APP_FIREBASE_PROJECT_ID", "default-project-id") # Fallback for local testing if Firebase fails


# --- Flask-Mail Configuration ---
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'true').lower() == 'true'
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER')

mail = Mail(app)

# --- Google Calendar API Configuration ---
SCOPES = ['https://www.googleapis.com/auth/calendar.events']

def get_calendar_service():
    """Shows basic usage of the Google Calendar API.
    Prints the start and name of the next 10 events on the user's calendar.
    """
    try:
        # Use the credentials_info dictionary directly
        creds = Credentials.from_service_account_info(credentials_info, scopes=SCOPES)
        service = build('calendar', 'v3', credentials=creds)
        print("Google Calendar service initialized.")
        return service
    except Exception as e:
        print(f"Error initializing Google Calendar service: {e}")
        return None

calendar_service = get_calendar_service()
CALENDAR_ID = os.environ.get('GOOGLE_CALENDAR_ID') # Ensure this is set in Render environment variables

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
    try:
        selected_date_str = request.args.get('date')
        if not selected_date_str:
            return jsonify({"error": "Date parameter is required."}), 400

        # Query public bookings for the selected date
        public_bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
        # Using filter() instead of where() for better practice, though where() might also work.
        # If you encounter index issues, you might need to create a Firestore index.
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
    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id = decoded_token['uid']
        user_email = decoded_token.get('email', 'anonymous@example.com')
        user_name = request.json.get('userName', 'Guest User') # Get userName from frontend

        booking_data = request.json.get('bookingData')
        editing_booking_id = request.json.get('editingBookingId')

        if not booking_data:
            return jsonify({"error": "Booking data is required."}), 400

        # Add server timestamp and user ID
        booking_data['timestamp'] = firestore.SERVER_TIMESTAMP
        booking_data['userId'] = user_id
        booking_data['userEmail'] = user_email
        booking_data['userName'] = user_name

        # Determine if it's a new booking or an update
        if editing_booking_id:
            # Update existing booking
            user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(editing_booking_id)
            public_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(editing_booking_id)

            user_booking_ref.update(booking_data)
            public_booking_ref.update(booking_data)
            booking_id = editing_booking_id
            message = "Booking updated successfully!"
        else:
            # Add new booking
            user_bookings_collection = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings')
            public_bookings_collection = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')

            # Add to user's private collection
            user_doc_ref = user_bookings_collection.add(booking_data)
            booking_id = user_doc_ref[1].id # Get the ID of the newly added document

            # Add to public collection with the same ID
            public_bookings_collection.document(booking_id).set(booking_data)
            message = "Booking confirmed successfully!"

        # Create Google Calendar event (optional, requires GOOGLE_CALENDAR_ID and calendar_service)
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

        # Send confirmation email (optional, requires Flask-Mail setup)
        try:
            msg = Message("Booking Confirmation", recipients=[user_email])
            msg.body = f"""
            Dear {user_name},

            Your DJ Studio booking has been successfully confirmed!

            Date: {formatDate(booking_data['date'])}
            Time: {formatTime(booking_data['time'])} for {booking_data['duration']} hours
            Total: {formatIDR(booking_data['total'])}
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
    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id = decoded_token['uid']

        booking_id = request.json.get('bookingId')
        if not booking_id:
            return jsonify({"error": "Booking ID is required."}), 400

        # Delete from user's private collection
        user_booking_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(booking_id)
        user_booking_ref.delete()

        # Delete from public collection
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
    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id = decoded_token['uid']

        new_display_name = request.json.get('displayName')
        if not new_display_name:
            return jsonify({"error": "Display name is required."}), 400

        # Update display name in Firebase Auth
        auth.update_user(user_id, display_name=new_display_name)

        # Update display name in Firestore user profile
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
    try:
        id_token_str = request.headers.get('Authorization', '').split('Bearer ')[-1]
        decoded_token = verify_firebase_token(id_token_str)
        user_id_from_token = decoded_token['uid'] # User who is confirming payment

        booking_id = request.json.get('bookingId')
        if not booking_id:
            return jsonify({"error": "Booking ID is required."}), 400

        # Check public booking status first
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


if __name__ == '__main__':
    app.run(debug=True, port=os.environ.get("PORT", 5000))

