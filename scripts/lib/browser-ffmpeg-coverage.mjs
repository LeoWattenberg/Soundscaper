/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { revisionBoundSource } from './e2e-coverage-integrity.mjs';

const MANIFEST_PATH = 'config/ffmpeg-runtime-manifest.json';
const POLICY_PATH = 'config/ffmpeg-runtime-publication-policy.json';
const CORE_NAME = 'ffmpeg-core.js';
const CORE_CONTENT_TYPE = 'text/javascript; charset=utf-8';
const WASM_NAME = 'ffmpeg-core.wasm';
const WASM_CONTENT_TYPE = 'application/wasm';

/** Load the one canonical browser FFmpeg script identity from committed policy. */
export function browserFfmpegCoverageContract(repositoryRoot, sourceRevision) {
	const manifestSource = sourceAtRevision(repositoryRoot, sourceRevision, MANIFEST_PATH);
	const policySource = sourceAtRevision(repositoryRoot, sourceRevision, POLICY_PATH);
	const manifest = parseJson(manifestSource.text, 'FFmpeg runtime manifest');
	const policyBytes = manifestBuffer(policySource.bytes);
	let policy;
	try { policy = JSON.parse(policyBytes.toString('utf8')); }
	catch (error) { throw new Error('The FFmpeg runtime publication policy is not readable JSON.', { cause: error }); }
	const policyPin = manifest?.publication?.policy;
	const descriptors = Array.isArray(manifest?.runtime?.files) ? manifest.runtime.files : [];
	const policyDescriptors = Array.isArray(policy?.runtimeFiles) ? policy.runtimeFiles : [];
	const javascript = uniqueDescriptor(descriptors, CORE_NAME);
	const javascriptPolicy = uniqueDescriptor(policyDescriptors, CORE_NAME);
	const wasm = uniqueDescriptor(descriptors, WASM_NAME);
	const wasmPolicy = uniqueDescriptor(policyDescriptors, WASM_NAME);
	if (manifest?.schemaVersion !== 1 || policy?.schemaVersion !== 1
		|| typeof manifest?.package?.version !== 'string' || manifest.package.version === ''
		|| manifest.runtime?.publicPrefix !== `runtime/ffmpeg/${manifest.package.version}`
		|| policy.publicOrigin !== 'https://assets.soundscaper.org'
		|| policy.publicPrefix !== manifest.runtime.publicPrefix
		|| policyPin?.path !== POLICY_PATH || policyPin.byteLength !== policyBytes.byteLength
		|| policyPin.sha256 !== hash(policyBytes)
		|| javascript?.contentType !== CORE_CONTENT_TYPE
		|| javascriptPolicy?.contentType !== CORE_CONTENT_TYPE
		|| wasm?.contentType !== WASM_CONTENT_TYPE || wasmPolicy?.contentType !== WASM_CONTENT_TYPE
		|| !pinnedDescriptor(javascript) || !pinnedDescriptor(wasm)) {
		throw new Error('The browser FFmpeg coverage contract is invalid.');
	}
	const baseUrl = `${policy.publicOrigin}/${manifest.runtime.publicPrefix}`;
	return Object.freeze({
		byteLength: javascript.byteLength,
		sha256: javascript.sha256,
		url: `${baseUrl}/${CORE_NAME}`,
		wasm: Object.freeze({
			byteLength: wasm.byteLength,
			sha256: wasm.sha256,
			url: `${baseUrl}/${WASM_NAME}`,
		}),
	});
}

/** Retain exact external runtime bytes only at the canonical production URL. */
export function retainedBrowserFfmpegCoverageScript(url, source, contract) {
	if (isBrowserFfmpegWasmCoverageSource(url, source, contract)) {
		return {
			coverageUrl: url,
			path: '/__soundscaper_dynamic__/ffmpeg-core.wasm',
			retainSource: true,
			source,
		};
	}
	if (url !== contract.url) return null;
	attestSource(source, contract);
	return {
		coverageUrl: url,
		path: '/__soundscaper_dynamic__/ffmpeg-core.js',
		retainSource: true,
		source,
	};
}

/** Exclude the external runtime only after reauthenticating raw profile bytes. */
export function isBrowserFfmpegCoverage({ contract, entry, profile }) {
	if (isBrowserFfmpegWasmCoverageSource(
		entry?.url,
		profile?.['script-source-cache']?.[entry?.url],
		contract,
	)) return true;
	if (entry?.url !== contract.url) return false;
	attestSource(profile?.['script-source-cache']?.[entry.url], contract);
	return true;
}

/** Authenticate the source-less Wasm scriptParsed record even when V8 emits no ranges. */
export function isBrowserFfmpegWasmCoverageSource(url, source, contract) {
	if (url !== contract.wasm.url) return false;
	// CDP exposes no textual source for a WebAssembly module: the exact empty
	// Debugger source is its type sentinel. The revision-bound manifest and
	// publication policy bind the only raw URL that may use that sentinel.
	if (source !== '') {
		throw new Error('Browser coverage did not preserve the expected empty source for pinned FFmpeg Wasm.');
	}
	return true;
}

function attestSource(source, contract) {
	if (typeof source !== 'string') {
		throw new Error('Browser coverage captured no source bytes for the pinned FFmpeg JavaScript.');
	}
	const bytes = Buffer.from(source, 'utf8');
	if (bytes.byteLength !== contract.byteLength || hash(bytes) !== contract.sha256) {
		throw new Error('Browser coverage FFmpeg JavaScript does not match its committed runtime pin.');
	}
}

function sourceAtRevision(repositoryRoot, sourceRevision, path) {
	if (sourceRevision !== undefined) return revisionBoundSource(repositoryRoot, sourceRevision, path);
	const bytes = readFileSync(resolve(repositoryRoot, path));
	return { bytes, text: bytes.toString('utf8') };
}

function uniqueDescriptor(descriptors, name) {
	const matches = descriptors.filter((entry) => entry?.name === name);
	return matches.length === 1 ? matches[0] : null;
}

function pinnedDescriptor(descriptor) {
	return Number.isSafeInteger(descriptor?.byteLength) && descriptor.byteLength > 0
		&& typeof descriptor.sha256 === 'string' && /^[a-f\d]{64}$/u.test(descriptor.sha256);
}

function parseJson(source, label) {
	try { return JSON.parse(source); }
	catch (error) { throw new Error(`The ${label} is not readable JSON.`, { cause: error }); }
}

function manifestBuffer(value) {
	return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function hash(value) {
	return createHash('sha256').update(value).digest('hex');
}
