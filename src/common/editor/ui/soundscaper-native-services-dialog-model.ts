/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The native-services dialog as state and as a runner, kept apart from the view
 * so every decision it makes is testable without a browser.
 *
 * The runner is the only thing that talks to the preload bridge. It always
 * re-reads the tier after an action rather than believing its own optimistic
 * copy: consent, quarantine and the registry live in main, and a surface that
 * drew what it hoped had happened would be the exact class of lie a quarantine
 * exists to prevent.
 */

import type {
	NativeAudioAvailability,
	NativeAudioInventoryOutcome,
	NativePluginAvailability,
	NativePluginConsentAction,
	NativePluginQuarantineClearance,
	NativePluginRegistryView,
	NativePluginScanEntry,
	SoundscaperNativeServicesBridge,
} from './soundscaper-native-services-bridge.ts';

export interface SoundscaperNativeScanState {
	readonly format: string;
	readonly rootId: string;
	readonly running: boolean;
	/** The helper's own scan status, or 'failed' when the tier refused. */
	readonly status: string;
	readonly detail: string;
	readonly entries: readonly NativePluginScanEntry[];
}

export interface SoundscaperNativeServicesDialogState {
	readonly audio: NativeAudioAvailability | null;
	readonly plugins: NativePluginAvailability | null;
	readonly registry: NativePluginRegistryView | null;
	readonly devices: NativeAudioInventoryOutcome | null;
	readonly scans: Readonly<Record<string, SoundscaperNativeScanState>>;
	readonly pending: string | null;
	readonly completed: string | null;
	readonly error: string;
}

export type SoundscaperNativeServicesDialogAction =
	| Readonly<{ type: 'refresh' }>
	| Readonly<{ type: 'describe-devices'; backend: string }>
	| Readonly<{
		type: 'consent';
		format: string;
		consent: NativePluginConsentAction;
		rootId?: string;
	}>
	| Readonly<{ type: 'scan'; format: string; rootId: string }>
	| Readonly<{
		type: 'clear-quarantine';
		digest: string;
		clearance: NativePluginQuarantineClearance;
	}>;

export type SoundscaperNativeServicesDialogEvent =
	| Readonly<{ type: 'begin'; action: SoundscaperNativeServicesDialogAction }>
	| Readonly<{
		type: 'settled';
		action: SoundscaperNativeServicesDialogAction;
		result: SoundscaperNativeServicesActionResult;
	}>
	| Readonly<{ type: 'failed'; action: SoundscaperNativeServicesDialogAction; message: string }>;

export interface SoundscaperNativeServicesActionResult {
	readonly audio?: NativeAudioAvailability;
	readonly plugins?: NativePluginAvailability;
	readonly registry?: NativePluginRegistryView;
	readonly devices?: NativeAudioInventoryOutcome;
	readonly scan?: SoundscaperNativeScanState;
}

export const EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE: SoundscaperNativeServicesDialogState =
	Object.freeze({
		audio: null,
		plugins: null,
		registry: null,
		devices: null,
		scans: Object.freeze({}),
		pending: null,
		completed: null,
		error: '',
	});

/** One stable key per action, so a scan's progress belongs to its own root. */
export function soundscaperNativeServicesActionKey(
	action: SoundscaperNativeServicesDialogAction,
): string {
	if (action.type === 'scan') return `scan:${action.format}:${action.rootId}`;
	if (action.type === 'consent') return `consent:${action.format}:${action.consent}:${action.rootId ?? ''}`;
	if (action.type === 'describe-devices') return `describe-devices:${action.backend}`;
	if (action.type === 'clear-quarantine') return `clear-quarantine:${action.digest}:${action.clearance}`;
	return 'refresh';
}

