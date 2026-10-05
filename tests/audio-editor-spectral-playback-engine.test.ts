/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineOfflineContextOptions, EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createProject, MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext, MockNode } from './helpers/mock-audio-context.js';

interface ListeningNode {
	kind: string;
	connections: ListeningNode[];
	disconnected: boolean;
	type?: string;
	frequency?: { value: number };
	Q?: { value: number };
	gain?: { value: number };
}

function fixture(sampleRate = 48_000) {
	const context = new MockAudioContext({ sampleRate });
	const existing = createProject() as unknown as EngineProject;
	const project: EngineProject = {
		...existing,
		tracks: existing.tracks?.map((track) => ({ ...track, effects: [] })),
		master: { ...existing.master, effects: [] },
	};
	const sources = new Map([
		['source-1', new MockAudioBuffer(2, 48_000, 48_000) as unknown as AudioBuffer],
	]);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
	});
	engine.loadProject(project, sources);
	const host = engine as unknown as EngineRuntimeHost;
	return { context, engine, host, project, sources };
}

function listeningPath(host: EngineRuntimeHost): ListeningNode[] {
	const path: ListeningNode[] = [];
	let node = host.playbackOutputNode as unknown as ListeningNode | null;
	while (node) {
		assert.ok(!path.includes(node), 'the listening graph must be acyclic');
		path.push(node);
		assert.ok(node.connections.length <= 1, 'the mix must have exactly one listening route');
		node = node.connections[0] ?? null;
	}
	return path;
}

/** Evaluate the standard Web Audio biquad coefficients, independent of the filter recipe. */
function listeningResponseDb(host: EngineRuntimeHost, frequency: number): number {
	const sampleRate = host.context!.sampleRate;
	const omega = 2 * Math.PI * frequency / sampleRate;
	let magnitude = 1;
	for (const node of listeningPath(host)) {
		if (node.kind !== 'biquad') continue;
		const omega0 = 2 * Math.PI * node.frequency!.value / sampleRate;
		const cosine = Math.cos(omega0);
		const q = node.type === 'bandpass' ? node.Q!.value : 10 ** (node.Q!.value / 20);
		const alpha = Math.sin(omega0) / (2 * q);
		const [b0, b1, b2] = node.type === 'bandpass' ? [alpha, 0, -alpha]
			: node.type === 'highpass' ? [(1 + cosine) / 2, -(1 + cosine), (1 + cosine) / 2]
				: [(1 - cosine) / 2, 1 - cosine, (1 - cosine) / 2];
		const real = (c0: number, c1: number, c2: number) => c0 + c1 * Math.cos(omega) + c2 * Math.cos(2 * omega);
		const imaginary = (c1: number, c2: number) => -c1 * Math.sin(omega) - c2 * Math.sin(2 * omega);
		magnitude *= Math.hypot(real(b0!, b1!, b2!), imaginary(b1!, b2!))
			/ Math.hypot(real(1 + alpha, -2 * cosine, 1 - alpha), imaginary(-2 * cosine, 1 - alpha));
	}
	return 20 * Math.log10(magnitude);
}

const BAND = { minimumFrequency: 500, maximumFrequency: 2_000 };

test('frequency audition filters the listening mix after metering without changing the project', async () => {
	const { context, engine, host, project } = fixture();
	const original = structuredClone(project);
	try {
		assert.deepEqual(engine.setPlaybackFrequencyRange(BAND), BAND);
		engine.setPlaybackGain(0.4);
		await engine.play();
		const path = listeningPath(host);
		assert.deepEqual(path.map((node) => node.kind), ['gain', 'biquad', 'biquad', 'biquad', 'biquad', 'destination']);
		assert.deepEqual(path.slice(1, 5).map((node) => [node.type, node.frequency?.value]), [
			['highpass', 500], ['highpass', 500], ['lowpass', 2_000], ['lowpass', 2_000],
		]);
		assert.equal(path[0]!.gain?.value, 0.4);
		assert.equal(path.at(-1), context.destination);
		assert.ok(path[1]!.Q!.value < 0, 'Web Audio high/low pass Q uses decibels');
		assert.ok(path[2]!.Q!.value > 0);
		assert.deepEqual(project, original);
	} finally {
		await engine.dispose();
	}
});

