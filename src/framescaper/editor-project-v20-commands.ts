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
import { normalizeVideoRetimeCurveV16 } from '../common/editor/video-retime-v16.ts';
import { createVideoKeyframesRuntimeHandlers } from '../common/editor/commands/video-keyframes-runtime.ts';
import {
	snapshotVideoKeyframesSetCommand,
	type VideoKeyframesSetCommand,
} from '../common/editor/commands/video-keyframes.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from './editor-project-feature-requirements-v20.ts';
import {
	admitFramescaperProjectCommandV20Structure,
} from './editor-project-v20-command-admission.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';
import {
	applyFramescaperProjectCommandV19,
	isFramescaperVideoCompositionCommandV19,
	snapshotFramescaperProjectCommandV19,
	type FramescaperProjectCommandOptionsV19,
	type FramescaperProjectCommandV19,
} from './editor-project-v19-commands.ts';
import { normalizeFramescaperProjectClipCompositionsV19 } from './editor-project-v19.ts';
import {
	applyFramescaperProjectCommandV18,
} from './editor-project-v18-commands.ts';
import {
	isFramescaperVideoRetimeCommandV20,
	resolveFramescaperVideoRetimeMapV20,
	snapshotFramescaperVideoRetimeCommandV20,
	type FramescaperVideoRetimeCommandV20,
} from './editor-project-v20-retime-command.ts';
import {
	framescaperV20FreshVideoAddAvLinkIds,
	framescaperV20SegmentContainsAvLinkPair,
	framescaperV20SegmentContainsAvLinkPeer,
} from './editor-project-v20-av-link-command-segmentation.ts';
import { framescaperV20ExplicitFreshVideoIds } from './editor-project-v20-fresh-video-command.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectCommandV18 } from './editor-project-v18-subsequence.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	framescaperProjectV19FoundationV20,
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20-validation.ts';
import { framescaperProjectV18FoundationV19 } from './editor-project-v19-validation.ts';

export type FramescaperProjectCommandV20 =
	| FramescaperProjectCommandV19
	| VideoKeyframesSetCommand
	| FramescaperVideoRetimeCommandV20;
export type FramescaperProjectCommandOptionsV20 = FramescaperProjectCommandOptionsV19;

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

/** Snapshot the one V20-owned command before project-context validation. */
export function normalizeFramescaperProjectCommandV20(
	value: unknown,
): VideoKeyframesSetCommand | FramescaperVideoRetimeCommandV20 {
	return isFramescaperVideoRetimeCommandV20(value)
		? snapshotFramescaperVideoRetimeCommandV20(value)
		: snapshotVideoKeyframesSetCommand(value);
}

export function isFramescaperVideoKeyframesCommandV20(
	value: FramescaperProjectCommandV20 | unknown,
): value is VideoKeyframesSetCommand {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(
		descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& descriptor.value === 'video-keyframes/set',
	);
}

/** Snapshot one exact V20 command, including recursively closed mixed batches. */
export function snapshotFramescaperProjectCommandV20(
	command: FramescaperProjectCommandV20 | unknown,
): FramescaperProjectCommandV20 {
	admitFramescaperProjectCommandV20Structure(command);
	return snapshotCommand(command, {
		activeBatches: new Set(),
		commandCount: 0,
		orderedBoundaryCount: 0,
	}, 0);
}

/**
 * Execute against exact V20 authority without ever presenting keyframes to the
 * public V19 validator. Mixed batches publish one revision or no revision.
 */
export function applyFramescaperProjectCommandV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | unknown,
	command: FramescaperProjectCommandV20,
	options: FramescaperProjectCommandOptionsV20 = {},
): FramescaperProjectV20 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectV20(profile, project);
	const persisted = project as FramescaperProjectV20;
	const normalized = snapshotFramescaperProjectCommandV20(command);
	return applySingle(profile, persisted, normalized, options);
}

