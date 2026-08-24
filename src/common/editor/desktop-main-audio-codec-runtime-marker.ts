/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact renderer-local marker for the main-process desktop audio broker. */
export const DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER: unique symbol = Symbol(
	'desktop-main-audio-codec-runtime',
);

export interface DesktopMainAudioCodecRuntimeMarker {
	readonly [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true;
}

export function isDesktopMainAudioCodecRuntime(
	value: unknown,
): value is DesktopMainAudioCodecRuntimeMarker {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
	return (descriptor as Readonly<{ value: unknown }>).value === true;
}
