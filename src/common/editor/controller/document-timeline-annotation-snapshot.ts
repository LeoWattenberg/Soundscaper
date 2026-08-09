/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../project-schema-version.ts';
import {
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProject,
	type RuntimeTimelineAnnotationProjection,
} from '../runtime-timeline-annotation-projection.ts';

/** Project annotations only from the exact current document generation that owns the collection. */
export function createDocumentTimelineAnnotationSnapshot(
	project: unknown,
): readonly RuntimeTimelineAnnotationProjection[] {
	if (!isCurrentAnnotationProject(project)) return Object.freeze([]);
	return resolveRuntimeTimelineAnnotationsProjection(project as RuntimeTimelineAnnotationProject);
}

function isCurrentAnnotationProject(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (value as Readonly<{ schemaVersion?: unknown }>).schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		&& Array.isArray((value as Readonly<{ timelineAnnotations?: unknown }>).timelineAnnotations);
}
