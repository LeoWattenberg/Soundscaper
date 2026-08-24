/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed authority for dormant V9–V12 plans and the selected V13 finishing branch. */

import {
	readClosedDomainArray,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
	type NativeMediaPlanFingerprint,
} from './native-media-plan-canonical-form.ts';
import type { NativeMediaV14EncodeProfileId } from './native-media-v14-native-dispatch.ts';
import type { VideoCanvasFit } from './video-canvas-fit.ts';
import type { VideoDeliveryAudioLayout } from './video-delivery-audio-layout.ts';
import type { VideoDeliveryQuality } from './video-delivery-quality.ts';
import { assertUnifiedExactRenderOutputAdmission } from './unified-exact-render-output-admission.ts';
import {
	requireDormantRenderGeneration as requireDormantGeneration,
	requireMinimumRenderGeneration as requireGeneration,
	requireSelectedRenderGeneration as requireSelectedGeneration,
} from './unified-exact-render-generation.ts';
import {
	deepFreezeExactRenderValue as deepFreeze,
	exactRenderCeilingRatio as ceilingRatio,
	exactRenderField as field,
	exactRenderInteger as integer,
	exactRenderNullableText as nullableText,
	exactRenderRational as rational,
	exactRenderRequired as required,
	exactRenderStableId as stableId,
	exactRenderText as text,
} from './unified-exact-render-plan-primitives.ts';
import {
	normalizeUnifiedExactRenderDeliveryProfile,
	normalizeUnifiedExactRenderFormat,
	type UnifiedExactRenderFormat,
} from './unified-exact-render-plan-format.ts';
import { normalizeUnifiedExactRenderOutput } from './unified-exact-render-plan-output.ts';
import {
	assertUnifiedExactRenderCompanionAudioRequiredV15,
	assertUnifiedExactRenderDeliveryReferencesV15,
	normalizeUnifiedExactRenderDeliveryV15,
	type UnifiedExactRenderCaptionDeliveryV15,
	type UnifiedExactRenderCompanionAudioV15,
} from './unified-exact-render-delivery-v15.ts';
import {
	createUnifiedExactRenderIdentityIndex,
	type UnifiedExactRenderIdentityClaim,
	type UnifiedExactRenderIdentityIndex,
} from './unified-exact-render-identity-authority.ts';
import {
	normalizeUnifiedExactRenderClipNode,
	normalizeUnifiedExactRenderSources,
	normalizeUnifiedExactRenderTracks,
	normalizeUnifiedExactRenderTransitionNode,
	normalizeUnifiedExactTransitionOrder,
	type UnifiedExactRenderClipNode,
	type UnifiedExactRenderClipPictureStateV1,
	type UnifiedExactRenderPlanSource,
	type UnifiedExactRenderSourceIndex,
	type UnifiedExactRenderTemporalContext,
	type UnifiedExactRenderTrackAuthorityV1,
	type UnifiedExactRenderTrackIndexV1,
	type UnifiedExactRenderTransitionNode,
} from './unified-exact-render-plan-v9.ts';
import {
	assertUnifiedExactVisualReferences,
	normalizeUnifiedExactRenderVisualNode,
	type UnifiedExactRenderVisualNode,
	type UnifiedExactVisualPlacementV1,
	type UnifiedExactVisualModelKind,
} from './unified-exact-render-plan-v10.ts';
import {
	normalizeUnifiedExactRenderProfessionalNode,
	type UnifiedExactRenderProfessionalMediaNode,
} from './unified-exact-render-plan-v11.ts';
import {
	normalizeUnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderOpenFxNode,
} from './unified-exact-render-plan-v12.ts';
import {
	assertUnifiedExactFinishingReferences,
	normalizeUnifiedExactRenderFinishingNode,
	type UnifiedExactRenderFinishingNode,
} from './unified-exact-render-plan-v13.ts';
import {
	authenticateUnifiedExactRenderTimingSidecars,
	deferUnifiedExactRenderTimingSidecars,
	type UnifiedExactRenderTimingIndex,
	type UnifiedExactRenderTimingSidecars,
} from './unified-exact-render-timing-authority.ts';
export type {
	UnifiedExactRenderClipNode,
	UnifiedExactRenderClipPictureStateV1,
	UnifiedExactRenderPlanSource,
	UnifiedExactRenderTrackAuthorityV1,
	UnifiedExactRenderTransitionNode,
	UnifiedExactRenderVisualNode,
	UnifiedExactVisualPlacementV1,
	UnifiedExactVisualModelKind,
	UnifiedExactRenderProfessionalMediaNode,
	UnifiedExactRenderOpenFxNode,
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderTimingSidecars,
};

