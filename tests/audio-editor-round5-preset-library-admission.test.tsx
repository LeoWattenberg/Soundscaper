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

for (const kind of ['visual', 'finishing'] as const) for (const selected of [false, true]) {
	test(`production ${kind} library removes a saved preset ${selected ? 'with' : 'without'} a selected generator`, async () => {
		const fixture = await mountPresets({ kind, selected });
		try {
			const picker = fixture.dom.one(`[data-framescaper-authoring-${kind}-preset]`);
			const removal = fixture.dom.one(`[data-framescaper-authoring-remove-${kind}]`);
			assert.equal(effectivelyDisabled(picker), false, 'library browsing does not require an edit target');
			assert.equal(effectivelyDisabled(removal), false, 'the actual native removal command is targetless');
			assert.equal(effectivelyDisabled(fixture.dom.one('[data-framescaper-authoring-save-visual]')), !selected);
			assert.equal(effectivelyDisabled(fixture.dom.one(`[data-framescaper-authoring-apply-${kind}]`)), !selected);
			const before = structuredClone(fixture.project());
			removal.focus();
			await act(async () => { reactProps(removal).onClick(); });
			assert.equal(fixture.commits(), 1);
			assert.deepEqual(fixture.project()[kind === 'visual' ? 'videoVisualPresets' : 'videoFinishingPresets'], []);
			assert.deepEqual(fixture.project().clips, before.clips);
			assert.deepEqual(fixture.project().sources, before.sources);
			assert.deepEqual(fixture.project().selection, before.selection);
			assert.equal(picker.value, '');
			assert.equal(effectivelyDisabled(removal), true);
			assert.equal(picker.ownerDocument.activeElement === picker, true, 'removal keeps keyboard library access');
		} finally { await fixture.cleanup(); }
	});
}

for (const gate of ['readOnly', 'editingBlocked'] as const) {
	test(`production targetless preset library preserves ${gate} admission`, async () => {
		const fixture = await mountPresets({ kind: 'visual', selected: false, [gate]: true });
		try {
			const removal = fixture.dom.one('[data-framescaper-authoring-remove-visual]');
			assert.equal(effectivelyDisabled(removal), true);
			assert.equal(effectivelyDisabled(fixture.dom.one('[data-framescaper-authoring-visual-preset]')), true);
			await act(async () => { reactProps(removal).onClick(); });
			assert.equal(fixture.commits(), 0, 'the guarded production action cannot bypass the writer admission');
		} finally { await fixture.cleanup(); }
	});
}

test('production finishing Apply refuses an audio target while retaining library removal', async () => {
	const fixture = await mountPresets({ kind: 'finishing', selected: true, clipKind: 'audio' });
	try {
		assert.equal(effectivelyDisabled(fixture.dom.one('[data-framescaper-authoring-apply-finishing]')), true);
		assert.equal(effectivelyDisabled(fixture.dom.one('[data-framescaper-authoring-remove-finishing]')), false);
		assert.equal(effectivelyDisabled(fixture.dom.one('[data-framescaper-authoring-finishing-preset]')), false);
		assert.equal(effectivelyDisabled(fixture.dom.one('[data-framescaper-authoring-save-visual]')), true);
		assert.equal(fixture.commits(), 0);
	} finally { await fixture.cleanup(); }
});

function effectivelyDisabled(control: ReactTestElement): boolean {
	const fieldset = control.closest('fieldset');
	return Boolean(reactProps(control).disabled || (fieldset && reactProps(fieldset).disabled));
}

async function mountPresets(options: Readonly<{
	kind: 'visual' | 'finishing'; selected: boolean; clipKind?: 'generator' | 'audio'; readOnly?: boolean; editingBlocked?: boolean;
}>) {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	let project: Record<string, unknown> = {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', revision: 0, sampleRate: 48_000,
		selection: { clipIds: options.selected ? ['picture'] : [] }, primarySequenceId: 'sequence',
		sequences: [{ id: 'sequence', trackIds: ['track'], rate: { num: 30, den: 1 } }],
		tracks: [{ id: 'track', type: options.clipKind === 'audio' ? 'audio' : 'video', clipIds: ['picture'] }],
		clips: [{ id: 'picture', kind: options.clipKind ?? 'generator', sourceId: 'source', sequenceId: 'sequence', sequenceStartFrame: 0, sequenceFrameCount: 150 }],
		sources: options.clipKind === 'audio' ? [{ id: 'source', kind: 'audio', name: 'Voice', sampleRate: 48_000, channels: 1, frames: 48_000 }]
			: [{ id: 'source', kind: 'generator', name: 'Solid', generator: { kind: 'solid', color: '#000000ff' } }],
		videoAdjustmentLayers: [], videoVisualPresentations: [], videoMaskMattes: [], videoFreezeFallbacks: [],
		videoVisualPresets: options.kind === 'visual' ? [{ schemaVersion: 1, kind: 'video-preset', id: 'saved',
			name: 'Keyboard solid', modelKind: 'generator', authoredStateSha256: 'ab'.repeat(32) }] : [],
		videoFinishingPresets: options.kind === 'finishing' ? [{ schemaVersion: 1, kind: 'video-finishing-preset',
			id: 'saved', name: 'Keyboard finish', template: { enabled: true, opacity: 0.5, blendMode: 'screen', grade: null } }] : [],
	};
	let commits = 0;
	const controller = { get project() { return project; },
		getSnapshot: () => ({ selectedClipId: options.selected ? 'picture' : null }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }), actions: { edit: { commit(value: unknown) {
			const next = structuredClone(project);
			if (options.kind === 'visual') applyFramescaperOwnedVisualCommandVisual(next, snapshotFramescaperOwnedVisualCommandVisual(value));
			else applyFramescaperOwnedFinishingCommandFinishing(next, snapshotFramescaperOwnedFinishingCommandFinishing(value));
			project = next;
			commits += 1;
			render();
		} } } };
	bindFramescaperSelectedAuthoringController({ controller, store: {} as AudioEditorProjectStore });
	const render = (): void => root.render(<FramescaperSelectedVisualAuthoringDialog surface="video-visual-preset"
		controller={controller} project={project} selectedClipId={options.selected ? 'picture' : null}
		playheadSample={0} editingBlocked={options.editingBlocked ?? false} readOnly={options.readOnly ?? false}
		run={operation => operation()} onClose={() => {}} />);
	await act(async () => { render(); });
	return { dom, project: () => project, commits: () => commits, cleanup: async () => {
		await act(async () => root.unmount());
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	} };
}
