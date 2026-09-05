/* SPDX-License-Identifier: AGPL-3.0-only */

import { EditorDisposedError, type EditorProjectToken, type EditorTaskOptions, type EditorTaskScope } from './lifecycle.ts';
import type { NativeProjectDocument, NativeProjectServiceRuntime } from './native-project-types.ts';

/** A started operation, paired with the project generation it began against. */
export interface ProjectTask {
	readonly task: EditorTaskScope;
	readonly projectToken: EditorProjectToken;
}

/** The error a native project operation raises when the project changed under it. */
export function projectChangedError(): DOMException {
	return new DOMException('The active editor project changed before the operation completed.', 'AbortError');
}

/**
 * Who owns the project while a native open or save is in flight.
 *
 * Every operation here is long enough that the user can switch or edit the project
 * underneath it, and the two failure modes differ: an import that lost its project must
 * stop, while a save that lost its project must leave the document marked dirty rather
 * than claim it was written. Holding both owners and the disposal flag in one place is
 * what keeps those two answers from drifting apart across the operations that ask.
 */
export function createNativeProjectOwnership(runtime: NativeProjectServiceRuntime) {
	let importOwner: EditorTaskScope | null = null;
	let saveOwner: EditorTaskScope | null = null;
	let disposed = false;

	function assertNotDisposed(): void {
		if (disposed) throw new EditorDisposedError();
	}

	/** Mark the service disposed, reporting whether this call is the one that did it. */
	function markDisposed(): boolean {
		if (disposed) return false;
		disposed = true;
		return true;
	}

	function requireProject(): NativeProjectDocument {
		const activeProject = runtime.getProject();
		if (!activeProject) throw new Error(runtime.copy.projectNotFound);
		return activeProject;
	}

	function requireOwnedProject(projectId: string): NativeProjectDocument {
		const activeProject = requireProject();
		if (activeProject.id !== projectId) throw projectChangedError();
		return activeProject;
	}

	function beginProjectTask(
		name: string,
		expectedProjectId?: string,
		options: EditorTaskOptions = {},
	): ProjectTask {
		assertNotDisposed();
		const project = requireProject();
		if (expectedProjectId && project.id !== expectedProjectId) throw projectChangedError();
		return {
			task: runtime.lifetime.startTask(name, options),
			projectToken: runtime.projectGeneration.capture(project.id),
		};
	}

	function assertOwnership(task: EditorTaskScope, token: EditorProjectToken): void {
		task.assertCurrent();
		runtime.projectGeneration.assertCurrent(token);
	}

	function ownershipIsCurrent(task: EditorTaskScope, token: EditorProjectToken): boolean {
		try {
			assertOwnership(task, token);
			return true;
		} catch {
			return false;
		}
	}

	function beginImport(task: EditorTaskScope): void {
		importOwner = task;
		runtime.state.importing = true;
		runtime.publishDocumentSnapshot();
	}

	function finishImport(task: EditorTaskScope): void {
		if (importOwner !== task) return;
		importOwner = null;
		runtime.state.importing = false;
		runtime.publishDocumentSnapshot();
	}

	function beginSave(task: EditorTaskScope, token: EditorProjectToken): void {
		assertOwnership(task, token);
		saveOwner = task;
		runtime.state.saveState = 'saving';
		runtime.publishDocumentSnapshot();
	}

	/**
	 * Record that a save completed, and say whether it may be reported as saved.
	 *
	 * A save whose project moved on wrote a document nobody is looking at any more, so the
	 * live document goes back to dirty instead of inheriting the finished save's state.
	 */
	function finishSave(task: EditorTaskScope, token: EditorProjectToken, state: 'saved'): boolean {
		if (saveOwner !== task) return false;
		saveOwner = null;
		if (!ownershipIsCurrent(task, token)) {
			try {
				runtime.projectGeneration.assertCurrent(token);
			} catch {
				return false;
			}
			runtime.state.saveState = 'dirty';
			runtime.publishDocumentSnapshot();
			return false;
		}
		runtime.state.saveState = state;
		return true;
	}

	function failSave(task: EditorTaskScope, token: EditorProjectToken): void {
		if (saveOwner !== task) return;
		saveOwner = null;
		try {
			runtime.projectGeneration.assertCurrent(token);
		} catch {
			return;
		}
		runtime.state.saveState = 'dirty';
		runtime.publishDocumentSnapshot();
	}

	return Object.freeze({
		assertNotDisposed, assertOwnership, beginImport, beginProjectTask, beginSave,
		failSave, finishImport, finishSave, markDisposed, ownershipIsCurrent,
		requireOwnedProject, requireProject,
	});
}
