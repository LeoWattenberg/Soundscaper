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
	NativeAudioSessionOpenRequestV1,
	NativeAudioSessionProjectionV1,
	NativePluginAvailability,
	NativePluginConsentAction,
	NativePluginInstanceProjectionV1,
	NativePluginOfflineOutcomeV1,
	NativePluginQuarantineClearance,
	NativePluginRegistryView,
	NativePluginScanEntry,
	NativePluginStateBodyV1,
	NativePluginVendorWindowV1,
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
	readonly audioSession: NativeAudioSessionProjectionV1 | null;
	readonly pluginInstance: NativePluginInstanceProjectionV1 | null;
	readonly pluginOffline: NativePluginOfflineOutcomeV1 | null;
	readonly pluginStateBody: NativePluginStateBodyV1 | null;
	readonly pluginStateGeneration: number;
	readonly pluginVendorWindow: NativePluginVendorWindowV1 | null;
	readonly scans: Readonly<Record<string, SoundscaperNativeScanState>>;
	readonly pending: string | null;
	readonly completed: string | null;
	readonly error: string;
}

export type SoundscaperNativeServicesDialogAction =
	| Readonly<{ type: 'refresh' }>
	| Readonly<{ type: 'set-audio-enabled'; enabled: boolean }>
	| Readonly<{ type: 'describe-devices'; backend: string }>
	| Readonly<{ type: 'open-audio-session'; request: NativeAudioSessionOpenRequestV1 }>
	| Readonly<{ type: 'bind-audio-session'; sessionId: string }>
	| Readonly<{ type: 'audio-session-status'; sessionId: string }>
	| Readonly<{ type: 'calibrate-audio-session'; sessionId: string }>
	| Readonly<{ type: 'close-audio-session'; sessionId: string }>
	| Readonly<{
		type: 'consent';
		format: string;
		consent: NativePluginConsentAction;
		rootId?: string;
	}>
	| Readonly<{ type: 'scan'; format: string; rootId: string }>
	| Readonly<{ type: 'review-plugin'; installationId: string; review: 'allow' | 'select' | 'revoke' }>
	| Readonly<{ type: 'instantiate-plugin'; installationId: string }>
	| Readonly<{ type: 'run-plugin-offline'; instanceId: string }>
	| Readonly<{ type: 'set-plugin-bypassed'; instanceId: string; bypassed: boolean }>
	| Readonly<{
		type: 'persist-plugin-state'; instanceId: string; generation: number; bytes?: Uint8Array;
	}>
	| Readonly<{
		type: 'restore-plugin-state'; instanceId: string; generation: number;
		stateBody: NativePluginStateBodyV1;
	}>
	| Readonly<{ type: 'open-plugin-vendor-ui'; instanceId: string }>
	| Readonly<{ type: 'close-plugin-vendor-ui'; instanceId: string; windowHandleId: string }>
	| Readonly<{ type: 'close-plugin'; instanceId: string }>
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
	readonly audioSession?: NativeAudioSessionProjectionV1;
	readonly pluginInstance?: NativePluginInstanceProjectionV1;
	readonly pluginOffline?: NativePluginOfflineOutcomeV1;
	readonly pluginStateBody?: NativePluginStateBodyV1;
	readonly pluginStateGeneration?: number;
	readonly pluginVendorWindow?: SoundscaperNativeServicesDialogState['pluginVendorWindow'];
	readonly scan?: SoundscaperNativeScanState;
}

