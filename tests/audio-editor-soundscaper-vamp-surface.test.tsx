/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import type { SoundscaperVampAnalyzerSession } from '../src/common/editor/ui/workspace/soundscaper-vamp-analyzer-runtime.ts';
import { createSoundscaperNativeServicesSurfaceHost } from
	'../src/common/editor/ui/workspace/SoundscaperNativeServicesSurface.tsx';

test('the workspace host mounts the Vamp surface only after its Analyze menu command opens', async () => {
	const rendered: React.ReactNode[] = [];
	const container = { dataset: {}, remove() {} } as unknown as HTMLElement;
	const documentValue = {
		createElement: () => container,
		body: { append() {} },
		querySelector: () => null,
	} as unknown as Document;
	const session = Object.freeze({
		projectId: 'project-a', projectRevision: 7, selectedTrackId: null, scope: 'master' as const,
		analyzerPort: { list: async () => [], analyze: async () => ({}) },
		startFrame: 0, endFrame: 48_000, sampleRate: 48_000,
		loadCatalog: async () => Object.freeze([]),
		analyze: async () => { throw new Error('not called'); },
		publishLabels: async () => undefined,
	}) satisfies SoundscaperVampAnalyzerSession;
	const host = createSoundscaperNativeServicesSurfaceHost({
		bridge: {} as SoundscaperNativeServicesBridge,
		documentValue,
		createHostRoot: () => ({
			render: (node) => { rendered.push(node); },
			unmount: () => undefined,
		}),
	});
	assert.deepEqual(rendered, []);
	host.setVampAnalyzerSession(session);
	host.open('native-analyzer-use');
	assert.equal(rendered.length, 1);
	assert.ok(React.isValidElement(rendered[0]));
	const suspense = rendered[0] as React.ReactElement<{ readonly children: React.ReactNode }>;
	const surface = suspense.props.children;
	assert.ok(React.isValidElement(surface));
	const surfaceElement = surface as React.ReactElement<{ readonly session?: unknown }>;
	assert.equal(surfaceElement.props.session, session);
	assert.equal(container.dataset.editorSurface, 'soundscaper-native-services');
	await host.dispose();
});
