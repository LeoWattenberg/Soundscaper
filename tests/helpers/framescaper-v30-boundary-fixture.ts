/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../../src/common/editor/timeline-image-model-v30.ts';
import { applyFramescaperProjectCommandV30 } from '../../src/framescaper/editor-project-v30-commands.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile-v30.ts';
import type { FramescaperProjectV30 } from '../../src/framescaper/editor-project-v30.ts';

const ENCODER = new TextEncoder();

export function framescaperV30BoundaryImage(
	project: FramescaperProjectV30,
	suffix = '1',
): Readonly<{
	readonly bytes: Uint8Array;
	readonly source: FramescaperImageSourceV1;
	readonly clip: FramescaperImageClipV1;
}> {
	const publication = createFramescaperImageFramePackV1({
		original: ENCODER.encode(`fixture original ${suffix}`),
		receipt: { decoder: { id: 'fixture-native', version: '1' }, schemaVersion: 1 },
		width: 2,
		height: 1,
		timingMode: 'embedded',
		frames: [{
			presentationTicks: 0n,
			durationTicks: 50_000n,
			rgba: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0),
		}],
	});
	const sourceId = `image-source-${suffix}`;
	return Object.freeze({
		bytes: publication.bytes,
		source: Object.freeze({
			schemaVersion: 1,
			kind: 'image',
			id: sourceId,
			name: `Fixture image ${suffix}`,
			mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
			storageKey: sourceId,
			contentSha256: publication.contentSha256,
			assetByteLength: publication.assetByteLength,
			original: Object.freeze({
				fileName: `fixture-${suffix}.png`, mimeType: 'image/png', recognizedFormat: 'png',
				byteLength: publication.originalByteLength, sha256: publication.originalSha256,
			}),
			canonical: Object.freeze({
				width: publication.width, height: publication.height, hasAlpha: publication.hasAlpha,
				frameCount: publication.frameCount, durationTicks: publication.durationTicks,
				timingMode: publication.timingMode,
			}),
			conversionReceiptSha256: publication.conversionReceiptSha256,
		}),
		clip: Object.freeze({
			schemaVersion: 1,
			kind: 'image',
			id: `image-clip-${suffix}`,
			sourceId,
			sequenceId: String(project.primarySequenceId),
			sequenceStartFrame: 10,
			sequenceFrameCount: 30,
			sourceStartTicks: '0',
		}),
	});
}

export function addFramescaperV30BoundaryImage(
	project: FramescaperProjectV30,
	suffix = '1',
	updatedAt = '2026-08-25T12:00:00.000Z',
) {
	const fixture = framescaperV30BoundaryImage(project, suffix);
	const track = project.tracks.find(({ type, locked }) => type === 'video' && !locked);
	if (!track) throw new ReferenceError('The V30 image fixture requires an unlocked video track.');
	return Object.freeze({
		...fixture,
		project: applyFramescaperProjectCommandV30(
			FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
			project,
			{
				type: 'batch',
				commands: [{
					type: 'image-source/set', sourceId: fixture.source.id,
					expectedSource: null, source: fixture.source,
				}, {
					type: 'image-clip/set', clipId: fixture.clip.id,
					expectedClip: null, expectedPlacement: null, clip: fixture.clip,
					placement: { scope: 'timeline', trackId: track.id },
				}],
			},
			{ now: updatedAt },
		),
	});
}
