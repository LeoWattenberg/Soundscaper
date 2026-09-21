/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

const CDP_WEBASSEMBLY_URL = /^wasm:\/\/wasm\/[a-f\d]{8}$/u;
const BROWSER_INTERNAL_PROTOCOLS = new Set([
	'about:', 'chrome:', 'chrome-error:', 'chrome-extension:',
	'chrome-search:', 'chrome-untrusted:', 'devtools:', 'extensions:',
]);
const WEBASSEMBLY_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** The per-CDP-session identity needed to separate JavaScript from Wasm. */
export function createCdpJavaScriptCoverageState({ authenticateWebAssembly } = {}) {
	return {
		authenticateWebAssembly,
		excludedJavaScriptScriptIds: new Set(),
		scriptIdentities: new Map(),
		scriptUrls: new Map(),
		webAssemblyScriptUrls: new Map(),
	};
}

/** Retire every script identity owned by one destroyed execution context. */
export function retireCdpExecutionContext(state, executionContextId) {
	if (!Number.isSafeInteger(executionContextId) || executionContextId < 0) {
		throw new TypeError('CDP supplied an invalid destroyed execution context.');
	}
	const retired = [];
	for (const [scriptId, identity] of state.scriptIdentities) {
		if (identity.executionContextId !== executionContextId) continue;
		state.scriptIdentities.delete(scriptId);
		state.excludedJavaScriptScriptIds.delete(scriptId);
		state.scriptUrls.delete(scriptId);
		state.webAssemblyScriptUrls.delete(scriptId);
		retired.push(scriptId);
	}
	return retired;
}

/** Retire every script identity after CDP clears an execution-context generation. */
export function clearCdpExecutionContexts(state) {
	const retired = [...state.scriptIdentities.keys()];
	state.scriptIdentities.clear();
	state.excludedJavaScriptScriptIds.clear();
	state.scriptUrls.clear();
	state.webAssemblyScriptUrls.clear();
	return retired;
}

/** Bind script identity and optional instrumentation IDs to Runtime lifecycle events. */
export function attachCdpExecutionContextLifecycle({
	onFailure,
	retiredScriptIds = null,
	session,
	state,
}) {
	if (typeof session?.on !== 'function' || typeof onFailure !== 'function'
		|| (retiredScriptIds !== null && (typeof retiredScriptIds.delete !== 'function'
			|| typeof retiredScriptIds.clear !== 'function'))) {
		throw new TypeError('CDP execution-context lifecycle received invalid collectors.');
	}
	session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
		try {
			for (const scriptId of retireCdpExecutionContext(state, executionContextId)) {
				retiredScriptIds?.delete(scriptId);
			}
		} catch (error) {
			onFailure(error);
		}
	});
	session.on('Runtime.executionContextsCleared', () => {
		clearCdpExecutionContexts(state);
		retiredScriptIds?.clear();
	});
}

/** Bank a synchronously discovered CDP failure without an unhandled-rejection race. */
export function bankRejectedCdpCoverageWork(pending, error) {
	const failure = Promise.reject(error);
	void failure.catch(() => undefined);
	pending.push(failure);
}

/** Read text while a target lives; a target teardown makes only its rejected read irrelevant. */
export async function readCdpScriptSourceUntilTeardown({ isActive, scriptId, session }) {
	try { return await session.send('Debugger.getScriptSource', { scriptId }); }
	catch (error) {
		if (isActive()) throw error;
		return null;
	}
}

/** Trust browser-owned URL schemes only when the parser says no sourceURL supplied them. */
export function isBrowserInternalCdpScript(event) {
	if (event?.hasSourceURL === true || typeof event?.url !== 'string') return false;
	try { return BROWSER_INTERNAL_PROTOCOLS.has(new URL(event.url).protocol); }
	catch { return false; }
}

/** Exclude one authenticated browser-owned JavaScript identity from the profile. */
export function excludeCdpJavaScriptCoverage(state, scriptId) {
	state.excludedJavaScriptScriptIds.add(String(scriptId));
}

