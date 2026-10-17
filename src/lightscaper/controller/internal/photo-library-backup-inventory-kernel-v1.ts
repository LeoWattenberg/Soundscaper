/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogRepositoryV2 } from '../../catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../../catalog/photo-smart-collection-state-v1.ts';
import { normalizePhotoStackStateV1 } from '../../catalog/photo-stack-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../../catalog/repository-types.ts';
import { field, record } from '../../catalog/value-validation.ts';
import type { PhotoLibraryBackupSourcePortsV2, PhotoLibraryBackupSourceV2 } from '../photo-library-backup-source-v2.ts';
import { capturePhotoLibraryBackupStacksV1, type PhotoLibraryBackupStackPortsV1 } from '../photo-library-backup-stacks-v1.ts';

import type { PhotoCatalogRepositoryCurrentV1 } from '../../catalog/photo-catalog-repository-current-v1.ts';
import type { PhotoLibraryBackupSourcePortsCurrentV1 } from '../photo-library-backup-source-current-v1.ts';
type Profile = 'legacy2' | 'current3';
export interface PhotoLibraryBackupInventoryPortsV2 extends PhotoLibraryBackupSourcePortsV2 {
	readonly catalog: PhotoLibraryBackupSourcePortsV2['catalog'] & Pick<PhotoCatalogRepositoryV2, 'captureSmartCollectionArchiveV1'>;
	readonly stacks: PhotoLibraryBackupStackPortsV1;
}
export interface PhotoLibraryBackupInventoryPortsCurrentV1 extends PhotoLibraryBackupSourcePortsCurrentV1 {
	readonly catalog: PhotoLibraryBackupSourcePortsCurrentV1['catalog'] & Pick<PhotoCatalogRepositoryCurrentV1, 'captureSmartCollectionArchiveV1'>;
	readonly stacks: PhotoLibraryBackupStackPortsV1;
}
type PortsFor<Mode extends Profile> = Mode extends 'legacy2' ? PhotoLibraryBackupInventoryPortsV2 : PhotoLibraryBackupInventoryPortsCurrentV1;
type SourceScalars = Pick<PhotoLibraryBackupSourceV2, 'initial' | 'verifyCatalog'>;

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }

/** Capture every borrowed method and receiver before the first held point read.
 * Function metadata such as bind/name/length is never borrowed authority. */
export function borrowPhotoLibraryBackupInventoryPortsForProfileV1<Mode extends Profile>(profile: Mode, ports: PortsFor<Mode>): PortsFor<Mode> {
	assertProfile(profile);
	const catalog = ports.catalog, stacks = ports.stacks;
	const snapshot = catalog.readSnapshot, summaries = catalog.readSummaryPage, photo = catalog.loadPhoto,
		capture = catalog.captureSmartCollectionArchiveV1, state = stacks.readStackState, page = stacks.readStackPage,
		stack = stacks.loadStack, original = ports.loadOriginal;
	if ([snapshot, summaries, photo, capture, state, page, stack, original].some(method => typeof method !== 'function')) {
		throw new TypeError('Current backup requires complete catalog, stack, saved and original capabilities.');
	}
	return Object.freeze({ catalog: Object.freeze({
		readSnapshot: (...args: Parameters<typeof snapshot>) => Reflect.apply(snapshot, catalog, args),
		readSummaryPage: (...args: Parameters<typeof summaries>) => Reflect.apply(summaries, catalog, args),
		loadPhoto: (...args: Parameters<typeof photo>) => Reflect.apply(photo, catalog, args),
		captureSmartCollectionArchiveV1: (...args: Parameters<typeof capture>) => Reflect.apply(capture, catalog, args),
	}), stacks: Object.freeze({ readStackState: (...args: Parameters<typeof state>) => Reflect.apply(state, stacks, args),
		readStackPage: (...args: Parameters<typeof page>) => Reflect.apply(page, stacks, args),
		loadStack: (...args: Parameters<typeof stack>) => Reflect.apply(stack, stacks, args) }),
		loadOriginal: (...args: Parameters<typeof original>) => Reflect.apply(original, ports, args) }) as PortsFor<Mode>;
}

/** The metadata owner has already admitted its wire profile. Preserve the
 * existing one-shot saved inventory and complete stack/preset/catalog fences
 * for either legacy or mixed-resource sources, without a second body walk. */
export async function capturePhotoLibraryBackupInventorySourceForProfileV1<Mode extends Profile, Source extends SourceScalars>(profile: Mode, catalogId: string,
	borrowed: PortsFor<Mode>, source: Source, signal?: AbortSignal) {
	assertProfile(profile);
	const capture = await borrowed.catalog.captureSmartCollectionArchiveV1(catalogId, { signal }); check(signal);
	const context = record(capture.context, 'saved backup context', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state']);
	if (field(context, 'schemaVersion') !== 1 || field(context, 'kind') !== 'photo-smart-collection-archive-context'
		|| field(context, 'catalogId') !== catalogId || field(context, 'catalogRevision') !== source.initial.catalog.revision
		|| field(context, 'indexRevision') !== source.initial.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
	const rawState = field(context, 'state'), state = rawState === null ? null : normalizePhotoSmartCollectionsStateV1(rawState);
	if (state !== null && state.catalogId !== catalogId) throw new TypeError('Saved backup state belongs to another catalog.');
	const verifySaved = capture.verify, verifyCatalog = source.verifyCatalog;
	if (typeof verifySaved !== 'function') throw new TypeError('Saved backup requires final inventory verification.');
	const stackPort = borrowed.stacks, readStackState = stackPort.readStackState;
	const capturedStack = normalizePhotoStackStateV1(await Reflect.apply(readStackState, stackPort, [catalogId, { signal }])); check(signal);
	let initialStateLent = false;
	const stacks = await capturePhotoLibraryBackupStacksV1(source.initial, {
		async readStackState(...args) { if (!initialStateLent) { initialStateLent = true; return capturedStack; } return Reflect.apply(readStackState, stackPort, args); },
		readStackPage: stackPort.readStackPage, loadStack: stackPort.loadStack,
	}, verifyCatalog, signal);
	return Object.freeze({ source, stacks, state, definitions: capture.definitions,
		async verify(verifyCompanion?: () => Promise<void>) {
			await verifyCatalog(); await Reflect.apply(verifySaved, capture, []); await verifyCompanion?.();
			const finalStack = normalizePhotoStackStateV1(await Reflect.apply(readStackState, stackPort, [catalogId, { signal }])); check(signal);
			if (JSON.stringify(finalStack) !== JSON.stringify(capturedStack)) throw new PhotoCatalogRevisionConflictError('catalog');
			await verifyCatalog();
		} });
}

function assertProfile(profile: unknown): asserts profile is Profile {
	if (profile !== 'legacy2' && profile !== 'current3') throw new RangeError('Unsupported fixed backup inventory profile.');
}