export const UNIFIED_EXACT_RENDER_PLAN_VERSIONS = Object.freeze([9, 10, 11, 12, 13, 14, 15] as const);
export type UnifiedExactRenderPlanVersion = (typeof UNIFIED_EXACT_RENDER_PLAN_VERSIONS)[number];

export type UnifiedExactRenderNode =
	| UnifiedExactRenderClipNode
	| UnifiedExactRenderTransitionNode
	| UnifiedExactRenderVisualNode
	| UnifiedExactRenderProfessionalMediaNode
	| UnifiedExactRenderOpenFxNode
	| UnifiedExactRenderFinishingNode;

export interface UnifiedExactRenderPlan extends Readonly<Record<string, unknown>> {
	readonly version: UnifiedExactRenderPlanVersion;
	readonly strategy: 'framescaper-unified-exact-v1';
	readonly project: Readonly<{ readonly id: string; readonly revision: number }>;
	readonly format: UnifiedExactRenderFormat;
	/** Present only in V14/V15; closes the exact professional encoder/profile tuple. */
	readonly deliveryProfile?: NativeMediaV14EncodeProfileId;
	/** Present only in V15; binds closed caption and image-sequence companion delivery. */
	readonly captionDelivery?: UnifiedExactRenderCaptionDeliveryV15 | null;
	/** Present only in V15; references the separately sealed ordinary audio plan. */
	readonly companionAudio?: UnifiedExactRenderCompanionAudioV15 | null;
	readonly codecs: Readonly<{
		readonly video: string;
		readonly videoEncoder: string;
		readonly audio: string | null;
		readonly audioEncoder: string | null;
		readonly pixelFormat: string;
	}>;
	readonly timebase: Readonly<{
		readonly sampleStart: number;
		readonly sampleDuration: number;
		readonly sampleRate: number;
		readonly sequenceId: string;
		readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
	}>;
	readonly output: Readonly<{
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly frameCount: number;
		readonly quality: VideoDeliveryQuality;
		readonly canvas: Readonly<{
			readonly width: number;
			readonly height: number;
			readonly fit: VideoCanvasFit;
			readonly pixelFormat: string;
			readonly backgroundColor: string;
		}>;
		readonly includeAudio: boolean;
		readonly audioLayout: VideoDeliveryAudioLayout | null;
	}>;
	readonly tracks: readonly UnifiedExactRenderTrackAuthorityV1[];
	readonly sources: readonly UnifiedExactRenderPlanSource[];
	readonly nodes: readonly UnifiedExactRenderNode[];
}

export type UnifiedExactRenderPlanV9 = UnifiedExactRenderPlan & Readonly<{ readonly version: 9 }>;
export type UnifiedExactRenderPlanV10 = UnifiedExactRenderPlan & Readonly<{ readonly version: 10 }>;
export type UnifiedExactRenderPlanV11 = UnifiedExactRenderPlan & Readonly<{ readonly version: 11 }>;
export type UnifiedExactRenderPlanV12 = UnifiedExactRenderPlan & Readonly<{ readonly version: 12 }>;
export type UnifiedExactRenderPlanV13 = UnifiedExactRenderPlan & Readonly<{ readonly version: 13 }>;
export type UnifiedExactRenderPlanV14 = UnifiedExactRenderPlan & Readonly<{ readonly version: 14 }>;
export type UnifiedExactRenderPlanV15 = UnifiedExactRenderPlan & Readonly<{
	readonly version: 15; readonly deliveryProfile: NativeMediaV14EncodeProfileId;
	readonly captionDelivery: UnifiedExactRenderCaptionDeliveryV15 | null;
	readonly companionAudio: UnifiedExactRenderCompanionAudioV15 | null;
}>;

