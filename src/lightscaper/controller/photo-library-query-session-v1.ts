/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';
import { admitPhotoLibraryQueryBuildRequestV1, admitPhotoLibraryQueryStepRequestV1,
	readPhotoLibraryQueryStepV1, rebuildPhotoLibraryQueryStepV1 } from './photo-library-query-v1.ts';
import { admitPhotoLibraryQueryStepRequestV2, admitPhotoLibraryQueryBuildRequestV2,
	readPhotoLibraryQueryStepV2, rebuildPhotoLibraryQueryStepV2 } from './photo-library-query-v2.ts';
import { admitPhotoLibraryStackQueryStepV1, readPhotoLibraryStackQueryStepV1 } from './photo-library-stack-query-v1.ts';
import { admitPhotoLibraryStackQueryStepV2, readPhotoLibraryStackQueryStepV2 } from './photo-library-stack-query-v2.ts';
import { withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';

export interface PhotoLibraryQuerySessionHostV1 {
	readonly repositories: Pick<PhotoLibrarySessionPortsV1, 'catalog' | 'stacks'>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly ready: () => Promise<string>;
}
type QuerySession = Pick<PhotoLibrarySessionPortV1, 'readQueryStep' | 'readQueryStepV2' | 'rebuildQueryStep'
	| 'rebuildQueryStepV2' | 'readStackQueryStep' | 'readStackQueryStepV2'>;

/** Borrows Session admission, readiness and settlement; allocates no resource or lifetime owner. */
export function createPhotoLibraryQuerySessionV1(host: PhotoLibraryQuerySessionHostV1): Readonly<QuerySession> {
	const facade: QuerySession = {
		readQueryStep(options) {
			const request = admitPhotoLibraryQueryStepRequestV1(options);
			return host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return readPhotoLibraryQueryStepV1(host.repositories.catalog, catalogId, { ...request, signal });
			}, request.signal);
		},
		readQueryStepV2(options) {
			const request = admitPhotoLibraryQueryStepRequestV2(options), repository = host.repositories.catalog, read = repository.readQueryPageV2;
			if (!read) throw new Error('Metadata photo queries are unavailable.');
			return withPhotoStackQuerySignalV1(request.signal, privateSignal => host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return readPhotoLibraryQueryStepV2({ readQueryPageV2: read.bind(repository) }, catalogId, { ...request, signal });
			}, privateSignal));
		},
		rebuildQueryStepV2(options = {}) {
			const request = admitPhotoLibraryQueryBuildRequestV2(options), repository = host.repositories.catalog, rebuild = repository.rebuildQueryIndexPageV2;
			if (!rebuild) throw new Error('Metadata query rebuilding is unavailable.');
			return withPhotoStackQuerySignalV1(request.signal, privateSignal => host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return rebuildPhotoLibraryQueryStepV2({ rebuildQueryIndexPageV2: rebuild.bind(repository) }, catalogId, { signal });
			}, privateSignal));
		},
		readStackQueryStep(options) {
			const request = admitPhotoLibraryStackQueryStepV1(options), stacks = host.repositories.stacks;
			if (!stacks) throw new Error('Collapsed photo stacks are unavailable.');
			return host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return readPhotoLibraryStackQueryStepV1(stacks, catalogId, { ...request, signal });
			}, request.signal);
		},
		readStackQueryStepV2(options) {
			const request = admitPhotoLibraryStackQueryStepV2(options), repository = host.repositories.stacks, read = repository?.readStackQueryPageV2;
			if (!repository || !read) throw new Error('Collapsed metadata photo queries are unavailable.');
			return withPhotoStackQuerySignalV1(request.signal, privateSignal => host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return readPhotoLibraryStackQueryStepV2({ readStackQueryPageV2: read.bind(repository) }, catalogId, { ...request, signal });
			}, privateSignal));
		},
		rebuildQueryStep(options = {}) {
			const request = admitPhotoLibraryQueryBuildRequestV1(options);
			return host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return rebuildPhotoLibraryQueryStepV1(host.repositories.catalog, catalogId, { signal });
			}, request.signal);
		},
	};
	return Object.freeze(facade);
}
