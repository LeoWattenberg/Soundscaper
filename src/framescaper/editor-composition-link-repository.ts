/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { transferMotionCompositionOffer } from '../common/editor/motion-link-transfer.ts';
import { createMotionCompositionLinkState, normalizeMotionCompositionLinkState, receiveMotionCompositionUpdate, conformMotionCompositionLink, restoreMotionCompositionLink, resumeMotionCompositionLink, type MotionCompositionLinkState } from '../common/editor/motion-link-state.ts';
import { verifyMotionscaperRevision, type MotionscaperRevision } from '../common/editor/motion-project-revision.ts';
import { motionDigest, motionId, motionRecord } from '../common/editor/motion-values.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { MotionAssetRepository, type MotionAssetStaging } from '../common/editor/storage/motion-asset-repository.ts';
import { reclaimExpiredMotionStaging } from '../common/editor/storage/motion-asset-staging.ts';
import { assertFramescaperSuccessorLine } from './editor-project-successor.ts';
import { openFramescaperSuccessorDatabase } from './editor-project-successor-database.ts';
import { persistFramescaperLinkedSuccessorArchive, type FramescaperLinkedArchiveReceiveOptions } from './editor-project-successor-linked-import-repository.ts';
import type { FramescaperMigrationRecord } from './editor-project-successor-archive.ts';

type Stores = Readonly<Record<string, IDBObjectStore>>;
type ReceiveOptions = Readonly<{ readAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>; signal?: AbortSignal; maximumBytes?: number }>;
const CUSTODY_STORES = ['linkStates', 'linkRevisions', 'assets', 'chunks', 'staging'] as const;
export interface FramescaperCompositionLinkRepository {
	importArchive(archive: Blob, options?: FramescaperLinkedArchiveReceiveOptions): Promise<FramescaperMigrationRecord>;
	receive(ownerProjectId: string, sourceId: string, value: unknown, options: ReceiveOptions): Promise<MotionCompositionLinkState>;
	load(ownerProjectId: string, sourceId: string): Promise<MotionCompositionLinkState | null>;
	loadRevision(projectId: string, digest: string): Promise<MotionscaperRevision | null>;
	readAsset(value: unknown): Promise<MotionAssetBody | null>;
	conform(ownerProjectId: string, sourceId: string): Promise<MotionCompositionLinkState>;
	resume(ownerProjectId: string, sourceId: string): Promise<MotionCompositionLinkState>;
	restore(ownerProjectId: string, sourceId: string, historicalOffer: unknown): Promise<MotionCompositionLinkState>;
	close(): Promise<void>;
}

