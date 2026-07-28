import { sha256 } from '@noble/hashes/sha2.js';
import {
	BlobReader,
	BlobWriter,
	TextReader,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createStableId } from './project.js';
import { migrateAudioEditorProject } from './migration.js';
import {
	readScapeArchiveEnvelope,
	SCAPE_FORMAT,
	SCAPE_FORMAT_VERSION,
	SCAPE_MANIFEST_ENTRY,
	SCAPE_PROJECT_ENTRY,
} from './scape-archive-envelope.ts';

export { SCAPE_FORMAT, SCAPE_FORMAT_VERSION };
export const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
export const SCAPE_FILE_EXTENSION = '.scape';

const PROJECT_ENTRY = SCAPE_PROJECT_ENTRY;
const MANIFEST_ENTRY = SCAPE_MANIFEST_ENTRY;
const AUDIO_ENCODING = 'audio-f32le-chunks-v1';
const TEXT_ENCODER = new TextEncoder();

export async function exportScapeProject(project, store, options = {}) {
	if (!project || typeof project !== 'object') throw new TypeError('A project is required.');
	if (!store?.readSourceChunks || !store?.loadMediaAsset) throw new TypeError('A project store is required.');
	const output = options.writable || new BlobWriter(SCAPE_MIME_TYPE);
	const writer = new ZipWriter(output, { zip64: true, level: 0, useWebWorkers: false });
	const projectBytes = TEXT_ENCODER.encode(JSON.stringify(project));
	const projectDigest = digestBytes(projectBytes);
	const assets = [];

	try {
		await writer.add(PROJECT_ENTRY, bytesStream(projectBytes), { level: 0, zip64: true });
		for (const source of project.sources || []) {
			const entry = source.kind === 'video'
				? `media/${safeEntryId(source.id)}/original`
				: `audio/${safeEntryId(source.id)}.f32c`;
			const digest = sha256.create();
			let size = 0;
			if (source.kind === 'video') {
				const blob = await store.loadMediaAsset(source.storageKey || source.id);
				if (!blob) throw new Error(`Media source ${source.name || source.id} is unavailable.`);
				size = blob.size;
				await writer.add(entry, hashingStream(blob.stream(), digest), { level: 0, zip64: true });
			} else {
				const stream = audioSourceStream(store, source, digest, (byteLength) => { size += byteLength; });
				await writer.add(entry, stream, { level: 0, zip64: true });
			}
			assets.push({
				sourceId: source.id,
				kind: source.kind === 'video' ? 'video' : 'audio',
				entry,
				encoding: source.kind === 'video' ? 'original' : AUDIO_ENCODING,
				mimeType: String(source.mimeType || ''),
				size,
				sha256: hex(digest.digest()),
			});
		}
		const manifest = {
			format: SCAPE_FORMAT,
			formatVersion: SCAPE_FORMAT_VERSION,
			createdAt: new Date().toISOString(),
			project: {
				entry: PROJECT_ENTRY,
				mimeType: 'application/json',
				schemaVersion: project.schemaVersion,
				size: projectBytes.byteLength,
				sha256: projectDigest,
			},
			assets,
		};
		await writer.add(MANIFEST_ENTRY, new TextReader(JSON.stringify(manifest)), { level: 0, zip64: true });
		const result = await writer.close(undefined, { zip64: true });
		return { blob: options.writable ? null : result, manifest };
	} catch (error) {
		await writer.close().catch(() => undefined);
		throw error;
	}
}

