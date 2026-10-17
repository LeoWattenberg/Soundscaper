/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffPortV2, PhotoLibraryCollectionHandoffRequestV2 } from '../../common/editor/photo-library-collection-handoff-port-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { record, field, id, integer, oneOf } from '../catalog/value-validation.ts';

interface Host {
	readonly ports: PhotoLibrarySessionPortsCurrentV1;
	ready(): Promise<string>;
	operation<Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, admit?: () => void): Promise<Result>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** The Current collection borrows the parent's actual operation and ports;
 * it owns no independent queue, writer lease or native connection. */
export function createPhotoLibrarySessionCollectionChildCurrentV1(host: Host): Readonly<PhotoLibraryCollectionHandoffPortV2> {
	const { ports } = host, ready = host.ready.bind(host), operation = host.operation.bind(host);
	return Object.freeze<PhotoLibraryCollectionHandoffPortV2>({ async withCapture(value, consume, options = {}) {
		const { signal } = readPhotoDevelopSignalOptionsV2(options); let binding!: Readonly<PhotoLibraryCollectionHandoffRequestV2>;
		return operation(async admitted => {
			const { withPhotoLibraryCollectionHandoffCurrentV1 } = await import('./photo-library-collection-handoff-session-current-v1.ts');
			check(admitted); const catalogId = await ready(); check(admitted);
			return withPhotoLibraryCollectionHandoffCurrentV1(ports, catalogId, binding, consume, admitted);
		}, signal, () => {
			if (typeof consume !== 'function') throw new TypeError('Current collection handoff requires a callable consumer.');
			const request = record(value, 'collection handoff request', ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision', 'expectedDefinitionRevision'], ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision']);
			const scope = oneOf(field(request, 'scope'), ['catalog', 'saved-query'] as const, 'collection scope');
			if (scope === 'catalog' && Object.hasOwn(request, 'expectedDefinitionRevision')) throw new TypeError('Root collection uses its catalog revision.');
			binding = Object.freeze({ catalogId: id(field(request, 'catalogId'), 'collection catalog ID'), collectionId: id(field(request, 'collectionId'), 'collection ID'), scope,
				expectedCatalogRevision: integer(field(request, 'expectedCatalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'collection catalog revision'),
				...(scope === 'saved-query' ? { expectedDefinitionRevision: integer(field(request, 'expectedDefinitionRevision'), 0, Number.MAX_SAFE_INTEGER, 'collection definition revision') } : {}) });
		});
	} });
}
