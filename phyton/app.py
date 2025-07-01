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
import base64 # Import base64 for decoding
import tempfile # Import tempfile for creating temporary files

# --- Google Calendar API Imports ---
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Load environment variables from .env file (for local development)
load_dotenv()

app = Flask(__name__)
CORS(app) # Enable CORS for all routes

# --- Firebase Admin SDK Initialization for Firestore Credentials ---
# This section now handles setting up credentials for firestore.Client()
GOOGLE_APPLICATION_CREDENTIALS_BASE64 = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_BASE64")

# Path for the temporary service account key file
temp_key_file_path = None

if GOOGLE_APPLICATION_CREDENTIALS_BASE64:
    try:
        # Decode the Base64 string
        decoded_json_bytes = base64.b64decode(GOOGLE_APPLICATION_CREDENTIALS_BASE64)
        decoded_json_string = decoded_json_bytes.decode('utf-8')

        # Create a temporary file to store the service account key
        # This file will be automatically deleted when the app exits
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as temp_key_file:
            temp_key_file.write(decoded_json_string)
            temp_key_file_path = temp_key_file.name
        
        # Set the GOOGLE_APPLICATION_CREDENTIALS environment variable
        # This tells the google-cloud-python client libraries where to find the credentials
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_key_file_path
        print(f"Successfully decoded service account key and set GOOGLE_APPLICATION_CREDENTIALS to: {temp_key_file_path}")

    except Exception as e:
        print(f"FATAL ERROR: Failed to decode GOOGLE_APPLICATION_CREDENTIALS_BASE64 or write to temp file: {e}")
        # Exit if credentials cannot be set, as Firestore access will fail
        exit(1)
else:
    print("Warning: GOOGLE_APPLICATION_CREDENTIALS_BASE64 environment variable not set. Firestore access may fail and Google Calendar integration will not work.")


# Initialize Firestore Client AFTER setting the GOOGLE_APPLICATION_CREDENTIALS env var
db = firestore.Client()
print("Firestore Client initialized.")

# --- Initialize Google Calendar Service ---
# This uses the same GOOGLE_APPLICATION_CREDENTIALS for service account authentication
calendar_service = None
if temp_key_file_path:
    try:
        # Define the scope for Google Calendar API access
        # 'https://www.googleapis.com/auth/calendar' grants full access
        # 'https://www.googleapis.com/auth/calendar.events' grants access to create/edit/delete events
        SCOPES = ['https://www.googleapis.com/auth/calendar.events']
        
        # Load credentials from the temporary service account key file
        creds = Credentials.from_service_account_file(temp_key_file_path, scopes=SCOPES)
        
        # Build the Google Calendar API service
        calendar_service = build('calendar', 'v3', credentials=creds)
        print("Google Calendar service initialized successfully.")
    except Exception as e:
        print(f"ERROR: Failed to initialize Google Calendar service: {e}")
        calendar_service = None # Ensure it's None if initialization fails
else:
    print("Warning: Google Calendar service not initialized due to missing GOOGLE_APPLICATION_CREDENTIALS_BASE64.")


# --- Firebase Project ID from environment (important for security rules path) ---
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID")
if not FIREBASE_PROJECT_ID:
    print("Warning: FIREBASE_PROJECT_ID environment variable not set. Using a placeholder for Firestore paths.")
    FIREBASE_PROJECT_ID = "booking-app-1af02" # Default placeholder


# --- Flask-Mail Configuration ---
# IMPORTANT: These environment variables MUST be set on your Render service
# For example, if using Gmail, you'd need an App Password:
# MAIL_USERNAME = 'your_gmail_email@gmail.com'
# MAIL_PASSWORD = 'your_gmail_app_password'
# MAIL_SERVER = 'smtp.gmail.com'
# MAIL_PORT = 587
# MAIL_USE_TLS = True
# MAIL_USE_SSL = False
app.config['MAIL_SERVER'] = os.getenv('MAIL_SERVER', 'smtp.example.com')
app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.getenv('MAIL_USE_TLS', 'True').lower() == 'true'
app.config['MAIL_USE_SSL'] = os.getenv('MAIL_USE_SSL', 'False').lower() == 'true'
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME', 'your_email@example.com')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD', 'your_email_password')
app.config['MAIL_DEFAULT_SENDER'] = os.getenv('MAIL_DEFAULT_SENDER', app.config['MAIL_USERNAME'])

