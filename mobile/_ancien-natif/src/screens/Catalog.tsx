import React, { useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { get, post } from '../api';
import { t } from '../i18n';
import { s, Badge, Btn, Input, List, err } from '../ui';

// Espace client : disponibilité en oui/non (jamais de quantités). Les produits sur ordonnance ne se réservent pas ici.
export default function Catalog() {
  const [q, setQ] = useState(''), [rows, setRows] = useState<any[] | null>(null), [loading, setLoading] = useState(true), [cart, setCart] = useState<Record<number, number>>({});
  useEffect(() => { const h = setTimeout(async () => { setLoading(true); try { setRows(await get(`/portal/catalog?q=${encodeURIComponent(q)}`)); } catch (e) { err(e); } finally { setLoading(false); } }, 300); return () => clearTimeout(h); }, [q]);
  const n = Object.values(cart).reduce((a, b) => a + b, 0);
  async function reserve() {
    try { const r = await post('/portal/orders', { lines: Object.entries(cart).map(([product_id, qty]) => ({ product_id: Number(product_id), qty })) }); setCart({}); Alert.alert('Réservation', `${r.number} — à retirer avant ${r.expires_at ?? 'expiration'}`); } catch (e) { err(e); }
  }
  return (
    <View style={s.screen}>
      <View style={{ padding: 14, paddingBottom: 0 }}><Input placeholder={t('search')} value={q} onChangeText={setQ} /></View>
      <List data={rows} loading={loading} refreshing={false} reload={() => setQ(q)} empty={t('empty')} render={(p: any) => (
        <View style={s.card}>
          <View style={s.between}><Text style={[s.h2, { flex: 1 }]}>{p.name}</Text><Badge text={p.available ? 'Disponible' : 'Indisponible'} kind={p.available ? 'ok' : 'bad'} /></View>
          <Text style={s.mute}>{[p.dci, p.dosage, p.form].filter(Boolean).join(' · ')}</Text>
          {p.rx_status !== 'free' ? <Text style={[s.mute, { marginTop: 6 }]}>Sur ordonnance : envoyez d'abord votre ordonnance.</Text>
            : p.available ? <View style={[s.row, { marginTop: 8 }]}><Btn ghost title="−" onPress={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))} /><Text style={s.h2}>{cart[p.id] ?? 0}</Text><Btn ghost title="+" onPress={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))} /></View> : null}
        </View>)} />
      {n > 0 && <View style={{ padding: 14 }}><Btn title={`${t('reserve')} (${n})`} onPress={reserve} /></View>}
    </View>
  );
}
