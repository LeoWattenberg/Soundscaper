/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from './code-unit-order.ts';
import { collectProjectSourceIds } from './retention.js';
import { collectHistoryRetentionRoots } from './session-history.js';
import { collectHistoryLinkedOriginalSourceReferences, collectHistoryStorageKeys } from './session-retention-views.ts';
import type { ProjectLinkedOriginalSourceReference } from './storage/project-publication-options.ts';

interface History<Project extends object> {
	readonly present: Project;
	readonly undoStack?: readonly { readonly project: Project }[];
	readonly redoStack?: readonly { readonly project: Project }[];
}

/**
 * Index privately owned snapshots. Session updates replace documents, while undo
 * moves the same objects between stacks. Only documents entering or leaving the
 * history change root counts; the remaining 200 snapshots require no root scan.
 * Weak projection keys release documents when their history is discarded.
 */
export function createIncrementalHistoryRoots<Project extends object, Root>(
	history: History<Project>,
	collectProject: (project: Project) => Iterable<Root>,
) {
	const projections = new WeakMap<Project, ReadonlySet<Root>>();
	const counts = new Map<Root, number>();
	let projects = new Set<Project>();
	let currentHistory: History<Project> | null = null;
	update(history);
	return Object.freeze({ update, getRoots: () => new Set(counts.keys()) });

	function projectRoots(project: Project): ReadonlySet<Root> {
		let roots = projections.get(project);
		if (!roots) {
			roots = new Set(collectProject(project));
			projections.set(project, roots);
		}
		return roots;
	}

	function update(next: History<Project>): void {
		if (next === currentHistory) return;
		const selected = new Set([next.present,
			...(next.undoStack ?? []).map((entry) => entry.project),
			...(next.redoStack ?? []).map((entry) => entry.project)]);
		const entered = [...selected].filter((project) => !projects.has(project));
		// Prepare before mutation so a rejected projection leaves the index intact.
		for (const project of entered) projectRoots(project);
		for (const project of projects) {
			if (selected.has(project)) continue;
			for (const root of projectRoots(project)) {
				const count = counts.get(root)! - 1;
				if (count) counts.set(root, count);
				else counts.delete(root);
			}
		}
		for (const project of entered) {
			for (const root of projectRoots(project)) counts.set(root, (counts.get(root) ?? 0) + 1);
		}
		projects = selected;
		currentHistory = next;
	}
}

/** Keep optional projections lazy so invalid storage identities fail at the same query boundary. */
export function createSessionRetentionIndex(initial: History<object>) {
	let history = initial;
	const collectors = {
		sourceIds: (project: object): Iterable<string> => collectProjectSourceIds(project) as Set<string>,
		clipIds: (project: object): Iterable<string> => collectHistoryRetentionRoots([{ present: project }]).clipIds as Set<string>,
		assistanceSourceIds: (project: object): Iterable<string> => collectHistoryRetentionRoots([{ present: project }]).assistanceSourceIds as Set<string>,
		storageKeys: (project: object): Iterable<string> => collectHistoryStorageKeys([{ present: project }]),
		linkedOriginalKeys: (project: object): Iterable<string> => collectHistoryLinkedOriginalSourceReferences([{ present: project }])
			.map(({ kind, sourceId }) => `${kind}:${sourceId}`),
	};
	type Field = keyof typeof collectors;
	const indices = new Map<Field, ReturnType<typeof createIncrementalHistoryRoots<object, string>>>();
	return Object.freeze({
		update(next: History<object>) { history = next; },
		getSourceIds: () => read('sourceIds'),
		getRetentionRoots: () => ({ clipIds: read('clipIds'), assistanceSourceIds: read('assistanceSourceIds') }),
		getStorageKeys: () => read('storageKeys'),
		getLinkedOriginalKeys: () => read('linkedOriginalKeys'),
	});

	function read(field: Field): Set<string> {
		let index = indices.get(field);
		if (!index) {
			index = createIncrementalHistoryRoots(history, collectors[field]);
			indices.set(field, index);
		} else index.update(history);
		return index.getRoots();
	}
}

type SessionRetentionIndex = ReturnType<typeof createSessionRetentionIndex>;

export function collectSessionRetentionRoots(indices: readonly SessionRetentionIndex[]) {
	const clipIds = new Set<string>();
	const assistanceSourceIds = new Set<string>();
	for (const index of indices) {
		const roots = index.getRetentionRoots();
		for (const id of roots.clipIds) clipIds.add(id);
		for (const id of roots.assistanceSourceIds) assistanceSourceIds.add(id);
	}
	return { clipIds, assistanceSourceIds };
}

export function collectSessionLinkedOriginalSourceReferences(
	indices: readonly SessionRetentionIndex[],
): readonly ProjectLinkedOriginalSourceReference[] {
	const keys = new Set<string>();
	for (const index of indices) for (const key of index.getLinkedOriginalKeys()) keys.add(key);
	return Object.freeze([...keys].sort(compareCodeUnits).map((key) => Object.freeze({
		kind: key.startsWith('audio:') ? 'audio' : 'video', sourceId: key.slice(6),
	})));
}

export function collectSessionStorageKeys(indices: readonly SessionRetentionIndex[]): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const index of indices) for (const key of index.getStorageKeys()) keys.add(key);
	return keys;
}
