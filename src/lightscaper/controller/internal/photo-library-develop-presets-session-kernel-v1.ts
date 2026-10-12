/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetsPortV2, PhotoLibraryDevelopPresetSnapshotV2, PhotoLibraryDevelopPresetBodyV2 } from '../../../common/editor/photo-library-develop-presets-port-v2.ts';
import { createImageDevelopPresetV2, parseImageDevelopPresetV1OrV2, serializeImageDevelopPresetV1OrV2 } from '../../../common/editor/imaging/image-develop-preset-v2.ts';
import { checkImageDevelopSettingsBytesV1 } from '../../../common/editor/imaging/image-develop-settings-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { field, id, integer, record } from '../../catalog/value-validation.ts';
import { readPhotoDevelopPresetsV2, readPhotoDevelopPresetV2, applyPhotoDevelopPresetV2,
	normalizePhotoDevelopPresetCommandV2 } from '../../storage/photo-develop-presets-v2.ts';
import type { PhotoCatalogRepositoryV2 } from '../../catalog/photo-catalog-repository-v2.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../../storage/photo-develop-presets-v1.ts';
import { borrowPhotoDevelopPresetSettingsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import type { PhotoLibraryDevelopPresetV2 } from '../../../common/editor/photo-library-develop-presets-port-v2.ts';

import type { PhotoLibraryDevelopPresetsPortV3, PhotoLibraryDevelopPresetSnapshotV3, PhotoLibraryDevelopPresetBodyV3 } from '../../../common/editor/photo-library-develop-presets-port-v3.ts';
import { createImageDevelopSelectedPresetV3 } from '../../../common/editor/imaging/image-develop-preset-selected-v3.ts';
import { parseImageDevelopPresetCurrentV1, serializeImageDevelopPresetCurrentV1 } from '../../../common/editor/imaging/image-develop-preset-current-v1.ts';
import { readPhotoDevelopPresetsCurrentV1, readPhotoDevelopPresetCurrentV1, applyPhotoDevelopPresetCurrentV1,
	normalizePhotoDevelopPresetCommandCurrentV1 } from '../../storage/photo-develop-presets-current-v1.ts';
import type { PhotoResourceVerificationHostCurrentV1 } from '../../storage/photo-media-resource-verification-current-v1.ts';

export interface PhotoLibraryDevelopPresetStorageV2 {
	readonly settings: PhotoDevelopPresetSettingsPortV1;
	readonly catalog: Pick<PhotoCatalogRepositoryV2, 'loadCatalog'>;
	readonly verifyResources?: (preset: PhotoLibraryDevelopPresetV2, signal?: AbortSignal) => Promise<void>;
}
export interface PhotoLibraryDevelopPresetsSessionHostV2 {
	readonly storage: PhotoLibraryDevelopPresetStorageV2;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}
export interface PhotoLibraryDevelopPresetStorageCurrentV1 {
	readonly settings: PhotoDevelopPresetSettingsPortV1;
	readonly catalog: Pick<PhotoCatalogRepositoryV2, 'loadCatalog'>;
	readonly resources: PhotoResourceVerificationHostCurrentV1;
}
export interface PhotoLibraryDevelopPresetsSessionHostCurrentV1 extends Omit<PhotoLibraryDevelopPresetsSessionHostV2, 'storage'> {
	readonly storage: PhotoLibraryDevelopPresetStorageCurrentV1;
}
type Profile = 'legacy2' | 'current3';
type Host = PhotoLibraryDevelopPresetsSessionHostV2 | PhotoLibraryDevelopPresetsSessionHostCurrentV1;
type Port = PhotoLibraryDevelopPresetsPortV2 | PhotoLibraryDevelopPresetsPortV3;
type Snapshot = PhotoLibraryDevelopPresetSnapshotV2 | PhotoLibraryDevelopPresetSnapshotV3;
type Body = PhotoLibraryDevelopPresetBodyV2 | PhotoLibraryDevelopPresetBodyV3;
const nativeAbort = AbortSignal.prototype.throwIfAborted;

/** This optional capability borrows the existing Session lifetime, single writer and catalog lease. */
export function createPhotoLibraryDevelopPresetsSessionForProfileV1(profile: 'legacy2', host: PhotoLibraryDevelopPresetsSessionHostV2): Readonly<PhotoLibraryDevelopPresetsPortV2>;
export function createPhotoLibraryDevelopPresetsSessionForProfileV1(profile: 'current3', host: PhotoLibraryDevelopPresetsSessionHostCurrentV1): Readonly<PhotoLibraryDevelopPresetsPortV3>;
export function createPhotoLibraryDevelopPresetsSessionForProfileV1(profile: Profile, host: Host): Readonly<Port> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new RangeError('Unsupported fixed preset Session profile.');
	const legacy = profile === 'legacy2' ? host as PhotoLibraryDevelopPresetsSessionHostV2 : undefined;
	const schemaVersion = profile === 'legacy2' ? 2 as const : 3 as const;
	const storage = host.storage, settings = borrowPhotoDevelopPresetSettingsV2(storage.settings);
	const initialize = host.ready, operation = host.operation, mutate = host.mutate, catalog = storage.catalog, readCatalog = catalog.loadCatalog, verify = legacy?.storage.verifyResources;
	const resources = legacy ? undefined : captureResources((host as PhotoLibraryDevelopPresetsSessionHostCurrentV1).storage.resources);
	if ([initialize, operation, mutate, readCatalog].some(method => typeof method !== 'function')
		|| (verify !== undefined && typeof verify !== 'function')) throw new TypeError('Complete preset host capabilities are required.');
	const ready = (): Promise<string> => Reflect.apply(initialize, host, []);
	const loadCatalog: typeof readCatalog = (...args) => Reflect.apply(readCatalog, catalog, args);
	const verifyResources = verify === undefined ? undefined : (...args: Parameters<NonNullable<typeof verify>>) => Reflect.apply(verify, storage, args);
	return Object.freeze({ create: profile === 'legacy2' ? createImageDevelopPresetV2 : createImageDevelopSelectedPresetV3,
		parse: profile === 'legacy2' ? parseImageDevelopPresetV1OrV2 : parseImageDevelopPresetCurrentV1,
		serialize: profile === 'legacy2' ? serializeImageDevelopPresetV1OrV2 : serializeImageDevelopPresetCurrentV1,
		async list(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Snapshot> {
			const { signal } = signalOptions(profile, options);
			const catalogId = admit(profile, signal, () => id(field(request(profile, value, ['schemaVersion', 'catalogId']), 'catalogId'), 'Develop preset catalog ID'));
			if (signal) Reflect.apply(nativeAbort, signal, []);
			return Reflect.apply(operation<Snapshot>, host, [async (admitted: AbortSignal) => {
				checkCatalog(catalogId, await ready()); Reflect.apply(nativeAbort, admitted, []);
				return (profile === 'legacy2' ? readPhotoDevelopPresetsV2 : readPhotoDevelopPresetsCurrentV1)(settings, catalogId, { signal: admitted });
			}, signal]);
		},
		async read(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Body> {
			const { signal } = signalOptions(profile, options);
			const { catalogId, presetId, expected } = admit(profile, signal, () => {
				const input = request(profile, value, ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
				return { catalogId: id(field(input, 'catalogId'), 'Develop preset catalog ID'), presetId: id(field(input, 'presetId'), 'Develop preset ID'),
					expected: integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'Develop preset expected revision') };
			});
			if (signal) Reflect.apply(nativeAbort, signal, []);
			return Reflect.apply(operation<Body>, host, [async (admitted: AbortSignal) => {
				checkCatalog(catalogId, await ready()); Reflect.apply(nativeAbort, admitted, []);
				return (profile === 'legacy2' ? readPhotoDevelopPresetV2 : readPhotoDevelopPresetCurrentV1)(settings, catalogId, presetId, expected, { signal: admitted });
			}, signal]);
		},
		async write(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}) {
			const { signal } = signalOptions(profile, options);
			const { catalogId, command } = admit(profile, signal, () => {
				const input = request(profile, value, ['schemaVersion', 'catalogId', 'command']), catalogId = id(field(input, 'catalogId'), 'Develop preset catalog ID');
				const command = (profile === 'legacy2' ? normalizePhotoDevelopPresetCommandV2 : normalizePhotoDevelopPresetCommandCurrentV1)(field(input, 'command'));
				checkImageDevelopSettingsBytesV1({ schemaVersion, catalogId, command }); return { catalogId, command };
			});
			if (signal) Reflect.apply(nativeAbort, signal, []);
			const completed: { snapshot: Snapshot | null } = { snapshot: null };
			try {
				const snapshot: Snapshot = await Reflect.apply(mutate<Snapshot>, host, [async (current: string, admitted: AbortSignal) => {
					checkCatalog(catalogId, current);
					const root = await loadCatalog(catalogId); Reflect.apply(nativeAbort, admitted, []);
					if (!root) throw new ReferenceError('Photo catalog is missing.');
					completed.snapshot = profile === 'legacy2'
						? await applyPhotoDevelopPresetV2(settings, root, command, { signal: admitted, ...(verifyResources ? { verifyResources } : {}) })
						: await applyPhotoDevelopPresetCurrentV1(settings, root, command, { signal: admitted, resources });
					return completed.snapshot;
				}, signal]);
				return Object.freeze({ schemaVersion, snapshot, notices: Object.freeze([]) });
			} catch (error) {
				if (completed.snapshot === null) throw error;
				return Object.freeze({ schemaVersion, snapshot: completed.snapshot, notices: Object.freeze(['cleanup-failed'] as const) });
			}
		},
	}) as Readonly<Port>;
}
function request(profile: Profile, value: unknown, fields: readonly string[]) {
	const input = record(value, 'Develop preset request', fields);
	if (field(input, 'schemaVersion') !== (profile === 'legacy2' ? 2 : 3)) throw new RangeError('Unsupported Develop preset request version.');
	return input;
}
function checkCatalog(requested: string, current: string): void { if (requested !== current) throw new RangeError('Develop presets belong to another catalog.'); }

function signalOptions(profile: Profile, value: unknown) {
	let signal: AbortSignal | undefined;
	if (profile === 'current3' && value !== null && typeof value === 'object') {
		const native = Object.getOwnPropertyDescriptor(value, 'signal');
		if (native && Object.hasOwn(native, 'value')) { signal = native.value as AbortSignal | undefined; if (signal !== undefined) Reflect.apply(nativeAbort, signal, []); }
	}
	return admit(profile, signal, () => readPhotoDevelopSignalOptionsV2(value));
}
function captureResources(host: PhotoResourceVerificationHostCurrentV1): Readonly<PhotoResourceVerificationHostCurrentV1> {
	const luts = host.cubeLutResources, brushes = host.maskRasterResources;
	if (typeof luts !== 'function' || typeof brushes !== 'function') throw new TypeError('Current presets require selected resource factories.');
	return Object.freeze({ cubeLutResources: () => Reflect.apply(luts, host, []) as ReturnType<typeof luts>,
		maskRasterResources: () => Reflect.apply(brushes, host, []) as ReturnType<typeof brushes> });
}

function admit<Result>(profile: Profile, signal: AbortSignal | undefined, run: () => Result): Result {
	try { const result = run(); if (profile === 'current3' && signal !== undefined) Reflect.apply(nativeAbort, signal, []); return result; }
	catch (error) { if (profile === 'current3' && signal !== undefined) Reflect.apply(nativeAbort, signal, []); throw error; }
}
