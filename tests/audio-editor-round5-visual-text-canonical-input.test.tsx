/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { applyFramescaperOwnedVisualCommandVisual, snapshotFramescaperOwnedVisualCommandVisual } from '../src/framescaper/editor-project-visual-visual-command.ts';
import { applyFramescaperOwnedFinishingCommandFinishing, snapshotFramescaperOwnedFinishingCommandFinishing } from '../src/framescaper/editor-project-finishing-finishing-command.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['title', 'text'] as const) {
	test(`the mounted ${kind} editor canonicalizes completed text without changing its live draft`, async () => {
		const project = projectFor(kind);
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let commits = 0;
		try {
			await act(async () => { root.render(<FramescaperVisualInspectorDialog project={project}
				selectedClipId="title" editingBlocked={false} readOnly={false}
				controller={{ actions: { edit: { commit: command => {
					const batch = command as { readonly type: string; readonly commands?: readonly unknown[] };
					for (const child of batch.type === 'batch' ? batch.commands ?? [] : [command]) {
						if ((child as { type: string }).type === 'video-visual-presentation/set') {
							applyFramescaperOwnedFinishingCommandFinishing(project,
								snapshotFramescaperOwnedFinishingCommandFinishing(child));
						} else applyFramescaperOwnedVisualCommandVisual(project,
							snapshotFramescaperOwnedVisualCommandVisual(child));
					}
					commits += 1;
				} } } }} run={operation => operation()} onClose={() => {}} />); });
			const text = dom.one('[data-visual-inspector-text]');
			const authored = 'Cafe\u0301 recording\nNext take';
			await act(async () => { reactProps(text).onChange({ currentTarget: { value: authored } }); });
			assert.equal(reactProps(text).value, authored, 'composition stays native until Apply');
			assert.equal(commits, 0);
			await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); });
			assert.equal(commits, 1, 'ordinary Apply must admit canonically equivalent text');
			const source = project.sources[0];
			assert.ok(source?.generator.kind === 'title' || source?.generator.kind === 'text');
			assert.equal(source.generator.kind, kind);
			assert.equal(source.generator.text, 'Café recording\nNext take');
			assert.equal(source.generator.fontSize, 96);
			assert.equal(source.id, 'title-source');
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}

test('native document admission continues requiring canonical text', () => {
	const source = projectFor('title').sources[0];
	assert.ok(source?.generator.kind === 'title');
	assert.throws(() => normalizeVideoGeneratorSourceV1({ ...source,
		generator: { ...source.generator, text: 'Cafe\u0301 recording' },
	}), /canonical safe text/);
});

function projectFor(kind: 'title' | 'text') {
	const source = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator',
		id: 'title-source', name: 'Title', width: 1920, height: 1080,
		frameRate: { num: 30, den: 1 }, frameCount: 150,
		generator: { kind, text: 'Café', fontFamily: 'soundscaper-sans', fontSize: 96,
			color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' },
	});
	const clip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator',
		id: 'title', sourceId: source.id, sequenceId: 'sequence', sequenceStartFrame: 0,
		sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 });
	return { schemaFamily: 'framescaper', schemaVersion: 1, selection: { clipIds: ['title'] },
		sources: [source], clips: [clip], tracks: [{ id: 'picture', type: 'video', clipIds: ['title'] }],
		projectBin: { clips: [] as typeof clip[] }, videoVisualPresentations: [],
		videoMaskMattes: [], videoVisualPresets: [],
	};
}
