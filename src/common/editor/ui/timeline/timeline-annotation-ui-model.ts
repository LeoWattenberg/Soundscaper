/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../../project-schema-version.ts';
import {
	compareRuntimeTimelineAnnotations,
	type RuntimeTimelineAnnotationProjection,
} from '../../runtime-timeline-annotation-projection.ts';
import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS,
	type TimelineAnnotationV11,
} from '../../timeline-annotation.ts';

const COLOR_SET: ReadonlySet<string> = new Set(AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS);

export interface TimelineAnnotationAvailabilitySnapshot {
	readonly capabilities?: { readonly timelineAnnotations?: boolean } | null;
	readonly project?: {
		readonly schemaVersion?: number;
		readonly timelineAnnotations?: unknown;
	} | null;
}

/**
 * Marker surfaces only exist when the product declares the capability and the
 * open project carries the annotation array at the current schema version. The
 * ruler lane, the lane actions, and the docked panel all have to agree, so the
 * predicate lives here instead of being restated at each mounting site.
 */
export function timelineAnnotationsAvailable(
	snapshot: TimelineAnnotationAvailabilitySnapshot | null | undefined,
): boolean {
	return snapshot?.capabilities?.timelineAnnotations === true
		&& snapshot?.project?.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		&& Array.isArray(snapshot?.project?.timelineAnnotations);
}

export interface TimelineAnnotationUiModelInput {
	readonly annotations: readonly RuntimeTimelineAnnotationProjection[];
	readonly primarySequenceId: string;
	readonly selectedAnnotationIds: readonly string[];
	readonly focusedAnnotationId: string | null;
	readonly sampleRate: number;
	readonly locale: string;
	readonly secondsUnit: string;
}

export interface TimelineAnnotationUiRow {
	readonly annotation: RuntimeTimelineAnnotationProjection;
	readonly id: string;
	readonly selected: boolean;
	readonly focused: boolean;
	readonly timingLabel: string;
}

export interface TimelineAnnotationUiModel {
	readonly rows: readonly TimelineAnnotationUiRow[];
	readonly selectedIds: readonly string[];
	readonly focusedId: string | null;
}

export interface TimelineAnnotationKeyInput {
	readonly key: string;
	readonly shiftKey?: boolean;
	readonly altKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
}

export interface TimelineAnnotationRenameKeyInput {
	readonly key: string;
	stopPropagation(): void;
	preventDefault(): void;
}

export type TimelineAnnotationRenameCompletionIntent = Readonly<{
	readonly save: boolean;
	readonly restoreFocus: true;
}>;

export interface TimelineAnnotationFrameBounds {
	readonly minimumStartFrame: number;
	readonly maximumEndFrame: number;
}

export interface TimelineAnnotationEditBounds extends TimelineAnnotationFrameBounds {
	readonly ids: readonly string[];
}

export interface TimelineAnnotationPointerGesturePlan {
	readonly annotationId: string;
	readonly dragIds: readonly string[];
	readonly selectOnPointerDown: boolean;
	readonly collapseOnClick: boolean;
}

export type TimelineAnnotationPointerCompletion =
	| Readonly<{ readonly type: 'move'; readonly ids: readonly string[]; readonly deltaFrames: number }>
	| Readonly<{ readonly type: 'select'; readonly ids: readonly string[] }>
	| null;

export type TimelineAnnotationPointerEdge = 'start' | 'end' | null;

export interface TimelineAnnotationFrameBlurResult {
	readonly frame: number | null;
	readonly restoredDraft: string;
}

export type TimelineAnnotationKeyboardIntent =
	| Readonly<{ readonly type: 'move'; readonly deltaFrames: number }>
	| Readonly<{ readonly type: 'resize'; readonly edge: 'start' | 'end'; readonly frame: number }>
	| Readonly<{ readonly type: 'rename' }>
	| Readonly<{ readonly type: 'remove' }>
	| Readonly<{ readonly type: 'toggle' }>
	| Readonly<{ readonly type: 'focus'; readonly offset: -1 | 1 }>;

export interface TimelineAnnotationConversionUiChanges {
	readonly kind: TimelineAnnotationV11['kind'];
	readonly anchor: TimelineAnnotationV11['anchor'];
}

