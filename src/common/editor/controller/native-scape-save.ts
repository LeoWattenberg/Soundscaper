/* SPDX-License-Identifier: AGPL-3.0-only */

import { recordScapeArchiveManifest } from './scape-archive-manifest-action.ts';
import type {
	NativePreparedSave,
	NativeProjectDocument,
	NativeProjectFileService,
	NativeProjectServiceRuntime,
	NativeSavedFile,
	SaveScapeOptions,
	ScapeExportResult,
} from './native-project-types.ts';

const SCAPE_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'Scape project',
	accept: Object.freeze({
		'application/vnd.soundscaper.scape+zip': Object.freeze(['.scape']),
	}),
})]);

export async function prepareNativeScapeSave(
	fileService: NativeProjectFileService,
	request: Readonly<{
		fileName: string;
		mimeType: string;
		options: SaveScapeOptions;
		signal: AbortSignal;
	}>,
): Promise<NativePreparedSave> {
	return fileService.prepareSave({
		purpose: 'project',
		suggestedName: request.fileName,
		mimeType: request.mimeType,
		target: request.options.saveTarget,
		types: SCAPE_FILE_TYPES,
		useFileSystemAccess: request.options.useFileSystemAccess !== false,
		signal: request.signal,
	});
}

export async function publishNativeScape(
	runtime: Pick<
		NativeProjectServiceRuntime,
		'exportScapeProject' | 'fileService' | 'publishDocumentSnapshot' | 'scapeMimeType' | 'state' | 'store'
	>,
	request: Readonly<{
		assertReadyToCommit(): void;
		fileName: string;
		prepared: Exclude<NativePreparedSave, { readonly mode: 'cancelled' }>;
		project: NativeProjectDocument;
		signal: AbortSignal;
	}>,
): Promise<Readonly<{
	exported: ScapeExportResult;
	saved: NativeSavedFile;
}>> {
	const prepared = request.prepared;
	if (prepared.mode === 'stream') {
		return publishDirectScape(runtime, { ...request, prepared });
	}
	const exported = await runtime.exportScapeProject(request.project, runtime.store, {
		signal: request.signal,
	});
	if (!(exported.blob instanceof Blob)) {
		throw new TypeError('The fallback Scape export did not produce a Blob.');
	}
	// Read the archive that was just built back and record what is in it, so this
	// file can be verified later against something measured rather than copied
	// from the writer's own account of itself.
	await recordScapeArchiveManifest(runtime, {
		archive: exported.blob,
		fileName: request.fileName,
		projectTitle: String(request.project?.title ?? '') || null,
		signal: request.signal,
	});
	request.assertReadyToCommit();
	const saved = await runtime.fileService.saveFile({
		purpose: 'project',
		blob: exported.blob,
		suggestedName: request.fileName,
		mimeType: runtime.scapeMimeType,
		target: prepared.target,
		useFileSystemAccess: false,
		signal: request.signal,
	});
	if (saved.cancelled) throw new DOMException('The file save was cancelled.', 'AbortError');
	return { exported, saved };
}

export interface NativeRetainedScapeArchive {
	readonly projectId: string;
	readonly archive: Blob;
	readonly manifest: Readonly<Record<string, unknown>>;
}

/** Orchestrate the unchanged-copy save of a retained future-schema archive. */
export async function saveNativeScapeArchiveCopy(
	runtime: Pick<NativeProjectServiceRuntime,
	'copy' | 'copyFutureScapeArchive' | 'ensureScapeFileName' | 'fileService' | 'scapeMimeType' | 'setStatus'>,
	request: Readonly<{
		assertReady(): void;
		fallbackFileName: unknown;
		options: SaveScapeOptions;
		retained: NativeRetainedScapeArchive;
		signal: AbortSignal;
	}>,
): Promise<(NativeSavedFile & { readonly manifest: Readonly<Record<string, unknown>> })
| Readonly<{ cancelled: true }>> {
	const fileName = runtime.ensureScapeFileName(request.options.fileName || request.fallbackFileName);
	const prepared = await prepareNativeScapeSave(runtime.fileService, {
		fileName, mimeType: runtime.scapeMimeType, options: request.options, signal: request.signal,
	});
	if (prepared.mode === 'cancelled') return { cancelled: true };
	request.assertReady();
	const { saved } = await publishNativeScapeArchiveCopy(runtime, {
		archive: request.retained.archive,
		assertReadyToCommit: request.assertReady,
		fileName, prepared, signal: request.signal,
	});
	runtime.setStatus(runtime.copy.projectSaved, 'success');
	return { ...saved, manifest: request.retained.manifest };
}

