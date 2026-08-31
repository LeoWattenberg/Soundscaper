/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';

export class MockFfmpegRuntime {
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
		return new Promise((resolve, reject) => this.pendingExec.push({ resolve, reject }));
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
			sampleRate: 32_000, bitDepth: 32, float: true, dither: false,
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

export function createManualTimers() {
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

export async function waitFor(predicate) {
	const deadline = performance.now() + 5_000;
	while (performance.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for the FFmpeg runtime fixture.');
}

export async function withTimeout(promise, milliseconds = 100) {
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
