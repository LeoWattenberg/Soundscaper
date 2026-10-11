/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { inspectFramescaperMigrationArchive, type FramescaperMigrationRecord } from './editor-project-successor-archive.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { migrateFramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperSuccessorHistory } from './editor-project-successor-history.ts';
import { framescaperSuccessorMediaRootDocument } from './editor-project-successor-media-roots.ts';
import { withScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { readScapeArchiveEnvelope } from '../common/editor/scape-archive-envelope.ts';
import { indexScapeProjectAssets, indexScapeProjectTimingAssets } from '../common/editor/scape-project-assets.ts';
import { ScapeImportTransaction } from '../common/editor/scape-import-transaction.ts';
import { hydrateFramescaperSuccessorMediaBody, hydrateFramescaperSuccessorAudioBody, successorHydrationStore } from './editor-project-successor-hydration-media.ts';
import { ScapeAudioChunkBudget } from '../common/editor/scape-expanded-byte-budget.ts';
import { validateVideoTimingAssetBytes } from '../common/editor/video-timing-asset.ts';
import { normalizeVideoTimingAssetReference } from '../common/editor/video-timing-asset-reference.ts';

/** Restore authenticated original bytes under their exact identities; canonical project publication stays in the owner repository. */
export async function hydrateFramescaperSuccessorArchive(record: FramescaperMigrationRecord, media: AudioEditorProjectStore, signal?: AbortSignal): Promise<void> {
	const inspected = await inspectFramescaperMigrationArchive(record.originalArchive, signal);
	if (inspected.archiveDigest !== record.archiveDigest || inspected.project.id !== record.id) throw new RangeError('Successor archive custody digest or identity changed.');
	const project = inspected.project;
	const root = framescaperSuccessorMediaRootDocument(createFramescaperSuccessorHistory(migrateFramescaperSuccessorProject(project)));
	const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const store = successorHydrationStore(media); const transaction = new ScapeImportTransaction(store, signal);
	try {
		await withScapeProjectInput(record.originalArchive, signal, async entries => {
			const envelope = await readScapeArchiveEnvelope(entries, {}, signal, extension.assetKinds);
			const request = { archiveProject: project, project, ...envelope, validation: extension.validateImportAssets(project, envelope.manifest),
				sourceIdMap: new Map(project.sources.map(source => [source.id, source.id])), store, transaction, signal };
			const assets = indexScapeProjectAssets(project, envelope.manifest, { currentProjectSchemaFamily: 'framescaper', currentProjectSchemaVersion: 1, additionalSourceKinds: extension.sourceKinds });
			const timing = indexScapeProjectTimingAssets(project, envelope.manifest);
			for (const [storageKey, asset] of timing) {
				const source = project.sources.find(value => typeof value.timingAsset === 'object' && value.timingAsset !== null && Reflect.get(value.timingAsset, 'storageKey') === storageKey)!;
				const reference = normalizeVideoTimingAssetReference(source.timingAsset);
				await hydrateFramescaperSuccessorMediaBody(storageKey, { name: `${asset.sha256}.scti`, mimeType: 'application/vnd.soundscaper.video-timing', kind: 'video-timing' }, asset, request);
				const body = await media.loadMediaAsset(storageKey, { signal }); if (!body) throw new Error('Successor timing body is unavailable.');
				validateVideoTimingAssetBytes(reference, new Uint8Array(await body.arrayBuffer()));
			}
			await extension.stageImportAssets(request);
			const audioBudget = new ScapeAudioChunkBudget();
			for (const source of project.sources) {
				const asset = assets.get(source.id); if (!asset) continue;
				if (source.kind === 'video') await hydrateFramescaperSuccessorMediaBody(String(source.storageKey), { name: source.name, mimeType: source.mimeType }, asset, request);
				else if (source.kind === 'audio') await hydrateFramescaperSuccessorAudioBody(source, asset, request, audioBudget);
			}
		});
		signal?.throwIfAborted();
		// The repository protects adopted bodies during rollback, including a concurrent materializer's root.
		await media.projectRepository.save(root);
		transaction.complete();
	} catch (error) { await transaction.rollback(error); }
}
