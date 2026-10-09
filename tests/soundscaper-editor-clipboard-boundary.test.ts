/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAudioEditorClipboardDescriptor } from '../src/common/editor/commands/clipboard-codec.ts';
import { normalizeAudioEditorClipboardDescriptorV7 } from '../src/common/editor/commands/clipboard-codec-v7.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

const LEGACY_VERSIONS = [1, 2, 3, 4, 5, 6] as const;
const LUT = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };

function project() {
	return createSoundscaperProject({ sources: [createAudioSource({
		id: 'legacy-source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1,
	})] });
}

function legacyDescriptor(schemaVersion: typeof LEGACY_VERSIONS[number]) {
	return normalizeAudioEditorClipboardDescriptor({ schemaVersion, sampleRate: 48_000, durationFrames: 48_000,
		...(schemaVersion >= 3 ? { annotations: [] } : {}),
		...(schemaVersion >= 4 ? { takeGroups: [] } : {}), tracks: [{
			sourceTrackId: 'audio-track', sourceTrackName: 'Audio', sourceTrackType: 'audio', sourceLaneGroupId: null,
			...(schemaVersion >= 3 ? { sourceSequenceId: 'main-sequence' } : {}), clips: [{
				key: 'legacy-clip', sourceId: 'legacy-source', offsetFrame: 0, sourceStartFrame: 0,
				durationFrames: 48_000, ...(schemaVersion >= 2 ? { kind: 'audio' } : {}),
			}],
		}] });
}

function resourceDescriptor() {
	return normalizeAudioEditorClipboardDescriptorV7({ schemaVersion: 7, sampleRate: 48_000, durationFrames: 48_000,
		annotations: [], takeGroups: [], tracks: [{
			sourceTrackId: 'video-track', sourceTrackName: 'Video', sourceTrackType: 'video',
			sourceLaneGroupId: null, sourceSequenceId: 'main-sequence', clips: [{
				key: 'video-clip', kind: 'video', sourceId: 'video-source', offsetFrame: 0, sourceStartFrame: 0,
				durationFrames: 48_000, sequenceId: 'main-sequence', sequenceFrameCount: 24,
				videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT } }],
			}],
		}] });
}

for (const version of LEGACY_VERSIONS) {
	test(`the selected Sound clipboard boundary retains descriptor${String(version)} and the default legacy session wrapper`, () => {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const original = project(), before = structuredClone(original), descriptor = legacyDescriptor(version);
		const prepared = runtime.prepareEditClipboardDescriptor(original, descriptor);
		assert.deepEqual(prepared, descriptor);
		assert.notStrictEqual(prepared, descriptor);
		assert.notStrictEqual(prepared.tracks, descriptor.tracks);
		assert.deepEqual(original, before);
		const session = runtime.createSessionController();
		session.openProject(original);
		session.setClipboard(prepared, { originProjectId: original.id });
		assert.equal(session.serialize().schemaVersion, 1);
		const clipboard = session.clipboardForProject(original.id);
		assert.equal(clipboard?.schemaVersion, 1);
		assert.deepEqual(clipboard?.descriptor, descriptor);
		assert.deepEqual(clipboard?.sources.map(source => source.id), ['legacy-source']);
		session.dispose();
	});
}

test('the selected Sound clipboard boundary preserves permissive V1 compatibility fields', () => {
	const descriptor = normalizeAudioEditorClipboardDescriptor({ schemaVersion: 1, sampleRate: 48_000,
		durationFrames: 1, tracks: [{ sourceTrackId: 'legacy-track', sourceTrackName: 'Legacy',
			sourceTrackType: 'future-track-kind', sourceLaneGroupId: 17, clips: [{
				key: 'legacy-clip', sourceId: 'legacy-source', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 1,
				kind: 'future-clip-kind', groupId: 23, avLinkId: 29,
			}],
		}] });
	assert.deepEqual(createSoundscaperProjectRuntimeSelection().prepareEditClipboardDescriptor(project(), descriptor), descriptor);
});

test('the selected Sound clipboard boundary refuses a fully admitted disabled V7 resource without migrating its recipe', () => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const original = project(), before = structuredClone(original), descriptor = resourceDescriptor();
	const recipe = structuredClone(descriptor);
	assert.throws(() => runtime.prepareEditClipboardDescriptor(original, descriptor), /Unsupported clipboard schema version: 7/u);
	assert.deepEqual(descriptor, recipe);
	assert.deepEqual(original, before);
});

for (const descriptor of [...LEGACY_VERSIONS.map(legacyDescriptor), resourceDescriptor()]) {
	test(`the selected Sound clipboard boundary rejects a descriptor${String(descriptor.schemaVersion)} schema tag accessor with zero reads`, () => {
		const hostile = structuredClone(descriptor);
		let reads = 0;
		Object.defineProperty(hostile, 'schemaVersion', { enumerable: true,
			get() { reads += 1; throw new Error('borrowed schema tag executed'); },
		});
		assert.throws(() => createSoundscaperProjectRuntimeSelection().prepareEditClipboardDescriptor(project(), hostile), /own enumerable data property/u);
		assert.equal(reads, 0);
	});
}
