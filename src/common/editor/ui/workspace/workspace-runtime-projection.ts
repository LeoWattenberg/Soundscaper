/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The runtime projection the workspace hands its surfaces, resolved so that a
 * document the projection refuses does not throw out of the workspace itself.
 *
 * The workspace computes the projection above every surface boundary, so a
 * throw there would reach the root boundary and blank the whole editor. Held
 * here instead, the failure is a value: the surfaces that need the projection
 * re-derive it under their own boundary and show the message in place, while
 * the toolbar, the panels and the dialogs keep the document they can still
 * read.
 */

export interface WorkspaceRuntimeProjection<Project> {
	readonly runtimeProject: Project | null;
	readonly durationFrames: number;
	/** What the projection refused, when it did; null while the document projects. */
	readonly failure: Error | null;
}

export function resolveWorkspaceRuntimeProjection<Project>(
	project: Project | null | undefined,
	runtime: Readonly<{
		projectForRuntimeConsumers?: ((project: Project) => Project) | null;
		projectDurationFrames: (project: Project) => number;
	}>,
): WorkspaceRuntimeProjection<Project> {
	if (!project) return Object.freeze({ runtimeProject: null, durationFrames: 0, failure: null });
	try {
		const runtimeProject = runtime.projectForRuntimeConsumers
			? runtime.projectForRuntimeConsumers(project)
			: null;
		return Object.freeze({
			runtimeProject,
			durationFrames: runtime.projectDurationFrames(runtimeProject ?? project),
			failure: null,
		});
	} catch (error) {
		return Object.freeze({
			runtimeProject: null,
			durationFrames: 0,
			failure: error instanceof Error ? error : new Error(String(error)),
		});
	}
}
