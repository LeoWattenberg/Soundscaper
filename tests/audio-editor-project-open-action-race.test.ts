/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createGroupedEditorActions,
	type EditorActionRuntime,
} from '../src/common/editor/controller/action-facade.ts';

interface TestProject {
	readonly id: string;
	readonly title: string;
}

test('the latest stored-project request owns activation when loads finish out of order', async () => {
	const projectB = Object.freeze({ id: 'project-b', title: 'Project B' });
	const projectC = Object.freeze({ id: 'project-c', title: 'Project C' });
	const pending = new Map<string, ReturnType<typeof deferred<TestProject | null>>>([
		[projectB.id, deferred<TestProject | null>()],
		[projectC.id, deferred<TestProject | null>()],
	]);
	const opened: string[] = [];
	const actions = createGroupedEditorActions(createRuntime({
		loadProject: (projectId) => pending.get(projectId)!.promise,
		openProject: async (project) => { opened.push(project.id); },
	})).project;

	const openById = actions.openById;
	if (typeof openById !== 'function') throw new TypeError('The stored-project action is unavailable.');
	const first = openById(projectB.id);
	const second = openById(projectC.id);
	pending.get(projectC.id)!.resolve(projectC);
	await second;
	pending.get(projectB.id)!.resolve(projectB);
	await first;

	assert.deepEqual(opened, [projectC.id]);
});

function createRuntime(options: Readonly<{
	loadProject(projectId: string): Promise<TestProject | null>;
	openProject(project: TestProject): Promise<void>;
}>): EditorActionRuntime {
	const callable = () => undefined;
	const videoTrimServices = Object.freeze({
		edge: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
		rollRipple: Object.freeze({ preview: callable, commit: callable }),
		slipSlide: Object.freeze({ buildStepRequest: callable, preview: callable, commit: callable }),
		rateStretch: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
	});
	return new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'capabilities') return new Proxy({}, { get: () => true });
			if (name === 'product') return { name: 'Soundscaper' };
			if (name === 'videoTrimServices') return videoTrimServices;
			if (name === 'copy') return { projectNotFound: 'Not found' };
			if (name === 'state') return {
				recentProjectIds: [projectBId, projectCId], projects: [], preferences: { recording: {} },
				audacityEffectType: 'amplify', effectPresets: {},
			};
			if (name === 'store') return { loadProject: options.loadProject };
			if (name === 'openProject') return options.openProject;
			if (name === 'sessionTab') return () => null;
			if (name === 'engine' || name === 'analysisService') return new Proxy({}, { get: () => callable });
			if (name === 'AUDIO_EDITOR_DEFAULT_SHORTCUTS') return {};
			return callable;
		},
	}) as EditorActionRuntime;
}

const projectBId = 'project-b';
const projectCId = 'project-c';

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
}> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}
