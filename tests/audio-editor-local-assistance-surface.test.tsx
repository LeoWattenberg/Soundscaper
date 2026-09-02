/* SPDX-License-Identifier: AGPL-3.0-only */

/** Local assistance: cancellation, preparation refusal, and the exposed surface. */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ASSISTANCE_OPERATIONS } from '../src/common/editor/assistance/operation.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { resolveLocalAssistanceBridge } from '../src/common/editor/ui/local-assistance-bridge.ts';
import { createLocalAssistanceMenuItems } from '../src/common/editor/ui/local-assistance-menu.ts';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import {
	type LocalAssistanceSelectedMediaPreparationPort,
} from '../src/common/editor/ui/local-assistance-preparation.ts';
import {
	createLocalAssistanceSessionStore,
	type LocalAssistanceSnapshot,
} from '../src/common/editor/ui/local-assistance-session-store.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import {
	LocalAssistanceDialogView,
} from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import {
	INVENTORY,
	JOB_ID,
	MODEL,
	preparationFixture,
	rawBridgeFixture,
	selectedStore,
} from './helpers/local-assistance-fixtures.ts';

test('cancellation is explicit and release is attempted after the run quiesces', { timeout: 5_000 }, async () => {
	const fixture = rawBridgeFixture();
	let finish: ((value: unknown) => void) | null = null;
	let markStarted: (() => void) | null = null;
	const started = new Promise<void>((resolve) => { markStarted = resolve; });
	fixture.api.run = () => {
		fixture.calls.push('run');
		markStarted?.();
		return new Promise((resolve) => { finish = resolve; });
	};
	fixture.api.cancel = async () => {
		fixture.calls.push('cancel');
		finish?.({ contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition',
			outcome: 'unavailable', reason: 'adapter-unavailable' });
		return { contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' };
	};
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = selectedStore(bridge, preparationFixture());
	const running = store.run();
	await started;
	assert.equal(fixture.calls.includes('run'), true);
	await store.cancel();
	await running;

	assert.equal(store.getSnapshot().phase, 'cancelled');
	assert.deepEqual(fixture.calls.slice(-2), ['cancel', 'release']);
});

/**
 * On desktop an aborted run rejects rather than resolving, and the IPC layer
 * replaces the cancellation error with a plain one, so the store cannot
 * recognise it by type. A deliberate cancel must still read as cancelled.
 */
test('a cancelled run that rejects is reported as cancelled, not failed', { timeout: 5_000 }, async () => {
	const fixture = rawBridgeFixture();
	let reject: ((reason: unknown) => void) | null = null;
	let markStarted: (() => void) | null = null;
	const started = new Promise<void>((resolve) => { markStarted = resolve; });
	fixture.api.run = () => {
		fixture.calls.push('run');
		markStarted?.();
		return new Promise((_resolve, fail) => { reject = fail; });
	};
	fixture.api.cancel = async () => {
		fixture.calls.push('cancel');
		reject?.(new Error('The local-assistance operation was cancelled.'));
		return { contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' };
	};
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = selectedStore(bridge, preparationFixture());
	const running = store.run();
	await started;
	await store.cancel();
	await running;

	assert.equal(store.getSnapshot().phase, 'cancelled');
	assert.equal(store.getSnapshot().error, null, 'a cancellation reports no failure text');
});

test('cancellation aborts selected-media preparation before a job is created', { timeout: 5_000 }, async () => {
	const fixture = rawBridgeFixture();
	let started: (() => void) | null = null;
	const preparing = new Promise<void>((resolve) => { started = resolve; });
	const preparation: LocalAssistanceSelectedMediaPreparationPort = Object.freeze({
		listSelectedMedia: async () => INVENTORY,
		prepareSelectedMedia: (request: Parameters<
			LocalAssistanceSelectedMediaPreparationPort['prepareSelectedMedia']
		>[0]) => new Promise((_resolve, reject) => {
			const { signal } = request;
			assert.ok(signal instanceof AbortSignal);
			started?.();
			signal.addEventListener('abort', () => reject(signal.reason), { once: true });
		}),
	});
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = createLocalAssistanceSessionStore({ bridge, preparation });
	store.connect();
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('speech-recognition');
	store.selectModel('speech-model');
	store.setConsent(true);
	const running = store.run();
	await preparing;
	await store.cancel();
	await running;

	assert.equal(store.getSnapshot().phase, 'cancelled');
	assert.deepEqual(fixture.calls, ['models'], 'cancelled preparation never creates privileged custody');
});

test('missing selected-media preparation is truthful and never invents bytes', async () => {
	const fixture = rawBridgeFixture();
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = createLocalAssistanceSessionStore({ bridge, preparation: null });
	await store.load();
	assert.equal(store.getSnapshot().phase, 'selection-required');
	assert.equal(store.getSnapshot().unavailableReason, 'selection-required');
	assert.deepEqual(fixture.calls, []);
});

test('Local Assistance menu is desktop- and capability-gated and survives the Framescaper filter', () => {
	const opened: string[] = [];
	const desktop = createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: true, copy: ENGLISH_COPY }, { open: () => opened.push('opened') });
	assert.equal(desktop[0]?.id, 'local-assistance');
	assert.equal(desktop[0]?.label, 'Local Assistance…');
	desktop[0]?.onClick();
	assert.deepEqual(opened, ['opened']);
	assert.deepEqual(createLocalAssistanceMenuItems({ desktopAvailable: false,
		capabilityActive: true, copy: ENGLISH_COPY }, { open: () => undefined }), []);
	assert.deepEqual(createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: false, copy: ENGLISH_COPY }, { open: () => undefined }), []);
	const indexed = createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: true, copy: ENGLISH_COPY }, {
		open: () => undefined, openIndexedSearch: () => opened.push('indexed-search'),
	});
	assert.equal(indexed[1]?.id, 'local-assistance-indexed-search');
	assert.equal(indexed[1]?.label, 'Indexed Search…');
	indexed[1]?.onClick();
	assert.deepEqual(opened, ['opened', 'indexed-search']);

	const filtered = filterProductMenus([{ id: 'analyze', items: indexed }], {
		audioAnalysis: false, audioGenerators: true, audioEffects: true,
		audioMacros: true, audioRecording: true, videoMotionTracking: false,
		assistanceAssets: true,
	}, 'framescaper');
	assert.deepEqual(filtered[0]?.items.map(({ id }: { id: string }) => id), [
		'local-assistance', 'local-assistance-indexed-search',
	]);
});

