/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddTimelineAnnotationCommand,
	createBatchSetTimelineAnnotationsCommand,
	createConvertTimelineAnnotationCommand,
	createMoveTimelineAnnotationsCommand,
	createRemoveTimelineAnnotationsCommand,
	createResizeTimelineAnnotationCommand,
	createUpdateTimelineAnnotationsCommand,
} from '../commands/factories.ts';
import type {
	AudioEditorCommand,
} from '../commands/protocol.ts';
import { AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION } from '../project-schema-version.ts';
import {
	resolveRuntimeTimelineAnnotationProjection,
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProject,
	type RuntimeTimelineAnnotationProjection,
} from '../runtime-timeline-annotation-projection.ts';
import {
	createTimelineAnnotationV11,
	type TimelineAnnotationColor,
	type TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import { sampleFrameToBeat } from '../timeline-tempo-inverse.ts';
import { subtractRationals } from '../timeline-time.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';
import {
	resolveTimelineAnnotationConversionCoordinates,
	type TimelineAnnotationConversionRequest,
} from './timeline-annotation-conversion.ts';

export type { TimelineAnnotationConversionRequest } from './timeline-annotation-conversion.ts';

export interface TimelineAnnotationControllerState {
	selectedAnnotationId: string | null;
}

export interface TimelineAnnotationSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly annotationIds?: readonly string[];
	readonly frequencyRange?: Readonly<{
		readonly minimumFrequency: number;
		readonly maximumFrequency: number;
	}> | null;
}

export interface TimelineAnnotationControllerProject extends RuntimeTimelineAnnotationProject {
	readonly schemaVersion: typeof AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION;
	readonly primarySequenceId: string;
	readonly selection: TimelineAnnotationSelection;
}

interface TimelineAnnotationCreateOptions {
	readonly id?: string;
	readonly sequenceId?: string;
	readonly name?: string;
	readonly color?: TimelineAnnotationColor;
	readonly batchId?: string | null;
	readonly opaqueExtensions?: Readonly<Record<string, unknown>>;
	readonly anchor?: TimelineAnnotationV11['anchor'];
}

export interface TimelineAnnotationMarkerCreateOptions extends TimelineAnnotationCreateOptions {
	readonly positionFrame?: number;
}

export interface TimelineAnnotationRegionCreateOptions extends TimelineAnnotationCreateOptions {
	readonly range?: Readonly<{ readonly startFrame: number; readonly endFrame: number }>;
}

export interface TimelineAnnotationServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly state: TimelineAnnotationControllerState;
	readonly getProject: () => unknown;
	readonly editingBlocked: () => boolean;
	readonly createId: (prefix: string) => string;
	readonly getPositionFrames: () => number;
	readonly commit: (command: AudioEditorCommand) => unknown;
	readonly updateSelection: (command: Extract<AudioEditorCommand, { readonly type: 'selection/set' }>) => unknown;
	readonly publishProjectState: () => void;
}

export interface TimelineAnnotationService {
	createMarker(options?: TimelineAnnotationMarkerCreateOptions): string | null;
	createRegion(options?: TimelineAnnotationRegionCreateOptions): string | null;
	focusAnnotation(annotationId: string | null): string | null;
	clearFocus(): null;
	selectAnnotation(annotationId: string, additive?: boolean): readonly string[] | null;
	selectAnnotations(annotationIds: readonly string[], focusedAnnotationId?: string | null): readonly string[] | null;
	toggleAnnotation(annotationId: string): readonly string[] | null;
	renameAnnotations(annotationIds: readonly string[], name: string): unknown;
	setAnnotationColor(annotationIds: readonly string[], color: TimelineAnnotationColor): unknown;
	moveAnnotations(
		annotationIds: readonly string[],
		sampleFrames: number,
		primaryAnnotationId?: string,
	): unknown;
	resizeAnnotation(annotationId: string, edge: 'start' | 'end', timelineFrame: number): unknown;
	convertAnnotation(annotationId: string, request: TimelineAnnotationConversionRequest): unknown;
	setAnnotationBatch(annotationIds: readonly string[], batchId: string | null): unknown;
	removeAnnotations(annotationIds: readonly string[]): unknown;
	navigatePreviousAnnotation(sequenceId?: string): RuntimeTimelineAnnotationProjection | null;
	navigateNextAnnotation(sequenceId?: string): RuntimeTimelineAnnotationProjection | null;
	synchronizeFocus(): string | null;
}

