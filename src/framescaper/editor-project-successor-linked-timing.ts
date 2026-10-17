/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FramescaperSuccessorHistory } from './editor-project-successor-history.ts';
import type { FramescaperSuccessorProject } from './editor-project-successor.ts';
import { resolveFramescaperCompositionSource } from './editor-composition-link-source.ts';

type Entry = Readonly<{ project: FramescaperSuccessorProject; source: Readonly<Record<string, unknown> & { id: string }> }>;
/** Exact linked timing is a derived materialization of admitted owner history, never ordinary media custody. */
export function createFramescaperSuccessorLinkedTimingStore() {
	const owners = new Map<string, ReadonlyMap<string, Entry>>();
	return Object.freeze({
		retain(history: FramescaperSuccessorHistory) {
			const entries = new Map<string, Entry>();
			for (const project of [history.present, ...history.undoStack.map(entry => entry.project), ...history.redoStack.map(entry => entry.project)]) {
				for (const link of project.compositionLinks) {
					const source = project.sources.find(source => source.id === link.sourceId)!;
					const reference = source.timingAsset as Readonly<{ storageKey: string }>;
					entries.set(reference.storageKey, { project, source });
				}
			}
			owners.set(history.present.id, entries);
		},
		forget(id: string) { owners.delete(id); },
		read(key: string, signal?: AbortSignal): Blob | null {
			signal?.throwIfAborted();
			for (const entries of owners.values()) {
				const entry = entries.get(key); if (!entry) continue;
				const resolved = resolveFramescaperCompositionSource(entry.project, entry.source)!;
				if (resolved.timing.reference.storageKey !== key) throw new RangeError('Linked timing identity differs from its canonical owner.');
				signal?.throwIfAborted(); return new Blob([new Uint8Array(resolved.timing.bytes)], { type: 'application/vnd.soundscaper.video-timing' });
			}
			return null;
		},
	});
}
