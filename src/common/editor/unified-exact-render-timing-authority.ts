/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalizeNativeMediaSummaryValue } from './native-media-plan-canonical-form.ts';
import {
	boundVideoSourceTimingAuthority,
	boundVideoSourceTimingViewInfo,
	type BoundVideoSourceTimingAuthority,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';

export interface UnifiedExactRenderTimingSourceAuthority {
	readonly sourceId: string;
	readonly timing: BoundVideoSourceTimingAuthority;
}

export interface UnifiedExactRenderTimingIndex {
	readonly vfrBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly deferredVfrSourceIds: ReadonlySet<string>;
}

export type UnifiedExactRenderTimingSidecars = ReadonlyMap<string, BoundVideoSourceTimingView>;

/**
 * Authenticate the process-local timing tokens that prove a plan's digest-bound
 * VFR references were decoded from their exact SCTI bytes. CFR tokens may be
 * supplied by candidate sessions, but every VFR source is mandatory.
 */
export function authenticateUnifiedExactRenderTimingSidecars(
	sources: readonly UnifiedExactRenderTimingSourceAuthority[],
	value: unknown,
): UnifiedExactRenderTimingIndex {
	const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
	const expectedVfr = new Set(sources.filter(({ timing }) => timing.kind === 'vfr').map(({ sourceId }) => sourceId));
	if (value === undefined) {
		if (expectedVfr.size !== 0) {
			throw new RangeError('Unified VFR retime admission requires verified timing asset sidecars.');
		}
		return Object.freeze({
			vfrBySourceId: new Map<string, BoundVideoSourceTimingView>(),
			deferredVfrSourceIds: new Set<string>(),
		});
	}
	if (!(value instanceof Map)) {
		throw new TypeError('Unified exact timing sidecars must be an authenticated Map.');
	}
	const entries = [...Map.prototype.entries.call(value) as MapIterator<[unknown, unknown]>];
	if (entries.length > sources.length) {
		throw new RangeError('Unified exact timing sidecars contain unused source identities.');
	}
	const vfrBySourceId = new Map<string, BoundVideoSourceTimingView>();
	for (const [sourceIdValue, tokenValue] of entries) {
		if (typeof sourceIdValue !== 'string') {
			throw new TypeError('Unified exact timing sidecar source identities must be text.');
		}
		const source = sourceById.get(sourceIdValue);
		if (!source) {
			throw new ReferenceError(`Unified exact timing sidecar ${sourceIdValue} is unused or unknown.`);
		}
		const info = boundVideoSourceTimingViewInfo(tokenValue);
		const authority = boundVideoSourceTimingAuthority(tokenValue);
		if (info.sourceId !== sourceIdValue || info.kind !== source.timing.kind
			|| canonicalizeNativeMediaSummaryValue(authority)
				!== canonicalizeNativeMediaSummaryValue(source.timing)) {
			throw new RangeError(`Authenticated timing sidecar ${sourceIdValue} disagrees with its plan source identity.`);
		}
		if (source.timing.kind === 'vfr') {
			vfrBySourceId.set(sourceIdValue, tokenValue as BoundVideoSourceTimingView);
		}
	}
	for (const sourceId of expectedVfr) {
		if (!vfrBySourceId.has(sourceId)) {
			throw new ReferenceError(`Unified VFR source ${sourceId} has no verified timing asset sidecar.`);
		}
	}
	return Object.freeze({ vfrBySourceId, deferredVfrSourceIds: new Set<string>() });
}

/** Durable rows validate all declarative structure but cannot carry process-local SCTI tokens. */
export function deferUnifiedExactRenderTimingSidecars(
	sources: readonly UnifiedExactRenderTimingSourceAuthority[],
): UnifiedExactRenderTimingIndex {
	return Object.freeze({
		vfrBySourceId: new Map<string, BoundVideoSourceTimingView>(),
		deferredVfrSourceIds: new Set(sources.flatMap(({ sourceId, timing }) => (
			timing.kind === 'vfr' ? [sourceId] : []
		))),
	});
}
