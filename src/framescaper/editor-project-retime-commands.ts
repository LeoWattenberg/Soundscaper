/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	admitAudioEditorProjectValidationStructure,
} from '../common/editor/project-validation-budget.ts';
import {
	createDefaultVideoKeyframeCurves,
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import { createVideoKeyframesRuntimeHandlers } from '../common/editor/commands/video-keyframes-runtime.ts';
import {
	snapshotVideoKeyframesSetCommand,
	type VideoKeyframesSetCommand,
} from '../common/editor/commands/video-keyframes.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsRetime,
} from './editor-project-feature-requirements-retime.ts';
import {
	admitFramescaperProjectCommandRetimeStructure,
} from './editor-project-retime-command-admission.ts';
import { flattenFramescaperProjectBatchCommandsRetime } from './editor-project-retime-batch-command.ts';
import { FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandComposition,
	isFramescaperVideoCompositionCommandComposition,
	snapshotFramescaperProjectCommandComposition,
	type FramescaperProjectCommandOptionsComposition,
	type FramescaperProjectCommandComposition,
} from './editor-project-composition-commands.ts';
import { normalizeFramescaperProjectClipCompositionsComposition } from './editor-project-composition.ts';
import {
	applyFramescaperProjectCommandSequence,
} from './editor-project-sequence-commands.ts';
import {
	isFramescaperVideoRetimeCommandRetime,
	resolveFramescaperVideoRetimeMapRetime,
	snapshotFramescaperVideoRetimeCommandRetime,
	type FramescaperVideoRetimeCommandRetime,
} from './editor-project-retime-retime-command.ts';
import {
	clearFramescaperVideoRetimeMapsRetime,
	findFramescaperVideoClipRetime,
	framescaperVideoRetimeBindingRetime,
	normalizeFramescaperVideoRetimeCurveRetime,
	restoreFramescaperVideoRetimeMapsAfterCommandRetime,
	snapshotFramescaperVideoRetimeMapsRetime,
} from './editor-project-retime-retime-state.ts';
import {
	framescaperRetimeFreshVideoAddAvLinkIds,
	framescaperRetimeSegmentContainsAvLinkPair,
	framescaperRetimeSegmentContainsAvLinkPeer,
} from './editor-project-retime-av-link-command-segmentation.ts';
import { framescaperRetimeExplicitFreshVideoIds } from './editor-project-retime-fresh-video-command.ts';
import { detachFramescaperVideoProxyDraftRetime, isFramescaperVideoProxyDetachCommandRetime, snapshotFramescaperVideoProxyDetachCommandRetime, type FramescaperVideoProxyDetachCommandRetime } from './editor-video-proxy-command-retime.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectCommandSequence } from './editor-project-sequence-subsequence.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import {
	framescaperProjectCompositionFoundationRetime,
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';
import { framescaperProjectSequenceFoundationComposition } from './editor-project-composition-validation.ts';

export type FramescaperProjectCommandRetime =
	| FramescaperProjectCommandComposition
	| VideoKeyframesSetCommand
	| FramescaperVideoRetimeCommandRetime | FramescaperVideoProxyDetachCommandRetime;
export type FramescaperProjectCommandOptionsRetime = FramescaperProjectCommandOptionsComposition;
type DataRecord = Record<string, unknown>;
type ClipScope = 'timeline' | 'project-bin';
interface KeyframeSnapshot {
	readonly scope: ClipScope;
	readonly id: string;
	readonly keyframes: VideoKeyframeCurves;
}

const BATCH_FIELDS = Object.freeze(['type', 'commands']);
const MAXIMUM_BATCH_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_BATCH_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;
const MAXIMUM_BATCH_ORDERED_BOUNDARIES = 128;
const VIDEO_KEYFRAME_HANDLERS = createVideoKeyframesRuntimeHandlers();

interface CommandSnapshotBudget {
	readonly activeBatches: Set<object>;
	commandCount: number;
	orderedBoundaryCount: number;
}

/** Snapshot the one retime-owned command before project-context validation. */
export function normalizeFramescaperProjectCommandRetime(
	value: unknown,
): VideoKeyframesSetCommand | FramescaperVideoRetimeCommandRetime | FramescaperVideoProxyDetachCommandRetime {
	return isFramescaperVideoProxyDetachCommandRetime(value)
		? snapshotFramescaperVideoProxyDetachCommandRetime(value)
		: isFramescaperVideoRetimeCommandRetime(value)
		? snapshotFramescaperVideoRetimeCommandRetime(value)
		: snapshotVideoKeyframesSetCommand(value);
}

export function isFramescaperVideoKeyframesCommandRetime(
	value: FramescaperProjectCommandRetime | unknown,
): value is VideoKeyframesSetCommand {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(
		descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& descriptor.value === 'video-keyframes/set',
	);
}

/** Snapshot one exact retime command, including recursively closed mixed batches. */
export function snapshotFramescaperProjectCommandRetime(
	command: FramescaperProjectCommandRetime | unknown,
): FramescaperProjectCommandRetime {
	admitFramescaperProjectCommandRetimeStructure(command);
	return snapshotCommand(command, {
		activeBatches: new Set(),
		commandCount: 0,
		orderedBoundaryCount: 0,
	}, 0);
}

/**
 * Execute against exact retime authority without ever presenting keyframes to the
 * public composition validator. Mixed batches publish one revision or no revision.
 */
export function applyFramescaperProjectCommandRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
	command: FramescaperProjectCommandRetime,
	options: FramescaperProjectCommandOptionsRetime = {},
): FramescaperProjectRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectRetime(profile, project);
	const persisted = project as FramescaperProjectRetime;
	const normalized = snapshotFramescaperProjectCommandRetime(command);
	return applySingle(profile, persisted, normalized, options);
}

