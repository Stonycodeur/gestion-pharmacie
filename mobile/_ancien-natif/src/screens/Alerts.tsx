import React from 'react';
import { ScrollView, View, Text, RefreshControl } from 'react-native';
import { get } from '../api';
import { t } from '../i18n';
import { s, useLoad, Badge } from '../ui';

export default function Alerts() {
  const { data: a, refreshing, reload } = useLoad(() => get('/alerts'));
  const Sec = ({ title, items, kind, line }: { title: string; items?: any[]; kind: 'bad' | 'warn'; line: (x: any) => string }) => !items?.length ? null : (
    <View style={s.card}><View style={[s.between, { marginBottom: 6 }]}><Text style={s.h2}>{title}</Text><Badge text={String(items.length)} kind={kind} /></View>
      {items.slice(0, 30).map((x, i) => <Text key={i} style={[s.txt, { marginTop: 4 }]}>{line(x)}</Text>)}</View>);
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}>
      <Text style={s.h1}>{t('alerts')}</Text>
      <Sec title="Périmés en stock" items={a?.expired} kind="bad" line={(x) => `${x.name} — lot ${x.batch_no} (${x.exp_date}) × ${x.qty}`} />
      <Sec title="Péremption proche" items={a?.expiring} kind="warn" line={(x) => `${x.name} — lot ${x.batch_no}, ${x.days_left} j × ${x.qty}`} />
      <Sec title="Ruptures" items={a?.out} kind="bad" line={(x) => x.name} />
      <Sec title="Stock critique" items={a?.critical} kind="bad" line={(x) => `${x.name} (${x.sellable})`} />
      <Sec title="Stock bas" items={a?.low} kind="warn" line={(x) => `${x.name} (${x.sellable}/${x.min_stock})`} />
      <Sec title="Lots bloqués / rappelés" items={a?.blocked} kind="bad" line={(x) => `${x.name ?? ''} — lot ${x.batch_no ?? ''}`} />
    </ScrollView>
  );
}
