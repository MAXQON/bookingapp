# get_refresh_token.py

import os
import json
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
import pickle # To save/load credentials (optional, but good practice)

# --- Configuration ---
# IMPORTANT: Replace with your actual Client ID and Client Secret
# from the JSON you provided.
CLIENT_ID = "909871533345-bvbgqcooi8mrqtbbo6itop70av28i98r.apps.googleusercontent.com" # e.g., "909871533345-bvbgqcooi8mrqtbbo6itop70av28i98r.apps.googleusercontent.com"
CLIENT_SECRET = "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" # e.g., "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"

# The scopes define what data your app can access.
# 'https://www.googleapis.com/auth/calendar.events' is sufficient for creating/managing events.
SCOPES = ['https://www.googleapis.com/auth/calendar.events']

# The redirect URI must exactly match one configured in your Google Cloud Console
# for your OAuth 2.0 Web Application client.
# Use 'http://localhost:8080' if running locally and that's configured.
# If you configured 'https://maxqon.github.io/bookingapp/', you might need to
# temporarily add 'http://localhost:8080' to your authorized redirect URIs in Google Cloud Console.
REDIRECT_URI = "http://localhost:8080" 

# Path to save/load credentials (optional)
CREDENTIALS_FILE = 'token.pickle'

def get_refresh_token():
    creds = None
    # The file token.pickle stores the user's access and refresh tokens, and is
    # created automatically when the authorization flow completes for the first time.
    if os.path.exists(CREDENTIALS_FILE):
        with open(CREDENTIALS_FILE, 'rb') as token:
            creds = pickle.load(token)

    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # Create a dummy 'client_secrets.json' structure in memory
            # This is what InstalledAppFlow expects for web applications
            client_config = {
                "web": {
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "redirect_uris": [REDIRECT_URI]
                }
            }
            
            # Use the flow from_client_config
            flow = InstalledAppFlow.from_client_config(
                client_config, SCOPES, redirect_uri=REDIRECT_URI
            )
            
            # This will open a browser window for authentication
            creds = flow.run_local_server(port=8080) # Ensure this port is allowed in redirect_uris

        # Save the credentials for the next run
        with open(CREDENTIALS_FILE, 'wb') as token:
            pickle.dump(creds, token)

    if creds and creds.refresh_token:
        print("\n--- GOOGLE CALENDAR REFRESH TOKEN ---")
        print(creds.refresh_token)
        print("-------------------------------------\n")
        print("Copy the token above and set it as GOOGLE_CALENDAR_REFRESH_TOKEN in your Render environment variables.")
        print("Also, ensure GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET are set correctly in Render.")
    else:
        print("Could not obtain a refresh token. Please ensure your Client ID, Client Secret, and Redirect URI are correct and you granted all permissions.")

if __name__ == '__main__':
    get_refresh_token()

