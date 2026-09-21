/* SPDX-License-Identifier: AGPL-3.0-only */

import { EventEmitter } from 'node:events';

const AUTO_ATTACH_OPTIONS = Object.freeze({
	autoAttach: true,
	filter: Object.freeze([
		Object.freeze({ type: 'service_worker', exclude: true }),
		Object.freeze({}),
	]),
	flatten: false,
	waitForDebuggerOnStart: true,
});

/** Start precise V8 coverage in a page target and every target it creates. */
export async function startPackagedRuntimeTargetCoverage({
	keepUrl,
	page,
	pending,
	rootSession,
}) {
	const recorders = [];
	const pausedTargetCounts = new Map();
	const targetCounts = new Map();
	const targetTypes = new Set();
	const nestedSessions = [];

	async function instrument(session, type, waitingForDebugger, ownerPage = null) {
		const recorder = {
			active: true,
			checkpoint: null,
			checkpointTail: Promise.resolve(),
			page: ownerPage,
			session,
			scriptUrls: new Map(),
			sources: new Map(),
			taken: [],
			type,
		};
		recorders.push(recorder);
		targetTypes.add(type);
		targetCounts.set(type, (targetCounts.get(type) ?? 0) + 1);
		if (waitingForDebugger) pausedTargetCounts.set(type, (pausedTargetCounts.get(type) ?? 0) + 1);
		session.on('detached', () => { recorder.active = false; });
		session.on('Debugger.scriptParsed', ({ scriptId, url }) => {
			if (typeof url === 'string' && url !== '') recorder.scriptUrls.set(String(scriptId), url);
			if (!keepUrl(url) || recorder.sources.has(url)) return;
			pending.push(session.send('Debugger.getScriptSource', { scriptId })
				.then(({ scriptSource }) => {
					if (typeof scriptSource === 'string' && !recorder.sources.has(url)) {
						recorder.sources.set(url, scriptSource);
					}
				})
				.catch(() => undefined));
		});
		session.on('Profiler.preciseCoverageDeltaUpdate', ({ result }) => {
			if (Array.isArray(result)) {
				recorder.taken.push(...coverageWithParsedUrls(result, recorder.scriptUrls));
			}
		});
		recorder.checkpoint = () => {
			recorder.checkpointTail = recorder.checkpointTail.then(async () => {
				if (!recorder.active) return;
				try {
					const { result } = await session.send('Profiler.takePreciseCoverage');
					recorder.taken.push(...coverageWithParsedUrls(result, recorder.scriptUrls));
				} catch (error) {
					if (recorder.active) throw error;
				}
			});
			return recorder.checkpointTail;
		};
		const checkpointOnExit = () => { pending.push(recorder.checkpoint()); };
		session.on('Runtime.executionContextDestroyed', checkpointOnExit);
		session.on('Runtime.executionContextsCleared', checkpointOnExit);
		await session.send('Debugger.enable');
		await session.send('Profiler.enable');
		await session.send('Runtime.enable');
		await session.send('Profiler.startPreciseCoverage', {
			allowTriggeredUpdates: true,
			callCount: false,
			detailed: true,
		});
		attachChildren(session);
		await session.send('Target.setAutoAttach', AUTO_ATTACH_OPTIONS);
		if (waitingForDebugger) await session.send('Runtime.runIfWaitingForDebugger');
		return recorder;
	}

	function attachChildren(parent) {
		parent.on('Target.attachedToTarget', ({ sessionId, targetInfo, waitingForDebugger }) => {
			const child = new NestedCdpSession(parent, sessionId);
			nestedSessions.push(child);
			pending.push(instrument(
				child,
				targetInfo?.type || 'unknown',
				waitingForDebugger === true,
			));
		});
	}

	await instrument(rootSession, 'page', false, page);

	return Object.freeze({
		async reload(timeoutMs) {
			await rootSession.send('Page.enable');
			const loaded = waitForSessionEvent(rootSession, 'Page.loadEventFired', timeoutMs);
			try {
				await rootSession.send('Page.reload', { ignoreCache: false });
				await loaded.promise;
			} finally {
				loaded.cancel();
			}
		},
		async checkpoint() {
			await Promise.all(recorders.map((recorder) => recorder.checkpoint()));
		},
		async collect() {
			for (const recorder of [...recorders].reverse()) {
				if (recorder.active && recorder.page?.isClosed?.() !== true) {
					try {
						const { result } = await recorder.session.send('Profiler.takePreciseCoverage');
						recorder.taken.push(...coverageWithParsedUrls(result, recorder.scriptUrls));
						await recorder.session.send('Profiler.stopPreciseCoverage');
						await recorder.session.send('Profiler.disable');
						await recorder.session.send('Debugger.disable');
					} catch (error) {
						if (recorder.active && recorder.page?.isClosed?.() !== true) throw error;
					}
				}
			}
			for (const session of nestedSessions.reverse()) await session.detach().catch(() => undefined);
			await rootSession.detach().catch((error) => {
				if (page.isClosed?.() !== true) throw error;
			});
			const entries = [];
			const sources = new Map();
			for (const recorder of recorders) {
				entries.push(...recorder.taken);
				for (const [url, source] of recorder.sources) {
					if (!sources.has(url)) sources.set(url, source);
				}
			}
			return Object.freeze({
				entries,
				pausedTargetCounts: Object.fromEntries(
					[...pausedTargetCounts].filter(([type]) => type !== 'page').sort(([left], [right]) => left.localeCompare(right)),
				),
				sources,
				targetCounts: Object.fromEntries(
					[...targetCounts].filter(([type]) => type !== 'page').sort(([left], [right]) => left.localeCompare(right)),
				),
				targetTypes: [...targetTypes].filter((type) => type !== 'page').sort(),
			});
		},
	});
}

