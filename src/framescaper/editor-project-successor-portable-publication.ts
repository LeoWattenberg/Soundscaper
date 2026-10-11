/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalJsonSha256 } from '../common/canonical-json-sha256.ts';
import { request } from '../common/editor/storage/indexeddb-backend.ts';
import { motionRecord } from '../common/editor/motion-values.ts';
import type { ScapeReplaceWriteAuthority } from '../common/editor/scape-import-transaction.ts';
import { normalizeFramescaperLinkOwnerStoredRecord } from './editor-composition-link-owner-record.ts';

type Stores = Record<string, IDBObjectStore>;
export async function assertFramescaperSuccessorPortableIdentityAbsent(stores: Stores, id: string): Promise<void> {
	for (const name of ['owners', 'projects', 'pending', 'portableArchives']) if (await request(stores[name]!.get(id)) !== undefined) throw new RangeError('Successor import identity already has retained owner custody.');
}
export async function framescaperSuccessorPortableIdentityOccupied(stores: Stores, id: string): Promise<boolean> {
	for (const name of ['owners', 'projects', 'pending', 'portableArchives']) if (await request(stores[name]!.get(id)) !== undefined) return true;
	return false;
}
/** Replace may publish only over the exact active owner captured after acquiring its physical write lease. */
export async function captureFramescaperSuccessorPortableReplacement(stores: Stores, id: string, authority: ScapeReplaceWriteAuthority) {
	authority.assertCurrent();
	if (await request(stores.pending!.get(id)) !== undefined) throw new RangeError('Complete interrupted migration before replacing its owner.');
	const value: unknown = await request(stores.owners!.get(id));
	if (value === undefined) throw new RangeError('Replacement requires a fenced active successor owner.');
	const stored = normalizeFramescaperLinkOwnerStoredRecord(value);
	if (stored.deleted || stored.project === null || stored.writeFence !== authority.writeFence) throw new RangeError('Replacement lost its successor owner write authority.');
	return stored;
}
export async function retainFramescaperSuccessorPreviousPortableArchive(stores: Stores, id: string): Promise<void> {
	const value: unknown = await request(stores.portableArchives!.get(id)); if (value === undefined) return;
	const prior = motionRecord(value, ['kind', 'id', 'archive', 'archiveDigest', 'project', 'binding'], 'previous portable custody', ['kind', 'id', 'archive', 'archiveDigest', 'project']);
	const key = `retained-archive:${canonicalJsonSha256({ id, archiveDigest: prior.archiveDigest })}`;
	const existing: unknown = await request(stores.portableArchives!.get(key));
	if (existing !== undefined) {
		const retained = motionRecord(existing, ['kind', 'id', 'ownerProjectId', 'custody'], 'retained portable history');
		const custody = motionRecord(retained.custody, ['kind', 'id', 'archive', 'archiveDigest', 'project', 'binding'], 'retained portable custody', ['kind', 'id', 'archive', 'archiveDigest', 'project']);
		if (retained.kind !== 'framescaper-successor-portable-history-v1' || retained.ownerProjectId !== id || custody.archiveDigest !== prior.archiveDigest || canonicalJsonSha256(custody.project) !== canonicalJsonSha256(prior.project)) throw new RangeError('Portable archive history identity collides.');
		return;
	}
	await request(stores.portableArchives!.add({ kind: 'framescaper-successor-portable-history-v1', id: key, ownerProjectId: id, custody: prior }));
}
