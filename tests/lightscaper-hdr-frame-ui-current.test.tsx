/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { bindFramescaperImageHdrMergeCurrentV1 } from '../src/framescaper/editor-selected-image-hdr-merge-current-v1.ts';
import { imageHdrMergeCopy } from '../src/common/i18n/image-hdr-merge-copy.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';

const SURFACE = new URL('../src/common/editor/ui/dialogs/FramescaperImageHdrMergeOwnerSurfaceCurrentV1.tsx', import.meta.url);
interface Props { readonly controller: object; readonly locale: string; readonly disabled: boolean; readonly onClose: () => void }
async function surface(): Promise<React.ComponentType<Props>> {
	assert.ok(existsSync(SURFACE), 'The menu-owned Frame HDR dialog surface is missing.');
	return (await import(SURFACE.href) as { default: React.ComponentType<Props> }).default;
}
function installCanvasGeometry() {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement'), widths = new WeakMap<object, number>(), heights = new WeakMap<object, number>();
	// This scalar UI test models geometry disposal only. Actual pixel painting
	// and native backing release are qualified in the focused browser workflow.
	class Canvas {
		get width() { return widths.get(this) ?? 0; } set width(value: number) { widths.set(this, value); }
		get height() { return heights.get(this) ?? 0; } set height(value: number) { heights.set(this, value); }
	}
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: Canvas });
	return () => { if (previous) Object.defineProperty(globalThis, 'HTMLCanvasElement', previous); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement'); };
}
function fixture() {
	const f = editableImageFixture(), source = { ...f.source, id: 'other-source', storageKey: 'other-source' }, clip = { ...f.clip, id: 'other-clip', sourceId: source.id, sequenceStartFrame: 1 };
	const project = applyFramescaperProjectCommand(PROFILE, f.project(), { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement: { scope: 'timeline', trackId: 'video-track' } },
	] });
	const selected = cloneFramescaperProject(PROFILE, { ...project, selection: { ...project.selection, clipIds: [f.clip.id, clip.id] } });
	let reads = 0;
	const controller = { project: selected, getSnapshot: () => ({ readOnly: false }), actions: { project: { async openById() { assert.fail('Opening the HDR dialog must not adopt a new project.'); } } } };
	// Actual selected native owner; storage/history publication are refusal
	// witnesses because scalar dialog open and stale handlers must not use them.
	bindFramescaperImageHdrMergeCurrentV1({ controller, store: { async loadMediaAsset() { reads++; assert.fail('No source pixels should be read.'); } },
		prepareCurrentProject() {},
		session: { captureProjectHistory() { assert.fail('Dialog open cannot capture publication history.'); }, assertProjectHistoryToken() { assert.fail('Dialog open cannot adopt history.'); },
			updateProjectHistory() { assert.fail('Dialog open cannot change history.'); }, markProjectSaved() { assert.fail('Dialog open cannot save.'); }, getProjectHistory() { assert.fail('Dialog open cannot read publication history.'); } },
		executeCommand() { assert.fail('Dialog open cannot edit the project.'); },
		async publishIfCurrent() { assert.fail('Dialog open and stale handlers cannot publish.'); },
	});
	return { controller, reads: () => reads };
}

for (const locale of ['en', 'de'] as const) test(`${locale}: the Frame surface opens the real native HDR selection without pixel reads or publication`, async () => {
	const Surface = await surface(), f = fixture(), copy = imageHdrMergeCopy(locale); let closed = 0;
	const restoreCanvas = installCanvasGeometry();
	const mounted = await mountPhotoImportUi(() => <Surface controller={f.controller} locale={locale} disabled={false} onClose={() => { closed++; }} />);
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-image-hdr-reference]') !== null; }, 'captured native Frame HDR selection');
		assert.equal(mounted.dom.container.querySelectorAll('[data-image-hdr-exposure-index]').length, 2); assert.equal(f.reads(), 0);
		const preview = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === copy.preview); assert.ok(preview);
		const retainedPreview = reactProps(preview).onClick;
		f.controller.project = cloneFramescaperProject(PROFILE, { ...f.controller.project, selection: { ...f.controller.project.selection, clipIds: [] } });
		await act(async () => { retainedPreview?.({}); await settle(); }); assert.equal(f.reads(), 0);
		const close = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === copy.close); assert.ok(close);
		await act(async () => { reactProps(close).onClick?.({}); await settle(); });
		await waitFor(() => closed === 1, 'native Frame HDR Close'); assert.equal(f.reads(), 0);
	} finally { try { await mounted.dispose(); } finally { restoreCanvas(); } }
});
