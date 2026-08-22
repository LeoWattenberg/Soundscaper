/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import type { RationalRate } from './timeline-time.ts';
import {
	normalizeVideoRetimeExportIntentV6Wire,
} from './video-retime-exact-ordinal-oracle.ts';
import type { VideoRetimeExportIntentV6 } from './video-retime-export-plan.ts';
import {
	normalizeVideoTimingAssetReference,
	type VideoTimingAssetReference,
} from './video-timing-asset-reference.ts';
import { requireVideoTransitionTypeRegistrationV1 } from './video-transition-registry.ts';
import {
	normalizeCanonicalTransitionClipEdgesV1,
	videoTransitionGeometryV1,
	type CanonicalTransitionClipEdgesV1,
} from './video-transition-resolution.ts';
import {
	normalizeVideoTransitionV1,
	VIDEO_TRANSITION_LIMITS_V1,
	type VideoTransitionV1,
} from './video-transition-v1.ts';

export type UnifiedExactRenderSourceTiming = Readonly<
	| { readonly kind: 'cfr'; readonly frameCount: number; readonly rate: RationalRate }
	| { readonly kind: 'vfr'; readonly reference: Readonly<VideoTimingAssetReference> }
>;

export interface UnifiedExactRenderPlanSource {
	readonly inputIndex: number;
	readonly nodeId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly contentSha256: string;
	readonly timing: UnifiedExactRenderSourceTiming;
}

export interface UnifiedExactRenderClipNode {
	readonly kind: 'clip';
	readonly nodeId: string;
	readonly clipId: string;
	readonly trackId: string;
	readonly sourceNodeId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
	readonly sourceTimeMapping: Readonly<{
		readonly kind: 'video-retime-export-intent-v6';
		readonly intent: VideoRetimeExportIntentV6;
	}>;
}

export interface UnifiedExactRenderTransitionNode {
	readonly kind: 'transition';
	readonly nodeId: string;
	readonly transition: VideoTransitionV1;
	readonly edges: CanonicalTransitionClipEdgesV1;
}

export interface UnifiedExactRenderTemporalContext {
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceId: string;
	readonly sequenceRate: RationalRate;
	readonly outputRate: RationalRate;
	readonly outputFrameCount: number;
}

export interface UnifiedExactRenderSourceIndex {
	readonly byNodeId: ReadonlyMap<string, UnifiedExactRenderPlanSource>;
	readonly bySourceId: ReadonlyMap<string, UnifiedExactRenderPlanSource>;
}

