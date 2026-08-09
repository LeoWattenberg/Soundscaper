/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION as SESSION_REEXPORT_SCHEMA_VERSION,
	createAudioEditorSessionClipboard as createSessionClipboardFromPublicModule,
} from '../src/common/editor/session.js';
import {
	AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION,
	collectAudioEditorClipboardSourceIds,
	createAudioEditorSessionClipboard,
	normalizeAudioEditorClipboardDescriptor,
	normalizeAudioEditorSessionClipboard,
} from '../src/common/editor/session-clipboard-codec.ts';

function pairedDescriptor(): Record<string, unknown> {
	return {
		schemaVersion: 2,
		sampleRate: 48_000,
		durationFrames: 100,
		tracks: [{
			sourceTrackId: 'video-track',
			sourceTrackName: 'Video',
			sourceTrackType: 'video',
			sourceLaneGroupId: 'lane-a',
			clips: [{
				key: 'video-clip:0:100',
				kind: 'video',
				sourceId: 'source-z',
				offsetFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 100,
				groupId: 'group-a',
				avLinkId: 'link-a',
			}],
		}, {
			sourceTrackId: 'audio-track',
			sourceTrackName: 'Audio',
			sourceTrackType: 'audio',
			sourceLaneGroupId: 'lane-a',
			clips: [{
				key: 'audio-clip:0:100',
				kind: 'audio',
				sourceId: 'source-a',
				offsetFrame: 0,
				sourceStartFrame: 10,
				durationFrames: 100,
				groupId: 'group-a',
				avLinkId: 'link-a',
			}, {
				key: 'audio-clip-duplicate-source:20:40',
				kind: 'audio',
				sourceId: 'source-z',
				offsetFrame: 20,
				sourceStartFrame: 20,
				durationFrames: 20,
			}],
		}],
	};
}

test('clipboard descriptor normalization clones V2 media relationships and derives sorted source roots', () => {
	const descriptor = pairedDescriptor();
	const normalized = normalizeAudioEditorClipboardDescriptor(descriptor);

	assert.deepEqual(normalized, descriptor);
	assert.notEqual(normalized, descriptor);
	assert.notEqual(normalized.tracks, descriptor.tracks);
	assert.deepEqual(collectAudioEditorClipboardSourceIds(normalized), ['source-a', 'source-z']);

	const tracks = descriptor.tracks as Record<string, unknown>[];
	(tracks[0].clips as Record<string, unknown>[])[0].sourceId = 'changed-after-normalization';
	assert.deepEqual(collectAudioEditorClipboardSourceIds(normalized), ['source-a', 'source-z']);
});

test('legacy V1 descriptors retain their permissive audio-default compatibility fields', () => {
	const legacy = {
		schemaVersion: 1,
		sampleRate: 48_000,
		durationFrames: 1,
		tracks: [{
			sourceTrackId: 'legacy-track',
			sourceTrackName: 'Legacy',
			sourceTrackType: 'future-track-kind',
			sourceLaneGroupId: 17,
			clips: [{
				key: 'legacy-clip',
				sourceId: 'legacy-source',
				offsetFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 1,
				kind: 'future-clip-kind',
				groupId: 23,
				avLinkId: 29,
			}],
		}],
	};

	assert.deepEqual(normalizeAudioEditorClipboardDescriptor(legacy), legacy);
});

test('V2 descriptor validation preserves the paired-lane and aligned-link contract', () => {
	const reversed = pairedDescriptor();
	(reversed.tracks as unknown[]).reverse();
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(reversed),
		/media lane group.*adjacent video\/audio/iu,
	);

	const mismatchedKind = pairedDescriptor();
	const mismatchedTracks = mismatchedKind.tracks as Record<string, unknown>[];
	(mismatchedTracks[0].clips as Record<string, unknown>[])[0].kind = 'audio';
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(mismatchedKind),
		/cannot contain a audio clip/iu,
	);

	const unaligned = pairedDescriptor();
	const unalignedTracks = unaligned.tracks as Record<string, unknown>[];
	(unalignedTracks[1].clips as Record<string, unknown>[])[0].offsetFrame = 1;
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(unaligned),
		/A\/V link.*aligned video\/audio pair/iu,
	);
});

test('session clipboard normalization orders referenced sources, prunes extras, and clones metadata', () => {
	const sourceA = { id: 'source-a', storageKey: 'pcm/a' };
	const sourceZ = { id: 'source-z', storageKey: 'pcm/z' };
	const normalized = normalizeAudioEditorSessionClipboard({
		schemaVersion: 1,
		originProjectId: ' project-with-preserved-spacing ',
		descriptor: pairedDescriptor(),
		sources: [
			{ id: 'unreferenced', storageKey: 'pcm/unused' },
			sourceZ,
			sourceA,
		],
		ignoredOuterField: true,
	});

	assert.equal(normalized.originProjectId, ' project-with-preserved-spacing ');
	assert.deepEqual(normalized.sources, [sourceA, sourceZ]);
	assert.notEqual(normalized.sources[0], sourceA);
	assert.equal(Object.hasOwn(normalized, 'ignoredOuterField'), false);

	assert.throws(
		() => normalizeAudioEditorSessionClipboard({
			schemaVersion: 1,
			originProjectId: 'project',
			descriptor: pairedDescriptor(),
			sources: [sourceA, sourceZ, { id: 'unreferenced' }, { id: 'unreferenced' }],
		}),
		/Duplicate session clipboard source ID: unreferenced/iu,
	);
	assert.throws(
		() => normalizeAudioEditorSessionClipboard({
			schemaVersion: 1,
			originProjectId: 'project',
			descriptor: pairedDescriptor(),
			sources: [sourceA],
		}),
		/metadata is missing for source-z/iu,
	);
});

test('session clipboard creation resolves descriptor sources and preserves the public session exports', () => {
	const descriptor = pairedDescriptor();
	const project = {
		schemaVersion: 2,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		sources: [
			{ id: 'source-z', storageKey: 'pcm/z' },
			{ id: 'source-a', storageKey: 'pcm/a' },
		],
		clips: [],
		tracks: [],
	};
	const clipboard = createAudioEditorSessionClipboard(project, { descriptor });

	assert.equal(AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION, 1);
	assert.equal(SESSION_REEXPORT_SCHEMA_VERSION, AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION);
	assert.equal(createSessionClipboardFromPublicModule, createAudioEditorSessionClipboard);
	assert.equal(clipboard.originProjectId, 'project');
	assert.deepEqual(clipboard.sources.map(({ id }) => id), ['source-a', 'source-z']);
	assert.notEqual(clipboard.descriptor, descriptor);
	assert.throws(
		() => createAudioEditorSessionClipboard({ ...project, sources: project.sources.slice(0, 1) }, { descriptor }),
		/Clipboard source source-a is missing/iu,
	);
});

test('session and descriptor schema failures retain their established error classes', () => {
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor({ ...pairedDescriptor(), schemaVersion: 99 }),
		(error: unknown) => error instanceof RangeError && /Unsupported clipboard schema version: 99/iu.test(error.message),
	);
	assert.throws(
		() => normalizeAudioEditorSessionClipboard({
			schemaVersion: 99,
			originProjectId: 'project',
			descriptor: pairedDescriptor(),
			sources: [],
		}),
		(error: unknown) => error instanceof RangeError && /Unsupported session clipboard schema version: 99/iu.test(error.message),
	);
});
