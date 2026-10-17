/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoManagedImportPortsCurrentV1 } from './managed-import-ports-current-v1.ts';
import type { PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import type { PhotoManagedImportPortsV1 } from './managed-import-ports-v1.ts';
import { withPhotoCatalogWriteLockV1 } from './catalog-write-lock-v1.ts';
export type { PhotoManagedImportReceiptV1, PhotoManagedImportOptionsV1 } from './managed-import-ports-v1.ts';

/** Current admission uses complete Photo1/2 documents; persisted intent,
 * original custody, scalar receipts and writer authority remain V1. */
export interface PhotoManagedImportPortsV2 extends Omit<PhotoManagedImportPortsV1, 'catalog'> {
	readonly catalog: Pick<PhotoCatalogRepositoryV2, 'loadCatalog' | 'loadPhoto' | 'publishPhotos'>;
	/** Mandatory for every nonnull reachable resource, including disabled,
	 * inactive, redo and snapshot references. The host binds selected media. */
	readonly verifyResources?: (photo: PhotoDocumentV1 | PhotoDocumentV2, signal?: AbortSignal) => Promise<void>;
}

/** Pin every capability and its original receiver before any owning await.
 * Function proxies are callable without reading bind/name/length metadata. */
export function capturePhotoManagedImportPortsV2(ports: PhotoManagedImportPortsV2): Readonly<PhotoManagedImportPortsV2> {
	return capturePhotoManagedImportPortsForProfileV1(ports);
}

/** Fixed frontdoors share capability capture only, never document admission. */
export function capturePhotoManagedImportPortsForProfileV1<Ports extends PhotoManagedImportPortsV2 | PhotoManagedImportPortsCurrentV1>(ports: Ports): Readonly<Ports> {
	const catalog = ports.catalog, media = ports.media, custody = media.custody, journal = ports.journal;
	const verify = ports.verifyResources, exclusive = ports.exclusive, allocate = ports.createImportId;
	const cryptoOwner = globalThis.crypto, uuid = cryptoOwner.randomUUID;
	return Object.freeze({
		catalog: Object.freeze({ loadCatalog: pin(catalog.loadCatalog, catalog), loadPhoto: pin(catalog.loadPhoto, catalog),
			publishPhotos: pin(catalog.publishPhotos, catalog) }),
		media: Object.freeze({ writeAsset: pin(media.writeAsset, media), custody: Object.freeze({
			findDigestPage: pin(custody.findDigestPage, custody), stage: pin(custody.stage, custody),
			readPage: pin(custody.readPage, custody), promote: pin(custody.promote, custody), releaseStaged: pin(custody.releaseStaged, custody),
		}) }),
		journal: Object.freeze({ get: pin(journal.get, journal), putIfAbsent: pin(journal.putIfAbsent, journal), deleteIfCurrent: pin(journal.deleteIfCurrent, journal) }),
		...(verify === undefined ? {} : { verifyResources: pin(verify, ports) }),
		exclusive: exclusive === undefined ? withPhotoCatalogWriteLockV1 : pin(exclusive, ports),
		createImportId: allocate === undefined ? () => `import-${Reflect.apply(uuid, cryptoOwner, []) as string}` : pin(allocate, ports),
	}) as unknown as Readonly<Ports>;
}

function pin<Method extends (...args: never[]) => unknown>(value: Method, receiver: unknown): Method {
	if (typeof value !== 'function') throw new TypeError('Current managed import requires callable ownership capabilities.');
	return ((...args: unknown[]) => Reflect.apply(value, receiver, args)) as unknown as Method;
}
