/* SPDX-License-Identifier: AGPL-3.0-only */
import { BlobReader, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { digestScapeBytes } from '../common/editor/scape-archive-media.ts';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { createScapeExportDestination } from '../common/editor/scape-export-destination.ts';
import type { MotionAssetReader } from '../common/editor/motion-render-resources.ts';
import { exportMotionscaperArchive } from './editor-scape.ts';
import { assertPreparedMotionscaperAeRender, motionAeRenderedExchange, type MotionAeRenderedFrame, type PreparedMotionscaperAeRender } from './editor-ae-render-export.ts';
import { createMotionAeRenderStream } from './editor-ae-render-stream.ts';
export const MOTION_AE_RENDER_PACKAGE_LIMITS = Object.freeze({ originalArchiveBytes: 128 * 1024 * 1024, packageBytes: 256 * 1024 * 1024, frameBytes: 64 * 1024 * 1024 });
const README = 'Motionscaper complete-composition rendered transfer — development bridge, unqualified\n\n'
	+ 'This package contains every frame of one selected composition, rendered by the same Motion pipeline and authored shutter/depth-of-field quality as normal PNG delivery. The frame span is complete, independent of the work area. No source project Save was performed.\n'
	+ 'original.mscape preserves the exact pinned source project, all compositions, unused assets, original audio/fonts/media and earlier interchange custody. Keep it for editable source intent. The rendered AE composition is flattened and image-only; all imported layers are muted. Other compositions remain only in original.mscape.\n'
	+ 'PNG frames carry straight alpha and 8-bit sRGB. HDR/out-of-range values are quantized or clipped. This matches Motion PNG delivery, not a high-precision carrier or a promise of matching color/alpha in After Effects. sequence.json retains the exact rational frame clock and render quality. AE receives one still-image layer per frame using floating-point seconds. No AE version is qualified.\n'
	+ 'Download Bridge Scripts through File > After Effects Bridge. Extract every script/include into one folder. In installed After Effects, open a separate destination project with Working Space None, Linear Blending enabled and 32 bits per channel. Run Motionscaper-Import.jsx from bridge 0.1.0 and select this package\'s motionae.json. Keep media beside the manifest. The importer verifies media and creates newly owned items without saving or changing existing items.\n'
	+ 'Review conversion-report.json. Installed AE source interpretation, color/alpha and every-frame timing/reference comparisons remain an external qualification gate. Do not claim visual parity until that comparison is performed.\n';

/** All-or-nothing bounded download. ZIP backpressure reaches the maintained real renderer through its PNG stream. */
export async function createMotionscaperAeRenderPackage(prepared: PreparedMotionscaperAeRender, store: MotionAssetReader, options: Readonly<{
	acknowledgeImageOnly: boolean; signal: AbortSignal; onProgress?: (completed: number, total: number) => void;
}>): Promise<Blob> {
	const { signal } = options; throwIfScapeAborted(signal); assertPreparedMotionscaperAeRender(prepared);
	if (options.acknowledgeImageOnly !== true) throw new Error('Acknowledge the complete rendered image-only transfer, audio omission and PNG precision before downloading.');
	const original = await exportMotionscaperArchive(prepared.revision.project, asset => store.readAsset(asset), { maximumBlobBytes: MOTION_AE_RENDER_PACKAGE_LIMITS.originalArchiveBytes, signal });
	if (!original) throw new Error('AE rendered export did not preserve its original project archive.');
	const chunks: ArrayBuffer[] = [], frames: MotionAeRenderedFrame[] = [];
	const destination = createScapeExportDestination(new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk.slice().buffer); } }), 'application/zip', MOTION_AE_RENDER_PACKAGE_LIMITS.packageBytes);
	const writer = new ZipWriter(destination.target, { level: 0, zip64: true, dataDescriptor: true, dataDescriptorSignature: true, extendedTimestamp: true, useWebWorkers: false, signal });
	try {
		await writer.add('original.mscape', new BlobReader(original), { level: 0, zip64: true, signal });
		const stream = createMotionAeRenderStream({ plan: prepared.plan, maximumBytes: MOTION_AE_RENDER_PACKAGE_LIMITS.packageBytes - original.size, signal,
			onFrame: async (index, bytes) => {
				throwIfScapeAborted(signal);
				const sha256 = digestScapeBytes(bytes);
				await writer.add(`media/render-frame-${String(index)}.png`, new Uint8ArrayReader(bytes), { level: 0, zip64: true, signal });
				frames.push({ index, byteLength: bytes.length, sha256 });
			} });
		const { renderMotionscaperDelivery } = await import('./editor-render-delivery.ts');
		await renderMotionscaperDelivery({ project: prepared.revision.project, store, compositionId: prepared.plan.identity.compositionId, firstFrame: 0, endFrame: prepared.plan.frameCount,
			format: 'png', writable: stream.writable, signal, onProgress: options.onProgress ?? (() => {}) });
		stream.assertComplete(); throwIfScapeAborted(signal);
		const exchange = motionAeRenderedExchange(prepared, frames);
		const sequence = { format: 'org.motionscaper.ae-render-sequence', version: 1, ...prepared.plan, colorSpace: 'srgb', alphaMode: 'straight', bitsPerChannel: 8, audio: 'omitted', frames: frames.map(frame => ({ ...frame, path: `media/render-frame-${String(frame.index)}.png` })) };
		const texts = [{ name: 'motionae.json', text: JSON.stringify(exchange) }, { name: 'sequence.json', text: JSON.stringify(sequence) },
			{ name: 'conversion-report.json', text: JSON.stringify({ format: 'org.motionscaper.ae-render-report', version: 1, sourceRevisionDigest: prepared.revision.digest, compositionId: prepared.plan.identity.compositionId, firstFrame: 0, frameCount: prepared.plan.frameCount, report: exchange.report }) }, { name: 'README.txt', text: README }];
		for (const item of texts) { throwIfScapeAborted(signal); await writer.add(item.name, new TextReader(item.text), { level: 0, zip64: true, signal }); }
		await destination.finish(writer, signal); throwIfScapeAborted(signal); return new Blob(chunks, { type: 'application/zip' });
	} catch (error) { return await destination.abort(writer, error); }
	finally { chunks.length = 0; }
}