export interface TimelineAnnotationCreationCopy {
	readonly locale: string;
	readonly secondsUnit: string;
	readonly unnamed: string;
	readonly marker: string;
	readonly region: string;
	readonly template: string;
	readonly sampleRate: number;
}

export function createTimelineAnnotationUiModel(
	input: TimelineAnnotationUiModelInput,
): Readonly<TimelineAnnotationUiModel> {
	if (!Array.isArray(input.annotations)) throw new TypeError('Timeline annotation UI input must be an array.');
	const primarySequenceId = stableId(input.primarySequenceId, 'Primary sequence ID');
	const sampleRate = positiveSafeInteger(input.sampleRate, 'Project sample rate');
	const secondsUnit = stableId(input.secondsUnit, 'Annotation seconds unit');
	const timeFormatter = new Intl.NumberFormat(stableId(input.locale, 'Annotation locale'), {
		minimumFractionDigits: 3,
		maximumFractionDigits: 3,
		useGrouping: false,
	});
	if (!Array.isArray(input.selectedAnnotationIds)) throw new TypeError('Selected annotation IDs must be an array.');
	const requestedFocus = input.focusedAnnotationId === null
		? null
		: stableId(input.focusedAnnotationId, 'Focused annotation ID');
	const seen = new Set<string>();
	for (const annotation of input.annotations) {
		validateProjection(annotation);
		if (seen.has(annotation.id)) throw new RangeError(`Duplicate timeline annotation UI ID: ${annotation.id}.`);
		seen.add(annotation.id);
	}
	const selectedSet = new Set(input.selectedAnnotationIds.map((id) => stableId(id, 'Selected annotation ID')));
	const annotations = input.annotations
		.filter(({ sequenceId }) => sequenceId === primarySequenceId)
		.sort(compareRuntimeTimelineAnnotations);
	const available = new Set(annotations.map(({ id }) => id));
	const selectedIds = Object.freeze(annotations.filter(({ id }) => selectedSet.has(id)).map(({ id }) => id));
	const focusedId = requestedFocus !== null && available.has(requestedFocus)
		? requestedFocus
		: selectedIds.at(-1) ?? annotations[0]?.id ?? null;
	const rows = Object.freeze(annotations.map((annotation) => Object.freeze({
		annotation,
		id: annotation.id,
		selected: selectedSet.has(annotation.id),
		focused: annotation.id === focusedId,
		timingLabel: timingLabel(annotation, sampleRate, timeFormatter, secondsUnit),
	})));
	return Object.freeze({ rows, selectedIds, focusedId });
}

export function timelineAnnotationCreationAnnouncement(
	annotation: RuntimeTimelineAnnotationProjection,
	copy: TimelineAnnotationCreationCopy,
): string {
	validateProjection(annotation);
	const sampleRate = positiveSafeInteger(copy.sampleRate, 'Project sample rate');
	const formatter = new Intl.NumberFormat(stableId(copy.locale, 'Annotation locale'), {
		minimumFractionDigits: 3,
		maximumFractionDigits: 3,
		useGrouping: false,
	});
	const timing = timingLabel(
		annotation, sampleRate, formatter, stableId(copy.secondsUnit, 'Annotation seconds unit'),
	);
	const values = {
		kind: annotation.kind === 'marker' ? copy.marker : copy.region,
		name: annotation.name || copy.unnamed,
		timing,
	};
	return Object.entries(values).reduce(
		(output, [key, value]) => output.replace(`{${key}}`, stableId(value, `Annotation ${key} copy`)),
		stableId(copy.template, 'Annotation creation template'),
	);
}

