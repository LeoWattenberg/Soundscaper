/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOUNDSCAPER_NATIVE_SERVICES_COPY = Object.freeze({
	audioDevices: 'Audio devices',
	audioDeviceSettings: 'Native audio device…',
	audioBackendUnavailable: 'No native audio backend is available',
	nativeAudioPreferences: 'Native audio and latency…',
	audioHelperQuarantined: 'Native audio helper is quarantined',
	nativeAudioDisabled: 'Native audio is switched off',
	projectReadOnly: 'The project is read-only',
	audioPluginEffects: 'Native effects',
	pluginScan: 'Scan for effects…',
	pluginManage: 'Manage native effects…',
	pluginFormatsBlocked: 'No native effect format is enabled yet',
	nativeServices: 'Native audio and effects',
	nativeServiceSurfaces: 'Native service surfaces',
	tabAudioDevice: 'Devices',
	tabAudioPreferences: 'Native audio',
	tabEffectScan: 'Scan',
	tabEffectManage: 'Installed',
	refresh: 'Refresh',
	working: 'Working…',
	operationComplete: 'Done',
	audioBackends: 'Audio backends',
	listDevices: 'List devices',
	noDevices: 'No devices were reported.',
	tierEnabled: 'Native audio is on.',
	tierDisabled: 'Native audio is off. Turn it on from the desktop Tools menu.',
	discoveryDisabled: 'Native effect discovery is off. Turn it on from the desktop Tools menu.',
	formatUnsupported: 'Not available on this system',
	grantFormat: 'Allow scanning',
	revokeFormat: 'Stop scanning',
	admitRoot: 'Admit folder',
	chooseFolder: 'Choose a folder…',
	scanRoot: 'Scan',
	scanRunning: 'Scanning…',
	scanEntries: 'Plug-ins found',
	noRoots: 'No folder is admitted for this format yet.',
	installedPlugins: 'Installed native effects',
	noInstalledPlugins: 'Nothing has been discovered yet.',
	quarantinedPlugins: 'Quarantined plug-ins',
	noQuarantine: 'Nothing is quarantined.',
	clearByRescan: 'Clear and rescan',
	clearByReEnable: 'Clear and re-enable',
});

export type SoundscaperNativeServicesCopy = Readonly<{
	[Key in keyof typeof SOUNDSCAPER_NATIVE_SERVICES_COPY]: string;
}>;

/** Resolve optional host localization without requiring a shared catalog change. */
export function resolveSoundscaperNativeServicesCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): SoundscaperNativeServicesCopy {
	const output: { -readonly [Key in keyof SoundscaperNativeServicesCopy]: string } = {
		...SOUNDSCAPER_NATIVE_SERVICES_COPY,
	};
	for (const key of Object.keys(output) as (keyof SoundscaperNativeServicesCopy)[]) {
		const candidate = copy[key];
		if (typeof candidate === 'string' && candidate.length > 0) output[key] = candidate;
	}
	return Object.freeze(output);
}
