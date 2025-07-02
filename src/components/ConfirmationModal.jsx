// src/components/ConfirmationModal.jsx
import React from 'react';
import Modal from './Modal'; // Import the base Modal component
import { formatIDR, formatDate, formatTime } from '../utils'; // Import utility functions

// ConfirmationModal is defined as a const and then exported as default.
const ConfirmationModal = ({ show, onClose, booking, isUpdate }) => {
    if (!booking) return null;
    return (
        <Modal show={show} onClose={onClose} title={isUpdate ? 'Booking Updated!' : 'Booking Confirmed!'}>
            <div className="text-center">
                <div className="text-6xl mb-4 pulse-animation">🎉</div>
                <div className="text-left bg-gray-700 rounded-lg p-4 mb-6 text-gray-200 space-y-1">
                    <p><strong>Date:</strong> {formatDate(booking.date)}</p>
                    <p><strong>Time:</strong> {formatTime(booking.time)}</p>
                    <p><strong>Total:</strong> {formatIDR(booking.total)}</p>
                    <p><strong>Status:</strong> <span className="font-semibold text-yellow-400">PENDING</span></p>
                </div>
                <button onClick={onClose} className="bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 w-full">Awesome!</button>
            </div>
        </Modal>
    );
};

export default ConfirmationModal;