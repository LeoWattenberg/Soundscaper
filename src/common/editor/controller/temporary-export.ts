import { cloneProject } from '../project.js';
import { normalizeAutomationLaneV21 } from '../automation-lane-v21.ts';
import { normalizeMixerGraphV21, type MixerGraphV21 } from '../mixer-graph-v21.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../project-owned-feature-requirements.ts';
import { isSoundscaperProductionProjectSchema } from '../project-schema-version.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';
import {
	createSequentialZip32Archive,
	type Zip32StreamInput,
} from './sequential-zip32-stream.ts';

export interface TemporaryExportCopy {
	readonly temporaryExportClosed: string;
	readonly largeStemsStorageRequired: string;
	readonly stemArchiveClosed: string;
}

export interface TemporaryFileSink {
	readonly persistent: boolean;
	write(chunk: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<void>;
	writeAt(position: number, chunk: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<void>;
	close(mimeType: string): Promise<Blob>;
	remove(): Promise<void>;
	abort(): Promise<void>;
}

export interface StreamingStemArchive {
	add(
		fileName: string,
		input: Zip32StreamInput,
		signal?: AbortSignal | null,
	): Promise<void>;
	finish(): Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }>;
	abort(): Promise<void>;
}

export type StreamingZipArchive = StreamingStemArchive;

export async function createTemporaryFileSink(name: string, copy: TemporaryExportCopy): Promise<TemporaryFileSink> {
	let directory: FileSystemDirectoryHandle | null = null;
	let handle: FileSystemFileHandle | null = null;
	let writable: FileSystemWritableFileStream | null = null;
	const chunks: Uint8Array[] = [];
	let queue = Promise.resolve();
	let closed = false;
	let scheduledByteLength = 0;
	try {
		const storage = globalThis.navigator?.storage as StorageManager & {
			getDirectory?(): Promise<FileSystemDirectoryHandle>;
		};
		const root = await storage?.getDirectory?.();
		directory = await root?.getDirectoryHandle?.('audio-editor-exports', { create: true }) || null;
		handle = await directory?.getFileHandle?.(name, { create: true }) || null;
		writable = await handle?.createWritable?.() || null;
	} catch {
		try {
			await writable?.abort?.();
			if (directory && handle) await directory.removeEntry(name);
		} catch {
			// Best-effort cleanup after OPFS setup fails.
		}
		directory = null;
		handle = null;
		writable = null;
	}
	return {
		persistent: Boolean(writable),
		write(chunk): Promise<void> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			const bytes = Uint8Array.from(toUint8Array(chunk));
			const position = scheduledByteLength;
			scheduledByteLength = addSafeByteLengths(scheduledByteLength, bytes.byteLength);
			if (writable) {
				queue = queue.then(() => writable!.write({ type: 'write', position, data: bytes }));
			}
			else queue = queue.then(() => { chunks.push(bytes); });
			return queue;
		},
		writeAt(position, chunk): Promise<void> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			const bytes = Uint8Array.from(toUint8Array(chunk));
			validateWriteRange(position, bytes.byteLength, scheduledByteLength);
			if (writable) {
				queue = queue.then(() => writable!.write({ type: 'write', position, data: bytes }));
			} else {
				queue = queue.then(() => { patchChunks(chunks, position, bytes); });
			}
			return queue;
		},
		async close(mimeType): Promise<Blob> {
			if (closed) throw new Error(copy.temporaryExportClosed);
			closed = true;
			await queue;
			if (writable && handle) {
				await writable.close();
				const file = await handle.getFile();
				return file.type === mimeType ? file : file.slice(0, file.size, mimeType);
			}
			return new Blob(chunks as BlobPart[], { type: mimeType });
		},
		async remove(): Promise<void> {
			if (directory && handle) {
				try {
					await directory.removeEntry(name);
				} catch {
					// Already removed.
				}
			}
		},
		async abort(): Promise<void> {
			closed = true;
			queue = queue.catch(() => undefined);
			await queue;
			try {
				await writable?.abort?.();
			} catch {
				// The writer may already be closed.
			}
			if (directory && handle) {
				try {
					await directory.removeEntry(name);
				} catch {
					// Already removed.
				}
			}
		},
	};
}

