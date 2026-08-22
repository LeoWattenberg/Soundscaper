/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameBoundarySample } from '../common/editor/sequence-frame-navigation.ts';
import {
	createUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderClipPictureStateV1,
	type UnifiedExactRenderNode,
	type UnifiedExactRenderPlan,
	type UnifiedExactRenderPlanSource,
	type UnifiedExactRenderPlanVersion,
	type UnifiedExactRenderTrackAuthorityV1,
} from '../common/editor/unified-exact-render-plan.ts';
import { createVideoRetimeExportIntentV6 } from '../common/editor/video-retime-export-plan.ts';
import {
	bindVideoSourceTimingView,
	boundVideoSourceTimingAuthority,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import type { FramescaperUnifiedExactRenderAuthority } from './editor-project-unified-render-authority.ts';

export interface FramescaperActiveVisualPlacement {
	readonly clip: Readonly<Record<string, unknown>>;
	readonly trackId: string;
	readonly startSample: number;
	readonly endSample: number;
	readonly trackOrder: number;
}

export interface FramescaperUnifiedRenderFoundation {
	readonly project: Readonly<Record<string, unknown>>;
	readonly authority: FramescaperUnifiedExactRenderAuthority;
	readonly sequence: Readonly<Record<string, unknown>>;
	readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly sourceById: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	readonly sourceNodeIdById: ReadonlyMap<string, string>;
	readonly projectIdentities: ReadonlySet<string>;
	readonly representedIdentities: ReadonlySet<string>;
	readonly activeVisualPlacements: readonly FramescaperActiveVisualPlacement[];
	readonly tracks: readonly UnifiedExactRenderTrackAuthorityV1[];
	readonly baseNodes: readonly Readonly<Record<string, unknown>>[];
	readonly rawPlanBase: Omit<UnifiedExactRenderPlan, 'version' | 'nodes'>;
}

const FOUNDATION_TIMING_SIDECARS = new WeakMap<object, ReadonlyMap<string, BoundVideoSourceTimingView>>();

/** Build the exact V9 foundation shared by all cumulative dormant generations. */
export function createFramescaperUnifiedRenderFoundation(
	projectValue: unknown,
	authority: FramescaperUnifiedExactRenderAuthority,
): FramescaperUnifiedRenderFoundation {
	const project = record(projectValue, 'Framescaper candidate project');
	if (authority.includeAudio === true) {
		throw new RangeError('Audio authority is not represented by unified plans V9-V12; export must fail closed.');
	}
	const sampleRate = positiveInteger(data(project, 'sampleRate', 'project'), 'project.sampleRate');
	const sampleStart = nonNegativeInteger(authority.sampleStart, 'render sampleStart');
	const sampleDuration = positiveInteger(authority.sampleDuration, 'render sampleDuration');
	if (!Number.isSafeInteger(sampleStart + sampleDuration)) throw new RangeError('Render sample range overflows.');
	const sequenceId = text(authority.sequenceId, 'render sequenceId');
	const sequence = records(data(project, 'sequences', 'project'), 'project.sequences')
		.find((candidate) => data(candidate, 'id', 'sequence') === sequenceId);
	if (!sequence) throw new ReferenceError(`Render sequence ${sequenceId} does not exist.`);
	const sequenceRate = rational(data(sequence, 'rate', 'sequence'), 'sequence.rate');
	const projectIdentities = collectProjectIdentities(project);
	const sourceValues = records(data(project, 'sources', 'project'), 'project.sources');
	const sourceById = uniqueById(sourceValues, 'project source');
	const timingViews = exactTimingViews(authority.timingViews, sourceValues);
	const tracks = sequenceVideoTracks(project, sequence);
	const externalSources = sourceValues.filter(({ kind }) => kind === 'video' || kind === 'still')
		.sort(compareIds);
	const sourceNodeIdById = new Map<string, string>();
	const timingBySourceId = new Map<string, BoundVideoSourceTimingView>();
	const planSources = externalSources.map((source, inputIndex) => {
		const sourceId = id(source, 'project source');
		if (source.kind === 'video' && Object.hasOwn(source, 'opaqueExtensions')) {
			assertEmptyRecord(source.opaqueExtensions, `video source ${sourceId}.opaqueExtensions`);
		}
		const nodeId = generatedNodeId('source', sourceId, projectIdentities);
		sourceNodeIdById.set(sourceId, nodeId);
		let timing: UnifiedExactRenderPlanSource['timing'];
		if (source.kind === 'video') {
			const boundTiming = bindVideoSourceTimingView(timingViews, source);
			timingBySourceId.set(sourceId, boundTiming);
			timing = boundVideoSourceTimingAuthority(boundTiming);
		} else {
			timing = Object.freeze({ kind: 'cfr' as const, frameCount: 1, rate: sequenceRate });
		}
		return Object.freeze({
			inputIndex, nodeId, sourceId,
			storageKey: data(source, 'storageKey', `source ${sourceId}`),
			mimeType: source.kind === 'video' && source.imageSequence != null
				? 'application/vnd.soundscaper.image-sequence-pack'
				: data(source, 'mimeType', `source ${sourceId}`),
			contentSha256: data(source, 'contentSha256', `source ${sourceId}`),
			timing,
		});
	});
	const placements = activePlacements(project, sequence, {
		sampleStart, sampleDuration, sampleRate, sequenceRate,
	}, tracks);
	const videoPlacements = placements.filter(({ clip }) => clip.kind === 'video').sort(comparePlacements);
	const visualPlacements = placements.filter(({ clip }) => clip.kind === 'still' || clip.kind === 'generator')
		.sort(comparePlacements);
	for (const placement of videoPlacements) {
		const sourceId = String(data(placement.clip, 'sourceId', 'video clip'));
		const source = sourceById.get(sourceId);
		if (!source || source.kind !== 'video') throw new ReferenceError(`Video source ${sourceId} is missing.`);
		if (!timingBySourceId.has(sourceId)) {
			throw new ReferenceError(`Video source ${sourceId} has no authenticated timing authority.`);
		}
	}
	const clipNodes = videoPlacements.map((placement) => {
		assertRepresentedInheritedPictureState(placement.clip);
		const clipId = id(placement.clip, 'video clip');
		const sourceId = String(data(placement.clip, 'sourceId', `video clip ${clipId}`));
		const timing = timingBySourceId.get(sourceId);
		const sourceNodeId = sourceNodeIdById.get(sourceId);
		if (!timing || !sourceNodeId) throw new ReferenceError(`Video clip ${clipId} has no exact source authority.`);
		const intent = createVideoRetimeExportIntentV6({
			sampleStart, sampleDuration, sampleRate,
			sequenceBinding: { id: sequenceId, rate: sequenceRate },
			outputRate: authority.outputRate,
			topology: clipTopology(sampleStart, sampleStart + sampleDuration, placement),
			canonicalClips: [placement.clip],
		}, new Map([[sourceId, timing]]));
		return Object.freeze({
			kind: 'clip' as const,
			nodeId: generatedNodeId('clip', clipId, projectIdentities),
			clipId, trackId: placement.trackId, sourceNodeId,
			sequenceStartFrame: data(placement.clip, 'sequenceStartFrame', `video clip ${clipId}`),
			sequenceFrameCount: data(placement.clip, 'sequenceFrameCount', `video clip ${clipId}`),
			sourceInFrame: data(placement.clip, 'sourceInFrame', `video clip ${clipId}`),
			sourceFrameCount: data(placement.clip, 'sourceFrameCount', `video clip ${clipId}`),
			pictureState: Object.freeze({
				composition: data(placement.clip, 'videoComposition', `video clip ${clipId}`),
				videoEffects: data(placement.clip, 'videoEffects', `video clip ${clipId}`),
				videoKeyframes: data(placement.clip, 'videoKeyframes', `video clip ${clipId}`),
			}) as UnifiedExactRenderClipPictureStateV1,
			sourceTimeMapping: Object.freeze({
				kind: 'video-retime-export-intent-v6' as const,
				sourceRate: data(sourceById.get(sourceId)!, 'frameRate', `source ${sourceId}`),
				retimeMap: data(placement.clip, 'retimeMap', `video clip ${clipId}`),
				intent,
			}),
		});
	});
	const activeClipIds = new Set(clipNodes.map(({ clipId }) => clipId));
	const transitionNodes = transitionNodesForRange(
		project, sequenceId, sequenceRate, sourceById, activeClipIds,
		{ sampleStart, sampleDuration, sampleRate }, projectIdentities,
	);
	const frameCount = ceilingRatio(
		BigInt(sampleDuration) * BigInt(rational(authority.outputRate, 'outputRate').num),
		BigInt(sampleRate) * BigInt(rational(authority.outputRate, 'outputRate').den),
	);
	if (frameCount < 1n || frameCount > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Unified render output frame count is outside the safe exact domain.');
	}
	const representedIdentities = new Set<string>([String(data(project, 'id', 'project'))]);
	for (const source of planSources) { representedIdentities.add(source.sourceId); representedIdentities.add(source.nodeId); }
	for (const track of tracks) representedIdentities.add(track.trackId);
	for (const node of clipNodes) {
		representedIdentities.add(node.nodeId);
		representedIdentities.add(node.clipId);
	}
	for (const node of transitionNodes) {
		representedIdentities.add(String(data(node, 'nodeId', 'transition render node')));
		const transition = record(data(node, 'transition', 'transition render node'), 'transition');
		representedIdentities.add(id(transition, 'transition'));
	}
	const foundation: FramescaperUnifiedRenderFoundation = Object.freeze({
		project, authority, sequence, sequenceRate, sourceById,
		sourceNodeIdById: Object.freeze(sourceNodeIdById),
		projectIdentities, representedIdentities, tracks,
		activeVisualPlacements: Object.freeze(visualPlacements),
		baseNodes: Object.freeze([...clipNodes, ...transitionNodes]),
		rawPlanBase: Object.freeze({
			strategy: 'framescaper-unified-exact-v1' as const,
			project: Object.freeze({
				id: data(project, 'id', 'project') as string,
				revision: data(project, 'revision', 'project') as number,
			}),
			format: authority.format,
			codecs: authority.codecs,
			timebase: Object.freeze({
				sampleStart, sampleDuration, sampleRate, sequenceId, sequenceRate,
			}),
			output: Object.freeze({
				frameRate: authority.outputRate, frameCount: Number(frameCount),
				quality: authority.quality, canvas: authority.canvas, includeAudio: authority.includeAudio,
				audioLayout: authority.audioLayout,
			}),
			tracks,
			sources: Object.freeze(planSources),
		}),
	});
	FOUNDATION_TIMING_SIDECARS.set(foundation, new Map(timingBySourceId));
	return foundation;
}

export function finalizeFramescaperUnifiedRenderPlan<Version extends UnifiedExactRenderPlanVersion>(
	foundation: FramescaperUnifiedRenderFoundation,
	version: Version,
	extraNodes: readonly UnifiedExactRenderNode[] | readonly Readonly<Record<string, unknown>>[],
): UnifiedExactRenderPlan & Readonly<{ readonly version: Version }> {
	const timingSidecars = FOUNDATION_TIMING_SIDECARS.get(foundation);
	if (!timingSidecars) throw new TypeError('An authenticated unified render foundation is required.');
	const plan = createUnifiedExactRenderPlanWithTimingSidecars({
		version,
		...foundation.rawPlanBase,
		nodes: [...foundation.baseNodes, ...extraNodes],
	}, new Map(timingSidecars));
	if (plan.version !== version) throw new RangeError('Unified render plan generation changed during normalization.');
	return plan as UnifiedExactRenderPlan & Readonly<{ readonly version: Version }>;
}

export function generatedNodeId(
	family: string,
	ownerId: string,
	projectIdentities: ReadonlySet<string>,
): string {
	const result = `render:${family}:${ownerId}`;
	if (projectIdentities.has(result)) {
		throw new RangeError(`Generated render node identity ${result} collides with project identity.`);
	}
	return result;
}

function activePlacements(
	project: Readonly<Record<string, unknown>>,
	sequence: Readonly<Record<string, unknown>>,
	time: Readonly<{
		readonly sampleStart: number; readonly sampleDuration: number; readonly sampleRate: number;
		readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
	}>,
	videoTracks: readonly UnifiedExactRenderTrackAuthorityV1[],
): FramescaperActiveVisualPlacement[] {
	const tracksById = uniqueById(records(data(project, 'tracks', 'project'), 'project.tracks'), 'project track');
	const orderById = new Map(videoTracks.map((track) => [track.trackId, track.sequenceOrder]));
	const ownerByClipId = new Map<string, string[]>();
	for (const authority of videoTracks) {
		const trackId = authority.trackId;
		const track = tracksById.get(trackId)!;
		for (const clipId of strings(data(track, 'clipIds', 'video track'), 'video track.clipIds')) {
			const owners = ownerByClipId.get(clipId) ?? [];
			owners.push(trackId);
			ownerByClipId.set(clipId, owners);
		}
	}
	const end = time.sampleStart + time.sampleDuration;
	const result: FramescaperActiveVisualPlacement[] = [];
	for (const clip of records(data(project, 'clips', 'project'), 'project.clips')) {
		if (!['video', 'still', 'generator'].includes(String(clip.kind))
			|| clip.sequenceId !== sequence.id) continue;
		const startSample = sequenceFrameBoundarySample(
			nonNegativeInteger(clip.sequenceStartFrame, 'clip.sequenceStartFrame'),
			time.sequenceRate, time.sampleRate,
		);
		const frameEnd = safeAdd(
			nonNegativeInteger(clip.sequenceStartFrame, 'clip.sequenceStartFrame'),
			positiveInteger(clip.sequenceFrameCount, 'clip.sequenceFrameCount'),
			'clip sequence range',
		);
		const endSample = sequenceFrameBoundarySample(frameEnd, time.sequenceRate, time.sampleRate);
		if (startSample >= end || endSample <= time.sampleStart) continue;
		const clipId = id(clip, 'timeline media clip');
		const owners = ownerByClipId.get(clipId) ?? [];
		if (owners.length !== 1) throw new RangeError(`Active clip ${clipId} requires exactly one video-track owner.`);
		const trackOrder = orderById.get(owners[0]!);
		if (trackOrder === undefined) throw new ReferenceError(`Active clip ${clipId} has no exact video-track state.`);
		result.push(Object.freeze({ clip, trackId: owners[0]!, startSample, endSample, trackOrder }));
	}
	return result;
}

function sequenceVideoTracks(
	project: Readonly<Record<string, unknown>>,
	sequence: Readonly<Record<string, unknown>>,
): readonly UnifiedExactRenderTrackAuthorityV1[] {
	const tracksById = uniqueById(records(data(project, 'tracks', 'project'), 'project.tracks'), 'project track');
	const result: UnifiedExactRenderTrackAuthorityV1[] = [];
	for (const [sequenceOrder, trackId] of strings(
		data(sequence, 'trackIds', 'sequence'), 'sequence.trackIds',
	).entries()) {
		const track = tracksById.get(trackId);
		if (!track) throw new ReferenceError(`Sequence track ${trackId} is missing.`);
		if (track.type !== 'video') continue;
		assertRepresentableVideoTrack(track);
		result.push(Object.freeze({
			trackId, sequenceOrder,
			mute: boolean(data(track, 'mute', `video track ${trackId}`), `video track ${trackId}.mute`),
			solo: boolean(data(track, 'solo', `video track ${trackId}`), `video track ${trackId}.solo`),
			hidden: boolean(data(track, 'hidden', `video track ${trackId}`), `video track ${trackId}.hidden`),
		}));
	}
	return Object.freeze(result);
}

function assertRepresentedInheritedPictureState(clip: Readonly<Record<string, unknown>>): void {
	const clipId = id(clip, 'video clip');
	if (!Array.isArray(data(clip, 'videoEffects', `video clip ${clipId}`))) {
		throw new TypeError(`Video clip ${clipId} effects must be an exact array.`);
	}
	record(data(clip, 'videoKeyframes', `video clip ${clipId}`), `video clip ${clipId}.videoKeyframes`);
	record(data(clip, 'videoComposition', `video clip ${clipId}`), `video clip ${clipId}.videoComposition`);
	if (clip.speedRatio !== 1) {
		throw new RangeError(`Video clip ${clipId} has legacy speed state outside its exact retime map.`);
	}
	assertEmptyRecord(clip.opaqueExtensions, `video clip ${clipId}.opaqueExtensions`);
}

function assertRepresentableVideoTrack(track: Readonly<Record<string, unknown>>): void {
	const trackId = id(track, 'video track');
	for (const key of ['mute', 'solo', 'hidden'] as const) boolean(
		data(track, key, `video track ${trackId}`), `video track ${trackId}.${key}`,
	);
	assertEmptyRecord(track.opaqueExtensions, `video track ${trackId}.opaqueExtensions`);
}

function transitionNodesForRange(
	project: Readonly<Record<string, unknown>>,
	sequenceId: string,
	sequenceRate: Readonly<{ readonly num: number; readonly den: number }>,
	sourceById: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
	activeClipIds: ReadonlySet<string>,
	time: Readonly<{ readonly sampleStart: number; readonly sampleDuration: number; readonly sampleRate: number }>,
	projectIdentities: ReadonlySet<string>,
): Readonly<Record<string, unknown>>[] {
	const clipById = uniqueById(records(data(project, 'clips', 'project'), 'project.clips'), 'project clip');
	const end = time.sampleStart + time.sampleDuration;
	const nodes: Readonly<Record<string, unknown>>[] = [];
	for (const track of records(data(project, 'tracks', 'project'), 'project.tracks')) {
		if (track.type !== 'video' || !Array.isArray(track.videoTransitions)) continue;
		for (const transition of records(track.videoTransitions, 'videoTransitions')) {
			const outgoing = clipById.get(String(transition.outgoingClipId));
			const incoming = clipById.get(String(transition.incomingClipId));
			if (!outgoing || !incoming || outgoing.sequenceId !== sequenceId || incoming.sequenceId !== sequenceId) continue;
			const overlapStart = sequenceFrameBoundarySample(
				nonNegativeInteger(incoming.sequenceStartFrame, 'transition incoming start'),
				sequenceRate, time.sampleRate,
			);
			const outgoingEndFrame = safeAdd(
				nonNegativeInteger(outgoing.sequenceStartFrame, 'transition outgoing start'),
				positiveInteger(outgoing.sequenceFrameCount, 'transition outgoing duration'),
				'transition outgoing range',
			);
			const overlapEnd = sequenceFrameBoundarySample(outgoingEndFrame, sequenceRate, time.sampleRate);
			if (overlapStart >= end || overlapEnd <= time.sampleStart) continue;
			const outgoingId = id(outgoing, 'transition outgoing clip');
			const incomingId = id(incoming, 'transition incoming clip');
			if (!activeClipIds.has(outgoingId) || !activeClipIds.has(incomingId)) {
				throw new RangeError('An active transition is missing an exact participant mapping.');
			}
			const transitionId = id(transition, 'video transition');
			nodes.push(Object.freeze({
				kind: 'transition' as const,
				nodeId: generatedNodeId('transition', transitionId, projectIdentities),
				transition,
				edges: Object.freeze({
					schemaVersion: 1, sequenceId, trackId: id(track, 'video track'),
					outgoing: transitionEdge(outgoing, sourceById, sequenceRate),
					incoming: transitionEdge(incoming, sourceById, sequenceRate),
				}),
			}));
		}
	}
	return nodes;
}

function transitionEdge(
	clip: Readonly<Record<string, unknown>>,
	sourceById: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
	sequenceRate: Readonly<{ readonly num: number; readonly den: number }>,
) {
	const sourceId = String(data(clip, 'sourceId', 'transition clip'));
	const source = sourceById.get(sourceId);
	if (!source || source.kind !== 'video') throw new ReferenceError(`Transition source ${sourceId} is missing.`);
	return Object.freeze({
		clipId: id(clip, 'transition clip'), sourceId,
		sequenceStartFrame: data(clip, 'sequenceStartFrame', 'transition clip'),
		sequenceFrameCount: data(clip, 'sequenceFrameCount', 'transition clip'),
		sequenceRate,
		sourceInFrame: data(clip, 'sourceInFrame', 'transition clip'),
		sourceFrameCount: data(clip, 'sourceFrameCount', 'transition clip'),
		sourceRate: data(source, 'frameRate', `source ${sourceId}`),
		retimeMap: data(clip, 'retimeMap', 'transition clip'),
	});
}

function clipTopology(sampleStart: number, sampleEnd: number, placement: FramescaperActiveVisualPlacement) {
	const activeStart = Math.max(sampleStart, placement.startSample);
	const activeEnd = Math.min(sampleEnd, placement.endSample);
	return Object.freeze([
		...(activeStart === sampleStart ? [] : [{ startSample: sampleStart, endSample: activeStart, layers: [] }]),
		{ startSample: activeStart, endSample: activeEnd, layers: [{ clips: [{ clipId: id(placement.clip, 'clip') }] }] },
		...(activeEnd === sampleEnd ? [] : [{ startSample: activeEnd, endSample: sampleEnd, layers: [] }]),
	]);
}

function exactTimingViews(
	value: ReadonlyMap<string, VideoSourceTimingView>,
	sources: readonly Readonly<Record<string, unknown>>[],
): ReadonlyMap<string, VideoSourceTimingView> {
	if (!(value instanceof Map)) throw new TypeError('Unified render timingViews must be an actual Map.');
	const expected = new Set(sources.filter(({ kind }) => kind === 'video').map((source) => id(source, 'video source')));
	const entries = [...Map.prototype.entries.call(value) as MapIterator<[unknown, unknown]>];
	if (entries.length !== expected.size) throw new RangeError('Unified render timingViews must contain exactly every video source.');
	const result = new Map<string, VideoSourceTimingView>();
	for (const [key, timing] of entries) {
		if (typeof key !== 'string' || !expected.has(key)) {
			throw new RangeError('Unified render timingViews contain an unused or unknown source identity.');
		}
		result.set(key, timing as VideoSourceTimingView);
	}
	return result;
}

function collectProjectIdentities(project: Readonly<Record<string, unknown>>): ReadonlySet<string> {
	const result = new Set<string>([id(project, 'project')]);
	for (const key of [
		'sources', 'clips', 'tracks', 'sequences', 'subsequences', 'multicameraGroups',
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes',
	] as const) {
		if (!Array.isArray(project[key])) continue;
		for (const item of records(project[key], key)) result.add(id(item, key));
	}
	const bin = record(data(project, 'projectBin', 'project'), 'project.projectBin');
	for (const clip of records(data(bin, 'clips', 'projectBin'), 'projectBin.clips')) result.add(id(clip, 'bin clip'));
	for (const track of records(data(project, 'tracks', 'project'), 'project.tracks')) {
		if (!Array.isArray(track.videoTransitions)) continue;
		for (const transition of records(track.videoTransitions, 'videoTransitions')) {
			result.add(id(transition, 'transition'));
		}
	}
	if (Array.isArray(project.ofxEffects)) {
		for (const state of records(project.ofxEffects, 'ofxEffects')) result.add(String(state.instanceId));
	}
	return result;
}

function uniqueById(
	values: readonly Readonly<Record<string, unknown>>[],
	name: string,
): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
	const result = new Map<string, Readonly<Record<string, unknown>>>();
	for (const value of values) {
		const key = id(value, name);
		if (result.has(key)) throw new RangeError(`${name} identity ${key} is duplicated.`);
		result.set(key, value);
	}
	return result;
}

