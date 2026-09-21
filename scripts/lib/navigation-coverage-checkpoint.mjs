/* SPDX-License-Identifier: AGPL-3.0-only */

const HOOK_KEY = 'org.soundscaper.coverage.navigation-checkpoint';
const HOOK_URL = 'soundscaper-coverage://navigation-checkpoint.js';
const INSTALL_HOOK_SOURCE = `(() => {
	const key = Symbol.for(${JSON.stringify(HOOK_KEY)});
	if (globalThis[key]?.installed === true) return;
	function __soundscaperCoverageBeforeUnload() { debugger; }
	const state = { beforeUnload: __soundscaperCoverageBeforeUnload, installed: true, restorations: [] };
	const wrappedPrototypes = new Set();
	function wrapMethod(prototype, name, createWrapper) {
		if (prototype === undefined || wrappedPrototypes.has(prototype)) return;
		const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
		if (typeof descriptor?.value !== 'function') return;
		const wrapper = createWrapper(descriptor.value);
		Object.defineProperty(prototype, name, { ...descriptor, value: wrapper });
		state.restorations.push({ descriptor, name, prototype, wrapper });
		wrappedPrototypes.add(prototype);
	}
	wrapMethod(globalThis.Worker?.prototype, 'terminate', (original) => (
		function __soundscaperCoverageTerminateWorker(...args) {
			debugger;
			return Reflect.apply(original, this, args);
		}
	));
	for (const constructor of [globalThis.AudioContext, globalThis.webkitAudioContext]) {
		wrapMethod(constructor?.prototype, 'close', (original) => (
			function __soundscaperCoverageCloseAudioContext(...args) {
				debugger;
				return Reflect.apply(original, this, args);
			}
		));
	}
	wrappedPrototypes.clear();
	for (const constructor of [globalThis.OfflineAudioContext, globalThis.webkitOfflineAudioContext]) {
		wrapMethod(constructor?.prototype, 'startRendering', (original) => (
			function __soundscaperCoverageStartOfflineRendering(...args) {
				const rendering = Reflect.apply(original, this, args);
				let active = true;
				let timer;
				const checkpoint = () => {
					if (!active) return;
					debugger;
					timer = setTimeout(checkpoint, 4);
				};
				const finish = () => {
					if (!active) return;
					active = false;
					clearTimeout(timer);
				};
				checkpoint();
				Promise.resolve(rendering).then(finish, finish);
				return rendering;
			}
		));
	}
	globalThis[key] = state;
	addEventListener('beforeunload', __soundscaperCoverageBeforeUnload, { capture: true });
})();
//# sourceURL=${HOOK_URL}`;
const REMOVE_HOOK_SOURCE = `(() => {
	const key = Symbol.for(${JSON.stringify(HOOK_KEY)});
	const state = globalThis[key];
	if (state?.installed !== true) return;
	removeEventListener('beforeunload', state.beforeUnload, { capture: true });
	for (const { descriptor, name, prototype, wrapper } of [...state.restorations].reverse()) {
		if (prototype[name] === wrapper) Object.defineProperty(prototype, name, descriptor);
	}
	delete globalThis[key];
})();`;
const PAGE_OPERATIONS = Object.freeze(['close', 'goBack', 'goForward', 'goto', 'reload', 'setContent']);

/**
 * Drain coverage before Playwright asks Chromium to replace or close a page.
 *
 * Dedicated workers can be terminated before the document's `beforeunload`
 * event, while `Page.close({ runBeforeUnload: false })` deliberately skips the
 * event altogether. Wrapping the public page operations closes both gaps. The
 * in-document hook below remains necessary for renderer-initiated navigation.
 *
 * @param {{ checkpoint: (reason?: string) => Promise<void>, page: Record<string, any> }} options
 */
export function installPageOperationCoverageCheckpoints({ checkpoint, page }) {
	if (typeof checkpoint !== 'function') throw new TypeError('Page-operation coverage requires a checkpoint callback.');
	if (!page || typeof page !== 'object') throw new TypeError('Page-operation coverage requires a page.');

	const installed = [];
	for (const operation of PAGE_OPERATIONS) {
		const original = page[operation];
		if (typeof original !== 'function') continue;
		const wrapped = async function(...arguments_) {
			await checkpoint();
			return Reflect.apply(original, this, arguments_);
		};
		page[operation] = wrapped;
		installed.push({ operation, original, wrapped });
	}

	let disposed = false;
	return Object.freeze({
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const { operation, original, wrapped } of installed) {
				if (page[operation] === wrapped) page[operation] = original;
			}
		},
	});
}

