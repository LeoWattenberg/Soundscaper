/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryImageHandoffPortV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibraryImageHandoffPortV2 } from '../../common/editor/photo-library-image-handoff-port-v2.ts';
import type { PhotoFramescaperHandoffDownloadRequest, PhotoFramescaperHandoffTarget, BuildPhotoFramescaperHandoffArchive } from './photo-framescaper-handoff-download.ts';
import type { PhotoFramescaperHandoffDownloadRequestCurrentV1 } from './photo-framescaper-handoff-download-current-v1.ts';

type Profile = 'legacy1' | 'current2';
type RequestFor<Policy extends Profile> = Policy extends 'legacy1' ? PhotoFramescaperHandoffDownloadRequest : PhotoFramescaperHandoffDownloadRequestCurrentV1;
const CHECK = AbortSignal.prototype.throwIfAborted;
function text(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new TypeError('Editable photo copy requires bounded text.'); return value; }
function pin<Method>(value: unknown, receiver: unknown): Method {
	if (typeof value !== 'function') throw new TypeError('Editable photo copy capability is unavailable.');
	return ((...args: unknown[]) => Reflect.apply(value, receiver, args) as unknown) as Method;
}

/** Fixed capture profiles share scalar and receiver admission; they never
 * reinterpret the delivered editable source or manufacture body authority. */
export function readPhotoFramescaperHandoffDownloadRequestForProfileV1<Policy extends Profile>(profile: Policy, value: unknown): RequestFor<Policy> {
	if (profile !== 'legacy1' && profile !== 'current2') throw new TypeError('Unknown editable photo copy profile.');
	const name = 'Editable photo copy request', source = record(value, name, ['target', 'fileName', 'fileTypeDescription', 'signal', 'buildArchive', 'prepareSave', 'saveFile'], ['target', 'fileName', 'fileTypeDescription', 'buildArchive', 'prepareSave', 'saveFile']);
	const targetValue = field(source, 'target', name), target = record(targetValue, name, profile === 'legacy1' ? ['binding', 'capture', 'checkCurrent'] : ['schemaVersion', 'binding', 'capture', 'checkCurrent']);
	if (profile === 'current2' && field(target, 'schemaVersion', name) !== 2) throw new TypeError('Current editable copy requires its selected capture profile.');
	const input = record(field(target, 'binding', name), name, ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
	const id = (key: string) => { const result = text(field(input, key, name)); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) throw new TypeError('Editable photo copy requires a stable identity.'); return result; };
	const revision = field(input, 'expectedRevision', name);
	if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new TypeError('Editable photo copy requires a saved revision.');
	const captureValue = field(target, 'capture', name), capture = record(captureValue, name, ['withCapture']);
	const signal = Object.hasOwn(source, 'signal') ? field(source, 'signal', name) : undefined;
	if (signal !== undefined) { if (!(signal instanceof AbortSignal)) throw new TypeError('Editable photo copy requires a native signal.'); Reflect.apply(CHECK, signal, []); }
	const result = Object.freeze({ fileName: text(field(source, 'fileName', name)), fileTypeDescription: text(field(source, 'fileTypeDescription', name)), signal: signal as AbortSignal | undefined,
		target: Object.freeze({ ...(profile === 'current2' ? { schemaVersion: 2 as const } : {}),
			binding: Object.freeze({ catalogId: id('catalogId'), photoId: id('photoId'), versionId: id('versionId'), expectedRevision: revision as number }),
			capture: Object.freeze({ withCapture: pin<PhotoLibraryImageHandoffPortV1['withCapture'] | PhotoLibraryImageHandoffPortV2['withCapture']>(field(capture, 'withCapture', name), captureValue) }),
			checkCurrent: pin<PhotoFramescaperHandoffTarget['checkCurrent']>(field(target, 'checkCurrent', name), targetValue) }),
		buildArchive: pin<BuildPhotoFramescaperHandoffArchive | PhotoFramescaperHandoffDownloadRequestCurrentV1['buildArchive']>(field(source, 'buildArchive', name), value),
		prepareSave: pin<PhotoFramescaperHandoffDownloadRequest['prepareSave']>(field(source, 'prepareSave', name), value),
		saveFile: pin<PhotoFramescaperHandoffDownloadRequest['saveFile']>(field(source, 'saveFile', name), value) });
	// The fixed profile above pairs the captured consumer and builder protocols.
	return result as RequestFor<Policy>;
}
