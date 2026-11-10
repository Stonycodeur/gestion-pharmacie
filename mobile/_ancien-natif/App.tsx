import { registerPush, unregisterPush } from './src/push';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { restore, can, online, onNet, BASE } from './src/api';
import { Icon } from './src/icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadLang, t } from './src/i18n';
import { C } from './src/ui';
import Login from './src/screens/Login';
import Dashboard from './src/screens/Dashboard';
import Stock from './src/screens/Stock';
import Alerts from './src/screens/Alerts';
import Orders from './src/screens/Orders';
import Prescriptions from './src/screens/Prescriptions';
import Catalog from './src/screens/Catalog';
import MyDeliveries from './src/screens/MyDeliveries';
import MyOrders from './src/screens/MyOrders';
import MyPrescriptions from './src/screens/MyPrescriptions';
import Account from './src/screens/Account';

const Tab = createBottomTabNavigator();
const ICONS: Record<string, string> = { home: 'dashboard', stock: 'boxes', alerts: 'bell', orders: 'bag', rx: 'file', account: 'user', catalog: 'pill', myorders: 'bag', myrx: 'file', mydeliveries: 'truck' };
const mkOpts = (brand: string, bottom: number) => ({ headerStyle: { backgroundColor: brand }, headerTintColor: '#fff', tabBarActiveTintColor: brand, tabBarStyle: { height: 58 + bottom, paddingBottom: 6 + bottom, paddingTop: 6 }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const } });
});
// Couleur de l'établissement (publique) mise en cache pour le démarrage hors connexion
async function loadBrand(): Promise<string> { try { const b = await (await fetch(BASE + '/api/v1/branding')).json(); if (b?.color) { await AsyncStorage.setItem('gp_brand', b.color); return b.color; } } catch {} return (await AsyncStorage.getItem('gp_brand')) || C.brand; }
function OfflineBanner() { const [o, setO] = useState(online); const ins = useSafeAreaInsets(); useEffect(() => onNet(setO), []); if (o) return null; return <View style={{ backgroundColor: '#fdf0d5', paddingTop: ins.top + 6, paddingBottom: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="wifioff" size={16} color="#92580a" /><Text style={{ color: '#92580a', fontWeight: '600', flex: 1 }}>Hors connexion - données en cache</Text></View>; }

export default function App() { return <SafeAreaProvider><Root /></SafeAreaProvider>; }
function Root() {
  const [state, setState] = useState<'boot' | 'out' | 'in'>('boot'); const [brand, setBrand] = useState(C.brand); const ins = useSafeAreaInsets();
  useEffect(() => { (async () => { await loadLang(); setBrand(await loadBrand()); const ok = await restore(); setState(ok ? 'in' : 'out'); if (ok) registerPush(); })(); }, []);
  if (state === 'boot') return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={brand} /></View>;
  if (state === 'out') return <><StatusBar style="dark" /><Login onDone={() => { setState('in'); registerPush(); }} /></>;
  const customer = can('portal.use') && !can('dashboard.view');
  const out = () => setState('out');
  return (
    <NavigationContainer>
      <StatusBar style="light" /><OfflineBanner />
      <Tab.Navigator screenOptions={({ route }) => ({ ...mkOpts(brand, ins.bottom), tabBarIcon: ({ color }: any) => <Icon name={ICONS[route.name] ?? 'dashboard'} color={color} size={22} /> })}>
        {customer ? (<>
          <Tab.Screen name="catalog" options={{ title: t('catalog') }} component={Catalog} />
          <Tab.Screen name="myorders" options={{ title: t('myorders') }} component={MyOrders} />
          <Tab.Screen name="mydeliveries" options={{ title: t('mydeliveries') }} component={MyDeliveries} />
          <Tab.Screen name="myrx" options={{ title: t('myrx') }} component={MyPrescriptions} />
        </>) : (<>
          {can('dashboard.view') && <Tab.Screen name="home" options={{ title: t('home') }} component={Dashboard} />}
          {can('stock.view') && <Tab.Screen name="stock" options={{ title: t('stock') }} component={Stock} />}
          {can('stock.view') && <Tab.Screen name="alerts" options={{ title: t('alerts') }} component={Alerts} />}
          {can('orders.view') && <Tab.Screen name="orders" options={{ title: t('orders') }} component={Orders} />}
          {can('prescriptions.view') && <Tab.Screen name="rx" options={{ title: t('rx') }} component={Prescriptions} />}
        </>)}
        <Tab.Screen name="account" options={{ title: t('account') }}>{() => <Account onLogout={out} />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
