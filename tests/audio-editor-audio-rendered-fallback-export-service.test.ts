/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import { PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE } from '../src/common/editor/project-fallback-integrity.ts';
import {
	assertGlobalCachesUnchanged,
	assertOrder,
	createFixture,
} from './helpers/audio-rendered-fallback-export-fixture.ts';

test('active audio fallback offline mix uses only the private verified source', async () => {
	const fixture = createFixture();
	const before = structuredClone(fixture.canonical);

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.deepEqual(fixture.canonical, before, 'export must not mutate canonical project state');
	assertOrder(fixture.events, [
		'projection', 'verify', 'admission-current', 'provider', 'plan', 'preflight', 'render-offline',
	]);
	assert.equal(fixture.events.includes('prepare-caches'), false);
	assert.equal(fixture.events.includes('create-engine'), false);
	assertGlobalCachesUnchanged(fixture);
});

test('active track fallback offline mix merges global sources with the private provider', async () => {
	const fixture = createFixture({ role: 'track' });
	const before = structuredClone(fixture.canonical);

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.deepEqual(fixture.errors, [], `track fallback export errors: ${String(fixture.errors)}`);
	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.deepEqual(fixture.canonical, before, 'export must not mutate canonical project state');
	assertOrder(fixture.events, [
		'projection', 'verify', 'admission-current', 'provider', 'plan', 'preflight', 'render-offline',
	]);
	assert.equal(fixture.events.includes('create-engine'), false);
	assertGlobalCachesUnchanged(fixture);
});

test('active track fallback refuses stems and BW64 or ADM before export side effects', async () => {
	for (const [label, settings] of [
		['stems', { mode: 'stems', format: 'wav' }],
		['BW64', { mode: 'mix', format: 'bw64' }],
		['ADM', { mode: 'mix', format: 'wav', adm: { mode: 'authored' } }],
	] as const) {
		const fixture = createFixture({ role: 'track' });

		assert.equal(
			await createEditorExportService(fixture.runtime).handleExportAction('export', settings),
			undefined,
			label,
		);
		assert.equal(fixture.errors.length, 1, `${label} must report one refusal`);
		for (const forbidden of [
			'verify', 'plan', 'picker', 'preflight', 'render-offline', 'create-engine', 'render-realtime',
		]) {
			assert.equal(fixture.events.includes(forbidden), false, `${label} reached ${forbidden}`);
		}
		assertGlobalCachesUnchanged(fixture);
	}
});

test('active audio fallback realtime mix routes the private provider into the render engine', async () => {
	const fixture = createFixture({ strategy: 'realtime-stream', directDestination: true });

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.equal(result.url, null);
	assert.equal(result.method, 'filesystem');
	assertOrder(fixture.events, [
		'projection', 'verify', 'admission-current', 'provider', 'plan', 'picker', 'destination-open',
		'create-engine', 'load-project', 'render-realtime', 'destination-close', 'destination-commit',
	]);
	assert.equal(fixture.events.includes('render-offline'), false);
	assert.equal(fixture.events.includes('prepare-caches'), false);
	assert.equal(fixture.events.includes('preflight'), false);
	assert.equal(fixture.events.includes('temporary-sink'), false);
	assert.equal(fixture.events.includes('download'), false);
	assertGlobalCachesUnchanged(fixture);
});

test('active audio fallback offline mix opens and streams only after private-provider admission', async () => {
	const fixture = createFixture({ strategy: 'offline', directDestination: true });
	const before = structuredClone(fixture.canonical);

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.equal(result.url, null);
	assertOrder(fixture.events, [
		'projection', 'verify', 'admission-current', 'provider', 'plan', 'picker', 'destination-open',
		'render-offline', 'destination-close', 'destination-commit',
	]);
	assert.equal(fixture.events.includes('preflight'), false);
	assert.equal(fixture.events.includes('temporary-sink'), false);
	assert.equal(fixture.events.includes('download'), false);
	assert.deepEqual(fixture.canonical, before);
	assertGlobalCachesUnchanged(fixture);
});

test('active audio fallback refuses stems and BW64 or ADM before export side effects', async () => {
	for (const [label, settings] of [
		['stems', { mode: 'stems', format: 'wav' }],
		['BW64', { mode: 'mix', format: 'bw64' }],
		['ADM', { mode: 'mix', format: 'wav', adm: { mode: 'authored' } }],
	] as const) {
		const fixture = createFixture();

		assert.equal(
			await createEditorExportService(fixture.runtime).handleExportAction('export', settings),
			undefined,
			label,
		);
		assert.equal(fixture.errors.length, 1, `${label} must report one refusal`);
		assert.match((fixture.errors[0] as Error).message, /audio rendered-fallback|fallback.*(?:mix|BW64|ADM)/iu);
		for (const forbidden of [
			'verify', 'plan', 'picker', 'preflight', 'render-offline', 'create-engine', 'render-realtime',
		]) {
			assert.equal(fixture.events.includes(forbidden), false, `${label} reached ${forbidden}`);
		}
		assertGlobalCachesUnchanged(fixture);
	}
});

test('ordinary audio export preserves the existing render callback contract', async () => {
	const fixture = createFixture({ activeFallback: false });

	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.deepEqual(fixture.errors, [], `ordinary export errors: ${String(fixture.errors)}`);
	assert.equal(result.fileName, 'fallback-mix.wav');
	assert.equal(fixture.events.includes('verify'), false);
	assert.equal(fixture.ordinaryRenderObserved, true);
	assertGlobalCachesUnchanged(fixture);
});

test('audio fallback integrity errors do not retry offline rendering in realtime', async () => {
	const integrityFailure = Object.assign(
		new Error('Fallback source changed after integrity admission.'),
		{ code: PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE },
	);
	const fixture = createFixture({ renderFailure: integrityFailure });

	assert.equal(
		await createEditorExportService(fixture.runtime).handleExportAction('export'),
		undefined,
	);
	assert.strictEqual(fixture.errors[0], integrityFailure);
	assert.equal(fixture.events.includes('render-offline'), true);
	assert.equal(fixture.events.includes('prepare-caches'), false);
	assert.equal(fixture.events.includes('create-engine'), false);
	assert.equal(fixture.events.includes('render-realtime'), false);
	assert.equal(fixture.events.includes('status:Realtime fallback'), false);
});
