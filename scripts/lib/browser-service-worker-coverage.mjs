/* SPDX-License-Identifier: AGPL-3.0-only */

import { EventEmitter } from 'node:events';

import {
	appendCdpJavaScriptCoverage,
	attachCdpExecutionContextLifecycle,
	createCdpJavaScriptCoverageState,
	observeCdpScript,
} from './cdp-javascript-coverage.mjs';

const DEFAULT_TARGET_TYPES = Object.freeze(['service_worker']);
const ACTIVE_PLAYWRIGHT_ROOTS = new WeakSet();
export const WORKLET_COVERAGE_CHECKPOINT_URL = 'soundscaper-coverage://worklet-checkpoint.js';
export const INSTALL_WORKLET_COVERAGE_CHECKPOINT = `(() => {
	const key = Symbol.for('org.soundscaper.coverage.worklet-checkpoint');
	if (globalThis[key] === true) return true;
	if (typeof globalThis.registerProcessor !== 'function') return false;
	const originalRegisterProcessor = globalThis.registerProcessor;
	globalThis.registerProcessor = function(name, Processor) {
		let checkpointed = false;
		class SoundscaperCoverageProcessor extends Processor {
			process(...args) {
				const result = super.process(...args);
				if (!checkpointed) {
					checkpointed = true;
					debugger;
				}
				return result;
			}
		}
		return Reflect.apply(originalRegisterProcessor, this, [name, SoundscaperCoverageProcessor]);
	};
	globalThis[key] = true;
	return true;
})();
//# sourceURL=${WORKLET_COVERAGE_CHECKPOINT_URL}`;

/**
 * Start coverage on service workers from the browser target which creates them.
 *
 * A page target learns about its related service worker only after Chromium has
 * evaluated the worker's top level. Browser-target auto-attach pauses the new
 * target before that first instruction instead.
 *
 * @param {{
 *   rootSession: object,
 *   authenticateWebAssembly?: (input: { bytes: Buffer, url: string }) => Promise<boolean> | boolean,
 *   keepUrl?: (url: string) => boolean,
 *   captureSource?: (url: string) => boolean,
 *   openTargetSession?: (rootSession: object, sessionId: string) => object,
 *   targetTypes?: readonly string[],
 * }} options
 */
