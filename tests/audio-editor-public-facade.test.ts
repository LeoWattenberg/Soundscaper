/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as editor from '../src/common/editor/index.js';
import type {
	AudioEditorCommand,
	AudioEditorCommandPayloads,
	CreateEditorController,
	EditorController,
	EditorControllerOptions,
	EditorActions,
	EditorLabelTrack,
	EditorProject,
	SampleFrame,
	EditorSnapshot,
} from '../src/common/editor/index.js';

test('public editor facade exposes intentional controller, model, protocol, and adapter APIs', () => {
	const createController: CreateEditorController = editor.createEditorController;
	assert.equal(createController, editor.createAudioEditorController);
	for (const name of [
		'createEditorController',
		'createEditorProjectStore',
		'createAudioSource',
		'createMediaSource',
		'createVideoSource',
		'createMediaClip',
		'createCurrentAudioEditorProject',
		'createAudioEditorProjectV17',
		'applyEditorCommand',
		'createAddTimelineAnnotationCommand',
		'createBatchSetTimelineAnnotationsCommand',
		'createConvertTimelineAnnotationCommand',
		'createMoveTimelineAnnotationsCommand',
		'createRemoveTimelineAnnotationsCommand',
		'createResizeTimelineAnnotationCommand',
		'createUpdateTimelineAnnotationsCommand',
		'createAudioEditorEngine',
		'WorkerRequestBroker',
		'EDITOR_WORKER_PROTOCOL_VERSION',
		'EditorDisposedError',
		'EditorStoreClosedError',
		'FfmpegDisposedError',
	]) {
		assert.equal(typeof editor[name as keyof typeof editor] !== 'undefined', true, name);
	}
	assert.equal('createAiffStreamEncoder' in editor, false);
	assert.equal('applyAudacityEffectAsync' in editor, false);
	assert.equal('createAudioEditorProjectV5' in editor, false);
	assert.equal('createAudioEditorProjectV12' in editor, false);
});

test('public controller types retain grouped actions and the exact current project schema', () => {
	const options: EditorControllerOptions = { productId: 'soundscaper', locale: 'de' };
	const version: EditorProject['schemaVersion'] = 17;
	const readSnapshot = (controller: EditorController): EditorSnapshot => controller.getSnapshot();
	assert.deepEqual(options, { productId: 'soundscaper', locale: 'de' });
	assert.equal(version, 17);
	assert.equal(typeof readSnapshot, 'function');
});

test('public project validation accepts only the exact current shared schema', () => {
	const current = editor.createCurrentAudioEditorProject({
		id: 'public-current-project',
		now: '2026-08-20T10:00:00.000Z',
	});
	assert.equal(editor.validateAudioEditorProject(current), true);
	for (let retired = 2; retired <= 16; retired += 1) {
		assert.throws(
			() => editor.validateAudioEditorProject({ ...current, schemaVersion: retired }),
			/Unsupported audio editor schema version/u,
		);
	}
	assert.throws(
		() => editor.validateAudioEditorProject({ ...current, schemaVersion: 18 }),
		/Unsupported audio editor schema version/u,
	);
});

test('public action types expose every stable action group', () => {
	const groupNames: readonly (keyof EditorActions)[] = [
		'project', 'projectBin', 'video', 'edit', 'transport', 'recording',
		'metering', 'audioDevices', 'timeline', 'timelineAnnotations', 'trackFolders', 'sampleEdit', 'spectral', 'track',
		'mixer', 'generators', 'nyquist', 'labels', 'metadata', 'preferences',
		'clip', 'effects', 'macros', 'analysis', 'export',
	];

	assert.equal(groupNames.length, 25);
});

test('public label-track type matches the serialized label model', () => {
	const track = {
		type: 'label',
		id: 'label-track-1',
		name: 'Labels',
		height: 96,
		collapsed: false,
		locked: false,
		labels: [{
			id: 'label-1',
			title: 'Verse',
			startFrame: 24 as SampleFrame,
			endFrame: 48 as SampleFrame,
			color: 'auto',
		}],
	} satisfies EditorLabelTrack;

	assert.equal(track.labels[0].title, 'Verse');
});

test('public facade exports the authoritative command union and payload map', () => {
	const rename = {
		type: 'project/rename',
		title: 'Typed facade',
	} satisfies AudioEditorCommand;
	const payload: AudioEditorCommandPayloads['project/rename'] = { title: rename.title };
	const annotationPayload: AudioEditorCommandPayloads['timeline-annotation/remove-many'] = {
		annotationIds: ['annotation'],
	};
	assert.deepEqual(payload, { title: 'Typed facade' });
	assert.deepEqual(annotationPayload, { annotationIds: ['annotation'] });
});
