/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_NATIVE_SERVICES_COPY = Object.freeze({
	importImageSequence: 'Image sequence…',
	addToRenderQueue: 'Add to render queue…',
	externalDisplay: 'External display',
	externalDisplayNone: 'None',
	externalDisplayUnavailable: 'No non-primary display available',
	backgroundJobs: 'Background jobs…',
	watchFolders: 'Watch folders…',
	proxies: 'Proxies',
	proxyGenerate: 'Generate…',
	proxyAttach: 'Attach…',
	proxyDetach: 'Detach',
	proxyRelink: 'Relink…',
	nativeMediaPreferences: 'Native media and scratch…',
	videoEffects: 'Video effects',
	ofxAdd: 'Add OFX…',
	ofxManage: 'Manage OFX…',
});

export type FramescaperNativeServicesCopy = Readonly<{
	[Key in keyof typeof FRAMESCAPER_NATIVE_SERVICES_COPY]: string;
}>;

/** Resolve optional host localization without requiring a shared catalog change. */
export function resolveFramescaperNativeServicesCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): FramescaperNativeServicesCopy {
	const output: { -readonly [Key in keyof FramescaperNativeServicesCopy]: string } = {
		...FRAMESCAPER_NATIVE_SERVICES_COPY,
	};
	for (const key of Object.keys(output) as (keyof FramescaperNativeServicesCopy)[]) {
		const candidate = copy[key];
		if (typeof candidate === 'string' && candidate.length > 0) output[key] = candidate;
	}
	return Object.freeze(output);
}
