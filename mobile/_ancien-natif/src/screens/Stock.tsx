import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { get } from '../api';
import { t } from '../i18n';
import { s, C, Badge, Btn, Input, List, err } from '../ui';

const STATE: Record<string, [string, 'ok' | 'warn' | 'bad' | 'mute']> = { ok: ['OK', 'ok'], low: ['Bas', 'warn'], critical: ['Critique', 'bad'], out: ['Rupture', 'bad'], over: ['Surstock', 'mute'] };

export default function Stock() {
  const [q, setQ] = useState(''), [rows, setRows] = useState<any[] | null>(null), [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [scan, setScan] = useState(false);
  const [perm, ask] = useCameraPermissions();
  async function load(pull = false) {
    pull ? setRefreshing(true) : setLoading(true);
    try { setRows((await get(`/stock?limit=50&q=${encodeURIComponent(q)}`)).data); } catch (e) { err(e); } finally { setLoading(false); setRefreshing(false); }
  }
  useEffect(() => { const h = setTimeout(load, 300); return () => clearTimeout(h); }, [q]);
  async function openScan() { if (!perm?.granted && !(await ask()).granted) return; setScan(true); }
  return (
    <View style={s.screen}>
      <View style={[s.row, { padding: 14, paddingBottom: 0 }]}>
        <Input style={{ flex: 1, marginBottom: 0 }} placeholder={t('search')} value={q} onChangeText={setQ} returnKeyType="search" />
        <Btn title={t('scan')} ghost onPress={openScan} />
      </View>
      <List data={rows} loading={loading} refreshing={refreshing} reload={() => load(true)} empty={t('empty')} render={(r) => (
        <View style={s.card}>
          <View style={s.between}><Text style={[s.h2, { flex: 1 }]}>{r.name}</Text><Badge text={STATE[r.state]?.[0] ?? r.state} kind={STATE[r.state]?.[1]} /></View>
          <Text style={s.mute}>{r.sku}{r.dosage ? ` · ${r.dosage}` : ''}</Text>
          <Text style={[s.txt, { marginTop: 6 }]}>Disponible : {r.sellable ?? r.available} · Quarantaine : {r.quarantine ?? 0}{r.next_expiry ? ` · Prochaine péremption : ${r.next_expiry}` : ''}</Text>
        </View>)} />
      <Modal visible={scan} animationType="slide" onRequestClose={() => setScan(false)}>
        <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'qr', 'upc_a'] }} onBarcodeScanned={({ data }) => { setScan(false); setQ(data); }} />
        <Pressable onPress={() => setScan(false)} style={{ position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: C.brand, padding: 14, borderRadius: 30 }}><Text style={{ color: '#fff', fontWeight: '600' }}>✕</Text></Pressable>
      </Modal>
    </View>
  );
}