function data(value: Readonly<Record<string, unknown>>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function assertEmptyRecord(value: unknown, name: string): void {
	const candidate = record(value, name);
	if (Reflect.ownKeys(candidate).length !== 0) {
		throw new RangeError(`${name} contains render state that is not represented by unified plans V9-V12.`);
	}
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function strings(value: unknown, name: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new TypeError(`${name} must be a string array.`);
	return [...value] as string[];
}

function id(value: Readonly<Record<string, unknown>>, name: string): string {
	return text(data(value, 'id', name), `${name}.id`);
}

function text(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be nonempty text.`);
	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

function rational(value: unknown, name: string): Readonly<{ readonly num: number; readonly den: number }> {
	const candidate = record(value, name);
	const num = positiveInteger(data(candidate, 'num', name), `${name}.num`);
	const den = positiveInteger(data(candidate, 'den', name), `${name}.den`);
	if (gcd(num, den) !== 1) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} overflows.`);
	return result;
}

function ceilingRatio(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}

function compareIds(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): number {
	return compareText(id(left, 'identity'), id(right, 'identity'));
}

function comparePlacements(left: FramescaperActiveVisualPlacement, right: FramescaperActiveVisualPlacement): number {
	return left.trackOrder - right.trackOrder
		|| left.startSample - right.startSample
		|| compareText(id(left.clip, 'clip'), id(right.clip, 'clip'));
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function gcd(left: number, right: number): number { while (right !== 0) [left, right] = [right, left % right]; return left; }
