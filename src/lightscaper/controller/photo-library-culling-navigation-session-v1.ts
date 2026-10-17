/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCullingNavigationPortV1 } from '../../common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import { admitPhotoCullingNavigationV1 } from '../catalog/photo-culling-navigation-v1.ts';

interface Host {
	readonly repository: Pick<PhotoCatalogRepositoryV2, 'readCullingDestinationPage'>;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Entire native destination read joins the existing selected Session lifetime. */
export function createPhotoLibraryCullingNavigationSessionV1(host: Host): Readonly<PhotoLibraryCullingNavigationPortV1> {
	const repository = host.repository, read = repository.readCullingDestinationPage;
	if (typeof read !== 'function') throw new TypeError('Culling navigation requires its indexed repository reader.');
	return Object.freeze<PhotoLibraryCullingNavigationPortV1>({ readDestinationPage(context, options) {
		const request = admitPhotoCullingNavigationV1(context, options);
		return host.operation(async signal => {
			const catalogId = await host.ready(); Reflect.apply(CHECK, signal, []);
			const result = await Reflect.apply(read, repository, [catalogId, request.context, { photoId: request.photoId, signal }]);
			Reflect.apply(CHECK, signal, []); return result;
		}, request.signal);
	} });
}
