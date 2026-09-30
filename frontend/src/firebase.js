import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBVJ8aBV26-R5H_dLGjpPbsI5wqFHTFNbI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "swasthyasetu-ai-7b4e6.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "swasthyasetu-ai-7b4e6",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "swasthyasetu-ai-7b4e6.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "909865444847",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:909865444847:web:63aae71223fd6bbf1a821a"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;

