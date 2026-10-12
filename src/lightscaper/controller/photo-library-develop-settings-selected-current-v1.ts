/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryDevelopCopySelectedV3 } from '../../common/editor/photo-library-develop-settings-port-v3.ts';
import type { ImageDevelopSettingsPacketV3 } from '../../common/editor/imaging/image-develop-settings-contract-v3.ts';
import type { ImageDevelopSettingsPacketCurrentV1 } from '../../common/editor/imaging/image-develop-settings-current-v1.ts';
import { normalizeImageDevelopSettingsPacketCurrentV1 } from '../../common/editor/imaging/image-develop-settings-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import { assertPhotoDevelopSelectedMaskInputsCurrentV1 as assertBrushInputs } from './internal/photo-develop-selected-mask-inputs-current-v1.ts';
import { normalizeImageDevelopSelectionV3, mergeImageDevelopSettingsV3 } from '../../common/editor/imaging/image-develop-settings-v3.ts';
import { copyImageDevelopSelectedSettingsV3, mergeImageDevelopSelectedSettingsV3 } from '../../common/editor/imaging/image-develop-settings-selected-v3.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { id, integer } from '../catalog/value-validation.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';

export interface PhotoDevelopSelectedSettingsHostCurrentV1 {
	readonly repository: { loadPhoto(catalogId: string, photoId: string): Promise<PhotoDocumentCurrentV1 | null> };
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly verifyPhotoResources: (photo: PhotoDocumentCurrentV1, signal: AbortSignal) => Promise<void>;
	readonly verifyDevelopResources: (develop: unknown, signal: AbortSignal) => Promise<void>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** One selected child owns its issued identities. Inert declarations copied or
 * parsed elsewhere cannot grant brush paste, body access or installation. */
export function createPhotoDevelopSelectedSettingsCurrentV1(host: PhotoDevelopSelectedSettingsHostCurrentV1) {
	const repository = host.repository, load = repository.loadPhoto, initialize = host.ready, run = host.operation;
	const verifyPhoto = host.verifyPhotoResources, verifyDevelop = host.verifyDevelopResources;
	if ([load, initialize, run, verifyPhoto, verifyDevelop].some(fn => typeof fn !== 'function')) throw new TypeError('Selected settings require complete Current source verification.');
	const issued = new WeakMap<object, string>();
	return Object.freeze({ copySelected, admit, merge });

	function admit(value: unknown, catalogId?: string): ImageDevelopSettingsPacketCurrentV1 {
		const source = value !== null && typeof value === 'object' ? issued.get(value) : undefined;
		if (source !== undefined) {
			if (catalogId !== undefined && catalogId !== source) throw new RangeError('Selected settings belong to another catalog.');
			// Issued packets are deeply frozen owning-normalizer results. Preserve
			// their exact identity through admission instead of cloning proof away.
			return value as ImageDevelopSettingsPacketV3;
		}
		const packet = normalizeImageDevelopSettingsPacketCurrentV1(value);
		if (packet.develop.masks.some(mask => mask.inputs.length > 0)) throw new RangeError('Brush settings require this selected child’s authenticated packet.');
		return packet;
	}
	function merge(value: unknown) {
		const input = record(value, 'Current settings merge', ['schemaVersion', 'target', 'settings']);
		if (field(input, 'schemaVersion', 'Current settings merge') !== 3) throw new RangeError('Unsupported Current settings merge.');
		const settings = field(input, 'settings', 'Current settings merge'), packet = admit(settings);
		const request = { schemaVersion: 3, target: field(input, 'target', 'Current settings merge'), settings: packet };
		return settings !== null && typeof settings === 'object' && issued.has(settings)
			? mergeImageDevelopSelectedSettingsV3(request) : mergeImageDevelopSettingsV3(request);
	}
	async function copySelected(value: PhotoLibraryDevelopCopySelectedV3, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<ImageDevelopSettingsPacketV3> {
		const native = Object.getOwnPropertyDescriptor(options, 'signal');
		if (native && Object.hasOwn(native, 'value')) check(native.value as AbortSignal | undefined);
		const { signal } = readPhotoDevelopSignalOptionsV2(options); check(signal);
		let source: Readonly<PhotoLibraryDevelopCopySelectedV3>;
		try {
			const name = 'Selected settings source', input = record(value, name, ['schemaVersion', 'catalogId', 'photoId', 'versionId', 'revision', 'develop', 'selection']);
			if (field(input, 'schemaVersion', name) !== 3) throw new RangeError('Selected settings require source schema3.');
			source = Object.freeze({ schemaVersion: 3, catalogId: id(field(input, 'catalogId', name), 'settings source catalog'), photoId: id(field(input, 'photoId', name), 'settings source photo'),
				versionId: id(field(input, 'versionId', name), 'settings source version'), revision: integer(field(input, 'revision', name), 0, Number.MAX_SAFE_INTEGER, 'settings source revision'),
				develop: normalizeImageDevelopStateCurrentV1(field(input, 'develop', name)), selection: normalizeImageDevelopSelectionV3(field(input, 'selection', name)) });
			assertBrushInputs(source.develop);
		} catch (error) { check(signal); throw error; }
		return Reflect.apply(run, host, [async (admitted: AbortSignal) => {
			try {
				check(admitted); const catalogId = await Reflect.apply(initialize, host, []) as string; check(admitted);
				if (catalogId !== source.catalogId) throw new RangeError('Selected settings source belongs to another catalog.');
				const read = async () => { const raw = await Reflect.apply(load, repository, [catalogId, source.photoId]) as unknown; check(admitted);
					const photo = normalizePhotoDocumentCurrentV1(raw); check(admitted);
					if (photo.catalogId !== catalogId || photo.id !== source.photoId || photo.revision !== source.revision) throw new PhotoCatalogRevisionConflictError('photo');
					if (!photo.versions.some(version => version.id === source.versionId)) throw new ReferenceError('Selected settings source version is missing.');
					for (const version of photo.versions) {
						assertBrushInputs(version.develop);
						for (const entry of version.workspace?.entries ?? []) assertBrushInputs(entry.develop);
						for (const snapshot of version.workspace?.snapshots ?? []) assertBrushInputs(snapshot.develop);
					} return photo; };
				const photo = await read(), before = serializePhotoDocumentCurrentV1(photo);
				const closure = createPhotoResourceReachabilityCurrentV1(); closure.addPhoto(photo); closure.addDevelop(source.develop); closure.finish(); check(admitted);
				await Reflect.apply(verifyPhoto, host, [photo, admitted]); check(admitted);
				await Reflect.apply(verifyDevelop, host, [source.develop, admitted]); check(admitted);
				if (serializePhotoDocumentCurrentV1(await read()) !== before) throw new PhotoCatalogRevisionConflictError('photo');
				const packet = copyImageDevelopSelectedSettingsV3({ schemaVersion: 3, develop: source.develop, selection: source.selection }); check(admitted);
				issued.set(packet, catalogId); return packet;
			} catch (error) { check(admitted); throw error; }
		}, signal]) as Promise<ImageDevelopSettingsPacketV3>;
	}
}
