/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { transferMotionCompositionOffer } from '../common/editor/motion-link-transfer.ts';
import { createMotionCompositionLinkState, receiveMotionCompositionUpdate, conformMotionCompositionLink, resumeMotionCompositionLink, restoreMotionCompositionLink, type MotionCompositionLinkState } from '../common/editor/motion-link-state.ts';
import { freezeMotionValue, motionDigest, motionId, motionRecord } from '../common/editor/motion-values.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { MotionAssetRepository, type MotionAssetStaging } from '../common/editor/storage/motion-asset-repository.ts';
import { reclaimExpiredMotionStaging } from '../common/editor/storage/motion-asset-staging.ts';
import { openFramescaperSuccessorDatabase } from './editor-project-successor-database.ts';
import { assertFramescaperSuccessorLine, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperCompositionLink } from './editor-project-successor-link.ts';
import type { FramescaperSuccessorHistory } from './editor-project-successor-history.ts';
import { createFramescaperLinkOwnerRecord, normalizeFramescaperLinkOwnerRecord, type FramescaperCompositionLinkOwnerRecord } from './editor-composition-link-owner-record.ts';
import { framescaperLinkRevisionKey, framescaperLinkStateKey, loadFramescaperLinkState, loadFramescaperLinkRevision, putFramescaperLinkState, type FramescaperLinkStores } from './editor-composition-link-records.ts';

const STORES = ['owners', 'projects', 'pending', 'linkStates', 'linkRevisions', 'assets', 'chunks', 'staging'] as const;
export interface FramescaperCompositionLinkOwnerReceipt {
	readonly project: FramescaperSuccessorProject; readonly history: FramescaperSuccessorHistory; readonly ownerDigest: string;
	readonly linkStates: readonly Readonly<{ sourceId: string; state: MotionCompositionLinkState }>[];
}
export interface FramescaperCompositionLinkOwnerCommit {
	readonly expectedOwnerDigest: string | null; readonly project: FramescaperSuccessorProject; readonly history?: FramescaperSuccessorHistory;
}
export interface PreparedFramescaperCompositionLinkOwner {
	readonly state: MotionCompositionLinkState;
	commit(value: FramescaperCompositionLinkOwnerCommit): Promise<FramescaperCompositionLinkOwnerReceipt>;
	rollback(): Promise<void>;
}
export type FramescaperCompositionLinkOwnerTransition = Readonly<{ type: 'conform' | 'resume' }> | Readonly<{ type: 'restore'; offer: unknown }>;
export interface FramescaperCompositionLinkOwnerRepository {
	loadOwner(id: string): Promise<FramescaperCompositionLinkOwnerReceipt | null>;
	saveOwner(project: FramescaperSuccessorProject, expectedOwnerDigest: string | null, history?: FramescaperSuccessorHistory): Promise<FramescaperCompositionLinkOwnerReceipt>;
	prepareReceive(ownerProjectId: string, sourceId: string, offer: unknown, options: Readonly<{ readAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>; signal?: AbortSignal; maximumBytes?: number }>): Promise<PreparedFramescaperCompositionLinkOwner>;
	prepareTransition(ownerProjectId: string, sourceId: string, transition: FramescaperCompositionLinkOwnerTransition): Promise<PreparedFramescaperCompositionLinkOwner>;
	readAsset(asset: unknown): Promise<MotionAssetBody | null>;
	close(): Promise<void>;
}

