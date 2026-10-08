/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { bindFramescaperSelectedAuthoringController } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { applyFramescaperOwnedVisualCommandVisual, snapshotFramescaperOwnedVisualCommandVisual } from '../src/framescaper/editor-project-visual-visual-command.ts';
import { applyFramescaperOwnedFinishingCommandFinishing, snapshotFramescaperOwnedFinishingCommandFinishing } from '../src/framescaper/editor-project-finishing-finishing-command.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const kind of ['visual', 'finishing'] as const) for (const moveFocus of [false, true]) {
	test(`production ${kind} preset removal ${moveFocus ? 'preserves deliberate focus' : 'recovers its picker'}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let project: Record<string, unknown> = {
			schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', revision: 0, sampleRate: 48_000,
			selection: { clipIds: ['picture'] }, primarySequenceId: 'sequence',
			sequences: [{ id: 'sequence', trackIds: ['track'], rate: { num: 30, den: 1 } }],
			tracks: [{ id: 'track', type: 'video', clipIds: ['picture'] }],
			clips: [{ id: 'picture', kind: 'generator', sourceId: 'source', sequenceId: 'sequence',
				sequenceStartFrame: 0, sequenceFrameCount: 150 }],
			sources: [{ id: 'source', kind: 'generator', name: 'Solid', generator: { kind: 'solid', color: '#000000ff' } }],
			videoAdjustmentLayers: [], videoVisualPresentations: [], videoMaskMattes: [], videoFreezeFallbacks: [],
			videoVisualPresets: kind === 'visual' ? [{ schemaVersion: 1, kind: 'video-preset', id: 'saved',
				name: 'Keyboard solid', modelKind: 'generator', authoredStateSha256: 'ab'.repeat(32) }] : [],
			videoFinishingPresets: kind === 'finishing' ? [{ schemaVersion: 1, kind: 'video-finishing-preset',
				id: 'saved', name: 'Keyboard finish', template: { enabled: true, opacity: 0.5, blendMode: 'screen', grade: null } }] : [],
		};
		let removal: ReactTestElement;
		let other: ReactTestElement;
		let commits = 0;
		const controller = { get project() { return project; },
			getSnapshot: () => ({ selectedClipId: 'picture' }), getTelemetrySnapshot: () => ({ positionFrame: 0 }),
			actions: { edit: { commit(value: unknown) {
				const next = structuredClone(project);
				if (kind === 'visual') applyFramescaperOwnedVisualCommandVisual(next, snapshotFramescaperOwnedVisualCommandVisual(value));
				else applyFramescaperOwnedFinishingCommandFinishing(next, snapshotFramescaperOwnedFinishingCommandFinishing(value));
				project = next;
				commits += 1;
				// Native disabling of the focused action loses focus to BODY; the public browser proves this behavior.
				if (moveFocus) other.focus();
				else removal.ownerDocument.body.focus();
				render();
			} } } };
		bindFramescaperSelectedAuthoringController({ controller, store: {} as AudioEditorProjectStore });
		const render = (): void => { root.render(<FramescaperSelectedVisualAuthoringDialog surface="video-visual-preset"
			controller={controller} project={project} selectedClipId="picture" playheadSample={0}
			editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => {}} />); };
		try {
			await act(async () => { render(); });
			removal = dom.one(`[data-framescaper-authoring-remove-${kind === 'visual' ? 'visual' : 'finishing'}]`);
			other = dom.one('[data-framescaper-authoring-preset-name]');
			const picker = dom.one(`[data-framescaper-authoring-${kind}-preset]`);
			removal.focus();
			await act(async () => { reactProps(removal).onClick(); });
			assert.equal(commits, 1);
			assert.equal(reactProps(removal).disabled, true);
			assert.equal(picker.value, '', 'the existing removed-identity reconciliation remains intact');
			assert.equal(picker.ownerDocument.activeElement === (moveFocus ? other : picker), true);
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
