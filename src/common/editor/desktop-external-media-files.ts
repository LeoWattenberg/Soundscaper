/* SPDX-License-Identifier: AGPL-3.0-only */

import { registerExternalMediaFile, externalMediaFileReference, type ExternalMedia } from './desktop-external-media.ts';
import { desktopReadCapabilityIdFor } from './desktop-read-capability-registry.ts';
import type { ExternalMediaResolver } from './scape-external-media.ts';

interface ExternalMediaBridge {
	captureExternalMedia?(fileOrReadId: object | string): Promise<string | null>;
	resolveExternalMedia?(request: { projectReadId: string; sourceId: string }): Promise<unknown>;
	releaseRead?(readId: string): Promise<unknown>;
}

export function createDesktopExternalMediaFiles(bridge: ExternalMediaBridge | null, fetchFile: typeof fetch) {
	return Object.freeze({ capture, resolve });
	async function capture(file: object, readId?: string): Promise<void> {
		if (!bridge?.captureExternalMedia) return;
		if (externalMediaFileReference(file)) return;
		const reference = await bridge.captureExternalMedia(readId ?? file);
		if (reference !== null) registerExternalMediaFile(file, reference);
	}
	function resolve(input: object): ExternalMediaResolver {
		return async (_reference: ExternalMedia, sourceId: string, signal?: AbortSignal) => {
			const projectReadId = desktopReadCapabilityIdFor(input);
			if (!projectReadId || !bridge?.resolveExternalMedia || !bridge.releaseRead) {
				throw new Error('External media requires a project opened through the desktop file picker.');
			}
			signal?.throwIfAborted();
			const raw = await bridge.resolveExternalMedia({ projectReadId, sourceId });
			if (!raw || typeof raw !== 'object' || !('id' in raw) || typeof raw.id !== 'string') {
				throw new Error('The external media file is unavailable.');
			}
			const id = raw.id;
			try {
				signal?.throwIfAborted();
				const { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob } = await import('./desktop-selected-range-blob.ts');
				const file = createDesktopSelectedRangeBlob(raw as Parameters<typeof createDesktopSelectedRangeBlob>[0], { fetch: fetchFile, signal });
				return { file, async release() { retireDesktopSelectedRangeBlob(file); await bridge.releaseRead?.(id); } };
			} catch (error) { await bridge.releaseRead(id); throw error; }
		};
	}
}
