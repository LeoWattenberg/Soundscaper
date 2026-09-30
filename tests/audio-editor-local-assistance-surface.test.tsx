/* SPDX-License-Identifier: AGPL-3.0-only */

/** Local assistance preparation refusal and exposed UI surface. */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ASSISTANCE_OPERATIONS } from '../src/common/editor/assistance/operation.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { createLocalAssistanceMenuItems } from '../src/common/editor/ui/local-assistance-menu.ts';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';
import type { LocalAssistanceSnapshot } from
	'../src/common/editor/ui/local-assistance-session-types.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import {
	LocalAssistanceDialogView,
} from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import {
	INVENTORY,
	MODEL,
} from './helpers/local-assistance-fixtures.ts';

test('missing selected-media preparation is truthful and never invents bytes', async () => {
	const store = createLocalAssistanceAdvancedWorkflowSessionStore({
		bridge: null,
		preparation: null,
	});
	await store.load();
	assert.equal(store.getSnapshot().phase, 'selection-required');
	assert.equal(store.getSnapshot().unavailableReason, 'selection-required');
});

test('Local Assistance menu is desktop- and capability-gated and survives the Framescaper filter', () => {
	const opened: string[] = [];
	const desktop = createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: true, copy: ENGLISH_COPY }, { open: () => opened.push('opened') });
	assert.equal(desktop[0]?.id, 'local-assistance');
	assert.equal(desktop[0]?.label, 'Advanced Local Processing');
	assert.equal(desktop[0]?.icon, String.fromCodePoint(0xF476));
	desktop[0]?.onClick?.();
	assert.deepEqual(opened, ['opened']);
	assert.deepEqual(createLocalAssistanceMenuItems({ desktopAvailable: false,
		capabilityActive: true, copy: ENGLISH_COPY }, { open: () => undefined }), []);
	assert.deepEqual(createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: false, copy: ENGLISH_COPY }, { open: () => undefined }), []);
	const indexed = createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: true, copy: ENGLISH_COPY }, {
		open: () => undefined, openIndexedSearch: () => opened.push('indexed-search'),
	});
	assert.equal(indexed[1]?.id, 'assistance-search');
	assert.equal(indexed[1]?.items?.[0]?.label, 'Indexed Search');
	assert.equal(indexed[1]?.items?.[0]?.icon, String.fromCodePoint(0xF476));
	indexed[1]?.items?.[0]?.onClick?.();
	assert.deepEqual(opened, ['opened', 'indexed-search']);

	const filtered = filterProductMenus([{ id: 'tools', items: indexed }], {
		audioAnalysis: false, audioGenerators: true, audioEffects: true,
		audioMacros: true, audioRecording: true, videoMotionTracking: false,
		assistanceAssets: true,
	}, 'framescaper');
	assert.deepEqual(filtered[0]?.items.map(({ id }: { id: string }) => id), [
		'local-assistance', 'assistance-search',
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
	assert.equal(ASSISTANCE_OPERATIONS.length, 17);
	for (const operation of ASSISTANCE_OPERATIONS.filter((candidate) => candidate !== 'text-to-speech')) {
		assert.match(markup, new RegExp(operation, 'u'));
	}
	assert.doesNotMatch(markup, /<option value="text-to-speech"/u);
	assert.equal(markup.match(/<option value="" disabled=""[^>]*>Choose<\/option>/gu)?.length, 3);
	assert.doesNotMatch(markup, /I consent to local processing/u);
	assert.match(markup, /one consent dialog for this exact operation, model, input, and output/u);
	// Review and Accept are the shared footer's buttons, and neither is offered
	// until the run that produced a result has been reviewed.
	assert.match(markup, /<span class="button__text">Review result<\/span>/u);
	assert.match(markup, /<span class="button__text">Accept proposal<\/span>/u);
	assert.match(
		markup,
		/<button[^>]*disabled=""[^>]*><span class="button__text">Review result<\/span>/u,
	);
	assert.match(
		markup,
		/<button[^>]*class="button button--primary[^"]*"[^>]*disabled=""[^>]*><span class="button__text">Accept proposal<\/span>/u,
	);
});
