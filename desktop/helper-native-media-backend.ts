/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact encoder backends allowed to cross the helper wire. */
export const HELPER_NATIVE_MEDIA_ENCODE_BACKENDS = Object.freeze([
	'native-cpu', 'media-foundation', 'qsv', 'nvenc', 'amf', 'videotoolbox', 'vaapi',
] as const);

export type HelperNativeMediaEncodeBackend =
	(typeof HELPER_NATIVE_MEDIA_ENCODE_BACKENDS)[number];

export function validateHelperNativeMediaEncodeBackend(
	value: unknown,
): HelperNativeMediaEncodeBackend {
	if (typeof value !== 'string'
		|| !(HELPER_NATIVE_MEDIA_ENCODE_BACKENDS as readonly string[]).includes(value)) {
		throw new TypeError('A native media encode grant requires one exact CPU or hardware encoder backend.');
	}
	return value as HelperNativeMediaEncodeBackend;
}
