/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	normalizeCanonicalTransitionClipEdgesV1,
	videoTransitionGeometryV1,
	type CanonicalTransitionClipEdgeV1,
	type CanonicalTransitionClipEdgesV1,
} from '../common/editor/video-transition-resolution.ts';
import {
	createDefaultDissolveVideoTransitionV1,
	requireVideoTransitionTypeRegistrationV1,
} from '../common/editor/video-transition-registry.ts';
import {
	normalizeVideoTransitionAllocationsV1,
	normalizeVideoTransitionV1,
	type VideoTransitionAllocationV1,
	type VideoTransitionV1,
} from '../common/editor/video-transition-v1.ts';
import { reconcileFramescaperProjectFeatureRequirementsV22 } from './editor-project-feature-requirements-v22.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';
import {
	applyFramescaperProjectCommandV20,
	snapshotFramescaperProjectCommandV20,
	type FramescaperProjectCommandOptionsV20,
} from './editor-project-v20-commands.ts';
import {
	normalizeFramescaperProjectTransitionsV22,
	type FramescaperProjectV22,
} from './editor-project-v22.ts';
import {
	framescaperProjectProperOverlapsV22,
	framescaperProjectV20FoundationV22,
	validateFramescaperProjectV22,
} from './editor-project-v22-validation.ts';

export interface FramescaperVideoTransitionSetCommandV22 {
	readonly type: 'video-transition/set';
	readonly trackId: string;
	readonly transitionId: string;
	readonly expectedTransition: VideoTransitionV1;
	readonly transition: VideoTransitionV1;
	readonly expectedEdges: CanonicalTransitionClipEdgesV1;
	readonly edges: CanonicalTransitionClipEdgesV1;
}

export type FramescaperProjectCommandV22 =
	| FramescaperVideoTransitionSetCommandV22
	| (Readonly<Record<string, unknown>> & { readonly type: string });
export type FramescaperProjectCommandOptionsV22 = FramescaperProjectCommandOptionsV20;

const SET_FIELDS = Object.freeze([
	'type', 'trackId', 'transitionId', 'expectedTransition', 'transition', 'expectedEdges', 'edges',
]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function snapshotFramescaperProjectCommandV22(command: unknown): FramescaperProjectCommandV22 {
	const type = commandType(command);
	if (type === 'video-transition/set') return snapshotTransitionSet(command);
	if (type === 'batch') {
		const record = readClosedDomainRecord(command, 'Framescaper V22 batch', ['type', 'commands']);
		const commands = readClosedDomainArray(
			readClosedDomainField(record, 'commands', 'Framescaper V22 batch'),
			'Framescaper V22 batch.commands', 1, 100_000,
		);
		return Object.freeze({
			type: 'batch',
			commands: Object.freeze(commands.map(snapshotFramescaperProjectCommandV22)),
		});
	}
	return snapshotInheritedCarrier(command);
}

export function applyFramescaperProjectCommandV22(
	profile: unknown,
	project: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV22 = {},
): FramescaperProjectV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	validateFramescaperProjectV22(profile, project);
	const normalized = snapshotFramescaperProjectCommandV22(command);
	if (isTransitionSetCommand(normalized)) {
		return applyTransitionSet(profile, project as FramescaperProjectV22, normalized, options);
	}
	return applyInherited(profile, project as FramescaperProjectV22, normalized, options);
}

export function canonicalTransitionEdgesForProjectV22(
	profile: unknown,
	project: unknown,
	trackIdValue: unknown,
	transitionIdValue: unknown,
): CanonicalTransitionClipEdgesV1 {
	assertFramescaperProjectV22CandidateProfile(profile);
	validateFramescaperProjectV22(profile, project);
	const candidate = project as FramescaperProjectV22;
	const trackId = stableId(trackIdValue, 'trackId');
	const transitionId = stableId(transitionIdValue, 'transitionId');
	const track = candidate.tracks.find((item) => item.id === trackId && item.type === 'video');
	if (!track || track.type !== 'video') throw new ReferenceError(`Video track ${trackId} does not exist.`);
	const transition = track.videoTransitions.find(({ id }) => id === transitionId);
	if (!transition) throw new ReferenceError(`Video transition ${transitionId} does not exist.`);
	const clips = new Map(candidate.clips.map((clip) => [String(clip.id), clip]));
	const outgoing = clips.get(transition.outgoingClipId);
	const incoming = clips.get(transition.incomingClipId);
	if (!outgoing || !incoming) throw new ReferenceError('Video transition participants are missing.');
	const sequenceId = String(outgoing.sequenceId);
	if (sequenceId !== incoming.sequenceId) throw new RangeError('Video transition participants cross sequences.');
	const sequence = candidate.sequences.find((item) => item.id === sequenceId);
	if (!sequence) throw new ReferenceError(`Sequence ${sequenceId} does not exist.`);
	const sources = new Map(candidate.sources.map((source) => [String(source.id), source]));
	return normalizeCanonicalTransitionClipEdgesV1({
		schemaVersion: 1,
		sequenceId,
		trackId,
		outgoing: clipEdge(outgoing, sources.get(String(outgoing.sourceId)), sequence.rate),
		incoming: clipEdge(incoming, sources.get(String(incoming.sourceId)), sequence.rate),
	});
}

