/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import * as rendererExecution from '../desktop/renderer-smoke-execution.js';
import {
	DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS,
	executeDesktopRendererSmoke,
	invokeFramescaperWebVcrSmokeGesture,
	readDesktopRendererSmokeStallWitness,
	readFramescaperWebVcrSmokeStage,
	validateDesktopRendererDynamicSource,
} from '../desktop/renderer-smoke-execution.js';
import {
	validateE2EDynamicScriptExclusions,
} from '../scripts/lib/e2e-coverage-build-evidence.mjs';
import { assertE2EExecutableStringPolicy } from '../scripts/lib/e2e-dynamic-code-audit.mjs';
import {
	stageSoundscaperDesktopEntrySources,
} from '../scripts/lib/desktop-product-runtime-staging.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('packaged renderer smoke launchers are closed data-only recipes', async () => {
	const calls = [];
	const responses = [
		{ status: 'fulfilled', value: 'done' },
		'direct WAV stage',
		'720p-capture-user-gesture',
		true,
	];
	const webContents = {
		executeJavaScript(source, userGesture) {
			calls.push({ source, userGesture });
			return Promise.resolve(responses.shift());
		},
	};
	assert.equal(await executeDesktopRendererSmoke(webContents, {
		productId: 'framescaper',
		operation: 'artifact-baseline',
		arguments: [{ title: 'line\u2028separator' }],
		userGesture: true,
	}), 'done');
	assert.match(calls[0].source, /soundscaper-e2e-recipe:runner-v1/u);
	assert.match(calls[0].source,
		/import\("framescaper-app:\/\/bundle\/desktop-renderer-smoke\.js"\).*runDesktopRendererSmokeEnvelope/u);
	assert.match(calls[0].source,
		/\{"operation":"artifact-baseline","arguments":\[\{"title":"line\\u2028separator"\}\]\}/u);
	assert.equal(calls[0].userGesture, true);
	assert.equal(attest(calls[0].source, 'framescaper').recipeId, 'runner');

	assert.equal(await readDesktopRendererSmokeStallWitness(webContents, {
		productId: 'soundscaper', stageKey: '__scapeDirectWavSmokeStage', userGesture: true,
	}), 'direct WAV stage');
	assert.equal(attest(calls[1].source, 'soundscaper').recipeId, 'stallWitness');
	assert.equal(await readFramescaperWebVcrSmokeStage(webContents), '720p-capture-user-gesture');
	assert.equal(attest(calls[2].source, 'framescaper').recipeId, 'webVcrStage');
	assert.equal(await invokeFramescaperWebVcrSmokeGesture(webContents), true);
	assert.equal(attest(calls[3].source, 'framescaper').recipeId, 'webVcrGesture');
	assert.equal(calls[3].userGesture, true);
	assert.ok(calls.every(({ source }) => source.split('sourceURL=').length === 2));
	assert.ok(calls.every(({ source }) => /\/\/# sourceURL=[^\n]+$/u.test(source)));
});

test('renderer smoke execution has no arbitrary-expression escape hatch', () => {
	assert.equal('executeAttestedRendererExpression' in rendererExecution, false);
	const webContents = { executeJavaScript: () => Promise.resolve() };
	assert.throws(() => executeDesktopRendererSmoke(webContents, {
		productId: 'framescaper', operation: 'artifact-baseline\n//# sourceURL=https://bad.invalid/',
	}), /operation is invalid/u);
	assert.throws(() => executeDesktopRendererSmoke(webContents, {
		productId: 'framescaper', operation: 'artifact-baseline', expression: 'void 0',
	}), /options are invalid/u);
	const cycle = [];
	cycle.push(cycle);
	assert.throws(() => executeDesktopRendererSmoke(webContents, {
		productId: 'framescaper', operation: 'artifact-baseline', arguments: cycle,
	}), /not JSON-serializable/u);
	assert.throws(() => readDesktopRendererSmokeStallWitness(webContents, {
		productId: 'framescaper', stageKey: '__unknownStage',
	}), /stage key is invalid/u);
	assert.throws(() => readDesktopRendererSmokeStallWitness(webContents, {
		productId: 'soundscaper', stageKey: '__framescaperWebVcrSmokeStageV1',
	}), /stage key is invalid/u);
});

