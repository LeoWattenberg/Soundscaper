/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Every milestone-5A native surface, reached through an existing menu family
 * and opened lazily.
 *
 * Nothing here adds always-visible chrome: no toolbar control, no panel, no
 * side rail, no badge. Framescaper receives none of it, because a native audio
 * device and effect tier is not part of that product.
 *
 * Two entries stay reachable even while the native tier is switched off or
 * unavailable — the preferences pane and the effect manage surface. They are
 * how a user turns the tier on and how they clear a quarantine, so gating them
 * on the capability they exist to change would be a trap the user cannot escape
 * from inside the application. Everything else is disabled with the capability
 * it needs, and every disabled entry says WHY rather than simply going grey:
 * "no native effect format is enabled yet" is a different problem from
 * "the helper is quarantined", and the user can only act on the difference if
 * we tell them which one it is.
 */

import {
	resolveSoundscaperNativeServicesCopy,
	type SoundscaperNativeServicesCopy,
} from './soundscaper-native-services-copy.ts';

export const SOUNDSCAPER_NATIVE_SERVICE_SURFACES = Object.freeze([
	'native-audio-device',
	'native-audio-preferences',
	'native-effect-scan',
	'native-effect-manage',
] as const);

export type SoundscaperNativeServiceSurface =
	(typeof SOUNDSCAPER_NATIVE_SERVICE_SURFACES)[number];

/** Surfaces that must stay reachable so the user can enable or repair the tier. */
export const SOUNDSCAPER_ALWAYS_REACHABLE_SURFACES: readonly SoundscaperNativeServiceSurface[] =
	Object.freeze(['native-audio-preferences', 'native-effect-manage']);

export interface SoundscaperNativeServicesMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	/** Why the entry is disabled, for the accessible name; empty when enabled. */
	readonly disabledReason: string;
	readonly items?: readonly SoundscaperNativeServicesMenuItem[];
	onClick?(): unknown;
}

export interface SoundscaperNativeServicesMenuItems {
	readonly tools: readonly SoundscaperNativeServicesMenuItem[];
	readonly effect: readonly SoundscaperNativeServicesMenuItem[];
}

/**
 * What the renderer knows about the native tier. It is deliberately a report of
 * status and never of mechanism: no payload path, no backend library name, no
 * plug-in binary path appears here, because none of those ever cross the
 * preload bridge.
 */
export interface SoundscaperNativeServicesSnapshot {
	readonly enabled: boolean;
	readonly quarantined: boolean;
	readonly payloadAvailable: boolean;
	readonly payloadDetail: string;
	readonly usableAudioBackends: readonly string[];
	readonly enabledPluginFormats: readonly string[];
}

export interface SoundscaperNativeServicesMenuInput {
	readonly productId: string;
	readonly runtimeAvailable: boolean;
	readonly snapshot: SoundscaperNativeServicesSnapshot | null;
	readonly editingBlocked?: boolean;
	readonly readOnly?: boolean;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

export interface SoundscaperNativeServicesMenuActions {
	open(surface: SoundscaperNativeServiceSurface): unknown;
}

const EMPTY: SoundscaperNativeServicesMenuItems = Object.freeze({
	tools: Object.freeze([]),
	effect: Object.freeze([]),
});

export function createSoundscaperNativeServicesMenuItems(
	input: SoundscaperNativeServicesMenuInput,
	actions: SoundscaperNativeServicesMenuActions,
): SoundscaperNativeServicesMenuItems {
	// A build with no native runtime at all — the browser editor — gets no
	// native entries whatsoever rather than a menu full of permanently grey
	// rows advertising a tier that product cannot have.
	if (input.productId !== 'soundscaper' || !input.runtimeAvailable || input.snapshot === null) return EMPTY;
	const copy = resolveSoundscaperNativeServicesCopy(input.copy);
	const snapshot = input.snapshot;
	const reason = unavailableReason(copy, snapshot);

	const audioDevice = entry({
		id: 'native-audio-device',
		label: copy.audioDeviceSettings,
		// A tier that is on and healthy but has no usable backend is a different
		// problem again, and naming it is the only way a user can tell that
		// enabling the tier is not what is missing.
		disabledReason: reason
			?? (snapshot.usableAudioBackends.length === 0 ? copy.audioBackendUnavailable : null),
		open: actions.open,
	});
	const audioPreferences = entry({
		id: 'native-audio-preferences',
		label: copy.nativeAudioPreferences,
		disabledReason: null,
		open: actions.open,
	});
	const scan = entry({
		id: 'native-effect-scan',
		label: copy.pluginScan,
		disabledReason: reason
			?? (input.editingBlocked === true || input.readOnly === true ? copy.projectReadOnly : null)
			?? (snapshot.enabledPluginFormats.length === 0 ? copy.pluginFormatsBlocked : null),
		open: actions.open,
	});
	const manage = entry({
		id: 'native-effect-manage',
		label: copy.pluginManage,
		disabledReason: null,
		open: actions.open,
	});

	return Object.freeze({
		tools: Object.freeze([
			group('native-audio', copy.audioDevices, [audioDevice, audioPreferences]),
		]),
		effect: Object.freeze([
			group('native-effects', copy.audioPluginEffects, [scan, manage]),
		]),
	});
}

function unavailableReason(
	copy: SoundscaperNativeServicesCopy,
	snapshot: SoundscaperNativeServicesSnapshot,
): string | null {
	if (snapshot.quarantined) return copy.audioHelperQuarantined;
	if (!snapshot.payloadAvailable) return snapshot.payloadDetail || copy.audioBackendUnavailable;
	if (!snapshot.enabled) return copy.nativeAudioDisabled;
	return null;
}

function entry({ id, label, disabledReason, open }: Readonly<{
	id: SoundscaperNativeServiceSurface;
	label: string;
	disabledReason: string | null;
	open: (surface: SoundscaperNativeServiceSurface) => unknown;
}>): SoundscaperNativeServicesMenuItem {
	const disabled = disabledReason !== null;
	return Object.freeze({
		id,
		label,
		disabled,
		disabledReason: disabled ? disabledReason : '',
		...(disabled ? {} : { onClick: () => open(id) }),
	});
}

function group(
	id: string,
	label: string,
	items: readonly SoundscaperNativeServicesMenuItem[],
): SoundscaperNativeServicesMenuItem {
	return Object.freeze({
		id,
		label,
		// A group whose every child is disabled is itself disabled, so the user
		// is not invited into a submenu with nothing actionable in it.
		disabled: items.every((item) => item.disabled),
		disabledReason: '',
		items: Object.freeze([...items]),
	});
}
