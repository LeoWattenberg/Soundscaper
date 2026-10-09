/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopImportPortV2, PhotoLibraryDevelopImportRequestV2 } from '../../common/editor/photo-library-develop-import-port-v2.ts';
import type { PhotoLibraryImportItemV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { readPhotoDevelopPresetsV2 } from '../storage/photo-develop-presets-v2.ts';
import { borrowPhotoImportDevelopPresetReaderV2 } from '../import/photo-import-develop-preset-v2.ts';
import type { PhotoDevelopPresetReadPortV1 } from '../storage/photo-develop-presets-v1.ts';
import { admitPhotoLibraryDevelopImportRequestV2 } from './photo-library-develop-import-request-v2.ts';

interface Host {
	readonly settings: PhotoDevelopPresetReadPortV1 | undefined;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly importFiles: (files: readonly File[], request: PhotoLibraryDevelopImportRequestV2) => Promise<readonly PhotoLibraryImportItemV1[]>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
export function createPhotoLibraryDevelopImportSessionV2(host: Host): Readonly<PhotoLibraryDevelopImportPortV2> {
	const settings = host.settings, ready = host.ready, operation = host.operation, importFiles = host.importFiles;
	return Object.freeze<PhotoLibraryDevelopImportPortV2>({ schemaVersion: 2,
		async listPresets(options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options), reader = borrowPhotoImportDevelopPresetReaderV2(settings);
			return Reflect.apply(operation, host, [async (admitted: AbortSignal) => {
				const catalogId = await Reflect.apply(ready, host, []) as string; Reflect.apply(CHECK, admitted, []);
				return readPhotoDevelopPresetsV2(reader, catalogId, { signal: admitted });
			}, signal]);
		},
		importFiles: (files, request) => Reflect.apply(importFiles, host, [files, admitPhotoLibraryDevelopImportRequestV2(request)]),
	});
}