const PLAN_FIELDS = Object.freeze([
	'version', 'strategy', 'project', 'format', 'codecs', 'timebase', 'output', 'tracks', 'sources', 'nodes',
]);
const PLAN_V14_FIELDS = Object.freeze([...PLAN_FIELDS, 'deliveryProfile']);
const PLAN_V15_FIELDS = Object.freeze([...PLAN_FIELDS, 'deliveryProfile', 'captionDelivery', 'companionAudio']);
const PROJECT_FIELDS = Object.freeze(['id', 'revision']);
const CODEC_FIELDS = Object.freeze(['video', 'videoEncoder', 'audio', 'audioEncoder', 'pixelFormat']);
const TIMEBASE_FIELDS = Object.freeze([
	'sampleStart', 'sampleDuration', 'sampleRate', 'sequenceId', 'sequenceRate',
]);
const ALL_NODE_FIELDS = Object.freeze([
	'kind', 'nodeId', 'clipId', 'trackId', 'sourceNodeId', 'sequenceStartFrame',
	'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount', 'pictureState',
	'sourceTimeMapping',
	'transition', 'edges', 'modelId', 'modelKind', 'authoredState', 'placement', 'freshness',
	'authoredFallback', 'fallbackDisposition', 'frozenFallback',
	'characteristics', 'imageSequence', 'proxyAttachment',
	'exportAuthority', 'state',
	'sequenceId', 'colorContext', 'sourceInterpretations', 'visualPresentations',
	'processorStacks', 'motionAnalyses', 'captionTracks', 'captionDisposition', 'audioContext',
]);
const MAXIMUM_NODES = 100_000;

/** Normalize, detach, and deeply freeze one exact generation. */
export function createUnifiedExactRenderPlan(value: unknown): UnifiedExactRenderPlan {
	return createPlan(value);
}

/** Normalize a V9–V13 plan while authenticating digest-bound VFR timing bodies. */
export function createUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderPlan {
	return createPlan(value, timingSidecars);
}

function createPlan(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderPlan {
	const normalized = normalizePlan(value, timingSidecars);
	const canonical = canonicalizeNativeMediaPlan(normalized);
	const detached = normalizePlan(JSON.parse(canonical) as unknown, timingSidecars);
	return deepFreeze(detached);
}

/** Require an already-normalized canonical V9–V13 wire. */
export function assertUnifiedExactRenderPlan(value: unknown): asserts value is UnifiedExactRenderPlan {
	const normalized = normalizePlan(value);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A unified exact render plan must use its canonical semantic order and values.');
	}
}

/** Require a canonical V9–V13 wire and authenticate each referenced VFR body. */
export function assertUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): asserts value is UnifiedExactRenderPlan {
	const normalized = normalizePlan(value, timingSidecars);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A unified exact render plan must use its canonical semantic order and values.');
	}
}

/** Durable queue rows retain references only; execution must re-run with authenticated SCTI tokens. */
export function assertUnifiedExactRenderPlanWithDeferredTimingReferences(
	value: unknown,
): asserts value is UnifiedExactRenderPlan {
	const normalized = normalizePlan(value, undefined, true);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A deferred-timing unified render plan must retain canonical structure.');
	}
}

export function assertUnifiedExactRenderPlanV9(value: unknown): asserts value is UnifiedExactRenderPlanV9 {
	assertGeneration(value, 9);
}

export function assertUnifiedExactRenderPlanV10(value: unknown): asserts value is UnifiedExactRenderPlanV10 {
	assertGeneration(value, 10);
}

export function assertUnifiedExactRenderPlanV11(value: unknown): asserts value is UnifiedExactRenderPlanV11 {
	assertGeneration(value, 11);
}

export function assertUnifiedExactRenderPlanV12(value: unknown): asserts value is UnifiedExactRenderPlanV12 {
	assertGeneration(value, 12);
}

