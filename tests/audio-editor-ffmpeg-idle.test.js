import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const ffmpegModuleUrl = `data:text/javascript,${encodeURIComponent(`
	export const FFFSType = { WORKERFS: 'WORKERFS' };
	export class FFmpeg {
		constructor() {
			return new globalThis.__soundscaperFfmpegTestRuntime();
		}
	}
`)}`;
const ffmpegLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/ffmpeg') {
			return { url: ${JSON.stringify(ffmpegModuleUrl)}, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(ffmpegLoader)}`, import.meta.url);

const { createEditorFfmpeg } = await import('../src/lib/tools/audio-editor/ffmpeg.js');

const originalTestRuntime = globalThis.__soundscaperFfmpegTestRuntime;

test.beforeEach(() => {
	MockFfmpegRuntime.reset();
	globalThis.__soundscaperFfmpegTestRuntime = MockFfmpegRuntime;
});

test.afterEach(() => {
	if (originalTestRuntime === undefined) delete globalThis.__soundscaperFfmpegTestRuntime;
	else globalThis.__soundscaperFfmpegTestRuntime = originalTestRuntime;
});

test('completed FFmpeg work tears down after the default finite idle delay and reloads on demand', async () => {
	const timers = createManualTimers();
	const ffmpeg = createEditorFfmpeg({
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});

	const first = await ffmpeg.encode(Uint8Array.of(1, 2, 3), 'mp3');
	assert.deepEqual([...first.bytes], [9, 8, 7]);
	assert.equal(MockFfmpegRuntime.instances.length, 1);
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 0);
	assert.deepEqual(timers.active().map(({ delay }) => delay), [30_000]);

	timers.fire(timers.active()[0].id);
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 1);

	await ffmpeg.encode(Uint8Array.of(4, 5, 6), 'mp3');
	assert.equal(MockFfmpegRuntime.instances.length, 2, 'the next operation creates a fresh WASM worker');
	ffmpeg.dispose();
	assert.equal(MockFfmpegRuntime.instances[1].terminateCalls, 1);
	assert.equal(timers.active().length, 0);
});

test('an explicitly preloaded FFmpeg runtime also receives a bounded idle lifetime', async () => {
	const timers = createManualTimers();
	const ffmpeg = createEditorFfmpeg({
		idleTimeoutMs: 750,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});

	await ffmpeg.load();
	assert.equal(MockFfmpegRuntime.instances.length, 1);
	assert.deepEqual(timers.active().map(({ delay }) => delay), [750]);
	timers.fire(timers.active()[0].id);
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 1);
});

test('idle teardown waits for every operation already queued behind the active encode', async () => {
	MockFfmpegRuntime.pauseExecByDefault = true;
	const timers = createManualTimers();
	const ffmpeg = createEditorFfmpeg({
		idleTimeoutMs: 5_000,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});

	const first = ffmpeg.encode(Uint8Array.of(1), 'mp3');
	const second = ffmpeg.encode(Uint8Array.of(2), 'mp3');
	await waitFor(() => MockFfmpegRuntime.instances[0]?.pendingExec.length === 1);
	assert.equal(timers.active().length, 0);

	MockFfmpegRuntime.instances[0].resolveNextExec();
	await first;
	await waitFor(() => MockFfmpegRuntime.instances[0].pendingExec.length === 1);
	assert.equal(timers.active().length, 0, 'finishing the first job cannot tear down ahead of the queued job');
	assert.equal(MockFfmpegRuntime.instances.length, 1);

	MockFfmpegRuntime.instances[0].resolveNextExec();
	await second;
	assert.deepEqual(timers.active().map(({ delay }) => delay), [5_000]);
	ffmpeg.dispose();
});

test('new work invalidates a pending teardown even if its cleared callback runs late', async () => {
	const timers = createManualTimers();
	const ffmpeg = createEditorFfmpeg({
		idleTimeoutMs: 1_000,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});

	await ffmpeg.encode(Uint8Array.of(1), 'mp3');
	const worker = MockFfmpegRuntime.instances[0];
	const staleTimer = timers.active()[0];
	worker.pauseExec = true;
	const next = ffmpeg.encode(Uint8Array.of(2), 'mp3');
	await waitFor(() => worker.pendingExec.length === 1);

	assert.deepEqual(timers.cleared, [staleTimer.id]);
	timers.fire(staleTimer.id, { includeCleared: true });
	assert.equal(worker.terminateCalls, 0, 'a late timer callback cannot terminate an active runtime');

	worker.resolveNextExec();
	await next;
	assert.equal(timers.active().length, 1);
	timers.fire(timers.active()[0].id);
	assert.equal(worker.terminateCalls, 1);
});

test('idle teardown can be disabled while explicit disposal still releases the worker', async () => {
	const timers = createManualTimers();
	const ffmpeg = createEditorFfmpeg({
		idleTimeoutMs: false,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});

	await ffmpeg.encode(Uint8Array.of(1), 'mp3');
	assert.equal(timers.created.length, 0);
	ffmpeg.dispose();
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 1);
	ffmpeg.dispose();
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 1, 'explicit disposal remains idempotent');
});

test('completed decode work uses the same bounded idle lifetime', async () => {
	const timers = createManualTimers();
	const ffmpeg = createEditorFfmpeg({
		idleTimeoutMs: 2_500,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});

	const decoded = await ffmpeg.decode(new Blob([Uint8Array.of(1, 2, 3)]), { sampleRate: 44_100 });
	assert.equal(decoded.sampleRate, 44_100);
	assert.equal(decoded.frameCount, 2);
	assert.deepEqual([...decoded.channels[0]], [0.25, 0.75]);
	assert.deepEqual([...decoded.channels[1]], [-0.5, 1]);
	assert.deepEqual(timers.active().map(({ delay }) => delay), [2_500]);

	timers.fire(timers.active()[0].id);
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 1);
});

test('cancelling an active encode terminates immediately and does not arm an idle timer', async () => {
	MockFfmpegRuntime.pauseExecByDefault = true;
	const timers = createManualTimers();
	const ffmpeg = createEditorFfmpeg({
		idleTimeoutMs: 1_000,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const controller = new AbortController();
	const encoding = ffmpeg.encode(Uint8Array.of(1), 'mp3', { signal: controller.signal });
	await waitFor(() => MockFfmpegRuntime.instances[0]?.pendingExec.length === 1);

	controller.abort();
	await assert.rejects(encoding);
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 1);
	assert.equal(timers.active().length, 0);

	MockFfmpegRuntime.pauseExecByDefault = false;
	await ffmpeg.encode(Uint8Array.of(2), 'mp3');
	assert.equal(MockFfmpegRuntime.instances.length, 2, 'work after cancellation reloads a clean runtime');
	ffmpeg.dispose();
});

test('invalid idle timeout configuration fails early', () => {
	assert.throws(() => createEditorFfmpeg({ idleTimeoutMs: -1 }), /non-negative finite number/);
	assert.throws(() => createEditorFfmpeg({ idleTimeoutMs: Number.POSITIVE_INFINITY }), /non-negative finite number/);
	assert.throws(() => createEditorFfmpeg({ idleTimeoutMs: '1000' }), /non-negative finite number/);
});

class MockFfmpegRuntime {
	static instances = [];
	static pauseExecByDefault = false;

	static reset() {
		this.instances = [];
		this.pauseExecByDefault = false;
	}

	constructor() {
		this.loaded = false;
		this.pendingExec = [];
		this.pauseExec = MockFfmpegRuntime.pauseExecByDefault;
		this.terminateCalls = 0;
		MockFfmpegRuntime.instances.push(this);
	}

	on() {}

	off() {}

	async load() {
		this.loaded = true;
	}

	async writeFile() {}

	exec() {
		if (!this.pauseExec) return Promise.resolve(0);
		return new Promise((resolve, reject) => {
			this.pendingExec.push({ resolve, reject });
		});
	}

	resolveNextExec(code = 0) {
		const pending = this.pendingExec.shift();
		if (!pending) throw new Error('No pending FFmpeg exec request.');
		pending.resolve(code);
	}

	async readFile(path) {
		if (!path.endsWith('.f32')) return Uint8Array.of(9, 8, 7);
		const samples = Float32Array.of(0.25, -0.5, 0.75, 1);
		return new Uint8Array(samples.buffer.slice(0));
	}

	async deleteFile() {}

	terminate() {
		this.terminateCalls += 1;
		this.loaded = false;
		for (const pending of this.pendingExec.splice(0)) pending.reject(new Error('called FFmpeg.terminate()'));
	}
}

function createManualTimers() {
	let nextId = 1;
	const scheduled = new Map();
	const created = [];
	const cleared = [];
	return {
		created,
		cleared,
		setTimeout(callback, delay) {
			const timer = { id: nextId, callback, delay };
			nextId += 1;
			created.push(timer);
			scheduled.set(timer.id, timer);
			return timer.id;
		},
		clearTimeout(id) {
			cleared.push(id);
			scheduled.delete(id);
		},
		active() {
			return [...scheduled.values()];
		},
		fire(id, { includeCleared = false } = {}) {
			const timer = scheduled.get(id) || (includeCleared && created.find((entry) => entry.id === id));
			if (!timer) throw new Error(`Unknown timer ${id}.`);
			scheduled.delete(id);
			timer.callback();
		},
	};
}

async function waitFor(predicate) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for the FFmpeg runtime fixture.');
}
