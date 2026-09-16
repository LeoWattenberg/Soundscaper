/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import EditorToast, { EditorWarningToast } from '../src/common/editor/ui/EditorToast.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('toast actions support pending operations and localized dismissal', () => {
	const markup = renderToStaticMarkup(<EditorToast
		id="project-lock"
		title="Projekt in anderem Tab geöffnet"
		type="warning"
		actions={[{ label: 'Wird übernommen…', onClick() {}, disabled: true }]}
		dismissLabel="Schließen"
		onDismiss={() => undefined}
	/>);
	assert.match(markup, /<section[^>]*aria-label="Projekt in anderem Tab geöffnet"/u);
	assert.match(markup, /role="alert"/u);
	assert.match(markup, /<button[^>]*disabled=""[^>]*><span[^>]*>Wird übernommen…<\/span><\/button>/u);
	assert.match(markup, /<span aria-hidden="true">×<\/span><span class="kw-audio-editor-sr-only">Schließen<\/span>/u);
	assert.doesNotMatch(markup, />Dismiss</u);
});

test('toasts dismiss after ten seconds using the latest callback without restarting on render', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const fixture = await mountedToast();
	let originalDismissals = 0;
	let latestDismissals = 0;
	try {
		await fixture.render(() => { originalDismissals += 1; });
		await act(async () => { context.mock.timers.tick(9_999); });
		assert.equal(originalDismissals, 0);
		await fixture.render(() => { latestDismissals += 1; });
		await act(async () => { context.mock.timers.tick(1); });
		assert.equal(originalDismissals, 0);
		assert.equal(latestDismissals, 1);
		await act(async () => { context.mock.timers.tick(10_000); });
		assert.equal(latestDismissals, 1);
	} finally {
		await fixture.cleanup();
	}
});

test('unmounting a toast cancels its automatic dismissal', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const fixture = await mountedToast();
	let dismissals = 0;
	await fixture.render(() => { dismissals += 1; });
	await fixture.cleanup();
	context.mock.timers.tick(10_000);
	assert.equal(dismissals, 0);
});

async function mountedToast() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		render: async (onDismiss: () => void) => {
			await act(async () => root.render(<EditorToast id="compatibility" title="Compatibility" dismissLabel="Close" onDismiss={onDismiss} />));
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

test('warning dismissal is local and resets when the warning condition returns', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (monitoring: boolean, description = 'Use headphones.') => {
		await act(async () => root.render(<>
			{monitoring && <EditorWarningToast id="monitor" title="Monitoring" description={description} dismissLabel="Close" />}
			<EditorWarningToast id="storage" title="Temporary storage" dismissLabel="Close" />
		</>));
	};
	try {
		await render(true);
		await act(async () => { reactProps(dom.one('button')).onClick?.(); });
		assert.equal(dom.find('[data-editor-toast="monitor"]'), null);
		assert.ok(dom.find('[data-editor-toast="storage"]'));
		await render(true, 'Use headphones to prevent feedback.');
		assert.equal(dom.find('[data-editor-toast="monitor"]'), null);
		await render(false);
		await render(true);
		assert.ok(dom.find('[data-editor-toast="monitor"]'));
		await act(async () => { context.mock.timers.tick(10_000); });
		assert.equal(dom.find('[data-editor-toast="monitor"]'), null);
		assert.equal(dom.find('[data-editor-toast="storage"]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
