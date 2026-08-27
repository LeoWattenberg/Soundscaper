/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDeferredAssistanceDerivativeRepository,
	type AssistanceDerivativeRepositoryConstructor,
} from '../src/common/editor/storage/deferred-assistance-derivative-repository.ts';

const VALUES = Object.freeze({
	get: () => undefined,
	putIfAbsent: () => true,
	delete: () => undefined,
	deleteIfCurrent: () => true,
	listByPrefix: () => Object.freeze([]),
});
const PAYLOAD = Object.freeze({ mediaType: 'application/octet-stream', bytes: new Uint8Array([1]) });

test('assistance derivative storage loads only on first use and reuses one repository', async () => {
	let loads = 0;
	let constructions = 0;
	const calls: string[] = [];
	class Repository {
		constructor(values: unknown) {
			assert.equal(values, VALUES);
			constructions += 1;
		}

		async save(): Promise<never> {
			calls.push('save');
			throw new Error('save witness');
		}

		async saveBatch(): Promise<readonly never[]> {
			calls.push('saveBatch');
			return [];
		}

		async load(): Promise<null> {
			calls.push('load');
			return null;
		}

		async listProject(projectId: string): Promise<readonly never[]> {
			calls.push(`listProject:${projectId}`);
			return [];
		}

		async purgeProject(projectId: string): Promise<number> {
			calls.push(`purgeProject:${projectId}`);
			return 2;
		}

		async purge(): Promise<number> {
			calls.push('purge');
			return 3;
		}
	}
	const repository = createDeferredAssistanceDerivativeRepository(
		VALUES,
		async () => {
			loads += 1;
			return Repository as unknown as AssistanceDerivativeRepositoryConstructor;
		},
	);

	assert.equal(loads, 0);
	assert.equal(constructions, 0);
	await assert.rejects(repository.save({}, 'embeddings', PAYLOAD), /save witness/u);
	assert.deepEqual(await repository.saveBatch({}, [{ kind: 'embeddings', payload: PAYLOAD }]), []);
	assert.equal(await repository.load({}, 'embeddings'), null);
	assert.deepEqual(await repository.listProject('project-1'), []);
	assert.equal(await repository.purgeProject('project-1'), 2);
	assert.equal(await repository.purge(), 3);
	assert.equal(loads, 1);
	assert.equal(constructions, 1);
	assert.deepEqual(calls,
		['save', 'saveBatch', 'load', 'listProject:project-1', 'purgeProject:project-1', 'purge']);
});

test('assistance derivative storage retries a failed implementation load', async () => {
	let loads = 0;
	class Repository {
		async save(): Promise<never> { throw new Error('unused'); }
		async saveBatch(): Promise<readonly never[]> { return []; }
		async load(): Promise<null> { return null; }
		async listProject(): Promise<readonly never[]> { return []; }
		async purgeProject(): Promise<number> { return 0; }
		async purge(): Promise<number> { return 1; }
	}
	const repository = createDeferredAssistanceDerivativeRepository(
		VALUES,
		async () => {
			loads += 1;
			if (loads === 1) throw new Error('load witness');
			return Repository as unknown as AssistanceDerivativeRepositoryConstructor;
		},
	);

	await assert.rejects(repository.purge(), /load witness/u);
	assert.equal(await repository.purge(), 1);
	assert.equal(loads, 2);
});
