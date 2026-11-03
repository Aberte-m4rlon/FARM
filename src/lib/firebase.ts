/**
 * Firebase Client SDK Initialization for AlpasFarm
 * Provides Firebase Phone Authentication (10,000 Free SMS per month)
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBLf58lcG7awnIW6qkwd-8KlVVC1kn-0Xw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'capston-909ec.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'capston-909ec',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'capston-909ec.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '846721312613',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:846721312613:web:d399c198ebf661cc81a38c',
};

export const isFirebaseConfigured = (): boolean => {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
};

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured()) {
  try {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    authInstance = getAuth(appInstance);
  } catch (err) {
    console.warn('[AlpasFarm] Firebase initialization skipped or failed:', err);
  }
}

export { appInstance as firebaseApp, authInstance as firebaseAuth };
