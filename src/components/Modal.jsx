// src/components/Modal.jsx
import React from 'react'; // Import React for JSX

const Modal = ({ show, onClose, title, children }) => {
    if (!show) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-white border border-gray-700" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold text-orange-400 mb-6 text-center">{title}</h2>
                {children}
            </div>
        </div>
    );
};

export default Modal;
