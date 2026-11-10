import React from 'react';
import { View, Text, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { get, post } from '../api';
import { t } from '../i18n';
import { s, useLoad, List, Badge, Btn, err } from '../ui';
import { RX } from './Prescriptions';

// L'ordonnance est seulement TRANSMISE : elle est vérifiée et validée par un pharmacien (aucune lecture automatique).
export default function MyPrescriptions() {
  const l = useLoad(() => get('/portal/prescriptions'));
  async function send(camera: boolean) {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!perm.granted) return;
    const r = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ['images'], quality: 0.7, base64: true, allowsEditing: false });
    const a = r.canceled ? null : r.assets[0]; if (!a?.base64) return;
    try { const p = await post('/portal/prescriptions', { file: { mime: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', data_base64: a.base64 } }); Alert.alert('Ordonnance envoyée', `${p.number} : un pharmacien va la vérifier.`); l.reload(); } catch (e) { err(e); }
  }
  return (
    <View style={s.screen}>
      <View style={[s.row, { padding: 14, paddingBottom: 0 }]}><View style={{ flex: 1 }}><Btn title="Photo" onPress={() => send(true)} /></View><View style={{ flex: 1 }}><Btn ghost title="Galerie" onPress={() => send(false)} /></View></View>
      <List {...l} empty={t('empty')} render={(p: any) => (
        <View style={s.card}><View style={s.between}><Text style={s.h2}>{p.number}</Text><Badge text={RX[p.status]?.[0] ?? p.status} kind={RX[p.status]?.[1]} /></View>
          {p.status_reason ? <Text style={s.mute}>{p.status_reason}</Text> : null}</View>)} />
    </View>
  );
}
