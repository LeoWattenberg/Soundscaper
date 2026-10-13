/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopImportPortCurrentV1, PhotoLibraryDevelopImportRequestCurrentV1 } from '../../common/editor/photo-library-develop-import-port-current-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoDevelopPresetReadPortV1 } from '../storage/photo-develop-presets-v1.ts';
import { readPhotoDevelopPresetsCurrentV1 } from '../storage/photo-develop-presets-current-v1.ts';
import { readPhotoDevelopSignalOptionsV2, borrowPhotoDevelopPresetEntryReaderV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { admitPhotoLibraryDevelopImportRequestCurrentV1, admitPhotoLibraryDevelopImportFilesCurrentV1 } from './photo-library-develop-import-request-current-v1.ts';

interface Host {
	readonly settings: PhotoDevelopPresetReadPortV1 | undefined;
	ready(): Promise<string>;
	operation<Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result>;
	importFiles(files: readonly File[], request: PhotoLibraryDevelopImportRequestCurrentV1): Promise<readonly PhotoLibraryImportItemV1[]>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;

/** These methods borrow the actual Session operation and import lifetime. */
export function createPhotoLibraryDevelopImportSessionCurrentV1(host: Host): Readonly<PhotoLibraryDevelopImportPortCurrentV1> {
	const settings = host.settings, ready = host.ready.bind(host), operation = host.operation.bind(host), importFiles = host.importFiles.bind(host);
	return Object.freeze<PhotoLibraryDevelopImportPortCurrentV1>({ schemaVersion: 3,
		async listPresets(options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			if (!settings) throw new TypeError('Current Develop preset import requires its selected settings capability.');
			const reader = Object.freeze({ readEntry: borrowPhotoDevelopPresetEntryReaderV2(settings) });
			return operation(async admitted => {
				Reflect.apply(CHECK, admitted, []); const catalogId = await ready(); Reflect.apply(CHECK, admitted, []);
				return readPhotoDevelopPresetsCurrentV1(reader, catalogId, { signal: admitted });
			}, signal);
		},
		async importFiles(files, value) {
			const request = admitPhotoLibraryDevelopImportRequestCurrentV1(value), selected = admitPhotoLibraryDevelopImportFilesCurrentV1(files);
			return importFiles(selected, request);
		},
	});
}