test('full-range audition bypasses filtering and one-sided bands allocate only one cutoff', async () => {
	const { engine, host } = fixture();
	try {
		engine.setPlaybackFrequencyRange({ minimumFrequency: 0, maximumFrequency: 24_000 });
		await engine.play();
		assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination']);
		engine.setPlaybackFrequencyRange({ minimumFrequency: 0, maximumFrequency: 1_000 });
		assert.deepEqual(listeningPath(host).slice(1, -1).map((node) => node.type), ['lowpass', 'lowpass']);
		engine.setPlaybackFrequencyRange({ minimumFrequency: 1_000, maximumFrequency: 24_000 });
		assert.deepEqual(listeningPath(host).slice(1, -1).map((node) => node.type), ['highpass', 'highpass']);
		engine.setPlaybackFrequencyRange(null);
		assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination']);
	} finally {
		await engine.dispose();
	}
});

test('a narrow frequency rectangle retains its selected tone and isolates nearby outside tones', async () => {
	const { engine, host } = fixture();
	try {
		engine.setPlaybackFrequencyRange({ minimumFrequency: 500, maximumFrequency: 524 });
		await engine.play();
		assert.ok(listeningResponseDb(host, 512) > -0.01, 'the selected tone retains its level');
		assert.ok(listeningResponseDb(host, 620) < -25, 'a nearby outside tone must be strongly suppressed');
		assert.ok(listeningResponseDb(host, 400) < -30, 'the lower outside tone must be strongly suppressed');
		assert.deepEqual(listeningPath(host).slice(1, -1).map((node) => node.type), ['bandpass', 'bandpass']);
	} finally {
		await engine.dispose();
	}
});

test('narrow frequency rectangles have unity peak and equal minus-three-dB edges across device rates', async () => {
	for (const sampleRate of [32_000, 44_100, 48_000]) {
		const { engine, host } = fixture(sampleRate);
		try {
			await engine.play();
			for (const [minimumFrequency, maximumFrequency] of [[500, 524], [sampleRate * 0.44, sampleRate * 0.48]]) {
				engine.setPlaybackFrequencyRange({ minimumFrequency: minimumFrequency!, maximumFrequency: maximumFrequency! });
				const filters = listeningPath(host).slice(1, -1);
				const center = filters[0]!.frequency!.value;
				assert.ok(center > minimumFrequency! && center < maximumFrequency!);
				assert.ok(Math.abs(listeningResponseDb(host, center)) < 1e-8, 'the center must have unity gain');
				for (const edge of [minimumFrequency!, maximumFrequency!]) {
					assert.ok(Math.abs(listeningResponseDb(host, edge) + 10 * Math.log10(2)) < 1e-7,
						`the ${edge} Hz edge must stay at -3 dB at ${sampleRate} Hz`);
				}
			}
		} finally {
			await engine.dispose();
		}
	}
});

test('pause and stop retire frequency audition so ordinary playback resumes full range', async () => {
	const { engine, host } = fixture();
	try {
		for (const retire of [() => engine.pause(), () => engine.stop()]) {
			engine.setPlaybackFrequencyRange(BAND);
			await engine.play();
			const filters = listeningPath(host).slice(1, -1);
			retire();
			assert.ok(filters.every((node) => node.disconnected));
			await engine.play();
			assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination']);
			engine.stop();
		}
	} finally {
		await engine.dispose();
	}
});

test('Stop and Pause cancel staged audition while asynchronous playback startup is pending', async () => {
	for (const action of ['stop', 'pause'] as const) {
		const { context, engine, host } = fixture();
		let release!: () => void;
		context.resume = () => new Promise<void>((resolve) => { release = resolve; });
		try {
			engine.setPlaybackFrequencyRange(BAND);
			const pending = engine.play();
			await Promise.resolve();
			engine[action]();
			release();
			await pending;
			context.resume = async () => {};
			await engine.play();
			assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination']);
		} finally {
			await engine.dispose();
		}
	}
});

