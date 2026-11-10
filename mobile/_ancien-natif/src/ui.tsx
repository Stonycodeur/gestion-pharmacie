import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, FlatList, RefreshControl, StyleSheet, Alert } from 'react-native';

export const C = { bg: '#f2f6f6', card: '#ffffff', ink: '#12302f', mute: '#5b7473', brand: '#0f766e', bad: '#b42318', warn: '#b54708', ok: '#067647', line: '#dbe5e4' };
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg }, pad: { padding: 14 }, card: { backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.line },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink, marginBottom: 10 }, h2: { fontSize: 16, fontWeight: '600', color: C.ink }, txt: { color: C.ink, fontSize: 15 }, mute: { color: C.mute, fontSize: 13 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, color: C.ink, marginBottom: 10 },
  btn: { backgroundColor: C.brand, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' }, btnTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  btnGhost: { borderWidth: 1, borderColor: C.brand, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kpi: { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.line }, kpiV: { fontSize: 20, fontWeight: '700', color: C.ink }, badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, fontSize: 12, overflow: 'hidden', color: '#fff' },
});
export const Btn = ({ title, onPress, ghost, disabled }: { title: string; onPress: () => void; ghost?: boolean; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[ghost ? s.btnGhost : s.btn, disabled && { opacity: 0.5 }]}><Text style={ghost ? { color: C.brand, fontWeight: '600', fontSize: 15 } : s.btnTxt}>{title}</Text></Pressable>
);
export const Badge = ({ text, kind }: { text: string; kind?: 'ok' | 'warn' | 'bad' | 'mute' }) => <Text style={[s.badge, { backgroundColor: kind === 'ok' ? C.ok : kind === 'bad' ? C.bad : kind === 'warn' ? C.warn : C.mute }]}>{text}</Text>;
export const Input = (p: React.ComponentProps<typeof TextInput>) => <TextInput placeholderTextColor={C.mute} autoCapitalize="none" {...p} style={[s.input, p.style]} />;
export const err = (e: any) => Alert.alert('Erreur', e?.message || String(e));

// Liste avec tirer-pour-rafraîchir et chargement
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null), [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (pull = false) => { pull ? setRefreshing(true) : setLoading(true); try { setData(await fn()); } catch (e) { err(e); } finally { setLoading(false); setRefreshing(false); } }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, loading, refreshing, reload: () => load(true) };
}
export function List<T>({ data, loading, refreshing, reload, render, empty }: { data: T[] | null; loading: boolean; refreshing: boolean; reload: () => void; render: (x: T) => React.ReactElement; empty: string }) {
  if (loading && !data) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  return <FlatList data={data ?? []} keyExtractor={(_, i) => String(i)} renderItem={({ item }) => render(item)} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />} ListEmptyComponent={<Text style={[s.mute, { textAlign: 'center', marginTop: 40 }]}>{empty}</Text>} />;
}
