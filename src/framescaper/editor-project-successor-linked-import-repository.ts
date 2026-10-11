/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { createMotionCompositionLinkState } from '../common/editor/motion-link-state.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import type { MotionAssetRepository, MotionAssetStaging } from '../common/editor/storage/motion-asset-repository.ts';
import { importFramescaperLinkedSuccessorArchive, type FramescaperLinkedArchiveImportOptions } from './editor-project-successor-linked-import.ts';
import { stageFramescaperArchiveCustody, type FramescaperArchiveStage } from './editor-project-successor-archive-custody.ts';
import { FRAMESCAPER_ARCHIVE_STORES } from './editor-project-successor-archive-record.ts';
import type { FramescaperMigrationRecord } from './editor-project-successor-archive.ts';

export type FramescaperLinkedArchiveReceiveOptions = Omit<FramescaperLinkedArchiveImportOptions, 'begin'>;

/** Import never replaces another retained owner identity; the caller must resolve that conflict explicitly. */
export async function persistFramescaperLinkedSuccessorArchive(database: IDBDatabase, assets: MotionAssetRepository, archive: Blob, options: FramescaperLinkedArchiveReceiveOptions): Promise<FramescaperMigrationRecord> {
	const stages = new Map<string, MotionAssetStaging>(); let archiveStage: FramescaperArchiveStage | undefined;
	return importFramescaperLinkedSuccessorArchive(archive, { ...options, async begin(project) {
		await transact(database, ['owners', 'projects', 'pending'], 'readonly', async (stores) => {
			if (await request(stores.owners.get(project.id)) !== undefined || await request(stores.projects.get(project.id)) !== undefined || await request(stores.pending.get(project.id)) !== undefined) throw new RangeError('Linked archive owner already exists; import cannot replace retained intent.');
		});
		return {
			async write(asset, bytes) {
				let stage = stages.get(asset.sha256); if (!stage) { stage = await assets.stage(asset); stages.set(asset.sha256, stage); }
				await stage.write(bytes);
			},
			async finish(asset) { const stage = stages.get(asset.sha256); if (!stage) throw new Error('Linked archive staging is unavailable.'); await stage.finish(); },
			async commit(record) {
				archiveStage = await stageFramescaperArchiveCustody(database, record.originalArchive, record.archiveDigest, options.signal);
				await transact(database, ['owners', 'projects', 'pending', 'linkStates', 'linkRevisions', 'assets', 'chunks', 'staging', ...FRAMESCAPER_ARCHIVE_STORES], 'readwrite', async (stores) => {
					options.signal?.throwIfAborted();
					if (await request(stores.owners.get(record.id)) !== undefined || await request(stores.projects.get(record.id)) !== undefined || await request(stores.pending.get(record.id)) !== undefined) throw new RangeError('Linked archive owner changed during import.');
					for (const stage of stages.values()) await stage.publish(stores);
					for (const link of record.project.compositionLinks) {
						for (const asset of link.snapshot.project.assets) await assets.assertAvailable(stores, asset);
						const offer = createMotionCompositionOffer(link.compositionId, link.snapshot); const state = createMotionCompositionLinkState(offer);
						await request(stores.linkRevisions.put({ key: JSON.stringify([link.projectId, link.acceptedDigest]), snapshot: link.snapshot }));
						await request(stores.linkStates.put({ key: JSON.stringify([record.id, link.sourceId]), ownerProjectId: record.id, sourceId: link.sourceId, state }));
					}
					await archiveStage!.publish(stores);
					await request(stores.projects.add({ ...record, originalArchive: archiveStage!.reference })); options.signal?.throwIfAborted();
				});
			},
			async rollback() {
				const failures: unknown[] = [];
				try { await archiveStage?.rollback(); } catch (error) { failures.push(error); }
				for (const stage of stages.values()) { try { await stage.rollback(); } catch (error) { failures.push(error); } }
				if (failures.length) throw new AggregateError(failures, 'Linked archive staging cleanup failed.');
			},
		};
	} });
}
