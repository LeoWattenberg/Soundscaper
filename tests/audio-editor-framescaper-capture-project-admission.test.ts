/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitFramescaperCaptureProject } from '../src/common/editor/controller/capture/internal/framescaper-capture-project-admission.ts';
import { createFramescaperCaptureAppProjectRepository, type FramescaperCaptureAppBindingStore } from '../src/common/editor/controller/capture/framescaper-capture-app-binding.ts';

function project() {
	return { id: 'capture', schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		revision: 1, sampleRate: 48_000, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 24, den: 1 }, trackIds: [] }],
	};
}

void test('capture admission preserves the admitted object and checks every sequence geometry', () => {
	const value = project();
	assert.equal(admitFramescaperCaptureProject(value, 'capture'), value);
	assert.throws(() => admitFramescaperCaptureProject(value, 'another'), /another project/u);
	for (const sequence of [null, { id: 'bad' },
		{ id: 'bad', rate: { num: 24, den: 0 }, trackIds: [] },
		{ id: 'bad', rate: { num: 24, den: 1 }, trackIds: [17] }]) {
		assert.throws(() => admitFramescaperCaptureProject({ ...value, sequences: [...value.sequences, sequence] }), /invalid/u);
	}
});

for (const isDesktop of [false, true]) {
	void test(`${isDesktop ? 'desktop' : 'web'} capture repository admits unknown reads before publishing them`, async () => {
		const current = project();
		let stored: unknown = current;
		const store = fixtureStore(() => stored);
		const repository = createFramescaperCaptureAppProjectRepository({ store, isDesktop });
		assert.equal(await repository.load('capture'), current);
		stored = null;
		assert.equal(await repository.load('capture'), null);
		stored = { ...current, id: 'another' };
		await assert.rejects(async () => repository.load('capture'), /another project/u);
		stored = { id: 'capture', schemaFamily: 'framescaper', schemaVersion: 999,
			get sequences(): never { throw new Error('Future sequence body was read'); },
		};
		await assert.rejects(async () => repository.load('capture'), /current project schema identity/u);
	});
}

function fixtureStore(load: () => unknown): FramescaperCaptureAppBindingStore {
	const unused = (): never => { throw new Error('Capture project admission reached an unrelated store port.'); };
	return {
		projectRepository: { load, saveIfCurrent: unused }, loadProject: load, saveProject: unused,
		listProjects: () => [], getMediaAssetMetadata: unused, beginMediaAssetWrite: unused,
		loadMediaAsset: unused, getSourceMetadata: unused, beginSourceWrite: unused, discardSourceIfCurrent: unused,
	};
}