export function resolveTimelineAnnotationKeyboardIntent(
	annotation: RuntimeTimelineAnnotationProjection,
	input: TimelineAnnotationKeyInput,
	sampleRateInput: number,
	movementBounds?: TimelineAnnotationFrameBounds,
): TimelineAnnotationKeyboardIntent | null {
	validateProjection(annotation);
	const sampleRate = positiveSafeInteger(sampleRateInput, 'Project sample rate');
	const bounds = movementBounds ?? {
		minimumStartFrame: annotation.timelineStartFrame,
		maximumEndFrame: annotation.timelineEndFrame,
	};
	const minimumStartFrame = nonNegativeSafeInteger(bounds.minimumStartFrame, 'Earliest annotation frame');
	const maximumEndFrame = nonNegativeSafeInteger(bounds.maximumEndFrame, 'Latest annotation frame');
	if (minimumStartFrame > annotation.timelineStartFrame || maximumEndFrame < annotation.timelineEndFrame) {
		throw new RangeError('Annotation movement bounds must contain the active annotation.');
	}
	if (input.key === 'ArrowUp') return Object.freeze({ type: 'focus', offset: -1 });
	if (input.key === 'ArrowDown') return Object.freeze({ type: 'focus', offset: 1 });
	if (input.key === 'Enter' || input.key === 'F2') return Object.freeze({ type: 'rename' });
	if (input.key === 'Delete' || input.key === 'Backspace') return Object.freeze({ type: 'remove' });
	if (input.key === ' ' || input.key === 'Spacebar') return Object.freeze({ type: 'toggle' });
	if (input.key !== 'ArrowLeft' && input.key !== 'ArrowRight') return null;
	const direction = input.key === 'ArrowLeft' ? -1 : 1;
	const step = input.ctrlKey || input.metaKey ? sampleRate : 1;
	if (input.shiftKey) {
		if (annotation.kind !== 'region') return null;
		const edge = input.altKey ? 'start' : 'end';
		const endpoint = edge === 'start' ? annotation.timelineStartFrame : annotation.timelineEndFrame;
		const minimum = edge === 'start' ? 0 : annotation.timelineStartFrame + 1;
		const maximum = edge === 'start' ? annotation.timelineEndFrame - 1 : Number.MAX_SAFE_INTEGER;
		return Object.freeze({
			type: 'resize', edge,
			frame: direction < 0
				? Math.max(minimum, endpoint - step)
				: Math.min(maximum, endpoint + step),
		});
	}
	const deltaFrames = direction < 0
		? Math.max(-minimumStartFrame, -step)
		: Math.min(Number.MAX_SAFE_INTEGER - maximumEndFrame, step);
	return Object.freeze({
		type: 'move',
		deltaFrames: deltaFrames || 0,
	});
}

export function consumeTimelineAnnotationRenameKey(
	event: TimelineAnnotationRenameKeyInput,
): TimelineAnnotationRenameCompletionIntent | null {
	event.stopPropagation();
	if (event.key !== 'Enter' && event.key !== 'Escape') return null;
	event.preventDefault();
	return Object.freeze({ save: event.key === 'Enter', restoreFocus: true });
}

export function timelineAnnotationPointerDelta(
	startClientX: number,
	clientX: number,
	pixelsPerSecond: number,
	sampleRateInput: number,
	minimumStartFrame = Number.MAX_SAFE_INTEGER,
	maximumEndFrame = 0,
): number {
	const sampleRate = positiveSafeInteger(sampleRateInput, 'Project sample rate');
	if (!Number.isFinite(startClientX) || !Number.isFinite(clientX)) {
		throw new TypeError('Annotation pointer coordinates must be finite.');
	}
	if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
		throw new RangeError('Annotation pixels per second must be positive.');
	}
	const minimum = nonNegativeSafeInteger(minimumStartFrame, 'Earliest annotation frame');
	const maximum = nonNegativeSafeInteger(maximumEndFrame, 'Latest annotation frame');
	const minimumDelta = -minimum;
	const maximumDelta = Number.MAX_SAFE_INTEGER - maximum;
	const scaled = (clientX - startClientX) * sampleRate / pixelsPerSecond;
	const delta = Number.isFinite(scaled)
		? Math.round(scaled)
		: scaled > 0 ? maximumDelta : minimumDelta;
	return Math.max(minimumDelta, Math.min(maximumDelta, delta));
}

export function timelineAnnotationEditIds(
	annotationId: string,
	selectedAnnotationIds: readonly string[],
): readonly string[] {
	const id = stableId(annotationId, 'Annotation ID');
	const selected = selectedAnnotationIds.map((candidate) => stableId(candidate, 'Selected annotation ID'));
	return Object.freeze(selected.includes(id) ? [...new Set(selected)] : [id]);
}

