import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { validateAudioEditorProject } from '../src/common/editor/project.js';
import { createAudioEditorProjectV5 } from '../src/common/editor/project-v5.js';
import {
	cloneAudioEditorProjectV6,
	createAudioEditorProjectV6,
	normalizeProjectBextMetadata,
} from '../src/common/editor/project-v6.ts';

const NOW = '2026-07-28T12:34:56.000Z';

test('V6 projects persist canonical BEXT v2 metadata or an explicit null', () => {
	const empty = createAudioEditorProjectV6({ title: 'Uninitialized', now: NOW });
	assert.equal(empty.schemaVersion, 6);
	assert.equal(empty.metadata.bext, null);
	assert.equal(validateAudioEditorProject(empty as never), true);

	const input = {
		description: '  Broadcast master  ',
		originator: 'Soundscaper',
		timeReference: '9007199254740993',
		umid: 'ab'.repeat(32),
		loudnessValue: -23,
		codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\r\n',
	};
	const project = createAudioEditorProjectV6({
		title: 'Broadcast project',
		now: NOW,
		metadata: { title: 'Broadcast project', artist: 'Editor', bext: input },
	});

	assert.ok(project.metadata.bext);
	assert.deepEqual(project.metadata.bext, {
		description: '  Broadcast master  ',
		originator: 'Soundscaper',
		originatorReference: '',
		originationDate: '',
		originationTime: '',
		timeReference: '9007199254740993',
		version: 2,
		umid: `${'ab'.repeat(32)}${'0'.repeat(64)}`,
		loudnessValue: -23,
		loudnessRange: null,
		maxTruePeakLevel: null,
		maxMomentaryLoudness: null,
		maxShortTermLoudness: null,
		codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\n',
	});
	assert.equal(project.metadata.artist, 'Editor');

	input.description = 'Changed after creation';
	assert.equal(project.metadata.bext.description, '  Broadcast master  ');
	const cloned = cloneAudioEditorProjectV6(project);
	assert.deepEqual(cloned, project);
	assert.notStrictEqual(cloned.metadata.bext, project.metadata.bext);
});

test('V6 BEXT normalization forces the project profile to version 2', () => {
	assert.equal(normalizeProjectBextMetadata({ version: 2 }).version, 2);
	assert.throws(
		() => normalizeProjectBextMetadata({ timeReference: '-1' }),
		/time reference|timeReference|unsigned/u,
	);
});

test('metadata commands normalize, replace, and clear V6 BEXT without exposing it to legacy schemas', () => {
	const project = createAudioEditorProjectV6({ now: NOW });
	const changes = {
		bext: {
			description: 'Command metadata',
			timeReference: '48000',
			codingHistory: 'Original row\r\n',
		},
	};
	const updated = applyEditorCommand(project, { type: 'metadata/update', changes }, { now: NOW });
	assert.equal(updated.metadata.bext?.description, 'Command metadata');
	assert.equal(updated.metadata.bext?.timeReference, '48000');
	assert.equal(updated.metadata.bext?.version, 2);
	assert.equal(updated.metadata.bext?.codingHistory, 'Original row\n');
	assert.deepEqual(changes.bext, {
		description: 'Command metadata',
		timeReference: '48000',
		codingHistory: 'Original row\r\n',
	});

	const cleared = applyEditorCommand(updated, {
		type: 'metadata/update',
		changes: { bext: null },
	}, { now: NOW });
	assert.equal(cleared.metadata.bext, null);
	assert.throws(() => applyEditorCommand(createAudioEditorProjectV5({ now: NOW }), {
		type: 'metadata/update',
		changes: { bext: null },
	}, { now: NOW }), /cannot be updated/u);
});