test('project load and disposal retire both staged and active audition nodes', async () => {
	const { engine, host, project, sources } = fixture();
	try {
		engine.setPlaybackFrequencyRange(BAND);
		await engine.play();
		const filters = listeningPath(host).slice(1, -1);
		engine.loadProject({ ...project, id: 'new-project' }, sources);
		assert.ok(filters.every((node) => node.disconnected));
		await engine.play();
		assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination']);
		engine.setPlaybackFrequencyRange(BAND);
		const finalFilters = listeningPath(host).slice(1, -1);
		await engine.dispose();
		assert.ok(finalFilters.every((node) => node.disconnected));
		assert.throws(() => engine.setPlaybackFrequencyRange(BAND), /disposed/u);
	} finally {
		await engine.dispose();
	}
});

test('seeking during an audition keeps its current frequency band', async () => {
	const { engine, host } = fixture();
	try {
		engine.setPlaybackFrequencyRange(BAND);
		await engine.play();
		await new Promise<void>((resolve) => {
			const unsubscribe = engine.subscribePosition(() => { unsubscribe(); resolve(); });
			engine.seek(12_000);
		});
		assert.deepEqual(listeningPath(host).slice(1, -1).map((node) => node.frequency?.value), [500, 500, 2_000, 2_000]);
	} finally {
		await engine.dispose();
	}
});

test('a band above the device Nyquist produces silence rather than restoring the full mix', async () => {
	const { engine, host } = fixture(32_000);
	try {
		engine.setPlaybackFrequencyRange({ minimumFrequency: 18_000, maximumFrequency: 24_000 });
		await engine.play();
		const path = listeningPath(host);
		assert.deepEqual(path.map((node) => node.kind), ['gain', 'gain', 'destination']);
		assert.equal(path[1]!.gain?.value, 0);
	} finally {
		await engine.dispose();
	}
});

test('invalid bands are rejected and valid bands clamp to the project frequency limits', async () => {
	const { engine } = fixture();
	try {
		assert.deepEqual(engine.setPlaybackFrequencyRange({ minimumFrequency: -10, maximumFrequency: 50_000 }), {
			minimumFrequency: 0, maximumFrequency: 24_000,
		});
		for (const range of [
			{ minimumFrequency: NaN, maximumFrequency: 1_000 },
			{ minimumFrequency: 0, maximumFrequency: Infinity },
			{ minimumFrequency: 500, maximumFrequency: 500 },
			{ minimumFrequency: 2_000, maximumFrequency: 500 },
		]) assert.throws(() => engine.setPlaybackFrequencyRange(range), RangeError);
	} finally {
		await engine.dispose();
	}
});

test('a failed startup retires audition before the next normal play', async () => {
	const { context, engine, host } = fixture();
	try {
		engine.setPlaybackFrequencyRange(BAND);
		context.resume = () => Promise.reject(new Error('device unavailable'));
		await assert.rejects(engine.play(), /device unavailable/u);
		context.resume = async () => {};
		await engine.play();
		assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination']);
	} finally {
		await engine.dispose();
	}
});

test('loudness metering stays upstream of the listening filter', async () => {
	const { engine, host } = fixture();
	try {
		const meter = new MockNode('meter');
		host.masterLoudnessMeter = {
			node: meter as unknown as AudioNode,
			setRunning() {}, reset() {}, requestSnapshot() {}, dispose() {},
		};
		engine.setPlaybackFrequencyRange(BAND);
		await engine.play();
		assert.equal(meter.connections[0], host.playbackOutputNode);
		assert.equal(listeningPath(host)[1]!.kind, 'biquad');
	} finally {
		await engine.dispose();
	}
});

