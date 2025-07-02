export const Modal = ({ show, onClose, title, children }) => {
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





export const ProfileModal = ({ show, onClose, newDisplayName, setNewDisplayName, handleUpdateProfile, profileLoading, profileError }) => (
    <Modal show={show} onClose={onClose} title="Manage Profile">
        {profileError && <div className="bg-red-800 text-white px-4 py-2 rounded-lg mb-4 text-sm">{profileError}</div>}
        <input type="text" value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="Your Display Name" className="w-full p-3 border border-gray-600 rounded-xl bg-gray-700 text-white" />
        <div className="mt-6 flex gap-4">
            <button onClick={onClose} className="w-full py-3 bg-gray-600 text-white rounded-xl font-semibold hover:bg-gray-700">Cancel</button>
            <button onClick={handleUpdateProfile} disabled={profileLoading} className="w-full py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700 disabled:bg-gray-500">{profileLoading ? 'Updating...' : 'Update'}</button>
        </div>
    </Modal>
);