export function createBrowserServiceWorkerCoverageCollector({
	authenticateWebAssembly,
	rootSession,
	keepUrl = () => true,
	captureSource = keepUrl,
	openTargetSession,
	targetTypes = DEFAULT_TARGET_TYPES,
}) {
	if (!rootSession || typeof rootSession.on !== 'function' || typeof rootSession.send !== 'function') {
		throw new TypeError('Service-worker coverage requires a browser CDP session.');
	}
	if (typeof openTargetSession !== 'function') {
		throw new TypeError('Service-worker coverage requires a paused-target session adapter.');
	}
	if (typeof keepUrl !== 'function' || typeof captureSource !== 'function') {
		throw new TypeError('Worker coverage URL and source filters must be functions.');
	}
	const coveredTargetTypes = new Set(targetTypes);
	if (coveredTargetTypes.size === 0 || [...coveredTargetTypes].some((type) => (
		typeof type !== 'string' || type === ''
	))) {
		throw new TypeError('Worker coverage requires at least one target type.');
	}
	const targetFilter = Object.freeze([
		...[...coveredTargetTypes].map((type) => Object.freeze({ type })),
		Object.freeze({ exclude: true }),
	]);
	let attached = false;
	let finished = false;
	let rootClosed = false;
	const failures = [];
	const pending = [];
	const recorders = new Map();

	const onAttached = ({ sessionId, targetInfo, waitingForDebugger }) => {
		const type = targetInfo?.type;
		if (finished || !coveredTargetTypes.has(type) || typeof sessionId !== 'string') return;
		let session;
		try {
			session = openTargetSession(rootSession, sessionId);
		} catch (error) {
			failures.push(error);
			return;
		}
		const recorder = {
			active: true,
			cdpState: createCdpJavaScriptCoverageState({ authenticateWebAssembly }),
			coverageHookScriptIds: new Set(),
			session,
			sources: new Map(),
			taken: [],
			type,
			waitingForDebugger: waitingForDebugger === true,
		};
		recorders.set(sessionId, recorder);
		session.on('close', () => { recorder.active = false; });
		attachCdpExecutionContextLifecycle({
			onFailure: (error) => failures.push(error),
			retiredScriptIds: recorder.coverageHookScriptIds,
			session,
			state: recorder.cdpState,
		});
		session.on('Debugger.scriptParsed', (event) => {
			const { scriptId, url } = event;
			const webAssembly = observeCdpScript({ event, session, state: recorder.cdpState });
			if (webAssembly !== null) {
				pending.push(webAssembly.catch((error) => { failures.push(error); }));
				return;
			}
			if (url === WORKLET_COVERAGE_CHECKPOINT_URL) recorder.coverageHookScriptIds.add(String(scriptId));
			if (typeof url !== 'string' || !captureSource(url)) return;
			const work = session.send('Debugger.getScriptSource', { scriptId })
				.then(({ scriptSource }) => {
					if (typeof scriptSource !== 'string') {
						throw new Error(`Browser target supplied no source bytes for ${url}.`);
					}
					const previous = recorder.sources.get(url);
					if (previous !== undefined && previous !== scriptSource) {
						throw new Error(`Browser target supplied conflicting source bytes for ${url}.`);
					}
					recorder.sources.set(url, scriptSource);
				})
				.catch((error) => {
					failures.push(error);
				});
			pending.push(work);
		});
		session.on('Profiler.preciseCoverageDeltaUpdate', ({ result }) => {
			try { appendCdpJavaScriptCoverage(recorder.taken, result, recorder.cdpState); }
			catch (error) { failures.push(error); }
		});
		session.on('Debugger.paused', ({ callFrames }) => {
			const scriptId = String(callFrames?.[0]?.location?.scriptId);
			if (!recorder.coverageHookScriptIds.has(scriptId)) return;
			pending.push(checkpointAndResumeWorklet(recorder).catch((error) => {
				if (recorder.active) failures.push(error);
			}));
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
			callCount: true,
			detailed: true,
		});
		const workletInstrumented = recorder.type === 'worklet'
			? recorder.session.send('Runtime.evaluate', { expression: INSTALL_WORKLET_COVERAGE_CHECKPOINT })
			: Promise.resolve();
		const startup = await Promise.all([
			debuggerEnabled,
			profilerEnabled,
			runtimeEnabled,
			coverageStarted,
			workletInstrumented,
		]);
		if (recorder.type === 'worklet' && startup[4]?.result?.value !== true) {
			throw new Error('Audio worklet coverage checkpoint instrumentation was not installed.');
		}
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
		let result;
		try {
			({ result } = await recorder.session.send('Profiler.takePreciseCoverage'));
		} catch (error) {
			if (recorder.active) throw error;
			return;
		}
		appendCdpJavaScriptCoverage(recorder.taken, result, recorder.cdpState);
	}

	async function checkpointAndResumeWorklet(recorder) {
		let checkpointError = null;
		let result;
		try {
			({ result } = await recorder.session.send('Profiler.takePreciseCoverage'));
		} catch (error) {
			if (recorder.active) checkpointError = error;
		}
		try {
			appendCdpJavaScriptCoverage(recorder.taken, result, recorder.cdpState);
		} catch (error) {
			checkpointError = error;
		}
		let resumeError = null;
		if (recorder.active) {
			try { await recorder.session.send('Debugger.resume'); }
			catch (error) { resumeError = error; }
		}
		if (checkpointError !== null && resumeError !== null) {
			throw new AggregateError(
				[checkpointError, resumeError],
				'Worklet first-process checkpoint and resume both failed.',
			);
		}
		if (checkpointError !== null) throw checkpointError;
		if (resumeError !== null) throw resumeError;
	}

	return Object.freeze({
		collected: () => finished,
		async start() {
			if (attached) throw new Error('Service-worker coverage was already started.');
			attached = true;
			await rootSession.send('Target.setAutoAttach', {
				autoAttach: true,
				flatten: true,
				filter: targetFilter,
				waitForDebuggerOnStart: true,
			});
			await settle();
		},
		settle,
		async checkpoint({ releaseWorklets = false } = {}) {
			if (!attached || finished) return;
			await settle();
			await Promise.all([...recorders.values()].map(checkpointRecorder));
			if (releaseWorklets) {
				for (const recorder of recorders.values()) {
					if (!recorder.active || recorder.type !== 'worklet') continue;
					await recorder.session.detach?.();
					recorder.active = false;
				}
			}
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
				await settle();
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
				for (const entry of recorder.taken) {
					if (typeof entry.url === 'string' && keepUrl(entry.url)) entries.push(entry);
				}
				for (const [url, source] of recorder.sources) {
					if (!keepUrl(url)) continue;
					const previous = sources.get(url);
					if (previous !== undefined && previous !== source) {
						throw new Error(`Browser targets supplied conflicting source bytes for ${url}.`);
					}
					sources.set(url, source);
				}
			}
			const counts = countTargetTypes(recorders.values());
			const paused = countTargetTypes(
				[...recorders.values()].filter(({ waitingForDebugger }) => waitingForDebugger),
			);
			return Object.freeze({
				entries,
				pausedTargetCounts: Object.fromEntries(paused),
				sources,
				targetCounts: Object.fromEntries(counts),
				targetTypes: [...counts.keys()],
			});
		},
	});
}

