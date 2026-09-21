/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	E2E_EXECUTABLE_URL_PREFIX,
} from './e2e-coverage-contract.mjs';
import { normalizeE2ESourceMap } from './e2e-coverage-build-evidence.mjs';
import { revisionBoundSource } from './e2e-coverage-integrity.mjs';
import {
	MACRO_DYNAMIC_COVERAGE_URL_PREFIX,
	MACRO_FIXED_COVERAGE_SOURCE_PATH,
	macroDynamicCoverageScript,
	macroDynamicSourceUrl,
} from './macro-dynamic-coverage.mjs';

const MACRO_SOURCE_PROTOCOL = 'soundscaper-macro:';
const MACRO_PRELUDE_ARTIFACT_PATTERN = /^assets\/sandbox-prelude-[A-Za-z\d_-]+\.js$/u;

export function isBrowserMacroDynamicCoverage(url) {
	return typeof url === 'string' && url.startsWith(MACRO_DYNAMIC_COVERAGE_URL_PREFIX);
}

export function isMacroDynamicCoverage(url) {
	if (isBrowserMacroDynamicCoverage(url)) return true;
	if (typeof url !== 'string') return false;
	try { return new URL(url).protocol === MACRO_SOURCE_PROTOCOL; }
	catch { return url.startsWith(MACRO_SOURCE_PROTOCOL); }
}

export function classifyBrowserMacroDynamic({
	dynamicScripts,
	entry,
	evidence,
	name,
	profile,
	rawMap,
	repositoryRoot,
}) {
	const source = capturedDynamicSource(profile, entry.url, `browser profile ${name}`);
	const dynamic = resolveMacroDynamicSource({
		repositoryRoot,
		reportedUrl: entry.url,
		source,
	});
	if (!record(rawMap) || !Array.isArray(rawMap.lineLengths) || !record(rawMap.data)
		|| stableJson(rawMap.lineLengths) !== stableJson(sourceLineLengths(source))
		|| stableJson(rawMap.data) !== stableJson(dynamic.sourceMap)) {
		throw new Error(`Browser profile ${name} has stale macro dynamic source-map evidence.`);
	}
	const prelude = browserMacroPrelude(evidence, repositoryRoot, dynamic.attestation.preludeModuleUrl);
	const script = macroCoverageDescriptor({
		dynamic,
		evidence,
		prelude,
		productId: prelude.productId,
		repositoryRoot,
		runtime: 'browser',
	});
	registerDynamicScript(dynamicScripts, script);
	return { entry: { ...entry, url: script.coverageUrl }, script };
}

export function classifyPackagedMacroDynamic({
	dynamicScripts,
	entry,
	evidence,
	profile,
	repositoryRoot,
	runtime,
}) {
	const source = capturedDynamicSource(profile, entry.url, `${runtime.productId} packaged profile`);
	const dynamic = resolveMacroDynamicSource({
		repositoryRoot,
		reportedUrl: entry.url,
		source,
	});
	const suppliedMap = profile['source-map-cache']?.[entry.url];
	if (suppliedMap !== undefined && (!record(suppliedMap)
		|| stableJson(suppliedMap.lineLengths) !== stableJson(sourceLineLengths(source))
		|| stableJson(suppliedMap.data) !== stableJson(dynamic.sourceMap))) {
		throw new Error(`${runtime.productId} packaged profile has stale macro dynamic source-map evidence.`);
	}
	const prelude = packagedMacroPrelude(
		evidence,
		repositoryRoot,
		runtime,
		dynamic.attestation.preludeModuleUrl,
	);
	const script = macroCoverageDescriptor({
		dynamic,
		evidence,
		prelude,
		productId: runtime.productId,
		repositoryRoot,
		runtime: 'electron',
	});
	registerDynamicScript(dynamicScripts, script);
	return { entry: { ...entry, url: script.coverageUrl }, script };
}

function capturedDynamicSource(profile, url, label) {
	const source = profile['script-source-cache']?.[url];
	if (typeof source !== 'string') throw new Error(`${label} has no captured source bytes for ${url}.`);
	return source;
}

function resolveMacroDynamicSource({ repositoryRoot, reportedUrl, source }) {
	const sourceUrl = macroDynamicSourceUrl(source);
	const dynamic = macroDynamicCoverageScript({ repositoryRoot, source, url: sourceUrl });
	if (dynamic === null || ![sourceUrl, dynamic.coverageUrl].includes(reportedUrl)) {
		throw new Error(`Macro dynamic coverage used an unsupported reported URL ${reportedUrl}.`);
	}
	return dynamic;
}

