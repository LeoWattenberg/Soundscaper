import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const ffmpegModuleUrl = `data:text/javascript,${encodeURIComponent(`
	export const FFFSType = { WORKERFS: 'WORKERFS' };
	export class FFmpeg {
		constructor() { return new globalThis.__soundscaperFfmpegCancellationRuntime(); }
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
const originalRuntime = globalThis.__soundscaperFfmpegCancellationRuntime;

test.beforeEach(() => {
	CancellationRuntime.reset();
	globalThis.__soundscaperFfmpegCancellationRuntime = CancellationRuntime;
});

test.afterEach(() => {
	if (originalRuntime === undefined) delete globalThis.__soundscaperFfmpegCancellationRuntime;
	else globalThis.__soundscaperFfmpegCancellationRuntime = originalRuntime;
});

test('cancelling a queued encode does not reload a worker after the active generation terminates', async () => {
	CancellationRuntime.pauseExec = true;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const activeController = new AbortController();
	const active = ffmpeg.encode(Uint8Array.of(1), 'mp3', { signal: activeController.signal });
	const queuedController = new AbortController();
	const reason = new DOMException('queued encode cancelled', 'AbortError');
	const queued = ffmpeg.encode(Uint8Array.of(2), 'mp3', { signal: queuedController.signal });
	await waitFor(() => CancellationRuntime.instances[0]?.pendingExec.length === 1);

	queuedController.abort(reason);
	activeController.abort(new DOMException('active encode cancelled', 'AbortError'));
	await assert.rejects(active);
	await assert.rejects(withTimeout(queued), (error) => error === reason);
	assert.equal(CancellationRuntime.instances.length, 1, 'cancelled queued work must stop before load');
	assert.equal(CancellationRuntime.instances[0].terminateCalls, 1);
	ffmpeg.dispose();
});

test('cancelling an active decode terminates its worker and preserves the abort reason', async () => {
	CancellationRuntime.pauseExec = true;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const controller = new AbortController();
	const reason = new DOMException('decode cancelled', 'AbortError');
	const decoding = ffmpeg.decode(new Blob([Uint8Array.of(1)]), { signal: controller.signal });
	await waitFor(() => CancellationRuntime.instances[0]?.pendingExec.length === 1);

	controller.abort(reason);
	await assert.rejects(withTimeout(decoding), (error) => error === reason);
	assert.equal(CancellationRuntime.instances[0].terminateCalls, 1);
	ffmpeg.dispose();
});

test('an encodeFile setup failure removes its abort listener', async () => {
	const setupFailure = new Error('mount directory failed');
	CancellationRuntime.createDirFailure = setupFailure;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const controller = new AbortController();

	await assert.rejects(
		ffmpeg.encodeFile(new Blob([Uint8Array.of(1)]), 'mp3', { signal: controller.signal }),
		(error) => error === setupFailure,
	);
	const runtime = CancellationRuntime.instances[0];
	controller.abort();
	assert.equal(runtime.terminateCalls, 0, 'a failed operation cannot retain authority over the runtime');
	ffmpeg.dispose();
});

class CancellationRuntime {
	static instances = [];
	static pauseExec = false;
	static createDirFailure = null;

	static reset() {
		this.instances = [];
		this.pauseExec = false;
		this.createDirFailure = null;
	}

	constructor() {
		this.loaded = false;
		this.pendingExec = [];
		this.terminateCalls = 0;
		CancellationRuntime.instances.push(this);
	}

	on() {}
	off() {}
	async load() { this.loaded = true; }
	async writeFile() {}
	async readFile() { return Uint8Array.of(); }
	async deleteFile() {}
	async mount() {}
	async unmount() {}
	async deleteDir() {}
	async createDir() {
		if (CancellationRuntime.createDirFailure) throw CancellationRuntime.createDirFailure;
	}

	exec() {
		if (!CancellationRuntime.pauseExec) return Promise.resolve(0);
		return new Promise((resolve, reject) => this.pendingExec.push({ resolve, reject }));
	}

	terminate() {
		this.loaded = false;
		this.terminateCalls += 1;
		for (const pending of this.pendingExec.splice(0)) pending.reject(new Error('runtime terminated'));
	}
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
