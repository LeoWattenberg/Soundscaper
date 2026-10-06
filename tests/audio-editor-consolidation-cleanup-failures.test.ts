/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareManagedAudioConsolidation, type ConsolidateManagedAudioStore } from '../src/common/editor/controller/document/internal/native-project/consolidate-managed-audio.ts';
import { withConsolidationCleanup } from '../src/common/editor/controller/document/internal/native-project/consolidation-cleanup.ts';

function errorsIn(error: unknown): unknown[] {
	return error instanceof AggregateError ? [error, ...error.errors.flatMap(errorsIn)] : [error];
}

function fixture(failWrite: boolean) {
	const primary = new Error('Original conversion failure'), abort = new Error('Writer abort failed');
	const sourceRelease = new Error('Original release failed'), copyRelease = new Error('Copy release failed'), discard = new Error('Published discard failed');
	const events: string[] = [];
	const source = { id: 'raw', storage: 'indexeddb', sourceToken: 'raw-generation', chunkCount: 1, chunkFrames: 1,
		frameCount: 1, channelCount: 1, sampleRate: 48_000, rawChunkCount: 1 };
	const project = { sources: [{ id: 'source', storageKey: 'raw', frameCount: 1, channelCount: 1, sampleRate: 48_000 }] };
	const store: ConsolidateManagedAudioStore = {
		getSourceMetadata: async () => source,
		openSourceReadSession: async (id) => ({
			chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(id === 'raw' ? 0.25 : 0.5)] }),
			release: async () => { events.push(id === 'raw' ? 'source.release' : 'copy.release'); throw id === 'raw' ? sourceRelease : copyRelease; },
		}),
		beginSourceWrite: async (id) => ({
			write: async () => { if (failWrite) throw primary; },
			commit: async () => ({ ...source, id, sourceToken: 'new-generation', rawChunkCount: 0, wavpackChunkCount: 1 }),
			abort: async () => { events.push('writer.abort'); throw abort; },
		}),
		discardSourceIfCurrent: async () => { events.push('source.discard'); throw discard; },
	};
	return { store, project, events, primary, abort, sourceRelease, copyRelease, discard };
}

test('conversion failure remains visible when writer abort and original reader release both fail', async () => {
	const f = fixture(true);
	await assert.rejects(prepareManagedAudioConsolidation(f.project, f.store, () => {}), (error: unknown) => {
		const failures = errorsIn(error);
		for (const expected of [f.primary, f.abort, f.sourceRelease]) assert.ok(failures.includes(expected));
		return true;
	});
	assert.deepEqual(f.events, ['writer.abort', 'source.release']);
});

test('verification failure drains copy, writer, original and published cleanup without masking any failure', async () => {
	const f = fixture(false);
	await assert.rejects(prepareManagedAudioConsolidation(f.project, f.store, () => {}), (error: unknown) => {
		const failures = errorsIn(error);
		assert.ok(failures.some((failure) => failure instanceof Error && /exact source sample bits/iu.test(failure.message)));
		for (const expected of [f.copyRelease, f.abort, f.sourceRelease, f.discard]) assert.ok(failures.includes(expected));
		return true;
	});
	assert.deepEqual(f.events, ['copy.release', 'writer.abort', 'source.release', 'source.discard']);
});

test('successful consolidation cleanup preserves the result and runs exactly once', async () => {
	const result = {}; let releases = 0;
	assert.strictEqual(await withConsolidationCleanup(() => result, () => { releases += 1; }), result);
	assert.equal(releases, 1);
});

test('successful cleanup preserves cancellation identity and runs exactly once', async () => {
	const reason = new DOMException('Consolidation was cancelled.', 'AbortError'); let releases = 0;
	await assert.rejects(withConsolidationCleanup(() => { throw reason; }, () => { releases += 1; }),
		(error: unknown) => error === reason);
	assert.equal(releases, 1);
});

test('a sole cleanup failure keeps its original identity and runs exactly once', async () => {
	const reason = new Error('Reader release failed.'); let releases = 0;
	await assert.rejects(withConsolidationCleanup(() => true, () => { releases += 1; throw reason; }),
		(error: unknown) => error === reason);
	assert.equal(releases, 1);
});

test('failed cancellation cleanup keeps cancellation as its primary cause and retains cleanup failure', async () => {
	const primary = new DOMException('Consolidation was cancelled.', 'AbortError'), cleanup = new Error('Release failed.');
	await assert.rejects(withConsolidationCleanup(() => { throw primary; }, () => { throw cleanup; }), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.strictEqual(error.cause, primary);
		assert.deepEqual(error.errors, [primary, cleanup]);
		return true;
	});
});
