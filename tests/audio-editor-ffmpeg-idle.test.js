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

const { createEditorFfmpeg } = await import('../src/common/editor/ffmpeg.js');
const { encodeWav } = await import('../src/common/editor/wav.js');

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
	assert.equal(decoded.sampleRate, 32_000);
	assert.equal(decoded.frameCount, 2);
	assert.equal(decoded.channels.length, 1);
	assert.deepEqual([...decoded.channels[0]], [0.25, 0.75]);
	assert.deepEqual(MockFfmpegRuntime.instances[0].lastExec, [
		'-i', 'editor-input-' + MockFfmpegRuntime.instances[0].lastStamp,
		'-vn', '-map', '0:a:0',
		'-c:a', 'pcm_f32le', '-f', 'wav', '-y',
		'editor-decoded-' + MockFfmpegRuntime.instances[0].lastStamp + '.wav',
	]);
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

test('encodeFileToSink streams bounded FFmpeg ranges without a whole-file read', async () => {
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const events = [];
	const output = Object.freeze({ prepared: true });
	const sink = {
		async open(exactByteLength) { events.push(`open:${exactByteLength}`); },
		async write(chunk) { events.push(`write:${chunk.byteLength}:${[...chunk].join(',')}`); },
		async close() { events.push('close'); return output; },
		async abort(reason) { events.push(`abort:${String(reason)}`); },
	};
	let currentnessChecks = 0;

	const encoded = await ffmpeg.encodeFileToSink(
		new Blob([Uint8Array.of(1, 2, 3)], { type: 'audio/wav' }),
		'mp3',
		sink,
		{
			maximumOutputChunkBytes: 2,
			assertCurrent() { currentnessChecks += 1; },
		},
	);
	const runtime = MockFfmpegRuntime.instances[0];
	assert.deepEqual(encoded, {
		output,
		byteLength: 3,
		chunkCount: 2,
		extension: '.mp3',
		mimeType: 'audio/mpeg',
	});
	assert.deepEqual(events, ['open:3', 'write:2:9,8', 'write:1:7', 'close']);
	assert.equal(runtime.readFileCalls, 0);
	assert.equal(runtime.statFileCalls, 1);
	assert.deepEqual(runtime.rangeRequests.map(({ offset, maximumBytes }) => [offset, maximumBytes]), [[0, 2], [2, 1]]);
	assert.equal(runtime.mountCalls.length, 1);
	assert.equal(runtime.mountCalls[0].fsType, 'WORKERFS');
	assert.equal(runtime.mountCalls[0].options.blobs.length, 1);
	assert.match(runtime.lastExec[1], /^\/editor-encode-.+\/editor-.+\.wav$/u);
	assert.match(runtime.lastExec.at(-1), /^editor-.+\.mp3$/u);
	assert.equal(currentnessChecks > 0, true);
	assert.equal(runtime.unmountCalls.length, 1);
	assert.equal(runtime.deleteDirCalls.length, 1);
	ffmpeg.dispose();
});

test('encodeFileToSink terminates cancellation and aborts the uncommitted sink exactly once', async () => {
	MockFfmpegRuntime.pauseExecByDefault = true;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const controller = new AbortController();
	const reason = new Error('export cancelled');
	const abortReasons = [];
	let closeCount = 0;
	const encoding = ffmpeg.encodeFileToSink(new Blob([Uint8Array.of(1)]), 'mp3', {
		async open() {},
		async write() {},
		async close() { closeCount += 1; },
		async abort(primary) { abortReasons.push(primary); },
	}, { signal: controller.signal });
	await waitFor(() => MockFfmpegRuntime.instances[0]?.pendingExec.length === 1);
	const runtime = MockFfmpegRuntime.instances[0];

	controller.abort(reason);
	await assert.rejects(encoding, (error) => error === reason);
	assert.equal(runtime.terminateCalls, 1);
	assert.equal(runtime.statFileCalls, 0);
	assert.deepEqual(abortReasons, [reason]);
	assert.equal(closeCount, 0);
	ffmpeg.dispose();
});

test('encodeFileToSink preserves pre-stream encoding and sink cleanup failures', async () => {
	MockFfmpegRuntime.execCodeByDefault = 1;
	MockFfmpegRuntime.outputDeleteFailureByDefault = new Error('missing output file');
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const cleanup = new Error('sink abort failed');
	let abortCount = 0;
	let caught;
	try {
		await ffmpeg.encodeFileToSink(new Blob([Uint8Array.of(1)]), 'mp3', {
			async open() {},
			async write() {},
			async close() {},
			async abort() { abortCount += 1; throw cleanup; },
		});
	} catch (error) {
		caught = error;
	}
	assert(caught instanceof AggregateError);
	assert.equal(caught.errors[0].code, 'FFMPEG_ENCODING_FAILED');
	assert.equal(caught.errors[1], cleanup);
	assert.equal(abortCount, 1);
	assert.equal(MockFfmpegRuntime.instances[0].terminateCalls, 0);
	ffmpeg.dispose();
});

