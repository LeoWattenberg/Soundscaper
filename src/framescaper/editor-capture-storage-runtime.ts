/* SPDX-License-Identifier: AGPL-3.0-only */

import { EncodedCaptureSpoolRepository } from
	'../common/editor/storage/encoded-capture-spool-repository.ts';
import { FramescaperCaptureSessionManifestRepository } from
	'../common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import { MediaAssetChunkRecords } from
	'../common/editor/storage/media-asset-chunk-records.ts';
import { OpfsPreferredEncodedCaptureChunkPort } from
	'../common/editor/storage/opfs-preferred-encoded-capture-chunk-port.ts';
import type { FramescaperCaptureRepositoryFactory } from
	'../common/editor/storage/repositories.ts';

/** Construct capture persistence only inside a Framescaper-owned store. */
export const createFramescaperCaptureRepositories: FramescaperCaptureRepositoryFactory = (
	{ analysis, opfs, port },
) => {
	const encodedCaptureChunks = new OpfsPreferredEncodedCaptureChunkPort({
		values: analysis,
		opfs,
		fallback: new MediaAssetChunkRecords(port),
	});
	return Object.freeze({
		encodedCaptureChunks,
		encodedCaptureSpools: new EncodedCaptureSpoolRepository(
			analysis,
			encodedCaptureChunks,
		),
		framescaperCaptureManifests: new FramescaperCaptureSessionManifestRepository(analysis),
	});
};