function snapshotCommand(
	command: unknown,
	budget: CommandSnapshotBudget,
	depth: number,
): FramescaperProjectCommandV20 {
	budget.commandCount += 1;
	if (budget.commandCount > MAXIMUM_BATCH_COMMANDS) {
		throw new RangeError('Framescaper V20 command tree exceeds its command limit.');
	}
	if (depth > MAXIMUM_BATCH_DEPTH) {
		throw new RangeError('Framescaper V20 command tree exceeds its nesting depth limit.');
	}
	const type = commandType(command);
	if (type === 'video-keyframes/set') {
		countOrderedBoundary(budget);
		return normalizeFramescaperProjectCommandV20(command);
	}
	if (type.startsWith('video-retime/')) {
		countOrderedBoundary(budget);
		return snapshotFramescaperVideoRetimeCommandV20(command);
	}
	if (type === 'batch') {
		const record = readClosedDomainRecord(command, 'Framescaper V20 command batch', BATCH_FIELDS);
		if (budget.activeBatches.has(record)) {
			throw new TypeError('Cyclic Framescaper V20 command batches are not supported.');
		}
		const commands = readClosedDomainArray(
			readClosedDomainField(record, 'commands', 'Framescaper V20 command batch'),
			'Framescaper V20 command batch.commands',
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
			}) as FramescaperProjectCommandV20;
		} finally {
			budget.activeBatches.delete(record);
		}
	}
	admitAudioEditorProjectValidationStructure(
		command,
		AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	);
	const inherited = snapshotFramescaperProjectCommandV19(command as FramescaperProjectCommandV19);
	if (framescaperV20ExplicitFreshVideoIds(inherited).size > 0) countOrderedBoundary(budget);
	return inherited;
}

function countOrderedBoundary(budget: CommandSnapshotBudget): void {
	budget.orderedBoundaryCount += 1;
	if (budget.orderedBoundaryCount > MAXIMUM_BATCH_ORDERED_BOUNDARIES) {
		throw new RangeError('Framescaper V20 command tree exceeds its ordered execution boundary limit.');
	}
}

function applySingle(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
	command: FramescaperProjectCommandV20,
	options: FramescaperProjectCommandOptionsV20,
): FramescaperProjectV20 {
	if (command.type === 'batch') {
		return applyBatch(profile, project, command, options);
	}
	if (isFramescaperVideoKeyframesCommandV20(command)) {
		return applyVideoKeyframes(profile, project, command, options);
	}
	if (isFramescaperVideoRetimeCommandV20(command)) {
		return applyVideoRetime(profile, project, command, options);
	}
	return applyInherited(profile, project, command, options);
}

function applyBatch(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
	command: Extract<FramescaperProjectCommandV20, { readonly type: 'batch' }>,
	options: FramescaperProjectCommandOptionsV20,
): FramescaperProjectV20 {
	nextRevision(project);
	const commands = flattenBatchCommands(command);
	const needsOrderedSegmentation = commands.some((child) => (
		isFramescaperVideoKeyframesCommandV20(child) || isFramescaperVideoRetimeCommandV20(child)
	))
		|| (commands.length > 1
			&& commands.some((child) => framescaperV20ExplicitFreshVideoIds(child).size > 0));
	if (!needsOrderedSegmentation) {
		return applyInherited(profile, project, command, options);
	}
	let current = project;
	let inherited: FramescaperProjectCommandV20[] = [];
	let inheritedContainsFreshVideo = false;
	const pendingFreshAvLinks = new Set<string>();
	const intermediateOptions: FramescaperProjectCommandOptionsV20 = Object.freeze({
		now: String(project.updatedAt),
	});
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		const group = inherited.length === 1 ? inherited[0]! : Object.freeze({
			type: 'batch' as const,
			commands: Object.freeze(inherited),
		}) as FramescaperProjectCommandV20;
		current = applyInherited(profile, current, group, intermediateOptions);
		restoreOuterBookkeeping(current, project);
		inherited = [];
		inheritedContainsFreshVideo = false;
		pendingFreshAvLinks.clear();
	};
	for (const child of commands) {
		if (!isFramescaperVideoKeyframesCommandV20(child) && !isFramescaperVideoRetimeCommandV20(child)) {
			const createsFreshVideo = framescaperV20ExplicitFreshVideoIds(child).size > 0;
			const freshAvLinks = framescaperV20FreshVideoAddAvLinkIds(child);
			const joinsPriorPeer = freshAvLinks.some((avLinkId) => (
				framescaperV20SegmentContainsAvLinkPeer(inherited, avLinkId)
			));
			if (createsFreshVideo && pendingFreshAvLinks.size === 0 && !joinsPriorPeer) {
				flushInherited();
			}
			inherited.push(child);
			inheritedContainsFreshVideo ||= createsFreshVideo;
			for (const avLinkId of freshAvLinks) pendingFreshAvLinks.add(avLinkId);
			for (const avLinkId of pendingFreshAvLinks) {
				if (framescaperV20SegmentContainsAvLinkPair(inherited, avLinkId)) {
					pendingFreshAvLinks.delete(avLinkId);
				}
			}
			if (inheritedContainsFreshVideo && pendingFreshAvLinks.size === 0) flushInherited();
			continue;
		}
		flushInherited();
		current = isFramescaperVideoKeyframesCommandV20(child)
			? applyVideoKeyframes(profile, current, child, intermediateOptions)
			: applyVideoRetime(profile, current, child, intermediateOptions);
		restoreOuterBookkeeping(current, project);
	}
	flushInherited();
	const draft = current as unknown as DataRecord;
	finalizeDraft(profile, project, draft, options, 'V20 batch command');
	return current;
}