export function timelineAnnotationEditBounds(
	annotationId: string,
	selectedAnnotationIds: readonly string[],
	annotations: readonly RuntimeTimelineAnnotationProjection[],
): Readonly<TimelineAnnotationEditBounds> {
	if (!Array.isArray(annotations)) throw new TypeError('Timeline annotation edit input must be an array.');
	const requestedIds = timelineAnnotationEditIds(annotationId, selectedAnnotationIds);
	const requestedSet = new Set(requestedIds);
	const selected = annotations.filter(({ id }) => requestedSet.has(id));
	if (selected.length !== requestedSet.size) throw new RangeError('Every edited annotation must exist in the visible sequence.');
	for (const annotation of selected) validateProjection(annotation);
	selected.sort(compareRuntimeTimelineAnnotations);
	return Object.freeze({
		ids: Object.freeze(selected.map(({ id }) => id)),
		minimumStartFrame: Math.min(...selected.map(({ timelineStartFrame }) => timelineStartFrame)),
		maximumEndFrame: Math.max(...selected.map(({ timelineEndFrame }) => timelineEndFrame)),
	});
}

export function timelineAnnotationPointerSelectionIds(
	annotationId: string,
	selectedAnnotationIds: readonly string[],
	options: Readonly<{ readonly additive?: boolean; readonly toggle?: boolean }>,
): readonly string[] {
	const id = stableId(annotationId, 'Annotation ID');
	if (!Array.isArray(selectedAnnotationIds)) throw new TypeError('Selected annotation IDs must be an array.');
	const selected = [...new Set(selectedAnnotationIds.map((candidate) => stableId(candidate, 'Selected annotation ID')))];
	if (options.toggle) {
		return Object.freeze(selected.includes(id)
			? selected.filter((candidate) => candidate !== id)
			: [...selected, id]);
	}
	if (options.additive) return Object.freeze(selected.includes(id) ? selected : [...selected, id]);
	return Object.freeze([id]);
}

export function planTimelineAnnotationPointerGesture(
	annotationId: string,
	selectedAnnotationIds: readonly string[],
	options: Readonly<{ readonly additive?: boolean; readonly toggle?: boolean }>,
): Readonly<TimelineAnnotationPointerGesturePlan> {
	const id = stableId(annotationId, 'Annotation ID');
	if (!Array.isArray(selectedAnnotationIds)) throw new TypeError('Selected annotation IDs must be an array.');
	const selected = Object.freeze([
		...new Set(selectedAnnotationIds.map((candidate) => stableId(candidate, 'Selected annotation ID'))),
	]);
	const preserveSelectedDrag = !options.additive && !options.toggle && selected.includes(id);
	if (preserveSelectedDrag) {
		return Object.freeze({
			annotationId: id,
			dragIds: selected,
			selectOnPointerDown: false,
			collapseOnClick: selected.length > 1,
		});
	}
	const dragIds = timelineAnnotationPointerSelectionIds(id, selected, options);
	return Object.freeze({
		annotationId: id,
		dragIds,
		selectOnPointerDown: true,
		collapseOnClick: false,
	});
}

export function resolveTimelineAnnotationPointerCompletion(
	plan: TimelineAnnotationPointerGesturePlan,
	deltaFrames: number,
	cancelled = false,
): TimelineAnnotationPointerCompletion {
	stableId(plan.annotationId, 'Annotation ID');
	if (!Array.isArray(plan.dragIds)) throw new TypeError('Dragged annotation IDs must be an array.');
	const ids = Object.freeze([...new Set(plan.dragIds.map((id) => stableId(id, 'Dragged annotation ID')))]);
	if (!Number.isSafeInteger(deltaFrames)) throw new RangeError('Annotation pointer delta must be a safe integer.');
	if (cancelled) return null;
	if (deltaFrames) return Object.freeze({ type: 'move', ids, deltaFrames });
	return plan.collapseOnClick
		? Object.freeze({ type: 'select', ids: Object.freeze([plan.annotationId]) })
		: null;
}

