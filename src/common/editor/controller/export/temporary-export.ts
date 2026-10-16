import { cloneProject } from '../../project.js';
import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../shared/file-size-warning.ts';
import { isSoundscaperProductionProject } from '../../project-schema-version.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../../track-folder-media-runtime.ts';
import {
	createSequentialZip32Archive,
	type Zip32StreamInput,
} from './internal/archive/sequential-zip32-stream.ts';
import { projectProductionStemSnapshot } from './internal/production-stem-projection.ts';

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
	const { createTemporaryFileSink: createSink } = await import('../../storage/temporary-export-sink.ts');
	return createSink(name, copy);
}

export async function createStreamingZipArchive(
	name: string,
	estimatedInputBytes = 0,
	copy: TemporaryExportCopy,
	warningOptions: FileSizeWarningOptions = {},
): Promise<StreamingZipArchive> {
	const sink = await createTemporaryFileSink(name, copy);
	try {
		if (!sink.persistent) await confirmFileSizeWarning(estimatedInputBytes, 96 * 1024 ** 2, 'Audio stem archive staging', warningOptions);
	} catch (error) {
		await sink.abort();
		throw error;
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

export function stemProject<Project extends object>(
	project: Project,
	trackId: string,
): Project {
	const mediaProject = projectTrackFolderMediaStateV12(project);
	const snapshot = inheritTrackFolderMediaStateProjectionV12(
		mediaProject,
		cloneProject(mediaProject),
	);
	const mutable = snapshot as unknown as MutableStemProject;
	const production = isSoundscaperProductionProject(mutable);
	if (production) projectProductionStemSnapshot(mutable, trackId);
	else {
		mutable.tracks = mutable.tracks.map(track => track.id === trackId
			? { ...track, mute: false, solo: false }
			: { ...track, mute: true, solo: false, effects: [] });
		mutable.master = { gain: 1, effects: [] };
	}
	return snapshot;
}

interface MutableStemProject {
	schemaVersion?: unknown;
	tracks: Record<string, unknown>[];
	master: Record<string, unknown>;
}
