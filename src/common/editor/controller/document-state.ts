/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ControllerRuntimeHistory, ControllerRuntimeProject } from './project-runtime.ts';

export interface ControllerDocumentState<Project, History> {
	project: Project | null;
	history: History | null;
}

/**
 * The active history is the sole document authority. Compatibility ports may
 * replace its present, but cannot leave a second, stale project pointer behind.
 */
export function createControllerDocumentState<
	Project = ControllerRuntimeProject,
	History extends { readonly present: Project } = ControllerRuntimeHistory & { readonly present: Project },
>(): ControllerDocumentState<Project, History> {
	let history: History | null = null;
	return Object.seal({
		get history() { return history; },
		set history(value: History | null) { history = value; },
		get project() { return history?.present ?? null; },
		set project(value: Project | null) {
			if (value === null) { history = null; return; }
			if (!history) throw new Error('An active project requires an installed history.');
			if (history.present !== value) history = { ...history, present: value };
		},
	});
}