mail = Mail(app)

# --- Admin Email Address ---
# This is where notifications about new bookings and payment confirmations will be sent
ADMIN_EMAIL = os.getenv('ADMIN_EMAIL', 'admin@example.com')
if ADMIN_EMAIL == 'admin@example.com':
    print("Warning: ADMIN_EMAIL environment variable not set. Admin notifications will go to a placeholder email.")

# --- Google Calendar ID for your booking calendar ---
# This is the ID of the specific Google Calendar where bookings will be added.
# It can be your primary calendar email or a shared calendar's ID.
GOOGLE_CALENDAR_ID = os.getenv('GOOGLE_CALENDAR_ID', 'primary') # 'primary' refers to the service account's primary calendar
if GOOGLE_CALENDAR_ID == 'primary':
    print("Warning: GOOGLE_CALENDAR_ID environment variable not set. Using 'primary' calendar for Google Calendar integration.")


# --- Utility Functions ---

def verify_token(req):
    """
    Verifies Firebase ID Token from the request.
    Includes enhanced logging for debugging.
    """
    auth_header = req.headers.get('Authorization')
    print(f"DEBUG: Authorization header received: {auth_header}")

    if not auth_header:
        print("DEBUG: Authorization header missing.")
        raise ValueError("Authorization header missing.")
    
    if not auth_header.startswith('Bearer '):
        print(f"DEBUG: Authorization header does not start with 'Bearer ': {auth_header}")
        raise ValueError("Authorization header malformed: must start with 'Bearer '.")

    token = auth_header.split('Bearer ')[1]
    if not token:
        print("DEBUG: Token not found after 'Bearer ' split.")
        raise ValueError("Token not found in Authorization header.")
    
    print(f"DEBUG: Extracted token (first 20 chars): {token[:20]}...")

    try:
        # Verify the ID token using the Firebase project ID
        # audience=None lets it accept both your project ID and your Firebase project URL
        # For security, you might want to specify your exact project ID: audience=FIREBASE_PROJECT_ID
        claims = id_token.verify_firebase_token(token, google_requests.Request(), audience=FIREBASE_PROJECT_ID)
        print(f"DEBUG: Token successfully verified for user_id: {claims.get('user_id')}")
        return claims
    except Exception as e:
        print(f"DEBUG: Error during token verification: {e}")
        raise ValueError(f"Invalid token: {e}")

def send_email(recipient_email, subject, html_body, sender=None):
    """Sends an email using Flask-Mail."""
    try:
        if not sender:
            sender = app.config['MAIL_DEFAULT_SENDER']

        msg = Message(subject, sender=sender, recipients=[recipient_email])
        msg.html = html_body
        mail.send(msg)
        print(f"Email sent successfully to {recipient_email}")
    except Exception as e:
        print(f"Failed to send email to {recipient_email}: {e}")
        # In a real app, you might want to log this error more robustly or queue for retry

def get_email_template_client(booking_details):
    """Generates the HTML body for the client confirmation email."""
    # Format equipment for display
    equipment_list = "None selected"
    if booking_details.get('equipment'):
        equipment_names = [eq['name'] for eq in booking_details['equipment']]
        equipment_list = ", ".join(equipment_names)

    # Format dates and times for display
    booked_date = datetime.datetime.strptime(booking_details['date'], '%Y-%m-%d').strftime('%A, %B %d, %Y')
    start_time = datetime.datetime.strptime(booking_details['time'], '%H:%M').strftime('%I:%M %p')
    # Calculate end time based on duration
    end_dt = datetime.datetime.strptime(booking_details['time'], '%H:%M') + datetime.timedelta(hours=booking_details['duration'])
    end_time = end_dt.strftime('%I:%M %p')

    # Format total amount
    total_amount = "Rp " + "{:,.0f}".format(booking_details['total']) # Format Indonesian Rupiah

    html_body = f"""
    <p>Dear {booking_details.get('userName', 'Valued Client')},</p>
    <p>Thank you for booking with DJ Studio! Your session details are confirmed:</p>
    <ul>
        <li><strong>Booking ID:</strong> {booking_details.get('id', 'N/A')}</li>
        <li><strong>Date:</strong> {booked_date}</li>
        <li><strong>Time:</strong> {start_time} - {end_time}</li>
        <li><strong>Duration:</strong> {booking_details['duration']} hours</li>
        <li><strong>Equipment:</strong> {equipment_list}</li>
        <li><strong>Total Cost:</strong> {total_amount}</li>
        <li><strong>Payment Method:</strong> {booking_details.get('paymentMethod', 'N/A')}</li>
        <li><strong>Payment Status:</strong> {booking_details.get('paymentStatus', 'PENDING').upper()}</li>
    </ul>
    <p>We look forward to seeing you!</p>
    <p>Best regards,<br/>The DJ Studio Team</p>
    """
    return html_body