export const EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE: SoundscaperNativeServicesDialogState =
	Object.freeze({
		audio: null,
		plugins: null,
		registry: null,
		devices: null,
		audioSession: null,
		pluginInstance: null,
		pluginOffline: null,
		pluginStateBody: null,
		pluginStateGeneration: 0,
		pluginVendorWindow: null,
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
	if (action.type === 'set-audio-enabled') return `set-audio-enabled:${String(action.enabled)}`;
	if (action.type === 'clear-quarantine') return `clear-quarantine:${action.digest}:${action.clearance}`;
	if (action.type === 'open-audio-session') return 'open-audio-session';
	if (action.type === 'bind-audio-session') return `bind-audio-session:${action.sessionId}`;
	if (action.type === 'audio-session-status') return `audio-session-status:${action.sessionId}`;
	if (action.type === 'calibrate-audio-session') return `calibrate-audio-session:${action.sessionId}`;
	if (action.type === 'close-audio-session') return `close-audio-session:${action.sessionId}`;
	if (action.type === 'review-plugin') return `review-plugin:${action.review}:${action.installationId}`;
	if (action.type === 'instantiate-plugin') return `instantiate-plugin:${action.installationId}`;
	if (action.type === 'run-plugin-offline') return `run-plugin-offline:${action.instanceId}`;
	if (action.type === 'set-plugin-bypassed') return `bypass-plugin:${action.instanceId}:${String(action.bypassed)}`;
	if (action.type === 'persist-plugin-state') return `persist-plugin-state:${action.instanceId}`;
	if (action.type === 'restore-plugin-state') return `restore-plugin-state:${action.instanceId}`;
	if (action.type === 'open-plugin-vendor-ui') return `open-plugin-vendor-ui:${action.instanceId}`;
	if (action.type === 'close-plugin-vendor-ui') return `close-plugin-vendor-ui:${action.instanceId}`;
	if (action.type === 'close-plugin') return `close-plugin:${action.instanceId}`;
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
		devices: event.action.type === 'set-audio-enabled' && !event.action.enabled
			? null
			: result.devices ?? state.devices,
		audioSession: event.action.type === 'close-audio-session'
			|| (event.action.type === 'set-audio-enabled' && !event.action.enabled)
			? null
			: result.audioSession ?? state.audioSession,
		pluginInstance: event.action.type === 'close-plugin'
			? null
			: result.pluginInstance ?? state.pluginInstance,
		pluginOffline: event.action.type === 'close-plugin'
			? null
			: result.pluginOffline ?? state.pluginOffline,
		pluginStateBody: result.pluginStateBody ?? state.pluginStateBody,
		pluginStateGeneration: result.pluginStateGeneration ?? state.pluginStateGeneration,
		pluginVendorWindow: event.action.type === 'close-plugin' || event.action.type === 'close-plugin-vendor-ui'
			? null
			: result.pluginVendorWindow ?? state.pluginVendorWindow,
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
	if (action.type === 'set-audio-enabled') {
		await bridge.setNativeAudioHelperEnabled(action.enabled);
		return Object.freeze({ audio: await bridge.nativeAudioHelperAvailability() });
	}
	if (action.type === 'open-audio-session') {
		const opened = await bridge.openNativeAudioSession(action.request);
		if (opened.status !== 'opened') throw new Error(opened.message);
		return Object.freeze({
			audioSession: await bridge.nativeAudioSessionStatus({ sessionId: opened.sessionId }),
		});
	}
	if (action.type === 'bind-audio-session') {
		await bridge.bindNativeAudioSession({ sessionId: action.sessionId, queueCapacity: 8 });
		return Object.freeze({
			audioSession: await bridge.nativeAudioSessionStatus({ sessionId: action.sessionId }),
		});
	}
	if (action.type === 'audio-session-status') {
		return Object.freeze({
			audioSession: await bridge.nativeAudioSessionStatus({ sessionId: action.sessionId }),
		});
	}
	if (action.type === 'calibrate-audio-session') {
		return Object.freeze({
			audioSession: await bridge.calibrateNativeAudioSession({ sessionId: action.sessionId }),
		});
	}
	if (action.type === 'close-audio-session') {
		if (!await bridge.closeNativeAudioSession({ sessionId: action.sessionId })) {
			throw new Error('The native audio session did not close.');
		}
		return Object.freeze({});
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
	if (action.type === 'review-plugin') {
		return Object.freeze({
			registry: await bridge.reviewNativePluginInstallation({
				installationId: action.installationId, action: action.review,
			}),
		});
	}
	if (action.type === 'instantiate-plugin') {
		return Object.freeze({
			pluginInstance: await bridge.instantiateNativePlugin({
				installationId: action.installationId, instanceId: null,
			}),
		});
	}
	if (action.type === 'run-plugin-offline') {
		const pluginOffline = await bridge.runNativePluginOffline({ instanceId: action.instanceId });
		return Object.freeze({ pluginOffline, pluginInstance: pluginOffline.instance });
	}
	if (action.type === 'set-plugin-bypassed') {
		return Object.freeze({ pluginInstance: await bridge.setNativePluginBypassed({
			instanceId: action.instanceId, bypassed: action.bypassed,
		}) });
	}
	if (action.type === 'persist-plugin-state') {
		const persisted = await bridge.persistNativePluginState({
			instanceId: action.instanceId, generation: action.generation,
		});
		if (persisted.outcome.status !== 'persisted' || persisted.projectState === null) {
			throw new Error('The native plug-in state was not admitted.');
		}
		return Object.freeze({
			pluginStateBody: persisted.projectState.stateBody,
			pluginStateGeneration: action.generation,
		});
	}
	if (action.type === 'restore-plugin-state') {
		await bridge.restoreNativePluginState({
			instanceId: action.instanceId, generation: action.generation, stateBody: action.stateBody,
		});
		return Object.freeze({ pluginStateGeneration: action.generation });
	}
	if (action.type === 'open-plugin-vendor-ui') {
		const outcome = await bridge.openNativePluginVendorUi({ instanceId: action.instanceId });
		if (outcome.status !== 'opened') throw new Error(outcome.message);
		return Object.freeze({ pluginVendorWindow: outcome.window });
	}
	if (action.type === 'close-plugin-vendor-ui') {
		if (!await bridge.closeNativePluginVendorUi({
			instanceId: action.instanceId, windowHandleId: action.windowHandleId,
		})) throw new Error('The native plug-in vendor window did not close.');
		return Object.freeze({ pluginVendorWindow: null });
	}
	if (action.type === 'close-plugin') {
		if (!await bridge.closeNativePluginInstance({ instanceId: action.instanceId })) {
			throw new Error('The native plug-in instance did not close.');
		}
		return Object.freeze({});
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