test('menu-opened indexed search reports missing disposable custody inside the existing palette', () => {
	const target = globalThis as typeof globalThis & { React?: typeof React };
	const prior = target.React;
	target.React = React;
	let markup: string;
	try {
		markup = renderToStaticMarkup(<AudioEditorSearch
			assistanceSearch={{
				status: 'unavailable', revision: 1, coordinator: null,
				message: 'Indexed search is unavailable until a reviewed disposable index is created.',
			}}
			copy={ENGLISH_COPY}
			entries={[]}
			locale="en"
			onActivate={() => undefined}
			onOpenChange={() => undefined}
			open
		/>);
	} finally {
		if (prior === undefined) Reflect.deleteProperty(target, 'React');
		else target.React = prior;
	}
	assert.match(markup, /data-editor-search-group="assistance"/u);
	assert.match(markup, /reviewed disposable index is created/u);
	assert.doesNotMatch(markup, /data-editor-search-group="command"/u);
});

test('the focused EN/DE catalog and dialog expose all operations without an implicit accept path', () => {
	assert.equal(ENGLISH_COPY.localAssistance, 'Local Assistance');
	assert.equal(GERMAN_COPY.localAssistance, 'Lokale Assistenz');
	const snapshot: LocalAssistanceSnapshot = Object.freeze({
		phase: 'ready', sources: INVENTORY.sources, models: Object.freeze([MODEL]),
		selectedSourceId: 'source-1', selectedOperation: null, shotDetectionMode: 'fast',
		selectedModelIds: Object.freeze([]), consent: false,
		progress: null, result: null, unavailableReason: null, error: null,
		canRun: false, canCancel: false, canReview: false, canAccept: false,
	});
	const markup = renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={snapshot} surface="advanced" onClose={() => undefined}
		onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onConsentChange={() => undefined}
		onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
	assert.equal(ASSISTANCE_OPERATIONS.length, 16);
	for (const operation of ASSISTANCE_OPERATIONS) assert.match(markup, new RegExp(operation, 'u'));
	assert.equal(markup.match(/<option value="" disabled=""[^>]*>Choose<\/option>/gu)?.length, 3);
	assert.doesNotMatch(markup, /I consent to local processing/u);
	assert.match(markup, /one consent dialog for this exact operation, model, input, and output/u);
	assert.match(markup, /Review result[^<]*<\/button>/u);
	assert.match(markup, /Accept proposal[^<]*<\/button>/u);
	assert.match(markup, /disabled=""[^>]*>Review result|>Review result<\/button>/u);
});
