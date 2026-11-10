// Adresse du site chargé par l'application. Remplaçable à la compilation : EXPO_PUBLIC_APP_URL=https://... eas build
export const APP_URL: string = (process.env.EXPO_PUBLIC_APP_URL || 'https://pharmacie.jtconsultingcg.com').replace(/\/+$/, '');
export const APP_HOST = new URL(APP_URL).host;