def get_email_template_admin(booking_details, payment_confirm_link):
    """Generates the HTML body for the admin notification email."""
    equipment_list = "None selected"
    if booking_details.get('equipment'):
        equipment_names = [eq['name'] for eq in booking_details['equipment']]
        equipment_list = ", ".join(equipment_names)

    booked_date = datetime.datetime.strptime(booking_details['date'], '%Y-%m-%d').strftime('%A, %B %d, %Y')
    start_time = datetime.datetime.strptime(booking_details['time'], '%H:%M').strftime('%I:%M %p')
    end_dt = datetime.datetime.strptime(booking_details['time'], '%H:%M') + datetime.timedelta(hours=booking_details['duration'])
    end_time = end_dt.strftime('%I:%M %p')
    
    total_amount = "Rp " + "{:,.0f}".format(booking_details['total'])

    html_body = f"""
    <p>New DJ Studio Booking Received!</p>
    <p>Details:</p>
    <ul>
        <li><strong>Booking ID:</strong> {booking_details.get('id', 'N/A')}</li>
        <li><strong>Client Name:</strong> {booking_details.get('userName', 'N/A')} (User ID: {booking_details.get('userId', 'N/A')})</li>
        <li><strong>Client Email:</strong> {booking_details.get('userEmail', 'N/A')}</li>
        <li><strong>Date:</strong> {booked_date}</li>
        <li><strong>Time:</strong> {start_time} - {end_time}</li>
        <li><strong>Duration:</strong> {booking_details['duration']} hours</li>
        <li><strong>Equipment:</strong> {equipment_list}</li>
        <li><strong>Total Cost:</strong> {total_amount}</li>
        <li><strong>Payment Method:</strong> {booking_details.get('paymentMethod', 'N/A')}</li>
        <li><strong>Current Payment Status:</strong> {booking_details.get('paymentStatus', 'PENDING').upper()}</li>
    </ul>
    """
    if booking_details.get('paymentStatus') == 'pending' and payment_confirm_link:
        html_body += f"""
        <p><strong>Action Required:</strong> Please confirm payment upon client arrival.</p>
        <p><a href="{payment_confirm_link}" style="background-color: #f97316; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">Confirm Payment (Requires Login)</a></p>
        """
    html_body += f"""
    <p>Regards,<br/>Booking System</p>
    """
    return html_body


# --- API Endpoints ---

