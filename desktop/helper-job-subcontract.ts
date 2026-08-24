/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Version ownership for the job payloads carried by helper control contract
 * v1. The control envelope is intentionally stable; each negotiated kind has
 * an independently versioned payload contract so one native service can
 * evolve without silently changing every other helper.
 */

export const HELPER_JOB_KINDS = Object.freeze([
	'probe-video-source',
	'audio-device',
	'plugin-scan',
	'plugin-host',
	'media-decode',
	'media-encode',
	'media-render',
	'media-proxy',
	'ofx-scan',
	'ofx-host',
	'assistance-speech',
] as const);

export type HelperJobKind = (typeof HELPER_JOB_KINDS)[number];

export const HELPER_JOB_SUBCONTRACT_VERSIONS = Object.freeze({
	'probe-video-source': 1,
	'audio-device': 1,
	'plugin-scan': 1,
	'plugin-host': 1,
	'media-decode': 1,
	'media-encode': 1,
	'media-render': 1,
	'media-proxy': 1,
	'ofx-scan': 1,
	'ofx-host': 1,
	'assistance-speech': 1,
} as const satisfies Readonly<Record<HelperJobKind, number>>);

export type HelperJobSubcontractVersion<Kind extends HelperJobKind> =
	(typeof HELPER_JOB_SUBCONTRACT_VERSIONS)[Kind];

export function helperJobSubcontractVersion<Kind extends HelperJobKind>(
	kind: Kind,
): HelperJobSubcontractVersion<Kind> {
	if (!Object.hasOwn(HELPER_JOB_SUBCONTRACT_VERSIONS, kind)) {
		throw new RangeError('A helper job subcontract requires a known negotiated kind.');
	}
	return HELPER_JOB_SUBCONTRACT_VERSIONS[kind];
}

export function admitsHelperJobSubcontract(
	kind: HelperJobKind,
	version: unknown,
): boolean {
	return version === helperJobSubcontractVersion(kind);
}