/** Record a parsed URL and authenticate it when CDP types it as WebAssembly. */
export function observeCdpScript({ event, session, state }) {
	return captureCdpWebAssemblyScript({
		authenticateWebAssembly: state.authenticateWebAssembly,
		event,
		scriptIdentities: state.scriptIdentities,
		scriptUrls: state.scriptUrls,
		session,
		webAssemblyScriptUrls: state.webAssemblyScriptUrls,
	});
}

/** Take one precise-coverage checkpoint and return JavaScript entries only. */
export async function takeCdpJavaScriptCoverage(session, state) {
	const { result } = await session.send('Profiler.takePreciseCoverage');
	return javaScriptCoverageEntries(
		result,
		state.scriptUrls,
		state.webAssemblyScriptUrls,
		state.excludedJavaScriptScriptIds,
	);
}

/** Normalize and append one optional CDP precise-coverage result. */
export function appendCdpJavaScriptCoverage(target, result, state) {
	if (!Array.isArray(result)) return;
	target.push(...javaScriptCoverageEntries(
		result,
		state.scriptUrls,
		state.webAssemblyScriptUrls,
		state.excludedJavaScriptScriptIds,
	));
}

/**
 * Authenticate one CDP script as binary WebAssembly rather than JavaScript.
 *
 * V8 may expose compiled modules through the precise JavaScript coverage stream,
 * but the E2E denominator owns JavaScript only. A URL prefix alone is not an
 * identity: JavaScript can choose its own sourceURL. Require CDP's language
 * type, either its generated URL grammar or realm-specific caller
 * authentication, the empty textual-source sentinel, and canonical binary
 * bytes with the WebAssembly magic and version.
 *
 * @param {{
 *   event: { executionContextId?: unknown, scriptId?: unknown, scriptLanguage?: unknown, url?: unknown },
 *   scriptIdentities: Map<string, { executionContextId: number | null, language: string, url: unknown }>,
 *   scriptUrls: Map<string, string>,
 *   session: { send(method: string, parameters: object): Promise<unknown> },
 *   authenticateWebAssembly?: (input: { bytes: Buffer, url: string }) => Promise<boolean> | boolean,
 *   webAssemblyScriptUrls: Map<string, string>,
 * }} options
 * @returns {Promise<void> | null}
 */
export function captureCdpWebAssemblyScript({
	authenticateWebAssembly,
	event,
	scriptIdentities,
	scriptUrls,
	session,
	webAssemblyScriptUrls,
}) {
	const scriptId = String(event?.scriptId ?? '');
	const url = event?.url;
	const language = event?.scriptLanguage === 'WebAssembly' ? 'WebAssembly' : 'JavaScript';
	const executionContextId = event?.executionContextId === undefined
		? null : event.executionContextId;
	if (executionContextId !== null && (!Number.isSafeInteger(executionContextId)
		|| executionContextId < 0)) {
		return Promise.reject(new Error(
			`CDP supplied an invalid execution context for script ${scriptId}.`,
		));
	}
	const previousIdentity = scriptIdentities.get(scriptId);
	if (previousIdentity !== undefined && (previousIdentity.url !== url
		|| previousIdentity.language !== language
		|| previousIdentity.executionContextId !== executionContextId)) {
		return Promise.reject(new Error(
			`CDP rebound script ${scriptId} from ${previousIdentity.language} ${String(previousIdentity.url)} to ${language} ${String(url)}.`,
		));
	}
	if (previousIdentity === undefined) {
		scriptIdentities.set(scriptId, { executionContextId, language, url });
	}
	if (typeof url === 'string' && url !== '') scriptUrls.set(scriptId, url);
	if (language !== 'WebAssembly') return null;
	return (async () => {
		const generated = typeof url === 'string' && CDP_WEBASSEMBLY_URL.test(url);
		if (scriptId === '' || typeof url !== 'string' || (!generated
			&& typeof authenticateWebAssembly !== 'function')) {
			throw new Error(`CDP supplied a noncanonical WebAssembly script URL ${String(url)}.`);
		}
		const previous = webAssemblyScriptUrls.get(scriptId);
		if (previous !== undefined && previous !== url) {
			throw new Error(`CDP rebound WebAssembly script ${scriptId} from ${previous} to ${url}.`);
		}
		// Register synchronously before the first await: a navigation checkpoint
		// can take coverage while the source reply is still in flight.
		webAssemblyScriptUrls.set(scriptId, url);
		const source = await session.send('Debugger.getScriptSource', { scriptId });
		const bytes = authenticatedWebAssemblyBytes(source);
		if (bytes === null) {
			throw new Error(`CDP supplied no authenticated non-JavaScript WebAssembly bytes for ${url}.`);
		}
		if (!generated) {
			const admission = await authenticateWebAssembly({ bytes, url });
			if (admission !== true) throw new Error(`CDP WebAssembly at ${url} was not authenticated.`);
		}
	})();
}