export function assertUnifiedExactRenderPlanV13(value: unknown): asserts value is UnifiedExactRenderPlanV13 {
	assertGeneration(value, 13);
}
export function assertUnifiedExactRenderPlanV14(
	value: unknown,
): asserts value is UnifiedExactRenderPlanV14 {
	assertGeneration(value, 14);
}
export function assertUnifiedExactRenderPlanV15(value: unknown): asserts value is UnifiedExactRenderPlanV15 {
	assertGeneration(value, 15);
}
export function canonicalizeUnifiedExactRenderPlan(value: unknown): string {
	assertUnifiedExactRenderPlan(value);
	return canonicalizeNativeMediaPlan(value);
}

export function canonicalizeUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): string {
	assertUnifiedExactRenderPlanWithTimingSidecars(value, timingSidecars);
	return canonicalizeNativeMediaPlan(value);
}

export function fingerprintUnifiedExactRenderPlan(value: unknown): NativeMediaPlanFingerprint {
	assertUnifiedExactRenderPlan(value);
	return fingerprintNativeMediaPlan(value);
}

export function fingerprintUnifiedExactRenderPlanWithTimingSidecars(
	value: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars,
): NativeMediaPlanFingerprint {
	assertUnifiedExactRenderPlanWithTimingSidecars(value, timingSidecars);
	return fingerprintNativeMediaPlan(value);
}

function normalizePlan(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
	deferTiming = false,
): UnifiedExactRenderPlan {
	const candidate = value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>> : null;
	const candidateVersion = candidate?.version;
	const input = readClosedDomainRecord(
		value, 'unified exact render plan', candidateVersion === 15
			? PLAN_V15_FIELDS : candidateVersion === 14 ? PLAN_V14_FIELDS : PLAN_FIELDS,
	);
	const version = planVersion(field(input, 'version', 'unified exact render plan'));
	const deliveryProfile = version === 14 || version === 15
		? normalizeUnifiedExactRenderDeliveryProfile(field(input, 'deliveryProfile', 'unified exact render plan'))
		: undefined;
	if (field(input, 'strategy', 'unified exact render plan') !== 'framescaper-unified-exact-v1') {
		throw new RangeError('A unified exact render plan has an unsupported strategy.');
	}
	const project = normalizeProject(field(input, 'project', 'unified exact render plan'));
	const format = normalizeUnifiedExactRenderFormat(
		field(input, 'format', 'unified exact render plan'), version,
	);
	const codecs = normalizeCodecs(field(input, 'codecs', 'unified exact render plan'));
	const timebase = normalizeTimebase(field(input, 'timebase', 'unified exact render plan'));
	const output = normalizeUnifiedExactRenderOutput(
		field(input, 'output', 'unified exact render plan'), codecs, version,
	);
	assertUnifiedExactRenderOutputAdmission({ version, format, codecs, output, deliveryProfile });
	const delivery = version === 15
		? normalizeUnifiedExactRenderDeliveryV15(
			field(input, 'captionDelivery', 'unified exact render plan'),
			field(input, 'companionAudio', 'unified exact render plan'),
			{ container: format.container, deliveryProfile: required(deliveryProfile), includeAudio: output.includeAudio },
		)
		: null;
	const expectedCount = ceilingRatio(
		BigInt(timebase.sampleDuration) * BigInt(output.frameRate.num),
		BigInt(timebase.sampleRate) * BigInt(output.frameRate.den),
	);
	if (expectedCount !== BigInt(output.frameCount)) {
		throw new RangeError('Unified render output frameCount is not exact.');
	}
	const sourceResult = normalizeUnifiedExactRenderSources(field(input, 'sources', 'unified exact render plan'));
	const timingIndex = deferTiming
		? deferUnifiedExactRenderTimingSidecars(sourceResult.sources)
		: authenticateUnifiedExactRenderTimingSidecars(sourceResult.sources, timingSidecars);
	const trackResult = normalizeUnifiedExactRenderTracks(field(input, 'tracks', 'unified exact render plan'));
	const context: UnifiedExactRenderTemporalContext = Object.freeze({
		sampleStart: timebase.sampleStart,
		sampleDuration: timebase.sampleDuration,
		sampleRate: timebase.sampleRate,
		sequenceId: timebase.sequenceId,
		sequenceRate: timebase.sequenceRate,
		outputRate: output.frameRate,
		outputFrameCount: output.frameCount,
	});
	const nodes = normalizeNodes(
		field(input, 'nodes', 'unified exact render plan'), version, project.id,
		context, sourceResult.index, trackResult.index, timingIndex,
	);
	if (delivery !== null) {
		assertUnifiedExactRenderDeliveryReferencesV15(
			delivery,
			new Set(nodes.flatMap((node) => node.kind === 'finishing'
					? node.captionTracks.map(({ id }) => id) : [])),
		);
		assertUnifiedExactRenderCompanionAudioRequiredV15(delivery, {
			container: format.container,
			hasProgrammeAudio: nodes.some((node) => node.kind === 'finishing'
				&& node.audioContext.audioTracks.length > 0),
		});
	}
	return {
		version,
		strategy: 'framescaper-unified-exact-v1',
		project,
		format,
		...(deliveryProfile === undefined ? {} : { deliveryProfile }),
		...(delivery === null ? {} : delivery),
		codecs,
		timebase,
		output,
		tracks: trackResult.tracks,
		sources: sourceResult.sources,
		nodes,
	};
}