function applyTransitionSet(
	profile: unknown,
	project: FramescaperProjectV22,
	command: FramescaperVideoTransitionSetCommandV22,
	options: FramescaperProjectCommandOptionsV22,
): FramescaperProjectV22 {
	const track = project.tracks.find(({ id }) => id === command.trackId);
	if (!track || track.type !== 'video') throw new ReferenceError(`Video track ${command.trackId} does not exist.`);
	if (track.locked === true) throw new Error(`Video track ${command.trackId} is locked.`);
	const current = track.videoTransitions.find(({ id }) => id === command.transitionId);
	if (!current || !same(current, command.expectedTransition)) {
		throw new Error('The expected video transition is stale.');
	}
	const currentEdges = canonicalTransitionEdgesForProjectV22(
		profile, project, command.trackId, command.transitionId,
	);
	if (!same(currentEdges, command.expectedEdges)) throw new Error('The expected video transition edges are stale.');
	assertSetIdentity(command, current);
	requireVideoTransitionTypeRegistrationV1(command.transition.type);
	videoTransitionGeometryV1(command.transition, command.edges);
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyClipEdge(draft, command.edges.outgoing);
	applyClipEdge(draft, command.edges.incoming);
	const targetTrack = tracks(draft).find((item) => item.id === command.trackId)!;
	const transitions = targetTrack.videoTransitions as VideoTransitionV1[];
	targetTrack.videoTransitions = transitions.map((transition) => (
		transition.id === command.transitionId ? command.transition : transition
	));
	advanceBookkeeping(draft, project, options);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV22(profile, draft);
	normalizeFramescaperProjectTransitionsV22(draft);
	validateFramescaperProjectV22(profile, draft);
	return draft as FramescaperProjectV22;
}

function applyInherited(
	profile: unknown,
	project: FramescaperProjectV22,
	command: FramescaperProjectCommandV22,
	options: FramescaperProjectCommandOptionsV22,
): FramescaperProjectV22 {
	const allocations = collectAllocations(command);
	const foundation = framescaperProjectV20FoundationV22(profile, project);
	const applied = applyFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		foundation,
		stripAllocations(command) as never,
		options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion = 22;
	for (const track of tracks(applied)) if (track.type === 'video') track.videoTransitions = [];
	const oldByPair = transitionMap(project);
	const allocationsByPair = new Map(allocations.map((allocation) => [allocationKey(allocation), allocation]));
	const used = new Set<string>();
	for (const overlap of framescaperProjectProperOverlapsV22(applied)) {
		const key = JSON.stringify([overlap.trackId, overlap.outgoing.id, overlap.incoming.id]);
		const prior = oldByPair.get(key);
		let transition: VideoTransitionV1;
		if (prior) {
			transition = retimeTransition(prior, overlap.end - overlap.start);
		} else {
			const allocation = allocationsByPair.get(key);
			if (!allocation) throw new RangeError(`A new overlap ${key} requires videoTransitionAllocations.`);
			used.add(key);
			transition = createDefaultDissolveVideoTransitionV1({
				id: allocation.transitionId,
				outgoingClipId: allocation.outgoingClipId,
				incomingClipId: allocation.incomingClipId,
				durationFrames: overlap.end - overlap.start,
			});
		}
		const track = tracks(applied).find((item) => item.id === overlap.trackId)!;
		(track.videoTransitions as VideoTransitionV1[]).push(transition);
	}
	if (used.size !== allocations.length) {
		throw new RangeError('A video transition allocation was duplicate, mismatched, or unused.');
	}
	normalizeFramescaperProjectTransitionsV22(applied);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV22(profile, applied);
	validateFramescaperProjectV22(profile, applied);
	return applied as FramescaperProjectV22;
}

