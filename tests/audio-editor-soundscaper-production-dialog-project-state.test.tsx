/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import SoundscaperProductionDialog from '../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx';
import { SOUNDSCAPER_PRODUCTION_COPY } from '../src/common/editor/ui/soundscaper-production-copy.ts';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('production work from another project cannot retain or publish dialog state', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const first = deferred<void>();
	let calls = 0;
	const actions = {
		execute: () => {
			calls += 1;
			return calls === 1 ? first.promise : undefined;
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string) => <SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={{ audioAnalysis: true }}
		snapshot={{ project: project(projectId) }}
		initialSurface="metering"
		actions={actions}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => root.render(renderDialog('project-a')));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.resetMeters)).onClick({});
			await Promise.resolve();
		});
		assert.equal(calls, 1);

		await act(async () => root.render(renderDialog('project-b')));
		assert.equal(dom.container.textContent.includes(`${SOUNDSCAPER_PRODUCTION_COPY.metersTab}…`), false);
		await act(async () => {
			void reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.resetMeters)).onClick({});
			await Promise.resolve();
		});
		assert.equal(calls, 2, 'project B must not inherit project A busy state');
		assert.equal(dom.container.textContent.includes(SOUNDSCAPER_PRODUCTION_COPY.operationComplete), true);

		await act(async () => {
			first.reject(new Error('project A failed'));
			await first.promise.catch(() => undefined);
			await Promise.resolve();
		});
		assert.equal(dom.container.textContent.includes('project A failed'), false);
		assert.equal(dom.container.textContent.includes(SOUNDSCAPER_PRODUCTION_COPY.operationComplete), true);
	} finally {
		first.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function project(id: string) {
	return {
		id,
		schemaFamily: 'soundscaper' as const,
		schemaVersion: 1 as const,
		sampleRate: 48_000,
		tracks: [],
	};
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	let reject: (reason?: unknown) => void = () => undefined;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}
