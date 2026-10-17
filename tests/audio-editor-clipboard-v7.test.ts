/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAudioEditorClipboardDescriptor } from '../src/common/editor/commands/clipboard-codec.ts';
import { normalizeAudioEditorClipboardDescriptorV7, collectAudioEditorClipboardSourceIdsV7 } from '../src/common/editor/commands/clipboard-codec-v7.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurvesV2 } from '../src/common/editor/video-keyframe-curves-v2.ts';

const LUT = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function clipboard() {
	return { schemaVersion: 7, sampleRate: 48_000, durationFrames: 48_000, annotations: [], takeGroups: [], tracks: [{
		sourceTrackId: 'video-track', sourceTrackName: 'Video', sourceTrackType: 'video',
		sourceLaneGroupId: null, sourceSequenceId: 'main-sequence', clips: [{
			key: 'video-clip:0:48000', kind: 'video', sourceId: 'video-source', offsetFrame: 0,
			sourceStartFrame: 0, durationFrames: 48_000, sequenceId: 'main-sequence', sequenceFrameCount: 24,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION, videoKeyframes: createDefaultVideoKeyframeCurvesV2(24),
			videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: structuredClone(LUT) } }],
		}],
	}] };
}

test('clipboard7 detaches complete disabled resource references without broadening versions1–6', () => {
	const input = clipboard();
	const result = normalizeAudioEditorClipboardDescriptorV7(input);
	assert.deepEqual(result, input);
	assert.deepEqual(collectAudioEditorClipboardSourceIdsV7(result), ['video-source']);
	const effects = result.tracks[0]!.clips[0]!.videoEffects as readonly { params: { lut: typeof LUT } }[];
	input.tracks[0]!.clips[0]!.videoEffects[0]!.params.lut.domainMin[0] = 0.5;
	assert.equal(effects[0]!.params.lut.domainMin[0], 0);
	assert.ok(Object.isFrozen(effects[0]!.params.lut.domainMin));
	assert.throws(() => normalizeAudioEditorClipboardDescriptor(result), /Unsupported clipboard schema/u);
	assert.throws(() => normalizeAudioEditorClipboardDescriptorV7({ ...input, schemaVersion: 6 }), /V7/u);
});

test('clipboard7 independently admits even unkeyframed envelopes and refuses accessor or conflicting references', () => {
	const input = clipboard();
	Reflect.deleteProperty(input.tracks[0]!.clips[0]!, 'videoKeyframes');
	assert.doesNotThrow(() => normalizeAudioEditorClipboardDescriptorV7(input));
	input.tracks[0]!.clips[0]!.videoEffects[0]!.params.lut.size = 1;
	assert.throws(() => normalizeAudioEditorClipboardDescriptorV7(input), /size/iu);
	let reads = 0;
	const hostile = clipboard();
	Object.defineProperty(hostile.tracks[0]!.clips[0]!.videoEffects[0]!, 'params', { enumerable: true, get() { reads++; return {}; } });
	assert.throws(() => normalizeAudioEditorClipboardDescriptorV7(hostile), /data/iu);
	assert.equal(reads, 0);
});

test('legacy clipboard descriptors refuse cube envelopes independently of keyframes', () => {
	for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
		const input = clipboard(); Reflect.set(input, 'schemaVersion', schemaVersion);
		const clip = input.tracks[0]!.clips[0]!;
		Reflect.deleteProperty(clip, 'videoKeyframes');
		if (schemaVersion < 5) Reflect.deleteProperty(clip, 'videoComposition');
		if (schemaVersion < 4) Reflect.deleteProperty(input, 'takeGroups');
		if (schemaVersion < 3) { Reflect.deleteProperty(input, 'annotations'); Reflect.deleteProperty(input.tracks[0]!, 'sourceSequenceId'); }
		assert.throws(() => normalizeAudioEditorClipboardDescriptor(input), /resource|cube|V7/u, `legacy descriptor ${schemaVersion}`);
	}
});

test('clipboard7 preserves neutral and ordered old effects while resource parameters stay discrete', () => {
	const input = clipboard();
	const clip = input.tracks[0]!.clips[0]!;
	const effects = [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } },
		{ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: null } }];
	Reflect.set(clip, 'videoEffects', effects);
	const normalized = normalizeAudioEditorClipboardDescriptorV7(input);
	assert.deepEqual((normalized.tracks[0]!.clips[0]!.videoEffects as readonly { id: string }[]).map(value => value.id), ['tone', 'cube']);
	const curve = { schemaVersion: 1, timeDomain: clip.videoKeyframes.timeDomain, curves: [{
		target: { kind: 'video-effect', effectId: 'cube', parameterId: 'lut' },
		curve: { interpolation: 'linear', anchors: [{ time: { num: 0, den: 1 }, value: 0 }, { time: { num: 24, den: 1 }, value: 1 }] },
	}] };
	Reflect.set(clip, 'videoKeyframes', curve);
	assert.throws(() => normalizeAudioEditorClipboardDescriptorV7(input), /numeric|resource|parameter|curve/iu);
});

test('current audio descriptors cannot smuggle disabled or malformed visual resource envelopes', () => {
	for (const params of [{ lut: LUT }, { lut: { storageKey: 'unproved' } }, { lut: null }]) {
		const input = clipboard();
		const clip = input.tracks[0]!.clips[0]!;
		Reflect.set(clip, 'kind', 'audio'); Reflect.set(input.tracks[0]!, 'sourceTrackType', 'audio');
		Reflect.deleteProperty(clip, 'videoComposition'); Reflect.deleteProperty(clip, 'videoKeyframes');
		Reflect.set(clip, 'videoEffects', [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params }]);
		assert.throws(() => normalizeAudioEditorClipboardDescriptorV7(input), /audio|videoEffects|visual/iu);
	}
});
