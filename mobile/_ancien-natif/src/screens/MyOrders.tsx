import React from 'react';
import { View, Text, Alert, Linking, Modal } from 'react-native';
import { get, post, money } from '../api';
import { t } from '../i18n';
import { s, useLoad, List, Badge, Btn, Input, err } from '../ui';

const LABEL: Record<string, string> = { pending: 'En attente', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête au retrait', picked_up: 'Retirée', cancelled: 'Annulée', expired: 'Expirée' };
export default function MyOrders() {
  const l = useLoad(() => get('/portal/orders')); const [dlg, setDlg] = React.useState<any>(null); const [addr, setAddr] = React.useState(''); const [phone, setPhone] = React.useState('');
  const pay = async (o: any) => {
    try { const ms = await get('/payment-methods?channel=online'); if (!ms.length) return Alert.alert('Paiement', "Aucun mode de paiement en ligne n'est proposé.");
      const go = async (code: string) => { try { const r = await post(`/portal/orders/${o.id}/pay`, { method_code: code }); if (r.mode === 'redirect') Linking.openURL(r.checkout_url); else Alert.alert('Paiement enregistré', r.instructions); l.reload(); } catch (e) { err(e); } };
      if (ms.length === 1) return go(ms[0].code); Alert.alert('Payer en ligne', 'Choisissez un mode', [...ms.slice(0, 3).map((m: any) => ({ text: m.label, onPress: () => go(m.code) })), { text: 'Annuler', style: 'cancel' as const }]);
    } catch (e) { err(e); } };
  const deliver = async () => { try { await post(`/portal/orders/${dlg.id}/delivery`, { address: addr, phone }); setDlg(null); Alert.alert('Livraison', 'Demande envoyée. Suivez-la dans l\'onglet Livraisons.'); l.reload(); } catch (e) { err(e); } };
  return <View style={s.screen}><List {...l} empty={t('empty')} render={(o: any) => {
    const open = !['cancelled', 'expired', 'picked_up'].includes(o.status);
    return <View style={s.card}><View style={s.between}><Text style={s.h2}>{o.number}</Text><Badge text={LABEL[o.status] ?? o.status} kind={o.status === 'ready' ? 'ok' : ['cancelled', 'expired'].includes(o.status) ? 'bad' : 'warn'} /></View>
      <Text style={s.mute}>{o.created_at}{o.expires_at ? ` · expire ${o.expires_at}` : ''}</Text>
      <Text style={s.mute}>Total {money(o.total)} · Payé {money(o.paid)}</Text>
      {open && o.total - o.paid > 0 ? <Btn title="Payer en ligne" onPress={() => pay(o)} /> : null}
      {open && !o.delivery_id ? <Btn ghost title="Demander la livraison" onPress={() => { setAddr(''); setPhone(''); setDlg(o); }} /> : null}
    </View>; }} />
    <Modal visible={!!dlg} transparent animationType="slide" onRequestClose={() => setDlg(null)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}><View style={[s.card, { margin: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
      <Text style={s.h2}>Livraison {dlg?.number}</Text><Input placeholder="Adresse de livraison" value={addr} onChangeText={setAddr} /><Input placeholder="Téléphone joignable" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Btn title="Envoyer la demande" onPress={deliver} disabled={addr.trim().length < 5} /><Btn ghost title="Annuler" onPress={() => setDlg(null)} /></View></View></Modal></View>;
}
