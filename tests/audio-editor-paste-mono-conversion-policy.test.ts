/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	downmixStereoPasteSource,
	planPasteMonoConversion,
} from '../src/common/editor/controller/edit/paste-mono-conversion-policy.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';

type Data = Readonly<Record<string, unknown>>;

function clipboard(overrides: Partial<AudioEditorClipboard> = {}): AudioEditorClipboard {
	return {
		schemaVersion: 2,
		sampleRate: 48_000,
		durationFrames: 20,
		tracks: [{
			sourceTrackId: 'copied-track',
			sourceTrackName: 'Copied audio',
			sourceTrackType: 'audio',
			clips: [{
				key: 'copied:0:20', kind: 'audio', sourceId: 'stereo-source',
				offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20,
			}],
		}],
		...overrides,
	};
}

function project(overrides: Data = {}): Data {
	return {
		sources: [
			{ id: 'mono-source', channelCount: 1 },
			{ id: 'stereo-source', channelCount: 2 },
		],
		tracks: [
			{ id: 'mono-track', type: 'audio', clipIds: ['mono-clip'] },
			{ id: 'stereo-track', type: 'audio', clipIds: ['stereo-clip'] },
			{ id: 'empty-track', type: 'audio', clipIds: [] },
		],
		clips: [
			{ id: 'mono-clip', sourceId: 'mono-source' },
			{ id: 'stereo-clip', sourceId: 'stereo-source' },
		],
		...overrides,
	};
}

test('stereo audio targeting a non-empty mono track asks or converts according to the preference', () => {
	const request = {
		clipboard: clipboard(),
		project: project(),
		trackMap: { 'copied-track': 'mono-track' },
	};

	assert.deepEqual(planPasteMonoConversion({ ...request, alwaysConvertToMono: false }), {
		disposition: 'confirm',
		targets: [{
			sourceTrackId: 'copied-track',
			targetTrackId: 'mono-track',
			stereoSourceIds: ['stereo-source'],
		}],
	});
	assert.deepEqual(planPasteMonoConversion({ ...request, alwaysConvertToMono: true }), {
		disposition: 'convert',
		targets: [{
			sourceTrackId: 'copied-track',
			targetTrackId: 'mono-track',
			stereoSourceIds: ['stereo-source'],
		}],
	});
});

test('mono conversion is not requested for compatible or empty destination tracks', () => {
	for (const [sourceId, targetTrackId] of [
		['mono-source', 'mono-track'],
		['stereo-source', 'stereo-track'],
		['stereo-source', 'empty-track'],
	] as const) {
		const sourceClipboard = clipboard({
			tracks: [{
				...clipboard().tracks[0]!,
				clips: [{ ...clipboard().tracks[0]!.clips[0]!, sourceId }],
			}],
		});
		assert.deepEqual(planPasteMonoConversion({
			clipboard: sourceClipboard,
			project: project(),
			trackMap: { 'copied-track': targetTrackId },
			alwaysConvertToMono: true,
		}), { disposition: 'preserve', targets: [] }, `${sourceId} -> ${targetTrackId}`);
	}
});

test('cross-project source metadata and legacy track types are resolved without converting video', () => {
	const transferred = [
		{ id: 'remote-stereo', channelCount: 2 },
		{ id: 'remote-video', channelCount: 0 },
	];
	const legacy: AudioEditorClipboard = {
		schemaVersion: 1,
		sampleRate: 48_000,
		durationFrames: 20,
		tracks: [{
			sourceTrackId: 'legacy-audio', sourceTrackName: 'Audio',
			clips: [{ key: 'audio', kind: 'audio', sourceId: 'remote-stereo', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }],
		}, {
			sourceTrackId: 'legacy-video', sourceTrackName: 'Video',
			clips: [{ key: 'video', kind: 'video', sourceId: 'remote-video', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }],
		}],
	};
	const destination = project({
		tracks: [
			{ id: 'mono-track', type: 'audio', clipIds: ['mono-clip'] },
			{ id: 'video-track', type: 'video', clipIds: ['video-clip'] },
		],
		clips: [
			{ id: 'mono-clip', sourceId: 'mono-source' },
			{ id: 'video-clip', sourceId: 'video-source' },
		],
		sources: [{ id: 'mono-source', channelCount: 1 }, { id: 'video-source', channelCount: 0 }],
	});

	assert.deepEqual(planPasteMonoConversion({
		clipboard: legacy,
		project: destination,
		transferredSources: transferred,
		trackMap: { 'legacy-audio': 'mono-track', 'legacy-video': 'video-track' },
		alwaysConvertToMono: true,
	}), {
		disposition: 'convert',
		targets: [{
			sourceTrackId: 'legacy-audio', targetTrackId: 'mono-track',
			stereoSourceIds: ['remote-stereo'],
		}],
	});
});

test('a mixed clipboard track converts only its stereo source roots', () => {
	const mixed = clipboard({
		tracks: [{
			...clipboard().tracks[0]!,
			clips: [
				{ ...clipboard().tracks[0]!.clips[0]!, sourceId: 'mono-source' },
				{ ...clipboard().tracks[0]!.clips[0]!, key: 'stereo', sourceId: 'stereo-source' },
			],
		}],
	});
	assert.deepEqual(planPasteMonoConversion({
		clipboard: mixed,
		project: project(),
		trackMap: { 'copied-track': 'mono-track' },
		alwaysConvertToMono: true,
	}).targets[0]?.stereoSourceIds, ['stereo-source']);
});

test('the PCM conversion matches Audacity by averaging left and right without mutating either', () => {
	const left = Float32Array.of(1, -1, 0.25, 0.75);
	const right = Float32Array.of(-1, 1, 0.75, -0.25);
	const beforeLeft = left.slice();
	const beforeRight = right.slice();

	assert.deepEqual(
		Array.from(downmixStereoPasteSource([left, right])),
		[0, 0, 0.5, 0.25],
	);
	assert.deepEqual(left, beforeLeft);
	assert.deepEqual(right, beforeRight);
});

test('the PCM conversion refuses anything except two aligned Float32 channels', () => {
	assert.throws(() => downmixStereoPasteSource([Float32Array.of(1)]), /two channels/iu);
	assert.throws(
		() => downmixStereoPasteSource([Float32Array.of(1), Float32Array.of(1, 2)]),
		/equal length/iu,
	);
	assert.throws(
		() => downmixStereoPasteSource([Float32Array.of(1), [1] as unknown as Float32Array]),
		/Float32Array/iu,
	);
});

test('planning fails closed when referenced source channel metadata is unavailable', () => {
	assert.throws(() => planPasteMonoConversion({
		clipboard: clipboard({
			tracks: [{
				...clipboard().tracks[0]!,
				clips: [{ ...clipboard().tracks[0]!.clips[0]!, sourceId: 'missing-source' }],
			}],
		}),
		project: project(),
		trackMap: { 'copied-track': 'mono-track' },
		alwaysConvertToMono: true,
	}), /missing-source/iu);
});
