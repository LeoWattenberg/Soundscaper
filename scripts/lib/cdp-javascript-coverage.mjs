/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

const CDP_WEBASSEMBLY_URL = /^wasm:\/\/wasm\/[a-f\d]{8}$/u;
const BASE64 = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u;
const WEBASSEMBLY_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** The per-CDP-session identity needed to separate JavaScript from Wasm. */
export function createCdpJavaScriptCoverageState() {
	return {
		scriptUrls: new Map(),
		webAssemblyScriptIds: new Set(),
	};
}

/** Record a parsed URL and authenticate it when CDP types it as WebAssembly. */
export function observeCdpScript({ event, session, state }) {
	if (typeof event?.url === 'string' && event.url !== '') {
		state.scriptUrls.set(String(event.scriptId), event.url);
	}
	return captureCdpWebAssemblyScript({
		event,
		session,
		webAssemblyScriptIds: state.webAssemblyScriptIds,
	});
}

/** Take one precise-coverage checkpoint and return JavaScript entries only. */
export async function takeCdpJavaScriptCoverage(session, state) {
	const { result } = await session.send('Profiler.takePreciseCoverage');
	return javaScriptCoverageEntries(result, state.scriptUrls, state.webAssemblyScriptIds);
}

/**
 * Authenticate one CDP script as binary WebAssembly rather than JavaScript.
 *
 * V8 exposes compiled modules through the precise JavaScript coverage stream,
 * but the E2E denominator owns JavaScript only. A URL prefix alone is not an
 * identity: JavaScript can choose its own sourceURL. Require CDP's language
 * type, its exact generated URL grammar, the empty textual-source sentinel,
 * and canonical binary bytes with the WebAssembly magic and version.
 *
 * @param {{
 *   event: { scriptId?: unknown, scriptLanguage?: unknown, url?: unknown },
 *   session: { send(method: string, parameters: object): Promise<unknown> },
 *   webAssemblyScriptIds: Set<string>,
 * }} options
 * @returns {Promise<void> | null}
 */
export function captureCdpWebAssemblyScript({ event, session, webAssemblyScriptIds }) {
	if (event?.scriptLanguage !== 'WebAssembly') return null;
	return (async () => {
		const scriptId = String(event.scriptId ?? '');
		const url = event.url;
		if (scriptId === '' || typeof url !== 'string' || !CDP_WEBASSEMBLY_URL.test(url)) {
			throw new Error(`CDP supplied a noncanonical WebAssembly script URL ${String(url)}.`);
		}
		// Register synchronously before the first await: a navigation checkpoint
		// can take coverage while the source reply is still in flight.
		webAssemblyScriptIds.add(scriptId);
		const source = await session.send('Debugger.getScriptSource', { scriptId });
		if (!authenticatedWebAssemblySource(source)) {
			throw new Error(`CDP supplied no authenticated non-JavaScript WebAssembly bytes for ${url}.`);
		}
	})();
}

/**
 * Restore URLs omitted from target deltas and retain JavaScript entries only.
 *
 * @template {{ scriptId?: unknown, url?: unknown }} Entry
 * @param {Entry[]} entries
 * @param {Map<string, string>} scriptUrls
 * @param {Set<string>} webAssemblyScriptIds
 * @returns {Entry[]}
 */
export function javaScriptCoverageEntries(entries, scriptUrls, webAssemblyScriptIds) {
	const retained = [];
	for (const entry of entries) {
		const scriptId = String(entry.scriptId ?? '');
		const parsedUrl = scriptUrls.get(scriptId);
		const candidate = typeof parsedUrl === 'string' && parsedUrl !== entry.url
			? { ...entry, url: parsedUrl }
			: entry;
		const url = candidate.url;
		if (webAssemblyScriptIds.has(scriptId)) {
			if (typeof url !== 'string' || !CDP_WEBASSEMBLY_URL.test(url)) {
				throw new Error(`CDP coverage carried a noncanonical WebAssembly script URL ${String(url)}.`);
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

function authenticatedWebAssemblySource(value) {
	if (!value || typeof value !== 'object' || value.scriptSource !== ''
		|| typeof value.bytecode !== 'string' || value.bytecode === ''
		|| !BASE64.test(value.bytecode)) return false;
	const bytes = Buffer.from(value.bytecode, 'base64');
	return bytes.toString('base64') === value.bytecode
		&& bytes.byteLength >= WEBASSEMBLY_HEADER.byteLength
		&& bytes.subarray(0, WEBASSEMBLY_HEADER.byteLength).equals(WEBASSEMBLY_HEADER);
}