test('encodeFileToSink terminates on worker cleanup failure and preserves an earlier stream error', async () => {
	const cleanup = new Error('output delete failed');
	MockFfmpegRuntime.outputDeleteFailureByDefault = cleanup;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const abortReasons = [];
	await assert.rejects(ffmpeg.encodeFileToSink(new Blob([Uint8Array.of(1)]), 'mp3', {
		async open() {},
		async write() {},
		async close() { return 'sealed'; },
		async abort(reason) { abortReasons.push(reason); },
	}), (error) => error === cleanup);
	const cleanupRuntime = MockFfmpegRuntime.instances[0];
	assert.deepEqual(abortReasons, [cleanup]);
	assert.equal(cleanupRuntime.terminateCalls, 1);
	assert.equal(cleanupRuntime.unmountCalls.length, 1);
	assert.equal(cleanupRuntime.deleteDirCalls.length, 1);
	ffmpeg.dispose();

	const primary = new Error('range failed');
	MockFfmpegRuntime.rangeFailureByDefault = primary;
	const second = createEditorFfmpeg({ idleTimeoutMs: false });
	let abortCount = 0;
	let caught;
	try {
		await second.encodeFileToSink(new Blob([Uint8Array.of(1)]), 'mp3', {
			async open() {},
			async write() {},
			async close() {},
			async abort(reason) { abortCount += 1; assert.equal(reason, primary); },
		});
	} catch (error) { caught = error; }
	assert(caught instanceof AggregateError);
	assert.deepEqual(caught.errors, [primary, cleanup]);
	assert.equal(abortCount, 1);
	assert.equal(MockFfmpegRuntime.instances[1].terminateCalls, 1);
	second.dispose();
});

test('disposing during FFmpeg core loading is terminal and cannot resurrect the runtime', async () => {
	MockFfmpegRuntime.pauseLoadByDefault = true;
	const ready = [];
	const ffmpeg = createEditorFfmpeg({ onReady: () => ready.push('ready') });
	const loading = ffmpeg.load();
	await waitFor(() => MockFfmpegRuntime.instances[0]?.pendingLoad.length === 1);
	const runtime = MockFfmpegRuntime.instances[0];

	ffmpeg.dispose();
	assert.equal(runtime.terminateCalls, 1);
	runtime.resolveNextLoad();
	await assert.rejects(loading, (error) => error.code === 'FFMPEG_DISPOSED');
	assert.deepEqual(ready, []);
	await assert.rejects(ffmpeg.load(), (error) => error.code === 'FFMPEG_DISPOSED');
	await assert.rejects(ffmpeg.encode(Uint8Array.of(1), 'mp3'), (error) => error.code === 'FFMPEG_DISPOSED');
	assert.equal(MockFfmpegRuntime.instances.length, 1);
});

test('disposing FFmpeg rejects queued work without creating a replacement runtime', async () => {
	MockFfmpegRuntime.pauseExecByDefault = true;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const active = ffmpeg.encode(Uint8Array.of(1), 'mp3');
	const queued = ffmpeg.encode(Uint8Array.of(2), 'mp3');
	await waitFor(() => MockFfmpegRuntime.instances[0]?.pendingExec.length === 1);

	ffmpeg.dispose();
	await assert.rejects(active);
	await assert.rejects(withTimeout(queued), (error) => error.code === 'FFMPEG_DISPOSED');
	assert.equal(MockFfmpegRuntime.instances.length, 1);
});

test('invalid idle timeout configuration fails early', () => {
	assert.throws(() => createEditorFfmpeg({ idleTimeoutMs: -1 }), /non-negative finite number/);
	assert.throws(() => createEditorFfmpeg({ idleTimeoutMs: Number.POSITIVE_INFINITY }), /non-negative finite number/);
	assert.throws(() => createEditorFfmpeg({ idleTimeoutMs: '1000' }), /non-negative finite number/);
});

