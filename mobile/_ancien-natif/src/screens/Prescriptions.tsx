import React from 'react';
import { View, Text } from 'react-native';
import { get } from '../api';
import { t } from '../i18n';
import { s, useLoad, List, Badge } from '../ui';

export const RX: Record<string, [string, 'ok' | 'warn' | 'bad' | 'mute']> = { received: ['Reçue', 'mute'], to_verify: ['À vérifier', 'warn'], complement_requested: ['Complément demandé', 'warn'], validated: ['Validée', 'ok'], partially_delivered: ['Partiellement délivrée', 'ok'], delivered: ['Délivrée', 'ok'], rejected: ['Refusée', 'bad'] };

// Consultation uniquement : la validation pharmaceutique (liste de contrôle, lignes, posologie) reste sur le poste de travail web, par conception.
export default function Prescriptions() {
  const l = useLoad(async () => (await get('/prescriptions?limit=50')).data);
  return (
    <View style={s.screen}>
      <List {...l} empty={t('empty')} render={(p: any) => (
        <View style={s.card}>
          <View style={s.between}><Text style={s.h2}>{p.number}</Text><Badge text={RX[p.status]?.[0] ?? p.status} kind={RX[p.status]?.[1]} /></View>
          <Text style={s.mute}>{p.patient_name}{p.prescriber_name ? ` · Dr ${p.prescriber_name}` : ''}</Text>
        </View>)} />
    </View>
  );
}
