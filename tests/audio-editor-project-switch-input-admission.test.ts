/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSwitchService, type ProjectSwitchServiceRuntime } from '../src/common/editor/controller/project-switch-service.ts';
import { createFixture, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('activation uses the admitted history instead of traversing the stored input', async () => {
	const fixture = createFixture();
	const input = { id: 'custody', schemaVersion: 999, get tracks(): never { throw new Error('Opaque inventory was read.'); } };
	const admitted = { ...project(input.id, []), schemaVersion: 999 };
	const service = createProjectSwitchService({
		...fixture.runtime,
		loadProject: () => ({ project: input, readOnly: true }),
		createHistory(value: unknown) {
			assert.equal(value, input);
			return { present: admitted };
		},
	});
	await service.openProject(input);
	assert.equal(fixture.getProject(), admitted);
	assert.equal(fixture.getLoadedEngineProject(), admitted);
	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getTab(input.id)?.history.present, admitted);
});

test('opaque input identifiers are not evaluated before history admission', async () => {
	const fixture = createFixture();
	const input = { get id(): never { throw new Error('Opaque identity getter was evaluated.'); } };
	const admitted = { ...project('admitted-custody', []), schemaVersion: 999 };
	const service = createProjectSwitchService({
		...fixture.runtime,
		loadProject: () => ({ project: input, readOnly: true }),
		createHistory: () => ({ present: admitted }),
	});
	await service.openProject(input);
	assert.equal(fixture.getProject(), admitted);
	assert.equal(fixture.state.readOnly, true);
});

test('admission rejects a history belonging to a different declared project', async () => {
	const fixture = createFixture();
	const previous = fixture.getProject();
	const service = createProjectSwitchService({
		...fixture.runtime,
		loadProject: () => ({ project: { id: 'requested' }, readOnly: true }),
		createHistory: () => ({ present: project('different', []) }),
	});
	await assert.rejects(service.openProject({}), /history must belong to the requested project/);
	assert.equal(fixture.getProject(), previous);
});

test('create-only storage acknowledges publication without replacing the admitted document', async () => {
	const fixture = createFixture();
	const createProjectIfAbsent: NonNullable<ProjectSwitchServiceRuntime<ReturnType<typeof project>, ReturnType<typeof fixture.runtime.createHistory>>['createProjectIfAbsent']>
		= value => ({ id: value.id });
	const service = createProjectSwitchService({ ...fixture.runtime, createProjectIfAbsent });
	const input = project('created-project');
	await service.switchProject(input, { save: true });
	assert.equal(fixture.getProject()?.title, input.title);
	assert.deepEqual(fixture.getProject()?.tracks, input.tracks);
	assert.ok(fixture.events.includes(`marked-saved:${input.id}`));
});
