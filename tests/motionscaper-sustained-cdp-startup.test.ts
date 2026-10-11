/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createContext, runInContext, type Context } from 'node:vm';
import { MotionSustainedCdp } from '../scripts/performance/motionscaper-sustained-cdp.ts';

interface Request { readonly id: number; readonly method: string; readonly sessionId?: string; readonly params: Record<string, unknown> }
class StartupSocket extends EventTarget {
	static latest: StartupSocket;
	static rejectRootAttach = false;
	readonly sent: Request[] = []; readonly contexts = new Map<string, Context>();
	readonly scripts = new Map<string, string>(); readonly enabledPages = new Set<string>(); readonly deferred = new Map<string, Request>();
	closed = false; closeCalls = 0; wrongSession = false; failScript = false;
	constructor() { super(); StartupSocket.latest = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
	message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
	reply(request: Request, result: unknown = {}, error?: string): void {
		queueMicrotask(() => this.message({ id: request.id, ...(request.sessionId ? { sessionId: this.wrongSession ? 'foreign-session' : request.sessionId } : {}),
			...(error ? { error: { code: -32000, message: error } } : { result }) }));
	}
	send(data: string): void {
		assert.equal(this.closed, false); const request = JSON.parse(data) as Request; this.sent.push(request);
		if (StartupSocket.rejectRootAttach && !request.sessionId) { this.reply(request, {}, 'Root attachment refused'); return; }
		const session = request.sessionId;
		if (request.method === 'Page.enable' && session) this.enabledPages.add(session);
		if (request.method === 'Runtime.enable' && session?.startsWith('page')) { this.deferred.set(session, request); return; }
		if (request.method === 'Page.addScriptToEvaluateOnNewDocument' && session) {
			if (this.failScript) { this.reply(request, {}, 'Init script rejected'); return; }
			assert.equal(request.params.runImmediately, true); assert.equal(typeof request.params.source, 'string');
			this.scripts.set(session, String(request.params.source)); this.reply(request, { identifier: 'owned-init-script' }); return;
		}
		if (request.method === 'Runtime.evaluate' && session) {
			const value: unknown = runInContext(String(request.params.expression), this.contexts.get(session)!);
			this.reply(request, { result: { value } }); return;
		}
		if (request.method === 'Runtime.runIfWaitingForDebugger' && session) {
			const context = this.contexts.get(session)!;
			if (session.startsWith('page')) {
				const source = this.scripts.get(session); if (source && this.enabledPages.has(session)) runInContext(source, context);
				const enable = this.deferred.get(session); if (enable) { this.deferred.delete(session); this.reply(enable); }
			}
			// The first application statement allocates memory. Later injection cannot recover it.
			runInContext('globalThis.firstMemory = new WebAssembly.Memory({initial: 1});', context);
		}
		if (request.method === 'Runtime.getHeapUsage') { this.reply(request, { usedSize: 1024, totalSize: 2048 }); return; }
		this.reply(request);
	}
	attach(type: 'page' | 'worker'): string {
		const session = `${type}-session`; this.contexts.set(session, createContext({ name: type === 'worker' ? 'motionscaper-composition-preview' : '' }));
		this.message({ method: 'Target.attachedToTarget', params: { sessionId: session, waitingForDebugger: true,
			targetInfo: { targetId: `${type}-target`, type, url: type === 'page' ? '' : 'http://127.0.0.1/motion-worker.js' } } });
		return session;
	}
	navigate(session: string): void {
		assert.ok(session.startsWith('page')); const context = createContext({ name: '' }); this.contexts.set(session, context);
		const source = this.scripts.get(session);
		// Blink dispatches DidCreateMainWorldContext to enabled Page agents only. Registration
		// can acknowledge while disabled; that does not make the next document observed.
		if (source && this.enabledPages.has(session)) runInContext(source, context);
		runInContext('globalThis.firstMemory = new WebAssembly.Memory({initial: 2});', context);
	}
	remoteClose(): void { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
	close(): void { this.closeCalls++; queueMicrotask(() => this.remoteClose()); }
}
function install(t: TestContext): void {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket'); assert.ok(original);
	Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: StartupSocket });
	StartupSocket.rejectRootAttach = false;
	t.after(() => { StartupSocket.latest.remoteClose(); Object.defineProperty(globalThis, 'WebSocket', original); });
}
async function bounded<T>(operation: Promise<T>): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => { StartupSocket.latest.remoteClose(); reject(new Error('Paused page never resumed.')); }, 250);
	})]); } finally { clearTimeout(timer); }
}
const endpoint = 'ws://127.0.0.1:12345/devtools/browser/synthetic';