test('dynamic-source attestation rejects authenticated extra code and malformed placeholders', async () => {
	let canonical = '';
	await executeDesktopRendererSmoke({
		executeJavaScript(source) {
			canonical = source;
			return Promise.resolve({ status: 'fulfilled', value: null });
		},
	}, { productId: 'framescaper', operation: 'artifact-chrome' });
	const body = canonical.slice(0, canonical.lastIndexOf('\n//# sourceURL='));
	const recipe = DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS.runner;
	for (const changedBody of [
		`${body}\nvoid 0;`,
		body.replace('{"operation":"artifact-chrome","arguments":[]}', '{notJson:true}'),
		body.replace('{"operation":"artifact-chrome","arguments":[]}',
			'{"arguments":[],"operation":"artifact-chrome"}'),
		body.replace('runDesktopRendererSmokeEnvelope(globalThis,', 'void 0;runDesktopRendererSmokeEnvelope(globalThis,'),
	]) {
		const source = authenticatedSource('framescaper', recipe.pathPrefix, changedBody);
		assert.throws(() => attest(source, 'framescaper'),
			/canonical template|malformed request|not the canonical recipe/u);
	}
	assert.throws(() => attest(`${canonical}\nvoid 0;`, 'framescaper'),
		/path is not allowlisted|source URL|canonical recipe digest/u);
});

test('packaged smoke control modules never serialize renderer runner bodies', async () => {
	for (const path of [
		'desktop/desktop-smoke.js',
		'desktop/project-library-lease-smoke.js',
		'desktop/framescaper-web-vcr-smoke-session.js',
	]) {
		const source = await readFile(resolve(ROOT, path), 'utf8');
		assert.doesNotMatch(source, /\.toString\(\)/u, `${path} still serializes executable renderer code`);
	}
});

test('E2E build evidence admits exactly the closed dynamic recipe library', () => {
	const markers = Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS)
		.map(({ marker, pathPrefix }, index) => (
			`const dynamicRecipe${String(index)} = ${JSON.stringify(`${marker}\n${pathPrefix}`)};`
		)).join('\n');
	const source = `${markers}\n${canonicalExecuteRecipeSource()}`;
	assert.deepEqual(validateE2EDynamicScriptExclusions([{ source }], 'framescaper'),
		Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS).map(({ marker }) => marker).sort());
	assert.throws(() => validateE2EDynamicScriptExclusions([{ source: '' }], 'framescaper'),
		/missing, duplicate, or unapproved/u);
	assert.throws(() => validateE2EDynamicScriptExclusions([{
		source: `${source}\nsoundscaper-e2e-recipe:unknown-v1\n__e2e-excluded__/unknown-v1-`,
	}], 'framescaper'), /missing, duplicate, or unapproved/u);
	assert.throws(() => validateE2EDynamicScriptExclusions([{ source: `${source}\n${source}` }], 'framescaper'),
		/missing, duplicate, or unapproved/u);
	for (const injected of [
		'webContents.executeJavaScript(userControlledSource, false);',
		'eval(userControlledSource);',
		'(0, eval)(userControlledSource);',
		'new Function(userControlledSource)();',
		'Function(userControlledSource)();',
		"setTimeout('void 0', 0);",
		"new Worker(userControlledSource, { eval: true });",
		"const executable = URL.createObjectURL(new Blob([userControlledSource], { type: 'text/javascript' })); new Worker(executable, { type: 'module' });",
		'const executable = URL.createObjectURL(new Blob([userControlledSource])); new Worker(executable);',
		"import('data:text/javascript,export default 1');",
		'import(userControlledSource);',
		"new Worker('data:text/javascript,postMessage(1)');",
		'new Worker(userControlledSource, { type: \'module\' });',
		'new SharedWorker(userControlledSource);',
		'audioWorklet.addModule(userControlledSource);',
		'navigator.serviceWorker.register(userControlledSource);',
		"document.createElement('script');",
		"element.innerHTML = '<script>void 0</script>';",
		'vm.runInThisContext(userControlledSource);',
		'new vm.Script(userControlledSource);',
		'globalThis.executeJavaScriptInIsolatedWorld(userControlledSource);',
	]) {
		assert.throws(
			() => validateE2EDynamicScriptExclusions([{ source: `${source}\n${injected}` }], 'framescaper'),
			/unattested executable-string primitive/u,
			injected,
		);
	}
	const decoy = canonicalExecuteRecipeSource()
		.replace('validateDesktopRendererDynamicSource', 'acceptAnything');
	assert.throws(
		() => validateE2EDynamicScriptExclusions([{ source: `${markers}\n${decoy}` }], 'framescaper'),
		/unattested executable-string primitive/u,
	);
	const sibling = `${canonicalExecuteRecipeSource()}
function escape(webContents, productId, recipeId, source, userGesture) {
	const decoyAttestation = { productId, source };
	void decoyAttestation;
	void 'Renderer smoke recipe attestation disagrees.';
	return webContents.executeJavaScript(source, userGesture === true);
}`;
	assert.throws(
		() => validateE2EDynamicScriptExclusions([{ source: `${markers}\n${sibling}` }], 'framescaper'),
		/unattested executable-string primitive/u,
	);
});

