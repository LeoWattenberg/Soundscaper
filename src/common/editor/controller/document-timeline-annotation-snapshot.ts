/* SPDX-License-Identifier: AGPL-3.0-only */

import { isActiveAudioEditorProjectSchema } from '../project-schema-version.ts';
import {
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProject,
	type RuntimeTimelineAnnotationProjection,
} from '../runtime-timeline-annotation-projection.ts';

/** Project annotations only from active audio-authoring documents that own the collection. */
export function createDocumentTimelineAnnotationSnapshot(
	project: unknown,
): readonly RuntimeTimelineAnnotationProjection[] {
	if (!isActiveAnnotationProject(project)) return Object.freeze([]);
	return resolveRuntimeTimelineAnnotationsProjection(project as RuntimeTimelineAnnotationProject);
}

function isActiveAnnotationProject(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& isActiveAudioEditorProjectSchema(value)
		&& Array.isArray((value as Readonly<{ timelineAnnotations?: unknown }>).timelineAnnotations);
}