function snapshotTransitionSet(value: unknown): FramescaperVideoTransitionSetCommandV22 {
	const record = readClosedDomainRecord(value, 'Framescaper V22 transition set', SET_FIELDS);
	const transitionId = stableId(readClosedDomainField(record, 'transitionId', 'transition set'), 'transitionId');
	const expectedTransition = normalizeVideoTransitionV1(readClosedDomainField(record, 'expectedTransition', 'transition set'));
	const transition = normalizeVideoTransitionV1(readClosedDomainField(record, 'transition', 'transition set'));
	return Object.freeze({
		type: 'video-transition/set',
		trackId: stableId(readClosedDomainField(record, 'trackId', 'transition set'), 'trackId'),
		transitionId,
		expectedTransition,
		transition,
		expectedEdges: normalizeCanonicalTransitionClipEdgesV1(readClosedDomainField(record, 'expectedEdges', 'transition set')),
		edges: normalizeCanonicalTransitionClipEdgesV1(readClosedDomainField(record, 'edges', 'transition set')),
	});
}

function snapshotInheritedCarrier(value: unknown): FramescaperProjectCommandV22 {
	const record = recordValue(value, 'Framescaper V22 inherited command');
	const allocationDescriptor = Object.getOwnPropertyDescriptor(record, 'videoTransitionAllocations');
	if (allocationDescriptor && (!allocationDescriptor.enumerable || !Object.hasOwn(allocationDescriptor, 'value'))) {
		throw new TypeError('videoTransitionAllocations must be an own enumerable data property.');
	}
	const stripped = structuredClone(record);
	delete stripped.videoTransitionAllocations;
	const inherited = snapshotFramescaperProjectCommandV20(stripped as never) as unknown as Record<string, unknown>;
	if (!allocationDescriptor) return inherited as FramescaperProjectCommandV22;
	return Object.freeze({
		...inherited,
		videoTransitionAllocations: normalizeVideoTransitionAllocationsV1(allocationDescriptor.value),
		}) as unknown as FramescaperProjectCommandV22;
}

function collectAllocations(command: FramescaperProjectCommandV22): readonly VideoTransitionAllocationV1[] {
	if (command.type === 'batch') {
		return Object.freeze((command.commands as readonly FramescaperProjectCommandV22[])
			.flatMap((child) => [...collectAllocations(child)]));
	}
	const descriptor = Object.getOwnPropertyDescriptor(command, 'videoTransitionAllocations');
	return descriptor ? normalizeVideoTransitionAllocationsV1(descriptor.value) : Object.freeze([]);
}

function stripAllocations(command: FramescaperProjectCommandV22): Record<string, unknown> {
	if (command.type === 'batch') return {
		type: 'batch',
		commands: (command.commands as readonly FramescaperProjectCommandV22[]).map(stripAllocations),
	};
	const result = structuredClone(command) as Record<string, unknown>;
	delete result.videoTransitionAllocations;
	return result;
}

function transitionMap(project: FramescaperProjectV22): Map<string, VideoTransitionV1> {
	const output = new Map<string, VideoTransitionV1>();
	for (const track of project.tracks) {
		if (track.type !== 'video') continue;
		for (const transition of track.videoTransitions) output.set(JSON.stringify([
			track.id, transition.outgoingClipId, transition.incomingClipId,
		]), transition);
	}
	return output;
}

function retimeTransition(transition: VideoTransitionV1, durationFrames: number): VideoTransitionV1 {
	if (transition.durationFrames === durationFrames) return normalizeVideoTransitionV1(transition);
	const scalePosition = (position: Readonly<{ num: number; den: number }>) => scaleRational(
		position.num, position.den, durationFrames, transition.durationFrames,
	);
	return normalizeVideoTransitionV1({
		...transition,
		durationFrames,
		curve: {
			anchors: transition.curve.anchors.map((anchor) => ({ ...anchor, position: scalePosition(anchor.position) })),
			segments: transition.curve.segments.map((segment) => segment.kind !== 'bezier' ? segment : ({
				...segment,
				control1: { ...segment.control1, position: scalePosition(segment.control1.position) },
				control2: { ...segment.control2, position: scalePosition(segment.control2.position) },
			})),
		},
	});
}

