/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const initiallyLocked of [false, true]) {
	test(`generator source fields follow a live owning track lock from ${initiallyLocked}`, async () => {
		const dom = installReactTestDom();
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let commits = 0;
		const controller = { actions: { edit: { commit: () => { commits++; } } } };
		const render = async (locked: boolean) => {
			await act(async () => root.render(<FramescaperVisualInspectorDialog project={projectFor(locked)}
				selectedClipId="solid" editingBlocked={false} readOnly={false} controller={controller}
				run={operation => operation()} onClose={() => undefined} />));
		};
		try {
			for (const locked of [initiallyLocked, !initiallyLocked, initiallyLocked]) {
				await render(locked);
				const color = dom.one('[data-visual-inspector-color]');
				assert.equal(color.hasAttribute('disabled'), locked, 'source editing follows the existing native lock contract');
				const opacity = dom.one('[data-visual-inspector-opacity]');
				assert.equal(opacity.hasAttribute('disabled'), false, 'presentation controls retain their existing admission');
				await act(async () => reactProps(opacity).onChange({ currentTarget: { valueAsNumber: 0.75 } }));
				await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
			}
			assert.equal(commits, 3);
		} finally {
			await act(async () => root.unmount());
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}

function projectFor(locked: boolean) {
	const source = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator',
		id: 'solid-source', name: 'Solid', width: 1920, height: 1080, frameRate: { num: 30, den: 1 },
		frameCount: 150, generator: { kind: 'solid', color: '#ffffffff' } });
	const clip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'solid',
		sourceId: source.id, sequenceId: 'sequence', sequenceStartFrame: 0, sequenceFrameCount: 150,
		sourceInFrame: 0, sourceFrameCount: 150 });
	return { schemaFamily: 'framescaper', schemaVersion: 1, selection: { clipIds: ['solid'] },
		sources: [source], clips: [clip], tracks: [{ id: 'picture', type: 'video', clipIds: ['solid'], locked }],
		projectBin: { clips: [] }, videoVisualPresentations: [], videoMaskMattes: [], videoVisualPresets: [] };
}
