/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import type { EngineRuntimeOptions } from '../src/common/editor/engine/lifecycle.ts';
import type { AudioScheduledSourceNode } from '../src/common/editor/engine/project-graph.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

for (const completion of ['success', 'failure', 'abort'] as const) {
	test(`offline source ended retains its signal path until render ${completion} owns disposal`, async () => {
		const fixture = offlineFixture();
		const engine = createAudioEditorEngine({ audioContextFactory: null,
			offlineAudioContextFactory: (() => fixture.context) as unknown as EngineRuntimeOptions['offlineAudioContextFactory'] });
		engine.loadProject(project(), new Map([['source', fixture.buffer as unknown as AudioBuffer]]));
		const controller = new AbortController();
		const render = engine.renderMix({ outputFrames: 128, includeTrackPan: false, signal: controller.signal });
		await fixture.started.promise;
		const source = fixture.sources[0];
		assert.ok(source?.onended, 'the real scheduler installs the ended callback');
		source.onended();
		assert.equal(fixture.nodes.every(node => node.disconnectCount === 0), true,
			'offline ended must not disconnect source or gain nodes while startRendering is pending');
		try {
			if (completion === 'success') {
				fixture.rendered.resolve(fixture.buffer);
				assert.strictEqual(await render, fixture.buffer);
			} else if (completion === 'failure') {
				const primary = new Error('native render failed');
				fixture.rendered.reject(primary);
				await assert.rejects(render, error => error === primary);
			} else {
				controller.abort();
				await assert.rejects(render, { name: 'AbortError' });
				fixture.rendered.resolve(fixture.buffer);
			}
			assert.equal(fixture.nodes.every(node => node.disconnectCount === 1), true,
				'render finally must dispose every retained signal node exactly once');
		} finally {
			fixture.rendered.resolve(fixture.buffer);
			await engine.dispose();
		}
	});
}

test('live source ended still promptly disconnects all transient signal nodes', async () => {
	const fixture = offlineFixture();
	const activeSources = new Set<AudioScheduledSourceNode>();
	const allNodes: AudioNode[] = [];
	await scheduleProjectClips({ context: fixture.context as unknown as BaseAudioContext,
		project: project(), sources: new Map([['source', fixture.buffer as unknown as AudioBuffer]]),
		trackInputs: new Map([['track', fixture.context.destination as unknown as AudioNode]]),
		fromFrame: 0, toFrame: 128, contextStartTime: 0, sampleRate: 48_000,
		reversedBuffers: new WeakMap(), sourceResolver: null, activeSources, allNodes, mode: 'live' });
	assert.equal(activeSources.size, 1);
	assert.equal(fixture.nodes.length, 4);
	assert.equal(fixture.nodes.every(node => node.disconnectCount === 0), true);
	const source = fixture.sources[0];
	assert.ok(source?.onended);
	source.onended();
	assert.equal(activeSources.size, 0);
	assert.equal(fixture.nodes.every(node => node.disconnectCount === 1), true);
});

function project(): EngineProject {
	return { sampleRate: 48_000, masterChannels: 2, master: { effects: [] },
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: 128, sourceDurationFrames: 128 }] };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, resolve, reject };
}

function offlineFixture() {
	const nodes: { disconnectCount: number; disconnect(): void }[] = [];
	const sources: { onended: (() => void) | null }[] = [];
	const buffer = { sampleRate: 48_000, numberOfChannels: 2, length: 128,
		getChannelData: () => new Float32Array(128) };
	const started = deferred<void>();
	const rendered = deferred<typeof buffer>();
	const node = () => {
		const result = { disconnectCount: 0, connect() {}, disconnect() { this.disconnectCount++; } };
		nodes.push(result);
		return result;
	};
	const param = () => ({ value: 1, setValueAtTime(value: number) { this.value = value; },
		linearRampToValueAtTime(value: number) { this.value = value; }, cancelScheduledValues() {} });
	const context = { sampleRate: 48_000, length: 128, currentTime: 0,
		destination: { connect() {}, disconnect() {} },
		createGain: () => Object.assign(node(), { gain: param() }),
		createBufferSource() {
			const source = Object.assign(node(), { buffer: null, playbackRate: param(),
				onended: null as (() => void) | null, start() {}, stop() {} });
			sources.push(source);
			return source;
		},
		startRendering() { started.resolve(); return rendered.promise; },
	};
	return { nodes, sources, buffer, context, started, rendered };
}
