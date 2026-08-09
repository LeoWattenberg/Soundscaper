/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TimelineAnnotationCollectionContext,
	TimelineAnnotationColor,
	TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import type { Rational } from '../timeline-time.ts';

export const TIMELINE_ANNOTATION_COMMAND_TYPES = Object.freeze([
	'timeline-annotation/add',
	'timeline-annotation/update-many',
	'timeline-annotation/move-many',
	'timeline-annotation/resize',
	'timeline-annotation/convert',
	'timeline-annotation/remove-many',
	'timeline-annotation/batch-set',
] as const);

export type TimelineAnnotationCommandType = typeof TIMELINE_ANNOTATION_COMMAND_TYPES[number];

export interface TimelineAnnotationUpdateChanges {
	readonly name?: string;
	readonly color?: TimelineAnnotationColor;
}

export interface TimelineAnnotationMoveDelta {
	readonly sampleFrames: number;
	readonly beats: Rational;
}

export type TimelineAnnotationResizeCoordinate =
	| Readonly<{ anchor: 'sample'; frame: number }>
	| Readonly<{ anchor: 'musical'; beat: Rational }>;

export type TimelineAnnotationConversionCoordinates =
	| Readonly<{ kind: 'marker'; anchor: 'sample'; positionFrame: number }>
	| Readonly<{ kind: 'marker'; anchor: 'musical'; positionBeat: Rational }>
	| Readonly<{ kind: 'region'; anchor: 'sample'; startFrame: number; endFrame: number }>
	| Readonly<{ kind: 'region'; anchor: 'musical'; startBeat: Rational; endBeat: Rational }>;

export type TimelineAnnotationCommand =
	| Readonly<{
		type: 'timeline-annotation/add';
		annotation: TimelineAnnotationV11;
	}>
	| Readonly<{
		type: 'timeline-annotation/update-many';
		annotationIds: readonly string[];
		changes: TimelineAnnotationUpdateChanges;
	}>
	| Readonly<{
		type: 'timeline-annotation/move-many';
		annotationIds: readonly string[];
		delta: TimelineAnnotationMoveDelta;
	}>
	| Readonly<{
		type: 'timeline-annotation/resize';
		annotationId: string;
		edge: 'start' | 'end';
		coordinate: TimelineAnnotationResizeCoordinate;
	}>
	| Readonly<{
		type: 'timeline-annotation/convert';
		annotationId: string;
		coordinates: TimelineAnnotationConversionCoordinates;
	}>
	| Readonly<{
		type: 'timeline-annotation/remove-many';
		annotationIds: readonly string[];
	}>
	| Readonly<{
		type: 'timeline-annotation/batch-set';
		annotationIds: readonly string[];
		batchId: string | null;
	}>;

export type TimelineAnnotationCommandOf<Type extends TimelineAnnotationCommandType> = Extract<
	TimelineAnnotationCommand,
	{ readonly type: Type }
>;

export type TimelineAnnotationCommandHandler<
	Project,
	Type extends TimelineAnnotationCommandType,
> = (
	project: Project,
	command: TimelineAnnotationCommandOf<Type>,
	context?: TimelineAnnotationCollectionContext,
) => void;

export type TimelineAnnotationCommandHandlers<Project = unknown> = {
	readonly [Type in TimelineAnnotationCommandType]: TimelineAnnotationCommandHandler<Project, Type>;
};

/** Define a closed handler registry before these commands are wired into the global protocol. */
export function defineTimelineAnnotationCommandHandlers<Project>(
	handlers: TimelineAnnotationCommandHandlers<Project>,
): Readonly<TimelineAnnotationCommandHandlers<Project>> {
	if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
		throw new TypeError('Timeline annotation command handlers must be an object.');
	}
	const expected = new Set<string>(TIMELINE_ANNOTATION_COMMAND_TYPES);
	const actual = Object.keys(handlers);
	const candidates = handlers as Partial<Record<TimelineAnnotationCommandType, unknown>>;
	const missing = TIMELINE_ANNOTATION_COMMAND_TYPES.filter((type) => typeof candidates[type] !== 'function');
	const unexpected = actual.filter((type) => !expected.has(type));
	if (missing.length || unexpected.length) {
		const details = [
			missing.length ? `missing ${missing.join(', ')}` : '',
			unexpected.length ? `unexpected ${unexpected.join(', ')}` : '',
		].filter(Boolean).join('; ');
		throw new TypeError(`Timeline annotation command registry is not exhaustive: ${details}.`);
	}
	return Object.freeze({ ...handlers });
}
