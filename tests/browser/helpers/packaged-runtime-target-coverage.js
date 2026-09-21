/* SPDX-License-Identifier: AGPL-3.0-only */

import { EventEmitter } from 'node:events';

import {
	INSTALL_WORKLET_COVERAGE_CHECKPOINT,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from '../../../scripts/lib/browser-service-worker-coverage.mjs';
import {
	attachCdpExecutionContextLifecycle,
	bankRejectedCdpCoverageWork,
	createCdpJavaScriptCoverageState,
	javaScriptCoverageEntries,
	observeCdpScript,
} from '../../../scripts/lib/cdp-javascript-coverage.mjs';
import {
	installNavigationCoverageCheckpoints,
	installPageOperationCoverageCheckpoints,
} from '../../../scripts/lib/navigation-coverage-checkpoint.mjs';

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
	authenticateWebAssembly,
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

	async function checkpointAll(reason) {
		await Promise.all(recorders.map((recorder) => recorder.checkpoint()));
		if (reason !== 'audio-context-close') return;
		for (const recorder of recorders) {
			if (!recorder.active || recorder.type !== 'worklet') continue;
			await recorder.session.detach?.();
			recorder.active = false;
		}
	}

	async function settlePendingWork() {
		while (pending.length > 0) await Promise.all(pending.splice(0, pending.length));
	}

	async function instrument(session, type, waitingForDebugger, ownerPage = null) {
		const recorder = {
			active: true,
			cdpState: createCdpJavaScriptCoverageState({ authenticateWebAssembly }),
			checkpoint: null,
			checkpointTail: Promise.resolve(),
			coverageHookScriptIds: new Set(),
			navigationCheckpoints: null,
			page: ownerPage,
			pageOperationCheckpoints: null,
			session,
			sources: new Map(),
			taken: [],
			type,
		};
		recorders.push(recorder);
		targetTypes.add(type);
		targetCounts.set(type, (targetCounts.get(type) ?? 0) + 1);
		if (waitingForDebugger) pausedTargetCounts.set(type, (pausedTargetCounts.get(type) ?? 0) + 1);
		session.on('detached', () => { recorder.active = false; });
		attachCdpExecutionContextLifecycle({
			onFailure: (error) => bankRejectedCdpCoverageWork(pending, error),
			retiredScriptIds: recorder.coverageHookScriptIds,
			session,
			state: recorder.cdpState,
		});
		session.on('Debugger.scriptParsed', (event) => {
			const { scriptId, url } = event;
			const webAssembly = observeCdpScript({ event, session, state: recorder.cdpState });
			if (webAssembly !== null) {
				pending.push(webAssembly);
				return;
			}
			if (url === WORKLET_COVERAGE_CHECKPOINT_URL) {
				recorder.coverageHookScriptIds.add(String(scriptId));
			}
			if (!keepUrl(url)) return;
			pending.push(session.send('Debugger.getScriptSource', { scriptId })
				.then(({ scriptSource }) => {
					if (typeof scriptSource !== 'string') {
						throw new Error(`Packaged coverage captured no source bytes for ${url}.`);
					}
					const previous = recorder.sources.get(url);
					if (previous !== undefined && previous !== scriptSource) {
						throw new Error(`Packaged coverage captured conflicting source bytes for ${url}.`);
					}
					recorder.sources.set(url, scriptSource);
				}));
		});
		session.on('Profiler.preciseCoverageDeltaUpdate', ({ result }) => {
			if (Array.isArray(result)) {
				recorder.taken.push(...javaScriptCoverageEntries(
					result,
					recorder.cdpState.scriptUrls,
					recorder.cdpState.webAssemblyScriptUrls,
				));
			}
		});
		session.on('Debugger.paused', ({ callFrames }) => {
			const scriptId = String(callFrames?.[0]?.location?.scriptId);
			if (!recorder.coverageHookScriptIds.has(scriptId)) return;
			pending.push(checkpointAndResumeWorklet(recorder));
		});
		recorder.checkpoint = () => {
			recorder.checkpointTail = recorder.checkpointTail.then(async () => {
				if (!recorder.active) return;
				try {
					const { result } = await session.send('Profiler.takePreciseCoverage');
					recorder.taken.push(...javaScriptCoverageEntries(
						result,
						recorder.cdpState.scriptUrls,
						recorder.cdpState.webAssemblyScriptUrls,
					));
				} catch (error) {
					if (recorder.active) throw error;
				}
			});
			return recorder.checkpointTail;
		};
		const debuggerEnabled = session.send('Debugger.enable');
		const profilerEnabled = session.send('Profiler.enable');
		const runtimeEnabled = session.send('Runtime.enable');
		const coverageStarted = session.send('Profiler.startPreciseCoverage', {
			allowTriggeredUpdates: true,
			callCount: true,
			detailed: true,
		});
		const workletInstrumented = type === 'worklet'
			? session.send('Runtime.evaluate', { expression: INSTALL_WORKLET_COVERAGE_CHECKPOINT })
			: Promise.resolve();
		const startup = await Promise.all([
			debuggerEnabled,
			profilerEnabled,
			runtimeEnabled,
			coverageStarted,
			workletInstrumented,
		]);
		if (type === 'worklet' && startup[4]?.result?.value !== true) {
			throw new Error('Audio worklet coverage checkpoint instrumentation was not installed.');
		}
		attachChildren(session);
		await session.send('Target.setAutoAttach', AUTO_ATTACH_OPTIONS);
		if (ownerPage !== null) {
			await session.send('Page.enable');
			recorder.navigationCheckpoints = await installNavigationCoverageCheckpoints({
				checkpoint: checkpointAll,
				session,
			});
			recorder.pageOperationCheckpoints = installPageOperationCoverageCheckpoints({
				checkpoint: checkpointAll,
				page: ownerPage,
			});
		}
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
			await checkpointAll();
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
			await checkpointAll();
		},
		async collect() {
			for (const recorder of [...recorders].reverse()) {
				await recorder.navigationCheckpoints?.settle();
				recorder.pageOperationCheckpoints?.dispose();
				if (recorder.active && recorder.page?.isClosed?.() !== true) {
					try {
						const { result } = await recorder.session.send('Profiler.takePreciseCoverage');
						recorder.taken.push(...javaScriptCoverageEntries(
							result,
							recorder.cdpState.scriptUrls,
							recorder.cdpState.webAssemblyScriptUrls,
						));
						await recorder.navigationCheckpoints?.dispose();
						await recorder.session.send('Profiler.stopPreciseCoverage');
						await recorder.session.send('Profiler.disable');
						await recorder.session.send('Debugger.disable');
					} catch (error) {
						if (recorder.active && recorder.page?.isClosed?.() !== true) throw error;
					}
				}
			}
			await settlePendingWork();
			for (const session of nestedSessions.reverse()) await session.detach().catch(() => undefined);
			await rootSession.detach().catch((error) => {
				if (page.isClosed?.() !== true) throw error;
			});
			const entries = [];
			const sources = new Map();
			for (const recorder of recorders) {
				entries.push(...recorder.taken);
				for (const [url, source] of recorder.sources) {
					const previous = sources.get(url);
					if (previous !== undefined && previous !== source) {
						throw new Error(`Packaged coverage captured conflicting source bytes for ${url}.`);
					}
					sources.set(url, source);
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

async function checkpointAndResumeWorklet(recorder) {
	let checkpointError = null;
	try { await recorder.checkpoint(); } catch (error) { checkpointError = error; }
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