function snapshotCommand(
	command: unknown,
	budget: CommandSnapshotBudget,
	depth: number,
): FramescaperProjectCommandRetime {
	budget.commandCount += 1;
	if (budget.commandCount > MAXIMUM_BATCH_COMMANDS) {
		throw new RangeError('Framescaper retime command tree exceeds its command limit.');
	}
	if (depth > MAXIMUM_BATCH_DEPTH) {
		throw new RangeError('Framescaper retime command tree exceeds its nesting depth limit.');
	}
	const type = commandType(command);
	if (type === 'video-keyframes/set') {
		countOrderedBoundary(budget);
		return normalizeFramescaperProjectCommandRetime(command);
	}
	if (type.startsWith('video-retime/')) {
		countOrderedBoundary(budget);
		return snapshotFramescaperVideoRetimeCommandRetime(command);
	}
	if (type === 'framescaper/video-proxy-detach') {
		countOrderedBoundary(budget);
		return snapshotFramescaperVideoProxyDetachCommandRetime(command);
	}
	if (type === 'batch') {
		const record = readClosedDomainRecord(command, 'Framescaper retime command batch', BATCH_FIELDS);
		if (budget.activeBatches.has(record)) {
			throw new TypeError('Cyclic Framescaper retime command batches are not supported.');
		}
		const commands = readClosedDomainArray(
			readClosedDomainField(record, 'commands', 'Framescaper retime command batch'),
			'Framescaper retime command batch.commands',
			1,
			MAXIMUM_BATCH_COMMANDS,
		);
		budget.activeBatches.add(record);
		try {
			return Object.freeze({
				type: 'batch',
				commands: Object.freeze(commands.map((child) => snapshotCommand(
					child, budget, depth + 1,
				))),
			}) as FramescaperProjectCommandRetime;
		} finally {
			budget.activeBatches.delete(record);
		}
	}
	admitAudioEditorProjectValidationStructure(
		command,
		AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	);
	const inherited = snapshotFramescaperProjectCommandComposition(command as FramescaperProjectCommandComposition);
	if (framescaperRetimeExplicitFreshVideoIds(inherited).size > 0) countOrderedBoundary(budget);
	return inherited;
}

