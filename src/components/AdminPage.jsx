
// src/components/AdminPage.jsx

import { useState, useEffect } from 'react';
import { auth } from './firebaseConfig';

const AdminPage = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${import.meta.env.VITE_BACKEND_API_BASE_URL}/api/admin/bookings`, {
          headers: {
            'Authorization': `Bearer ${idToken}`
          }
        });
        if (!response.ok) {
          throw new Error('Failed to fetch bookings.');
        }
        const data = await response.json();
        setBookings(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (auth.currentUser) {
      fetchBookings();
    }
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div className="bg-gray-900 min-h-screen p-4 font-sans">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-orange-400 mb-2">Admin Page</h1>
        <div className="bg-gray-800 shadow-2xl rounded-2xl p-8 mt-6 border border-gray-700">
          <h2 className="text-2xl font-semibold text-orange-300 mb-6">All Bookings</h2>
          <div className="space-y-4">
            {bookings.map(booking => (
              <div key={booking.id} className="bg-gray-700 rounded-lg p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center border border-gray-600">
                <div className="flex-grow mb-4 sm:mb-0">
                  <p className="font-medium text-gray-100">{booking.userName} - {booking.date} at {booking.time}</p>
                  <p className="text-xs text-gray-400 mt-1">Payment: {booking.paymentMethod} - <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${booking.paymentStatus === 'paid' ? 'bg-green-700 text-green-200' : 'bg-yellow-700 text-yellow-200'}`}>{booking.paymentStatus}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
