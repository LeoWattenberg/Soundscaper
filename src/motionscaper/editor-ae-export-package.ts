/* SPDX-License-Identifier: AGPL-3.0-only */
import { BlobReader, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import { createScapeDigest, scapeHex } from '../common/editor/scape-archive-media.ts';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { createScapeExportDestination } from '../common/editor/scape-export-destination.ts';
import { maximumScapeStoreArchiveBytes } from '../common/editor/scape-export-estimate.ts';
import { exportMotionscaperArchive } from './editor-scape.ts';
import { assertPreparedMotionscaperAeExport, type PreparedMotionscaperAeExport } from './editor-ae-export-conversion.ts';

export const MOTION_AE_EXPORT_PACKAGE_LIMITS = Object.freeze({ originalArchiveBytes: 128 * 1024 * 1024, packageBytes: 256 * 1024 * 1024, chunkBytes: 4 * 1024 * 1024 });
type ReadAsset = (asset: MotionAsset, signal?: AbortSignal) => PromiseLike<MotionAssetBody | null> | MotionAssetBody | null;
const README = 'Motionscaper to After Effects — development bridge, unqualified\n\n'
	+ 'Keep this entire package. original.mscape preserves the exact Motion source snapshot, its complete asset closure and any earlier interchange custody. It includes unused assets and audio. No Save publication was performed to create this package.\n'
	+ 'motionae.json contains a partial editable transfer with reviewed 2D, text/shape, mask/matte, layer-blend and camera/ambient subsets. conversion-report.json records omissions. The imported subset is video-only: every imported layer is muted, including nested compositions.\n'
	+ 'Download Bridge Scripts through File > After Effects Bridge in Motionscaper. Extract every script and include into one folder. In installed After Effects, open a separate destination project with Working Space None, Linear Blending enabled and 32 bits per channel. This staging profile is not a color-fidelity claim.\n'
	+ 'Choose File > Scripts > Run Script File, run Motionscaper-Import.jsx from bridge 0.1.0, and select this package\'s motionae.json. It verifies media and creates a new owned folder without saving or changing existing items. Keep media beside this manifest.\n'
	+ 'Review every unsupported entry and compare structure and reference frames in installed AE. No AE version is qualified. Source interpretation, color/alpha, interpolation and timing need actual installed-host qualification. Fonts, text, shapes, 3D, effects, masks, mattes, expressions and audio may be preserved only in original.mscape.\n';

/** Complete snapshot custody plus separately verified AE media; never publishes or rewrites the source project. */
export async function createMotionscaperAeExportPackage(prepared: PreparedMotionscaperAeExport, readAsset: ReadAsset, options: Readonly<{
	acknowledgeUnsupported: boolean; signal?: AbortSignal;
}>): Promise<Blob> {
	const { signal } = options;
	throwIfScapeAborted(signal); assertPreparedMotionscaperAeExport(prepared);
	if (options.acknowledgeUnsupported !== true) throw new Error('Review and acknowledge the unsupported AE export report before downloading this partial transfer.');
	const original = await exportMotionscaperArchive(prepared.revision.project, readAsset, { maximumBlobBytes: MOTION_AE_EXPORT_PACKAGE_LIMITS.originalArchiveBytes, signal });
	if (!original) throw new Error('AE export did not preserve its original project archive.');
	const texts = [
		{ filename: 'motionae.json', text: JSON.stringify(prepared.exchange) },
		{ filename: 'conversion-report.json', text: JSON.stringify({ format: 'org.motionscaper.ae-export-report', version: 1, sourceRevisionDigest: prepared.revision.digest, report: prepared.exchange.report }) },
		{ filename: 'README.txt', text: README },
	];
	const maximum = maximumScapeStoreArchiveBytes([{ filename: 'original.mscape', payloadBytes: original.size },
		...texts.map(item => ({ filename: item.filename, payloadBytes: new TextEncoder().encode(item.text).byteLength })),
		...prepared.media.map(item => ({ filename: item.path, payloadBytes: item.asset.byteLength }))]);
	if (maximum > MOTION_AE_EXPORT_PACKAGE_LIMITS.packageBytes) throw new RangeError('AE export exceeds the 256 MiB package memory limit. Save a full .mscape copy or prepare a smaller transfer.');
	const chunks: ArrayBuffer[] = [];
	const destination = createScapeExportDestination(new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk.slice().buffer); } }), 'application/zip', maximum);
	const writer = new ZipWriter(destination.target, { level: 0, zip64: true, dataDescriptor: true, dataDescriptorSignature: true, extendedTimestamp: true, useWebWorkers: false, signal });
	try {
		await writer.add('original.mscape', new BlobReader(original), { level: 0, zip64: true, signal });
		for (const item of prepared.media) {
			throwIfScapeAborted(signal);
			const body = await readAsset(item.asset, signal); throwIfScapeAborted(signal);
			if (!body || body.size !== item.asset.byteLength || typeof body.stream !== 'function') throw new Error(`AE media ${item.asset.id} is unavailable or its byte length changed.`);
			const digest = createScapeDigest(); let size = 0;
			const stream = body.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
				throwIfScapeAborted(signal);
				if (!(chunk instanceof Uint8Array) || chunk.byteLength > MOTION_AE_EXPORT_PACKAGE_LIMITS.chunkBytes || chunk.byteLength > item.asset.byteLength - size) throw new RangeError('AE media stream exceeded its bounded chunk or declared byte length.');
				size += chunk.byteLength; digest.update(chunk); controller.enqueue(chunk);
			} }), signal ? { signal } : undefined);
			await writer.add(item.path, stream, { level: 0, zip64: true, signal });
			if (size !== item.asset.byteLength || scapeHex(digest.digest()) !== item.asset.sha256) throw new Error(`AE media ${item.asset.id} digest or length changed while exporting.`);
		}
		for (const item of texts) { throwIfScapeAborted(signal); await writer.add(item.filename, new TextReader(item.text), { level: 0, zip64: true, signal }); }
		await destination.finish(writer, signal); throwIfScapeAborted(signal); return new Blob(chunks, { type: 'application/zip' });
	} catch (error) { return await destination.abort(writer, error); }
	finally { chunks.length = 0; }
}