function normalizeNodes(
	value: unknown,
	version: UnifiedExactRenderPlanVersion,
	projectId: string,
	context: UnifiedExactRenderTemporalContext,
	sources: UnifiedExactRenderSourceIndex,
	tracks: UnifiedExactRenderTrackIndexV1,
	timing: UnifiedExactRenderTimingIndex,
): readonly UnifiedExactRenderNode[] {
	const candidates = readClosedDomainArray(value, 'unified render nodes', 0, MAXIMUM_NODES);
	const kinds = candidates.map((candidate, index) => {
		const name = `unified render nodes[${String(index)}]`;
		const record = readClosedDomainRecord(candidate, name, ALL_NODE_FIELDS, ['kind']);
		return field(record, 'kind', name);
	});
	const normalized = new Map<number, UnifiedExactRenderNode>();
	const clipsById = new Map<string, UnifiedExactRenderClipNode>();
	const professionalSourceNodeIds = new Set<string>();
	let finishingNodeCount = 0;
	for (let index = 0; index < candidates.length; index += 1) {
		if (kinds[index] !== 'clip') continue;
		const clip = normalizeUnifiedExactRenderClipNode(candidates[index], context, sources, tracks, timing);
		if (clipsById.has(clip.clipId)) throw new RangeError('Unified clip IDs must be unique.');
		clipsById.set(clip.clipId, clip);
		normalized.set(index, clip);
	}
	for (let index = 0; index < candidates.length; index += 1) {
		const kind = kinds[index];
		if (kind === 'clip' || kind === 'openfx') continue;
		let node: UnifiedExactRenderNode;
		if (kind === 'transition') {
			node = normalizeUnifiedExactRenderTransitionNode(candidates[index], context, clipsById, sources);
		} else if (kind === 'visual') {
			requireGeneration(version, 10, kind);
			node = normalizeUnifiedExactRenderVisualNode(
				candidates[index], context.sequenceId, sources.bySourceId, tracks,
			);
		} else if (kind === 'professional-media') {
			requireDormantGeneration(version, [11, 12, 14, 15], kind);
			node = normalizeUnifiedExactRenderProfessionalNode(candidates[index], sources.byNodeId);
			if (professionalSourceNodeIds.has(node.sourceNodeId)) {
				throw new RangeError('A unified professional-media source may have at most one authority node.');
			}
			professionalSourceNodeIds.add(node.sourceNodeId);
		} else if (kind === 'finishing') {
			if (version !== 14 && version !== 15) requireSelectedGeneration(version, 13, kind);
			finishingNodeCount += 1;
			if (finishingNodeCount > 1) throw new RangeError('A selected finishing plan requires exactly one finishing node.');
			node = normalizeUnifiedExactRenderFinishingNode(candidates[index], context.sequenceId, sources.bySourceId);
		} else throw new RangeError('Unified exact render plan node kind is unsupported.');
		normalized.set(index, node);
	}
	if ((version === 13 || version === 14 || version === 15) && finishingNodeCount !== 1) {
		throw new RangeError('A selected finishing plan requires exactly one finishing node.');
	}
	const identities = graphIdentities(projectId, context.sequenceId, tracks, sources, normalized.values());
	for (let index = 0; index < candidates.length; index += 1) {
		if (kinds[index] !== 'openfx') continue;
		requireDormantGeneration(version, [12, 14, 15], 'openfx');
		const effect = normalizeUnifiedExactRenderOpenFxNode(
			candidates[index], identities, sources.bySourceId, context.outputFrameCount,
		);
		normalized.set(index, effect);
	}
	const result = candidates.map((_candidate, index) => required(normalized.get(index)));
	const finalIdentities = graphIdentities(projectId, context.sequenceId, tracks, sources, result);
	assertUnifiedExactVisualReferences(
		result.filter((node): node is UnifiedExactRenderVisualNode => node.kind === 'visual'),
		finalIdentities,
		tracks,
	);
	for (const node of result) {
		if (node.kind === 'finishing') assertUnifiedExactFinishingReferences(node, finalIdentities);
	}
	const orderedTransitions = normalizeUnifiedExactTransitionOrder(
		result.filter((node): node is UnifiedExactRenderTransitionNode => node.kind === 'transition'),
	);
	let transitionIndex = 0;
	return Object.freeze(result.map((node) => (
		node.kind === 'transition' ? orderedTransitions[transitionIndex++]! : node
	)));
}

