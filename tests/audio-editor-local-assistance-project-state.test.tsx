/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import LocalAssistanceDialog from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import type { LocalAssistanceBridge } from '../src/common/editor/ui/local-assistance-bridge.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from '../src/common/editor/ui/local-assistance-preparation.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';
import { MODEL } from './helpers/local-assistance-fixtures.ts';

test('local assistance replaces project-scoped inventory when the active project changes', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const bridge = {
		models: async () => [MODEL],
		workflow: {
			custody: {}, readOutput: async () => new Blob(),
			onProgress: () => () => undefined,
		},
	} as unknown as LocalAssistanceBridge;
	let activeProjectId = 'project-a';
	const inventoryCalls: string[] = [];
	const preparation: LocalAssistanceSelectedMediaPreparationPort = {
		listSelectedMedia: async () => {
			inventoryCalls.push(activeProjectId);
			return { sources: [{
				sourceId: `${activeProjectId}-source`, label: `${activeProjectId} selection`,
				mediaKind: 'audio' as const, operations: ['speech-recognition' as const],
			}] };
		},
		prepareSelectedMedia: async () => { throw new Error('The test never starts a job.'); },
		prepareAdvancedWorkflow: async () => { throw new Error('The test never starts a workflow.'); },
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string) => <LocalAssistanceDialog
		projectId={projectId}
		bridge={bridge}
		preparation={preparation}
		copy={ENGLISH_COPY}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => {
			root.render(renderDialog('project-a'));
			await new Promise((resolve) => { setTimeout(resolve, 0); });
		});
		await act(async () => {
			void reactProps(buttonWithText(dom.container, 'Advanced')).onClick({});
		});
		assert.equal(dom.container.textContent.includes('project-a selection'), true,
			dom.container.textContent);

		activeProjectId = 'project-b';
		await act(async () => {
			root.render(renderDialog('project-b'));
			await new Promise((resolve) => { setTimeout(resolve, 0); });
		});
		await act(async () => {
			void reactProps(buttonWithText(dom.container, 'Advanced')).onClick({});
		});
		assert.deepEqual(inventoryCalls, ['project-a', 'project-b']);
		assert.equal(dom.container.textContent.includes('project-a selection'), false);
		assert.equal(dom.container.textContent.includes('project-b selection'), true);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}