function countOrderedBoundary(budget: CommandSnapshotBudget): void {
	budget.orderedBoundaryCount += 1;
	if (budget.orderedBoundaryCount > MAXIMUM_BATCH_ORDERED_BOUNDARIES) {
		throw new RangeError('Framescaper retime command tree exceeds its ordered execution boundary limit.');
	}
}

function applySingle(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
	command: FramescaperProjectCommandRetime,
	options: FramescaperProjectCommandOptionsRetime,
): FramescaperProjectRetime {
	if (command.type === 'batch') {
		return applyBatch(profile, project, command, options);
	}
	if (isFramescaperVideoKeyframesCommandRetime(command)) {
		return applyVideoKeyframes(profile, project, command, options);
	}
	if (isFramescaperVideoRetimeCommandRetime(command)) {
		return applyVideoRetime(profile, project, command, options);
	}
	if (isFramescaperVideoProxyDetachCommandRetime(command)) {
		return applyVideoProxyDetach(profile, project, command, options);
	}
	return applyInherited(profile, project, command, options);
}

function applyBatch(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
	command: Extract<FramescaperProjectCommandRetime, { readonly type: 'batch' }>,
	options: FramescaperProjectCommandOptionsRetime,
): FramescaperProjectRetime {
	nextRevision(project);
	const commands = flattenFramescaperProjectBatchCommandsRetime(command);
	const needsOrderedSegmentation = commands.some((child) => (
		isFramescaperVideoKeyframesCommandRetime(child) || isFramescaperVideoRetimeCommandRetime(child)
		|| isFramescaperVideoProxyDetachCommandRetime(child) || child.type === 'sequence/create' || child.type === 'sequence/delete'
	))
		|| (commands.length > 1
			&& commands.some((child) => framescaperRetimeExplicitFreshVideoIds(child).size > 0));
	if (!needsOrderedSegmentation) {
		return applyInherited(profile, project, command, options);
	}
	let current = project;
	let inherited: FramescaperProjectCommandRetime[] = [];
	let inheritedContainsFreshVideo = false;
	const pendingFreshAvLinks = new Set<string>();
	const intermediateOptions: FramescaperProjectCommandOptionsRetime = Object.freeze({
		now: String(project.updatedAt),
	});
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		const group = inherited.length === 1 ? inherited[0]! : Object.freeze({
			type: 'batch' as const,
			commands: Object.freeze(inherited),
		}) as FramescaperProjectCommandRetime;
		current = applyInherited(profile, current, group, intermediateOptions);
		restoreOuterBookkeeping(current, project);
		inherited = [];
		inheritedContainsFreshVideo = false;
		pendingFreshAvLinks.clear();
	};
	for (const child of commands) {
		if (!isFramescaperVideoKeyframesCommandRetime(child)
			&& !isFramescaperVideoRetimeCommandRetime(child)
			&& !isFramescaperVideoProxyDetachCommandRetime(child) && child.type !== 'sequence/create' && child.type !== 'sequence/delete') {
			const createsFreshVideo = framescaperRetimeExplicitFreshVideoIds(child).size > 0;
			const freshAvLinks = framescaperRetimeFreshVideoAddAvLinkIds(child);
			const joinsPriorPeer = freshAvLinks.some((avLinkId) => (
				framescaperRetimeSegmentContainsAvLinkPeer(inherited, avLinkId)
			));
			if (createsFreshVideo && pendingFreshAvLinks.size === 0 && !joinsPriorPeer) {
				flushInherited();
			}
			inherited.push(child);
			inheritedContainsFreshVideo ||= createsFreshVideo;
			for (const avLinkId of freshAvLinks) pendingFreshAvLinks.add(avLinkId);
			for (const avLinkId of pendingFreshAvLinks) {
				if (framescaperRetimeSegmentContainsAvLinkPair(inherited, avLinkId)) {
					pendingFreshAvLinks.delete(avLinkId);
				}
			}
			if (inheritedContainsFreshVideo && pendingFreshAvLinks.size === 0) flushInherited();
			continue;
		}
		flushInherited();
		current = isFramescaperVideoKeyframesCommandRetime(child)
			? applyVideoKeyframes(profile, current, child, intermediateOptions)
				: isFramescaperVideoRetimeCommandRetime(child)
					? applyVideoRetime(profile, current, child, intermediateOptions)
					: isFramescaperVideoProxyDetachCommandRetime(child) ? applyVideoProxyDetach(profile, current, child, intermediateOptions) : applyInherited(profile, current, child, intermediateOptions);
		restoreOuterBookkeeping(current, project);
	}
	flushInherited();
	const draft = current as unknown as DataRecord;
	finalizeDraft(profile, project, draft, options, 'retime batch command');
	return current;
}

