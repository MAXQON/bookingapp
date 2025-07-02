const AuthModal = ({ show, onClose, isLoginMode, setIsLoginMode, email, setEmail, password, setPassword, handleAuthAction, handleGoogleSignIn, handleGuestLogin, authError }) => (
    <Modal show={show} onClose={onClose} title={isLoginMode ? 'Sign In' : 'Sign Up'}>
        {authError && <div className="bg-red-800 text-white px-4 py-2 rounded-lg mb-4 text-sm">{authError}</div>}
        <div className="space-y-4">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="w-full p-3 border border-gray-600 rounded-xl bg-gray-700 text-white" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="w-full p-3 border border-gray-600 rounded-xl bg-gray-700 text-white" />
        </div>
        <div className="mt-6 space-y-3">
            <button onClick={() => handleAuthAction(isLoginMode ? () => signInWithEmailAndPassword(getAuth(), email, password) : () => createUserWithEmailAndPassword(getAuth(), email, password))} className="w-full py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700">
                {isLoginMode ? 'Sign In' : 'Sign Up'}
            </button>
            <button onClick={handleGoogleSignIn} className="w-full py-3 bg-red-700 text-white rounded-xl font-semibold hover:bg-red-800 flex items-center justify-center gap-2">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo" className="w-5 h-5" /> Sign In with Google
            </button>
            <button onClick={handleGuestLogin} className="w-full py-3 bg-gray-600 text-white rounded-xl font-semibold hover:bg-gray-700">Login as Guest</button>
            <button onClick={() => setIsLoginMode(p => !p)} className="w-full py-2 text-sm text-gray-400 hover:text-white">{isLoginMode ? 'Need an account? Sign Up' : 'Have an account? Sign In'}</button>
        </div>
    </Modal>
);
export const AuthModal;