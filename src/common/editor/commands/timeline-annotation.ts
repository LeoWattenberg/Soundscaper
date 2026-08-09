/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type {
	AudioEditorCommand,
	AudioEditorCommandType,
} from './protocol.ts';

export type {
	TimelineAnnotationConversionCoordinates,
	TimelineAnnotationMoveDelta,
	TimelineAnnotationResizeCoordinate,
	TimelineAnnotationUpdateChanges,
} from './protocol.ts';

export const TIMELINE_ANNOTATION_COMMAND_TYPES = [
	'timeline-annotation/add',
	'timeline-annotation/update-many',
	'timeline-annotation/move-many',
	'timeline-annotation/resize',
	'timeline-annotation/convert',
	'timeline-annotation/remove-many',
	'timeline-annotation/batch-set',
] as const satisfies readonly AudioEditorCommandType[];

export type TimelineAnnotationCommandType = typeof TIMELINE_ANNOTATION_COMMAND_TYPES[number];
export type TimelineAnnotationCommand = Extract<
	AudioEditorCommand,
	{ readonly type: TimelineAnnotationCommandType }
>;
export type TimelineAnnotationCommandOf<Type extends TimelineAnnotationCommandType> = Extract<
	TimelineAnnotationCommand,
	{ readonly type: Type }
>;
export type TimelineAnnotationCommandHandlers = DomainCommandHandlerRegistry<
	typeof TIMELINE_ANNOTATION_COMMAND_TYPES
>;

export function defineTimelineAnnotationCommandHandlers(
	handlers: TimelineAnnotationCommandHandlers,
): Readonly<TimelineAnnotationCommandHandlers> {
	return defineDomainCommandHandlerRegistry(
		'timeline annotation',
		TIMELINE_ANNOTATION_COMMAND_TYPES,
		handlers,
	);
}
