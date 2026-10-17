/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { readPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { readImageMetadataV1 } from '../../common/editor/imaging/image-metadata-reader-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-browser-native-port.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { withDecodedRawOriginalV1, type RawDecodedOriginalV1 } from '../../common/editor/raw/libraw-runtime-v1.ts';
import { probeRawSourceV1, rawFlipExifOrientationV1, type RawSourceAdmissionV1 } from '../../common/editor/raw/raw-source-v1.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { normalizePhotoMetadataV1 } from '../catalog/photo-metadata.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { adaptPhotoImportMetadataV1 } from './metadata-adapter-v1.ts';
import { preparePhotoRasterOriginalV1, type PhotoImportPreparedV1, type PhotoImportOutcomeV1 } from './photo-import-preparation-v1.ts';
import { admitPhotoImportPreparationPlanV1, type PhotoImportPreparationPlanV1, type SelectedPhotoOriginalV1 } from './internal/photo-import-preparation-plan-v1.ts';

/** RAW has no byte FramePack1: its exact Original is the regeneration source. */
export type PhotoRawImportPreparedCurrentV1 = Readonly<Omit<PhotoImportPreparedV1, 'decodeArtifact'>>;
export type PhotoImportOutcomeCurrentV1 = PhotoImportOutcomeV1 | PhotoRawImportPreparedCurrentV1;
export interface PhotoImportPreparationPortsCurrentV1 {
	readonly openImage?: OpenFramescaperBrowserNativeImageV1;
	readonly withRawFrame?: typeof withDecodedRawOriginalV1;
}
const RAW_LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 128 * 1024 * 1024 });
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
function retireOwnedInput(backing: ArrayBuffer | undefined, allocationBytes: number | undefined): void {
	if (!backing) return;
	if (Reflect.apply(SIZE, backing, []) !== allocationBytes) throw new TypeError('Photo input was detached or changed before physical retirement.');
	Reflect.apply(FILL, new Uint8Array(backing), [0]);
}

/** Fixed Current admission uses a real deep decoder without changing raster V1. */
export function preparePhotoImportGestureCurrentV1(value: unknown,
	dependencies: Readonly<PhotoImportPreparationPortsCurrentV1> = {}): AsyncGenerator<PhotoImportOutcomeCurrentV1> {
	const plan = admitPhotoImportPreparationPlanV1(value);
	const ports = record(dependencies, 'Current photo preparation ports', ['openImage', 'withRawFrame'], []);
	const open = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'Current photo preparation ports') : openFramescaperBrowserNativeImageV1;
	const raw = Object.hasOwn(ports, 'withRawFrame') ? field(ports, 'withRawFrame', 'Current photo preparation ports') : withDecodedRawOriginalV1;
	if (typeof open !== 'function' || typeof raw !== 'function') throw new TypeError('Current photo preparation requires scoped decoder capabilities.');
	return prepare(plan, open as OpenFramescaperBrowserNativeImageV1, raw as typeof withDecodedRawOriginalV1, dependencies);
}

async function* prepare(plan: PhotoImportPreparationPlanV1, open: OpenFramescaperBrowserNativeImageV1,
	raw: typeof withDecodedRawOriginalV1, receiver: Readonly<PhotoImportPreparationPortsCurrentV1>): AsyncGenerator<PhotoImportOutcomeCurrentV1> {
	for (const [index, selected] of plan.originals.entries()) {
		check(plan.signal);
		const deadline = new AbortController();
		const timer = setTimeout(() => { deadline.abort(new DOMException('Photo preparation exceeded its decode deadline.', 'TimeoutError')); }, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
		const signal = plan.signal ? AbortSignal.any([plan.signal, deadline.signal]) : deadline.signal;
		let outcome: PhotoImportOutcomeCurrentV1 | undefined;
		let bytes: Uint8Array<ArrayBuffer> | undefined;
		let backing: ArrayBuffer | undefined, allocationBytes: number | undefined, failure: { error: unknown } | undefined;
		try {
			backing = await Blob.prototype.arrayBuffer.call(selected.file) as ArrayBuffer;
			allocationBytes = Number(Reflect.apply(SIZE, backing, []));
			bytes = new Uint8Array(backing); check(signal);
			if (bytes.length !== selected.byteLength) throw new RangeError('Selected original bytes disagree with its File length.');
			const admission = probeRawSourceV1(bytes);
			outcome = admission ? await prepareRaw(selected, index, plan.templates[index]!, bytes, admission, signal, raw, receiver)
				: await preparePhotoRasterOriginalV1(selected, index, plan.templates[index]!, open, signal, bytes);
		} catch (error) { failure = { error }; }
		finally {
			try { retireOwnedInput(backing, allocationBytes); }
			catch (error) { failure = { error: failure ? new AggregateError([failure.error, error], 'Photo preparation and physical retirement failed.', { cause: failure.error }) : error }; }
			finally { clearTimeout(timer); }
		}
		if (failure) {
			if (plan.signal && Reflect.apply(ABORTED, plan.signal, []) === true) throw failure.error;
			outcome = Object.freeze({ outcome: 'failed', index, fileName: selected.fileName, error: failure.error });
		}
		check(plan.signal);
		if (!outcome) throw new Error('Photo preparation has no outcome.');
		yield outcome;
	}
}

async function prepareRaw(selected: SelectedPhotoOriginalV1, index: number, template: PhotoDocumentV1,
	bytes: Uint8Array<ArrayBuffer>, admission: RawSourceAdmissionV1, signal: AbortSignal,
	raw: typeof withDecodedRawOriginalV1, receiver: Readonly<PhotoImportPreparationPortsCurrentV1>): Promise<PhotoRawImportPreparedCurrentV1> {
	const digest = bytesToHex(sha256(bytes)), original = new Blob([bytes], { type: admission.mimeType });
	const extractedMetadata = admission.format === 'dng' ? readImageMetadataV1(bytes)
		: { schemaVersion: 1, container: 'unsupported', exif: null, iptc: null, issues: [] };
	const facts = adaptPhotoImportMetadataV1({ fileName: selected.fileName, modifiedTime: selected.modifiedTime,
		byteLength: selected.byteLength, extractedMetadata });
	const photo = await Reflect.apply(raw, receiver, [{ bytes, signal }, (view: RawDecodedOriginalV1) => {
		check(signal);
		const frame = readPixelFrameV1(view.frame, RAW_LIMITS);
		if (frame.descriptor.sampleFormat !== 'unorm16' || frame.descriptor.primaries !== 'srgb' || frame.descriptor.transfer !== 'linear') {
			throw new RangeError('RAW import requires native linear sRGB RGBA16.');
		}
		return normalizePhotoDocumentV1({ ...template,
			original: { ...template.original, contentSha256: digest, mimeType: admission.mimeType,
				width: frame.descriptor.width, height: frame.descriptor.height, hasAlpha: false },
			metadata: normalizePhotoMetadataV1({ ...facts.metadata, orientation: rawFlipExifOrientationV1(view.rawFlip) }),
			extractedMetadata: facts.extractedMetadata });
	}]) as PhotoDocumentV1;
	check(signal);
	if (bytesToHex(sha256(bytes)) !== digest || original.size !== selected.byteLength) throw new RangeError('RAW decoder replaced the selected Original binding.');
	return Object.freeze({ outcome: 'prepared', index, fileName: selected.fileName, photo, original,
		keywordNames: facts.keywordNames, notices: facts.notices });
}