function coverageWithParsedUrls(entries, urls) {
	return entries.map((entry) => {
		const parsedUrl = urls.get(String(entry.scriptId));
		return typeof parsedUrl === 'string' && parsedUrl !== entry.url ? { ...entry, url: parsedUrl } : entry;
	});
}

function waitForSessionEvent(session, event, timeoutMs) {
	let timer;
	let settled = false;
	let resolveEvent;
	const listener = () => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		session.off?.(event, listener);
		resolveEvent();
	};
	const promise = new Promise((resolvePromise, reject) => {
		resolveEvent = resolvePromise;
		timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			session.off?.(event, listener);
			reject(new Error(`Timed out waiting for CDP ${event}.`));
		}, timeoutMs);
	});
	session.on(event, listener);
	return {
		cancel() {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			session.off?.(event, listener);
			resolveEvent();
		},
		promise,
	};
}

class NestedCdpSession extends EventEmitter {
	#closed = false;
	#id = 0;
	#parent;
	#pending = new Map();
	#sessionId;

	constructor(parent, sessionId) {
		super();
		this.#parent = parent;
		this.#sessionId = sessionId;
		this.#parent.on('Target.receivedMessageFromTarget', this.#onMessage);
		this.#parent.on('Target.detachedFromTarget', this.#onDetached);
	}

	async send(method, params = {}) {
		if (this.#closed) throw new Error('Nested CDP target detached.');
		const id = ++this.#id;
		let resolveResponse;
		let rejectResponse;
		const response = new Promise((resolvePromise, reject) => {
			resolveResponse = resolvePromise;
			rejectResponse = reject;
		});
		this.#pending.set(id, { reject: rejectResponse, resolve: resolveResponse });
		try {
			await this.#parent.send('Target.sendMessageToTarget', {
				message: JSON.stringify({ id, method, params }),
				sessionId: this.#sessionId,
			});
		} catch (error) {
			this.#pending.delete(id);
			rejectResponse(error);
		}
		return response;
	}

	async detach() {
		if (this.#closed) return;
		try {
			await this.#parent.send('Target.detachFromTarget', { sessionId: this.#sessionId });
		} finally {
			this.#close();
		}
	}

	#onMessage = ({ message, sessionId }) => {
		if (sessionId !== this.#sessionId || this.#closed) return;
		let payload;
		try { payload = JSON.parse(message); } catch { return; }
		if (Number.isSafeInteger(payload.id)) {
			const request = this.#pending.get(payload.id);
			if (!request) return;
			this.#pending.delete(payload.id);
			if (payload.error) request.reject(new Error(payload.error.message || 'Nested CDP command failed.'));
			else request.resolve(payload.result ?? {});
			return;
		}
		if (typeof payload.method === 'string') this.emit(payload.method, payload.params ?? {});
	};

	#onDetached = ({ sessionId }) => {
		if (sessionId === this.#sessionId) this.#close();
	};

	#close() {
		if (this.#closed) return;
		this.#closed = true;
		this.#parent.off?.('Target.receivedMessageFromTarget', this.#onMessage);
		this.#parent.off?.('Target.detachedFromTarget', this.#onDetached);
		for (const request of this.#pending.values()) request.reject(new Error('Nested CDP target detached.'));
		this.#pending.clear();
		this.emit('detached');
	}
}
