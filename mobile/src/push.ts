// Notifications push (Expo) : autorisation, jeton, canal Android. Le jeton est envoyé au site (qui l'enregistre sur le compte connecté).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }) });

export async function getPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // pas de push sur simulateur
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Pharmacie', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 250, 150, 250] });
    let st = (await Notifications.getPermissionsAsync()).status;
    if (st !== 'granted') st = (await Notifications.requestPermissionsAsync()).status;
    if (st !== 'granted') return null;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch { return null; } // facultatif : ne bloque jamais l'application
}
// Appelle f(link) quand l'utilisateur touche une notification (application ouverte, en arrière-plan ou fermée)
export function onNotificationOpen(f: (link: string | null) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => f(((r.notification.request.content.data as any)?.link as string) || null));
  Notifications.getLastNotificationResponseAsync().then((r) => { if (r) f(((r.notification.request.content.data as any)?.link as string) || null); }).catch(() => {});
  return () => sub.remove();
}
