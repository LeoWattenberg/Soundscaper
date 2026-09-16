/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';
import type { WavPackImportGroupDecoder } from '../../../browser-streamed-wavpack-import.ts';
import type { createIncrementalPcmImporter } from './incremental-wav-import-service.ts';

export async function importStreamedAudioFile(
	file: Blob,
	options: Readonly<{ signal?: AbortSignal }>,
	codec: WavPackImportGroupDecoder,
	metadata: unknown,
	importPcm: ReturnType<typeof createIncrementalPcmImporter>,
	assertCurrent: () => void,
): Promise<unknown> {
	const { prepareStreamedAudioImport } = await import('../../../browser-streamed-audio-import.ts');
	const desktop = isDesktopMainAudioCodecRuntime(codec);
	const prepared = await prepareStreamedAudioImport(file, {
		signal: options.signal, reviewedFallback: !desktop, desktopCodec: desktop ? codec : undefined,
	});
	try {
		return await importPcm(file, { ...prepared.descriptor, stream: prepared.stream }, options,
			metadata, { requireChunkStream: true }, { assertCurrent });
	} finally { prepared.dispose(); }
}
