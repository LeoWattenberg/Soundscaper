/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { browserFfmpegCoverageContract } from '../scripts/lib/browser-ffmpeg-coverage.mjs';
import { repositoryRevision } from '../scripts/lib/e2e-coverage-integrity.mjs';
import { capturePackagedExecutableResourcesBeforeLaunch } from '../scripts/lib/packaged-executable-resource-identity.mjs';
import {
	capturePackagedAppAsarBeforeLaunch,
	createPackagedRuntimeCoverageCollector,
	resolvePackagedAppAsarPath,
} from './browser/helpers/packaged-runtime-coverage.js';
import { startPackagedRuntimeTargetCoverage } from './browser/helpers/packaged-runtime-target-coverage.js';

const ROOT = join(import.meta.dirname, '..');
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test('packaged collection authenticates app, runtime, network, and FFmpeg Wasm before omission', async (context) => {
	const fixture = await coverageFixture(context);
	const ffmpeg = browserFfmpegCoverageContract(ROOT);
	const ffmpegBytes = await readFile(join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'));
	const page = new WasmPage([
		script('root-js', 'soundscaper-app://bundle/'),
		wasm('renderer-wasm', 'soundscaper-app://bundle/assets/sqlite3-fixture.wasm', WASM),
		wasm('network-wasm', `${fixture.origin}/assets/pffft-fixture.wasm`, WASM),
		wasm('ffmpeg-wasm', ffmpeg.wasm.url, ffmpegBytes),
	], [
		script('worker-js', 'soundscaper-app://bundle/assets/worker.js'),
		wasm('runtime-wasm', 'soundscaper-app://bundle/runtime/model/engine.wasm', WASM),
	]);
	const collector = createPackagedRuntimeCoverageCollector({
		...fixture.options,
		context: new WasmContext(page),
		environment: fixture.environment,
	});
	await collector.start();
	const profile = JSON.parse(await readFile(await collector.collect(), 'utf8'));
	assert.deepEqual(profile.result.map(({ url }: { url: string }) => url), [
		'soundscaper-app://bundle/',
		'soundscaper-app://bundle/assets/worker.js',
	]);
	assert.deepEqual(Object.keys(profile['script-source-cache']), [
		'soundscaper-app://bundle/',
		'soundscaper-app://bundle/assets/worker.js',
	]);
});

test('packaged collection never admits another product site origin', async (context) => {
	const fixture = await coverageFixture(context);
	const page = new WasmPage([
		script('root-js', 'soundscaper-app://bundle/'),
		wasm('foreign-wasm', 'http://127.0.0.1:4568/assets/pffft-fixture.wasm', WASM),
	]);
	const collector = createPackagedRuntimeCoverageCollector({
		...fixture.options,
		context: new WasmContext(page),
		environment: fixture.environment,
	});
	await assert.rejects(collector.start(), /rejected unapproved WebAssembly URL/u);
});

test('packaged target final checkpoint awaits late WebAssembly authentication failure', async () => {
	const page = new WasmPage([script('root-js', 'soundscaper-app://bundle/')]);
	const late = wasm('late-wasm', 'soundscaper-app://bundle/assets/late.wasm', WASM);
	let authenticationStarted!: () => void;
	let debuggerDisabled!: () => void;
	let rejectAuthentication!: (error: Error) => void;
	const started = new Promise<void>((resolvePromise) => { authenticationStarted = resolvePromise; });
	const disabled = new Promise<void>((resolvePromise) => { debuggerDisabled = resolvePromise; });
	const authentication = new Promise<boolean>((_resolvePromise, reject) => {
		rejectAuthentication = reject;
	});
	const pending: Promise<unknown>[] = [];
	const target = await startPackagedRuntimeTargetCoverage({
		authenticateWebAssembly: () => {
			authenticationStarted();
			return authentication;
		},
		keepUrl: () => true,
		page,
		pending,
		rootSession: rootSession(page, { debuggerDisabled, finalScript: late }),
	});
	await settlePending(pending);

	const collection = target.collect();
	await Promise.all([started, disabled]);
	void pending.at(-1)?.catch(() => undefined);
	rejectAuthentication(new Error('late packaged WebAssembly authentication failed'));
	await assert.rejects(collection, /late packaged WebAssembly authentication failed/u);
});

async function coverageFixture(context: { after(callback: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-composite-wasm-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const executablePath = join(root, 'Soundscaper', 'soundscaper');
	const resources = join(root, 'Soundscaper', 'resources');
	await mkdir(join(resources, 'renderer/assets'), { recursive: true });
	await mkdir(join(resources, 'runtime/model'), { recursive: true });
	await writeFile(resolvePackagedAppAsarPath(executablePath, 'linux'), 'packaged application');
	await writeFile(join(resources, 'renderer/assets/editor.js'), 'globalThis.editor = true;\n');
	await writeFile(join(resources, 'renderer/assets/sqlite3-fixture.wasm'), WASM);
	await writeFile(join(resources, 'runtime/model/engine.wasm'), WASM);
	const origin = 'http://127.0.0.1:4567';
	const site = join(root, 'site');
	await mkdir(join(site, 'assets'), { recursive: true });
	await writeFile(join(site, 'assets/pffft-fixture.wasm'), WASM);
	await writeFile(join(site, '.browser-product-build.json'), JSON.stringify({
		files: { 'assets/pffft-fixture.wasm': fileRecord(WASM) },
		origin,
		productId: 'soundscaper',
		schemaVersion: 2,
		sourceRevision: repositoryRevision(ROOT),
	}));
	return {
		environment: {
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: ROOT,
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([
				{ origin, outputDirectory: site, productId: 'soundscaper' },
				{ origin: 'http://127.0.0.1:4568', outputDirectory: join(root, 'foreign'), productId: 'framescaper' },
			]),
		},
		options: {
			appAsar: await capturePackagedAppAsarBeforeLaunch({ executablePath, platform: 'linux' }),
			architecture: 'x64',
			baseURL: `${origin}/`,
			coverageDirectory: join(root, 'coverage'),
			executablePath,
			executableResources: await capturePackagedExecutableResourcesBeforeLaunch({
				executablePath, platform: 'linux',
			}),
			platform: 'linux',
			productId: 'soundscaper',
		},
		origin,
	};
}

function fileRecord(bytes: Buffer) {
	return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

interface ParsedScript { readonly bytes?: Buffer; readonly scriptId: string; readonly url: string }

function script(scriptId: string, url: string): ParsedScript { return { scriptId, url }; }
function wasm(scriptId: string, url: string, bytes: Buffer): ParsedScript { return { bytes, scriptId, url }; }

function coverageEntry(value: ParsedScript, url = value.url) {
	return {
		functions: [{ functionName: '', isBlockCoverage: true,
			ranges: [{ count: 1, endOffset: 1, startOffset: 0 }] }],
		scriptId: value.scriptId,
		url,
	};
}

class WasmPage {
	readonly rootScripts: readonly ParsedScript[];
	readonly workerScripts: readonly ParsedScript[];
	#context: WasmContext | null = null;
	#coverageTakes = 0;
	constructor(rootScripts: readonly ParsedScript[], workerScripts: readonly ParsedScript[] = []) {
		this.rootScripts = rootScripts;
		this.workerScripts = workerScripts;
	}
	setContext(context: WasmContext) { this.#context = context; }
	context() { return this.#context; }
	isClosed() { return false; }
	url() { return 'soundscaper-app://bundle/'; }
	async waitForFunction() {}
	takeCoverage() {
		this.#coverageTakes += 1;
		return this.#coverageTakes === 1 ? [] : this.rootScripts.filter(({ bytes }) => bytes === undefined)
			.map((entry) => coverageEntry(entry));
	}
}

class WasmContext {
	readonly #page: WasmPage;
	readonly #browserRoot = Object.assign(new EventEmitter(), {
		createChildSession() { throw new Error('This fixture has no service workers.'); },
	});
	constructor(page: WasmPage) { this.#page = page; page.setContext(this); }
	browser() {
		const implementation = Object.assign(new EventEmitter(), { _session: this.#browserRoot });
		return { _connection: { toImpl: () => implementation }, async newBrowserCDPSession() {} };
	}
	on() {}
	off() {}
	pages() { return [this.#page]; }
	async newCDPSession(page: WasmPage) { return rootSession(page); }
}

function rootSession(page: WasmPage, options: {
	debuggerDisabled?: () => void; finalScript?: ParsedScript;
} = {}) {
	const emitter = new EventEmitter();
	let attached = false;
	let coverageTakes = 0;
	return Object.assign(emitter, {
		async detach() {},
		async send(method: string, parameters: Record<string, unknown> = {}) {
			if (method === 'Debugger.disable') options.debuggerDisabled?.();
			if (method === 'Debugger.enable') {
				queueMicrotask(() => emitParsed(emitter, page.rootScripts));
			}
			if (method === 'Debugger.getScriptSource') {
				return sourceReply([
					...page.rootScripts,
					...(options.finalScript === undefined ? [] : [options.finalScript]),
				], String(parameters.scriptId));
			}
			if (method === 'Profiler.takePreciseCoverage') {
				coverageTakes += 1;
				if (coverageTakes === 1 && options.finalScript !== undefined) {
					emitParsed(emitter, [options.finalScript]);
				}
				return { result: page.takeCoverage() };
			}
			if (method === 'Page.reload') queueMicrotask(() => emitter.emit('Page.loadEventFired', {}));
			if (method === 'Target.setAutoAttach' && !attached && page.workerScripts.length > 0) {
				attached = true;
				queueMicrotask(() => emitter.emit('Target.attachedToTarget', {
					sessionId: 'worker-session',
					targetInfo: { targetId: 'worker-target', type: 'worker', url: page.workerScripts[0]?.url },
					waitingForDebugger: true,
				}));
			}
			if (method === 'Target.sendMessageToTarget') {
				handleChildMessage(emitter, page.workerScripts, parameters);
			}
			return {};
		},
	});
}

function handleChildMessage(emitter: EventEmitter, scripts: readonly ParsedScript[], parameters: Record<string, unknown>) {
	const request = JSON.parse(String(parameters.message)) as {
		id: number; method: string; params?: { scriptId?: string };
	};
	let result: unknown = {};
	if (request.method === 'Debugger.getScriptSource') {
		result = sourceReply(scripts, String(request.params?.scriptId));
	} else if (request.method === 'Profiler.takePreciseCoverage') {
		result = { result: scripts.filter(({ bytes }) => bytes === undefined)
			.map((entry) => coverageEntry(entry, '')) };
	}
	queueMicrotask(() => {
		emitter.emit('Target.receivedMessageFromTarget', {
			message: JSON.stringify({ id: request.id, result }), sessionId: 'worker-session',
		});
		if (request.method === 'Debugger.enable') emitChildParsed(emitter, scripts);
		if (request.method === 'Runtime.runIfWaitingForDebugger') {
			emitter.emit('Target.receivedMessageFromTarget', {
				message: JSON.stringify({ method: 'Profiler.preciseCoverageDeltaUpdate', params: {
					result: scripts.filter(({ bytes }) => bytes === undefined)
						.map((entry) => coverageEntry(entry, '')),
				} }),
				sessionId: 'worker-session',
			});
			emitter.emit('Target.detachedFromTarget', { sessionId: 'worker-session' });
		}
	});
}

function emitParsed(emitter: EventEmitter, scripts: readonly ParsedScript[]) {
	for (const entry of scripts) emitter.emit('Debugger.scriptParsed', parsedEvent(entry));
}

function emitChildParsed(emitter: EventEmitter, scripts: readonly ParsedScript[]) {
	for (const entry of scripts) emitter.emit('Target.receivedMessageFromTarget', {
		message: JSON.stringify({ method: 'Debugger.scriptParsed', params: parsedEvent(entry) }),
		sessionId: 'worker-session',
	});
}

function parsedEvent(entry: ParsedScript) {
	return { scriptId: entry.scriptId, url: entry.url,
		...(entry.bytes === undefined ? {} : { scriptLanguage: 'WebAssembly' }) };
}

function sourceReply(scripts: readonly ParsedScript[], scriptId: string) {
	const entry = scripts.find((candidate) => candidate.scriptId === scriptId);
	return entry?.bytes === undefined
		? { scriptSource: `source:${scriptId}` }
		: { bytecode: entry.bytes.toString('base64'), scriptSource: '' };
}

async function settlePending(pending: Promise<unknown>[]) {
	while (pending.length > 0) await Promise.all(pending.splice(0, pending.length));
}
