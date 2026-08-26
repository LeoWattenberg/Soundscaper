/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createDeferredLocalAssistancePreparation,
	type DeferredLocalAssistancePreparationModule,
	type DeferredLocalAssistanceRuntimeDependencies,
} from '../src/common/editor/controller/deferred-local-assistance-runtime.ts';

test('selected-media assistance loads on first dialog operation and caches its runtime', async () => {
	const calls: unknown[][] = [];
	let loads = 0;
	const dependencies = { assistanceStore: {}, marker: 'dependencies' } as unknown as DeferredLocalAssistanceRuntimeDependencies;
	const preparation = createDeferredLocalAssistancePreparation(dependencies, async () => {
		loads += 1;
		return {
			createLocalAssistancePreparationRuntime: (received: unknown) => {
				calls.push(['create', received]);
				return {
					listSelectedMedia: async () => ({ sources: ['audio'] }),
					prepareSelectedMedia: async (...args: unknown[]) => { calls.push(['prepare', ...args]); return 'prepared'; },
					acceptValidatedResult: async (...args: unknown[]) => { calls.push(['accept', ...args]); },
					prepareTranscriptCleanup: async (...args: unknown[]) => { calls.push(['cleanup', ...args]); return ['proposal']; },
					acceptTranscriptCleanup: async (...args: unknown[]) => { calls.push(['cleanup-accept', ...args]); },
					rejectTranscriptCleanup: async () => { calls.push(['cleanup-reject']); },
					cancelTranscriptCleanup: async () => { calls.push(['cleanup-cancel']); },
				};
			},
		} as unknown as DeferredLocalAssistancePreparationModule;
	});

	assert.equal(loads, 0);
	assert.deepEqual(await preparation.listSelectedMedia(), { sources: ['audio'] });
	assert.equal(await preparation.prepareSelectedMedia({
		sourceId: 'source-1',
		operation: 'speech-recognition',
	}), 'prepared');
	await preparation.acceptValidatedResult?.({ operation: 'speech-recognition' });
	assert.deepEqual(await preparation.prepareTranscriptCleanup?.({ transcript: true }), ['proposal']);
	await preparation.acceptTranscriptCleanup?.(['proposal-1']);
	await preparation.rejectTranscriptCleanup?.();
	await preparation.cancelTranscriptCleanup?.();
	assert.equal(loads, 1);
	assert.deepEqual(calls, [
		['create', dependencies],
		['prepare', { sourceId: 'source-1', operation: 'speech-recognition' }],
		['accept', { operation: 'speech-recognition' }],
		['cleanup', { transcript: true }],
		['cleanup-accept', ['proposal-1']],
		['cleanup-reject'],
		['cleanup-cancel'],
	]);
});

test('assistance acceptance remains absent when the project has no assistance store', () => {
	const preparation = createDeferredLocalAssistancePreparation({} as DeferredLocalAssistanceRuntimeDependencies, async () => {
		throw new Error('must not load during composition');
	});
	assert.equal('acceptValidatedResult' in preparation, false);
	assert.equal('prepareTranscriptCleanup' in preparation, false);
});

test('assistance loader failures preserve the original rejection', async () => {
	const failure = new Error('assistance loader failed');
	const preparation = createDeferredLocalAssistancePreparation({} as DeferredLocalAssistanceRuntimeDependencies, async () => { throw failure; });
	await assert.rejects(preparation.listSelectedMedia(), (error) => error === failure);
	await assert.rejects(preparation.prepareSelectedMedia({
		sourceId: 'source-1',
		operation: 'speech-recognition',
	}), (error) => error === failure);
});

test('effect audio composition does not statically own assistance implementation modules', () => {
	const source = readFileSync(
		new URL('../src/common/editor/controller/effect-audio-service.ts', import.meta.url),
		'utf8',
	);
	for (const implementation of [
		'local-assistance-result-acceptance.ts',
		'local-assistance-selected-media.ts',
		'local-assistance-selected-preparation.ts',
		'local-assistance-selected-video.ts',
	]) assert.doesNotMatch(source, new RegExp(`from ['"].*${implementation.replaceAll('.', '\\.')}`), implementation);
	assert.doesNotMatch(source, /from ['"]\.\.\/spectral-edit-admission\.ts['"]/u);
});
