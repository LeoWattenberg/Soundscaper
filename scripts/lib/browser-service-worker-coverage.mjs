/* SPDX-License-Identifier: AGPL-3.0-only */

import { EventEmitter } from 'node:events';

const SERVICE_WORKER_FILTER = Object.freeze([
	Object.freeze({ type: 'service_worker' }),
	Object.freeze({ exclude: true }),
]);
const ACTIVE_PLAYWRIGHT_ROOTS = new WeakSet();

/**
 * Start coverage on service workers from the browser target which creates them.
 *
 * A page target learns about its related service worker only after Chromium has
 * evaluated the worker's top level. Browser-target auto-attach pauses the new
 * target before that first instruction instead.
 *
 * @param {{
 *   rootSession: object,
 *   keepUrl?: (url: string) => boolean,
 *   openTargetSession?: (rootSession: object, sessionId: string) => object,
 * }} options
 */
export function createBrowserServiceWorkerCoverageCollector({
	rootSession,
	keepUrl = () => true,
	openTargetSession,
}) {
	if (!rootSession || typeof rootSession.on !== 'function' || typeof rootSession.send !== 'function') {
		throw new TypeError('Service-worker coverage requires a browser CDP session.');
	}
	if (typeof openTargetSession !== 'function') {
		throw new TypeError('Service-worker coverage requires a paused-target session adapter.');
	}
	let attached = false;
	let finished = false;
	let rootClosed = false;
	const failures = [];
	const pending = [];
	const recorders = new Map();

	const onAttached = ({ sessionId, targetInfo, waitingForDebugger }) => {
		if (finished || targetInfo?.type !== 'service_worker' || typeof sessionId !== 'string') return;
		let session;
		try {
			session = openTargetSession(rootSession, sessionId);
		} catch (error) {
			failures.push(error);
			return;
		}
		const recorder = {
			active: true,
			scriptUrls: new Map(),
			session,
			sources: new Map(),
			taken: [],
			waitingForDebugger: waitingForDebugger === true,
		};
		recorders.set(sessionId, recorder);
		session.on('close', () => { recorder.active = false; });
		session.on('Debugger.scriptParsed', ({ scriptId, url }) => {
			if (typeof url === 'string' && url !== '') recorder.scriptUrls.set(String(scriptId), url);
			if (typeof url !== 'string' || !keepUrl(url) || recorder.sources.has(url)) return;
			const work = session.send('Debugger.getScriptSource', { scriptId })
				.then(({ scriptSource }) => {
					if (typeof scriptSource === 'string' && !recorder.sources.has(url)) {
						recorder.sources.set(url, scriptSource);
					}
				})
				.catch((error) => {
					if (recorder.active) failures.push(error);
				});
			pending.push(work);
		});
		session.on('Profiler.preciseCoverageDeltaUpdate', ({ result }) => {
			if (Array.isArray(result)) recorder.taken.push(...result);
		});
		pending.push(startRecorder(recorder).catch((error) => {
			if (recorder.active) failures.push(error);
		}));
	};
	const onDetached = ({ sessionId }) => {
		const recorder = recorders.get(sessionId);
		if (!recorder) return;
		recorder.active = false;
		recorder.session.close?.();
	};
	const onClose = () => {
		rootClosed = true;
		for (const recorder of recorders.values()) {
			recorder.active = false;
			recorder.session.close?.();
		}
	};
	rootSession.on('Target.attachedToTarget', onAttached);
	rootSession.on('Target.detachedFromTarget', onDetached);
	rootSession.on('close', onClose);

	async function startRecorder(recorder) {
		// Queue every profiler command before yielding. Playwright's own browser
		// target listener resumes the same worker as soon as this callback returns.
		// CDP processes commands from the session in send order, so coverage is
		// enabled before that resume even though the replies arrive later.
		const debuggerEnabled = recorder.session.send('Debugger.enable');
		const profilerEnabled = recorder.session.send('Profiler.enable');
		const runtimeEnabled = recorder.session.send('Runtime.enable');
		const coverageStarted = recorder.session.send('Profiler.startPreciseCoverage', {
			allowTriggeredUpdates: true,
			callCount: false,
			detailed: true,
		});
		await debuggerEnabled;
		await profilerEnabled;
		await runtimeEnabled;
		await coverageStarted;
		if (recorder.waitingForDebugger) {
			await recorder.session.send('Runtime.runIfWaitingForDebugger');
		}
	}

	async function settle() {
		while (pending.length > 0) await Promise.all(pending.splice(0, pending.length));
		if (failures.length === 1) throw failures.shift();
		if (failures.length > 1) {
			throw new AggregateError(failures.splice(0), 'Service workers could not record coverage.');
		}
	}

	async function checkpointRecorder(recorder) {
		if (!recorder.active) return;
		try {
			const { result } = await recorder.session.send('Profiler.takePreciseCoverage');
			if (Array.isArray(result)) recorder.taken.push(...result);
		} catch (error) {
			if (recorder.active) throw error;
		}
	}

	return Object.freeze({
		collected: () => finished,
		async start() {
			if (attached) throw new Error('Service-worker coverage was already started.');
			attached = true;
			await rootSession.send('Target.setAutoAttach', {
				autoAttach: true,
				flatten: true,
				filter: SERVICE_WORKER_FILTER,
				waitForDebuggerOnStart: true,
			});
			await settle();
		},
		settle,
		async checkpoint() {
			if (!attached || finished) return;
			await settle();
			await Promise.all([...recorders.values()].map(checkpointRecorder));
			await settle();
		},
		async collect() {
			if (!attached) throw new Error('Service-worker coverage has not started.');
			if (finished) throw new Error('Service-worker coverage was already collected.');
			finished = true;
			let collectionError = null;
			try {
				await settle();
				await Promise.all([...recorders.values()].map(checkpointRecorder));
				for (const recorder of recorders.values()) {
					if (!recorder.active) continue;
					try {
						await recorder.session.send('Profiler.stopPreciseCoverage');
						await recorder.session.send('Profiler.disable');
						await recorder.session.send('Debugger.disable');
					} catch (error) {
						if (recorder.active) throw error;
					}
				}
			} catch (error) {
				collectionError = error;
			}
			let cleanupError = null;
			try {
				if (!rootClosed) await rootSession.send('Target.setAutoAttach', {
					autoAttach: false,
					flatten: true,
					waitForDebuggerOnStart: false,
				});
				for (const recorder of recorders.values()) {
					await recorder.session.detach?.().catch(() => undefined);
					recorder.session.close?.();
				}
				await rootSession.detach?.().catch((error) => {
					if (!rootClosed) throw error;
				});
			} catch (error) {
				cleanupError = error;
			}
			if (collectionError !== null && cleanupError !== null) {
				throw new AggregateError(
					[collectionError, cleanupError],
					'Service-worker coverage collection and cleanup both failed.',
				);
			}
			if (collectionError !== null) throw collectionError;
			if (cleanupError !== null) throw cleanupError;

			const entries = [];
			const sources = new Map();
			for (const recorder of recorders.values()) {
				for (const entry of coverageWithParsedUrls(recorder.taken, recorder.scriptUrls)) {
					if (typeof entry.url === 'string' && keepUrl(entry.url)) entries.push(entry);
				}
				for (const [url, source] of recorder.sources) {
					if (keepUrl(url) && !sources.has(url)) sources.set(url, source);
				}
			}
			const count = recorders.size;
			const paused = [...recorders.values()].filter(({ waitingForDebugger }) => waitingForDebugger).length;
			return Object.freeze({
				entries,
				pausedTargetCounts: paused === 0 ? {} : { service_worker: paused },
				sources,
				targetCounts: count === 0 ? {} : { service_worker: count },
				targetTypes: count === 0 ? [] : ['service_worker'],
			});
		},
	});
}

