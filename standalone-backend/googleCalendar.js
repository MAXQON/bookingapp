
// standalone-backend/googleCalendar.js

const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const calendar = google.calendar({
  version: 'v3',
  auth: oauth2Client
});

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

async function createCalendarEvent(bookingId, bookingData) {
  const event = {
    summary: `Booking: ${bookingData.userName}`,
    description: `Equipment: ${bookingData.equipment.map(e => e.name).join(', ')}`,
    start: {
      dateTime: new Date(`${bookingData.date}T${bookingData.time}:00`),
      timeZone: bookingData.userTimeZone,
    },
    end: {
      dateTime: new Date(new Date(`${bookingData.date}T${bookingData.time}:00`).getTime() + bookingData.duration * 60 * 60 * 1000),
      timeZone: bookingData.userTimeZone,
    },
    id: bookingId.replace(/[^a-zA-Z0-9]/g, '')
  };

  try {
    const res = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event });
    return res.data.id;
  } catch (error) {
    console.error('Error creating calendar event:', error);
  }
}

async function updateCalendarEvent(bookingId, bookingData) {
  const event = {
    summary: `Booking: ${bookingData.userName}`,
    description: `Equipment: ${bookingData.equipment.map(e => e.name).join(', ')}`,
    start: {
      dateTime: new Date(`${bookingData.date}T${bookingData.time}:00`),
      timeZone: bookingData.userTimeZone,
    },
    end: {
      dateTime: new Date(new Date(`${bookingData.date}T${bookingData.time}:00`).getTime() + bookingData.duration * 60 * 60 * 1000),
      timeZone: bookingData.userTimeZone,
    },
  };

  try {
    await calendar.events.update({ calendarId: CALENDAR_ID, eventId: bookingId.replace(/[^a-zA-Z0-9]/g, ''), resource: event });
  } catch (error) {
    console.error('Error updating calendar event:', error);
  }
}

async function deleteCalendarEvent(bookingId) {
  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: bookingId.replace(/[^a-zA-Z0-9]/g, '') });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
  }
}

module.exports = { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent };
