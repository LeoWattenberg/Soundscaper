/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ProjectLockToast from '../src/common/editor/ui/ProjectLockToast.tsx';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('project locks use an actionable toast and leave selection toolbars free of notices', () => {
	const controller = { actions: { project: { claimLock: () => undefined } } };
	const toast = renderToStaticMarkup(<ProjectLockToast
		copy={ENGLISH_COPY} snapshot={{ lockReadOnly: true }} controller={controller} run={(operation) => operation()}
	/>);
	assert.match(toast, /<section[^>]*aria-label="This project is already open in another tab\."/u);
	assert.match(toast, /role="alert"/u);
	assert.match(toast, /Edit here/u);
	assert.match(toast, /<span class="button__text">Close<\/span>/u);
	assert.equal(renderToStaticMarkup(<ProjectLockToast
		copy={ENGLISH_COPY} snapshot={{ lockReadOnly: false }} controller={controller} run={(operation) => operation()}
	/>), '');
	for (const showSelectionToolbar of [true, false]) {
		const toolbar = renderToStaticMarkup(<AccessibleSelectionToolbar
			controller={{ subscribeTelemetry: () => () => undefined, getTelemetrySnapshot: () => ({ taskProgress: null }) }}
			snapshot={{ selection: null, lockReadOnly: true }} copy={ENGLISH_COPY}
			statusMessage="Ready" statusState="success" durationFrames={0} disabled
			showSelectionToolbar={showSelectionToolbar} showStatusbar run={() => undefined}
		/>);
		assert.doesNotMatch(toolbar, /data-project-lock-notice|Edit here/u);
	}
});

test('claiming a lock disables repeat claims, then restores the action when acquisition finishes', async () => {
	let finish: (() => void) | undefined;
	let claims = 0;
	const acquisition = new Promise<void>((resolve) => { finish = resolve; });
	const fixture = await mountedToast(() => { claims += 1; return acquisition; });
	try {
		const claim = buttonByText(fixture.dom.container, ENGLISH_COPY.claimProjectLock);
		await act(async () => { reactProps(claim).onClick(); });
		assert.equal(claims, 1);
		const pending = buttonByText(fixture.dom.container, ENGLISH_COPY.claimingProjectLock);
		assert.ok(pending.hasAttribute('disabled'));
		await act(async () => { reactProps(pending).onClick(); });
		assert.equal(claims, 1);
		await act(async () => { finish?.(); await acquisition; });
		assert.ok(!buttonByText(fixture.dom.container, ENGLISH_COPY.claimProjectLock).hasAttribute('disabled'));
	} finally {
		finish?.();
		await fixture.cleanup();
	}
});

test('only the lock warning keeps compact status layout while unrelated errors remain readable', () => {
	for (const statusMessage of [ENGLISH_COPY.projectOpenOtherTab, 'Import failed: Unsupported audio']) {
		const markup = renderToStaticMarkup(<AccessibleSelectionToolbar
			controller={{ subscribeTelemetry: () => () => undefined, getTelemetrySnapshot: () => ({ taskProgress: null }) }}
			snapshot={{ selection: null, lockReadOnly: true }} copy={ENGLISH_COPY}
			statusMessage={statusMessage} statusState="error" durationFrames={0} disabled
			showSelectionToolbar={false} showStatusbar run={() => undefined}
		/>);
		assert.equal(markup.includes('data-project-lock-status'), statusMessage === ENGLISH_COPY.projectOpenOtherTab);
		assert.match(markup, /data-state="error"/u);
		assert.ok(markup.includes(statusMessage));
	}
});

test('closing the lock toast hides it without claiming write access', async () => {
	let claims = 0;
	const fixture = await mountedToast(() => { claims += 1; });
	try {
		await act(async () => { reactProps(buttonByText(fixture.dom.container, ENGLISH_COPY.close)).onClick(); });
		assert.equal(fixture.dom.find('[data-editor-toast]'), null);
		assert.equal(claims, 0);
	} finally {
		await fixture.cleanup();
	}
});

test('a rejected lock claim restores the action and reports the failure through the workspace runner', async () => {
	let fail: ((error: Error) => void) | undefined;
	const acquisition = new Promise<void>((_resolve, reject) => { fail = reject; });
	const failure = new Error('Editing lock unavailable');
	const fixture = await mountedToast(() => acquisition);
	try {
		await act(async () => {
			reactProps(buttonByText(fixture.dom.container, ENGLISH_COPY.claimProjectLock)).onClick();
		});
		assert.ok(buttonByText(fixture.dom.container, ENGLISH_COPY.claimingProjectLock).hasAttribute('disabled'));
		await act(async () => { fail?.(failure); await acquisition.catch(() => undefined); });
		assert.deepEqual(fixture.errors, [failure]);
		assert.ok(!buttonByText(fixture.dom.container, ENGLISH_COPY.claimProjectLock).hasAttribute('disabled'));
	} finally {
		await fixture.cleanup();
	}
});

function buttonByText(container: ReactTestElement, label: string): ReactTestElement {
	const button = container.querySelectorAll('button').find((candidate) => candidate.textContent === label);
	assert.ok(button, `Missing button ${label}`);
	return button;
}

async function mountedToast(claimLock: () => unknown) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const errors: unknown[] = [];
	await act(async () => root.render(<ProjectLockToast
		copy={ENGLISH_COPY} snapshot={{ lockReadOnly: true }}
		controller={{ actions: { project: { claimLock } } }} run={(operation) => {
			const result = operation();
			if (result instanceof Promise) void result.catch((error: unknown) => { errors.push(error); });
			return result;
		}}
	/>));
	return {
		dom,
		errors,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