function graphIdentities(
	projectId: string,
	sequenceId: string,
	tracks: UnifiedExactRenderTrackIndexV1,
	sources: UnifiedExactRenderSourceIndex,
	nodes: Iterable<UnifiedExactRenderNode>,
): UnifiedExactRenderIdentityIndex {
	const claims: UnifiedExactRenderIdentityClaim[] = [];
	const generatorSources = new Map<string, string>();
	const claim = (
		identity: string,
		kind: UnifiedExactRenderIdentityClaim['kind'],
		owner: string,
		role: string | null = null,
	): void => {
		claims.push({ identity, kind, owner, role });
	};
	claim(projectId, 'project', 'project');
	claim(sequenceId, 'sequence', 'sequence');
	for (const track of tracks.byId.values()) claim(track.trackId, 'track', `track ${track.trackId}`);
	for (const source of sources.byNodeId.values()) {
		claim(source.nodeId, 'source-node', `source node ${source.nodeId}`);
		claim(source.sourceId, 'source', `source ${source.sourceId}`);
	}
	for (const node of nodes) {
		if (node.kind === 'clip') {
			claim(node.nodeId, 'clip-node', `clip node ${node.nodeId}`);
			claim(node.clipId, 'clip', `clip ${node.clipId}`);
			for (const effect of node.pictureState.videoEffects) {
				claim(effect.id, 'video-effect', `video effect ${effect.id}`, effect.type);
			}
		} else if (node.kind === 'transition') {
			claim(node.nodeId, 'transition-node', `transition node ${node.nodeId}`);
			claim(node.transition.id, 'transition', `transition ${node.transition.id}`);
		} else if (node.kind === 'visual') {
			claim(node.nodeId, 'visual-node', `visual node ${node.nodeId}`);
			claim(node.modelId, 'visual-model', `visual model ${node.modelId}`, node.modelKind);
			if ('source' in node.authoredState && node.authoredState.source.kind === 'generator') {
				const sourceId = node.authoredState.source.id;
				const canonical = canonicalizeNativeMediaPlan(node.authoredState.source);
				const existing = generatorSources.get(sourceId);
				if (existing === undefined) {
					claim(sourceId, 'generator-source', `generator source ${sourceId}`, node.modelKind);
					generatorSources.set(sourceId, canonical);
				} else if (existing !== canonical) {
					throw new RangeError(`Unified generator source ${sourceId} has contradictory authority.`);
				}
			}
		} else if (node.kind === 'professional-media') {
			claim(node.nodeId, 'professional-media-node', `professional-media node ${node.nodeId}`);
		} else if (node.kind === 'openfx') {
			claim(node.nodeId, 'openfx-node', `OpenFX node ${node.nodeId}`);
			claim(node.state.instanceId, 'openfx-instance', `OpenFX instance ${node.state.instanceId}`, node.state.context);
		} else if (node.kind === 'finishing') {
			claim(node.nodeId, 'finishing-node', `finishing node ${node.nodeId}`);
			for (const presentation of node.visualPresentations) {
				claim(presentation.id, 'visual-presentation', `visual presentation ${presentation.id}`);
			}
			for (const stack of node.processorStacks) {
				claim(stack.id, 'processor-stack', `processor stack ${stack.id}`);
				for (const processor of stack.processors) {
					claim(processor.id, 'video-processor', `video processor ${processor.id}`, processor.kind);
				}
			}
			for (const analysis of node.motionAnalyses) {
				claim(analysis.id, 'motion-analysis', `motion analysis ${analysis.id}`);
			}
			for (const track of node.captionTracks) {
				claim(track.id, 'caption-track', `caption track ${track.id}`);
			}
			for (const lane of node.audioContext.automationLanes) {
				claim(lane.id, 'automation-lane', `automation lane ${lane.id}`);
			}
		}
	}
	return createUnifiedExactRenderIdentityIndex(claims);
}

