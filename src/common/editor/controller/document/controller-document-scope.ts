/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ControllerDocumentState } from './document-state.ts';
import {
	EditorProjectChangedError,
	type EditorProjectGeneration,
	type EditorProjectToken,
} from '../shared/lifecycle.ts';

export interface ControllerDocumentScope<Project extends Readonly<{ readonly id: string }>> {
	get(): Project | null;
	set(project: Project | null): void;
	requireCurrent(): Project;
	captureCurrent(): EditorProjectToken;
	assertCurrent(token: EditorProjectToken): void;
}

/** Own writable access and stale-generation checks for the active controller document. */
export function createControllerDocumentScope<
	Project extends Readonly<{ readonly id: string }>,
	History extends Readonly<{ readonly present: Project }>,
>(
	state: ControllerDocumentState<Project, History>,
	projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>,
): ControllerDocumentScope<Project> {
	const get = (): Project | null => state.project;
	const set = (project: Project | null): void => { state.project = project; };
	const requireCurrent = (): Project => {
		const project = get();
		if (!project) throw new Error('The document services require an open project.');
		return project;
	};
	const captureCurrent = (): EditorProjectToken => {
		const project = requireCurrent();
		return projectGeneration.capture(project.id);
	};
	const assertCurrent = (token: EditorProjectToken): void => {
		projectGeneration.assertCurrent(token);
		if (get()?.id !== token.projectId) throw new EditorProjectChangedError();
	};
	return Object.freeze({ get, set, requireCurrent, captureCurrent, assertCurrent });
}
