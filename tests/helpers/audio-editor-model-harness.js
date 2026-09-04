/* SPDX-License-Identifier: AGPL-3.0-only */

// Project fixtures the audio editor model suites share: the normalized current
// documents each command is applied to and the helpers that read results back.
// Split out of audio-editor-model.test.js so its suites can sit in separate
// files.

import {
	applyEditorCommand,
} from '../../src/common/editor/commands.js';
import {
	createCurrentAudioEditorProject,
} from '../../src/common/editor/project-current.ts';

export const NOW = '2026-07-12T10:00:00.000Z';

export function apply(project, command) {
	return applyEditorCommand(project, command, { now: NOW });
}

export function createFixture(options = {}) {
	let project = createCurrentAudioEditorProject({ id: 'project-1', title: 'Studio Test', now: NOW });
	project = apply(project, {
		type: 'source/add',
		source: {
			id: 'source-1', name: 'source.wav', storageKey: 'pcm/source-1', mimeType: 'audio/wav',
			frameCount: options.frameCount ?? 4_800, channelCount: options.channelCount ?? 2,
		},
	});
	project = apply(project, { type: 'track/add', track: { id: 'track-1', name: 'Voice' } });
	project = apply(project, { type: 'track/add', track: { id: 'track-2', name: 'Music' } });
	return project;
}