/** Create a browser-scoped collector from Playwright's Chromium browser. */
export async function createPlaywrightBrowserServiceWorkerCoverageCollector({
	authenticateWebAssembly,
	browser,
	keepUrl = () => true,
	captureSource = keepUrl,
	targetTypes = DEFAULT_TARGET_TYPES,
}) {
	if (!browser || typeof browser.newBrowserCDPSession !== 'function') {
		throw new TypeError('Service-worker coverage requires Playwright Chromium.');
	}
	const implementation = browser?._connection?.toImpl?.(browser);
	const rootSession = createPlaywrightBrowserTargetAdapter(implementation, new Set(targetTypes));
	return createBrowserServiceWorkerCoverageCollector({
		authenticateWebAssembly,
		captureSource,
		keepUrl,
		openTargetSession: (root, sessionId) => root.openTargetSession(sessionId),
		rootSession,
		targetTypes,
	});
}

function createPlaywrightBrowserTargetAdapter(browser, targetTypes) {
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
	const retainedDetaches = new Map();
	const targets = new Map();
	const owners = new Map();
	let closed = false;
	let existingTargetsEmitted = false;
	const forwardClose = () => { events.emit('close'); };

	const installOwner = (owner) => {
		if (!owner || owners.has(owner) || typeof owner.prependListener !== 'function'
			|| typeof owner.createChildSession !== 'function') return;
		const originalCreateChildSession = owner.createChildSession;
		const markTarget = (parameters) => {
			const type = parameters?.targetInfo?.type;
			if (targetTypes.has(type) || type === 'iframe' || type === 'page') {
				targets.set(parameters.sessionId, parameters);
			}
		};
		const forwardDetached = (parameters) => {
			const retained = retainedDetaches.get(parameters?.sessionId);
			if (retained) {
				if (retained.child.detach === retained.suppressedDetach) {
					retained.child.detach = retained.originalDetach;
				}
				retainedDetaches.delete(parameters.sessionId);
			}
			if (children.delete(parameters?.sessionId)) {
				events.emit('Target.detachedFromTarget', parameters);
			}
		};
		const wrappedCreateChildSession = function(sessionId, listener) {
			const child = originalCreateChildSession.call(this, sessionId, listener);
			const target = targets.get(sessionId);
			if (target) {
				targets.delete(sessionId);
				installOwner(child);
				if (targetTypes.has(target.targetInfo?.type)) {
					if (!['service_worker', 'worker'].includes(target.targetInfo.type)
						&& typeof child.detach === 'function') {
						const originalDetach = child.detach;
						const suppressedDetach = async () => {};
						child.detach = suppressedDetach;
						retainedDetaches.set(sessionId, { child, originalDetach, suppressedDetach });
					}
					children.set(sessionId, child);
					events.emit('Target.attachedToTarget', target);
				}
			}
			return child;
		};
		owner.prependListener('Target.attachedToTarget', markTarget);
		owner.on('Target.detachedFromTarget', forwardDetached);
		owner.createChildSession = wrappedCreateChildSession;
		owners.set(owner, {
			forwardDetached,
			markTarget,
			originalCreateChildSession,
			wrappedCreateChildSession,
		});
	};

	installOwner(parent);
	for (const page of browser._crPages?.values?.() ?? []) {
		for (const frameSession of page?._sessions?.values?.() ?? []) {
			installOwner(frameSession?._client);
		}
	}
	browser.on('disconnected', forwardClose);

	const releaseTarget = async (sessionId) => {
		const retained = retainedDetaches.get(sessionId);
		if (!retained) return;
		retainedDetaches.delete(sessionId);
		if (retained.child.detach === retained.suppressedDetach) {
			retained.child.detach = retained.originalDetach;
		}
		await retained.originalDetach.call(retained.child);
	};

	return Object.freeze({
		detach: async () => {
			if (closed) return;
			closed = true;
			browser.off('disconnected', forwardClose);
			ACTIVE_PLAYWRIGHT_ROOTS.delete(parent);
			for (const [owner, interception] of [...owners].reverse()) {
				owner.off('Target.attachedToTarget', interception.markTarget);
				owner.off('Target.detachedFromTarget', interception.forwardDetached);
				if (owner.createChildSession === interception.wrappedCreateChildSession) {
					owner.createChildSession = interception.originalCreateChildSession;
				} else {
					throw new Error('Playwright browser target interception changed during coverage.');
				}
			}
			owners.clear();
			for (const retained of retainedDetaches.values()) {
				if (retained.child.detach === retained.suppressedDetach) {
					retained.child.detach = retained.originalDetach;
				}
				await retained.originalDetach.call(retained.child).catch(() => undefined);
			}
			retainedDetaches.clear();
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
				detach: () => releaseTarget(sessionId),
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
			if (parameters?.autoAttach === true && !existingTargetsEmitted
				&& targetTypes.has('service_worker')) {
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

function countTargetTypes(recorders) {
	const counts = new Map();
	for (const { type } of recorders) counts.set(type, (counts.get(type) ?? 0) + 1);
	return new Map([...counts].sort(([left], [right]) => left.localeCompare(right)));
}