/** Receiver-owned closure and link state share one transaction. Keep all published history/export roots until explicit retention collection exists. */
export async function openFramescaperCompositionLinkRepository(options: Readonly<{ indexedDB?: IDBFactory; line: unknown }>): Promise<FramescaperCompositionLinkRepository> {
	assertFramescaperSuccessorLine(options.line); const factory = options.indexedDB ?? globalThis.indexedDB;
	if (!factory) throw new Error('Framescaper composition links require durable IndexedDB storage.');
	const database = await openFramescaperSuccessorDatabase(factory, options.line);
	try { await reclaimExpiredMotionStaging(database); } catch (error) { database.close(); throw error; }
	let closed = false;
	const getDatabase = () => { if (closed) throw new Error('Framescaper composition link repository is closed.'); return database; };
	const assets = new MotionAssetRepository(() => Promise.resolve(getDatabase()));
	async function assertClosure(stores: Stores, offer: MotionCompositionOffer): Promise<void> {
		for (const asset of offer.revision.project.assets) await assets.assertAvailable(stores, asset);
	}
	async function loadState(stores: Stores, ownerProjectId: string, sourceId: string): Promise<MotionCompositionLinkState | null> {
		const value: unknown = await request(stores.linkStates.get(stateKey(ownerProjectId, sourceId)));
		if (value === undefined) return null;
		const record = motionRecord(value, ['key', 'ownerProjectId', 'sourceId', 'state'], 'stored composition link');
		if (record.key !== stateKey(ownerProjectId, sourceId) || record.ownerProjectId !== ownerProjectId || record.sourceId !== sourceId) throw new RangeError('Stored composition link ownership differs from its requested identity.');
		const state = normalizeMotionCompositionLinkState(record.state); await assertClosure(stores, state.accepted);
		if (state.pending) await assertClosure(stores, state.pending); return state;
	}
	async function putState(stores: Stores, ownerProjectId: string, sourceId: string, state: MotionCompositionLinkState): Promise<void> {
		await request(stores.linkStates.put({ key: stateKey(ownerProjectId, sourceId), ownerProjectId, sourceId, state }));
	}
	async function loadRevision(stores: Stores, projectId: string, digest: string): Promise<MotionscaperRevision | null> {
		const value: unknown = await request(stores.linkRevisions.get(revisionKey(projectId, digest)));
		if (value === undefined) return null;
		const record = motionRecord(value, ['key', 'snapshot'], 'stored linked revision'); const snapshot = verifyMotionscaperRevision(record.snapshot);
		if (record.key !== revisionKey(projectId, digest) || snapshot.projectId !== projectId || snapshot.digest !== digest) throw new RangeError('Stored linked revision identity differs from its requested identity.');
		for (const asset of snapshot.project.assets) await assets.assertAvailable(stores, asset); return snapshot;
	}
	async function transition(ownerProjectId: string, sourceId: string, apply: (state: MotionCompositionLinkState, stores: Stores) => MotionCompositionLinkState | Promise<MotionCompositionLinkState>): Promise<MotionCompositionLinkState> {
		stateKey(ownerProjectId, sourceId);
		return transact(getDatabase(), CUSTODY_STORES, 'readwrite', async (stores) => {
			const prior = await loadState(stores, ownerProjectId, sourceId); if (!prior) throw new RangeError('Composition link is unavailable.');
			const next = await apply(prior, stores); if (next !== prior) await putState(stores, ownerProjectId, sourceId, next); return next;
		});
	}
	return Object.freeze({
		importArchive: (archive, receiveOptions = {}) => persistFramescaperLinkedSuccessorArchive(getDatabase(), assets, archive, receiveOptions),
		async receive(ownerProjectId, sourceId, value, receiveOptions) {
			stateKey(ownerProjectId, sourceId); const offer = normalizeMotionCompositionOffer(value); const stages = new Map<string, MotionAssetStaging>();
			let result: MotionCompositionLinkState | undefined;
			await transferMotionCompositionOffer(offer, { ...receiveOptions, async begin() {
				await transact(getDatabase(), CUSTODY_STORES, 'readonly', async (stores) => {
					const prior = await loadState(stores, ownerProjectId, sourceId); if (prior) receiveMotionCompositionUpdate(prior, offer);
				});
				return {
					async write(asset, bytes) {
						let stage = stages.get(asset.sha256); if (!stage) { stage = await assets.stage(asset); stages.set(asset.sha256, stage); }
						await stage.write(bytes);
					},
					async finish(asset) { const stage = stages.get(asset.sha256); if (!stage) throw new Error('Linked asset staging is unavailable.'); await stage.finish(); },
					async commit() {
						result = await transact(getDatabase(), CUSTODY_STORES, 'readwrite', async (stores) => {
							receiveOptions.signal?.throwIfAborted();
							const prior = await loadState(stores, ownerProjectId, sourceId);
							const next = prior ? receiveMotionCompositionUpdate(prior, offer) : createMotionCompositionLinkState(offer);
							for (const stage of stages.values()) await stage.publish(stores);
							await assertClosure(stores, offer);
							await request(stores.linkRevisions.put({ key: revisionKey(offer.revision.projectId, offer.revision.digest), snapshot: offer.revision }));
							await putState(stores, ownerProjectId, sourceId, next); receiveOptions.signal?.throwIfAborted(); return next;
						});
					},
					async rollback() {
						const failures: unknown[] = [];
						for (const stage of stages.values()) { try { await stage.rollback(); } catch (error) { failures.push(error); } }
						if (failures.length) throw new AggregateError(failures, 'Composition link staging cleanup failed.');
					},
				};
			} });
			if (!result) throw new Error('Composition link transfer did not publish a receiver state.'); return result;
		},
		load: (ownerProjectId, sourceId) => { stateKey(ownerProjectId, sourceId); return transact(getDatabase(), CUSTODY_STORES, 'readonly', (stores) => loadState(stores, ownerProjectId, sourceId)); },
		loadRevision: (projectId, digest) => { revisionKey(projectId, digest); return transact(getDatabase(), ['linkRevisions', 'assets'], 'readonly', (stores) => loadRevision(stores, projectId, digest)); },
		readAsset: (value) => assets.read(value),
		conform: (ownerProjectId, sourceId) => transition(ownerProjectId, sourceId, conformMotionCompositionLink),
		resume: (ownerProjectId, sourceId) => transition(ownerProjectId, sourceId, resumeMotionCompositionLink),
		restore: (ownerProjectId, sourceId, value) => transition(ownerProjectId, sourceId, async (state, stores) => {
			const offer = normalizeMotionCompositionOffer(value); const retained = await loadRevision(stores, offer.revision.projectId, offer.revision.digest);
			if (!retained) throw new RangeError('Composition link history revision is not retained.'); return restoreMotionCompositionLink(state, offer);
		}),
		async close() { if (!closed) { closed = true; database.close(); } },
	} satisfies FramescaperCompositionLinkRepository);
}
function stateKey(ownerProjectId: string, sourceId: string): string { return JSON.stringify([motionId(ownerProjectId), motionId(sourceId)]); }
function revisionKey(projectId: string, digest: string): string { return JSON.stringify([motionId(projectId), motionDigest(digest)]); }
