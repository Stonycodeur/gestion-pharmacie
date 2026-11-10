import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { get } from '../api';
import { t } from '../i18n';
import { onPush } from '../push';
import { s, useLoad, List, Badge, C } from '../ui';

const STEPS: [string, string][] = [['issued', 'Commande émise'], ['received', 'Reçue'], ['in_progress', 'En cours'], ['delivered', 'Livrée']];
const KIND: Record<string, 'ok' | 'warn' | 'bad' | 'mute'> = { issued: 'warn', received: 'warn', in_progress: 'warn', delivered: 'ok', failed: 'bad', cancelled: 'mute' };
export default function MyDeliveries() {
  const l = useLoad(() => get('/portal/deliveries'));
  useEffect(() => { const id = setInterval(() => l.reload(), 15000); const off = onPush(() => l.reload()); return () => { clearInterval(id); off(); }; }, []); // quasi temps réel : rafraîchi toutes les 15 s et dès qu'un push arrive
  return <View style={s.screen}><List {...l} empty={t('empty')} render={(d: any) => {
    const reached = new Set(d.events.map((e: any) => e.status));
    return <View style={s.card}>
      <View style={s.between}><Text style={s.h2}>{d.number}</Text><Badge text={d.status_label} kind={KIND[d.status]} /></View>
      <Text style={s.mute}>{d.order_number} · {d.address}</Text>
      {d.driver ? <View style={{ marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: C.bg }}><Text style={{ fontWeight: '700', color: C.ink }}>{d.driver.name}</Text><Text style={s.mute}>{t('matricule')} : {d.driver.matricule}{d.driver.phone ? ` · ${d.driver.phone}` : ''}</Text></View> : null}
      <View style={{ marginTop: 10 }}>{STEPS.map(([k, label]) => { const ev = [...d.events].reverse().find((e: any) => e.status === k); return <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, marginEnd: 10, backgroundColor: reached.has(k) ? C.brand : '#cbd5d5' }} />
        <Text style={{ color: reached.has(k) ? C.ink : C.mute, fontWeight: reached.has(k) ? '700' : '400' }}>{label}{ev ? ` · ${String(ev.created_at).slice(5, 16)}` : ''}</Text></View>; })}
        {['failed', 'cancelled'].includes(d.status) ? <Text style={{ color: C.bad }}>{d.status_label}{d.failure_reason ? ` : ${d.failure_reason}` : ''}</Text> : null}</View>
    </View>; }} /></View>;
}