export function timelineAnnotationPointerEdge(value: unknown): TimelineAnnotationPointerEdge {
	return value === 'start' || value === 'end' ? value : null;
}

export function timelineAnnotationRegionWidth(
	durationFrames: number,
	pixelsPerSecond: number,
	sampleRateInput: number,
): number {
	const duration = positiveSafeInteger(durationFrames, 'Annotation region duration');
	const sampleRate = positiveSafeInteger(sampleRateInput, 'Project sample rate');
	if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
		throw new RangeError('Annotation pixels per second must be positive.');
	}
	const scaled = duration / sampleRate * pixelsPerSecond;
	return Math.max(16, Math.min(Number.MAX_SAFE_INTEGER, scaled));
}

export function timelineAnnotationIsVisible(
	annotation: RuntimeTimelineAnnotationProjection,
	pixelsPerSecond: number,
	sampleRateInput: number,
	scrollX: number,
	viewportWidth: number,
): boolean {
	validateProjection(annotation);
	const sampleRate = positiveSafeInteger(sampleRateInput, 'Project sample rate');
	if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
		throw new RangeError('Annotation pixels per second must be positive.');
	}
	if (!Number.isFinite(scrollX)) throw new TypeError('Annotation scroll position must be finite.');
	if (!Number.isFinite(viewportWidth) || viewportWidth < 0) {
		throw new RangeError('Annotation viewport width must be non-negative.');
	}
	const left = annotation.timelineStartFrame / sampleRate * pixelsPerSecond - scrollX;
	const width = annotation.kind === 'region'
		? timelineAnnotationRegionWidth(annotation.durationFrames, pixelsPerSecond, sampleRate)
		: 12;
	const hitLeft = annotation.kind === 'marker' ? left - 5 : left;
	return hitLeft <= viewportWidth && left + width >= 0;
}

export function timelineAnnotationHitIds(
	annotations: readonly RuntimeTimelineAnnotationProjection[],
	clientOffsetX: number,
	pixelsPerSecond: number,
	sampleRateInput: number,
	scrollX: number,
	edge: TimelineAnnotationPointerEdge = null,
): readonly string[] {
	if (!Array.isArray(annotations)) throw new TypeError('Timeline annotation hit input must be an array.');
	if (!Number.isFinite(clientOffsetX)) throw new TypeError('Annotation pointer offset must be finite.');
	const sampleRate = positiveSafeInteger(sampleRateInput, 'Project sample rate');
	if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
		throw new RangeError('Annotation pixels per second must be positive.');
	}
	if (!Number.isFinite(scrollX)) throw new TypeError('Annotation scroll position must be finite.');
	return Object.freeze(annotations.filter((annotation) => {
		validateProjection(annotation);
		const left = annotation.timelineStartFrame / sampleRate * pixelsPerSecond - scrollX;
		const width = annotation.kind === 'region'
			? timelineAnnotationRegionWidth(annotation.durationFrames, pixelsPerSecond, sampleRate)
			: 12;
		if (edge) {
			if (annotation.kind !== 'region') return false;
			const handleLeft = edge === 'start' ? left - 1 : left + width - 6;
			return clientOffsetX >= handleLeft && clientOffsetX <= handleLeft + 7;
		}
		const hitLeft = annotation.kind === 'marker' ? left - 5 : left;
		return clientOffsetX >= hitLeft && clientOffsetX <= left + width;
	}).sort(compareRuntimeTimelineAnnotations).map(({ id }) => id));
}

export function cycleTimelineAnnotationHitId(
	hitIds: readonly string[],
	eventTargetId: string,
	previousHitId: string | null,
): string {
	if (!Array.isArray(hitIds) || !hitIds.length) throw new RangeError('At least one annotation hit is required.');
	const ids = [...new Set(hitIds.map((id) => stableId(id, 'Hit annotation ID')))];
	const targetId = stableId(eventTargetId, 'Pointer target annotation ID');
	if (!ids.includes(targetId)) throw new RangeError('The pointer target must belong to the annotation hit set.');
	if (previousHitId === null || !ids.includes(previousHitId)) return targetId;
	return ids[(ids.indexOf(previousHitId) + 1) % ids.length] ?? targetId;
}

