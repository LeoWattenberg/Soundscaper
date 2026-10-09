/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorSessionClipboardV2, normalizeAudioEditorSessionClipboardV2,
	normalizeAudioEditorSessionClipboardV1OrV2, collectSessionClipboardStorageKeysV2 } from '../src/common/editor/session-clipboard-codec-v2.ts';
import { normalizeAudioEditorSessionClipboard } from '../src/common/editor/session-clipboard-codec.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';

const reference = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function descriptor() {
	return { schemaVersion: 7, sampleRate: 48_000, durationFrames: 4800, annotations: [], takeGroups: [], tracks: [{
		sourceTrackId: 'track', sourceTrackName: 'Video', sourceTrackType: 'video', sourceSequenceId: 'main', sourceLaneGroupId: null,
		clips: [{ key: 'clip', kind: 'video', sourceId: 'source', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 4800,
			sequenceId: 'main', sequenceFrameCount: 1, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: structuredClone(reference) } }] }],
	}] };
}
const project = () => ({ schemaVersion: 1, id: 'project', title: 'Project', sampleRate: 48_000,
	sources: [{ id: 'extra', storageKey: 'unreferenced' }, { id: 'source', storageKey: 'original', facts: { caption: 'immutable' } }], clips: [], tracks: [] });

test('named session clipboard2 retains complete descriptor7 refs and selected source facts without broadening wrapper1', () => {
	const input = descriptor(), source = project();
	const value = createAudioEditorSessionClipboardV2(source, { descriptor: input });
	assert.equal(value.schemaVersion, 2); assert.equal(value.descriptor.schemaVersion, 7);
	assert.deepEqual(value.sources, [source.sources[1]]); assert.deepEqual(collectSessionClipboardStorageKeysV2(value), [reference.storageKey]);
	input.tracks[0]!.clips[0]!.videoEffects[0]!.params.lut.domainMin[0] = .5;
	source.sources[1]!.facts!.caption = 'changed';
	assert.deepEqual(value.descriptor, descriptor()); assert.equal(value.sources[0]!.facts && (value.sources[0]!.facts as { caption: string }).caption, 'immutable');
	assert.deepEqual(normalizeAudioEditorSessionClipboardV2(value), value);
	assert.throws(() => normalizeAudioEditorSessionClipboard(value), /schema version/iu);
	assert.throws(() => normalizeAudioEditorSessionClipboardV2({ ...value, schemaVersion: 1 }), /wrapper|schema|V2/iu);
});

test('current clipboard2 derives exact disabled roots, rejects conflicts and refuses hidden or accessor admission', () => {
	const value = createAudioEditorSessionClipboardV2(project(), { descriptor: descriptor() });
	const hostile = structuredClone(value); let reads = 0;
	Object.defineProperty(hostile, 'sources', { enumerable: true, get() { reads++; throw Error('borrowed'); } });
	assert.throws(() => normalizeAudioEditorSessionClipboardV2(hostile), /data|accessor/iu); assert.equal(reads, 0);
	assert.throws(() => normalizeAudioEditorSessionClipboardV2({ ...value, cachedBody: [1, 2, 3] }), /unknown|unsupported/iu);
	assert.throws(() => normalizeAudioEditorSessionClipboardV2({ ...value, sources: [] }), /missing/iu);
	assert.throws(() => normalizeAudioEditorSessionClipboardV2({ ...value, sources: [value.sources[0], value.sources[0]] }), /Duplicate/iu);
	const conflicting = structuredClone(value);
	(conflicting.descriptor.tracks[0]!.clips[0]!.videoEffects as Record<string, unknown>[]).push({ id: 'other', type: 'cube-lut-profile-v1', enabled: false,
		params: { lut: { ...reference, byteLength: 85 } } });
	assert.throws(() => collectSessionClipboardStorageKeysV2(conflicting), /conflict/iu);
});

test('the explicit current dispatcher preserves old wrapper1 bytes and null neutrality', () => {
	const old = { schemaVersion: 1, originProjectId: 'old', descriptor: { schemaVersion: 1, sampleRate: 48_000,
		durationFrames: 1, tracks: [] }, sources: [] };
	assert.deepEqual(normalizeAudioEditorSessionClipboardV1OrV2(old), normalizeAudioEditorSessionClipboard(old));
	const input = descriptor(); Reflect.set(input.tracks[0]!.clips[0]!.videoEffects[0]!.params, 'lut', null);
	const value = createAudioEditorSessionClipboardV2(project(), { descriptor: input });
	assert.deepEqual(collectSessionClipboardStorageKeysV2(value), []);
	assert.deepEqual(normalizeAudioEditorSessionClipboardV1OrV2(value), value);
});