/** Save a retained future-schema archive as an exact byte copy, never re-serializing. */
export async function publishNativeScapeArchiveCopy(
	runtime: Pick<NativeProjectServiceRuntime, 'copyFutureScapeArchive' | 'fileService' | 'scapeMimeType'>,
	request: Readonly<{
		archive: Blob;
		assertReadyToCommit(): void;
		fileName: string;
		prepared: Exclude<NativePreparedSave, { readonly mode: 'cancelled' }>;
		signal: AbortSignal;
	}>,
): Promise<Readonly<{
	copied: Readonly<{ byteLength: number; schemaVersion: number }>;
	saved: NativeSavedFile;
}>> {
	const prepared = request.prepared;
	if (prepared.mode === 'stream') {
		try {
			const writable = await prepared.createWritable(request.archive.size);
			const writer = writable.getWriter();
			let copied;
			try {
				copied = await runtime.copyFutureScapeArchive(
					request.archive,
					(bytes) => writer.write(bytes),
					{ signal: request.signal },
				);
				await writer.close();
			} catch (error) {
				await writer.abort(error).catch(() => undefined);
				throw error;
			}
			if (copied.byteLength !== request.archive.size
				|| prepared.bytesWritten() !== copied.byteLength) {
				throw new Error('The staged archive copy does not match the original byte count.');
			}
			request.assertReadyToCommit();
			const saved = await prepared.commit();
			return { copied, saved };
		} catch (error) {
			try {
				await prepared.abort(error);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'The archive copy and destination cleanup both failed.',
				);
			}
			throw error;
		}
	}
	let validatedBytes = 0;
	const copied = await runtime.copyFutureScapeArchive(
		request.archive,
		(bytes) => { validatedBytes += bytes.byteLength; },
		{ signal: request.signal },
	);
	if (copied.byteLength !== request.archive.size || validatedBytes !== copied.byteLength) {
		throw new Error('The validated archive does not match the original byte count.');
	}
	request.assertReadyToCommit();
	const saved = await runtime.fileService.saveFile({
		purpose: 'project',
		blob: request.archive,
		suggestedName: request.fileName,
		mimeType: runtime.scapeMimeType,
		target: prepared.target,
		useFileSystemAccess: false,
		signal: request.signal,
	});
	if (saved.cancelled) throw new DOMException('The file save was cancelled.', 'AbortError');
	return { copied, saved };
}

async function publishDirectScape(
	runtime: Pick<NativeProjectServiceRuntime, 'exportScapeProject' | 'store'>,
	request: Readonly<{
		assertReadyToCommit(): void;
		fileName: string;
		prepared: Extract<NativePreparedSave, { readonly mode: 'stream' }>;
		project: NativeProjectDocument;
		signal: AbortSignal;
	}>,
): Promise<Readonly<{
	exported: ScapeExportResult;
	saved: NativeSavedFile;
}>> {
	try {
		const exported = await runtime.exportScapeProject(request.project, runtime.store, {
			createWritable: (maximumBytes) => request.prepared.createWritable(maximumBytes),
			signal: request.signal,
		});
		if (exported.blob !== null) throw new TypeError('The direct Scape export assembled an unexpected Blob.');
		if (!Number.isSafeInteger(exported.byteLength)
			|| exported.byteLength !== request.prepared.bytesWritten()) {
			throw new Error('The staged Scape output does not match the archive writer byte count.');
		}
		request.assertReadyToCommit();
		const saved = await request.prepared.commit();
		return { exported, saved };
	} catch (error) {
		try {
			await request.prepared.abort(error);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'The Scape save and destination cleanup both failed.',
			);
		}
		throw error;
	}
}
