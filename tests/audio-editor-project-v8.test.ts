import assert from 'node:assert/strict';
import test from 'node:test';

import {
	migrateAudioEditorProject,
	migrateAudioEditorProjectV7ToV8,
	migrateAudioEditorProjectV8ToV9,
} from '../src/common/editor/migration.js';
import { createAudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';
import {
	createAudioEditorProjectV8,
	createVideoClipV8,
	createVideoSourceV8,
	createVideoTrackV8,
	loadAudioEditorProjectV8,
	validateAudioEditorProjectV8,
} from '../src/common/editor/project-v8.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const NOW = '2026-07-28T12:00:00.000Z';

test('V8 stores the second effect batch while V7 remains frozen', () => {
	const effect = createVideoEffect('chroma-key', { id: 'key' });
	const clip = createVideoClipV8({
		id: 'clip',
		sourceId: 'source',
		durationFrames: 1,
		sourceDurationFrames: 1,
		videoEffects: [effect],
	});
	const source = createVideoSourceV8({
		id: 'source',
		frameCount: 1,
		width: 16,
		height: 16,
		frameRate: 30,
		videoCodec: 'vp9',
	});
	const track = createVideoTrackV8({ id: 'track', clipIds: ['clip'] });
	const project = createAudioEditorProjectV8({ now: NOW, sources: [source], clips: [clip], tracks: [track] });
	assert.equal(project.schemaVersion, 8);
	assert.deepEqual((project.clips[0] as { videoEffects: unknown }).videoEffects, [effect]);
	assert.equal(validateAudioEditorProjectV8(project), true);
	assert.throws(() => createAudioEditorProjectV7({ now: NOW, clips: [clip] }), /not supported by this schema/u);
});

test('V7 to V8 migration is pure and preserves ADM metadata', () => {
	const v7 = createAudioEditorProjectV7({ now: NOW });
	const original = structuredClone(v7);
	const v8 = migrateAudioEditorProjectV7ToV8(v7);
	assert.equal(v8.schemaVersion, 8);
	assert.deepEqual(v8.metadata, v7.metadata);
	assert.deepEqual(v7, original);
	assert.deepEqual(migrateAudioEditorProject(v7), {
		project: migrateAudioEditorProjectV8ToV9(v8),
		migrated: true,
		fromVersion: 7,
		readOnly: false,
		reason: null,
	});
});

test('V8 load clones current documents and preserves future documents read-only', () => {
	const project = createAudioEditorProjectV8({ now: NOW });
	const loaded = loadAudioEditorProjectV8(project);
	assert.deepEqual(loaded.project, project);
	assert.notStrictEqual(loaded.project, project);
	const future = { ...project, schemaVersion: 9, future: { retained: true } };
	assert.deepEqual(loadAudioEditorProjectV8(future), {
		project: future,
		readOnly: true,
		reason: 'newer-schema',
	});
});
