/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionWasmObservationSource } from './motionscaper-sustained-wasm-observation.ts';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';

type Fields = Readonly<Record<string, unknown>>;
function fields(value: unknown): Fields {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CDP observation.');
	return value as Fields;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Missing CDP identity.'); return value; }
function bytes(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid CDP memory measurement.'); return value; }
export interface MotionSustainedTarget {
	readonly targetId: string; readonly sessionId: string; readonly type: string; readonly url: string;
	readonly attachedAt: string; detachedAt: string | null; ready: boolean;
}
export interface MotionSustainedTelemetry {
	readonly observedAt: string; readonly monotonicMs: number; readonly targetId: string; readonly sessionId: string;
	readonly type: string; readonly url: string; readonly usedHeapBytes: number; readonly totalHeapBytes: number;
	readonly wasmCapacityBytes: readonly number[]; readonly workerName: string; readonly workerFrames: number;
	readonly backend: string | null; readonly revision: number | null;
}

/** External, bounded CDP observer. It pauses newly attached workers only to install observation,
 * then resumes their unchanged production scripts. It provides no application capability. */
export class MotionSustainedCdp {
	readonly #socket: WebSocket; readonly #pending = new Map<number, { resolve(value: Fields): void; reject(error: unknown): void; timer: NodeJS.Timeout }>();
	readonly #targets = new Map<string, MotionSustainedTarget>(); readonly #preparing = new Set<Promise<void>>();
	readonly #errors: string[] = []; #next = 1; #closed = false;
	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.addEventListener('message', event => {
			try {
				if (typeof event.data !== 'string' || event.data.length > 1024 * 1024) throw new Error('CDP response exceeds bounded observation.');
				const message = fields(JSON.parse(event.data) as unknown);
				if (typeof message.id === 'number') {
					const pending = this.#pending.get(message.id); if (!pending) throw new Error('Unowned CDP response.');
					clearTimeout(pending.timer); this.#pending.delete(message.id);
					if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(fields(message.result));
				} else this.#event(message);
			} catch (error) { this.#invalid(error); }
		});
		socket.addEventListener('close', () => {
			this.#closed = true;
			for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP observation channel closed.')); }
			this.#pending.clear();
		});
	}
	static async connect(endpoint: string): Promise<MotionSustainedCdp> {
		if (!/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\da-z-]+$/u.test(endpoint)) throw new Error('Qualification requires the owned loopback CDP endpoint.');
		const socket = new WebSocket(endpoint);
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => { socket.close(); reject(new Error('CDP connection deadline exceeded.')); }, 10000);
			socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
			socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed.')); }, { once: true });
		});
		const observer = new MotionSustainedCdp(socket);
		await observer.#attach(); await observer.ready(); return observer;
	}
	async #attach(sessionId?: string): Promise<void> {
		await this.#send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
			filter: [{ type: 'page' }, { type: 'worker' }, { exclude: true }] }, sessionId);
	}
	#invalid(error: unknown): void { if (this.#errors.length < 16) this.#errors.push(String(error)); }
	#event(message: Fields): void {
		if (message.method === 'Target.attachedToTarget') {
			const params = fields(message.params), info = fields(params.targetInfo), sessionId = text(params.sessionId);
			const target: MotionSustainedTarget = { sessionId, targetId: text(info.targetId), type: text(info.type), url: text(info.url), attachedAt: new Date().toISOString(), detachedAt: null, ready: false };
			if (this.#targets.size >= plan.maximumTelemetryTargets) { this.#invalid('CDP target count exceeded.'); void this.#send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(error => this.#invalid(error)); return; }
			this.#targets.set(sessionId, target);
			const task = this.#prepare(target).catch(error => this.#invalid(error)); this.#preparing.add(task);
			void task.finally(() => this.#preparing.delete(task));
		} else if (message.method === 'Target.detachedFromTarget') {
			const target = this.#targets.get(text(fields(message.params).sessionId));
			if (target) target.detachedAt = new Date().toISOString();
		}
	}
	async #prepare(target: MotionSustainedTarget): Promise<void> {
		try {
			await this.#send('Runtime.enable', {}, target.sessionId);
			if (target.type === 'page') await this.#send('Page.addScriptToEvaluateOnNewDocument', { source: motionWasmObservationSource() }, target.sessionId);
			const result = await this.#send('Runtime.evaluate', { expression: motionWasmObservationSource() }, target.sessionId);
			if (result.exceptionDetails) throw new Error('External WASM observation installation failed.');
			await this.#attach(target.sessionId); target.ready = true;
		} finally { await this.#send('Runtime.runIfWaitingForDebugger', {}, target.sessionId); }
	}
	#send(method: string, params: Fields, sessionId?: string): Promise<Fields> {
		if (this.#closed || this.#pending.size >= 64) return Promise.reject(new Error('CDP closed or observation concurrency exceeded.'));
		const id = this.#next++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`CDP observation timed out: ${method}`)); }, 10000);
			this.#pending.set(id, { resolve, reject, timer });
			try { this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
			catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
		});
	}
	async ready(): Promise<void> {
		while (this.#preparing.size) await Promise.all(this.#preparing);
		if (this.#errors.length) throw new Error(this.#errors.join('\n'));
	}
	identities(): readonly MotionSustainedTarget[] { return [...this.#targets.values()].map(value => ({ ...value })); }
	async sample(): Promise<readonly MotionSustainedTelemetry[]> {
		await this.ready(); const observations: MotionSustainedTelemetry[] = [];
		for (const target of this.#targets.values()) {
			if (target.detachedAt) continue;
			const heap = await this.#send('Runtime.getHeapUsage', {}, target.sessionId);
			const evaluation = await this.#send('Runtime.evaluate', { expression: 'globalThis.__motionSustainedObservation.snapshot()', returnByValue: true }, target.sessionId);
			if (evaluation.exceptionDetails) throw new Error('WASM observer snapshot failed.');
			const value = fields(fields(evaluation.result).value);
			if (!Array.isArray(value.errors) || value.errors.length || value.weakOwnership !== true
				|| !Array.isArray(value.capacityBytes) || value.capacityBytes.length > 32) throw new Error('Invalid or incomplete WASM observation.');
			const backend = value.backend === null ? null : text(value.backend), revision = value.revision === null ? null : bytes(value.revision);
			observations.push({ targetId: target.targetId, sessionId: target.sessionId, type: target.type, url: target.url,
				observedAt: new Date().toISOString(), monotonicMs: performance.now(), usedHeapBytes: bytes(heap.usedSize), totalHeapBytes: bytes(heap.totalSize),
				wasmCapacityBytes: value.capacityBytes.map(bytes), workerName: text(value.workerName), workerFrames: bytes(value.frames), backend, revision });
		}
		return observations;
	}
	async close(): Promise<void> {
		if (this.#closed) return;
		try { await this.ready(); }
		finally { await new Promise<void>(resolve => { this.#socket.addEventListener('close', () => resolve(), { once: true }); this.#socket.close(); }); }
	}
}
