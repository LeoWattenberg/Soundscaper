/* SPDX-License-Identifier: AGPL-3.0-only */
import { withDecodedImageHdrOriginalV1 } from '../../common/editor/imaging/image-hdr-original-v1.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1, IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 } from '../../common/editor/imaging/image-hdr-original-profile-v1.ts';
import { defaultImageDevelopStateV1 } from '../../common/editor/imaging/image-develop-state-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createFramescaperImageFramePackWithWarningsV1, type FramescaperImageFramePackPublicationV1 } from '../../common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperHdrOriginalReceiptV1 } from '../../common/editor/timeline-image-hdr-receipt-v1.ts';
import { normalizeFramescaperHdrImageSourceCurrentV1 } from '../../common/editor/timeline-image-model-hdr-current-v1.ts';
import { createImageDevelopHandoffProvenanceHdrCurrentV1 } from '../../common/editor/image-develop-handoff-provenance-hdr-current-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, normalizeFramescaperImageClipV1 } from '../../common/editor/timeline-image-model.ts';
import { checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { prepareFramescaperHdrMergeResultNameCurrentV1 } from './image-hdr-merge-frame-source-current-v1.ts';
import type { ImageHdrMergeResultCurrentV1 } from '../../common/editor/controller/shared/image-hdr-merge-current-v1.ts';
import type { FramescaperProject } from '../editor-project.ts';
import { retireFramescaperNativeImageCurrentV1 } from './timeline-image-native-pack-owner-current-v1.ts';

const MiB = 1024n * 1024n, MAXIMUM = 1024n * MiB;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, FILL = Uint8Array.prototype.fill;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;

/** Build the presentation from the actual merged Float32 Original. The byte
 * cache cannot become Develop authority. This output owner retires native and
 * display planes before publication, then wipes the unpublished pack snapshot
 * only after the complete publication/adoption consumer has joined. */
export async function withFramescaperHdrMergeResultCurrentV1<Result>(input: Readonly<{
	merged: Readonly<ImageHdrMergeResultCurrentV1>; project: FramescaperProject; sourceId: string; clipId: string; fileName: string; signal?: AbortSignal;
}>, consume: (value: Readonly<{
	source: ReturnType<typeof normalizeFramescaperHdrImageSourceCurrentV1>; clip: ReturnType<typeof normalizeFramescaperImageClipV1>;
	command: unknown; bytes: Uint8Array<ArrayBuffer>;
}>) => Result | Promise<Result>): Promise<Result> {
	const { merged, project, sourceId, clipId, signal } = input, fileName = prepareFramescaperHdrMergeResultNameCurrentV1(input.fileName);
	const check = () => { checkRepairSignalV1(signal); }; check();
	const width = merged.provenance.output.width, height = merged.provenance.output.height, original = BigInt(merged.byteLength), pixels = BigInt(width) * BigInt(height);
	const display = pixels * 4n, native = pixels * 16n;
	// Deflate worst-case overhead plus the closed native receipt/header/index.
	const compressed = display + 5n * ((display + 16382n) / 16383n) + MiB;
	const packBound = original + compressed + MiB;
	const buildPeak = original + native + display + compressed + packBound + 32n * MiB;
	// The engine's encoded output remains borrowed through this callback. The
	// publisher independently owns a private snapshot and storage/reader copy,
	// plus a hostile-body maximum float decode and two exact Original copies.
	const publishPeak = packBound * 3n + original * 3n + 288n * MiB;
	if (original * 2n + native + 32n * MiB > MAXIMUM || buildPeak > MAXIMUM || publishPeak > MAXIMUM) throw new RangeError('Frame HDR result exceeds its 1 GiB build/publication phase budget.');
	let pack: Readonly<FramescaperImageFramePackPublicationV1> | undefined;
	let backing: ArrayBuffer | undefined, allocationLength = 0;
	let outcome: { value: Result } | { error: unknown };
	try {
		const prepared = await withDecodedImageHdrOriginalV1({ bytes: merged.bytes, ...(signal ? { signal } : {}) }, view => {
			check(); if (view.frame.descriptor.width !== width || view.frame.descriptor.height !== height) throw new Error('Merged HDR native output extent changed.');
			const hdr = normalizeFramescaperHdrOriginalReceiptV1({ schemaVersion: 1, format: 'lightscaper-hdr', bodyVersion: 1,
				descriptor: view.frame.descriptor, pixelEncoding: 'rgb32f-le', pixelsSha256: view.pixelsSha256, metadataSha256: view.metadataSha256 });
			return withLinearPixelFrameDisplayV1({ frame: view.frame, ...(signal ? { signal } : {}) }, async rendered => {
				if (!(rendered.pixels instanceof Uint8Array)) throw new TypeError('HDR pack display requires final RGBA8.');
				pack = await createFramescaperImageFramePackWithWarningsV1({ original: merged.bytes, receipt: { schemaVersion: 1, kind: 'hdr-original', hdr }, width, height,
					timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: rendered.pixels }] },
				{ maximumOriginalBytes: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes, maximumAssetBytes: 512 * 1024 * 1024, assertCurrent: check });
				const encodedBacking = pack.bytes.buffer;
				if (!(encodedBacking instanceof ArrayBuffer)) throw new TypeError('Frame HDR pack requires native ArrayBuffer storage.');
				backing = encodedBacking; allocationLength = Number(Reflect.apply(SIZE, encodedBacking, []));
				if (Object.getPrototypeOf(encodedBacking) !== ArrayBuffer.prototype || Reflect.apply(RESIZABLE, encodedBacking, [])
					|| pack.bytes.byteOffset !== 0 || pack.bytes.byteLength !== allocationLength || allocationLength !== pack.assetByteLength) {
					throw new TypeError('Frame HDR pack requires its exact dedicated fixed backing.');
				}
				const bytes = new Uint8Array(encodedBacking);
				check(); if (pack.originalSha256 !== merged.sha256 || pack.originalByteLength !== merged.byteLength) throw new Error('HDR FramePack Original differs from the actual merge output.');
				const develop = defaultImageDevelopStateV1();
				const source = normalizeFramescaperHdrImageSourceCurrentV1({ schemaVersion: 5, kind: 'image', id: sourceId, storageKey: sourceId,
					name: fileName.slice(0, -6) || 'HDR', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: pack.contentSha256,
					assetByteLength: pack.assetByteLength, conversionReceiptSha256: pack.conversionReceiptSha256,
					original: { fileName, mimeType: IMAGE_HDR_ORIGINAL_MIME_TYPE_V1, recognizedFormat: 'lightscaper-hdr', byteLength: merged.byteLength, sha256: merged.sha256 },
					canonical: { width, height, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' },
					develop, developed: { width, height }, hdr, provenance: createImageDevelopHandoffProvenanceHdrCurrentV1({ develop,
						original: { exactName: fileName, sha256: merged.sha256, byteLength: merged.byteLength }, origin: { schemaFamily: 'framescaper', schemaVersion: 1,
							projectId: project.id, revision: project.revision + 1, sourceId, clipId, sequenceId: project.primarySequenceId } }) });
				const sequence = project.sequences.find(value => value.id === project.primarySequenceId); if (!sequence) throw new ReferenceError('HDR requires the primary Frame sequence.');
				const count = Number((5n * BigInt(sequence.rate.num) + BigInt(sequence.rate.den) - 1n) / BigInt(sequence.rate.den));
				const clip = normalizeFramescaperImageClipV1({ schemaVersion: 1, kind: 'image', id: clipId, sourceId, sequenceId: project.primarySequenceId,
					sequenceStartFrame: 0, sequenceFrameCount: count, sourceStartTicks: '0' });
				return Object.freeze({ source, clip, bytes, command: { type: 'batch', commands: [
					{ type: 'image-source/set', sourceId, expectedSource: null, source },
					{ type: 'image-clip/set', clipId, expectedClip: null, expectedPlacement: null, clip, placement: { scope: 'project-bin' } },
				] } });
			}, 'full');
		});
		check(); outcome = { value: await consume(prepared) };
	} catch (error) { outcome = { error }; }
	const captured = backing, length = allocationLength;
	await retireFramescaperNativeImageCurrentV1('error' in outcome ? outcome : undefined, captured ? [() => {
		if (Number(Reflect.apply(SIZE, captured, [])) !== length) throw new TypeError('Frame HDR pack detached before physical retirement.');
		Reflect.apply(FILL, new Uint8Array(captured), [0]);
	}] : []);
	if ('value' in outcome) return outcome.value; throw outcome.error;
}
