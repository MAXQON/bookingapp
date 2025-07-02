// src/components/ProfileModal.jsx
import React from 'react';
import Modal from './Modal'; // Import the base Modal component

const ProfileModal = ({ show, onClose, newDisplayName, setNewDisplayName, handleUpdateProfile, profileLoading, profileError }) => (
    <Modal show={show} onClose={onClose} title="Manage Profile">
        {profileError && <div className="bg-red-800 text-white px-4 py-2 rounded-lg mb-4 text-sm">{profileError}</div>}
        <input type="text" value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="Your Display Name" className="w-full p-3 border border-gray-600 rounded-xl bg-gray-700 text-white" />
        <div className="mt-6 flex gap-4">
            <button onClick={onClose} className="w-full py-3 bg-gray-600 text-white rounded-xl font-semibold hover:bg-gray-700">Cancel</button>
            <button onClick={handleUpdateProfile} disabled={profileLoading} className="w-full py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700 disabled:bg-gray-500">{profileLoading ? 'Updating...' : 'Update'}</button>
        </div>
    </Modal>
);

export default ProfileModal;