/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { audioEffectControlTracks } from '../../audio-effect-control-tracks.ts';
import { safeEffectLabel, samePresetParams } from './effect-helpers.ts';
import { effectAboutMetadata, type EffectAboutSubject } from './effect-about-metadata.ts';

export function useEffectPickerCatalog(types: readonly string[], copy: Readonly<Record<string, string>>) {
	return useMemo(() => types.map(value => { const label = safeEffectLabel(value, copy); return { value, label, search: label.toLocaleLowerCase() }; }), [copy, types]);
}
export function usePresetOptions<Presets extends Readonly<{ id: string; label: string; custom?: boolean }>>(presets: readonly Presets[], selectedId: string, unsaved: boolean, customLabel: string) {
	return useMemo(() => presets.map(preset => ({ ...preset, display: `${preset.label}${preset.custom ? ` (${customLabel})` : ''}${unsaved && preset.id === selectedId ? '*' : ''}` })), [customLabel, presets, selectedId, unsaved]);
}
export function useDefaultPresetEdited(enabled: boolean, current: Readonly<Record<string, unknown>> | null | undefined, defaults: Readonly<Record<string, unknown>> | null | undefined) {
	return useMemo(() => enabled && !samePresetParams(current, defaults), [current, defaults, enabled]);
}
export function useEffectAboutPresentation(open: boolean, effect: EffectAboutSubject | string | null, copy: Readonly<Record<string, string>>) {
	return useMemo(() => open && effect != null ? effectAboutMetadata(effect, copy) : null, [copy, effect, open]);
}
interface EffectTrack { readonly id: string; readonly type?: string; readonly name?: string; readonly clipIds?: readonly string[] }
export function useControlTrackOptions(tracks: readonly EffectTrack[] | undefined, targetTrackId: string | null | undefined, enabled: boolean) {
	return useMemo(() => enabled ? audioEffectControlTracks(tracks ?? [], targetTrackId).map(track => ({ value: track.id, label: track.name })) : [], [enabled, targetTrackId, tracks]);
}