function restoreOuterBookkeeping(
	project: FramescaperProjectRetime,
	outer: FramescaperProjectRetime,
): void {
	const draft = project as unknown as DataRecord;
	draft.revision = outer.revision;
	draft.updatedAt = outer.updatedAt;
}

function applyVideoKeyframes(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
	command: VideoKeyframesSetCommand,
	options: FramescaperProjectCommandOptionsRetime,
): FramescaperProjectRetime {
	assertClipTrackUnlocked(project, command.clipId);
	const draft = snapshotExactProject(profile, project) as unknown as DataRecord;
	VIDEO_KEYFRAME_HANDLERS['video-keyframes/set'](draft, command);
	finalizeDraft(profile, project, draft, options, 'retime video-keyframes command');
	return draft as FramescaperProjectRetime;
}

function applyVideoRetime(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
	command: FramescaperVideoRetimeCommandRetime,
	options: FramescaperProjectCommandOptionsRetime,
): FramescaperProjectRetime {
	if (command.scope === 'timeline') assertClipTrackUnlocked(project, command.clipId);
	const draft = snapshotExactProject(profile, project) as unknown as DataRecord;
	const clip = findFramescaperVideoClipRetime(draft, command.scope, command.clipId);
	const binding = framescaperVideoRetimeBindingRetime(clip);
	const current = normalizeFramescaperVideoRetimeCurveRetime(
		dataProperty(clip, 'retimeMap', 'Framescaper retime video clip'), binding,
	);
	const expected = normalizeFramescaperVideoRetimeCurveRetime(command.expectedRetimeMap, binding);
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new RangeError(`Video clip ${command.clipId} has a stale expected retime map.`);
	}
	clip.retimeMap = resolveFramescaperVideoRetimeMapRetime(command, binding);
	finalizeDraft(profile, project, draft, options, 'retime video-retime command');
	return draft as FramescaperProjectRetime;
}

function applyVideoProxyDetach(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
	command: FramescaperVideoProxyDetachCommandRetime,
	options: FramescaperProjectCommandOptionsRetime,
): FramescaperProjectRetime {
	const draft = snapshotExactProject(profile, project) as unknown as DataRecord;
	detachFramescaperVideoProxyDraftRetime(draft, command);
	finalizeDraft(profile, project, draft, options, 'retime video-proxy detach command');
	return draft as unknown as FramescaperProjectRetime;
}