test('frequency audition ends at its selection even when a saved loop is enabled', async () => {
	const { context, engine, host } = fixture();
	try {
		const loop = { enabled: true, startFrame: 0, endFrame: 4_800 };
		engine.setLoop(loop);
		engine.seek(12_000);
		engine.setPlayRange({ startFrame: 12_000, endFrame: 24_000 });
		engine.setPlaybackFrequencyRange(BAND);
		await engine.play();
		assert.equal(host.playbackStartFrame, 12_000);
		assert.equal(host.playEndFrame, 24_000);
		assert.deepEqual(host.loop, loop);
		assert.equal(engine.getState().loop.enabled, false);
		context.currentTime += 0.1;
		assert.ok(engine.getPositionFrames() > 12_000);
		engine.stop();
		assert.equal(engine.getState().loop.enabled, true);
		await engine.play();
		assert.equal(host.playbackStartFrame, 0, 'the saved loop takes ownership again on ordinary play');
		assert.equal(host.playEndFrame, 4_800);
		assert.deepEqual(host.loop, loop);
	} finally {
		await engine.dispose();
	}
});

test('natural selection completion retires the audition filters', { timeout: 10_000 }, async () => {
	const { context, engine, host } = fixture();
	try {
		engine.setPlayRange({ startFrame: 0, endFrame: 4_800 });
		engine.setPlaybackFrequencyRange(BAND);
		await engine.play();
		const stopped = new Promise<void>((resolve) => {
			const unsubscribe = engine.subscribeState((state) => {
				if (state !== 'stopped') return;
				unsubscribe(); resolve();
			});
		});
		context.currentTime += 1;
		await stopped;
		assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination']);
		assert.equal(host.playRange, null);
	} finally {
		await engine.dispose();
	}
});

test('offline delivery retains the full mix while frequency audition is running', async () => {
	const { engine, host, sources } = fixture();
	const offlineContexts: MockAudioContext[] = [];
	host.offlineAudioContextFactory = (options: EngineOfflineContextOptions) => {
		const context = new MockGainRenderingOfflineAudioContext(options);
		offlineContexts.push(context);
		return context as unknown as OfflineAudioContext;
	};
	sources.get('source-1')!.getChannelData(0).fill(0.5);
	try {
		const full = await engine.renderMix({ includeTail: false });
		engine.setPlaybackFrequencyRange(BAND);
		await engine.play();
		const audition = await engine.renderMix({ includeTail: false });
		assert.deepEqual(audioBufferChannels(audition)[0], audioBufferChannels(full)[0]);
		assert.ok(offlineContexts.every((context) => !context.nodeKinds.includes('biquad')));
		assert.equal(listeningPath(host).filter((node) => node.kind === 'biquad').length, 4);
	} finally {
		await engine.dispose();
	}
});

test('a canceled old startup cannot clear a newer audition', async () => {
	const { context, engine, host } = fixture();
	const releases: (() => void)[] = [];
	context.resume = () => new Promise<void>((resolve) => { releases.push(resolve); });
	try {
		engine.setPlaybackFrequencyRange(BAND);
		const old = engine.play();
		await Promise.resolve();
		engine.stop();
		const nextBand = { minimumFrequency: 100, maximumFrequency: 1_000 };
		engine.setPlaybackFrequencyRange(nextBand);
		const next = engine.play();
		await Promise.resolve();
		releases[0]!();
		await old;
		releases[1]!();
		await next;
		assert.deepEqual(listeningPath(host).slice(1, -1).map((node) => node.frequency?.value), [100, 100, 1_000, 1_000]);
	} finally {
		await engine.dispose();
	}
});

test('other audition and recording paths retire a staged frequency band', async () => {
	for (const mode of ['speed', 'clocked', 'scrub', 'cut'] as const) {
		const { engine, host } = fixture();
		try {
			engine.setPlaybackFrequencyRange(BAND);
			if (mode === 'speed') await engine.playAtSpeed(1.5);
			else if (mode === 'clocked') await engine.playAt(0);
			else if (mode === 'scrub') await engine.scrub(0);
			else {
				engine.renderMix = async (options = {}) => new MockAudioBuffer(
					2, Number(options.endFrame) - Number(options.startFrame), 48_000,
				) as unknown as AudioBuffer;
				await engine.playCutPreview({ startFrame: 12_000, endFrame: 24_000 });
			}
			assert.deepEqual(listeningPath(host).map((node) => node.kind), ['gain', 'destination'], mode);
		} finally {
			await engine.dispose();
		}
	}
});