function normalizeProject(value: unknown) {
	const record = readClosedDomainRecord(value, 'unified render project', PROJECT_FIELDS);
	return Object.freeze({
		id: stableId(field(record, 'id', 'unified render project'), 'unified render project.id'),
		revision: integer(field(record, 'revision', 'unified render project'), 'unified render project.revision', 0),
	});
}

function normalizeCodecs(value: unknown): UnifiedExactRenderPlan['codecs'] {
	const record = readClosedDomainRecord(value, 'unified render codecs', CODEC_FIELDS);
	const audio = nullableText(field(record, 'audio', 'unified render codecs'), 'unified render codecs.audio');
	const audioEncoder = nullableText(field(record, 'audioEncoder', 'unified render codecs'), 'unified render codecs.audioEncoder');
	if ((audio === null) !== (audioEncoder === null)) throw new RangeError('Audio codec and encoder must both be null or text.');
	return Object.freeze({
		video: text(field(record, 'video', 'unified render codecs'), 'unified render codecs.video'),
		videoEncoder: text(field(record, 'videoEncoder', 'unified render codecs'), 'unified render codecs.videoEncoder'),
		audio,
		audioEncoder,
		pixelFormat: text(field(record, 'pixelFormat', 'unified render codecs'), 'unified render codecs.pixelFormat'),
	});
}

function normalizeTimebase(value: unknown): UnifiedExactRenderPlan['timebase'] {
	const record = readClosedDomainRecord(value, 'unified render timebase', TIMEBASE_FIELDS);
	const sampleStart = integer(field(record, 'sampleStart', 'unified render timebase'), 'sampleStart', 0);
	const sampleDuration = integer(field(record, 'sampleDuration', 'unified render timebase'), 'sampleDuration', 1);
	if (!Number.isSafeInteger(sampleStart + sampleDuration)) throw new RangeError('Unified render sample range overflows.');
	return Object.freeze({
		sampleStart,
		sampleDuration,
		sampleRate: integer(field(record, 'sampleRate', 'unified render timebase'), 'sampleRate', 1),
		sequenceId: stableId(field(record, 'sequenceId', 'unified render timebase'), 'sequenceId'),
		sequenceRate: rational(field(record, 'sequenceRate', 'unified render timebase'), 'sequenceRate'),
	});
}

function assertGeneration(value: unknown, version: UnifiedExactRenderPlanVersion): void {
	assertUnifiedExactRenderPlan(value);
	if (value.version !== version) throw new RangeError(`Expected unified exact render plan V${String(version)}.`);
}

function planVersion(value: unknown): UnifiedExactRenderPlanVersion {
	if (!(UNIFIED_EXACT_RENDER_PLAN_VERSIONS as readonly unknown[]).includes(value)) {
		throw new RangeError('Unified exact render plan version is unsupported.');
	}
	return value as UnifiedExactRenderPlanVersion;
}
