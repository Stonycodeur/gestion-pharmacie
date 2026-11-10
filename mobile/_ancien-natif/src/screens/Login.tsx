import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { login } from '../api';
import { t } from '../i18n';
import { Btn, Input, s, C, err } from '../ui';

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [otp, setOtp] = useState(''), [needOtp, setNeedOtp] = useState(false), [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await login(email.trim(), pw, needOtp ? otp : undefined); onDone(); }
    catch (e: any) { if (e.code === 'OTP_REQUIRED') setNeedOtp(true); else err(e); }
    finally { setBusy(false); }
  }
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.screen, { justifyContent: 'center', padding: 24 }]}>
      <Text style={[s.h1, { color: C.brand }]}>Gestion Pharmacie</Text>
      <Input placeholder={t('email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="username" />
      <Input placeholder={t('password')} value={pw} onChangeText={setPw} secureTextEntry autoComplete="password" textContentType="password" />
      {needOtp && <Input placeholder={t('otp')} value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} autoFocus />}
      <Btn title={t('login')} onPress={go} disabled={busy || !email || !pw} />
    </KeyboardAvoidingView>
  );
}