function applyInherited(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
	command: FramescaperProjectCommandRetime,
	options: FramescaperProjectCommandOptionsRetime,
): FramescaperProjectRetime {
	const keyframes = snapshotClipKeyframes(project);
	const retimeMaps = snapshotFramescaperVideoRetimeMapsRetime(project);
	const foundation = framescaperProjectCompositionFoundationRetime(profile, project);
	clearFramescaperVideoRetimeMapsRetime(foundation as unknown as DataRecord);
	const compositionCommand = isFramescaperVideoCompositionCommandComposition(command);
	const commanded = compositionCommand
		? applyFramescaperProjectCommandComposition(
			FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE,
			foundation,
			command,
			options,
		) as unknown as DataRecord
		: applyInheritedSequence(foundation, keyframes, command, options);
	commanded.schemaVersion =  1;
	normalizeFramescaperProjectClipCompositionsComposition(commanded);
	restoreFramescaperVideoRetimeMapsAfterCommandRetime(project as unknown as DataRecord, commanded, command as unknown as DataRecord, retimeMaps);
	if (compositionCommand) restoreClipKeyframes(commanded, keyframes);
	completeClipKeyframes(commanded, keyframes, command);
	commanded.featureRequirements = reconcileFramescaperProjectFeatureRequirementsRetime(profile, commanded);
	validateFramescaperProjectRetime(profile, commanded);
	return commanded as FramescaperProjectRetime;
}

function applyInheritedSequence(
	projectComposition: DataRecord,
	keyframes: readonly KeyframeSnapshot[],
	command: FramescaperProjectCommandRetime,
	options: FramescaperProjectCommandOptionsRetime,
): DataRecord {
	const foundation = framescaperProjectSequenceFoundationComposition(
		FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE,
		projectComposition,
		{ retainComposition: true },
	);
	restoreClipKeyframes(foundation, keyframes);
	return applyFramescaperProjectCommandSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		foundation,
		command as FramescaperProjectCommandSequence,
		options,
	) as unknown as DataRecord;
}

function finalizeDraft(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
	draft: DataRecord,
	options: FramescaperProjectCommandOptionsRetime,
	owner: string,
): void {
	draft.revision = nextRevision(project);
	draft.updatedAt = timestamp(options.now, owner);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsRetime(profile, draft);
	validateFramescaperProjectRetime(profile, draft);
}

function snapshotClipKeyframes(project: FramescaperProjectRetime): readonly KeyframeSnapshot[] {
	const result: KeyframeSnapshot[] = [];
	visitClipCollections(project as unknown as DataRecord, (clip, name, scope) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		result.push(Object.freeze({
			scope,
			id: stableId(dataProperty(clip, 'id', name), `${name}.id`),
			keyframes: normalizeVideoKeyframeCurves(
				dataProperty(clip, 'videoKeyframes', name),
				keyframeContext(clip, name),
				`${name}.videoKeyframes`,
			),
		}));
	});
	return Object.freeze(result);
}

function restoreClipKeyframes(project: DataRecord, snapshots: readonly KeyframeSnapshot[]): void {
	const remaining = new Map(snapshots.map((snapshot) => [occurrenceKey(snapshot.scope, snapshot.id), snapshot]));
	visitClipCollections(project, (clip, name, scope) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const id = stableId(dataProperty(clip, 'id', name), `${name}.id`);
		const key = occurrenceKey(scope, id);
		const inherited = remaining.get(key);
		if (!inherited) throw new ReferenceError(`${name} has no exact retime videoKeyframes snapshot.`);
		clip.videoKeyframes = normalizeVideoKeyframeCurves(
			inherited.keyframes, keyframeContext(clip, name), `${name}.videoKeyframes`,
		);
		remaining.delete(key);
	});
	if (remaining.size > 0) throw new ReferenceError('The composition foundation dropped a retime video occurrence.');
}

