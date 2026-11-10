import React from 'react';
import { unregisterPush } from '../push';
import { View, Text, Alert } from 'react-native';
import { session, logout } from '../api';
import { t, setLang, getLang, Lang } from '../i18n';
import { s, Btn } from '../ui';

export default function Account({ onLogout }: { onLogout: () => void }) {
  async function pick(l: Lang) { await setLang(l); if (l === 'ar') Alert.alert(t('language'), t('restart')); else Alert.alert(t('language'), 'OK'); }
  return (
    <View style={[s.screen, s.pad]}>
      <Text style={s.h1}>{t('account')}</Text>
      <View style={s.card}><Text style={s.h2}>{session.user?.name}</Text><Text style={s.mute}>{session.user?.email}</Text><Text style={s.mute}>{session.user?.role_code ?? session.user?.role}{session.pharmacy ? ` · ${session.pharmacy.name}` : ''}</Text></View>
      <Text style={[s.mute, { marginBottom: 6 }]}>{t('language')} ({getLang()})</Text>
      <View style={[s.row, { marginBottom: 20 }]}>{(['fr', 'en', 'ar'] as Lang[]).map((l) => <View key={l} style={{ flex: 1 }}><Btn ghost title={l.toUpperCase()} onPress={() => pick(l)} /></View>)}</View>
      <Btn title={t('logout')} onPress={async () => { await unregisterPush(); await logout(); onLogout(); }} />
    </View>
  );
}
