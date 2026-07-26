/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';

function createRuntime(): ProjectImportRuntime {
	const callable = () => undefined;
	return new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'copy') return { timelineFramesFinite: 'Frames must be finite.' };
			if (name === 'getProject') return () => ({ tracks: [], sources: [] });
			return callable;
		},
	}) as ProjectImportRuntime;
}

test('project import options resolve automatic destinations deterministically', () => {
	const service = createProjectImportService(createRuntime());
	assert.deepEqual(service.normalizeImportOptions({ projectBinVisible: true }), {
		destination: 'project-bin',
		trackId: null,
		timelineStartFrame: 0,
	});
	assert.deepEqual(service.normalizeImportOptions({
		destination: 'timeline',
		trackId: 'track-1',
		timelineStartFrame: 12.6,
	}), {
		destination: 'timeline',
		trackId: 'track-1',
		timelineStartFrame: 13,
	});
});

test('project import options reject unsupported destinations and non-finite frames', () => {
	const service = createProjectImportService(createRuntime());
	assert.throws(() => service.normalizeImportOptions({ destination: 'library' }), /Unsupported audio import destination/u);
	assert.throws(() => service.normalizeImportTimelineStartFrame(Number.POSITIVE_INFINITY), /Frames must be finite/u);
});
