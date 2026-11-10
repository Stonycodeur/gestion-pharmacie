// Notifications push : demande l'autorisation, récupère le jeton Expo et l'enregistre sur le compte (le serveur l'utilise pour les suivis de commande / livraison).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { call } from './api';

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }) });
let current: string | null = null;
export async function registerPush(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false; // pas de push sur simulateur
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Pharmacie', importance: Notifications.AndroidImportance.HIGH });
    let st = (await Notifications.getPermissionsAsync()).status; if (st !== 'granted') st = (await Notifications.requestPermissionsAsync()).status; if (st !== 'granted') return false;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const tok = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await call('POST', '/me/push-token', { token: tok, platform: Platform.OS === 'ios' ? 'ios' : 'android' }); current = tok; return true;
  } catch { return false; } // le push est un confort : jamais bloquant
}
export async function unregisterPush() { if (current) { try { await call('DELETE', '/me/push-token', { token: current }); } catch { /* hors connexion */ } current = null; } }
export const onPush = (f: () => void) => { const a = Notifications.addNotificationReceivedListener(f), b = Notifications.addNotificationResponseReceivedListener(f); return () => { a.remove(); b.remove(); }; };
