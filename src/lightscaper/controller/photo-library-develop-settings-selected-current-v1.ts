/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import type { ImageDevelopSettingsPacketV3 } from '../../common/editor/imaging/image-develop-settings-contract-v3.ts';
import type { ImageDevelopSettingsPacketV4 } from '../../common/editor/imaging/image-develop-settings-contract-v4.ts';
import type { ImageDevelopSettingsPacketCurrentV1, ImageDevelopSettingsPacketThroughV3 } from '../../common/editor/imaging/image-develop-settings-current-v1.ts';
import { normalizeImageDevelopSettingsPacketCurrentForProfileV1 } from '../../common/editor/imaging/internal/image-develop-settings-kernel-v1.ts';
import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from '../../common/editor/imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { assertPhotoDevelopSelectedMaskInputsCurrentV1 as assertBrushInputs } from './internal/photo-develop-selected-mask-inputs-current-v1.ts';
import { normalizeImageDevelopSelectionV3, mergeImageDevelopSettingsV3 } from '../../common/editor/imaging/image-develop-settings-v3.ts';
import { normalizeImageDevelopSelectionV4, mergeImageDevelopSettingsV4 } from '../../common/editor/imaging/image-develop-settings-v4.ts';
import { copyImageDevelopSelectedSettingsV3, mergeImageDevelopSelectedSettingsV3 } from '../../common/editor/imaging/image-develop-settings-selected-v3.ts';
import { copyImageDevelopSelectedSettingsV4, mergeImageDevelopSelectedSettingsV4 } from '../../common/editor/imaging/image-develop-settings-selected-v4.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { normalizePhotoDocumentV3 } from '../catalog/photo-document-v3.ts';
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
interface SelectedV3 {
	copySelected(value: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<ImageDevelopSettingsPacketV3>;
	admit(value: unknown, catalogId?: string): ImageDevelopSettingsPacketThroughV3;
	merge(value: unknown): ImageDevelopStateThroughV3;
}
interface SelectedV4 {
	copySelected(value: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<ImageDevelopSettingsPacketV4>;
	admit(value: unknown, catalogId?: string): ImageDevelopSettingsPacketCurrentV1;
	merge(value: unknown): ImageDevelopStateThroughV4;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

export function createPhotoDevelopSelectedSettingsCurrentV1(host: PhotoDevelopSelectedSettingsHostCurrentV1): Readonly<SelectedV4> {
	return createPhotoDevelopSelectedSettingsForProfileV1('current4', host);
}
export function createPhotoDevelopSelectedSettingsForProfileV1(profile: 'current3', host: PhotoDevelopSelectedSettingsHostCurrentV1): Readonly<SelectedV3>;
export function createPhotoDevelopSelectedSettingsForProfileV1(profile: 'current4', host: PhotoDevelopSelectedSettingsHostCurrentV1): Readonly<SelectedV4>;
/** Each fixed child owns its issued identities. A scalar packet, JSON clone or
 * another child cannot grant resource authority. Wire3 remains a Session
 * envelope; current4 translates only at the owning pure metadata call. */
export function createPhotoDevelopSelectedSettingsForProfileV1(profile: 'current3' | 'current4', host: PhotoDevelopSelectedSettingsHostCurrentV1): Readonly<SelectedV3 | SelectedV4> {
	if (profile !== 'current3' && profile !== 'current4') throw new TypeError('Unsupported selected settings profile.');
	const repository = host.repository, load = repository.loadPhoto, initialize = host.ready, run = host.operation;
	const verifyPhoto = host.verifyPhotoResources, verifyDevelop = host.verifyDevelopResources;
	if ([load, initialize, run, verifyPhoto, verifyDevelop].some(fn => typeof fn !== 'function')) throw new TypeError('Selected settings require complete Current source verification.');
	const issued = new WeakMap<object, string>();
	return Object.freeze({ copySelected, admit, merge }) as Readonly<SelectedV3 | SelectedV4>;

	function admit(value: unknown, catalogId?: string): ImageDevelopSettingsPacketCurrentV1 {
		const source = value !== null && typeof value === 'object' ? issued.get(value) : undefined;
		if (source !== undefined) {
			if (catalogId !== undefined && catalogId !== source) throw new RangeError('Selected settings belong to another catalog.');
			return value as ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4;
		}
		const packet = profile === 'current3' ? normalizeImageDevelopSettingsPacketCurrentForProfileV1('current3', value)
			: normalizeImageDevelopSettingsPacketCurrentForProfileV1('current4', value);
		if (packet.develop.masks.some(mask => mask.inputs.length > 0)) throw new RangeError('Brush settings require this selected child’s authenticated packet.');
		return packet;
	}
	function merge(value: unknown) {
		const input = record(value, 'Current settings merge', ['schemaVersion', 'target', 'settings']);
		if (field(input, 'schemaVersion', 'Current settings merge') !== 3) throw new RangeError('Unsupported Current settings merge.');
		const settings = field(input, 'settings', 'Current settings merge'), packet = admit(settings);
		const request = { schemaVersion: profile === 'current3' ? 3 : 4, target: field(input, 'target', 'Current settings merge'), settings: packet };
		const selected = settings !== null && typeof settings === 'object' && issued.has(settings);
		return profile === 'current3' ? selected ? mergeImageDevelopSelectedSettingsV3(request) : mergeImageDevelopSettingsV3(request)
			: selected ? mergeImageDevelopSelectedSettingsV4(request) : mergeImageDevelopSettingsV4(request);
	}
	async function copySelected(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4> {
		const native = Object.getOwnPropertyDescriptor(options, 'signal');
		if (native && Object.hasOwn(native, 'value')) check(native.value as AbortSignal | undefined);
		const { signal } = readPhotoDevelopSignalOptionsV2(options); check(signal);
		const source = (() => { try {
			const name = 'Selected settings source', input = record(value, name, ['schemaVersion', 'catalogId', 'photoId', 'versionId', 'revision', 'develop', 'selection']);
			if (field(input, 'schemaVersion', name) !== 3) throw new RangeError('Selected settings require source schema3.');
			const develop = profile === 'current3' ? normalizeImageDevelopStateThroughV3(field(input, 'develop', name)) : normalizeImageDevelopStateThroughV4(field(input, 'develop', name));
			const selection = profile === 'current3' ? normalizeImageDevelopSelectionV3(field(input, 'selection', name)) : normalizeImageDevelopSelectionV4(field(input, 'selection', name));
			assertBrushInputs(develop);
			return Object.freeze({ catalogId: id(field(input, 'catalogId', name), 'settings source catalog'), photoId: id(field(input, 'photoId', name), 'settings source photo'),
				versionId: id(field(input, 'versionId', name), 'settings source version'), revision: integer(field(input, 'revision', name), 0, Number.MAX_SAFE_INTEGER, 'settings source revision'), develop, selection });
		} catch (error) { check(signal); throw error; } })();
		return Reflect.apply(run, host, [async (admitted: AbortSignal) => {
			check(admitted); const catalogId = await Reflect.apply(initialize, host, []) as string; check(admitted);
			if (catalogId !== source.catalogId) throw new RangeError('Selected settings source belongs to another catalog.');
			const read = async () => {
				const raw: unknown = await Reflect.apply(load, repository, [catalogId, source.photoId]); check(admitted);
				const photo = profile === 'current3' ? fixedPhoto(raw) : normalizePhotoDocumentCurrentV1(raw); check(admitted);
				if (photo.catalogId !== catalogId || photo.id !== source.photoId || photo.revision !== source.revision) throw new PhotoCatalogRevisionConflictError('photo');
				if (!photo.versions.some(version => version.id === source.versionId)) throw new ReferenceError('Selected settings source version is missing.');
				for (const version of photo.versions) {
					assertBrushInputs(version.develop);
					for (const entry of version.workspace?.entries ?? []) assertBrushInputs(entry.develop);
					for (const snapshot of version.workspace?.snapshots ?? []) assertBrushInputs(snapshot.develop);
				} return photo;
			};
			const photo = await read(), before = serializePhotoDocumentCurrentV1(photo);
			const closure = createPhotoResourceReachabilityCurrentV1(); closure.addPhoto(photo); closure.addDevelop(source.develop); closure.finish(); check(admitted);
			await Reflect.apply(verifyPhoto, host, [photo, admitted]); check(admitted);
			await Reflect.apply(verifyDevelop, host, [source.develop, admitted]); check(admitted);
			if (serializePhotoDocumentCurrentV1(await read()) !== before) throw new PhotoCatalogRevisionConflictError('photo');
			const request = { schemaVersion: profile === 'current3' ? 3 : 4, develop: source.develop, selection: source.selection };
			const packet = profile === 'current3' ? copyImageDevelopSelectedSettingsV3(request) : copyImageDevelopSelectedSettingsV4(request); check(admitted);
			issued.set(packet, catalogId); return packet;
		}, signal]) as Promise<ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4>;
	}
}
function fixedPhoto(value: unknown): PhotoDocumentCurrentV1 {
	const version = value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'schemaVersion') : undefined;
	return version && Object.hasOwn(version, 'value') && version.value === 3 ? normalizePhotoDocumentV3(value) : normalizePhotoDocumentV1OrV2(value);
}