/**
 * Owns native annotation intent while leaving project mutation, history, and
 * publication on the controller's existing application ports.
 */
export function createTimelineAnnotationService(
	dependencies: TimelineAnnotationServiceDependencies,
): Readonly<TimelineAnnotationService> {
	return Object.freeze({
		createMarker,
		createRegion,
		focusAnnotation,
		clearFocus,
		selectAnnotation,
		selectAnnotations,
		toggleAnnotation,
		renameAnnotations,
		setAnnotationColor,
		moveAnnotations,
		resizeAnnotation,
		convertAnnotation,
		setAnnotationBatch,
		removeAnnotations,
		navigatePreviousAnnotation,
		navigateNextAnnotation,
		synchronizeFocus,
	});

	function createMarker(options: TimelineAnnotationMarkerCreateOptions = {}): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const positionFrame = timelineFrame(
			options.positionFrame ?? dependencies.getPositionFrames(),
			'Annotation marker position',
		);
		const id = options.id ?? dependencies.createId('annotation');
		const anchor = options.anchor ?? 'sample';
		const annotation = createTimelineAnnotationV11({
			...annotationCommon(project, id, options),
			kind: 'marker',
			anchor,
			...(anchor === 'sample'
				? { positionFrame }
				: { positionBeat: beatAtFrame(project, positionFrame) }),
		}, temporalContext(project));
		commitCreatedAnnotation(project, annotation, positionFrame, positionFrame);
		return id;
	}

	function createRegion(options: TimelineAnnotationRegionCreateOptions = {}): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const range = options.range ?? project.selection;
		const first = timelineFrame(range.startFrame, 'Annotation region start');
		const second = timelineFrame(range.endFrame, 'Annotation region end');
		const startFrame = Math.min(first, second);
		const endFrame = Math.max(first, second);
		if (endFrame <= startFrame) throw new RangeError('A timeline annotation region requires a positive selection.');
		const id = options.id ?? dependencies.createId('annotation');
		const anchor = options.anchor ?? 'sample';
		const annotation = createTimelineAnnotationV11({
			...annotationCommon(project, id, options),
			kind: 'region',
			anchor,
			...(anchor === 'sample'
				? { startFrame, endFrame }
				: { startBeat: beatAtFrame(project, startFrame), endBeat: beatAtFrame(project, endFrame) }),
		}, temporalContext(project));
		commitCreatedAnnotation(project, annotation, startFrame, endFrame);
		return id;
	}

	function focusAnnotation(annotationId: string | null): string | null {
		dependencies.lifetime.assertActive();
		if (annotationId !== null) {
			const project = requireCurrentProject(dependencies.getProject());
			requireAnnotation(project, annotationId);
		}
		setFocus(annotationId, true);
		return annotationId;
	}

	function clearFocus(): null {
		dependencies.lifetime.assertActive();
		setFocus(null, true);
		return null;
	}

	function selectAnnotation(annotationId: string, additive = false): readonly string[] | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const projected = projectedAnnotation(project, annotationId);
		const current = annotationSelectionIds(project);
		const next = additive
			? current.includes(annotationId) ? current : [...current, annotationId]
			: [annotationId];
		return updateDurableSelection(project, next, annotationId, projected);
	}

	function selectAnnotations(
		annotationIds: readonly string[],
		focusedAnnotationId: string | null = annotationIds.at(-1) ?? null,
	): readonly string[] | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const ids = annotationIds.length ? targetAnnotationIds(project, annotationIds) : [];
		if (focusedAnnotationId !== null && !ids.includes(focusedAnnotationId)) {
			throw new RangeError('The focused annotation must belong to the durable annotation selection.');
		}
		const projected = focusedAnnotationId === null ? null : projectedAnnotation(project, focusedAnnotationId);
		return updateDurableSelection(project, ids, focusedAnnotationId, projected);
	}

	function toggleAnnotation(annotationId: string): readonly string[] | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const projected = projectedAnnotation(project, annotationId);
		const current = annotationSelectionIds(project);
		const removing = current.includes(annotationId);
		const next = removing ? current.filter((id) => id !== annotationId) : [...current, annotationId];
		const nextFocus = removing
			? dependencies.state.selectedAnnotationId === annotationId
				? next.at(-1) ?? null
				: dependencies.state.selectedAnnotationId
			: annotationId;
		return updateDurableSelection(project, next, nextFocus, removing ? null : projected);
	}

	function renameAnnotations(annotationIds: readonly string[], name: string): unknown {
		return commitMutation(annotationIds, (ids) => createUpdateTimelineAnnotationsCommand(ids, { name }));
	}

	function setAnnotationColor(annotationIds: readonly string[], color: TimelineAnnotationColor): unknown {
		return commitMutation(annotationIds, (ids) => createUpdateTimelineAnnotationsCommand(ids, { color }));
	}

	function moveAnnotations(
		annotationIds: readonly string[],
		sampleFrames: number,
		primaryAnnotationId?: string,
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const ids = targetAnnotationIds(project, annotationIds);
		const primaryId = primaryAnnotationId ?? (
			dependencies.state.selectedAnnotationId && ids.includes(dependencies.state.selectedAnnotationId)
				? dependencies.state.selectedAnnotationId
				: ids[0]
		);
		if (!primaryId || !ids.includes(primaryId)) {
			throw new RangeError('The primary annotation must belong to the moved annotation selection.');
		}
		const deltaFrames = signedTimelineFrame(sampleFrames, 'Annotation move delta');
		const primary = projectedAnnotation(project, primaryId);
		const destination = safeTimelineAdd(primary.timelineStartFrame, deltaFrames, 'Annotation move destination');
		const beats = subtractRationals(
			beatAtFrame(project, destination),
			beatAtFrame(project, primary.timelineStartFrame),
		);
		return dependencies.commit(createMoveTimelineAnnotationsCommand(ids, {
			sampleFrames: deltaFrames,
			beats,
		}));
	}

	function resizeAnnotation(annotationId: string, edge: 'start' | 'end', requestedFrame: number): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const annotation = requireAnnotation(project, annotationId);
		const frame = timelineFrame(requestedFrame, 'Annotation resize position');
		return dependencies.commit(createResizeTimelineAnnotationCommand(
			annotationId,
			edge,
			annotation.anchor === 'sample'
				? { anchor: 'sample', frame }
				: { anchor: 'musical', beat: beatAtFrame(project, frame) },
		));
	}

	function convertAnnotation(annotationId: string, request: TimelineAnnotationConversionRequest): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const annotation = requireAnnotation(project, annotationId);
		const projected = resolveRuntimeTimelineAnnotationProjection(project, annotation);
		const coordinates = resolveTimelineAnnotationConversionCoordinates(
			project,
			annotation,
			projected,
			request,
		);
		return dependencies.commit(createConvertTimelineAnnotationCommand(annotationId, coordinates));
	}

	function setAnnotationBatch(annotationIds: readonly string[], batchId: string | null): unknown {
		return commitMutation(annotationIds, (ids) => createBatchSetTimelineAnnotationsCommand(ids, batchId));
	}

	function removeAnnotations(annotationIds: readonly string[]): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const ids = targetAnnotationIds(project, annotationIds);
		const removed = new Set(ids);
		const currentFocus = dependencies.state.selectedAnnotationId;
		const surviving = new Set(annotationCollection(project)
			.filter(({ id }) => !removed.has(id))
			.map(({ id }) => id));
		const nextFocus = currentFocus !== null && surviving.has(currentFocus)
			? currentFocus
			: annotationSelectionIds(project).filter((id) => surviving.has(id)).at(-1) ?? null;
		return withFocus(nextFocus, () => dependencies.commit(createRemoveTimelineAnnotationsCommand(ids)));
	}

	function navigatePreviousAnnotation(sequenceId?: string): RuntimeTimelineAnnotationProjection | null {
		return navigate(-1, sequenceId);
	}

	function navigateNextAnnotation(sequenceId?: string): RuntimeTimelineAnnotationProjection | null {
		return navigate(1, sequenceId);
	}

	function navigate(direction: -1 | 1, sequenceId?: string): RuntimeTimelineAnnotationProjection | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		const ownerId = sequenceId ?? project.primarySequenceId;
		requireSequenceId(project, ownerId);
		const annotations = resolveRuntimeTimelineAnnotationsProjection(project)
			.filter((annotation) => annotation.sequenceId === ownerId);
		if (!annotations.length) return null;
		const focusedIndex = annotations.findIndex(({ id }) => id === dependencies.state.selectedAnnotationId);
		let target: RuntimeTimelineAnnotationProjection | undefined;
		if (focusedIndex >= 0) target = annotations[focusedIndex + direction];
		else {
			const position = timelineFrame(dependencies.getPositionFrames(), 'Annotation navigation position');
			target = direction > 0
				? annotations.find(({ timelineStartFrame }) => timelineStartFrame >= position)
				: [...annotations].reverse().find(({ timelineStartFrame }) => timelineStartFrame <= position);
		}
		if (!target) return null;
		updateDurableSelection(project, [target.id], target.id, target);
		return target;
	}

	function synchronizeFocus(): string | null {
		dependencies.lifetime.assertActive();
		const candidate = dependencies.getProject();
		if (!hasExactV11Schema(candidate)) {
			setFocus(null, true);
			return null;
		}
		let next: string | null = null;
		try {
			const project = candidate as TimelineAnnotationControllerProject;
			const available = new Set(annotationCollection(project).map(({ id }) => id));
			const current = dependencies.state.selectedAnnotationId;
			if (current !== null && available.has(current)) next = current;
			else next = annotationSelectionIds(project).filter((id) => available.has(id)).at(-1) ?? null;
		} catch {
			next = null;
		}
		setFocus(next, true);
		return next;
	}

	function commitMutation(
		annotationIds: readonly string[],
		command: (ids: readonly string[]) => AudioEditorCommand,
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = requireCurrentProject(dependencies.getProject());
		return dependencies.commit(command(targetAnnotationIds(project, annotationIds)));
	}

	function commitCreatedAnnotation(
		project: TimelineAnnotationControllerProject,
		annotation: TimelineAnnotationV11,
		startFrame: number,
		endFrame: number,
	): void {
		const command: AudioEditorCommand = {
			type: 'batch',
			commands: [
				createAddTimelineAnnotationCommand(annotation),
				selectionCommand(project, [annotation.id], { startFrame, endFrame }),
			],
		};
		withFocus(annotation.id, () => dependencies.commit(command));
	}

	function updateDurableSelection(
		project: TimelineAnnotationControllerProject,
		annotationIds: readonly string[],
		focusId: string | null,
		projected: RuntimeTimelineAnnotationProjection | null,
	): readonly string[] {
		const ids = Object.freeze([...annotationIds]);
		withFocus(focusId, () => dependencies.updateSelection(selectionCommand(
			project,
			ids,
			projected ? {
				startFrame: projected.timelineStartFrame,
				endFrame: projected.timelineEndFrame,
			} : undefined,
		)));
		return ids;
	}

	function withFocus<Result>(annotationId: string | null, action: () => Result): Result {
		const previous = dependencies.state.selectedAnnotationId;
		dependencies.state.selectedAnnotationId = annotationId;
		try {
			return action();
		} catch (error) {
			dependencies.state.selectedAnnotationId = previous;
			throw error;
		}
	}

	function setFocus(annotationId: string | null, publish: boolean): void {
		if (dependencies.state.selectedAnnotationId === annotationId) return;
		dependencies.state.selectedAnnotationId = annotationId;
		if (publish) dependencies.publishProjectState();
	}
}