/**
 * Pause a document before it unloads or terminates a worker and checkpoint V8.
 *
 * Chromium discards an old document's precise-coverage ranges before
 * `Runtime.executionContextsCleared`. The injected debugger pause runs inside
 * the old context, so the caller can drain the profiler before letting the
 * navigation continue. Dedicated-worker ranges likewise disappear before a
 * detach event, so the same hook pauses a page before `Worker.terminate()`.
 * It is installed in the current document and every later document.
 *
 * The caller must enable the Runtime, Page, and Debugger domains first.
 *
 * @param {{
 *   checkpoint: (reason?: string) => Promise<void>,
 *   session: {
 *     off?: (event: string, listener: (value: any) => void) => void,
 *     on: (event: string, listener: (value: any) => void) => void,
 *     send: (method: string, parameters?: object) => Promise<any>,
 *   },
 * }} options
 */
export async function installNavigationCoverageCheckpoints({ checkpoint, session }) {
	if (typeof checkpoint !== 'function') throw new TypeError('Navigation coverage requires a checkpoint callback.');
	if (!session || typeof session.send !== 'function' || typeof session.on !== 'function') {
		throw new TypeError('Navigation coverage requires a CDP session.');
	}

	const failures = [];
	const hookScriptIds = new Set();
	const pending = new Set();
	let disposed = false;

	const bank = (work) => {
		let tracked;
		tracked = work
			.catch((error) => { failures.push(error); })
			.finally(() => { pending.delete(tracked); });
		pending.add(tracked);
	};
	const onScriptParsed = ({ scriptId, url }) => {
		if (url === HOOK_URL) hookScriptIds.add(String(scriptId));
	};
	const onPaused = ({ callFrames }) => {
		const frame = callFrames?.[0];
		const scriptId = frame?.location?.scriptId;
		const isNavigationHook = hookScriptIds.has(String(scriptId));
		const checkpointWork = isNavigationHook
			? () => checkpoint(checkpointReason(frame?.functionName))
			: null;
		bank(checkpointAndResume(session, checkpointWork));
	};

	session.on('Debugger.scriptParsed', onScriptParsed);
	session.on('Debugger.paused', onPaused);
	let identifier;
	try {
		({ identifier } = await session.send('Page.addScriptToEvaluateOnNewDocument', {
			source: INSTALL_HOOK_SOURCE,
		}));
		await session.send('Runtime.evaluate', { expression: INSTALL_HOOK_SOURCE });
	} catch (error) {
		session.off?.('Debugger.scriptParsed', onScriptParsed);
		session.off?.('Debugger.paused', onPaused);
		throw error;
	}

	async function settle() {
		while (pending.size > 0) await Promise.all([...pending]);
		if (failures.length === 1) throw failures.shift();
		if (failures.length > 1) {
			throw new AggregateError(failures.splice(0), 'Navigation coverage checkpoints failed.');
		}
	}

	return Object.freeze({
		async dispose() {
			if (disposed) return;
			disposed = true;
			let settleFailure = null;
			try { await settle(); } catch (error) { settleFailure = error; }
			let cleanupFailure = null;
			try {
				await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
				await session.send('Runtime.evaluate', { expression: REMOVE_HOOK_SOURCE });
			} catch (error) {
				cleanupFailure = error;
			} finally {
				session.off?.('Debugger.scriptParsed', onScriptParsed);
				session.off?.('Debugger.paused', onPaused);
			}
			if (settleFailure !== null && cleanupFailure !== null) {
				throw new AggregateError(
					[settleFailure, cleanupFailure],
					'Navigation coverage checkpoint and cleanup both failed.',
				);
			}
			if (settleFailure !== null) throw settleFailure;
			if (cleanupFailure !== null) throw cleanupFailure;
		},
		settle,
	});
}

function checkpointReason(functionName) {
	switch (functionName) {
		case '__soundscaperCoverageBeforeUnload': return 'beforeunload';
		case '__soundscaperCoverageCloseAudioContext': return 'audio-context-close';
		case '__soundscaperCoverageTerminateWorker': return 'worker-terminate';
		case 'checkpoint': return 'offline-rendering';
		default: return 'lifecycle';
	}
}

async function checkpointAndResume(session, checkpoint) {
	let checkpointFailure = null;
	if (checkpoint !== null) {
		try { await checkpoint(); } catch (error) { checkpointFailure = error; }
	}
	let resumeFailure = null;
	try { await session.send('Debugger.resume'); } catch (error) { resumeFailure = error; }
	if (checkpointFailure !== null && resumeFailure !== null) {
		throw new AggregateError(
			[checkpointFailure, resumeFailure],
			'Navigation coverage checkpoint and resume both failed.',
		);
	}
	if (checkpointFailure !== null) throw checkpointFailure;
	if (resumeFailure !== null) throw resumeFailure;
}
