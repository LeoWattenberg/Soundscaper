/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand as apply } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperProjectForRuntimeConsumers, framescaperProjectForCommandConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand,
	undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';

const CURVE = [{ frame: 0, value: .5 }, { frame: 48_000, value: .125 }];
type Scope = 'master' | 'track';
function fixture() {
	return createFramescaperProject(PROFILE, { id: 'master-curve',
		tracks: [{ id: 'dialogue', name: 'Dialogue', type: 'audio', clipIds: [] }] });
}
function edit(scope: Scope, envelope = CURVE) {
	return scope === 'master' ? { type: 'master/update', changes: { envelope } }
		: { type: 'track/update', trackId: 'dialogue', changes: { envelope } };
}
function strip(project: Readonly<Record<string, unknown>>, scope: Scope): Record<string, unknown> {
	const tracks = project.tracks;
	assert.ok(Array.isArray(tracks));
	const owner: unknown = scope === 'master' ? project.master : tracks.find((item: unknown) => (
		item && typeof item === 'object' && 'id' in item && item.id === 'dialogue'
	));
	assert.ok(owner && typeof owner === 'object' && !Array.isArray(owner));
	return owner as Record<string, unknown>;
}
function authored(scope: Scope): FramescaperProject { return apply(PROFILE, fixture(), edit(scope)); }

for (const scope of ['master', 'track'] as const) {
	for (const [view, projectForConsumers] of [['runtime', framescaperProjectForRuntimeConsumers],
		['command', framescaperProjectForCommandConsumers]] as const) {
		test(`native ${view} consumers retain the accepted ${scope} curve without sharing it`, () => {
			const project = authored(scope);
			const before = structuredClone(project);
			assert.deepEqual(strip(project, scope).envelope, CURVE);
			const projected = projectForConsumers(PROFILE, project);
			assert.deepEqual(strip(projected, scope).envelope, CURVE);
			assert.notEqual(strip(projected, scope).envelope, strip(project, scope).envelope);
			assert.deepEqual(project, before);
		});
	}
	for (const [name, command] of [
		['selection', { type: 'selection/set', startFrame: 0, endFrame: 48_000, trackIds: ['dialogue'], clipIds: [] }],
		['master gain', { type: 'master/update', changes: { gain: .75 } }],
		['track rename', { type: 'track/update', trackId: 'dialogue', changes: { name: 'Renamed dialogue' } }],
		['track pan', { type: 'track/update', trackId: 'dialogue', changes: { pan: .25 } }],
	] as const) {
		test(`an ordinary ${name} command preserves the accepted native ${scope} curve`, () => {
			const project = authored(scope);
			const before = structuredClone(project);
			const result = apply(PROFILE, project, command);
			assert.deepEqual(strip(result, scope).envelope, CURVE);
			assert.deepEqual(project, before);
			assert.equal(result.revision, project.revision + 1);
			assert.deepEqual(result.sources, project.sources);
			assert.deepEqual(result.clips, project.clips);
			if (name === 'master gain') assert.equal(strip(result, 'master').gain, .75);
			if (name === 'track rename') assert.equal(strip(result, 'track').name, 'Renamed dialogue');
			if (name === 'track pan') assert.equal(strip(result, 'track').pan, .25);
		});
	}
	for (const replacement of [[{ frame: 0, value: .25 }, { frame: 48_000, value: .75 }], []]) {
		test(`an explicit ${scope} curve ${replacement.length ? 'replacement' : 'clear'} remains authoritative`, () => {
			const project = authored(scope);
			const result = apply(PROFILE, project, edit(scope, replacement));
			assert.deepEqual(strip(result, scope).envelope, replacement);
			assert.deepEqual(strip(project, scope).envelope, CURVE);
		});
	}
}

test('one native batch retains both newly authored strip curves through later edits', () => {
	const original = fixture();
	const before = structuredClone(original);
	const result = apply(PROFILE, original, { type: 'batch', commands: [edit('master'), edit('track'),
		{ type: 'batch', commands: [{ type: 'master/update', changes: { gain: .8 } },
			{ type: 'track/update', trackId: 'dialogue', changes: { name: 'Dialogue edited' } }] }] });
	assert.deepEqual(strip(result, 'master').envelope, CURVE);
	assert.deepEqual(strip(result, 'track').envelope, CURVE);
	assert.equal(strip(result, 'master').gain, .8);
	assert.equal(strip(result, 'track').name, 'Dialogue edited');
	assert.deepEqual(original, before);
});

test('native history retains the master curve after an ordinary selection and complete Undo/Redo', () => {
	const original = fixture();
	let history = createFramescaperProjectHistory(PROFILE, original);
	history = executeFramescaperProjectCommand(PROFILE, history, edit('master'));
	const curved = history.present;
	history = executeFramescaperProjectCommand(PROFILE, history, { type: 'selection/set',
		startFrame: 0, endFrame: 48_000, trackIds: ['dialogue'], clipIds: [] });
	assert.deepEqual(strip(history.present, 'master').envelope, CURVE);
	assert.equal(history.undoStack.length, 2);
	history = undoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(history.present.master, curved.master);
	history = undoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(history.present.master, original.master);
	history = redoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(history.present.master, curved.master);
	history = redoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(strip(history.present, 'master').envelope, CURVE);
	assert.deepEqual(strip(framescaperProjectForRuntimeConsumers(PROFILE, history.present), 'master').envelope, CURVE);
});

test('an untouched native project still projects healthy unity master and audio strips', () => {
	const project = fixture();
	const projected = framescaperProjectForRuntimeConsumers(PROFILE, project);
	assert.deepEqual(strip(projected, 'master').envelope, []);
	assert.deepEqual(strip(projected, 'track').envelope, []);
	assert.equal(strip(projected, 'master').gain, 1);
	assert.equal(strip(projected, 'track').gain, 1);
});