/** Owner CAS, link state, historical closure and private asset publication share one durable transaction. */
export async function openFramescaperCompositionLinkOwnerRepository(options: Readonly<{ indexedDB?: IDBFactory; line: unknown }>): Promise<FramescaperCompositionLinkOwnerRepository> {
	assertFramescaperSuccessorLine(options.line); const factory = options.indexedDB ?? globalThis.indexedDB;
	if (!factory) throw new Error('Composition link owners require durable IndexedDB storage.');
	const database = await openFramescaperSuccessorDatabase(factory, options.line);
	try { await reclaimExpiredMotionStaging(database); } catch (error) { database.close(); throw error; }
	let closed = false; let closing: Promise<void> | null = null; const lifetime = new AbortController();
	const tasks = new Set<Promise<unknown>>(); const preparations = new Set<PreparedFramescaperCompositionLinkOwner>();
	const assets = new MotionAssetRepository(() => { if (closed) return Promise.reject(new Error('Composition link owner repository is closed.')); return Promise.resolve(database); });
	function start<T>(operation: () => Promise<T>): Promise<T> {
		if (closed || closing) return Promise.reject(new Error('Composition link owner repository is closed.'));
		const task = Promise.resolve().then(operation); tasks.add(task);
		void task.then(() => tasks.delete(task), () => tasks.delete(task)); return task;
	}
	async function readOwner(stores: FramescaperLinkStores, id: string): Promise<FramescaperCompositionLinkOwnerRecord | null> {
		motionId(id); const stored: unknown = await request(stores.owners.get(id));
		if (stored !== undefined) { const record = normalizeFramescaperLinkOwnerRecord(stored); if (record.id !== id) throw new RangeError('Stored owner identity changed.'); return record; }
		const migration: unknown = await request(stores.projects.get(id)); if (migration === undefined) return null;
		const retained = motionRecord(migration, ['id', 'archiveDigest', 'originalArchive', 'project'], 'retained successor custody');
		if (motionId(retained.id) !== id || !(retained.originalArchive instanceof Blob)) throw new RangeError('Retained successor custody identity changed.'); motionDigest(retained.archiveDigest);
		const record = createFramescaperLinkOwnerRecord(retained.project); if (record.id !== id) throw new RangeError('Retained successor owner identity changed.'); return record;
	}
	async function receipt(stores: FramescaperLinkStores, record: FramescaperCompositionLinkOwnerRecord): Promise<FramescaperCompositionLinkOwnerReceipt> {
		const linkStates: { sourceId: string; state: MotionCompositionLinkState }[] = [];
		for (const link of record.project.compositionLinks) {
			const state = await loadFramescaperLinkState(stores, assets, record.id, link.sourceId);
			if (!state || JSON.stringify(createFramescaperCompositionLink(link.sourceId, state.accepted.compositionId, state.accepted.revision)) !== JSON.stringify(link)) throw new RangeError('Owner link differs from its accepted immutable receiver state.');
			linkStates.push({ sourceId: link.sourceId, state });
		}
		for (const project of [record.history.present, ...record.history.undoStack.map((entry) => entry.project), ...record.history.redoStack.map((entry) => entry.project)]) {
			for (const link of project.compositionLinks) {
				const retained = await loadFramescaperLinkRevision(stores, assets, link.projectId, link.acceptedDigest);
				if (!retained || JSON.stringify(retained) !== JSON.stringify(link.snapshot)) throw new RangeError('Owner history requires a retained immutable linked revision.');
			}
		}
		return freezeMotionValue({ project: record.project, history: record.history, ownerDigest: record.ownerDigest, linkStates });
	}
	async function assertOwnerCAS(stores: FramescaperLinkStores, id: string, expected: string | null): Promise<void> {
		if (expected !== null) motionDigest(expected); const prior = await readOwner(stores, id);
		if (!prior && await request(stores.pending.get(id)) !== undefined) throw new Error('Successor migration remains pending; complete it before publishing its owner.');
		if ((prior?.ownerDigest ?? null) !== expected) throw new Error('Composition link owner changed; retry against its current intent.');
	}
	async function rollbackStages(stages: ReadonlyMap<string, MotionAssetStaging>): Promise<void> {
		const failures: unknown[] = []; for (const stage of stages.values()) { try { await stage.rollback(); } catch (error) { failures.push(error); } }
		if (failures.length) throw new AggregateError(failures, 'Composition link owner staging cleanup failed.');
	}
	function prepare(ownerProjectId: string, sourceId: string, prior: MotionCompositionLinkState | null, state: MotionCompositionLinkState, stages: ReadonlyMap<string, MotionAssetStaging>, offer?: MotionCompositionOffer, signal?: AbortSignal): PreparedFramescaperCompositionLinkOwner {
		let consumed = false; const priorText = JSON.stringify(prior);
		const prepared: PreparedFramescaperCompositionLinkOwner = Object.freeze({ state,
			commit(value: FramescaperCompositionLinkOwnerCommit) {
				if (consumed || closed || closing) return Promise.reject(new Error('Prepared composition link owner is consumed or closed.'));
				consumed = true;
				return start(async () => {
					try {
						const command = motionRecord(value, ['expectedOwnerDigest', 'project', 'history'], 'prepared owner commit', ['expectedOwnerDigest', 'project']);
						const record = createFramescaperLinkOwnerRecord(command.project, command.history);
						if (record.id !== ownerProjectId || !record.project.compositionLinks.some((link) => link.sourceId === sourceId)) throw new RangeError('Prepared accepted link must belong to its exact owner project.');
						return await transact(database, STORES, 'readwrite', async (stores) => {
							signal?.throwIfAborted(); lifetime.signal.throwIfAborted(); await assertOwnerCAS(stores, record.id, command.expectedOwnerDigest === null ? null : motionDigest(command.expectedOwnerDigest));
							const current = await loadFramescaperLinkState(stores, assets, ownerProjectId, sourceId);
							if (JSON.stringify(current) !== priorText) throw new Error('Prepared composition link state changed; retry its owner transaction.');
							for (const stage of stages.values()) await stage.publish(stores);
							if (offer) await request(stores.linkRevisions.put({ key: framescaperLinkRevisionKey(offer.revision.projectId, offer.revision.digest), snapshot: offer.revision }));
							await putFramescaperLinkState(stores, ownerProjectId, sourceId, state); const result = await receipt(stores, record);
							await request(stores.owners.put(record)); signal?.throwIfAborted(); lifetime.signal.throwIfAborted(); return result;
						});
					} catch (error) {
						try { await rollbackStages(stages); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Composition link owner publication and cleanup both failed.', { cause: cleanup }); } throw error;
					} finally { preparations.delete(prepared); }
				});
			},
			async rollback() { if (consumed) return; consumed = true; try { await rollbackStages(stages); } finally { preparations.delete(prepared); } },
		}); preparations.add(prepared); return prepared;
	}
	return Object.freeze({
		loadOwner(id) { return start(async () => transact(database, STORES, 'readonly', async (stores) => { const record = await readOwner(stores, id); return record ? receipt(stores, record) : null; })); },
		saveOwner(project, expectedOwnerDigest, history) {
			return start(async () => {
				const record = createFramescaperLinkOwnerRecord(project, history);
				return transact(database, STORES, 'readwrite', async (stores) => { lifetime.signal.throwIfAborted(); await assertOwnerCAS(stores, record.id, expectedOwnerDigest); const result = await receipt(stores, record); await request(stores.owners.put(record)); lifetime.signal.throwIfAborted(); return result; });
			});
		},
		prepareReceive(ownerProjectId, sourceId, value, receiveOptions) {
			return start(async () => {
				framescaperLinkStateKey(ownerProjectId, sourceId); const offer = normalizeMotionCompositionOffer(value);
				const signal = receiveOptions.signal ? AbortSignal.any([receiveOptions.signal, lifetime.signal]) : lifetime.signal; signal.throwIfAborted();
				const prior = await transact(database, STORES, 'readonly', async (stores) => { const owner = await readOwner(stores, ownerProjectId); if (owner) await receipt(stores, owner); return loadFramescaperLinkState(stores, assets, ownerProjectId, sourceId); });
				const state = prior ? receiveMotionCompositionUpdate(prior, offer) : createMotionCompositionLinkState(offer); const stages = new Map<string, MotionAssetStaging>();
				try {
					await transferMotionCompositionOffer(offer, { ...receiveOptions, signal, async begin() { return {
						async write(asset, bytes) { let stage = stages.get(asset.sha256); if (!stage) { stage = await assets.stage(asset); stages.set(asset.sha256, stage); } await stage.write(bytes); },
						async finish(asset) { const stage = stages.get(asset.sha256); if (!stage) throw new Error('Prepared linked staging is unavailable.'); await stage.finish(); },
						async commit() {}, async rollback() { await rollbackStages(stages); },
					}; } });
					signal.throwIfAborted(); return prepare(ownerProjectId, sourceId, prior, state, stages, offer, signal);
				} catch (error) { try { await rollbackStages(stages); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Composition link owner preparation and cleanup both failed.', { cause: cleanup }); } throw error; }
			});
		},
		prepareTransition(ownerProjectId, sourceId, transition) {
			return start(async () => {
				framescaperLinkStateKey(ownerProjectId, sourceId);
				const action = motionRecord(transition, ['type', 'offer'], 'owner link transition', ['type']);
				if (action.type !== 'restore' && Object.hasOwn(action, 'offer')) throw new RangeError('Only restore admits a historical offer.');
				return transact(database, STORES, 'readonly', async (stores) => {
					const owner = await readOwner(stores, ownerProjectId); if (owner) await receipt(stores, owner);
					const prior = await loadFramescaperLinkState(stores, assets, ownerProjectId, sourceId); if (!prior) throw new RangeError('Composition link is unavailable.');
					let state: MotionCompositionLinkState;
					if (action.type === 'conform') state = conformMotionCompositionLink(prior);
					else if (action.type === 'resume') state = resumeMotionCompositionLink(prior);
					else if (action.type === 'restore') {
						const offer = normalizeMotionCompositionOffer(action.offer);
						if (!await loadFramescaperLinkRevision(stores, assets, offer.revision.projectId, offer.revision.digest)) throw new RangeError('Composition link history revision is not retained.');
						state = restoreMotionCompositionLink(prior, offer);
					} else throw new RangeError('Unsupported owner link transition.');
					lifetime.signal.throwIfAborted(); return prepare(ownerProjectId, sourceId, prior, state, new Map());
				});
			});
		},
		readAsset(asset) { return start(() => assets.read(asset)); },
		close() {
			if (closing) return closing; if (closed) return Promise.resolve(); lifetime.abort();
			closing = (async () => {
				await Promise.allSettled([...tasks]); const failures: unknown[] = [];
				for (const prepared of preparations) { try { await prepared.rollback(); } catch (error) { failures.push(error); } }
				closed = true; database.close(); if (failures.length) throw new AggregateError(failures, 'Composition link owner close cleanup failed.');
			})(); return closing;
		},
	} satisfies FramescaperCompositionLinkOwnerRepository);
}
