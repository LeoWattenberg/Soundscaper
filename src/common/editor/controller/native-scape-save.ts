/* SPDX-License-Identifier: AGPL-3.0-only */

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
	runtime: Pick<NativeProjectServiceRuntime, 'exportScapeProject' | 'fileService' | 'scapeMimeType' | 'store'>,
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