function annotationCommon(
	project: TimelineAnnotationControllerProject,
	id: string,
	options: TimelineAnnotationCreateOptions,
) {
	const sequenceId = options.sequenceId ?? project.primarySequenceId;
	requireSequenceId(project, sequenceId);
	return {
		id,
		sequenceId,
		name: options.name ?? '',
		color: options.color ?? 'auto',
		batchId: options.batchId ?? null,
		opaqueExtensions: options.opaqueExtensions ?? {},
	};
}

function selectionCommand(
	project: TimelineAnnotationControllerProject,
	annotationIds: readonly string[],
	range?: Readonly<{ readonly startFrame: number; readonly endFrame: number }>,
): Extract<AudioEditorCommand, { readonly type: 'selection/set' }> {
	return {
		type: 'selection/set',
		startFrame: range?.startFrame ?? project.selection.startFrame,
		endFrame: range?.endFrame ?? project.selection.endFrame,
		trackIds: selectionIds(project.selection.trackIds, 'selection.trackIds'),
		clipIds: selectionIds(project.selection.clipIds, 'selection.clipIds'),
		annotationIds: [...annotationIds],
		frequencyRange: project.selection.frequencyRange ?? null,
	};
}

function requireCurrentProject(value: unknown): TimelineAnnotationControllerProject {
	if (!hasExactV11Schema(value)) throw new RangeError('Timeline annotations require an exact schema V11 project.');
	return value as TimelineAnnotationControllerProject;
}

