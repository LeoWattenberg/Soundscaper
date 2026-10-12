/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryBackupOptionsV1, PhotoLibraryBackupResultV1 } from '../../common/editor/photo-library-backup-port-v1.ts';
import { captureMaskRasterSourceV1 } from '../../common/editor/imaging/mask-raster-source-scope-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { borrowPhotoLibraryBackupInventoryPortsCurrentV1 } from './photo-library-backup-inventory-current-v1.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import { borrowPhotoDevelopPresetEntryReaderV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { capturePhotoCubeLutSource } from './photo-cube-lut-source-binding.ts';

interface Host {
	readonly ports: PhotoLibrarySessionPortsCurrentV1;
	readonly presetSettings: PhotoLibrarySessionPortsCurrentV1['developPresetSettings'];
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
/** Capture scalar/source capabilities before borrowing the selected writer; heavy archive code stays lazy. */
export async function backupPhotoLibrarySessionCurrentV1(host: Host, options: PhotoLibraryBackupOptionsV1 = {}): Promise<PhotoLibraryBackupResultV1> {
	const native = Object.getOwnPropertyDescriptor(options, 'signal');
	const firstSignal = native && Object.hasOwn(native, 'value') ? native.value as AbortSignal | undefined : undefined;
	if (firstSignal !== undefined) Reflect.apply(CHECK, firstSignal, []);
	let request: ReturnType<typeof admitPhotoLibraryBackupRequestV1>;
	try { request = admitPhotoLibraryBackupRequestV1(options); }
	catch (error) { if (firstSignal !== undefined) Reflect.apply(CHECK, firstSignal, []); throw error; }
	const { ports, presetSettings } = host, mutate = host.mutate;
	if (typeof mutate !== 'function') throw new TypeError('Current backup requires the selected native mutation owner.');
	const mutation: typeof mutate = <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Reflect.apply(mutate<Result>, host, [run, signal]);
	const backup = ports.backup, stacks = ports.stacks, catalog = ports.catalog, resources = ports.cubeLutResources,
		maskResources = ports.maskRasterResources;
	if (!backup || !stacks || !presetSettings || !resources) throw new Error('Photo catalog backup is unavailable.');
	const snapshot = backup.readSnapshot, capture = backup.captureSmartCollectionArchiveV1, loadOriginal = backup.loadOriginal,
		summaries = catalog.readSummaryPage, photo = catalog.loadPhoto;
	const borrowed = borrowPhotoLibraryBackupInventoryPortsCurrentV1({ catalog: {
		readSnapshot: (...args) => Reflect.apply(snapshot, backup, args),
		captureSmartCollectionArchiveV1: (...args) => Reflect.apply(capture, backup, args),
		readSummaryPage: (...args) => Reflect.apply(summaries, catalog, args),
		loadPhoto: (...args) => Reflect.apply(photo, catalog, args),
	}, stacks, loadOriginal: (...args) => Reflect.apply(loadOriginal, backup, args) });
	const readEntry = borrowPhotoDevelopPresetEntryReaderV2(presetSettings);
	let capturedMaskSource: Promise<Readonly<MaskRasterSourcePortV1>> | undefined;
	const maskRasters: MaskRasterSourcePortV1 = { async withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
		capturedMaskSource ??= acquireMaskSource();
		const source = await capturedMaskSource;
		return source.withBytes(reference, consume, options);
	} };
	const completed: { result: PhotoLibraryBackupResultV1 | null } = { result: null };
	try {
		return await mutation(async (catalogId, signal) => {
			Reflect.apply(CHECK, signal, []);
			const lutResources = capturePhotoCubeLutSource((await Reflect.apply(resources, ports, [])).source);
			const { exportPhotoLibraryBackupCurrentV1 } = await import('./photo-library-backup-current-v1.ts'); Reflect.apply(CHECK, signal, []);
			const result = await exportPhotoLibraryBackupCurrentV1(catalogId, { ...borrowed, developPresetSettings: { readEntry }, lutResources, maskRasters }, { ...request, signal });
			completed.result = Object.freeze({ catalogId, catalogName: result.document.catalog.name, photoCount: result.document.catalog.photoCount,
				byteLength: result.byteLength, blob: result.blob, notices: Object.freeze([]) });
			return completed.result;
		}, request.signal);
	} catch (error) {
		if (completed.result === null) throw error;
		return Object.freeze({ ...completed.result, notices: Object.freeze(['cleanup-failed'] as const) });
	}

	async function acquireMaskSource(): Promise<Readonly<MaskRasterSourcePortV1>> {
		if (typeof maskResources !== 'function') throw new Error('Photo brush backup requires its selected mask body source.');
		const resources = await Reflect.apply(maskResources, ports, []) as unknown;
		if (typeof resources !== 'object' || resources === null) throw new TypeError('Photo brush backup requires selected resources.');
		const descriptor = Object.getOwnPropertyDescriptor(resources, 'source');
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Photo brush backup requires an own body source.');
		return captureMaskRasterSourceV1(descriptor.value);
	}
}