function scaleRational(num: number, den: number, numerator: number, denominator: number) {
	let scaledNum = BigInt(num) * BigInt(numerator);
	let scaledDen = BigInt(den) * BigInt(denominator);
	const divisor = gcd(scaledNum < 0n ? -scaledNum : scaledNum, scaledDen);
	scaledNum /= divisor;
	scaledDen /= divisor;
	if (scaledNum > BigInt(Number.MAX_SAFE_INTEGER) || scaledDen > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Scaled transition curve position exceeds the exact rational domain.');
	}
	return Object.freeze({ num: Number(scaledNum), den: Number(scaledDen) });
}

function gcd(left: bigint, right: bigint): bigint {
	let a = left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a === 0n ? 1n : a;
}

function assertSetIdentity(command: FramescaperVideoTransitionSetCommandV22, current: VideoTransitionV1): void {
	for (const transition of [command.expectedTransition, command.transition]) {
		if (transition.id !== command.transitionId || transition.id !== current.id
			|| transition.outgoingClipId !== current.outgoingClipId
			|| transition.incomingClipId !== current.incomingClipId) {
			throw new RangeError('A transition set cannot change transition or pair identity.');
		}
	}
	for (const edges of [command.expectedEdges, command.edges]) {
		if (edges.trackId !== command.trackId
			|| edges.outgoing.clipId !== current.outgoingClipId
			|| edges.incoming.clipId !== current.incomingClipId) {
			throw new RangeError('Transition edges do not match the command owner and pair.');
		}
	}
}

function clipEdge(
	clip: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>> | undefined,
	sequenceRate: unknown,
): CanonicalTransitionClipEdgeV1 {
	if (!source) throw new ReferenceError(`Video source ${String(clip.sourceId)} does not exist.`);
	return {
		clipId: String(clip.id),
		sourceId: String(clip.sourceId),
		sequenceStartFrame: Number(clip.sequenceStartFrame),
		sequenceFrameCount: Number(clip.sequenceFrameCount),
		sequenceRate: sequenceRate as CanonicalTransitionClipEdgeV1['sequenceRate'],
		sourceInFrame: Number(clip.sourceInFrame),
		sourceFrameCount: Number(clip.sourceFrameCount),
		sourceRate: source.frameRate as CanonicalTransitionClipEdgeV1['sourceRate'],
		retimeMap: clip.retimeMap as CanonicalTransitionClipEdgeV1['retimeMap'],
	};
}

function applyClipEdge(project: Record<string, unknown>, edge: CanonicalTransitionClipEdgeV1): void {
	const clip = (project.clips as Record<string, unknown>[]).find(({ id }) => id === edge.clipId);
	if (!clip) throw new ReferenceError(`Video clip ${edge.clipId} does not exist.`);
	Object.assign(clip, {
		sourceId: edge.sourceId,
		sequenceStartFrame: edge.sequenceStartFrame,
		sequenceFrameCount: edge.sequenceFrameCount,
		sourceInFrame: edge.sourceInFrame,
		sourceFrameCount: edge.sourceFrameCount,
		retimeMap: edge.retimeMap,
	});
}

function advanceBookkeeping(
	draft: Record<string, unknown>,
	project: FramescaperProjectV22,
	options: FramescaperProjectCommandOptionsV22,
): void {
	const revision = project.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V22 revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: unknown): string {
	const date = value === undefined ? new Date() : new Date(String(value));
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V22 timestamp is invalid.');
	return date.toISOString();
}

function allocationKey(allocation: VideoTransitionAllocationV1): string {
	return JSON.stringify([allocation.trackId, allocation.outgoingClipId, allocation.incomingClipId]);
}

function commandType(value: unknown): string {
	const record = recordValue(value, 'Framescaper V22 command');
	const type = readClosedDomainField(record, 'type', 'Framescaper V22 command');
	if (typeof type !== 'string') throw new TypeError('Framescaper V22 command type must be a string.');
	return type;
}

function isTransitionSetCommand(
	command: FramescaperProjectCommandV22,
): command is FramescaperVideoTransitionSetCommandV22 {
	return command.type === 'video-transition/set'
		&& Object.hasOwn(command, 'expectedTransition')
		&& Object.hasOwn(command, 'expectedEdges');
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function tracks(project: Record<string, unknown>): Record<string, unknown>[] {
	if (!Array.isArray(project.tracks)) throw new TypeError('Framescaper V22 tracks must be an array.');
	return project.tracks as Record<string, unknown>[];
}

function recordValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
