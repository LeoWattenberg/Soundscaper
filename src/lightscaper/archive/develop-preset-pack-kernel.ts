/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { id } from '../catalog/value-validation.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { PHOTO_DEVELOP_PRESETS_LIMITS_V1, type PhotoDevelopPresetRowV1 } from '../storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2, type PhotoDevelopPresetRowV2 } from '../storage/photo-develop-preset-row-v2.ts';
import { normalizePhotoDevelopPresetRowCurrentV1, type PhotoDevelopPresetRowCurrentV1 } from '../storage/photo-develop-preset-row-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentForProfileV1 } from '../storage/internal/photo-develop-preset-row-kernel-v1.ts';
import type { PhotoDevelopPresetRowThroughV3 } from '../storage/photo-develop-preset-row-current-v1.ts';
import { createPhotoCatalogArchiveReachabilityCurrentV1 } from './catalog-archive-reachability-current-v1.ts';
import { createImageDevelopResourceReachabilityCurrentV1 } from '../../common/editor/imaging/image-develop-resource-reachability-current-v1.ts';
import { normalizeImageDevelopStateV3 } from '../../common/editor/imaging/image-develop-state-v3.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

export const PHOTO_DEVELOP_PRESET_PACK_LIMITS = Object.freeze({ maximumPackBytes: PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumRowBytes,
	maximumChunkBytes: 4 * 1024 * 1024, outputChunkBytes: 64 * 1024 });
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Eager closed admission detaches the row before the first borrowed asynchronous write. */
type Profile = 'legacy2' | 'current3' | 'current4';
type RowFor<Mode extends Profile> = Mode extends 'legacy2' ? PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2
	: Mode extends 'current3' ? PhotoDevelopPresetRowThroughV3 : PhotoDevelopPresetRowCurrentV1;
export function encodePhotoDevelopPresetPackForProfile(profile: Profile, value: unknown, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): AsyncIterable<Uint8Array> {
	assertProfile(profile); const { signal } = readPhotoStackSignalOptionsV1(options); check(signal);
	const row = normalizeRow(profile, value, catalogId), bytes = new TextEncoder().encode(JSON.stringify(row));
	return emit();
	async function* emit() {
		for (let offset = 0; offset < bytes.byteLength; offset += PHOTO_DEVELOP_PRESET_PACK_LIMITS.outputChunkBytes) {
			check(signal); yield bytes.slice(offset, offset + PHOTO_DEVELOP_PRESET_PACK_LIMITS.outputChunkBytes);
		}
		check(signal);
	}
}

/** One at-most10MiB row, strict streaming UTF8, intrinsic chunks and joined source retirement. */
export async function readPhotoDevelopPresetPackForProfile<Mode extends Profile>(profile: Mode, source: AsyncIterable<Uint8Array>, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<RowFor<Mode>> {
	assertProfile(profile); const catalog = id(catalogId, 'preset pack catalog ID'), { signal } = readPhotoStackSignalOptionsV1(options); check(signal);
	const iterate = source?.[Symbol.asyncIterator];
	if (typeof iterate !== 'function') throw new TypeError('Develop preset pack requires an asynchronous byte source.');
	const iterator = Reflect.apply(iterate, source, []) as AsyncIterator<Uint8Array>, nextMethod = iterator.next, leaveMethod = iterator.return;
	const next = () => Reflect.apply(nextMethod, iterator, []) as ReturnType<AsyncIterator<Uint8Array>['next']>;
	const leave = leaveMethod === undefined ? undefined : () => Reflect.apply(leaveMethod, iterator, []) as Promise<IteratorResult<Uint8Array>>;
	const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
	let total = 0, text = '', done = false, failed = false, failure: unknown, result: PhotoDevelopPresetRowCurrentV1 | undefined;
	try {
		for (;;) {
			check(signal); const item = await next(); check(signal);
			if (item.done) { done = true; break; }
			const bytes = photoPackByteView(item.value);
			if (bytes.byteLength < 1 || bytes.byteLength > PHOTO_DEVELOP_PRESET_PACK_LIMITS.maximumChunkBytes) throw new RangeError('Develop preset pack emission exceeds its chunk bound.');
			if (bytes.byteLength > PHOTO_DEVELOP_PRESET_PACK_LIMITS.maximumPackBytes - total) throw new RangeError('Develop preset pack exceeds its byte bound.');
			total += bytes.byteLength; text += decoder.decode(bytes, { stream: true });
		}
		text += decoder.decode();
		result = normalizeRow(profile, JSON.parse(text) as unknown, catalog);
		check(signal);
	} catch (error) { failed = true; failure = error; }
	const cleanup: unknown[] = [];
	if (!done && leave) { try { await leave(); } catch (error) { cleanup.push(error); } }
	const primaryIsAbort = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true && Object.is(failure, Reflect.apply(nativeReason, signal, []));
	if (failed) throw aggregateScapeErrors(failure, cleanup, 'Develop preset pack decoding and source retirement failed.',
		{ primaryIsAbort });
	if (cleanup.length) throw cleanup[0]; return result! as RowFor<Mode>;
}
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(nativeAbort, signal, []); }

function assertProfile(value: unknown): void {
	if (value !== 'legacy2' && value !== 'current3' && value !== 'current4') throw new RangeError('Unsupported fixed preset pack profile.');
}
function normalizeRow(profile: Profile, value: unknown, catalogId: string): PhotoDevelopPresetRowCurrentV1 {
	if (profile === 'legacy2') return normalizePhotoDevelopPresetRowV1OrV2(value, catalogId);
	if (profile === 'current3') {
		const row = normalizePhotoDevelopPresetRowCurrentForProfileV1('current3', value, catalogId);
		const closure = createPhotoCatalogArchiveReachabilityCurrentV1(); closure.addPresetRow(row, catalogId); closure.finish(); return row;
	}
	const row = normalizePhotoDevelopPresetRowCurrentV1(value, catalogId);
	const closure = createImageDevelopResourceReachabilityCurrentV1();
	for (const preset of row.presets) {
		const develop = preset.settings.develop;
		for (const mask of develop.masks) for (const input of mask.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
		// Source processing has no resource declarations. This private scalar
		// projection reuses the fixed ledger without rewriting stored recipes
		// or extending central Current admission before its owners activate.
		closure.addDevelop(develop.processVersion === 4 ? normalizeImageDevelopStateV3({ processVersion: 3, effects: develop.effects,
			geometry: develop.geometry, masks: develop.masks, maskBindings: develop.maskBindings, repairs: develop.repairs }) : develop);
	}
	closure.finish();
	return row;
}