export async function createStreamingZipArchive(
	name: string,
	estimatedInputBytes = 0,
	copy: TemporaryExportCopy,
): Promise<StreamingZipArchive> {
	const sink = await createTemporaryFileSink(name, copy);
	if (!sink.persistent && estimatedInputBytes > 96 * 1024 ** 2) {
		await sink.abort();
		throw new Error(copy.largeStemsStorageRequired);
	}
	const archive = await createSequentialZip32Archive({
		write: (chunk) => sink.write(chunk),
		close: () => sink.close('application/zip'),
		abort: () => sink.abort(),
	}, {
		closedMessage: copy.stemArchiveClosed,
		limitMessage: 'ZIP32 limits exceeded; use a 7z archive for these stems.',
		concurrentAddMessage: 'Stem archive additions must be awaited in order.',
	});
	let finishPromise: Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }> | null = null;
	let finishedResult: { readonly blob: Blob; readonly cleanup: () => Promise<void> } | null = null;

	return {
		add: (fileName, input, signal = null) => archive.add(fileName, input, signal),
		finish() {
			if (finishedResult) return Promise.resolve(finishedResult);
			if (!finishPromise) {
				finishPromise = archive.finish().then(({ output: blob }) => {
					finishedResult = { blob, cleanup: () => sink.remove() };
					return finishedResult;
				});
				void finishPromise.catch(() => { finishPromise = null; });
			}
			return finishPromise;
		},
		abort: () => archive.abort(),
	};
}

export function stemProject(
	project: Parameters<typeof cloneProject>[0],
	trackId: string,
): ReturnType<typeof cloneProject> {
	const mediaProject = projectTrackFolderMediaStateV12(project);
	const snapshot = inheritTrackFolderMediaStateProjectionV12(
		mediaProject,
		cloneProject(mediaProject),
	);
	const production = isSoundscaperProductionProjectSchema(snapshot.schemaVersion);
	snapshot.tracks = snapshot.tracks.map((track) => track.id === trackId
		? { ...track, mute: false, solo: false }
		: { ...track, mute: true, solo: false, ...(production ? {} : { effects: [] }) });
	if (production) projectProductionStemSnapshot(snapshot, trackId);
	else snapshot.master = { gain: 1, effects: [] };
	return snapshot;
}

interface MutableProductionStemProject {
	featureRequirements: unknown;
	master: Record<string, unknown>;
	mixer: MixerGraphV21;
	automationLanes: unknown[];
}

function projectProductionStemSnapshot(value: unknown, trackId: string): void {
	const project = value as MutableProductionStemProject;
	const graph = normalizeMixerGraphV21(project.mixer);
	const silencedEdgeIds = new Set<string>();
	const edges = graph.edges.flatMap((edge) => {
		if (edge.destination.kind === 'effect-sidechain'
			&& edge.destination.strip.kind === 'master') return [];
		if (edge.kind !== 'sidechain' && edge.source.kind === 'track' && edge.source.id !== trackId) {
			silencedEdgeIds.add(edge.id);
			return [{ ...edge, level: 0 }];
		}
		return [edge];
	});
	const automatedEdgeIds = new Set(edges
		.filter(({ id }) => !silencedEdgeIds.has(id))
		.map(({ id }) => id));
	project.mixer = normalizeMixerGraphV21({ ...graph, edges });
	project.automationLanes = project.automationLanes.filter((value) => {
		const { address } = normalizeAutomationLaneV21(value);
		if (address.kind === 'edge') return automatedEdgeIds.has(address.edgeId);
		return address.strip.kind !== 'master';
	});
	project.master = {
		...project.master,
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		effectsActive: false,
		effects: [],
	};
	project.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		project as unknown as Readonly<Record<string, unknown>>,
		project.featureRequirements as never,
	);
}

function toUint8Array(input: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return new Uint8Array(input);
}

function addSafeByteLengths(left: number, right: number): number {
	if (!Number.isSafeInteger(right) || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('Temporary export size exceeds JavaScript\'s safe-integer range.');
	}
	return left + right;
}

function validateWriteRange(position: number, byteLength: number, availableByteLength: number): void {
	if (!Number.isSafeInteger(position) || position < 0
		|| position > availableByteLength
		|| byteLength > availableByteLength - position) {
		throw new RangeError('Positioned writes must stay within bytes already written to the temporary export.');
	}
}

function patchChunks(chunks: readonly Uint8Array[], position: number, bytes: Uint8Array): void {
	let chunkStart = 0;
	let sourceOffset = 0;
	for (const chunk of chunks) {
		const chunkEnd = chunkStart + chunk.byteLength;
		if (position < chunkEnd && sourceOffset < bytes.byteLength) {
			const destinationOffset = Math.max(0, position - chunkStart);
			const copyLength = Math.min(chunk.byteLength - destinationOffset, bytes.byteLength - sourceOffset);
			chunk.set(bytes.subarray(sourceOffset, sourceOffset + copyLength), destinationOffset);
			sourceOffset += copyLength;
			position += copyLength;
		}
		chunkStart = chunkEnd;
		if (sourceOffset === bytes.byteLength) return;
	}
}
