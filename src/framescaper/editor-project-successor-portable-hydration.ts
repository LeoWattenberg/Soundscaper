/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type { ScapeArchiveEnvelope } from '../common/editor/scape-archive-envelope.ts';
import { ScapeImportTransaction } from '../common/editor/scape-import-transaction.ts';
import { ScapeAudioChunkBudget } from '../common/editor/scape-expanded-byte-budget.ts';
import { indexScapeProjectTimingAssets } from '../common/editor/scape-project-assets.ts';
import { normalizeVideoTimingAssetReference, validateVideoTimingAssetBytes } from '../common/editor/video-timing-asset.ts';
import type { admitFramescaperSuccessorPortableEnvelope } from './editor-project-successor-portable-inspect.ts';
import { hydrateFramescaperSuccessorMediaBody, hydrateFramescaperSuccessorAudioBody, successorHydrationStore } from './editor-project-successor-hydration-media.ts';
import { createFramescaperSuccessorHistory } from './editor-project-successor-history.ts';
import { retainFramescaperSuccessorMediaHistory } from './editor-project-successor-media-roots.ts';

/** Ordinary bytes acquire a conservative cache root before owner publication; no virtual source body is materialized. */
export async function hydrateFramescaperSuccessorPortableMedia(envelope: ScapeArchiveEnvelope, closure: ReturnType<typeof admitFramescaperSuccessorPortableEnvelope>, media: AudioEditorProjectStore, signal?: AbortSignal): Promise<void> {
	const store = successorHydrationStore(media); const transaction = new ScapeImportTransaction(store, signal);
	try {
		const request = { ...envelope, archiveProject: closure.baseline, project: closure.baseline, validation: closure.extensionValidation,
			sourceIdMap: new Map(closure.baseline.sources.map(source => [source.id, source.id])), store, transaction, signal };
		for (const [storageKey, asset] of indexScapeProjectTimingAssets(closure.ordinary, closure.ordinaryManifest)) {
			const source = closure.ordinary.sources.find(value => typeof value.timingAsset === 'object' && value.timingAsset !== null && Reflect.get(value.timingAsset, 'storageKey') === storageKey)!;
			const reference = normalizeVideoTimingAssetReference(source.timingAsset);
			await hydrateFramescaperSuccessorMediaBody(storageKey, { name: `${asset.sha256}.scti`, mimeType: 'application/vnd.soundscaper.video-timing', kind: 'video-timing' }, asset, request);
			const body = await media.loadMediaAsset(storageKey, { signal }); if (!body) throw new RangeError('Ordinary source timing body is unavailable.');
			validateVideoTimingAssetBytes(reference, new Uint8Array(await body.arrayBuffer()));
		}
		await closure.extension.stageImportAssets(request); const budget = new ScapeAudioChunkBudget();
		for (const source of closure.ordinary.sources) {
			const asset = closure.ordinaryAssets.get(source.id); if (!asset) continue;
			if (source.kind === 'video') await hydrateFramescaperSuccessorMediaBody(String(source.storageKey), { name: source.name, mimeType: source.mimeType }, asset, request);
			else if (source.kind === 'audio') await hydrateFramescaperSuccessorAudioBody(source, asset, request, budget);
		}
		signal?.throwIfAborted(); await retainFramescaperSuccessorMediaHistory(media, createFramescaperSuccessorHistory(closure.project)); transaction.complete();
	} catch (error) { await transaction.rollback(error); }
}
