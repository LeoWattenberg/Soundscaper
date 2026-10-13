/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../src/common/editor/closed-domain-value.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { editorProjectStorageProfileNames } from '../../../src/common/editor/storage/project-storage-profile.ts';
import { createFramescaperProjectStore } from '../../../src/framescaper/editor-project-store.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../../../src/framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../../../src/framescaper/editor-project-storage-profile.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from '../../../src/framescaper/timeline-image-mask-raster-source-v1.ts';
import { readRepairFrameProjectScalarNativeV1 } from './lightscaper-repair-frame-current-reference.ts';

export { readRepairFrameProjectNativeV1, readRepairFrameProjectScalarNativeV1,
	readRepairFramePhotoCustodyNativeV1 } from './lightscaper-repair-frame-current-reference.ts';

const REF_FIELDS = ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;

/** Observe at most three known immutable Frame brush bodies, including bodies
 * superseded by a real source edit. The bounded key inventory also witnesses
 * that a local preview/Close installed nothing. This opens existing Frame
 * mediaAssets, never Photo analysis storage or an import/publication path. */
export async function readFramescaperBrushBodiesCurrentV1(projectId: string, value: unknown) {
	const references = readClosedDomainArray(value, 'Frame brush witness references', 0, 3).map(admitReference);
	check(new Set(references.map(reference => reference.storageKey)).size === references.length, 'Frame brush witness references must be distinct.');
	const before = await readRepairFrameProjectScalarNativeV1(projectId);
	const databaseName = editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName;
	check(before.databaseName === databaseName, 'Frame brush witness selected another native namespace.');
	const initial = await inventory(databaseName, references);
	const store = createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { indexedDB, locks: navigator.locks, syncWorkerClient: null });
	const loadMediaAsset = store.loadMediaAsset.bind(store), getMetadata = store.getMediaAssetMetadata.bind(store);
	const source = createFramescaperMaskRasterSourceTimelineImageV1({ loadMediaAsset });
	return joined(async () => {
		const bodies = [];
		for (const reference of references) {
			const metadata = await getMetadata(reference.storageKey), row = initial.records.get(reference.storageKey);
			check(metadata !== null && typeof metadata === 'object' && row !== undefined, 'Known Frame brush body metadata is missing.');
			check(metadata.size === reference.byteLength && metadata.sha256 === reference.sha256,
				'Frame brush public metadata differs from its complete identity.');
			check(row.sourceId === reference.storageKey && row.sha256 === reference.sha256 && row.size === reference.byteLength,
				'Frame brush native media row differs from its complete identity.');
			const bytes = await source.withBytes(reference, raw => Array.from(raw));
			check(bytes.length === reference.byteLength, 'Frame brush native reader returned another body size.');
			bodies.push({ reference, bytes, metadata, record: row });
		}
		const after = await readRepairFrameProjectScalarNativeV1(projectId), final = await inventory(databaseName, references);
		check(JSON.stringify(after) === JSON.stringify(before), 'Frame project/source changed during its bounded brush observation.');
		check(JSON.stringify(final.keys) === JSON.stringify(initial.keys), 'Frame native brush key inventory changed during observation.');
		for (const body of bodies) {
			check(JSON.stringify(final.records.get(body.reference.storageKey)) === JSON.stringify(body.record), 'Frame immutable brush content token changed during observation.');
			check(JSON.stringify(await getMetadata(body.reference.storageKey)) === JSON.stringify(body.metadata), 'Frame public brush metadata changed during observation.');
		}
		return { projectId, databaseName, keys: initial.keys, bodies };
	}, [() => source.close(), () => store.close()]);
}

function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	const input = record(value, 'Frame brush witness reference', REF_FIELDS);
	const reference = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'Frame brush witness reference'));
	for (const name of REF_FIELDS) check(field(input, name, 'Frame brush witness reference') === reference[name], 'Frame brush witness needs an exact complete reference.');
	check(reference.byteLength <= 4096, 'Frame brush witness body exceeds its bounded read.');
	return reference;
}
async function inventory(name: string, references: readonly Readonly<BrushMaskResourceReferenceV1>[]) {
	const database = await openExisting(name);
	try {
		return await transact(database, ['mediaAssets'], 'readonly', async stores => {
			const media = stores.mediaAssets; check(media !== undefined, 'Actual Frame mediaAssets store is missing.');
			const keys = await request(media.getAllKeys(IDBKeyRange.bound('brush-mask-v1:', 'brush-mask-v1:\uffff'), 4));
			check(keys.length <= 3 && keys.every(key => typeof key === 'string'), 'Frame brush fixture exceeds three native body keys.');
			const records = new Map<string, Record<string, unknown>>();
			for (const reference of references) {
				check(keys.includes(reference.storageKey), 'Known immutable Frame brush body is missing from native inventory.');
				const value: unknown = await request(media.get(reference.storageKey));
				check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Native Frame brush row is missing.');
				const row = value as Record<string, unknown>;
				check(typeof row.mediaContentToken === 'string' && row.mediaContentDigestVersion === 1, 'Frame brush body has no authenticated content token.');
				const scalar = { ...row };
				if (scalar.blob !== null && scalar.blob !== undefined) scalar.blob = {
					size: Number(Reflect.apply(SIZE, scalar.blob, [])), type: Reflect.apply(TYPE, scalar.blob, []) as string,
				};
				records.set(reference.storageKey, scalar);
			}
			return { keys: keys as string[], records };
		});
	} finally { database.close(); }
}
function openExisting(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(name);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
}
async function joined<Result>(work: () => Promise<Result>, cleanup: readonly (() => void | Promise<void>)[]): Promise<Result> {
	let outcome: { value: Result } | { error: unknown };
	try { outcome = { value: await work() }; } catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	for (const close of cleanup) try { await close(); } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, 'Frame brush observation and native retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('Frame brush observation has no scalar outcome.');
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