export async function importScapeProject(input, store, options = {}) {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	if (!store?.saveProject || !store?.loadProject) throw new TypeError('A project store is required.');
	const reader = new ZipReader(new BlobReader(input), { useWebWorkers: false, strictness: 'strict' });
	const stagedSourceIds = [];
	try {
		const entries = await reader.getEntries({ strictness: 'strict' });
		const { entryByName, manifest, projectText } = await readScapeArchiveEnvelope(entries);
		const projectBytes = TEXT_ENCODER.encode(projectText);
		verifyAssetBytes(projectBytes, manifest.project, 'project document');
		const loaded = migrateAudioEditorProject(JSON.parse(projectText));
		let project = structuredClone(loaded.project);
		const existingProject = await store.loadProject(project.id);
		const collision = options.collision || 'copy';
		if (existingProject && collision === 'cancel') throw new Error('A project with this ID already exists.');
		if (existingProject && collision === 'copy') {
			project.id = createStableId('project');
			project.title = `${project.title || 'Untitled'} copy`;
			project.revision = 0;
			project.createdAt = new Date().toISOString();
			project.updatedAt = project.createdAt;
		}

		const assetBySourceId = new Map(manifest.assets.map((asset) => [asset.sourceId, asset]));
		if (assetBySourceId.size !== manifest.assets.length) throw new Error('The .scape manifest contains duplicate source assets.');
		const sourceIdMap = new Map();
		for (const source of project.sources || []) {
			const asset = assetBySourceId.get(source.id);
			if (!asset) throw new Error(`The .scape archive is missing source ${source.id}.`);
			if ((source.kind === 'video' ? 'video' : 'audio') !== asset.kind) throw new Error(`Source ${source.id} has an incompatible asset kind.`);
			const occupied = source.kind === 'video'
				? await store.getMediaAssetMetadata?.(source.storageKey || source.id)
				: await store.getSourceMetadata?.(source.storageKey || source.id);
			const nextId = occupied ? createStableId(source.kind === 'video' ? 'video-source' : 'source') : source.id;
			sourceIdMap.set(source.id, nextId);
			source.id = nextId;
			source.storageKey = nextId;
		}
		for (const clip of [...(project.clips || []), ...(project.projectBin?.clips || [])]) {
			clip.sourceId = sourceIdMap.get(clip.sourceId) || clip.sourceId;
		}

		for (const [originalSourceId, finalSourceId] of sourceIdMap) {
			const source = project.sources.find((candidate) => candidate.id === finalSourceId);
			const asset = assetBySourceId.get(originalSourceId);
			const entry = entryByName.get(asset.entry);
			if (!entry) throw new Error(`The .scape archive is missing ${asset.entry}.`);
			if (source.kind === 'video') {
				const { blob, digest, size } = await extractBlob(entry, source.mimeType);
				verifyExtractedAsset(asset, digest, size, source.name || source.id);
				await store.writeMediaAsset(finalSourceId, blob, {
					name: source.name,
					mimeType: source.mimeType,
				});
			} else {
				if (asset.encoding !== AUDIO_ENCODING) throw new Error(`Unsupported audio asset encoding: ${asset.encoding}.`);
				const writer = await store.beginSourceWrite(finalSourceId, {
					name: source.name,
					mimeType: source.mimeType,
					sampleRate: source.sampleRate,
					channelCount: source.channelCount,
					chunkFrames: source.chunkFrames,
				});
				try {
					const extracted = await extractAudio(entry, writer, source);
					verifyExtractedAsset(asset, extracted.digest, extracted.size, source.name || source.id);
					await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
				} catch (error) {
					await writer.abort().catch(() => undefined);
					throw error;
				}
			}
			stagedSourceIds.push(finalSourceId);
		}
		await store.saveProject(project);
		return { project, manifest, readOnly: loaded.readOnly, reason: loaded.reason, collision: existingProject ? collision : null };
	} catch (error) {
		for (const sourceId of stagedSourceIds.reverse()) await store.deleteSource?.(sourceId).catch(() => undefined);
		throw error;
	} finally {
		await reader.close().catch(() => undefined);
	}
}

export async function inspectScapeProject(input, store = null) {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	const reader = new ZipReader(new BlobReader(input), { useWebWorkers: false, strictness: 'strict' });
	try {
		const entries = await reader.getEntries({ strictness: 'strict' });
		const { manifest, projectText } = await readScapeArchiveEnvelope(entries);
		verifyAssetBytes(TEXT_ENCODER.encode(projectText), manifest.project, 'project document');
		const loaded = migrateAudioEditorProject(JSON.parse(projectText));
		return Object.freeze({
			id: loaded.project.id,
			title: loaded.project.title,
			schemaVersion: loaded.project.schemaVersion,
			readOnly: loaded.readOnly,
			exists: Boolean(store?.loadProject && await store.loadProject(loaded.project.id)),
			manifest,
		});
	} finally {
		await reader.close().catch(() => undefined);
	}
}
function safeEntryId(value) {
	return encodeURIComponent(String(value || '')).replaceAll('%', '_');
}

function bytesStream(bytes) {
	return new Blob([bytes]).stream();
}

function hashingStream(stream, digest) {
	return stream.pipeThrough(new TransformStream({
		transform(chunk, controller) {
			const bytes = toBytes(chunk);
			digest.update(bytes);
			controller.enqueue(bytes);
		},
	}));
}

