import React from 'react';
import { ScrollView, View, Text, RefreshControl } from 'react-native';
import { get, money, can } from '../api';
import { t } from '../i18n';
import { s, useLoad } from '../ui';

export default function Dashboard() {
  const { data: d, refreshing, reload } = useLoad(() => get('/dashboard'));
  const K = ({ l, v }: { l: string; v: string | number }) => <View style={s.kpi}><Text style={s.mute}>{l}</Text><Text style={s.kpiV}>{v}</Text></View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}>
      <Text style={s.h1}>{t('home')}</Text>
      {d?.today && <View style={[s.row, { marginBottom: 10 }]}><K l={t('today')} v={money(d.today.total)} /><K l={t('month')} v={money(d.month.total)} /></View>}
      {d && <View style={[s.row, { marginBottom: 10 }]}><K l="Ruptures" v={d.alerts.out} /><K l="Critiques" v={d.alerts.critical} /><K l="Périmés" v={d.alerts.expired} /></View>}
      {d && <View style={s.row}><K l="Péremption proche" v={d.alerts.expiring} />{d.prescriptions_to_verify != null && <K l="Ordonnances à vérifier" v={d.prescriptions_to_verify} />}{d.orders_open != null && <K l="Commandes en cours" v={d.orders_open} />}</View>}
      {d?.top?.length ? <View style={[s.card, { marginTop: 14 }]}><Text style={s.h2}>Meilleures ventes (30 j)</Text>{d.top.map((x: any) => <View key={x.name} style={[s.between, { marginTop: 6 }]}><Text style={s.txt}>{x.name}</Text><Text style={s.mute}>{x.qty}</Text></View>)}</View> : null}
    </ScrollView>
  );
}