/** Create a browser-scoped collector from Playwright's Chromium browser. */
export async function createPlaywrightBrowserServiceWorkerCoverageCollector({
	browser,
	keepUrl = () => true,
}) {
	if (!browser || typeof browser.newBrowserCDPSession !== 'function') {
		throw new TypeError('Service-worker coverage requires Playwright Chromium.');
	}
	const implementation = browser?._connection?.toImpl?.(browser);
	const rootSession = createPlaywrightBrowserTargetAdapter(implementation);
	return createBrowserServiceWorkerCoverageCollector({
		keepUrl,
		openTargetSession: (root, sessionId) => root.openTargetSession(sessionId),
		rootSession,
	});
}

function createPlaywrightBrowserTargetAdapter(browser) {
	const parent = browser?._session;
	if (!parent || typeof parent.prependListener !== 'function'
		|| typeof parent.createChildSession !== 'function'
		|| typeof browser.on !== 'function' || typeof browser.off !== 'function') {
		throw new Error('Playwright cannot bind its browser service-worker CDP targets.');
	}
	if (ACTIVE_PLAYWRIGHT_ROOTS.has(parent)) {
		throw new Error('Playwright browser service-worker coverage is already active.');
	}
	ACTIVE_PLAYWRIGHT_ROOTS.add(parent);
	const events = new EventEmitter();
	const children = new Map();
	const targets = new Map();
	const originalCreateChildSession = parent.createChildSession;
	let closed = false;
	let existingTargetsEmitted = false;
	const markTarget = (parameters) => {
		if (parameters?.targetInfo?.type === 'service_worker') {
			targets.set(parameters.sessionId, parameters);
		}
	};
	const forwardDetached = (parameters) => {
		children.delete(parameters?.sessionId);
		events.emit('Target.detachedFromTarget', parameters);
	};
	const forwardClose = () => { events.emit('close'); };
	const wrappedCreateChildSession = function(sessionId, listener) {
		const child = originalCreateChildSession.call(this, sessionId, listener);
		const target = targets.get(sessionId);
		if (target) {
			targets.delete(sessionId);
			children.set(sessionId, child);
			events.emit('Target.attachedToTarget', target);
		}
		return child;
	};
	parent.prependListener('Target.attachedToTarget', markTarget);
	parent.on('Target.detachedFromTarget', forwardDetached);
	browser.on('disconnected', forwardClose);
	parent.createChildSession = wrappedCreateChildSession;

	return Object.freeze({
		detach: async () => {
			if (closed) return;
			closed = true;
			parent.off('Target.attachedToTarget', markTarget);
			parent.off('Target.detachedFromTarget', forwardDetached);
			browser.off('disconnected', forwardClose);
			ACTIVE_PLAYWRIGHT_ROOTS.delete(parent);
			if (parent.createChildSession === wrappedCreateChildSession) {
				parent.createChildSession = originalCreateChildSession;
			} else {
				throw new Error('Playwright browser target interception changed during coverage.');
			}
			children.clear();
			targets.clear();
			events.emit('close');
			events.removeAllListeners();
		},
		on: events.on.bind(events),
		off: events.off.bind(events),
		openTargetSession(sessionId) {
			const child = children.get(sessionId);
			if (!child) throw new Error('Playwright lost a paused service-worker CDP target.');
			return Object.freeze({
				close() {},
				async detach() {},
				on: child.on.bind(child),
				off: child.off.bind(child),
				send: child.send.bind(child),
			});
		},
		async send(method, parameters) {
			if (closed) throw new Error('Playwright browser target interception is closed.');
			if (method !== 'Target.setAutoAttach') {
				throw new Error(`Unsupported Playwright browser target command: ${method}`);
			}
			// Playwright owns this root session and already keeps recursive targets
			// paused. Do not replace or disable its auto-attach configuration.
			if (parameters?.autoAttach === true && !existingTargetsEmitted) {
				existingTargetsEmitted = true;
				for (const [targetId, worker] of browser._serviceWorkers ?? []) {
					const child = worker?._session;
					const sessionId = child?._sessionId;
					if (typeof sessionId !== 'string' || sessionId === '') continue;
					children.set(sessionId, child);
					events.emit('Target.attachedToTarget', {
						sessionId,
						targetInfo: { targetId, type: 'service_worker', url: worker.url },
						waitingForDebugger: false,
					});
				}
			}
			return {};
		},
	});
}

function coverageWithParsedUrls(entries, urls) {
	return entries.map((entry) => {
		const parsedUrl = urls.get(String(entry.scriptId));
		return typeof parsedUrl === 'string' && parsedUrl !== entry.url ? { ...entry, url: parsedUrl } : entry;
	});
}
