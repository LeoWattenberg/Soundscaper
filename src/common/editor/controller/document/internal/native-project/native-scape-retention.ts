/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../../../../scape-export-estimate.ts';
import type { ScapeProjectInput } from '../../../../scape-project-input.ts';
import { createRetainedDesktopScapeArchiveByteSource, isDesktopScapeArchiveByteSource } from '../../../../desktop-scape-archive-byte-source.ts';
import { confirmFileSizeWarning } from '../../../shared/file-size-warning.ts';
import type { TemporaryFileSink } from '../../../export/temporary-export.ts';
import type { NativeProjectServiceRuntime, NativeScapeManifest } from '../../native-project-types.ts';
import type { NativeRetainedScapeArchive } from './native-scape-save.ts';

type RetentionSink = Pick<TemporaryFileSink, 'persistent' | 'write' | 'close' | 'remove' | 'abort'>;

/** Detach opaque native archives while their original desktop read is still live. */
export async function retainNativeScapeArchive(
	runtime: Pick<NativeProjectServiceRuntime, 'confirmFileSizeWarning' | 'scapeMimeType'>,
	input: ScapeProjectInput,
	request: Readonly<{
		projectId: string;
		manifest: NativeScapeManifest;
		signal: AbortSignal;
		assertCurrent(): void;
		createSink?: () => Promise<RetentionSink>;
	}>,
): Promise<NativeRetainedScapeArchive> {
	if (input instanceof Blob) return { projectId: request.projectId, archive: input, manifest: request.manifest };
	const createSink = request.createSink ?? (async () => {
		const { createTemporaryFileSink } = await import('../../../../storage/temporary-export-sink.ts');
		return createTemporaryFileSink('opaque-project.scape', {
			temporaryExportClosed: 'The temporary export sink is closed.',
			largeStemsStorageRequired: 'Large exports require file storage.',
			stemArchiveClosed: 'The archive is closed.',
		});
	});
	const sink = await createSink();
	try {
		if (!sink.persistent) await confirmFileSizeWarning(input.size, SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES, 'Scape archive retention', {
			signal: request.signal, assertCurrent: request.assertCurrent, confirmFileSizeWarning: runtime.confirmFileSizeWarning,
		});
		request.signal.throwIfAborted();
		request.assertCurrent();
		let offset = 0;
		while (offset < input.size) {
			request.signal.throwIfAborted();
			request.assertCurrent();
			const bytes = await input.read({ offset, length: Math.min(input.maximumReadBytes, input.size - offset), signal: request.signal });
			request.signal.throwIfAborted();
			request.assertCurrent();
			await sink.write(bytes);
			offset += bytes.byteLength;
		}
		const archive = await sink.close(runtime.scapeMimeType);
		request.signal.throwIfAborted();
		request.assertCurrent();
		if (offset !== input.size || archive.size !== input.size) {
			throw new Error('The retained archive does not match the original byte count.');
		}
		return { projectId: request.projectId, archive, manifest: request.manifest, cleanup: () => sink.remove(),
			...(isDesktopScapeArchiveByteSource(input) ? { copySource: createRetainedDesktopScapeArchiveByteSource(input, archive) } : {}),
		};
	} catch (error) {
		await sink.abort();
		throw error;
	}
}