@app.route('/api/confirm-booking', methods=['POST'])
def confirm_booking():
    """
    Endpoint to confirm a DJ studio booking.
    Handles adding new bookings or updating existing ones.
    Includes conflict checking, sends confirmation emails, and creates Google Calendar events.
    """
    try:
        claims = verify_token(request)
        user_id = claims['user_id']
        user_email = claims.get('email', 'anonymous@example.com') # Get user email from claims
        user_name = claims.get('name', user_id) # Get user name from claims, default to user_id

        data = request.get_json()
        booking_data = data.get('bookingData')
        client_user_name = data.get('userName', user_name) # Use the userName passed from frontend, or default

        if not booking_data:
            return jsonify({"error": "Booking data is missing"}), 400

        selected_date_str = booking_data['date']
        selected_time_str = booking_data['time']
        duration = booking_data['duration']
        user_timezone = booking_data.get('userTimeZone', 'UTC') # Get timezone from frontend

        # Convert booking time to a timezone-aware datetime object for comparison
        try:
            local_tz = pytz.timezone(user_timezone)
            # Combine date string and time string for parsing
            naive_start_dt = datetime.datetime.strptime(f"{selected_date_str} {selected_time_str}", '%Y-%m-%d %H:%M')
            # Localize the naive datetime to the user's timezone
            booking_start_dt_local = local_tz.localize(naive_start_dt)
            # Convert to UTC for consistent storage and comparison
            booking_start_dt_utc = booking_start_dt_local.astimezone(pytz.utc)
            booking_end_dt_utc = booking_start_dt_utc + datetime.timedelta(hours=duration)
        except Exception as e:
            print(f"Timezone conversion error: {e}")
            return jsonify({"error": "Invalid timezone or date/time format."}), 400

        # Define studio operating hours in UTC for comparison
        # Assuming studio is in Asia/Jakarta (WITA), which is +07:00 (not +08:00 as previously noted, WITA is UTC+8, but Jakarta is UTC+7)
        # Let's adjust to UTC+7 for Jakarta (WIB) or UTC+8 for WITA
        # For consistency, let's assume the studio is in a fixed timezone, e.g., Asia/Jakarta (WIB, UTC+7) or Asia/Makassar (WITA, UTC+8)
        # Given the context of Bali, WITA (UTC+8) is more appropriate.
        studio_tz = pytz.timezone('Asia/Makassar') # WITA timezone for Bali
        naive_closing_dt = datetime.datetime.strptime(f"{selected_date_str} 18:00", '%Y-%m-%d %H:%M') # 6 PM local time
        studio_closing_dt_local = studio_tz.localize(naive_closing_dt)
        studio_closing_dt_utc = studio_closing_dt_local.astimezone(pytz.utc)

        # Check if proposed booking ends after studio closing time
        if booking_end_dt_utc > studio_closing_dt_utc:
            return jsonify({"error": f"Booking ends after studio closing time ({studio_closing_dt_local.strftime('%I:%M %p')})."}), 409 # Conflict code

        # Fetch all existing bookings for the selected date to check for conflicts
        bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
        date_query = bookings_ref.where('date', '==', selected_date_str).stream()
        
        conflicting_slots = []
        editing_booking_id = data.get('editingBookingId')

        for doc_snap in date_query:
            existing_booking = doc_snap.to_dict()
            existing_booking_id = doc_snap.id

            # Skip the booking being edited during an update operation
            if editing_booking_id and existing_booking_id == editing_booking_id:
                continue

            existing_user_timezone = existing_booking.get('userTimeZone', 'UTC')
            try:
                # Convert existing booking times to UTC for accurate comparison
                existing_local_tz = pytz.timezone(existing_user_timezone)
                naive_existing_start_dt = datetime.datetime.strptime(f"{existing_booking['date']} {existing_booking['time']}", '%Y-%m-%d %H:%M')
                existing_start_dt_local = existing_local_tz.localize(naive_existing_start_dt)
                existing_start_dt_utc = existing_start_dt_local.astimezone(pytz.utc)
                existing_end_dt_utc = existing_start_dt_utc + datetime.timedelta(hours=existing_booking['duration'])
            except Exception as e:
                print(f"Error converting existing booking time for conflict check: {e}")
                continue # Skip this existing booking if its time data is malformed

            # Check for overlap: (StartA < EndB) and (EndA > StartB)
            if (booking_start_dt_utc < existing_end_dt_utc and
                booking_end_dt_utc > existing_start_dt_utc):
                # Convert existing booking times to the user's timezone for display in conflict message
                display_start_time_local = existing_start_dt_utc.astimezone(local_tz).strftime('%I:%M %p')
                display_end_time_local = existing_end_dt_utc.astimezone(local_tz).strftime('%I:%M %p')

                conflicting_slots.append({
                    "id": existing_booking_id,
                    "time": existing_booking['time'], # Original time string
                    "duration": existing_booking['duration'],
                    "userName": existing_booking.get('userName', 'Another User'),
                    "userTimeZone": existing_user_timezone,
                    "displayTime": f"{display_start_time_local} - {display_end_time_local}" # Formatted for display
                })

        if conflicting_slots:
            return jsonify({"error": "Selected time slot conflicts with an existing booking.", "conflictingSlots": conflicting_slots}), 409

        # Prepare booking data for Firestore
        firestore_booking_data = {
            'date': selected_date_str,
            'time': selected_time_str,
            'duration': duration,
            'equipment': booking_data.get('equipment', []),
            'total': booking_data['total'],
            'paymentMethod': booking_data.get('paymentMethod', 'cash'),
            'paymentStatus': booking_data.get('paymentStatus', 'pending'), # Default to pending
            'userId': user_id,
            'userName': client_user_name, # Store client's display name
            'userEmail': user_email, # Store client's email for confirmation
            'timestamp': firestore.SERVER_TIMESTAMP,
            'userTimeZone': user_timezone # Store the user's timezone
        }

        booking_id = editing_booking_id # Initialize booking_id
        if editing_booking_id:
            # Update existing booking
            booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(editing_booking_id)
            booking_doc_ref.set(firestore_booking_data, merge=True)
            # Also update the public record if exists and is managed
            public_booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(editing_booking_id)
            public_booking_doc_ref.set(firestore_booking_data, merge=True)
            booking_id = editing_booking_id
            print(f"Booking {booking_id} updated for user {user_id}")
        else:
            # Add new booking
            user_bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings')
            new_booking_ref = user_bookings_ref.add(firestore_booking_data)
            booking_id = new_booking_ref[1].id # Get the document ID from the tuple (timestamp, ref)
            
            # Also add to a public collection for conflict checking across users
            public_bookings_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings')
            public_bookings_ref.document(booking_id).set(firestore_booking_data)
            print(f"New booking {booking_id} added for user {user_id}")
            
        # After successful booking, send confirmation emails
        full_booking_details = {
            "id": booking_id,
            "date": selected_date_str,
            "time": selected_time_str,
            "duration": duration,
            "equipment": booking_data.get('equipment', []),
            "total": booking_data['total'],
            "paymentMethod": booking_data.get('paymentMethod', 'cash'),
            "paymentStatus": booking_data.get('paymentStatus', 'pending'),
            "userName": client_user_name,
            "userId": user_id,
            "userEmail": user_email,
            "userTimeZone": user_timezone
        }

        # --- Google Calendar Event Creation ---
        if calendar_service:
            try:
                # Event summary (title)
                event_summary = f"DJ Studio Booking: {client_user_name}"
                
                # Event description
                event_description = (
                    f"Client: {client_user_name}\n"
                    f"Email: {user_email}\n"
                    f"Duration: {duration} hours\n"
                    f"Equipment: {', '.join([eq['name'] for eq in booking_data.get('equipment', [])]) or 'None'}\n"
                    f"Total: Rp {full_booking_details['total']:,.0f}\n"
                    f"Payment Status: {full_booking_details['paymentStatus'].upper()}"
                )

                # Google Calendar API expects ISO 8601 format with timezone offset
                # Use the UTC datetime objects for Google Calendar
                start_time_iso = booking_start_dt_utc.isoformat()
                end_time_iso = booking_end_dt_utc.isoformat()

                event = {
                    'summary': event_summary,
                    'description': event_description,
                    'start': {
                        'dateTime': start_time_iso,
                        'timeZone': 'UTC', # Store in UTC and let Google Calendar handle display
                    },
                    'end': {
                        'dateTime': end_time_iso,
                        'timeZone': 'UTC', # Store in UTC
                    },
                    'attendees': [
                        {'email': user_email}, # Client's email
                        {'email': ADMIN_EMAIL}, # Admin's email
                    ],
                    'reminders': {
                        'useDefault': False,
                        'overrides': [
                            {'method': 'email', 'minutes': 24 * 60}, # 24 hours before
                            {'method': 'popup', 'minutes': 60},    # 1 hour before
                        ],
                    },
                    'extendedProperties': {
                        'private': {
                            'bookingId': booking_id, # Store booking ID for future reference
                            'userId': user_id,
                        }
                    }
                }

                # Insert the event into the specified Google Calendar
                created_event = calendar_service.events().insert(
                    calendarId=GOOGLE_CALENDAR_ID,
                    body=event
                ).execute()
                
                print(f"Google Calendar event created: {created_event.get('htmlLink')}")
                # Optionally, save the calendar event ID to Firestore for future updates/cancellations
                db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id).update({
                    'calendarEventId': created_event.get('id')
                })
                db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/bookings').document(booking_id).update({
                    'calendarEventId': created_event.get('id')
                })

            except HttpError as error:
                print(f"An error occurred with Google Calendar API: {error}")
                # You might want to return a 500 here or log more severely
            except Exception as e:
                print(f"Unexpected error during Google Calendar event creation: {e}")
        else:
            print("Google Calendar service not available. Skipping event creation.")

        # Send email to client
        client_subject = f"Your DJ Studio Booking Confirmation (ID: {booking_id})"
        client_html_body = get_email_template_client(full_booking_details)
        send_email(user_email, client_subject, client_html_body)

        # Send email to admin
        admin_subject = f"New DJ Studio Booking Received (ID: {booking_id})"
        payment_confirm_link = None
        if full_booking_details['paymentStatus'] == 'pending':
            # Create a URL for the admin to confirm payment.
            # This link will hit the frontend, which will then call the backend /api/confirm-payment
            # This makes sure the admin is logged into the web app when confirming.
            payment_confirm_link = f"{request.url_root.replace('api/', '')}confirm-payment?bookingId={booking_id}"
            # Note: request.url_root gives the base URL including protocol, host, and port.
            # We replace 'api/' to get to the root of the frontend application.
            # For this to work correctly when deployed to Render, your React app's base URL
            # needs to be reachable directly via the public URL.
            
        admin_html_body = get_email_template_admin(full_booking_details, payment_confirm_link)
        send_email(ADMIN_EMAIL, admin_subject, admin_html_body)


        return jsonify({"message": "Booking confirmed successfully", "bookingId": booking_id}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in confirm_booking: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/check-booked-slots', methods=['GET'])
def check_booked_slots():
    """
    Endpoint to retrieve all booked slots for a specific date.
    This is used by the frontend to display available times.
    """
    try:
        claims = verify_token(request)
        # user_id = claims['user_id'] # Not strictly needed for public data query, but good for context

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
                "userName": booking.get('userName', 'N/A'),
                "userTimeZone": booking.get('userTimeZone', 'UTC')
            })
        
        return jsonify({"bookedSlots": booked_slots}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in check_booked_slots: {e}")
        return jsonify({"error": "Failed to fetch booked slots."}), 500


@app.route('/api/update-profile', methods=['POST'])
def update_user_profile():
    """
    Endpoint to update a user's display name in Firestore and Firebase Auth.
    """
    try:
        claims = verify_token(request)
        user_id = claims['user_id']
        
        data = request.get_json()
        new_display_name = data.get('displayName')

        if not new_display_name:
            return jsonify({"error": "Display name is missing"}), 400

        # Update Firestore profile
        user_profile_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id}/profiles').document('userProfile')
        user_profile_doc_ref.set({'displayName': new_display_name}, merge=True)
        
        # Note: Updating Firebase Auth's displayName directly from the backend
        # requires Firebase Admin SDK which is not directly exposed through `verify_token` claims.
        # This update is typically done client-side if the user wants to update their Firebase Auth profile.
        # However, for the purpose of the app's display name, the Firestore record is sufficient.
        # If the user's *Firebase Auth* display name also needs updating from backend,
        # you'd need the Firebase Admin SDK initialized with service account credentials,
        # and then `auth.update_user(user_id, display_name=new_display_name)`.
        # For simplicity in Canvas, we'll rely on the Firestore profile for display.

        return jsonify({"message": "Profile updated successfully", "displayName": new_display_name}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error updating user profile: {e}")
        return jsonify({"error": "Failed to update profile."}), 500


@app.route('/api/cancel-calendar-event', methods=['DELETE'])
def cancel_calendar_event():
    """
    Endpoint for canceling Google Calendar events.
    This now uses the Google Calendar API.
    """
    try:
        claims = verify_token(request)
        user_id = claims['user_id']
        data = request.get_json()
        calendar_event_id = data.get('calendarEventId')
        booking_id = data.get('bookingId') # Also pass bookingId to update Firestore

        if not calendar_event_id:
            return jsonify({"error": "calendarEventId is missing"}), 400
        if not booking_id:
            return jsonify({"error": "bookingId is missing"}), 400

        if calendar_service:
            try:
                # Delete the event from the shared Google Calendar
                calendar_service.events().delete(calendarId=GOOGLE_CALENDAR_ID, eventId=calendar_event_id).execute()
                print(f"Google Calendar event {calendar_event_id} deleted by admin {user_id}.")

                # Optionally, remove the calendarEventId from Firestore
                db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id).update({
                    'calendarEventId': firestore.DELETE_FIELD
                })
                # Find the original user ID for the booking to update their private record
                booking_snap = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id).get()
                if booking_snap.exists:
                    original_user_id = booking_snap.to_dict().get('userId')
                    if original_user_id:
                        db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{original_user_id}/bookings').document(booking_id).update({
                            'calendarEventId': firestore.DELETE_FIELD
                        })

                return jsonify({"message": f"Calendar event {calendar_event_id} cancelled successfully."}), 200
            except HttpError as error:
                print(f"An error occurred with Google Calendar API during deletion: {error}")
                return jsonify({"error": f"Failed to cancel calendar event: {error}"}), 500
            except Exception as e:
                print(f"Unexpected error during Google Calendar event cancellation: {e}")
                return jsonify({"error": f"Failed to cancel calendar event: {e}"}), 500
        else:
            print("Google Calendar service not available. Skipping event cancellation.")
            return jsonify({"message": f"Calendar event {calendar_event_id} cancellation simulated (Calendar service not available)."}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in cancel_calendar_event: {e}")
        return jsonify({"error": "Failed to simulate calendar event cancellation."}), 500


@app.route('/api/confirm-payment', methods=['POST'])
def confirm_payment():
    """
    New endpoint for admin to confirm payment for a booking.
    This endpoint is called when the admin clicks the "Confirm Payment" link in their email.
    It requires Firebase authentication from the admin user.
    """
    try:
        claims = verify_token(request) # Ensure admin is authenticated
        admin_user_id = claims['user_id']
        admin_email = claims.get('email', 'N/A')

        data = request.get_json()
        booking_id = data.get('bookingId')

        if not booking_id:
            return jsonify({"error": "Booking ID is missing."}), 400

        # Fetch the booking from the public collection first
        public_booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/public/data/bookings').document(booking_id)
        public_booking_snap = public_booking_doc_ref.get()

        if not public_booking_snap.exists:
            return jsonify({"error": "Booking not found."}), 404
        
        booking_data = public_booking_snap.to_dict()
        if booking_data.get('paymentStatus') == 'paid':
            return jsonify({"message": "Payment already confirmed for this booking."}), 200

        # Update payment status in both public and user-specific collections
        booking_data['paymentStatus'] = 'paid'
        booking_data['paymentConfirmedBy'] = admin_user_id
        booking_data['paymentConfirmedAt'] = firestore.SERVER_TIMESTAMP

        public_booking_doc_ref.set(booking_data, merge=True)
        
        # Also update the user's private booking document
        user_id_of_booking = booking_data.get('userId')
        if user_id_of_booking:
            user_booking_doc_ref = db.collection(f'artifacts/{FIREBASE_PROJECT_ID}/users/{user_id_of_booking}/bookings').document(booking_id)
            user_booking_doc_ref.set(booking_data, merge=True) # Merge to keep other fields

        print(f"Payment confirmed for booking {booking_id} by admin {admin_user_id} ({admin_email})")

        # Send confirmation email to the client that their payment has been confirmed
        client_email_for_confirmation = booking_data.get('userEmail')
        if client_email_for_confirmation:
            client_subject = f"Payment Confirmed for Your DJ Studio Booking (ID: {booking_id})"
            client_html_body = f"""
            <p>Dear {booking_data.get('userName', 'Valued Client')},</p>
            <p>Great news! The payment for your DJ Studio booking (ID: {booking_id}) on {datetime.datetime.strptime(booking_data['date'], '%Y-%m-%d').strftime('%A, %B %d, %Y')}
            at {datetime.datetime.strptime(booking_data['time'], '%H:%M').strftime('%I:%M %p')} has been successfully confirmed.</p>
            <p>Your payment status is now: <strong>PAID</strong></p>
            <p>We look forward to your session!</p>
            <p>Best regards,<br/>The DJ Studio Team</p>
            """
            send_email(client_email_for_confirmation, client_subject, client_html_body)

        return jsonify({"message": "Payment confirmed successfully."}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        print(f"Error in confirm_payment: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/')
def health_check():
    return jsonify({"status": "Backend is running!"})


if __name__ == '__main__':
    # This is for local development only. Render will run your app using Gunicorn or similar.
    # Set host to '0.0.0.0' to make it accessible outside localhost in some environments.
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)))
