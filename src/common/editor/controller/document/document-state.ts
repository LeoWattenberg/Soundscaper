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

/** Restore only checkpoints minted by this owner, through its single history authority. */
export function createControllerDocumentCheckpoints<History extends { readonly present: { readonly id: string } }>(
	state: { history: History | null },
) {
	const histories = new WeakMap<object, History>();
	return Object.freeze({
		captureActiveDocument(): Readonly<{ history: History; project: History['present'] }> {
			const history = state.history;
			if (!history) throw new Error('A document checkpoint requires an open project.');
			const checkpoint = Object.freeze({ history, project: history.present });
			histories.set(checkpoint, history);
			return checkpoint;
		},
		restoreActiveDocument(checkpoint: object): void {
			const history = histories.get(checkpoint);
			if (!history) throw new TypeError('Unknown document checkpoint.');
			if (state.history?.present.id !== history.present.id) throw new Error('Checkpoint project changed.');
			state.history = history;
		},
	});
}
