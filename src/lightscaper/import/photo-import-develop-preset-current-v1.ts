/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV3 } from '../../common/editor/photo-library-develop-presets-port-v3.ts';
import { mergeImageDevelopSelectedSettingsV3 } from '../../common/editor/imaging/image-develop-settings-selected-v3.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { createPhotoDevelopWorkspaceCurrentV1, commitPhotoDevelopWorkspaceCurrentV1 } from '../catalog/photo-develop-workspace-current-v1.ts';
import { borrowPhotoDevelopPresetEntryReaderV2, readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { preparePhotoDevelopPresetBatchCurrentV1 } from '../storage/photo-develop-presets-current-v1.ts';
import type { PhotoDevelopPresetReadPortV1 } from '../storage/photo-develop-presets-v1.ts';
import type { PhotoResourceVerificationHostCurrentV1 } from '../storage/photo-media-resource-verification-current-v1.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
type Apply = (photo: unknown) => Promise<PhotoDocumentCurrentV1>;

/** The selected native row supplies the recipe. All retained row resources are
 * authenticated before Original preparation; every unpublished target rechecks
 * that exact row without acquiring another writer or settings issuer. */
export function borrowPhotoImportDevelopPresetCurrentV1(repository: PhotoDevelopPresetReadPortV1 | undefined,
	choice: PhotoLibraryDevelopPresetReadV3, resources?: PhotoResourceVerificationHostCurrentV1): (catalogId: string, signal: AbortSignal) => Promise<Apply> {
	const input = record(choice, 'Current import Develop preset', ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
	if (field(input, 'schemaVersion') !== 3) throw new RangeError('Unsupported Current import Develop preset version.');
	const selected = Object.freeze({ catalogId: id(field(input, 'catalogId'), 'preset catalog ID'),
		presetId: id(field(input, 'presetId'), 'preset ID'), expectedRevision: integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'preset revision') });
	if (!repository) throw new TypeError('Current Develop preset import requires its selected settings capability.');
	const reader = Object.freeze({ readEntry: borrowPhotoDevelopPresetEntryReaderV2(repository) });
	const verification = captureResources(resources);
	return async (catalogId, signal) => {
		Reflect.apply(CHECK, signal, []); readPhotoDevelopSignalOptionsV2({ signal });
		if (catalogId !== selected.catalogId) throw new RangeError('Import Develop preset belongs to another catalog.');
		const binding = await preparePhotoDevelopPresetBatchCurrentV1(reader, catalogId, selected.presetId, selected.expectedRevision,
			{ signal, ...(verification === undefined ? {} : { resources: verification }) });
		Reflect.apply(CHECK, signal, []);
		return async value => {
			Reflect.apply(CHECK, signal, []);
			const photo = normalizePhotoDocumentCurrentV1(value);
			if (photo.catalogId !== catalogId || photo.revision !== 0) throw new RangeError('Import presets require an unpublished photo in the current catalog.');
			await binding.recheck(); Reflect.apply(CHECK, signal, []);
			let successor = photo.schemaVersion;
			const versions = photo.versions.map(version => {
				if (version.id !== photo.activeVersionId) return version;
				const develop = mergeImageDevelopSelectedSettingsV3({ schemaVersion: 3, target: version.develop, settings: binding.preset.settings });
				const workspace = commitPhotoDevelopWorkspaceCurrentV1(version.workspace
					?? createPhotoDevelopWorkspaceCurrentV1(version.develop, { label: 'Imported', createdAt: version.createdAt }),
				develop, { label: binding.preset.identity.name, createdAt: version.createdAt });
				if (develop.processVersion === 3 || workspace.schemaVersion === 3) successor = 3;
				else if (successor === 1 && (develop.processVersion === 2 || workspace.schemaVersion === 2)) successor = 2;
				return { ...version, develop, workspace };
			});
			const result = normalizePhotoDocumentCurrentV1({ ...photo, schemaVersion: successor, versions });
			Reflect.apply(CHECK, signal, []); return result;
		};
	};
}

function captureResources(value: PhotoResourceVerificationHostCurrentV1 | undefined): PhotoResourceVerificationHostCurrentV1 | undefined {
	if (value === undefined) return undefined;
	const input = record(value, 'Current import preset resource factories', ['cubeLutResources', 'maskRasterResources']);
	const luts = field(input, 'cubeLutResources'), brushes = field(input, 'maskRasterResources');
	if (typeof luts !== 'function' || typeof brushes !== 'function') throw new TypeError('Current import preset resources require callable factories.');
	return Object.freeze({ cubeLutResources: () => Reflect.apply(luts, value, []) as ReturnType<PhotoResourceVerificationHostCurrentV1['cubeLutResources']>,
		maskRasterResources: () => Reflect.apply(brushes, value, []) as ReturnType<PhotoResourceVerificationHostCurrentV1['maskRasterResources']> });
}
