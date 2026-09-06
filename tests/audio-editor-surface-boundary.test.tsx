/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import EditorSurfaceBoundary from '../src/common/editor/ui/EditorSurfaceBoundary.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

// The editor's root boundary replaces the whole application; this one keeps a
// failed surface the size of the surface. Both cases the user meets are here: a
// document one surface cannot draw, and the same document a moment later once
// it can.

function Surface({ revision, failing }: Readonly<{ revision: number; failing: boolean }>) {
	if (failing) throw new RangeError(`project.tracks must contain every track in exact hierarchy preorder (${String(revision)})`);
	return <span data-surface-content>drawn {revision}</span>;
}

test('a surface that cannot be drawn shows the message in its own place and leaves its siblings standing', async () => {
	const mounted = await mount(<>
		<span data-sibling>toolbar</span>
		<EditorSurfaceBoundary copy={ENGLISH_COPY} surface="timeline" resetKey={1}>
			<Surface revision={1} failing />
		</EditorSurfaceBoundary>
	</>);
	try {
		const alert = mounted.dom.one('[data-editor-surface-error="timeline"]');
		assert.equal(alert.getAttribute('role'), 'alert');
		assert.equal(
			alert.textContent,
			`${ENGLISH_COPY.surfaceRenderFailed}${ENGLISH_COPY.genericError.replace('{message}', 'project.tracks must contain every track in exact hierarchy preorder (1)')}`,
		);
		assert.equal(mounted.dom.find('[data-surface-content]'), null);
		assert.equal(mounted.dom.one('[data-sibling]').textContent, 'toolbar');
	} finally {
		await mounted.unmount();
	}
});

test('the surface comes back when the document moves on, and not before', async () => {
	const mounted = await mount(<EditorSurfaceBoundary copy={ENGLISH_COPY} surface="timeline" resetKey={1}>
		<Surface revision={1} failing />
	</EditorSurfaceBoundary>);
	try {
		assert.ok(mounted.dom.find('[data-editor-surface-error]'));
		// A re-render of the same document is not a reason to retry the same failure.
		await mounted.render(<EditorSurfaceBoundary copy={ENGLISH_COPY} surface="timeline" resetKey={1}>
			<Surface revision={1} failing={false} />
		</EditorSurfaceBoundary>);
		assert.ok(mounted.dom.find('[data-editor-surface-error]'));
		assert.equal(mounted.dom.find('[data-surface-content]'), null);

		await mounted.render(<EditorSurfaceBoundary copy={ENGLISH_COPY} surface="timeline" resetKey={2}>
			<Surface revision={2} failing={false} />
		</EditorSurfaceBoundary>);
		assert.equal(mounted.dom.find('[data-editor-surface-error]'), null);
		assert.equal(mounted.dom.one('[data-surface-content]').textContent, 'drawn 2');
	} finally {
		await mounted.unmount();
	}
});

async function mount(element: React.ReactElement) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	// React reports every caught render error through console.error as well;
	// the boundary is the assertion here, so the report stays out of the log.
	const priorConsoleError = console.error;
	console.error = () => undefined;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (next: React.ReactElement) => {
		await act(async () => root.render(next));
	};
	await render(element);
	return {
		dom,
		render,
		async unmount() {
			await act(async () => root.unmount());
			console.error = priorConsoleError;
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
