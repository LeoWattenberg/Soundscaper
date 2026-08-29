/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { AnalysisPanel } from '../src/common/editor/ui/inspector/AnalysisPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('a late analysis failure cannot publish into a replacement project', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const contrast = deferred<void>();
	const controller = {
		actions: { analysis: {
			contrast: () => contrast.promise,
		} },
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderPanel = (projectId: string) => <AnalysisPanel
		mode="contrast"
		controller={controller}
		snapshot={snapshot(projectId)}
		copy={ENGLISH_COPY}
		fileService={undefined}
	/>;
	try {
		await act(async () => root.render(renderPanel('project-a')));
		await act(async () => {
			reactProps(buttonWithText(dom.container, ENGLISH_COPY.captureContrastForeground)).onClick({});
		});

		await act(async () => root.render(renderPanel('project-b')));
		await act(async () => {
			contrast.reject(new Error('Project A analysis failed.'));
			await contrast.promise.catch(() => undefined);
		});

		assert.equal(
			dom.container.textContent.includes('Project A analysis failed.'),
			false,
			'project B must not show project A failure state',
		);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function snapshot(projectId: string) {
	return {
		ready: true,
		project: {
			id: projectId,
			title: projectId,
			revision: 1,
			sampleRate: 48_000,
			clips: [{ id: 'shared-clip' }],
			tracks: [{ id: 'shared-track', type: 'audio' }],
		},
		selectedTrackId: 'shared-track',
		selection: { startFrame: 0, endFrame: 1_000 },
		importing: false,
		recording: false,
		exporting: false,
		analysisProcessing: false,
		missingSourceIds: [],
		analysis: null,
		analysisReport: null,
		analysisVisuals: null,
	};
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	let reject: (cause: Error) => void = () => undefined;
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