export function reduceSoundscaperNativeServicesDialog(
	state: SoundscaperNativeServicesDialogState,
	event: SoundscaperNativeServicesDialogEvent,
): SoundscaperNativeServicesDialogState {
	const key = soundscaperNativeServicesActionKey(event.action);
	if (event.type === 'begin') {
		return Object.freeze({
			...state,
			pending: key,
			completed: null,
			error: '',
			scans: event.action.type === 'scan'
				? withScan(state.scans, key, {
					format: event.action.format,
					rootId: event.action.rootId,
					running: true,
					status: '',
					detail: '',
					entries: Object.freeze([]),
				})
				: state.scans,
		});
	}
	if (event.type === 'failed') {
		return Object.freeze({
			...state,
			pending: null,
			completed: null,
			error: event.message,
			scans: event.action.type === 'scan'
				? withScan(state.scans, key, {
					format: event.action.format,
					rootId: event.action.rootId,
					running: false,
					status: 'failed',
					detail: event.message,
					entries: Object.freeze([]),
				})
				: state.scans,
		});
	}
	const result = event.result;
	return Object.freeze({
		...state,
		audio: result.audio ?? state.audio,
		plugins: result.plugins ?? state.plugins,
		registry: result.registry ?? state.registry,
		devices: result.devices ?? state.devices,
		scans: result.scan ? withScan(state.scans, key, result.scan) : state.scans,
		pending: null,
		completed: key,
		error: '',
	});
}

export async function runSoundscaperNativeServicesAction(
	bridge: SoundscaperNativeServicesBridge,
	action: SoundscaperNativeServicesDialogAction,
): Promise<SoundscaperNativeServicesDialogEvent> {
	try {
		return Object.freeze({ type: 'settled' as const, action, result: await perform(bridge, action) });
	} catch (error) {
		return Object.freeze({
			type: 'failed' as const,
			action,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

async function perform(
	bridge: SoundscaperNativeServicesBridge,
	action: SoundscaperNativeServicesDialogAction,
): Promise<SoundscaperNativeServicesActionResult> {
	if (action.type === 'refresh') {
		const [audio, plugins, registry] = await Promise.all([
			bridge.nativeAudioHelperAvailability(),
			bridge.nativePluginAvailability(),
			bridge.listNativePlugins(),
		]);
		return Object.freeze({ audio, plugins, registry });
	}
	if (action.type === 'describe-devices') {
		return Object.freeze({ devices: await bridge.describeNativeAudioBackend({ backend: action.backend }) });
	}
	if (action.type === 'consent') {
		await bridge.setNativePluginConsent({
			format: action.format,
			action: action.consent,
			rootId: action.rootId ?? '',
		});
		return Object.freeze({ plugins: await bridge.nativePluginAvailability() });
	}
	if (action.type === 'scan') {
		const outcome = await bridge.scanNativePlugins({ format: action.format, rootId: action.rootId });
		const [registry, plugins] = await Promise.all([
			bridge.listNativePlugins(),
			bridge.nativePluginAvailability(),
		]);
		return Object.freeze({
			registry,
			plugins,
			scan: outcome.status === 'described'
				? Object.freeze({
					format: action.format,
					rootId: action.rootId,
					running: false,
					status: outcome.scan.status,
					detail: outcome.scan.detail,
					entries: Object.freeze([...outcome.scan.entries]),
				})
				: Object.freeze({
					format: action.format,
					rootId: action.rootId,
					running: false,
					status: 'failed',
					detail: outcome.message,
					entries: Object.freeze([]),
				}),
		});
	}
	const clear = bridge.clearNativePluginQuarantine;
	if (typeof clear !== 'function') {
		throw new Error('This desktop build cannot clear a native plug-in quarantine.');
	}
	await clear.call(bridge, { digest: action.digest, clearance: action.clearance });
	return Object.freeze({ plugins: await bridge.nativePluginAvailability() });
}

function withScan(
	scans: Readonly<Record<string, SoundscaperNativeScanState>>,
	key: string,
	scan: SoundscaperNativeScanState,
): Readonly<Record<string, SoundscaperNativeScanState>> {
	return Object.freeze({ ...scans, [key]: Object.freeze(scan) });
}
