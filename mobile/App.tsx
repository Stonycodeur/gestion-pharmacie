// Coque native : charge le site complet (mêmes pages, mêmes droits, même mode hors connexion que sur le web)
// et ajoute ce que le navigateur ne fait pas : notifications push, navigation depuis une notification, bouton Retour Android, liens externes.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_URL, APP_HOST } from './src/config';
import { getPushToken, onNotificationOpen } from './src/push';

const BRAND = '#0f766e';
// Réglages natifs coté page : pas de zoom involontaire, défilement fluide.
const BOOT_JS = `(function(){var m=document.querySelector('meta[name=viewport]');if(m)m.content='width=device-width, initial-scale=1, viewport-fit=cover';document.documentElement.dataset.shell='app';})();true;`;

function Shell() {
  const web = useRef<WebView>(null); const ins = useSafeAreaInsets();
  const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false); const [canBack, setCanBack] = useState(false);
  const pendingLink = useRef<string | null>(null); const ready = useRef(false);

  const go = useCallback((link: string | null) => {
    if (!link) return;
    if (!ready.current) { pendingLink.current = link; return; }
    web.current?.injectJavaScript(`window.__native&&window.__native.go(${JSON.stringify(link)});true;`);
  }, []);

  useEffect(() => { Location.requestForegroundPermissionsAsync().catch(() => {}); }, []); // pharmacie la plus proche, suivi chauffeur
  useEffect(() => onNotificationOpen(go), [go]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (canBack) { web.current?.goBack(); return true; } return false; });
    return () => sub.remove();
  }, [canBack]);
  useEffect(() => NetInfo.addEventListener((s) => { if (s.isConnected && failed) { setFailed(false); web.current?.reload(); } }), [failed]);

  const onMessage = async (e: WebViewMessageEvent) => {
    let m: any; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') {
      ready.current = true;
      const token = await getPushToken();
      if (token) web.current?.injectJavaScript(`window.__native&&window.__native.push(${JSON.stringify(token)},${JSON.stringify(Platform.OS)});true;`);
      if (pendingLink.current) { const l = pendingLink.current; pendingLink.current = null; go(l); }
    } else if (m.type === 'logout') { ready.current = false; }
    else if (m.type === 'open-external' && typeof m.url === 'string' && /^https?:\/\//.test(m.url)) Linking.openURL(m.url).catch(() => {});
  };

  // Le site reste dans l'application ; tout autre domaine, tel:, mailto:, WhatsApp… s'ouvre à l'extérieur.
  const allow = (req: { url: string }) => {
    try { const u = new URL(req.url); if ((u.protocol === 'https:' || u.protocol === 'http:') && u.host === APP_HOST) return true; if (u.protocol === 'about:' || u.protocol === 'blob:' || u.protocol === 'data:') return true; } catch { /* schéma inconnu */ }
    Linking.openURL(req.url).catch(() => {}); return false;
  };

  return (
    <View style={[st.fill, { paddingTop: ins.top, paddingBottom: ins.bottom, paddingLeft: ins.left, paddingRight: ins.right, backgroundColor: BRAND }]}>
      <StatusBar style="light" />
      <View style={st.fill}>
        <WebView
          ref={web} source={{ uri: APP_URL }} style={st.fill} originWhitelist={['*']}
          javaScriptEnabled domStorageEnabled sharedCookiesEnabled thirdPartyCookiesEnabled cacheEnabled
          geolocationEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
          allowFileAccess={false} mixedContentMode="never" setSupportMultipleWindows={false}
          pullToRefreshEnabled allowsBackForwardNavigationGestures decelerationRate="normal"
          injectedJavaScriptBeforeContentLoaded={BOOT_JS}
          onShouldStartLoadWithRequest={allow} onMessage={onMessage}
          onNavigationStateChange={(n) => setCanBack(n.canGoBack)}
          onLoadStart={() => setLoading(true)} onLoadEnd={() => setLoading(false)}
          onError={() => setFailed(true)} onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
          onRenderProcessGone={() => web.current?.reload()}
        />
        {loading && !failed && <View style={st.overlay} pointerEvents="none"><ActivityIndicator size="large" color={BRAND} /></View>}
        {failed && (
          <View style={st.overlay}>
            <Text style={st.title}>Connexion impossible</Text>
            <Text style={st.msg}>Vérifiez votre connexion Internet. Si le service vient de se réveiller, patientez une minute puis réessayez.</Text>
            <Pressable style={st.btn} onPress={() => { setFailed(false); web.current?.reload(); }} accessibilityRole="button"><Text style={st.btnT}>Réessayer</Text></Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
export default function App() { return <SafeAreaProvider><Shell /></SafeAreaProvider>; }
const st = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: '#0b1517', marginBottom: 8 }, msg: { fontSize: 15, color: '#475569', textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: BRAND, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 }, btnT: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