function audioSourceStream(store, source, digest, onBytes) {
	const iterator = store.readSourceChunks(source.storageKey || source.id)[Symbol.asyncIterator]();
	let queue = [];
	return new ReadableStream({
		async pull(controller) {
			if (!queue.length) {
				const next = await iterator.next();
				if (next.done) {
					controller.close();
					return;
				}
				const channels = Array.isArray(next.value) ? next.value : next.value?.channels;
				if (!channels?.length || channels.length !== source.channelCount) throw new Error(`Stored PCM for ${source.id} is invalid.`);
				const frameCount = channels[0].length;
				if (!channels.every((channel) => channel.length === frameCount)) throw new Error(`Stored PCM for ${source.id} is not aligned.`);
				const header = new Uint8Array(4);
				new DataView(header.buffer).setUint32(0, frameCount, true);
				queue = [header, ...channels.map(float32LittleEndianBytes)];
			}
			const bytes = queue.shift();
			digest.update(bytes);
			onBytes(bytes.byteLength);
			controller.enqueue(bytes);
		},
		async cancel() { await iterator.return?.(); },
	});
}

async function extractBlob(entry, mimeType) {
	const digest = sha256.create();
	let size = 0;
	const transform = new TransformStream({
		transform(chunk, controller) {
			const bytes = toBytes(chunk);
			digest.update(bytes);
			size += bytes.byteLength;
			controller.enqueue(bytes);
		},
	});
	const blobPromise = new Response(transform.readable, { headers: { 'content-type': mimeType || 'application/octet-stream' } }).blob();
	await entry.getData(transform.writable);
	return { blob: await blobPromise, digest: hex(digest.digest()), size };
}

async function extractAudio(entry, sourceWriter, source) {
	const digest = sha256.create();
	let size = 0;
	let pending = new Uint8Array(0);
	let writtenFrames = 0;
	const writable = new WritableStream({
		async write(chunk) {
			const bytes = toBytes(chunk);
			digest.update(bytes);
			size += bytes.byteLength;
			pending = concatBytes(pending, bytes);
			while (pending.byteLength >= 4) {
				const frameCount = new DataView(pending.buffer, pending.byteOffset, 4).getUint32(0, true);
				if (!frameCount) throw new Error(`Audio source ${source.id} contains an empty chunk.`);
				const chunkBytes = 4 + frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT;
				if (pending.byteLength < chunkBytes) break;
				const channels = [];
				let offset = 4;
				for (let channel = 0; channel < source.channelCount; channel += 1) {
					channels.push(littleEndianBytesToFloat32(pending.subarray(offset, offset + frameCount * 4)));
					offset += frameCount * 4;
				}
				await sourceWriter.write(channels);
				writtenFrames += frameCount;
				pending = pending.slice(chunkBytes);
			}
		},
	});
	await entry.getData(writable);
	if (pending.byteLength) throw new Error(`Audio source ${source.id} ends with an incomplete chunk.`);
	if (writtenFrames !== source.frameCount) throw new Error(`Audio source ${source.id} has an unexpected frame count.`);
	return { digest: hex(digest.digest()), size };
}

function verifyAssetBytes(bytes, descriptor, label) {
	verifyExtractedAsset(descriptor, digestBytes(bytes), bytes.byteLength, label);
}

function verifyExtractedAsset(descriptor, digest, size, label) {
	if (size !== descriptor.size) throw new Error(`${label} has an unexpected size.`);
	if (digest !== descriptor.sha256) throw new Error(`${label} failed SHA-256 verification.`);
}

function digestBytes(bytes) {
	return hex(sha256(bytes));
}

function hex(bytes) {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function toBytes(value) {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function concatBytes(left, right) {
	if (!left.byteLength) return right.slice();
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left);
	result.set(right, left.byteLength);
	return result;
}

function float32LittleEndianBytes(channel) {
	if (!(channel instanceof Float32Array)) throw new TypeError('PCM chunks must contain Float32Array channels.');
	if (littleEndianPlatform()) return new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength).slice();
	const bytes = new Uint8Array(channel.byteLength);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < channel.length; index += 1) view.setFloat32(index * 4, channel[index], true);
	return bytes;
}

function littleEndianBytesToFloat32(bytes) {
	const result = new Float32Array(bytes.byteLength / 4);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let index = 0; index < result.length; index += 1) result[index] = view.getFloat32(index * 4, true);
	return result;
}

let isLittleEndian;
function littleEndianPlatform() {
	if (isLittleEndian !== undefined) return isLittleEndian;
	const words = new Uint16Array([0x00ff]);
	isLittleEndian = new Uint8Array(words.buffer)[0] === 0xff;
	return isLittleEndian;
}
