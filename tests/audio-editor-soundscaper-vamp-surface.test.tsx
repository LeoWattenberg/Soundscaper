/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import type { EnginePublicApi } from '../src/common/editor/engine/public-api.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import {
	createSoundscaperNativeServicesSurfaceHost,
	type SoundscaperVampAnalyzerSurfaceInput,
} from
	'../src/common/editor/ui/workspace/SoundscaperNativeServicesSurface.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('the workspace host mounts the Vamp surface only after its Analyze menu command opens', async () => {
	const rendered: React.ReactNode[] = [];
	const container = { dataset: {}, remove() {} } as unknown as HTMLElement;
	const documentValue = {
		createElement: () => container,
		body: { append() {} },
		querySelector: () => null,
	} as unknown as Document;
	const vampBridge = {
		listNativeVampAnalyzers: async () => [], startNativeVampAnalyzer: async () => ({}),
		configureNativeVampAnalyzer: async () => ({}), pushNativeVampAnalyzerPcm: async () => ({}),
		finishNativeVampAnalyzer: async () => ({}), cancelNativeVampAnalyzer: async () => true,
	} as unknown as SoundscaperNativeServicesBridge;
	const engine = {} as EnginePublicApi;
	const controller = {
		project: {
			id: 'project-a', revision: 7, sampleRate: 48_000, tracks: [],
		},
		actions: { edit: { commit: () => undefined } },
	};
	const input = Object.freeze({
		controller, durationFrames: 48_000, selectedTrackId: null, bridge: vampBridge, engine,
		projectToken: controller.project,
	}) satisfies SoundscaperVampAnalyzerSurfaceInput;
	const host = createSoundscaperNativeServicesSurfaceHost({
		bridge: {} as SoundscaperNativeServicesBridge,
		documentValue,
		createHostRoot: () => ({
			render: (node) => { rendered.push(node); },
			unmount: () => undefined,
		}),
	});
	assert.deepEqual(rendered, []);
	host.setVampAnalyzerInput(input);
	host.open('native-analyzer-use');
	assert.equal(rendered.length, 1);
	assert.ok(React.isValidElement(rendered[0]));
	const suspense = rendered[0] as React.ReactElement<{ readonly children: React.ReactNode }>;
	const dialog = suspense.props.children;
	assert.ok(React.isValidElement(dialog));
	const dialogElement = dialog as React.ReactElement<{ readonly vampAnalyzerInput?: unknown }>;
	assert.equal(dialogElement.props.vampAnalyzerInput, input);
	controller.project = { ...controller.project, revision: 8 };
	const refreshedInput = Object.freeze({ ...input, projectToken: controller.project });
	host.setVampAnalyzerInput(refreshedInput);
	assert.equal(rendered.length, 2, 'a project replacement refreshes the open analyzer fence');
	const refreshedSuspense = rendered[1] as React.ReactElement<{ readonly children: React.ReactNode }>;
	const refreshedDialog = refreshedSuspense.props.children as React.ReactElement<{
		readonly vampAnalyzerInput?: unknown;
	}>;
	assert.equal(refreshedDialog.props.vampAnalyzerInput, refreshedInput);
	assert.equal(container.dataset.editorSurface, 'soundscaper-native-services');
	await host.dispose();
});

test('the lazy Vamp surface fails closed when an older bridge lacks analyzer operations', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const [{ createRoot }, { default: SoundscaperVampAnalyzerSurface }] = await Promise.all([
		import('react-dom/client'),
		import('../src/common/editor/ui/workspace/SoundscaperVampAnalyzerSurface.tsx'),
	]);
	const root = createRoot(dom.container as unknown as Element);
	const controller = {
		project: { id: 'project-a', revision: 7, sampleRate: 48_000, tracks: [] },
		actions: { edit: { commit: () => undefined } },
	};
	try {
		await act(async () => root.render(<SoundscaperVampAnalyzerSurface
			input={{
				controller, durationFrames: 48_000, selectedTrackId: null,
				bridge: {} as SoundscaperNativeServicesBridge, engine: {} as EnginePublicApi,
				projectToken: controller.project,
			}}
			onClose={() => undefined}
		/>));
		assert.equal(dom.container.textContent, '');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
