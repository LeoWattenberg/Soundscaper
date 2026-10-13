/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryCollectionHandoffPortV1 } from '../../../common/editor/photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV2 } from '../../../common/editor/photo-library-collection-handoff-port-v2.ts';
import type { PhotoFramescaperCollectionHandoffDownloadRequest, PhotoFramescaperCollectionHandoffTarget,
 BuildPhotoFramescaperCollectionHandoffArchive } from '../photo-framescaper-handoff-download.ts';
import type { PhotoFramescaperCollectionHandoffDownloadRequestCurrentV1 } from '../photo-framescaper-collection-handoff-download-current-v1.ts';
import { id, integer, oneOf } from '../../catalog/value-validation.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';

type RequestFor<Profile> = Profile extends 'current2' ? PhotoFramescaperCollectionHandoffDownloadRequestCurrentV1 : PhotoFramescaperCollectionHandoffDownloadRequest;
export function readPhotoFramescaperCollectionDownloadRequestForProfileV1<Profile extends 'legacy1' | 'current2'>(profile: Profile, value: unknown): RequestFor<Profile> {
	if (profile !== 'legacy1' && profile !== 'current2') throw new TypeError('Unsupported collection delivery profile.');
	const name = 'Editable collection copy request', source = record(value, name, ['target', 'fileName', 'fileTypeDescription', 'signal', 'buildArchive', 'prepareSave', 'saveFile'], ['target', 'fileName', 'fileTypeDescription', 'buildArchive', 'prepareSave', 'saveFile']);
	const targetValue = field(source, 'target', name), target = record(targetValue, name, profile === 'current2' ? ['schemaVersion', 'binding', 'capture', 'checkCurrent'] : ['binding', 'capture', 'checkCurrent']);
	if (profile === 'current2' && field(target, 'schemaVersion', name) !== 2) throw new TypeError('Current collection delivery requires its schema 2 target.');
	const input = record(field(target, 'binding', name), name, ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision', 'expectedDefinitionRevision'], ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision']);
	const scope = oneOf(field(input, 'scope', name), ['catalog', 'saved-query'] as const, 'collection scope');
	if (Object.hasOwn(input, 'expectedDefinitionRevision') !== (scope === 'saved-query')) throw new TypeError('Editable collection definition revision must match its scope.');
	const binding = Object.freeze({ catalogId: id(field(input, 'catalogId', name), 'collection catalog ID'), collectionId: id(field(input, 'collectionId', name), 'collection ID'), scope,
		expectedCatalogRevision: integer(field(input, 'expectedCatalogRevision', name), 0, Number.MAX_SAFE_INTEGER, 'collection revision'),
		...(scope === 'saved-query' ? { expectedDefinitionRevision: integer(field(input, 'expectedDefinitionRevision', name), 0, Number.MAX_SAFE_INTEGER, 'collection definition revision') } : {}) });
	const captureValue = field(target, 'capture', name), capture = record(captureValue, name, ['withCapture']);
	const options = readPhotoDevelopSignalOptionsV2(Object.hasOwn(source, 'signal') ? { signal: field(source, 'signal', name) } : {});
	return Object.freeze({ fileName: text(field(source, 'fileName', name)), fileTypeDescription: text(field(source, 'fileTypeDescription', name)), ...options,
		target: Object.freeze({ ...(profile === 'current2' ? { schemaVersion: 2 as const } : {}), binding, capture: Object.freeze({ withCapture: pin<PhotoLibraryCollectionHandoffPortV1['withCapture'] | PhotoLibraryCollectionHandoffPortV2['withCapture']>(field(capture, 'withCapture', name), captureValue) }),
			checkCurrent: pin<PhotoFramescaperCollectionHandoffTarget['checkCurrent']>(field(target, 'checkCurrent', name), targetValue) }),
		buildArchive: pin<BuildPhotoFramescaperCollectionHandoffArchive>(field(source, 'buildArchive', name), value),
		prepareSave: pin<PhotoFramescaperCollectionHandoffDownloadRequest['prepareSave']>(field(source, 'prepareSave', name), value),
		saveFile: pin<PhotoFramescaperCollectionHandoffDownloadRequest['saveFile']>(field(source, 'saveFile', name), value) }) as RequestFor<Profile>;
}

function text(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new TypeError('Editable photo copy requires bounded text.'); return value; }
function pin<Method>(value: unknown, receiver: unknown): Method { if (typeof value !== 'function') throw new TypeError('Editable photo copy capability is unavailable.'); return ((...args: unknown[]) => Reflect.apply(value, receiver, args) as unknown) as Method; }