/**
 * Restore URLs omitted from target deltas and retain JavaScript entries only.
 *
 * @template {{ scriptId?: unknown, url?: unknown }} Entry
 * @param {Entry[]} entries
 * @param {Map<string, string>} scriptUrls
 * @param {Map<string, string>} webAssemblyScriptUrls
 * @param {Set<string>} [excludedJavaScriptScriptIds]
 * @returns {Entry[]}
 */
export function javaScriptCoverageEntries(
	entries,
	scriptUrls,
	webAssemblyScriptUrls,
	excludedJavaScriptScriptIds,
) {
	const retained = [];
	for (const entry of entries) {
		const scriptId = String(entry.scriptId ?? '');
		const parsedUrl = scriptUrls.get(scriptId);
		if (excludedJavaScriptScriptIds?.has(scriptId)) {
			if (typeof parsedUrl !== 'string' || parsedUrl === '') {
				throw new Error(`CDP coverage lost the authenticated browser-internal script URL for ${scriptId}.`);
			}
			if (entry.url !== '' && entry.url !== undefined && entry.url !== parsedUrl) {
				throw new Error(`CDP coverage carried a different browser-internal script URL ${String(entry.url)}.`);
			}
			continue;
		}
		const candidate = typeof parsedUrl === 'string' && parsedUrl !== entry.url
			? { ...entry, url: parsedUrl }
			: entry;
		const url = candidate.url;
		const webAssemblyUrl = webAssemblyScriptUrls.get(scriptId);
		if (webAssemblyUrl !== undefined) {
			if (entry.url !== '' && entry.url !== undefined && entry.url !== webAssemblyUrl) {
				throw new Error(`CDP coverage carried a different WebAssembly script URL ${String(entry.url)}.`);
			}
			if (url !== webAssemblyUrl) {
				throw new Error(`CDP coverage lost the authenticated WebAssembly script URL ${webAssemblyUrl}.`);
			}
			continue;
		}
		if (typeof url === 'string' && /^wasm:/iu.test(url)) {
			throw new Error(`CDP coverage carried ${url} without protocol WebAssembly attestation.`);
		}
		retained.push(candidate);
	}
	return retained;
}

function authenticatedWebAssemblyBytes(value) {
	if (!value || typeof value !== 'object' || value.scriptSource !== ''
		|| typeof value.bytecode !== 'string' || value.bytecode === ''
		|| value.bytecode.length % 4 !== 0) return null;
	const bytes = Buffer.from(value.bytecode, 'base64');
	return bytes.toString('base64') === value.bytecode
		&& bytes.byteLength >= WEBASSEMBLY_HEADER.byteLength
		&& bytes.subarray(0, WEBASSEMBLY_HEADER.byteLength).equals(WEBASSEMBLY_HEADER)
		? bytes : null;
}
