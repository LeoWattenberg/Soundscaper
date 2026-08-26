/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAudioEditorClipboardDescriptor } from '../../src/common/editor/commands/clipboard-codec.ts';
import { preparePasteCommand } from '../../src/common/editor/commands/clipboard-runtime.js';
import type { AudioEditorClipboard, AudioEditorCommand } from '../../src/common/editor/commands/protocol.ts';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../../src/common/editor/timeline-image-model-v32.ts';
import { applyFramescaperProjectCommandV32 } from '../../src/framescaper/editor-project-v32-commands.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile-v32.ts';
import { createFramescaperProjectV32, type FramescaperProjectV32 } from '../../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './framescaper-v20-model-fixture.ts';

const ENCODER = new TextEncoder();

export interface FramescaperV32ImageFixture {
	readonly project: FramescaperProjectV32;
	readonly source: FramescaperImageSourceV1;
	readonly clip: FramescaperImageClipV1;
	readonly descriptor: AudioEditorClipboard;
	readonly bytes: Uint8Array;
}

export function createFramescaperV32ImageFixture(
	options: Readonly<{
		sourceId?: string;
		clipId?: string;
		originalText?: string;
		imageOnly?: boolean;
		firstFrameRgba?: readonly [number, number, number, number, number, number, number, number];
		receipt?: Readonly<Record<string, unknown>>;
	}> = {},
): FramescaperV32ImageFixture {
	const sourceId = options.sourceId ?? 'image-source-1';
	const clipId = options.clipId ?? 'image-clip-1';
	const publication = createFramescaperImageFramePackV1({
		original: ENCODER.encode(options.originalText ?? 'exact animated PNG input'),
		receipt: options.receipt
			?? { decoder: { id: 'browser-native', version: '1' }, schemaVersion: 1 },
		width: 2,
		height: 1,
		timingMode: 'embedded',
		frames: [{
			presentationTicks: 0n,
			durationTicks: 1_000_000n,
			rgba: Uint8Array.from(options.firstFrameRgba ?? [255, 0, 0, 255, 0, 0, 0, 0]),
		}, {
			presentationTicks: 1_000_000n,
			durationTicks: 4_000_000n,
			rgba: Uint8Array.of(0, 255, 0, 128, 0, 0, 255, 255),
		}],
	});
	const source: FramescaperImageSourceV1 = {
		schemaVersion: 1,
		kind: 'image',
		id: sourceId,
		name: 'Animated image',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: sourceId,
		contentSha256: publication.contentSha256,
		assetByteLength: publication.assetByteLength,
		original: {
			fileName: 'animated.png',
			mimeType: 'image/png',
			recognizedFormat: 'apng',
			byteLength: publication.originalByteLength,
			sha256: publication.originalSha256,
		},
		canonical: {
			width: publication.width,
			height: publication.height,
			hasAlpha: publication.hasAlpha,
			frameCount: publication.frameCount,
			durationTicks: publication.durationTicks,
			timingMode: publication.timingMode,
		},
		conversionReceiptSha256: publication.conversionReceiptSha256,
	};
	const baseOptions = framescaperV20Options();
	if (options.imageOnly === true) {
		baseOptions.sources = (baseOptions.sources as Readonly<Record<string, unknown>>[])
			.filter(({ kind }) => kind !== 'video');
		baseOptions.clips = (baseOptions.clips as Readonly<Record<string, unknown>>[])
			.filter(({ kind }) => kind !== 'video');
		(baseOptions.projectBin as Record<string, unknown>).clips = [];
		const baseVideoTrack = (baseOptions.tracks as Record<string, unknown>[])
			.find(({ type }) => type === 'video');
		if (!baseVideoTrack) throw new Error('The V32 image fixture requires a video track.');
		baseVideoTrack.clipIds = [];
	}
	const base = createFramescaperProjectV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
		baseOptions,
	);
	const videoTrack = base.tracks.find(({ type }) => type === 'video');
	if (!videoTrack) throw new Error('The V32 image fixture requires a video track.');
	const clip: FramescaperImageClipV1 = {
		schemaVersion: 1,
		kind: 'image',
		id: clipId,
		sourceId,
		sequenceId: base.primarySequenceId,
		sequenceStartFrame: 0,
		sequenceFrameCount: 150,
		sourceStartTicks: '0',
	};
	const project = applyFramescaperProjectCommandV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
		base,
		{ type: 'batch', commands: [{
			type: 'image-source/set', sourceId, expectedSource: null, source,
		}, {
			type: 'image-clip/set', clipId, expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'timeline', trackId: videoTrack.id },
		}] },
	);
	return Object.freeze({
		project,
		source,
		clip,
		descriptor: imageDescriptor(sourceId, clipId, videoTrack.id, clip.sequenceId),
		bytes: publication.bytes,
	});
}

export function imagePasteCommand(
	descriptor: AudioEditorClipboard,
	options: Readonly<{ clipId?: string; atFrame?: number; targetTrackId?: string }> = {},
): AudioEditorCommand {
	const key = String(descriptor.tracks[0]?.clips[0]?.key);
	const sourceTrackId = String(descriptor.tracks[0]?.sourceTrackId);
	return {
		...preparePasteCommand(descriptor, {
			atFrame: options.atFrame ?? 48_000,
			mode: 'overlap',
			trackMap: { [sourceTrackId]: options.targetTrackId ?? sourceTrackId },
		}, (prefix = 'id') => `${prefix}-fixture`),
		clipIds: { [key]: options.clipId ?? 'image-clip-copy' },
		videoEffectIds: { [key]: [] },
	} as AudioEditorCommand;
}

function imageDescriptor(
	sourceId: string,
	clipId: string,
	trackId: string,
	sequenceId: string,
): AudioEditorClipboard {
	return normalizeAudioEditorClipboardDescriptor({
		schemaVersion: 6,
		sampleRate: 48_000,
		durationFrames: 240_000,
		tracks: [{
			sourceTrackId: trackId,
			sourceTrackName: 'Video',
			sourceTrackType: 'video',
			sourceLaneGroupId: null,
			sourceSequenceId: sequenceId,
			clips: [{
				key: `${clipId}:0:240000`,
				kind: 'video',
				sourceId,
				offsetFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 240_000,
				title: 'Animated image',
				sourceDurationFrames: 240_000,
				trimStartFrames: 0,
				trimEndFrames: 0,
				groupId: null,
				avLinkId: null,
				color: 'auto',
				speedRatio: 1,
				coordinateDomain: 'resolved-samples',
				sequenceId,
				sequenceFrameCount: 150,
				sourceInFrame: 0,
				sourceFrameCount: 2,
				retimeMap: null,
				videoEffects: [],
				videoComposition: {
					schemaVersion: 1,
					crop: { left: 0, top: 0, right: 0, bottom: 0 },
					transform: {
						anchorX: 0.5, anchorY: 0.5, positionX: 0.5, positionY: 0.5,
						scaleX: 1, scaleY: 1, rotationDegrees: 0,
						flipHorizontal: false, flipVertical: false,
					},
					opacity: 1,
					blendMode: 'normal',
					compositingOrder: 0,
				},
			}],
		}],
		annotations: [],
		takeGroups: [],
	});
}
