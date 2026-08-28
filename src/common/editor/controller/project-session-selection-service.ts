/* SPDX-License-Identifier: AGPL-3.0-only */

import { isActiveAudioEditorProjectSchema } from '../project-schema-version.ts';

export interface ProjectSessionSelectionState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
}

export interface ProjectSessionSelectionTrack {
	readonly id: string;
	readonly type: string;
}

export interface ProjectSessionSelectionProject {
	readonly schemaVersion?: unknown;
	readonly selection?: unknown;
	readonly timelineAnnotations?: unknown;
	readonly tracks: readonly ProjectSessionSelectionTrack[];
}

export interface ProjectSessionSelectionMetadata {
	readonly selectedTrackId?: string | null;
	readonly selectedClipId?: string | null;
	readonly selectedAnnotationId?: string | null;
}

export interface CapturedProjectSessionSelection {
	readonly selectedTrackId: string | null;
	readonly selectedClipId: string | null;
	readonly selectedAnnotationId: string | null;
}

export interface ProjectSessionSelectionServiceDependencies<
	Project extends ProjectSessionSelectionProject,
> {
	readonly state: ProjectSessionSelectionState;
	readonly findTrack: (
		project: Project,
		trackId: string | null | undefined,
	) => Readonly<{ id: string }> | null;
	readonly findClip: (
		project: Project,
		clipId: string | null | undefined,
	) => Readonly<{ id: string }> | null;
}

export function createProjectSessionSelectionService<
	Project extends ProjectSessionSelectionProject,
>(dependencies: ProjectSessionSelectionServiceDependencies<Project>) {
	return Object.freeze({ capture, restore });

	function capture(): Readonly<CapturedProjectSessionSelection> {
		return Object.freeze({
			selectedTrackId: dependencies.state.selectedTrackId,
			selectedClipId: dependencies.state.selectedClipId,
			selectedAnnotationId: dependencies.state.selectedAnnotationId,
		});
	}

	function restore(
		project: Project,
		metadata: Readonly<ProjectSessionSelectionMetadata> = {},
	): void {
		dependencies.state.selectedTrackId = dependencies.findTrack(project, metadata.selectedTrackId)?.id
			?? project.tracks.find((track) => track.type !== 'label')?.id
			?? project.tracks[0]?.id
			?? null;
		dependencies.state.selectedClipId = Object.hasOwn(metadata, 'selectedClipId')
			? dependencies.findClip(project, metadata.selectedClipId)?.id ?? null
			: firstDurableSelectedClipId(project);
		dependencies.state.selectedAnnotationId = existingActiveAnnotationId(project, metadata.selectedAnnotationId);
	}

	function firstDurableSelectedClipId(project: Project): string | null {
		const selection = project.selection;
		if (selection === null || typeof selection !== 'object' || Array.isArray(selection)) return null;
		const clipIds = (selection as Readonly<{ clipIds?: unknown }>).clipIds;
		if (!Array.isArray(clipIds)) return null;
		for (const clipId of clipIds) {
			if (typeof clipId !== 'string' || !clipId) continue;
			const clip = dependencies.findClip(project, clipId);
			if (clip) return clip.id;
		}
		return null;
	}
}

function existingActiveAnnotationId(
	project: ProjectSessionSelectionProject,
	requestedAnnotationId: unknown,
): string | null {
	if (!isActiveAudioEditorProjectSchema(project)
		|| typeof requestedAnnotationId !== 'string'
		|| !requestedAnnotationId) return null;
	try {
		const annotations = project.timelineAnnotations;
		if (!Array.isArray(annotations)) return null;
		let found = false;
		for (const annotation of annotations) {
			if (annotation === null || typeof annotation !== 'object' || Array.isArray(annotation)) return null;
			const id = Object.getOwnPropertyDescriptor(annotation, 'id');
			if (!id || !('value' in id) || typeof id.value !== 'string' || !id.value) return null;
			if (id.value === requestedAnnotationId) found = true;
		}
		return found ? requestedAnnotationId : null;
	} catch {
		return null;
	}
}
