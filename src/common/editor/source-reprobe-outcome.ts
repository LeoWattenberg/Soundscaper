/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VideoSourceUpgradeRefusedError,
	type VideoSourceUpgradeRefusal,
} from './video-source-upgrade.ts';

/**
 * What a surface tells the user about a re-read.
 *
 * Every outcome is nameable, including the ones that changed nothing: a refusal
 * says which contract stopped it, and a successful upgrade says what moved and
 * how many clips it could not keep whole. Nothing is reported as a plain
 * failure that the upgrade contract has an answer for.
 */

export type VideoSourceReprobeOutcomeState =
	| 'upgraded'
	| 'unchanged'
	| VideoSourceUpgradeRefusal
	| 'failed';

export interface VideoSourceReprobeOutcomeView {
	readonly state: VideoSourceReprobeOutcomeState;
	/** The copy key for the sentence this outcome leads with. */
	readonly copyKey: string;
	readonly changedFields: readonly string[];
	readonly clampedCount: number;
}

const REFUSAL_COPY_KEYS: Readonly<Record<VideoSourceUpgradeRefusal, string>> = Object.freeze({
	'media-unavailable': 'reprobeRefusedMediaUnavailable',
	'content-changed': 'reprobeRefusedContentChanged',
	'probe-unavailable': 'reprobeRefusedProbeUnavailable',
	'timing-regressed': 'reprobeRefusedTimingRegressed',
	// A probe that produced no publishable asset read no exact timing either,
	// and an asset that does not bind describes content this source is not.
	'timing-asset-missing': 'reprobeRefusedProbeUnavailable',
	'timing-asset-mismatch': 'reprobeRefusedContentChanged',
});

/** Describe a completed re-probe, upgraded or already current. */
export function describeVideoSourceReprobeResult(value: unknown): VideoSourceReprobeOutcomeView {
	const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	const changedFields = Array.isArray(result.changedFields)
		? result.changedFields.filter((field): field is string => typeof field === 'string')
		: [];
	const clampedCount = Array.isArray(result.clampedClipIds) ? result.clampedClipIds.length : 0;
	return Object.freeze(result.upgraded === true
		? { state: 'upgraded', copyKey: 'reprobeUpgraded', changedFields: Object.freeze(changedFields), clampedCount }
		: { state: 'unchanged', copyKey: 'reprobeUnchanged', changedFields: Object.freeze([]), clampedCount: 0 });
}

/** Describe why a re-probe stopped, naming the refusal when the contract has one. */
export function describeVideoSourceReprobeError(error: unknown): VideoSourceReprobeOutcomeView {
	const refusal = error instanceof VideoSourceUpgradeRefusedError ? REFUSAL_COPY_KEYS[error.reason] : null;
	return Object.freeze({
		state: refusal && error instanceof VideoSourceUpgradeRefusedError ? error.reason : 'failed',
		copyKey: refusal ?? 'reprobeFailed',
		changedFields: Object.freeze([]),
		clampedCount: 0,
	});
}