function completeClipKeyframes(
	project: DataRecord,
	snapshots: readonly KeyframeSnapshot[],
	command: FramescaperProjectCommandRetime,
): void {
	const exact = new Map(snapshots.map((snapshot) => [occurrenceKey(snapshot.scope, snapshot.id), snapshot]));
	const byId = new Map<string, KeyframeSnapshot | null>();
	for (const snapshot of snapshots) byId.set(snapshot.id, byId.has(snapshot.id) ? null : snapshot);
	const defaultableIds = framescaperRetimeExplicitFreshVideoIds(command);
	visitClipCollections(project, (clip, name, scope) => {
		if (dataProperty(clip, 'kind', name) !== 'video') {
			delete clip.videoKeyframes;
			return;
		}
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
		if (descriptor?.enumerable && Object.hasOwn(descriptor, 'value')) {
			clip.videoKeyframes = normalizeVideoKeyframeCurves(
				descriptor.value, keyframeContext(clip, name), `${name}.videoKeyframes`,
			);
			return;
		}
		if (descriptor) throw new TypeError(`${name}.videoKeyframes must be an own enumerable data property.`);
		const id = stableId(dataProperty(clip, 'id', name), `${name}.id`);
		if (exact.has(occurrenceKey(scope, id)) || byId.has(id)) {
			throw new ReferenceError(`${name} lost its inherited retime videoKeyframes carrier.`);
		}
		if (!defaultableIds.has(id)) {
			throw new ReferenceError(`${name} is a new retime video occurrence without a keyframe carrier.`);
		}
		clip.videoKeyframes = createDefaultVideoKeyframeCurves(clipDuration(clip, name));
	});
}

function keyframeContext(clip: DataRecord, name: string): Readonly<Record<string, unknown>> {
	return Object.freeze({
		duration: { num: clipDuration(clip, name), den: 1 },
		composition: dataProperty(clip, 'videoComposition', name),
		videoEffects: dataProperty(clip, 'videoEffects', name),
	});
}

function assertClipTrackUnlocked(project: FramescaperProjectRetime, clipId: string): void {
	for (const trackValue of project.tracks) {
		const track = dataRecord(trackValue, 'Framescaper retime track');
		if (!Object.hasOwn(track, 'clipIds')) continue;
		const clipIds = dataProperty(track, 'clipIds', 'Framescaper retime track');
		if (!Array.isArray(clipIds) || !clipIds.includes(clipId)) continue;
		if (dataProperty(track, 'locked', 'Framescaper retime track') === true) {
			throw new RangeError(`Locked track ${String(dataProperty(track, 'id', 'Framescaper retime track'))} cannot edit video clip ${clipId}.`);
		}
	}
}

function visitClipCollections(
	project: DataRecord,
	visit: (clip: DataRecord, name: string, scope: ClipScope) => void,
): void {
	visitClipArray(dataProperty(project, 'clips', 'Framescaper retime project'), 'Framescaper retime project.clips', 'timeline', visit);
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper retime project'), 'Framescaper retime project.projectBin');
	visitClipArray(dataProperty(projectBin, 'clips', 'Framescaper retime project.projectBin'), 'Framescaper retime project.projectBin.clips', 'project-bin', visit);
}

function visitClipArray(
	value: unknown,
	name: string,
	scope: ClipScope,
	visit: (clip: DataRecord, name: string, scope: ClipScope) => void,
): void {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
		}
		visit(dataRecord(descriptor.value, `${name}[${String(index)}]`), `${name}[${String(index)}]`, scope);
	}
}

function commandType(value: unknown): string {
	const record = dataRecord(value, 'Framescaper retime command');
	const type = dataProperty(record, 'type', 'Framescaper retime command');
	if (typeof type !== 'string' || type.length === 0) {
		throw new TypeError('Framescaper retime command.type must be a non-empty string.');
	}
	return type;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function dataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function clipDuration(clip: DataRecord, name: string): number {
	const value = dataProperty(clip, 'sequenceFrameCount', name);
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name}.sequenceFrameCount must be a positive safe integer.`);
	}
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function occurrenceKey(scope: ClipScope, id: string): string {
	return JSON.stringify([scope, id]);
}

function nextRevision(project: FramescaperProjectRetime): number {
	const revision = project.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper retime project revision overflowed.');
	return revision;
}

function snapshotExactProject(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
): FramescaperProjectRetime {
	validateFramescaperProjectRetime(profile, project);
	const snapshot = structuredClone(project) as FramescaperProjectRetime;
	validateFramescaperProjectRetime(profile, snapshot);
	return snapshot;
}

function timestamp(value: Date | string | undefined, owner: string): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError(`A valid ${owner} timestamp is required.`);
	return date.toISOString();
}
