/* SPDX-License-Identifier: AGPL-3.0-only */

/** The five former native-menu actions, now exposed through one closed main API. */
export const DESKTOP_NATIVE_TIER_CONTROL_ACTIONS = Object.freeze([
	'set-probe-helper-enabled',
	'clear-probe-helper-quarantine',
	'set-audio-helper-enabled',
	'clear-audio-helper-quarantine',
	'set-native-effect-discovery-enabled',
] as const);

export type DesktopNativeTierControlAction =
	(typeof DESKTOP_NATIVE_TIER_CONTROL_ACTIONS)[number];

export interface DesktopNativeTierControlsSnapshot {
	readonly probeHelperEnabled: boolean;
	readonly probeHelperQuarantined: boolean;
	readonly audioHelperEnabled: boolean;
	readonly audioHelperQuarantined: boolean;
	readonly nativeEffectDiscoveryEnabled: boolean;
}

export type DesktopNativeTierControlRequest =
	| Readonly<{
		readonly action:
			| 'set-probe-helper-enabled'
			| 'set-audio-helper-enabled'
			| 'set-native-effect-discovery-enabled';
		readonly enabled: boolean;
	}>
	| Readonly<{
		readonly action:
			| 'clear-probe-helper-quarantine'
			| 'clear-audio-helper-quarantine';
	}>;

interface DesktopNativeTierControlSettings {
	snapshot(): Readonly<{
		nativeProbeHelperEnabled: boolean;
		nativeAudioHelperEnabled: boolean;
		nativePluginDiscoveryEnabled: boolean;
	}>;
	setNativeProbeHelperEnabled(enabled: boolean): Promise<boolean> | boolean;
}

interface DesktopNativeTierControlServices {
	readonly probe: {
		availability(): Readonly<{ enabled: boolean; quarantined: boolean }>;
		clearQuarantine(): void;
	};
	readonly audio: {
		controlSnapshot(): Readonly<{ enabled: boolean; quarantined: boolean }>;
		setEnabled(enabled: boolean): Promise<boolean> | boolean;
		clearQuarantine(): void;
	};
	readonly plugins: {
		setEnabled(enabled: boolean): Promise<boolean> | boolean;
	};
}

interface DesktopNativeTierControlRegistration {
	readonly channels: unknown;
	readonly handle: (
		channel: string,
		listener: (event: unknown, value?: unknown) => unknown,
	) => void;
	readonly ownerFor: (event: unknown) => object;
	readonly settings: DesktopNativeTierControlSettings;
	readonly tier: DesktopNativeTierControlServices;
}

/** A cheap projection: it never re-verifies or reads the native payload bytes. */
export function readDesktopNativeTierControls(
	settings: DesktopNativeTierControlSettings,
	tier: DesktopNativeTierControlServices,
): DesktopNativeTierControlsSnapshot {
	const durable = settings.snapshot();
	const probe = tier.probe.availability();
	const audio = tier.audio.controlSnapshot();
	return Object.freeze({
		probeHelperEnabled: durable.nativeProbeHelperEnabled === true,
		probeHelperQuarantined: probe.quarantined === true,
		audioHelperEnabled: durable.nativeAudioHelperEnabled === true,
		audioHelperQuarantined: audio.quarantined === true,
		nativeEffectDiscoveryEnabled: durable.nativePluginDiscoveryEnabled === true,
	});
}

/** Apply exactly one admitted action, then return the state the renderer should publish. */
export async function applyDesktopNativeTierControl(
	value: unknown,
	settings: DesktopNativeTierControlSettings,
	tier: DesktopNativeTierControlServices,
): Promise<DesktopNativeTierControlsSnapshot> {
	const request = desktopNativeTierControlRequest(value);
	switch (request.action) {
		case 'set-probe-helper-enabled':
			await settings.setNativeProbeHelperEnabled(request.enabled);
			break;
		case 'clear-probe-helper-quarantine':
			tier.probe.clearQuarantine();
			break;
		case 'set-audio-helper-enabled':
			await tier.audio.setEnabled(request.enabled);
			break;
		case 'clear-audio-helper-quarantine':
			tier.audio.clearQuarantine();
			break;
		case 'set-native-effect-discovery-enabled':
			await tier.plugins.setEnabled(request.enabled);
			break;
	}
	return readDesktopNativeTierControls(settings, tier);
}

/** Register the read/apply pair through main's trusted IPC wrapper. */
export function registerDesktopNativeTierControls(
	options: DesktopNativeTierControlRegistration,
): void {
	const channels = controlChannels(options.channels);
	options.handle(channels.nativeTierControls, () => (
		readDesktopNativeTierControls(options.settings, options.tier)
	));
	options.handle(channels.nativeTierApply, (event, value) => {
		void options.ownerFor(event);
		return applyDesktopNativeTierControl(value, options.settings, options.tier);
	});
}

function desktopNativeTierControlRequest(value: unknown): DesktopNativeTierControlRequest {
	if (!isRecord(value) || typeof value.action !== 'string') {
		throw new TypeError('A valid native-tier control request is required.');
	}
	const action = value.action as DesktopNativeTierControlAction;
	if (!(DESKTOP_NATIVE_TIER_CONTROL_ACTIONS as readonly string[]).includes(action)) {
		throw new TypeError('Unsupported native-tier control action.');
	}
	const setsEnabled = action === 'set-probe-helper-enabled'
		|| action === 'set-audio-helper-enabled'
		|| action === 'set-native-effect-discovery-enabled';
	const expected = setsEnabled ? ['action', 'enabled'] : ['action'];
	if (!sameFields(value, expected)) {
		throw new TypeError('The native-tier control request has invalid fields.');
	}
	if (setsEnabled && typeof value.enabled !== 'boolean') {
		throw new TypeError('A native-tier enabled control must be a boolean.');
	}
	return value as unknown as DesktopNativeTierControlRequest;
}

function controlChannels(value: unknown): Readonly<{
	nativeTierControls: string;
	nativeTierApply: string;
}> {
	if (!isRecord(value)
		|| typeof value.nativeTierControls !== 'string'
		|| value.nativeTierControls.length === 0
		|| typeof value.nativeTierApply !== 'string'
		|| value.nativeTierApply.length === 0
		|| value.nativeTierControls === value.nativeTierApply) {
		throw new TypeError('Distinct native-tier control channels are required.');
	}
	return Object.freeze({
		nativeTierControls: value.nativeTierControls,
		nativeTierApply: value.nativeTierApply,
	});
}

function sameFields(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
	const fields = Object.keys(value).sort();
	return fields.length === expected.length
		&& expected.every((field, index) => fields[index] === field);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
