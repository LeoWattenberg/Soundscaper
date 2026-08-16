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
