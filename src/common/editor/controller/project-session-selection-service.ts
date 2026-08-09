/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProjectSessionSelectionState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
}

export interface ProjectSessionSelectionTrack {
	readonly id: string;
	readonly type: string;
}

export interface ProjectSessionSelectionProject {
	readonly tracks: readonly ProjectSessionSelectionTrack[];
}

export interface ProjectSessionSelectionMetadata {
	readonly selectedTrackId?: string | null;
	readonly selectedClipId?: string | null;
}

export interface CapturedProjectSessionSelection {
	readonly selectedTrackId: string | null;
	readonly selectedClipId: string | null;
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
		dependencies.state.selectedClipId = dependencies.findClip(project, metadata.selectedClipId)?.id ?? null;
	}
}
