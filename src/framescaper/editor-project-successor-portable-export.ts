/* SPDX-License-Identifier: AGPL-3.0-only */
import { TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import { createScapeDigest, digestScapeBytes, scapeAudioSourceStream, scapeBytesStream, scapeHex, type ScapeAudioSource } from '../common/editor/scape-archive-media.ts';
import { SCAPE_ARCHIVE_LIMITS, SCAPE_FORMAT, SCAPE_FORMAT_VERSION, type ScapeManifest } from '../common/editor/scape-archive-envelope.ts';
import { assertScapeExportBlob, prepareScapeExport, completeScapeExportAsset, serializeScapeExportManifest, type ScapeExportPlan, type PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts';
import { maximumScapeStoreArchiveBytes, resolveScapeBlobMaximumBytes } from '../common/editor/scape-export-estimate.ts';
import { awaitScapeReadOperation } from '../common/editor/scape-abort.ts';
import { createScapeExportDestination } from '../common/editor/scape-export-destination.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { validateVideoTimingAssetBytes } from '../common/editor/video-timing-asset.ts';
import { framescaperSuccessorPortableAssets } from './editor-project-successor-portable-assets.ts';
import { createFramescaperLinkedAssetDescriptor } from './editor-project-successor-link-assets.ts';
import type { FileSizeWarningConfirmation } from '../common/editor/controller/shared/file-size-warning.ts';

export interface FramescaperSuccessorPortableExportStore {
	getMediaAssetMetadata(id: string): PromiseLike<unknown> | unknown;
	loadMediaAsset(id: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
	readSourceChunks(id: string, options?: Readonly<{ signal?: AbortSignal }>): AsyncIterable<readonly Float32Array[] | Readonly<{ channels?: readonly Float32Array[] }>>;
}
export interface FramescaperSuccessorPortableExportOptions {
	readonly readAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>;
	readonly signal?: AbortSignal; readonly maximumBlobBytes?: number; readonly writable?: WritableStream<Uint8Array>;
	readonly createWritable?: (maximumBytes: number) => Promise<WritableStream<Uint8Array>>;
	readonly assertCurrent?: () => void; readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
}

/** Assemble current schema2 intent directly. Neither a baseline archive nor synthetic virtual media is produced. */
export async function exportFramescaperSuccessorPortableArchive(value: unknown, store: FramescaperSuccessorPortableExportStore, options: FramescaperSuccessorPortableExportOptions): Promise<Readonly<{ blob: Blob | null; manifest: ScapeManifest; byteLength: number }>> {
	const { signal } = options; signal?.throwIfAborted(); options.assertCurrent?.();
	if (options.writable && options.createWritable) throw new TypeError('Choose one successor archive destination.');
	const closure = framescaperSuccessorPortableAssets(value);
	const metadataStore = { getMediaAssetMetadata: (id: string) => awaitScapeReadOperation(() => store.getMediaAssetMetadata(id), signal) };
	const additionalAssets = await closure.extension.planExportAssets({ project: closure.baseline, store: metadataStore, signal }); signal?.throwIfAborted();
	const ordinary = await prepareScapeExport(closure.ordinary, metadataStore, { output: 'stream', currentProjectSchemaFamily: 'framescaper', currentProjectSchemaVersion: 1, signal,
		additionalSourceKinds: closure.extension.sourceKinds, additionalAssets, assertCurrent: options.assertCurrent, confirmFileSizeWarning: options.confirmFileSizeWarning });
	const byDigest = new Map(closure.linked.map(asset => [asset.sha256, asset]));
	const linked: PlannedScapeExportAsset[] = closure.linked.map(asset => ({ ...createFramescaperLinkedAssetDescriptor(asset), source: {}, storageKey: asset.sha256, expectedSha256: asset.sha256, mimeType: 'application/octet-stream' }));
	const assets = [...ordinary.assets]; const entries = new Set(assets.map(asset => asset.entry));
	for (const asset of [...closure.timing.values(), ...linked]) {
		const prior = assets.find(candidate => candidate.sourceId === asset.sourceId);
		if (prior) { if (asset.kind !== 'video-timing' || JSON.stringify(prior.timingReference) !== JSON.stringify(asset.timingReference)) throw new RangeError('Successor portable asset ownership collides.'); continue; }
		if (entries.has(asset.entry)) throw new RangeError('Successor portable entry ownership collides.'); entries.add(asset.entry); assets.push(asset);
	}
	const projectBytes = new TextEncoder().encode(JSON.stringify(closure.project));
	const projectDescriptor = { entry: 'project.json', mimeType: 'application/json', schemaFamily: 'framescaper' as const, schemaVersion: 2, size: projectBytes.length, sha256: digestScapeBytes(projectBytes) };
	const placeholder: ScapeManifest = { format: SCAPE_FORMAT, formatVersion: SCAPE_FORMAT_VERSION, createdAt: ordinary.createdAt, project: projectDescriptor, assets: assets.map(asset => completeScapeExportAsset(asset, '0'.repeat(64))) };
	const manifestBytes = new TextEncoder().encode(JSON.stringify(placeholder)).length;
	if (projectBytes.length > SCAPE_ARCHIVE_LIMITS.maximumProjectBytes || manifestBytes > SCAPE_ARCHIVE_LIMITS.maximumManifestBytes || assets.length + 2 > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) throw new RangeError('Successor archive metadata exceeds its admission budget.');
	const inventory = [{ filename: 'project.json', payloadBytes: projectBytes.length }, { filename: 'manifest.json', payloadBytes: manifestBytes }, ...assets.map(asset => ({ filename: asset.entry, payloadBytes: asset.size }))];
	if (inventory.reduce((sum, asset) => sum + BigInt(asset.payloadBytes), 0n) > BigInt(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes)) throw new RangeError('Successor archive exceeds its expanded-byte budget.');
	const maximumArchiveBytes = maximumScapeStoreArchiveBytes(inventory); const maximumBlobBytes = resolveScapeBlobMaximumBytes(options.maximumBlobBytes);
	if (!options.writable && !options.createWritable && maximumArchiveBytes > maximumBlobBytes) throw new RangeError('Successor archive exceeds Blob admission; choose a streaming destination.');
	const plan: ScapeExportPlan = { ...ordinary, assets, projectBytes, projectDescriptor, manifestBytes, maximumArchiveBytes, maximumBlobBytes };
	signal?.throwIfAborted(); options.assertCurrent?.(); const writable = options.createWritable ? await options.createWritable(maximumArchiveBytes) : options.writable;
	const destination = createScapeExportDestination(writable, 'application/vnd.framescaper.scape+zip', maximumArchiveBytes);
	const writer = new ZipWriter(destination.target, { level: 0, zip64: true, dataDescriptor: true, dataDescriptorSignature: true, extendedTimestamp: true, useWebWorkers: false, signal });
	try {
		await writer.add('project.json', scapeBytesStream(projectBytes), { signal }); const completed = [];
		for (const asset of assets) {
			signal?.throwIfAborted(); const digest = createScapeDigest(); let size = 0; let stream: ReadableStream<Uint8Array>;
			const motionAsset = byDigest.get(asset.storageKey);
			if (asset.kind === 'audio') stream = scapeAudioSourceStream(store, asset.source as ScapeAudioSource, digest, count => { size += count; }, signal, plan.audioChunkBudget);
			else {
				let body: MotionAssetBody;
				if (asset.body) body = { size: asset.body.length, stream: () => scapeBytesStream(asset.body!) };
				else if (motionAsset) { const loaded = await awaitScapeReadOperation(() => options.readAsset(motionAsset, signal), signal); if (!loaded) throw new RangeError(`Linked original ${motionAsset.id} is unavailable.`); body = loaded; }
				else {
					const loaded = await awaitScapeReadOperation(() => store.loadMediaAsset(asset.storageKey, { signal }), signal); if (!loaded) throw new RangeError(`Ordinary media ${asset.sourceId} is unavailable.`);
					const blob = canonicalMediaContentBlob(loaded);
					if (blob.size !== asset.size) throw new RangeError('Successor media size changed after admission.');
					if (asset.timingReference) validateVideoTimingAssetBytes(asset.timingReference, new Uint8Array(await blob.arrayBuffer()));
					if (closure.extension.assetKinds.includes(asset.kind)) await closure.extension.validateExportAssetBody(asset, blob, signal);
					body = blob;
				}
				signal?.throwIfAborted(); if (body.size !== asset.size) throw new RangeError('Successor body size changed after admission.');
				stream = body.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
					signal?.throwIfAborted(); if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > 4 * 1024 * 1024 || chunk.length > asset.size - size) throw new RangeError('Successor body exceeds its chunk/length contract.');
					const retained = chunk.slice(); size += retained.length; digest.update(retained); controller.enqueue(retained);
				} }), { signal });
			}
			await writer.add(asset.entry, stream, { signal }); if (size !== asset.size) throw new RangeError('Successor body length changed.');
			const hash = scapeHex(digest.digest()); if (asset.expectedSha256 && hash !== asset.expectedSha256) throw new RangeError('Successor body digest changed.'); completed.push(completeScapeExportAsset(asset, hash));
		}
		options.assertCurrent?.(); const manifest = serializeScapeExportManifest(plan, completed); await writer.add('manifest.json', new TextReader(manifest.text), { signal });
		const blob = await destination.finish(writer, signal); if (blob) assertScapeExportBlob(plan, blob); return { blob, manifest: manifest.manifest, byteLength: destination.byteLength };
	} catch (error) { return destination.abort(writer, error); }
}
