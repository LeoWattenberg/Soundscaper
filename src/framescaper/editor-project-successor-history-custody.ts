/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperSuccessorHistory, normalizeFramescaperSuccessorHistory, type FramescaperSuccessorHistory } from './editor-project-successor-history.ts';
/** Weak snapshot custody follows the controller's actual queued objects without retaining a second history catalog. */
export function createFramescaperSuccessorHistoryCustody() {
	const histories = new WeakMap<object, FramescaperSuccessorHistory>();
	function remember(history: FramescaperSuccessorHistory): FramescaperSuccessorHistory { histories.set(history.present, history); return history; }
	function historyForSnapshot(value: unknown): FramescaperSuccessorHistory {
		if (!value || typeof value !== 'object') throw new TypeError('Successor history requires its captured snapshot.');
		const history = histories.get(value); if (!history) throw new Error('Successor snapshot has no captured history custody.'); return history;
	}
	function cloneProject(value: unknown): FramescaperSuccessorProject {
		const project = normalizeFramescaperSuccessorProject(value);
		const history = value && typeof value === 'object' ? histories.get(value) : undefined;
		if (history) histories.set(project, Object.freeze({ ...history, present: project }));
		return project;
	}
	return Object.freeze({ remember, cloneProject, historyForSnapshot,
		createHistory(value: unknown) { const retained = value && typeof value === 'object' ? histories.get(value) : undefined; return retained ?? remember(createFramescaperSuccessorHistory(value)); },
		retainStoredHistory(value: unknown) { return remember(normalizeFramescaperSuccessorHistory(value)).present; },
		retainCompactedSnapshot(value: unknown, candidate: FramescaperSuccessorProject) {
			const history = historyForSnapshot(value); histories.set(candidate, Object.freeze({ ...history, present: candidate })); return candidate;
		},
	});
}