test('the macro Worker admission binds the exact Blob producer to the exact Worker', async () => {
	const source = await readFile(resolve(
		ROOT, 'src/common/editor/macro-script/browser-sandbox.ts',
	), 'utf8');
	const descriptor = {
		artifactPath: 'src/common/editor/macro-script/browser-sandbox.ts',
		source,
	};
	assert.doesNotThrow(() => assertE2EExecutableStringPolicy([descriptor]));
	const injected = source.replace(
		"\t\t\tconst worker = new Worker(url, { type: 'module', name });",
		"\t\t\tconst worker = new Worker(url, { type: 'module', name });\n\t\t\tnew Worker(untrustedUrl);",
	);
	assert.throws(() => assertE2EExecutableStringPolicy([{ ...descriptor, source: injected }]),
		/unattested executable-string primitive/u);
});

test('mapped repository sources cannot hide stable-spelling executable producers', () => {
	for (const source of [
		'element.innerHTML = untrustedMarkup;',
		"document.createElement('script');",
		"element.insertAdjacentHTML('beforeend', untrustedMarkup);",
		"new Blob([untrustedSource], { type: 'text/javascript' });",
		"element.setAttribute('onclick', untrustedHandler);",
	]) {
		const artifactPath = 'src/common/editor/mapped-dynamic-producer.ts';
		assert.throws(() => assertE2EExecutableStringPolicy([{
			artifactPath: 'assets/mapped-dynamic-producer.js',
			fullSourceMap: {
				sources: [`file:///__soundscaper_repo__/${artifactPath}`],
				sourcesContent: [source],
			},
			owned: true,
			repositorySources: [artifactPath],
			source: 'globalThis.mappedDynamicProducer = true;\n',
		}]), /unattested executable-string primitive/u, source);
	}
});

test('actual product control sources retain exactly the attested renderer recipe callsite', async (context) => {
	const framescaper = await readFile(resolve(ROOT, 'desktop/renderer-smoke-execution.js'), 'utf8');
	assert.doesNotThrow(() => validateE2EDynamicScriptExclusions([{
		artifactPath: 'app/desktop/renderer-smoke-execution.js', source: framescaper,
	}], 'framescaper'));

	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-dynamic-code-audit-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const applicationRoot = join(temporary, 'desktop');
	await mkdir(applicationRoot, { recursive: true });
	await stageSoundscaperDesktopEntrySources(resolve(ROOT, 'desktop'), applicationRoot);
	const soundscaper = await readFile(join(applicationRoot, 'desktop-smoke.js'), 'utf8');
	assert.doesNotThrow(() => validateE2EDynamicScriptExclusions([{
		artifactPath: 'app/desktop/desktop-smoke.js', source: soundscaper,
	}], 'soundscaper'));
});

function canonicalExecuteRecipeSource() {
	return `function executeRecipe(webContents, productId, recipeId, source, userGesture) {
	const attestation = validateDesktopRendererDynamicSource({ productId, path: sourceUrlPath(source), source });
	if (attestation.recipeId !== recipeId) throw new Error('Renderer smoke recipe attestation disagrees.');
	return webContents.executeJavaScript(source, userGesture === true);
}`;
}

function attest(source, productId) {
	const sourceUrl = source.slice(source.lastIndexOf('sourceURL=') + 'sourceURL='.length);
	return validateDesktopRendererDynamicSource({
		path: new URL(sourceUrl).pathname.replace(/^\/+/u, ''),
		productId,
		source,
	});
}

function authenticatedSource(productId, pathPrefix, body) {
	const digest = createHash('sha256').update(body, 'utf8').digest('hex');
	const path = `${pathPrefix}${digest}.js`;
	return `${body}\n//# sourceURL=${productId}-app://bundle/${path}`;
}