test('Motion sustained observer captures first page WASM allocation without awaiting paused Runtime.enable', async t => {
	install(t); const observer = await MotionSustainedCdp.connect(endpoint), socket = StartupSocket.latest;
	socket.attach('page'); const samples = await bounded(observer.sample());
	assert.equal(samples.length, 1); assert.deepEqual(samples[0]!.wasmCapacityBytes, [65536]);
	assert.deepEqual(socket.sent.filter(request => request.sessionId).slice(0, 5).map(request => request.method), [
		'Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Target.setAutoAttach', 'Runtime.enable', 'Runtime.runIfWaitingForDebugger',
	]);
	assert.equal(observer.identities()[0]!.ready, true); await observer.close();
});

test('Motion sustained observer installs a worker hook before its first production statement', async t => {
	install(t); const observer = await MotionSustainedCdp.connect(endpoint), socket = StartupSocket.latest;
	socket.attach('worker'); const samples = await bounded(observer.sample());
	assert.deepEqual(samples[0]!.wasmCapacityBytes, [65536]); assert.equal(samples[0]!.workerName, 'motionscaper-composition-preview');
	assert.ok(socket.sent.findIndex(request => request.method === 'Runtime.evaluate') < socket.sent.findIndex(request => request.method === 'Runtime.runIfWaitingForDebugger'));
	await observer.close();
});

test('Motion sustained observer refuses a response with an owned id but foreign session', async t => {
	install(t); const observer = await MotionSustainedCdp.connect(endpoint), socket = StartupSocket.latest;
	socket.wrongSession = true; socket.attach('worker');
	await assert.rejects(bounded(observer.ready()), /CDP response session does not match/u);
	await assert.rejects(observer.close(), /CDP response session does not match/u);
	assert.equal(socket.closed, true); assert.equal(observer.identities()[0]!.ready, false);
});

test('Motion sustained observer retains unknown response failure instead of dropping it', async t => {
	install(t); const observer = await MotionSustainedCdp.connect(endpoint), socket = StartupSocket.latest;
	socket.message({ id: 999, result: {} });
	await assert.rejects(observer.ready(), /Unowned CDP response/u); await assert.rejects(observer.close(), /Unowned CDP response/u);
	assert.equal(socket.closed, true);
});

test('Motion sustained observer physically closes failed initial attachment before returning failure', async t => {
	install(t); StartupSocket.rejectRootAttach = true;
	await assert.rejects(MotionSustainedCdp.connect(endpoint), /Root attachment refused/u);
	assert.equal(StartupSocket.latest.closed, true); assert.equal(StartupSocket.latest.closeCalls, 1);
});

test('Motion sustained observer rejects a missing page init script while still draining startup', async t => {
	install(t); const observer = await MotionSustainedCdp.connect(endpoint), socket = StartupSocket.latest;
	socket.failScript = true; socket.attach('page');
	await assert.rejects(bounded(observer.ready()), /Init script rejected/u);
	assert.equal(observer.identities()[0]!.ready, false);
	await assert.rejects(observer.close(), /Init script rejected/u); assert.equal(socket.closed, true);
});

// Mirrors the real packaged page navigation after its initial empty context.
test('Motion sustained page registration observes the first WASM allocation in each new document', async t => {
	install(t); const observer = await MotionSustainedCdp.connect(endpoint), socket = StartupSocket.latest;
	const session = socket.attach('page'); await bounded(observer.ready());
	socket.navigate(session); const samples = await observer.sample();
	assert.deepEqual(samples[0]!.wasmCapacityBytes, [131072]);
	assert.equal(socket.sent.filter(request => request.method === 'Page.addScriptToEvaluateOnNewDocument').length, 1);
	assert.equal(socket.sent.filter(request => request.method === 'Runtime.evaluate').length, 1, 'Only the snapshot evaluates after navigation; never late observer installation.');
	await observer.close();
});
