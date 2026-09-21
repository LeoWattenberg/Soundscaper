/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
	const source = Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS)
		.map(({ marker, pathPrefix }) => `${marker}\n${pathPrefix}`).join('\n');
	assert.deepEqual(validateE2EDynamicScriptExclusions([{ source }], 'framescaper'),
		Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS).map(({ marker }) => marker).sort());
	assert.throws(() => validateE2EDynamicScriptExclusions([{ source: '' }], 'framescaper'),
		/missing, duplicate, or unapproved/u);
	assert.throws(() => validateE2EDynamicScriptExclusions([{
		source: `${source}\nsoundscaper-e2e-recipe:unknown-v1\n__e2e-excluded__/unknown-v1-`,
	}], 'framescaper'), /missing, duplicate, or unapproved/u);
	assert.throws(() => validateE2EDynamicScriptExclusions([{ source: `${source}\n${source}` }], 'framescaper'),
		/missing, duplicate, or unapproved/u);
});

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
