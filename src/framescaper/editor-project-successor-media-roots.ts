/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { collectProjectStorageKeys } from '../common/editor/retention.js';
import { createFramescaperLinkOwnerRecord } from './editor-composition-link-owner-record.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import type { FramescaperSuccessorHistory } from './editor-project-successor-history.ts';

/** Publish durable cache roots before the independent owner CAS; an abandoned candidate keeps bytes, never drops an accepted root. */
export function framescaperSuccessorMediaRootDocument(history: FramescaperSuccessorHistory) {
	const record = createFramescaperLinkOwnerRecord(history.present, history); const keys = new Set<string>();
	for (const project of [history.present, ...history.undoStack.map(entry => entry.project), ...history.redoStack.map(entry => entry.project)]) {
		const baseline = framescaperSuccessorBaselineProject(project); const references = collectProjectStorageKeys(baseline) as Set<string>;
		const sources = baseline.sources;
		for (const source of sources) { if (typeof source.storageKey === 'string') references.add(source.storageKey); }
		for (const link of project.compositionLinks) {
			const companion = sources.find(entry => entry.id === link.audioSourceId);
			if (typeof companion?.storageKey === 'string') references.delete(companion.storageKey);
			const source = sources.find(entry => entry.id === link.sourceId);
			if (typeof source?.storageKey === 'string') references.delete(source.storageKey);
			const timing = source?.timingAsset as { storageKey?: string } | undefined; if (timing?.storageKey) references.delete(timing.storageKey);
		}
		for (const key of references) keys.add(key);
	}
	// These deliberately contain no editable project intent and are hidden by the owner-only catalog adapter.
	return { id: `successor-media:${record.id}:${record.ownerDigest}`, schemaVersion: 0, revision: 0,
		cacheKind: 'framescaper-successor-media-roots', title: 'Successor media retention',
		sources: [...keys].sort().map(key => ({ id: key, storageKey: key })), clips: [], tracks: [] };
}
export async function retainFramescaperSuccessorMediaHistory(media: AudioEditorProjectStore, history: FramescaperSuccessorHistory): Promise<void> {
	const root = framescaperSuccessorMediaRootDocument(history);
	for (const { storageKey: key } of root.sources) {
		if (!await media.getSourceMetadata(key) && !await media.getMediaAssetMetadata(key)) throw new Error(`Successor media closure is unavailable: ${key}. Restore the retained archive before saving.`);
	}
	await media.projectRepository.save(root);
}
