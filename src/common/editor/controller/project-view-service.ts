/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';

export type ProjectTimelineView = 'waveform' | 'spectrogram' | 'multiview';

export interface ProjectViewTrack {
	readonly id: string;
	readonly type: string;
	readonly displayMode?: string;
}

export interface ProjectViewProject<Track extends ProjectViewTrack = ProjectViewTrack> {
	readonly id: string;
	readonly tracks: readonly Track[];
}

export interface ProjectViewState {
	pixelsPerSecond: number;
	timelineViewportWidth: number;
	timelineWidth: number;
	timelineView: ProjectTimelineView;
}

export interface ProjectViewServiceDependencies<
	Project extends ProjectViewProject<Track>,
	Track extends ProjectViewTrack = ProjectViewTrack,
> {
	readonly lifetime: Readonly<{ assertActive(): void }>;
	readonly state: ProjectViewState;
	readonly getProject: () => Project | null;
	readonly projectDurationFrames: (project: Project) => number;
	readonly editorTimelineDurationFrames: (project: Project, sampleRate: number) => number;
	readonly projectSampleRate: () => number;
	readonly maximumPixelsPerSecond: number;
	readonly synchronizeAutomaticSampleEditMode: () => void;
	readonly getEnginePositionFrames: () => number;
	readonly updatePlayhead: (frame: number, duration: number) => void;
	readonly publishDocumentSnapshot: () => void;
	readonly editingBlocked: () => boolean;
	readonly commit: (command: AudioEditorCommand) => unknown;
}

export interface ProjectViewService<Project extends ProjectViewProject> {
	publishProjectState(): void;
	setTimelineView(view: unknown): ProjectTimelineView;
	setAllTracksView(view: unknown): Project | ProjectTimelineView | null | unknown;
}

export function createProjectViewService<
	Project extends ProjectViewProject<Track>,
	Track extends ProjectViewTrack = ProjectViewTrack,
>(
	dependencies: ProjectViewServiceDependencies<Project, Track>,
): Readonly<ProjectViewService<Project>> {
	return Object.freeze({ publishProjectState, setTimelineView, setAllTracksView });

	function publishProjectState(): void {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		if (!project) {
			dependencies.publishDocumentSnapshot();
			return;
		}
		const duration = dependencies.projectDurationFrames(project);
		const sampleRate = dependencies.projectSampleRate();
		const timelineDuration = dependencies.editorTimelineDurationFrames(project, sampleRate);
		const durationSeconds = timelineDuration / sampleRate;
		const minimumPixelsPerSecond = dependencies.state.timelineViewportWidth > 0
			? dependencies.state.timelineViewportWidth / durationSeconds
			: 1;
		dependencies.state.pixelsPerSecond = Math.max(
			minimumPixelsPerSecond,
			dependencies.state.pixelsPerSecond,
		);
		dependencies.state.pixelsPerSecond = Math.min(
			dependencies.state.pixelsPerSecond,
			dependencies.maximumPixelsPerSecond,
		);
		dependencies.state.timelineWidth = Math.max(
			1,
			Math.round(durationSeconds * dependencies.state.pixelsPerSecond),
		);
		dependencies.synchronizeAutomaticSampleEditMode();
		dependencies.updatePlayhead(dependencies.getEnginePositionFrames(), duration);
		dependencies.publishDocumentSnapshot();
	}

	function setTimelineView(view: unknown): ProjectTimelineView {
		dependencies.lifetime.assertActive();
		dependencies.state.timelineView = view === 'spectrogram' || view === 'multiview'
			? view
			: 'waveform';
		dependencies.publishDocumentSnapshot();
		return dependencies.state.timelineView;
	}

	function setAllTracksView(view: unknown): Project | ProjectTimelineView | null | unknown {
		dependencies.lifetime.assertActive();
		const displayMode = view === 'spectrogram' ? 'spectrogram' : 'waveform';
		const project = dependencies.getProject();
		if (!project) return setTimelineView(displayMode);
		if (dependencies.editingBlocked()) return null;
		dependencies.state.timelineView = displayMode;
		const commands: AudioEditorCommand[] = project.tracks
			.filter((track) => track.type === 'audio' && track.displayMode !== displayMode)
			.map((track) => ({
				type: 'track/update',
				trackId: track.id,
				changes: { displayMode },
			}));
		if (!commands.length) {
			dependencies.publishDocumentSnapshot();
			return project;
		}
		return dependencies.commit({ type: 'batch', commands });
	}
}
