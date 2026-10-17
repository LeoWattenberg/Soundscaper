/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionCompositionLinkState, type MotionCompositionLinkState } from '../common/editor/motion-link-state.ts';
import { verifyMotionscaperRevision, type MotionscaperRevision } from '../common/editor/motion-project-revision.ts';
import type { MotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { motionDigest, motionId, motionRecord } from '../common/editor/motion-values.ts';
import { request } from '../common/editor/storage/indexeddb-backend.ts';
import type { MotionAssetRepository } from '../common/editor/storage/motion-asset-repository.ts';

export type FramescaperLinkStores = Readonly<Record<string, IDBObjectStore>>;
export function framescaperLinkStateKey(ownerProjectId: string, sourceId: string): string { return JSON.stringify([motionId(ownerProjectId), motionId(sourceId)]); }
export function framescaperLinkRevisionKey(projectId: string, digest: string): string { return JSON.stringify([motionId(projectId), motionDigest(digest)]); }
export async function assertFramescaperLinkClosure(stores: FramescaperLinkStores, assets: MotionAssetRepository, offer: MotionCompositionOffer): Promise<void> {
	for (const asset of offer.revision.project.assets) await assets.assertAvailable(stores, asset);
}
export async function loadFramescaperLinkState(stores: FramescaperLinkStores, assets: MotionAssetRepository, ownerProjectId: string, sourceId: string): Promise<MotionCompositionLinkState | null> {
	const value: unknown = await request(stores.linkStates.get(framescaperLinkStateKey(ownerProjectId, sourceId)));
	if (value === undefined) return null;
	const record = motionRecord(value, ['key', 'ownerProjectId', 'sourceId', 'state'], 'stored composition link');
	if (record.key !== framescaperLinkStateKey(ownerProjectId, sourceId) || record.ownerProjectId !== ownerProjectId || record.sourceId !== sourceId) throw new RangeError('Stored composition link ownership differs from its requested identity.');
	const state = normalizeMotionCompositionLinkState(record.state); await assertFramescaperLinkClosure(stores, assets, state.accepted);
	if (state.pending) await assertFramescaperLinkClosure(stores, assets, state.pending); return state;
}
export async function putFramescaperLinkState(stores: FramescaperLinkStores, ownerProjectId: string, sourceId: string, state: MotionCompositionLinkState): Promise<void> {
	await request(stores.linkStates.put({ key: framescaperLinkStateKey(ownerProjectId, sourceId), ownerProjectId, sourceId, state }));
}
export async function loadFramescaperLinkRevision(stores: FramescaperLinkStores, assets: MotionAssetRepository, projectId: string, digest: string): Promise<MotionscaperRevision | null> {
	const value: unknown = await request(stores.linkRevisions.get(framescaperLinkRevisionKey(projectId, digest)));
	if (value === undefined) return null;
	const record = motionRecord(value, ['key', 'snapshot'], 'stored linked revision'); const snapshot = verifyMotionscaperRevision(record.snapshot);
	if (record.key !== framescaperLinkRevisionKey(projectId, digest) || snapshot.projectId !== projectId || snapshot.digest !== digest) throw new RangeError('Stored linked revision identity differs from its requested identity.');
	for (const asset of snapshot.project.assets) await assets.assertAvailable(stores, asset); return snapshot;
}