function flattenBatchCommands(
	command: Extract<FramescaperProjectCommandV20, { readonly type: 'batch' }>,
): readonly FramescaperProjectCommandV20[] {
	const result: FramescaperProjectCommandV20[] = [];
	const pending: FramescaperProjectCommandV20[] = [...command.commands].reverse() as FramescaperProjectCommandV20[];
	while (pending.length > 0) {
		const candidate = pending.pop()!;
		if (candidate.type !== 'batch') {
			result.push(candidate);
			continue;
		}
		for (let index = candidate.commands.length - 1; index >= 0; index -= 1) {
			pending.push(candidate.commands[index] as FramescaperProjectCommandV20);
		}
	}
	return Object.freeze(result);
}

function restoreOuterBookkeeping(
	project: FramescaperProjectV20,
	outer: FramescaperProjectV20,
): void {
	const draft = project as unknown as DataRecord;
	draft.revision = outer.revision;
	draft.updatedAt = outer.updatedAt;
}

function applyVideoKeyframes(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
	command: VideoKeyframesSetCommand,
	options: FramescaperProjectCommandOptionsV20,
): FramescaperProjectV20 {
	assertClipTrackUnlocked(project, command.clipId);
	const draft = snapshotExactProject(profile, project) as unknown as DataRecord;
	VIDEO_KEYFRAME_HANDLERS['video-keyframes/set'](draft, command);
	finalizeDraft(profile, project, draft, options, 'V20 video-keyframes command');
	return draft as FramescaperProjectV20;
}

function applyVideoRetime(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
	command: FramescaperVideoRetimeCommandV20,
	options: FramescaperProjectCommandOptionsV20,
): FramescaperProjectV20 {
	if (command.scope === 'timeline') assertClipTrackUnlocked(project, command.clipId);
	const draft = snapshotExactProject(profile, project) as unknown as DataRecord;
	const clip = findVideoClip(draft, command.scope, command.clipId);
	const binding = {
		sequenceFrameCount: dataProperty(clip, 'sequenceFrameCount', 'Framescaper V20 video clip'),
		sourceInFrame: dataProperty(clip, 'sourceInFrame', 'Framescaper V20 video clip'),
		sourceFrameCount: dataProperty(clip, 'sourceFrameCount', 'Framescaper V20 video clip'),
	};
	const current = normalizeVideoRetimeMap(clip, binding);
	const expected = normalizeVideoRetimeCurveV20(command.expectedRetimeMap, binding);
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new RangeError(`Video clip ${command.clipId} has a stale expected retime map.`);
	}
	clip.retimeMap = resolveFramescaperVideoRetimeMapV20(command, binding);
	finalizeDraft(profile, project, draft, options, 'V20 video-retime command');
	return draft as FramescaperProjectV20;
}

function applyInherited(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
	command: FramescaperProjectCommandV20,
	options: FramescaperProjectCommandOptionsV20,
): FramescaperProjectV20 {
	const keyframes = snapshotClipKeyframes(project);
	const foundation = framescaperProjectV19FoundationV20(profile, project);
	const compositionCommand = isFramescaperVideoCompositionCommandV19(command);
	const commanded = compositionCommand
		? applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			foundation,
			command,
			options,
		) as unknown as DataRecord
		: applyInheritedV18(foundation, keyframes, command, options);
	commanded.schemaVersion = 20;
	normalizeFramescaperProjectClipCompositionsV19(commanded);
	if (compositionCommand) restoreClipKeyframes(commanded, keyframes);
	completeClipKeyframes(commanded, keyframes, command);
	commanded.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV20(profile, commanded);
	validateFramescaperProjectV20(profile, commanded);
	return commanded as FramescaperProjectV20;
}

function applyInheritedV18(
	projectV19: DataRecord,
	keyframes: readonly KeyframeSnapshot[],
	command: FramescaperProjectCommandV20,
	options: FramescaperProjectCommandOptionsV20,
): DataRecord {
	const foundation = framescaperProjectV18FoundationV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		projectV19,
		{ retainComposition: true },
	);
	restoreClipKeyframes(foundation, keyframes);
	return applyFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		foundation,
		command as FramescaperProjectCommandV18,
		options,
	) as unknown as DataRecord;
}

function finalizeDraft(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
	draft: DataRecord,
	options: FramescaperProjectCommandOptionsV20,
	owner: string,
): void {
	draft.revision = nextRevision(project);
	draft.updatedAt = timestamp(options.now, owner);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV20(profile, draft);
	validateFramescaperProjectV20(profile, draft);
}