function hasExactV11Schema(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (value as Readonly<{ schemaVersion?: unknown }>).schemaVersion === AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION;
}

function annotationCollection(project: TimelineAnnotationControllerProject): readonly TimelineAnnotationV11[] {
	if (!Array.isArray(project.timelineAnnotations)) throw new TypeError('project.timelineAnnotations must be an array.');
	return project.timelineAnnotations;
}

function requireAnnotation(
	project: TimelineAnnotationControllerProject,
	annotationId: string,
): TimelineAnnotationV11 {
	const id = canonicalId(annotationId, 'Timeline annotation');
	const annotation = annotationCollection(project).find((candidate) => candidate.id === id);
	if (!annotation) throw new ReferenceError(`Unknown timeline annotation: ${id}.`);
	return annotation;
}

function projectedAnnotation(
	project: TimelineAnnotationControllerProject,
	annotationId: string,
): RuntimeTimelineAnnotationProjection {
	return resolveRuntimeTimelineAnnotationProjection(project, requireAnnotation(project, annotationId));
}

function targetAnnotationIds(
	project: TimelineAnnotationControllerProject,
	annotationIds: readonly string[],
): readonly string[] {
	if (!Array.isArray(annotationIds) || !annotationIds.length) {
		throw new TypeError('Timeline annotation IDs must be a non-empty array.');
	}
	const ids = annotationIds.map((id) => canonicalId(id, 'Timeline annotation'));
	if (new Set(ids).size !== ids.length) throw new RangeError('Timeline annotation IDs cannot contain duplicates.');
	const available = new Set(annotationCollection(project).map(({ id }) => id));
	for (const id of ids) {
		if (!available.has(id)) throw new ReferenceError(`Unknown timeline annotation: ${id}.`);
	}
	return ids;
}

