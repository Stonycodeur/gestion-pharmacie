import React from 'react';
import { View, Text } from 'react-native';
import { get, post, can } from '../api';
import { t } from '../i18n';
import { s, useLoad, List, Badge, Btn, err } from '../ui';

const NEXT: Record<string, [string, string]> = { pending: ['confirmed', 'Confirmer'], confirmed: ['preparing', 'Préparer'], preparing: ['ready', 'Prête'] };
const LABEL: Record<string, string> = { pending: 'En attente', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', picked_up: 'Retirée', cancelled: 'Annulée', expired: 'Expirée' };

export default function Orders() {
  const l = useLoad(async () => (await get('/orders?limit=50')).data);
  async function advance(id: number, status: string) { try { await post(`/orders/${id}/status`, { status }); l.reload(); } catch (e) { err(e); } }
  return (
    <View style={s.screen}>
      <List {...l} empty={t('empty')} data={l.data} render={(o: any) => (
        <View style={s.card}>
          <View style={s.between}><Text style={s.h2}>{o.number}</Text><Badge text={LABEL[o.status] ?? o.status} kind={o.status === 'ready' ? 'ok' : ['cancelled', 'expired'].includes(o.status) ? 'bad' : 'warn'} /></View>
          <Text style={s.mute}>{o.customer_name} · {o.lines} ligne(s){o.expires_at ? ` · expire ${o.expires_at}` : ''}</Text>
          {can('orders.manage') && NEXT[o.status] && <View style={{ marginTop: 10 }}><Btn title={NEXT[o.status][1]} onPress={() => advance(o.id, NEXT[o.status][0])} /></View>}
        </View>)} />
    </View>
  );
}