function snapshotClipKeyframes(project: FramescaperProjectV20): readonly KeyframeSnapshot[] {
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
		if (!inherited) throw new ReferenceError(`${name} has no exact V20 videoKeyframes snapshot.`);
		clip.videoKeyframes = normalizeVideoKeyframeCurves(
			inherited.keyframes, keyframeContext(clip, name), `${name}.videoKeyframes`,
		);
		remaining.delete(key);
	});
	if (remaining.size > 0) throw new ReferenceError('The V19 foundation dropped a V20 video occurrence.');
}

function completeClipKeyframes(
	project: DataRecord,
	snapshots: readonly KeyframeSnapshot[],
	command: FramescaperProjectCommandV20,
): void {
	const exact = new Map(snapshots.map((snapshot) => [occurrenceKey(snapshot.scope, snapshot.id), snapshot]));
	const byId = new Map<string, KeyframeSnapshot | null>();
	for (const snapshot of snapshots) byId.set(snapshot.id, byId.has(snapshot.id) ? null : snapshot);
	const defaultableIds = framescaperV20ExplicitFreshVideoIds(command);
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
			throw new ReferenceError(`${name} lost its inherited V20 videoKeyframes carrier.`);
		}
		if (!defaultableIds.has(id)) {
			throw new ReferenceError(`${name} is a new V20 video occurrence without a keyframe carrier.`);
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


function assertClipTrackUnlocked(project: FramescaperProjectV20, clipId: string): void {
	for (const trackValue of project.tracks) {
		const track = dataRecord(trackValue, 'Framescaper V20 track');
		const clipIds = dataProperty(track, 'clipIds', 'Framescaper V20 track');
		if (!Array.isArray(clipIds) || !clipIds.includes(clipId)) continue;
		if (dataProperty(track, 'locked', 'Framescaper V20 track') === true) {
			throw new RangeError(`Locked track ${String(dataProperty(track, 'id', 'Framescaper V20 track'))} cannot edit video clip ${clipId}.`);
		}
	}
}

function findVideoClip(
	project: DataRecord,
	scope: ClipScope,
	clipId: string,
): DataRecord {
	let result: DataRecord | null = null;
	visitClipCollections(project, (clip, name, candidateScope) => {
		if (candidateScope !== scope || dataProperty(clip, 'id', name) !== clipId) return;
		if (result) throw new RangeError(`Duplicate ${scope} clip ID ${clipId}.`);
		if (dataProperty(clip, 'kind', name) !== 'video') {
			throw new TypeError(`Clip ${clipId} is not a video occurrence.`);
		}
		result = clip;
	});
	if (!result) throw new ReferenceError(`Unknown ${scope} video clip ${clipId}.`);
	return result;
}

function normalizeVideoRetimeMap(
	clip: DataRecord,
	binding: Readonly<Record<string, unknown>>,
) {
	return normalizeVideoRetimeCurveV20(
		dataProperty(clip, 'retimeMap', 'Framescaper V20 video clip'), binding,
	);
}

function normalizeVideoRetimeCurveV20(
	value: unknown,
	binding: Readonly<Record<string, unknown>>,
) {
	return normalizeVideoRetimeCurveV16(value, binding);
}

function visitClipCollections(
	project: DataRecord,
	visit: (clip: DataRecord, name: string, scope: ClipScope) => void,
): void {
	visitClipArray(dataProperty(project, 'clips', 'Framescaper V20 project'), 'Framescaper V20 project.clips', 'timeline', visit);
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper V20 project'), 'Framescaper V20 project.projectBin');
	visitClipArray(dataProperty(projectBin, 'clips', 'Framescaper V20 project.projectBin'), 'Framescaper V20 project.projectBin.clips', 'project-bin', visit);
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
	const record = dataRecord(value, 'Framescaper V20 command');
	const type = dataProperty(record, 'type', 'Framescaper V20 command');
	if (typeof type !== 'string' || type.length === 0) {
		throw new TypeError('Framescaper V20 command.type must be a non-empty string.');
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

function nextRevision(project: FramescaperProjectV20): number {
	const revision = project.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V20 project revision overflowed.');
	return revision;
}

function snapshotExactProject(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
): FramescaperProjectV20 {
	validateFramescaperProjectV20(profile, project);
	const snapshot = structuredClone(project) as FramescaperProjectV20;
	validateFramescaperProjectV20(profile, snapshot);
	return snapshot;
}

function timestamp(value: Date | string | undefined, owner: string): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError(`A valid ${owner} timestamp is required.`);
	return date.toISOString();
}