function browserMacroPrelude(evidence, repositoryRoot, url) {
	const parsed = new URL(url);
	for (const [productId, product] of evidence.browser) {
		if (parsed.origin !== product.origin) continue;
		const path = decodedUrlPath(url);
		const script = product.scriptsByPath.get(path);
		return authenticatedMacroPrelude({ evidence, path, productId, repositoryRoot, script });
	}
	throw new Error(`Macro dynamic source imports a prelude outside browser build evidence: ${url}.`);
}

function packagedMacroPrelude(evidence, repositoryRoot, runtime, url) {
	let path;
	let script;
	if (url.startsWith(`${runtime.appOrigin}/`)) {
		path = decodedUrlPath(url);
		script = evidence.electron.get(runtime.productId).scriptsByArtifactPath.get(`renderer/${path}`);
	} else if (origin(url) === runtime.baseOrigin) {
		path = decodedUrlPath(url);
		script = evidence.browser.get(runtime.productId).electronScriptsByPath.get(path);
	} else {
		throw new Error(
			`Macro dynamic source imports a prelude outside ${runtime.productId} packaged build evidence: ${url}.`,
		);
	}
	return authenticatedMacroPrelude({
		evidence,
		path,
		productId: runtime.productId,
		repositoryRoot,
		script,
	});
}

function authenticatedMacroPrelude({ evidence, path, productId, repositoryRoot, script }) {
	if (!MACRO_PRELUDE_ARTIFACT_PATTERN.test(path) || script?.sourceMap !== null
		|| script.productId !== productId || script.realm !== 'renderer') {
		throw new Error(`Macro dynamic source does not import an exact emitted ${productId} sandbox prelude asset.`);
	}
	const committed = revisionBoundSource(
		repositoryRoot,
		evidence.sourceRevision,
		'src/common/editor/macro-script/sandbox-prelude.js',
	);
	if (script.source !== committed.text) {
		throw new Error(`The emitted ${productId} macro sandbox prelude bytes are stale.`);
	}
	return Object.freeze({ productId, script });
}

function macroCoverageDescriptor({ dynamic, evidence, prelude, productId, repositoryRoot, runtime }) {
	const { programSha256, recipeSha256 } = dynamic.attestation;
	const coverageUrl = `${E2E_EXECUTABLE_URL_PREFIX}dynamic/${runtime}/${productId}/renderer/`
		+ `macro-module-v1/${recipeSha256}/${programSha256}.js`;
	const normalized = normalizeE2ESourceMap(
		{ ...dynamic.sourceMap, file: coverageUrl },
		repositoryRoot,
		`${productId} ${runtime} macro dynamic module`,
		evidence.sourceRevision,
	);
	if (stableJson(normalized.repositorySources) !== stableJson([MACRO_FIXED_COVERAGE_SOURCE_PATH])) {
		throw new Error('The macro dynamic module did not map only to its fixed wrapper source.');
	}
	return Object.freeze({
		artifactPath: `dynamic/macro-module-v1/${recipeSha256}-${programSha256}.js`,
		coverageUrl,
		fullSourceMap: normalized.map,
		inputFile: null,
		macroPreludeCoverageUrl: prelude.script.coverageUrl,
		owned: true,
		packagedPath: null,
		productId,
		realm: 'renderer',
		repositorySources: normalized.repositorySources,
		runtime,
		source: dynamic.source,
		sourceMap: Object.freeze({
			data: normalized.map,
			lineLengths: sourceLineLengths(dynamic.source),
			url: null,
		}),
	});
}

function registerDynamicScript(scripts, script) {
	const previous = scripts.get(script.coverageUrl);
	if (previous !== undefined && stableJson(previous) !== stableJson(script)) {
		throw new Error(`Macro dynamic coverage conflicts for ${script.coverageUrl}.`);
	}
	scripts.set(script.coverageUrl, script);
}

function decodedUrlPath(url) {
	return decodeURIComponent(new URL(url).pathname).replaceAll('\\', '/').replace(/^\/+/u, '');
}

function origin(url) {
	try { return new URL(url).origin; } catch { return null; }
}

function sourceLineLengths(value) {
	const lines = String(value).split('\n');
	if (lines.length > 1 && lines.at(-1) === '') lines.pop();
	return lines.map((line) => line.length);
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