function annotationSelectionIds(project: TimelineAnnotationControllerProject): readonly string[] {
	return selectionIds(project.selection?.annotationIds, 'selection.annotationIds');
}

function selectionIds(value: readonly string[] | undefined, name: string): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((id) => canonicalId(id, name));
}

function requireSequenceId(project: TimelineAnnotationControllerProject, sequenceId: string): string {
	const id = canonicalId(sequenceId, 'Timeline annotation sequence');
	if (!Array.isArray(project.sequences)) throw new TypeError('project.sequences must be an array.');
	if (!project.sequences.some((sequence) => sequence?.id === id)) {
		throw new ReferenceError(`Unknown timeline annotation sequence: ${id}.`);
	}
	return id;
}

function temporalContext(project: TimelineAnnotationControllerProject) {
	return { tempoMap: project.tempoMap, sampleRate: project.sampleRate };
}

function beatAtFrame(project: TimelineAnnotationControllerProject, frame: number) {
	return sampleFrameToBeat(frame, project.tempoMap, project.sampleRate);
}

function timelineFrame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function signedTimelineFrame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function safeTimelineAdd(value: number, delta: number, name: string): number {
	const result = value + delta;
	if (!Number.isSafeInteger(result) || result < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return result;
}

function canonicalId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} ID must be a canonical non-empty string.`);
	}
	return value;
}
