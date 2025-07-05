// src/components/DeleteConfirmationModal.jsx
import React from 'react';
import Modal from './Modal'; // Import the base Modal component
import { formatDate, formatTime } from '../utils'; // Import utility functions

// DeleteConfirmationModal is defined as a const and then exported as default.
const DeleteConfirmationModal = ({ show, onClose, booking, onConfirm }) => {
    if (!booking) return null;
    return (
        <Modal show={show} onClose={() => setShowDeleteConfirmation(false)} title="Confirm Cancellation">
            <p className="text-gray-300 mb-6 text-center">Are you sure you want to cancel your booking for {formatDate(booking.date)} at {formatTime(booking.time)}?</p>
            <div className="flex justify-center gap-4">
                <button onClick={onClose} className="px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600 w-full">No, Keep It</button>
                <button onClick={onConfirm} className="px-6 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 w-full">Yes, Cancel</button>
            </div>
        </Modal>
    );
};

export default DeleteConfirmationModal;
