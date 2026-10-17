/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffPortV2 } from '../../common/editor/photo-library-image-handoff-port-v2.ts';
import type { PhotoLibraryImageHandoffRequestV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../import/managed-import-ports-current-v1.ts';
import { createPhotoLibraryImageReceiveSessionCurrentV1 } from './photo-library-image-receive-session-current-v1.ts';
import { createPhotoLibrarySessionCollectionChildCurrentV1 } from './photo-library-session-collection-child-current-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';

interface Host {
	readonly ports: PhotoLibrarySessionPortsCurrentV1;
	readonly managed: PhotoManagedImportPortsCurrentV1;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, admit?: () => void) => Promise<Result>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly resetReady: () => void;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** These children borrow the parent's actual operation/mutation lifetime and
 * Current native ports. They create no independent queue or publication owner. */
export function createPhotoLibrarySessionImageChildrenCurrentV1(host: Host) {
	const { ports, managed } = host;
	const ready = host.ready.bind(host), operation = host.operation.bind(host), mutate = host.mutate.bind(host), resetReady = host.resetReady.bind(host);
	const imageHandoffCurrent = Object.freeze<PhotoLibraryImageHandoffPortV2>({ withCapture(value, consume, options = {}) {
		const { signal } = readPhotoDevelopSignalOptionsV2(options);
		let binding!: Readonly<PhotoLibraryImageHandoffRequestV1>;
		return operation(async admitted => {
			const { withPhotoLibraryImageHandoffCurrentV1 } = await import('./photo-library-image-handoff-session-current-v1.ts');
			check(admitted); const catalogId = await ready(); check(admitted);
			return withPhotoLibraryImageHandoffCurrentV1(ports, catalogId, binding, consume, admitted);
		}, signal, () => {
			if (typeof consume !== 'function') throw new TypeError('Current image handoff requires a callable consumer.');
			const request = record(value, 'Current image handoff request', ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
			binding = Object.freeze({ catalogId: id(field(request, 'catalogId'), 'handoff catalog ID'), photoId: id(field(request, 'photoId'), 'handoff photo ID'),
				versionId: id(field(request, 'versionId'), 'handoff version ID'), expectedRevision: integer(field(request, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'handoff revision') });
		});
	} });
	const imageReceiveCurrent = createPhotoLibraryImageReceiveSessionCurrentV1({ ports, managed, mutate, resetReady });
	const collectionHandoffCurrent = createPhotoLibrarySessionCollectionChildCurrentV1(host);
	return Object.freeze({ imageHandoffCurrent, imageReceiveCurrent, collectionHandoffCurrent });
}
