// Import only what you need
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
// src/firebaseConfig.js
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// Add validation and logging
const validateConfig = (config) => {
  const requiredKeys = [
    'apiKey', 'authDomain', 'projectId', 
    'storageBucket', 'messagingSenderId', 'appId'
  ];
  
  let isValid = true;
  
  requiredKeys.forEach(key => {
    if (!config[key]) {
      console.error(`Missing Firebase config: ${key}`);
      isValid = false;
    } else if (config[key].includes('YOUR_') || config[key].includes('example')) {
      console.warn(`Firebase config ${key} may contain placeholder value: ${config[key]}`);
    }
  });

  return isValid;
};

if (process.env.NODE_ENV !== 'production') {
  console.log('Firebase Configuration:', firebaseConfig);
  if (!validateConfig(firebaseConfig)) {
    console.error('Invalid Firebase configuration detected!');
  }
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)