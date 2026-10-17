/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { MotionSustainedCdp } from '../scripts/performance/motionscaper-sustained-cdp.ts';

interface Request { readonly id: number; readonly method: string; readonly sessionId?: string }
class SyntheticSocket extends EventTarget {
	static latest: SyntheticSocket;
	readonly sent: Request[] = [];
	closed = false; closeCalls = 0; closeEvents = 0; holdEnable = false; failEvaluation = false;
	constructor() { super(); SyntheticSocket.latest = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
	send(data: string): void {
		assert.equal(this.closed, false);
		const request = JSON.parse(data) as Request; this.sent.push(request);
		if (this.holdEnable && request.method === 'Runtime.enable') return;
		queueMicrotask(() => this.message({ id: request.id, ...(request.sessionId ? { sessionId: request.sessionId } : {}), result: this.failEvaluation && request.method === 'Runtime.evaluate'
			? { exceptionDetails: { text: 'Synthetic observation failure' } } : {} }));
	}
	message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
	attach(): void {
		this.message({ method: 'Target.attachedToTarget', params: { sessionId: 'worker-session',
			targetInfo: { targetId: 'worker-target', type: 'worker', url: 'http://127.0.0.1/motion-worker.js' } } });
	}
	remoteClose(): void {
		if (this.closed) return;
		this.closed = true; this.closeEvents++; this.dispatchEvent(new Event('close'));
	}
	close(): void { this.closeCalls++; if (!this.closed) queueMicrotask(() => this.remoteClose()); }
}
async function connect(t: TestContext) {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket'); assert.ok(original);
	Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: SyntheticSocket });
	t.after(() => Object.defineProperty(globalThis, 'WebSocket', original));
	const observer = await MotionSustainedCdp.connect('ws://127.0.0.1:12345/devtools/browser/synthetic');
	return { observer, socket: SyntheticSocket.latest };
}
async function bounded<T>(operation: Promise<T>): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error('Synthetic close missed the only socket close event.')), 250);
		})]);
	} finally { clearTimeout(timer); }
}

test('Motion sustained CDP close settles when the socket closes during pending observer preparation', async t => {
	const { observer, socket } = await connect(t);
	socket.holdEnable = true; socket.attach();
	assert.equal(socket.sent.at(-1)?.method, 'Runtime.enable');
	const closing = observer.close(); socket.remoteClose();
	await assert.rejects(bounded(closing), /CDP closed or observation concurrency exceeded/u);
	assert.equal(socket.closeEvents, 1); assert.equal(socket.closeCalls, 0);
	assert.equal(observer.identities()[0]?.ready, false);
	await observer.close(); assert.equal(socket.closeEvents, 1);
});

test('Motion sustained CDP close waits for worker observation and resume before one physical close', async t => {
	const { observer, socket } = await connect(t); socket.attach();
	await bounded(observer.close());
	assert.deepEqual(socket.sent.map(request => request.method), [
		'Target.setAutoAttach', 'Runtime.enable', 'Runtime.evaluate', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger',
	]);
	assert.equal(observer.identities()[0]?.ready, true);
	assert.equal(socket.closed, true); assert.equal(socket.closeEvents, 1); assert.equal(socket.closeCalls, 1);
	await observer.close(); assert.equal(socket.closeCalls, 1);
});

test('Motion sustained CDP close preserves observation errors while closing a still-open channel', async t => {
	const { observer, socket } = await connect(t); socket.failEvaluation = true; socket.attach();
	await assert.rejects(bounded(observer.close()), /External WASM observation installation failed/u);
	assert.equal(socket.sent.at(-1)?.method, 'Runtime.runIfWaitingForDebugger');
	assert.equal(observer.identities()[0]?.ready, false);
	assert.equal(socket.closeEvents, 1); assert.equal(socket.closeCalls, 1);
});