export function resolveTimelineAnnotationFrameBlur(
	draft: string,
	canonicalFrame: number,
	minimumFrame: number,
	maximumFrame = Number.MAX_SAFE_INTEGER,
): Readonly<TimelineAnnotationFrameBlurResult> {
	const canonical = nonNegativeSafeInteger(canonicalFrame, 'Canonical annotation frame');
	const minimum = nonNegativeSafeInteger(minimumFrame, 'Minimum annotation frame');
	const maximum = nonNegativeSafeInteger(maximumFrame, 'Maximum annotation frame');
	if (minimum > maximum || canonical < minimum || canonical > maximum) {
		throw new RangeError('Canonical annotation frame must belong to the editor bounds.');
	}
	const restoredDraft = String(canonical);
	if (typeof draft !== 'string' || !draft.trim()) return Object.freeze({ frame: null, restoredDraft });
	const requested = Number(draft);
	if (!Number.isSafeInteger(requested) || requested < minimum || requested > maximum || requested === canonical) {
		return Object.freeze({ frame: null, restoredDraft });
	}
	return Object.freeze({ frame: requested, restoredDraft });
}

export function timelineAnnotationConversionRequest(
	annotation: RuntimeTimelineAnnotationProjection,
	changes: TimelineAnnotationConversionUiChanges,
	sampleRateInput: number,
) {
	validateProjection(annotation);
	const sampleRate = positiveSafeInteger(sampleRateInput, 'Project sample rate');
	if (changes.kind !== 'marker' && changes.kind !== 'region') throw new RangeError('Annotation kind must be marker or region.');
	if (changes.anchor !== 'sample' && changes.anchor !== 'musical') throw new RangeError('Annotation anchor must be sample or musical.');
	return Object.freeze({
		kind: changes.kind,
		anchor: changes.anchor,
		...(annotation.kind === 'marker' && changes.kind === 'region'
			? { regionEndFrame: safeAdd(annotation.timelineStartFrame, sampleRate) }
			: {}),
	});
}

function validateProjection(annotation: RuntimeTimelineAnnotationProjection): void {
	if (!annotation || typeof annotation !== 'object') throw new TypeError('A projected timeline annotation is required.');
	stableId(annotation.id, 'Annotation ID');
	stableId(annotation.sequenceId, 'Annotation sequence ID');
	if (annotation.kind !== 'marker' && annotation.kind !== 'region') throw new RangeError('Annotation kind must be marker or region.');
	if (annotation.anchor !== 'sample' && annotation.anchor !== 'musical') throw new RangeError('Annotation anchor must be sample or musical.');
	if (!COLOR_SET.has(annotation.color)) throw new RangeError(`Unsupported annotation color: ${annotation.color}.`);
	if (annotation.coordinateDomain !== 'resolved-samples') {
		throw new TypeError('Timeline annotation UI requires resolved-samples coordinates.');
	}
	const start = nonNegativeSafeInteger(annotation.timelineStartFrame, 'Annotation start frame');
	const end = nonNegativeSafeInteger(annotation.timelineEndFrame, 'Annotation end frame');
	const duration = nonNegativeSafeInteger(annotation.durationFrames, 'Annotation duration');
	if (end - start !== duration) throw new RangeError('Annotation runtime duration must match its endpoints.');
	if (annotation.kind === 'marker' && duration !== 0) throw new RangeError('A marker must have zero duration.');
	if (annotation.kind === 'region' && duration <= 0) throw new RangeError('A region must have positive duration.');
}

function timingLabel(
	annotation: RuntimeTimelineAnnotationProjection,
	sampleRate: number,
	formatter: Intl.NumberFormat,
	secondsUnit: string,
): string {
	const start = formatter.format(annotation.timelineStartFrame / sampleRate);
	return annotation.kind === 'marker'
		? `${start} ${secondsUnit}`
		: `${start}–${formatter.format(annotation.timelineEndFrame / sampleRate)} ${secondsUnit}`;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new RangeError('Annotation conversion endpoint exceeds the safe timeline range.');
	return value;
}
