/* SPDX-License-Identifier: AGPL-3.0-only */

interface HistoryEntry<Project> { readonly project: Project }
interface History<Project> {
	readonly present: Project;
	readonly undoStack?: readonly HistoryEntry<Project>[];
	readonly redoStack?: readonly HistoryEntry<Project>[];
}

/**
 * Controller histories replace documents, including when undo restores them.
 * Scan an immutable past document once per controller, not once per edit.
 * The present is deliberately uncached: clipboard roots can change independently.
 * Weak keys cannot retain projects after their history or tab is released.
 */
export function createHistorySourceCompactor<Project extends object>(
	compactProject: (project: Project, preserveSourceIds: Iterable<string>) => Project,
) {
	const past = new WeakMap<Project, Project>();
	function compactEntry<Entry extends HistoryEntry<Project>>(entry: Entry): Entry {
		let project = past.get(entry.project);
		if (!project) {
			project = compactProject(entry.project, []);
			past.set(entry.project, project);
			past.set(project, project);
		}
		return project === entry.project ? entry : { ...entry, project };
	}
	return function compactHistory<Value extends History<Project>>(
		history: Value,
		{ preservePresentSourceIds = [] }: { readonly preservePresentSourceIds?: Iterable<string> } = {},
	): Value {
		const present = compactProject(history.present, preservePresentSourceIds);
		const undoStack = history.undoStack?.map(compactEntry);
		const redoStack = history.redoStack?.map(compactEntry);
		if (present === history.present
			&& undoStack?.every((entry, index) => entry === history.undoStack?.[index]) !== false
			&& redoStack?.every((entry, index) => entry === history.redoStack?.[index]) !== false) return history;
		return { ...history, present, undoStack, redoStack };
	};
}
