/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopImportPortV1, PhotoLibraryDevelopImportRequestV1 } from '../../common/editor/photo-library-develop-import-port-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { borrowPhotoImportDevelopPresetReaderV1 } from '../import/photo-import-develop-preset-v1.ts';
import { readPhotoDevelopPresetsV1, type PhotoDevelopPresetReadPortV1 } from '../storage/photo-develop-presets-v1.ts';
import { admitPhotoLibraryDevelopImportRequestV1 } from './photo-library-develop-import-request-v1.ts';

interface Host {
	readonly settings: PhotoDevelopPresetReadPortV1 | undefined;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly importFiles: (files: readonly File[], request: PhotoLibraryDevelopImportRequestV1) => Promise<readonly PhotoLibraryImportItemV1[]>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Empty-library menus borrow the current catalog; callers never guess its identity. */
export function createPhotoLibraryDevelopImportSessionV1(host: Host): Readonly<PhotoLibraryDevelopImportPortV1> {
	return Object.freeze({
		async listPresets(options = {}) {
			const { signal } = readPhotoStackSignalOptionsV1(options), reader = borrowPhotoImportDevelopPresetReaderV1(host.settings);
			return host.operation(async admitted => {
				const catalogId = await host.ready(); Reflect.apply(CHECK, admitted, []);
				return readPhotoDevelopPresetsV1(reader, catalogId, { signal: admitted });
			}, signal);
		},
		async importFiles(files, request) { return host.importFiles(files, admitPhotoLibraryDevelopImportRequestV1(request)); },
	} satisfies PhotoLibraryDevelopImportPortV1);
}