test('FFmpeg loads an installed content-addressed browser runtime', async () => {
	const releaseId = 'b'.repeat(64);
	const baseUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${releaseId}`;
	let resolverCalls = 0;
	const ffmpeg = createEditorFfmpeg({
		idleTimeoutMs: false,
		resolveCoreBaseURL: async () => {
			resolverCalls += 1;
			return baseUrl;
		},
	});

	await ffmpeg.load();

	assert.equal(resolverCalls, 1);
	assert.deepEqual(MockFfmpegRuntime.instances[0].loadOptions, {
		coreURL: `${baseUrl}/ffmpeg-core.js`,
		wasmURL: `${baseUrl}/ffmpeg-core.wasm`,
	});
	ffmpeg.dispose();
});

test('configured FFmpeg URLs win and resolver failures retain the pinned network fallback', async () => {
	let configuredResolverCalls = 0;
	const configured = createEditorFfmpeg({
		idleTimeoutMs: false,
		coreBaseURL: 'soundscaper-app://runtime/ffmpeg/',
		resolveCoreBaseURL: async () => {
			configuredResolverCalls += 1;
			return 'https://unexpected.invalid';
		},
	});
	await configured.load();
	assert.equal(configuredResolverCalls, 0);
	assert.equal(MockFfmpegRuntime.instances[0].loadOptions.coreURL, 'soundscaper-app://runtime/ffmpeg/ffmpeg-core.js');
	configured.dispose();

	const fallback = createEditorFfmpeg({
		idleTimeoutMs: false,
		resolveCoreBaseURL: async () => { throw new Error('CacheStorage failed'); },
	});
	await fallback.load();
	assert.deepEqual(MockFfmpegRuntime.instances[1].loadOptions, {
		coreURL: 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/ffmpeg-core.js',
		wasmURL: 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/ffmpeg-core.wasm',
	});
	fallback.dispose();
});

class MockFfmpegRuntime {
	static instances = [];
	static pauseExecByDefault = false;
	static pauseLoadByDefault = false;
	static execCodeByDefault = 0;
	static outputDeleteFailureByDefault = null;
	static rangeFailureByDefault = null;

	static reset() {
		this.instances = [];
		this.pauseExecByDefault = false;
		this.pauseLoadByDefault = false;
		this.execCodeByDefault = 0;
		this.outputDeleteFailureByDefault = null;
		this.rangeFailureByDefault = null;
	}

	constructor() {
		this.loaded = false;
		this.pendingLoad = [];
		this.pauseLoad = MockFfmpegRuntime.pauseLoadByDefault;
		this.pendingExec = [];
		this.pauseExec = MockFfmpegRuntime.pauseExecByDefault;
		this.terminateCalls = 0;
		this.outputBytes = Uint8Array.of(9, 8, 7);
		this.readFileCalls = 0;
		this.statFileCalls = 0;
		this.rangeRequests = [];
		this.outputDeleteFailure = MockFfmpegRuntime.outputDeleteFailureByDefault;
		this.rangeFailure = MockFfmpegRuntime.rangeFailureByDefault;
		this.mountCalls = [];
		this.unmountCalls = [];
		this.deleteDirCalls = [];
		MockFfmpegRuntime.instances.push(this);
	}

	on() {}

	off() {}

	load(options) {
		this.loadOptions = options;
		if (!this.pauseLoad) {
			this.loaded = true;
			return Promise.resolve();
		}
		return new Promise((resolve) => this.pendingLoad.push({ resolve }));
	}

	resolveNextLoad() {
		const pending = this.pendingLoad.shift();
		if (!pending) throw new Error('No pending FFmpeg load request.');
		this.loaded = true;
		pending.resolve();
	}

	async writeFile() {}

	exec(args) {
		this.lastExec = [...args];
		const input = this.lastExec[1];
		const output = this.lastExec.at(-1);
		const inputMatch = input.match(/^editor-input-(.+)$/);
		const outputMatch = output.match(/^editor-decoded-(.+)\.wav$/);
		this.lastStamp = inputMatch && outputMatch && inputMatch[1] === outputMatch[1]
			? inputMatch[1]
			: null;
		if (!this.pauseExec) return Promise.resolve(MockFfmpegRuntime.execCodeByDefault);
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
		this.readFileCalls += 1;
		if (!path.endsWith('.wav')) return Uint8Array.of(9, 8, 7);
		return encodeWav([Float32Array.of(0.25, 0.75)], {
			sampleRate: 32_000,
			bitDepth: 32,
			float: true,
			dither: false,
		});
	}

	async statFile() {
		this.statFileCalls += 1;
		return { size: this.outputBytes.byteLength };
	}

	async readFileRange(path, offset, maximumBytes) {
		this.rangeRequests.push({ path, offset, maximumBytes });
		if (this.rangeFailure) throw this.rangeFailure;
		return this.outputBytes.slice(offset, offset + maximumBytes);
	}

	async createDir() {}

	async mount(fsType, options, mountPoint) {
		this.mountCalls.push({ fsType, options, mountPoint });
	}

	async unmount(mountPoint) {
		this.unmountCalls.push(mountPoint);
	}

	async deleteDir(path) {
		this.deleteDirCalls.push(path);
	}

	async deleteFile(path) {
		if (this.outputDeleteFailure && path === this.lastExec?.at(-1)) throw this.outputDeleteFailure;
	}

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
	const deadline = performance.now() + 5_000;
	while (performance.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for the FFmpeg runtime fixture.');
}

async function withTimeout(promise, milliseconds = 100) {
	let timeout;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error('Test operation timed out.')), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}