const SOURCE_FIELDS = Object.freeze([
	'inputIndex', 'nodeId', 'sourceId', 'storageKey', 'mimeType', 'contentSha256', 'timing',
]);
const CFR_FIELDS = Object.freeze(['kind', 'frameCount', 'rate']);
const VFR_FIELDS = Object.freeze(['kind', 'reference']);
const CLIP_FIELDS = Object.freeze([
	'kind', 'nodeId', 'clipId', 'trackId', 'sourceNodeId', 'sequenceStartFrame',
	'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount', 'sourceTimeMapping',
]);
const MAPPING_FIELDS = Object.freeze(['kind', 'intent']);
const TRANSITION_FIELDS = Object.freeze(['kind', 'nodeId', 'transition', 'edges']);
const RATE_FIELDS = Object.freeze(['num', 'den']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_SOURCES = 4_096;

export function normalizeUnifiedExactRenderSources(
	value: unknown,
): Readonly<{ readonly sources: readonly UnifiedExactRenderPlanSource[]; readonly index: UnifiedExactRenderSourceIndex }> {
	const candidates = readClosedDomainArray(value, 'unified render sources', 0, MAXIMUM_SOURCES);
	const byNodeId = new Map<string, UnifiedExactRenderPlanSource>();
	const bySourceId = new Map<string, UnifiedExactRenderPlanSource>();
	const sources = candidates.map((candidate, index) => {
		const name = `unified render sources[${String(index)}]`;
		const source = readClosedDomainRecord(candidate, name, SOURCE_FIELDS);
		if (integer(field(source, 'inputIndex', name), `${name}.inputIndex`, 0) !== index) {
			throw new RangeError('Unified render source inputIndex must equal its array position.');
		}
		const contentSha256 = digest(field(source, 'contentSha256', name), `${name}.contentSha256`);
		const normalized = Object.freeze({
			inputIndex: index,
			nodeId: stableId(field(source, 'nodeId', name), `${name}.nodeId`),
			sourceId: stableId(field(source, 'sourceId', name), `${name}.sourceId`),
			storageKey: text(field(source, 'storageKey', name), `${name}.storageKey`),
			mimeType: text(field(source, 'mimeType', name), `${name}.mimeType`),
			contentSha256,
			timing: normalizeTiming(field(source, 'timing', name), contentSha256, `${name}.timing`),
		});
		if (byNodeId.has(normalized.nodeId) || bySourceId.has(normalized.sourceId)) {
			throw new RangeError('Unified render source identities must be unique.');
		}
		byNodeId.set(normalized.nodeId, normalized);
		bySourceId.set(normalized.sourceId, normalized);
		return normalized;
	});
	return Object.freeze({
		sources: Object.freeze(sources),
		index: Object.freeze({ byNodeId, bySourceId }),
	});
}

export function normalizeUnifiedExactRenderClipNode(
	value: unknown,
	context: UnifiedExactRenderTemporalContext,
	sources: UnifiedExactRenderSourceIndex,
): UnifiedExactRenderClipNode {
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
	const intent = normalizeVideoRetimeExportIntentV6Wire(field(mapping, 'intent', `${name}.sourceTimeMapping`));
	assertIntentContext(intent, context, clipId, source.sourceId, {
		sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
	});
	return Object.freeze({
		kind: 'clip' as const,
		nodeId: stableId(field(clip, 'nodeId', name), `${name}.nodeId`),
		clipId,
		trackId: stableId(field(clip, 'trackId', name), `${name}.trackId`),
		sourceNodeId,
		sequenceStartFrame,
		sequenceFrameCount,
		sourceInFrame,
		sourceFrameCount,
		sourceTimeMapping: Object.freeze({ kind: 'video-retime-export-intent-v6' as const, intent }),
	});
}

export function normalizeUnifiedExactRenderTransitionNode(
	value: unknown,
	context: UnifiedExactRenderTemporalContext,
	clipsById: ReadonlyMap<string, UnifiedExactRenderClipNode>,
	sources: UnifiedExactRenderSourceIndex,
): UnifiedExactRenderTransitionNode {
	const name = 'unified transition render node';
	const node = readClosedDomainRecord(value, name, TRANSITION_FIELDS);
	if (field(node, 'kind', name) !== 'transition') throw new RangeError(`${name}.kind is unsupported.`);
	const transition = normalizeVideoTransitionV1(field(node, 'transition', name));
	requireVideoTransitionTypeRegistrationV1(transition.type);
	const edges = normalizeCanonicalTransitionClipEdgesV1(field(node, 'edges', name));
	const geometry = videoTransitionGeometryV1(transition, edges);
	if (edges.sequenceId !== context.sequenceId || !sameRate(edges.outgoing.sequenceRate, context.sequenceRate)
		|| !sameRate(edges.incoming.sequenceRate, context.sequenceRate)) {
		throw new RangeError('Unified transition edges disagree with the render sequence authority.');
	}
	for (const side of ['outgoing', 'incoming'] as const) {
		const edge = edges[side];
		const clip = clipsById.get(edge.clipId);
		const source = sources.byNodeId.get(clip?.sourceNodeId ?? '');
		if (!clip || !source || edge.sourceId !== source.sourceId
			|| clip.trackId !== edges.trackId
			|| edge.sequenceStartFrame !== clip.sequenceStartFrame
			|| edge.sequenceFrameCount !== clip.sequenceFrameCount
			|| edge.sourceInFrame !== clip.sourceInFrame
			|| edge.sourceFrameCount !== clip.sourceFrameCount) {
			throw new ReferenceError(`Unified transition ${side} edge does not match its exact clip/source authority.`);
		}
	}
	if (geometry.durationFrames > VIDEO_TRANSITION_LIMITS_V1.maximumDurationFrames) {
		throw new RangeError('Unified transition exceeds the exact frame ceiling.');
	}
	return Object.freeze({
		kind: 'transition' as const,
		nodeId: stableId(field(node, 'nodeId', name), `${name}.nodeId`),
		transition,
		edges,
	});
}

export function normalizeUnifiedExactTransitionOrder(
	nodes: readonly UnifiedExactRenderTransitionNode[],
): readonly UnifiedExactRenderTransitionNode[] {
	if (nodes.length > VIDEO_TRANSITION_LIMITS_V1.maximumTransitionsPerProject) {
		throw new RangeError('A unified exact plan may contain at most 100000 transitions.');
	}
	const perTrack = new Map<string, number>();
	const ids = new Set<string>();
	const pairs = new Set<string>();
	for (const node of nodes) {
		const trackId = node.edges.trackId;
		const count = (perTrack.get(trackId) ?? 0) + 1;
		if (count > VIDEO_TRANSITION_LIMITS_V1.maximumTransitionsPerTrack) {
			throw new RangeError('A unified exact track may contain at most 16384 transitions.');
		}
		perTrack.set(trackId, count);
		if (ids.has(node.transition.id)) throw new RangeError('Unified transition IDs must be unique.');
		const pair = JSON.stringify([trackId, node.transition.outgoingClipId, node.transition.incomingClipId]);
		if (pairs.has(pair)) throw new RangeError('Unified transition clip-pair identities must be unique.');
		ids.add(node.transition.id);
		pairs.add(pair);
	}
	return Object.freeze([...nodes].sort(compareTransitions));
}

export function unifiedExactClipUsesRetime(node: UnifiedExactRenderClipNode): boolean {
	return node.sourceTimeMapping.intent.intersections.some((row) => row.mapping === 'curve');
}

function assertIntentContext(
	intent: VideoRetimeExportIntentV6,
	context: UnifiedExactRenderTemporalContext,
	clipId: string,
	sourceId: string,
	range: Readonly<{
		sequenceStartFrame: number; sequenceFrameCount: number;
		sourceInFrame: number; sourceFrameCount: number;
	}>,
): void {
	if (intent.sampleStart !== context.sampleStart || intent.sampleDuration !== context.sampleDuration
		|| intent.sampleRate !== context.sampleRate || intent.sequenceBinding.id !== context.sequenceId
		|| !sameRate(intent.sequenceBinding.rate, context.sequenceRate)
		|| !sameRate(intent.outputRate, context.outputRate)
		|| intent.outputFrameCount !== context.outputFrameCount) {
		throw new RangeError('Unified clip exact intent disagrees with the plan time authority.');
	}
	if (intent.intersections.length < 1) throw new RangeError('A unified active clip requires exact mapping intersections.');
	for (const row of intent.intersections) {
		if (row.clipId !== clipId || row.sourceId !== sourceId
			|| row.sequenceStartFrame !== range.sequenceStartFrame
			|| row.outerFrameCount !== range.sequenceFrameCount
			|| row.sourceInFrame !== range.sourceInFrame
			|| row.sourceOutFrame !== range.sourceInFrame + range.sourceFrameCount) {
			throw new RangeError('Unified clip exact intent row escapes its clip/source identity and ranges.');
		}
	}
}

function normalizeTiming(value: unknown, sourceSha256: string, name: string): UnifiedExactRenderSourceTiming {
	const discriminant = readClosedDomainRecord(value, name, [...new Set([...CFR_FIELDS, ...VFR_FIELDS])], ['kind']);
	const kind = field(discriminant, 'kind', name);
	if (kind === 'cfr') {
		const timing = readClosedDomainRecord(value, name, CFR_FIELDS);
		return Object.freeze({
			kind: 'cfr' as const,
			frameCount: integer(field(timing, 'frameCount', name), `${name}.frameCount`, 1),
			rate: rate(field(timing, 'rate', name), `${name}.rate`),
		});
	}
	if (kind === 'vfr') {
		const timing = readClosedDomainRecord(value, name, VFR_FIELDS);
		const reference = normalizeVideoTimingAssetReference(field(timing, 'reference', name));
		if (reference.sourceSha256 !== sourceSha256) {
			throw new RangeError('Unified VFR timing identity does not bind its source digest.');
		}
		return Object.freeze({ kind: 'vfr' as const, reference });
	}
	throw new RangeError('Unified source timing kind is unsupported.');
}

function compareTransitions(left: UnifiedExactRenderTransitionNode, right: UnifiedExactRenderTransitionNode): number {
	const leftStart = videoTransitionGeometryV1(left.transition, left.edges).overlapStartFrame;
	const rightStart = videoTransitionGeometryV1(right.transition, right.edges).overlapStartFrame;
	return leftStart - rightStart
		|| compareText(left.transition.outgoingClipId, right.transition.outgoingClipId)
		|| compareText(left.transition.incomingClipId, right.transition.incomingClipId)
		|| compareText(left.transition.id, right.transition.id);
}

function timingFrameCount(value: UnifiedExactRenderSourceTiming): number {
	return value.kind === 'cfr' ? value.frameCount : value.reference.frameCount;
}

function rate(value: unknown, name: string): RationalRate {
	const candidate = readClosedDomainRecord(value, name, RATE_FIELDS);
	const num = integer(field(candidate, 'num', name), `${name}.num`, 1);
	const den = integer(field(candidate, 'den', name), `${name}.den`, 1);
	if (gcd(num, den) !== 1) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

function sameRate(left: RationalRate, right: RationalRate): boolean {
	return left.num === right.num && left.den === right.den;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
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

function text(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`${name} must be bounded nonempty text.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}

function gcd(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
