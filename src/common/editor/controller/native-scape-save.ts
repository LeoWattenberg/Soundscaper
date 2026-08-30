/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_MIME_TYPE } from '../scape-project-format.ts';
import type { ProjectFileExtension } from '../../project-file-extensions.ts';
import { recordScapeArchiveManifest } from './scape-archive-manifest-action.ts';
import type {
	NativePreparedSave,
	NativeProjectDocument,
	NativeProjectFileType,
	NativeProjectServiceRuntime,
	NativeSavedFile,
	SaveScapeOptions,
	ScapeExportResult,
} from './native-project-types.ts';

// A save picker offers the suffix this product writes and nothing else; the
// four accepted suffixes matter when opening, not when naming a new file.
const SCAPE_FILE_TYPES_BY_EXTENSION = new Map<string, readonly NativeProjectFileType[]>();

function scapeFileTypes(extension: ProjectFileExtension): readonly NativeProjectFileType[] {
	const cached = SCAPE_FILE_TYPES_BY_EXTENSION.get(extension);
	if (cached) return cached;
	const types = Object.freeze([Object.freeze({
		description: 'Scape project',
		accept: Object.freeze({
			[SCAPE_MIME_TYPE]: Object.freeze([extension]),
		}),
	})]);
	SCAPE_FILE_TYPES_BY_EXTENSION.set(extension, types);
	return types;
}

/**
 * Name the archive for the product that is saving it and open its destination.
 * Both the exporting and the unchanged-copy save start here, so the picker and
 * the suggested name can never disagree about which suffix is being written.
 */
export async function beginNativeScapeSave(
	runtime: Pick<NativeProjectServiceRuntime,
	'ensureProjectFileName' | 'fileService' | 'projectFileExtension' | 'scapeMimeType'>,
	request: Readonly<{
		fallbackFileName: unknown;
		options: SaveScapeOptions;
		signal: AbortSignal;
	}>,
): Promise<Readonly<{ fileName: string; prepared: NativePreparedSave }>> {
	const extension = runtime.projectFileExtension;
	const fileName = runtime.ensureProjectFileName(
		request.options.fileName || request.fallbackFileName, extension,
	);
	const prepared = await runtime.fileService.prepareSave({
		purpose: 'project',
		suggestedName: fileName,
		mimeType: runtime.scapeMimeType,
		target: request.options.saveTarget,
		types: scapeFileTypes(extension),
		useFileSystemAccess: request.options.useFileSystemAccess !== false,
		signal: request.signal,
	});
	return { fileName, prepared };
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
	'copy' | 'copyFutureScapeArchive' | 'ensureProjectFileName' | 'fileService'
	| 'projectFileExtension' | 'publishDocumentSnapshot' | 'scapeMimeType' | 'setStatus' | 'state'>,
	request: Readonly<{
		assertReady(): void;
		fallbackFileName: unknown;
		options: SaveScapeOptions;
		retained: NativeRetainedScapeArchive;
		signal: AbortSignal;
	}>,
): Promise<(NativeSavedFile & { readonly manifest: Readonly<Record<string, unknown>> })
| Readonly<{ cancelled: true }>> {
	// The bytes are copied unchanged; only the name follows the saving product.
	const { fileName, prepared } = await beginNativeScapeSave(runtime, {
		fallbackFileName: request.fallbackFileName, options: request.options, signal: request.signal,
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
	runtime: Pick<NativeProjectServiceRuntime,
	'copyFutureScapeArchive' | 'fileService' | 'publishDocumentSnapshot' | 'scapeMimeType' | 'state'>,
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
		let publication: Readonly<{
			copied: Readonly<{ byteLength: number; schemaVersion: number }>;
			saved: NativeSavedFile;
		}> | null = null;
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
			publication = { copied, saved };
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
		await recordScapeArchiveManifest(runtime, {
			archive: request.archive, fileName: request.fileName, signal: request.signal,
		});
		return publication;
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
	await recordScapeArchiveManifest(runtime, {
		archive: request.archive, fileName: request.fileName, signal: request.signal,
	});
	return { copied, saved };
}

async function publishDirectScape(
	runtime: Pick<NativeProjectServiceRuntime,
	'exportScapeProject' | 'publishDocumentSnapshot' | 'state' | 'store'>,
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
	let publication: Readonly<{ exported: ScapeExportResult; saved: NativeSavedFile }> | null = null;
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
		publication = { exported, saved };
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
	await recordScapeArchiveManifest(runtime, {
		archive: null,
		fileName: request.fileName,
		projectTitle: String(request.project?.title ?? '') || null,
		signal: request.signal,
	});
	return publication;
}
