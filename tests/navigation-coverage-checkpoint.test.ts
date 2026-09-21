/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	installNavigationCoverageCheckpoints,
	installPageOperationCoverageCheckpoints,
} from '../scripts/lib/navigation-coverage-checkpoint.mjs';

test('a navigation pauses until its coverage checkpoint finishes', async () => {
	const session = new FakeSession();
	let releaseCheckpoint: (() => void) | undefined;
	const checkpoints = await installNavigationCoverageCheckpoints({
		checkpoint: () => new Promise<void>((resolve) => { releaseCheckpoint = resolve; }),
		session,
	});
	const hookScriptId = session.hookScriptId();

	session.emit('Debugger.paused', {
		callFrames: [{ location: { scriptId: hookScriptId } }],
		reason: 'other',
	});
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(session.methods.includes('Debugger.resume'), false);

	assert.ok(releaseCheckpoint);
	releaseCheckpoint();
	await checkpoints.settle();
	assert.equal(session.methods.at(-1), 'Debugger.resume');
	await checkpoints.dispose();
	assert.equal(session.methods.includes('Page.removeScriptToEvaluateOnNewDocument'), true);
});

test('an unrelated debugger pause is resumed without taking a checkpoint', async () => {
	const session = new FakeSession();
	let checkpointCount = 0;
	const checkpoints = await installNavigationCoverageCheckpoints({
		checkpoint: async () => { checkpointCount += 1; },
		session,
	});

	session.emit('Debugger.paused', {
		callFrames: [{ location: { scriptId: 'unrelated' } }],
		reason: 'other',
	});
	await checkpoints.settle();
	assert.equal(checkpointCount, 0);
	assert.equal(session.methods.at(-1), 'Debugger.resume');
	await checkpoints.dispose();
});

test('an audio-context close identifies its lifecycle checkpoint before resuming', async () => {
	const session = new FakeSession();
	const reasons: Array<string | undefined> = [];
	const checkpoints = await installNavigationCoverageCheckpoints({
		checkpoint: async (reason) => { reasons.push(reason); },
		session,
	});

	session.emit('Debugger.paused', {
		callFrames: [{
			functionName: '__soundscaperCoverageCloseAudioContext',
			location: { scriptId: session.hookScriptId() },
		}],
		reason: 'other',
	});
	await checkpoints.settle();
	assert.deepEqual(reasons, ['audio-context-close']);
	assert.equal(session.methods.at(-1), 'Debugger.resume');
	await checkpoints.dispose();
});

test('page navigation and close operations checkpoint before the original call', async () => {
	const calls: string[] = [];
	let releaseCheckpoint: (() => void) | undefined;
	const page = {
		async close(): Promise<void> { calls.push('close'); },
		async goto(): Promise<void> { calls.push('goto'); },
		async reload(): Promise<void> { calls.push('reload'); },
	};
	const originalReload = page.reload;
	const checkpoints = installPageOperationCoverageCheckpoints({
		checkpoint: () => new Promise<void>((resolve) => {
			calls.push('checkpoint');
			releaseCheckpoint = resolve;
		}),
		page,
	});

	const reloading = page.reload();
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.deepEqual(calls, ['checkpoint']);
	assert.ok(releaseCheckpoint);
	releaseCheckpoint();
	await reloading;
	assert.deepEqual(calls, ['checkpoint', 'reload']);

	checkpoints.dispose();
	assert.equal(page.reload, originalReload);
});

class FakeSession extends EventEmitter {
	readonly methods: string[] = [];
	#nextScriptId = 0;

	hookScriptId(): string {
		return String(this.#nextScriptId);
	}

	async send(method: string, parameters?: { expression?: string; source?: string }): Promise<Record<string, unknown>> {
		this.methods.push(method);
		if (method === 'Page.addScriptToEvaluateOnNewDocument') {
			return { identifier: 'coverage-hook' };
		}
		if (method === 'Runtime.evaluate'
			&& parameters?.expression?.includes('soundscaper-coverage://navigation-checkpoint.js')) {
			this.#nextScriptId += 1;
			this.emit('Debugger.scriptParsed', {
				scriptId: String(this.#nextScriptId),
				url: 'soundscaper-coverage://navigation-checkpoint.js',
			});
		}
		return {};
	}
}
