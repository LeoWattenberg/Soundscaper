/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord, readClosedDomainField as field } from './closed-domain-value.ts';
import { assertUnifiedExactRetimeAuthority, assertUnifiedExactRetimeStructureWithDeferredVfr } from './unified-exact-retime-authority.ts';
import { normalizeVideoRetimeExportIntentV6Wire } from './video-retime-exact-ordinal-oracle.ts';
import { normalizeVideoRetimeCurveV16 } from './video-retime-v16.ts';
import type { RationalRate } from './timeline-time.ts';
import type { UnifiedExactRenderTimingIndex } from './unified-exact-render-timing-authority.ts';
import type { UnifiedExactRenderClipNode, UnifiedExactRenderTemporalContext, UnifiedExactRenderSourceIndex, UnifiedExactRenderTrackIndexV1, UnifiedExactRenderSourceTiming } from './unified-exact-render-plan-v9.ts';

const CLIP_FIELDS = Object.freeze(['kind','nodeId','clipId','trackId','sourceNodeId','sequenceStartFrame','sequenceFrameCount','sourceInFrame','sourceFrameCount','pictureState','sourceTimeMapping']);
const MAPPING_FIELDS = Object.freeze(['kind','sourceRate','retimeMap','intent']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;
/** Internal scalar clip authority; each public generation supplies its fixed
 * closed picture owner without clearing or converting resource parameters. */
export function normalizeUnifiedExactRenderClipNodeCore<PictureState>(
	normalizePictureState: (value: unknown, sequenceFrameCount: number, clipId: string) => PictureState,
	value: unknown,
	context: UnifiedExactRenderTemporalContext,
	sources: UnifiedExactRenderSourceIndex,
	tracks: UnifiedExactRenderTrackIndexV1,
	timing: UnifiedExactRenderTimingIndex,
): Omit<UnifiedExactRenderClipNode, 'pictureState'> & Readonly<{ pictureState: PictureState }> {
	const name = 'unified clip render node';
	const clip = readClosedDomainRecord(value, name, CLIP_FIELDS);
	if (field(clip, 'kind', name) !== 'clip') throw new RangeError(`${name}.kind is unsupported.`);
	const sourceNodeId = stableId(field(clip, 'sourceNodeId', name), `${name}.sourceNodeId`);
	const source = sources.byNodeId.get(sourceNodeId);
	if (!source) throw new ReferenceError('Unified clip render node references an unknown source node.');
	const sequenceStartFrame = integer(field(clip, 'sequenceStartFrame', name), `${name}.sequenceStartFrame`, 0);
	const sequenceFrameCount = integer(field(clip, 'sequenceFrameCount', name), `${name}.sequenceFrameCount`, 1);
	const sourceInFrame = integer(field(clip, 'sourceInFrame', name), `${name}.sourceInFrame`, 0);
	const sourceFrameCount = integer(field(clip, 'sourceFrameCount', name), `${name}.sourceFrameCount`, 1);
	if (!Number.isSafeInteger(sequenceStartFrame + sequenceFrameCount)
		|| !Number.isSafeInteger(sourceInFrame + sourceFrameCount)
		|| sourceInFrame + sourceFrameCount > timingFrameCount(source.timing)) {
		throw new RangeError('Unified clip frame ranges escape their exact source authority.');
	}
	const mapping = readClosedDomainRecord(field(clip, 'sourceTimeMapping', name), `${name}.sourceTimeMapping`, MAPPING_FIELDS);
	if (field(mapping, 'kind', `${name}.sourceTimeMapping`) !== 'video-retime-export-intent-v6') {
		throw new RangeError('Unified clip source-time mapping kind is unsupported.');
	}
	const clipId = stableId(field(clip, 'clipId', name), `${name}.clipId`);
	const trackId = stableId(field(clip, 'trackId', name), `${name}.trackId`);
	if (!tracks.byId.has(trackId)) throw new ReferenceError('Unified clip references an unknown video track.');
	const pictureState = normalizePictureState(
		field(clip, 'pictureState', name), sequenceFrameCount, clipId,
	);
	const sourceRate = rate(field(mapping, 'sourceRate', `${name}.sourceTimeMapping`), `${name}.sourceTimeMapping.sourceRate`);
	if (source.timing.kind === 'cfr' && !sameRate(sourceRate, source.timing.rate)) {
		throw new RangeError('Unified clip source rate disagrees with its exact CFR source authority.');
	}
	const retimeMap = normalizeVideoRetimeCurveV16(
		field(mapping, 'retimeMap', `${name}.sourceTimeMapping`),
		{ sequenceFrameCount, sourceInFrame, sourceFrameCount },
	);
	const intent = normalizeVideoRetimeExportIntentV6Wire(field(mapping, 'intent', `${name}.sourceTimeMapping`));
	const sourceTimingView = source.timing.kind === 'vfr'
		? timing.vfrBySourceId.get(source.sourceId) ?? null
		: null;
	const retimeAuthority = {
		clipId, sourceId: source.sourceId,
		sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
		sourceRate, retimeMap, sourceTiming: source.timing, sourceTimingView,
	};
	if (timing.deferredVfrSourceIds.has(source.sourceId)) {
		assertUnifiedExactRetimeStructureWithDeferredVfr(intent, context, retimeAuthority);
	} else {
		assertUnifiedExactRetimeAuthority(intent, context, retimeAuthority);
	}
	return Object.freeze({
		kind: 'clip' as const,
		nodeId: stableId(field(clip, 'nodeId', name), `${name}.nodeId`),
		clipId, trackId,
		sourceNodeId,
		sequenceStartFrame,
		sequenceFrameCount,
		sourceInFrame,
		sourceFrameCount,
		pictureState,
		sourceTimeMapping: Object.freeze({
			kind: 'video-retime-export-intent-v6' as const, sourceRate, retimeMap, intent,
		}),
	});
}

function timingFrameCount(value: UnifiedExactRenderSourceTiming): number {
	return value.kind === 'cfr' ? value.frameCount : value.reference.frameCount;
}

function rate(value: unknown, name: string): RationalRate {
	const candidate = readClosedDomainRecord(value, name, ['num', 'den']);
	const num = integer(field(candidate, 'num', name), `${name}.num`, 1);
	const den = integer(field(candidate, 'den', name), `${name}.den`, 1);
	if (gcd(num, den) !== 1) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

function sameRate(left: RationalRate, right: RationalRate): boolean {
	return left.num === right.num && left.den === right.den;
}


function integer(value: unknown, name: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`${name} must be a safe integer of at least ${String(minimum)}.`);
	}
	return Number(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a canonical stable ID.`);
	return value;
}

function gcd(left: number, right: number): number { while (right !== 0) [left, right] = [right, left % right]; return left; }
