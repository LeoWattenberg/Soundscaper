/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import {
	CueImportDestinationDialog,
	useCueImportWorkspace,
} from '../src/common/editor/ui/workspace/cue-import-workspace.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('normal file import asks whether a CUE sheet becomes markers or labels', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const imports: Array<Readonly<{ file: File; destination: string }>> = [];
	let requestCueImport: ((file: File) => Promise<unknown>) | null = null;
	const controller = { actions: { labels: {
		importCueFile: (file: File, destination: string) => { imports.push({ file, destination }); return destination; },
	} } };
	function Harness() {
		const runtime = useCueImportWorkspace(controller);
		requestCueImport = runtime.requestCueImport;
		return <CueImportDestinationDialog copy={ENGLISH_COPY} runtime={runtime.cueImportDialog} />;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />));
		const file = { name: 'album.cue' } as File;
		let importing!: Promise<unknown>;
		await act(async () => { importing = requestCueImport!(file); });
		assert.match(dom.one('[data-cue-import-choice]').textContent, /album\.cue/u);
		await act(async () => {
			buttonWithText(dom.container, ENGLISH_COPY.panelMarkers).click();
			await importing;
		});
		assert.deepEqual(imports, [{ file, destination: 'markers' }]);
		assert.equal(dom.find('[data-cue-import-choice]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a project change cancels a pending CUE destination choice', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let requestCueImport: ((file: File) => Promise<unknown>) | null = null;
	const controller = { actions: { labels: {
		importCueFile: () => { throw new Error('A cancelled prompt must not import.'); },
	} } };
	function Harness({ projectId }: Readonly<{ projectId: string }>) {
		const runtime = useCueImportWorkspace(controller, projectId);
		requestCueImport = runtime.requestCueImport;
		return <CueImportDestinationDialog copy={ENGLISH_COPY} runtime={runtime.cueImportDialog} />;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness projectId="project-a" />));
		let importing!: Promise<unknown>;
		await act(async () => { importing = requestCueImport!({ name: 'album.cue' } as File); });
		await act(async () => root.render(<Harness projectId="project-b" />));
		assert.equal(await importing, null);
		assert.equal(dom.find('[data-cue-import-choice]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Missing button ${text}`);
	const props = reactProps(button);
	button.click = () => { void props.onClick({}); };
	return button;
}
