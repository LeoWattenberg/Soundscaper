/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1, type VideoGeneratorDocumentV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const cases: readonly { generator: VideoGeneratorDocumentV1; selector: string; field: string }[] = [
	{ generator: { kind: 'solid', color: '#ffffffff' }, selector: '[data-visual-inspector-color]', field: 'color' },
	{ generator: { kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
		color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' }, selector: '[data-visual-inspector-color]', field: 'color' },
	{ generator: { kind: 'shape', shape: 'rectangle', fillColor: '#ffffffff', strokeColor: null, strokeWidth: 0 },
		selector: '[data-visual-inspector-color]', field: 'fillColor' },
	{ generator: { kind: 'sound-visualizer', mode: 'waveform', sourceIds: [], windowSeconds: 1,
		foregroundColor: '#ffffffff', backgroundColor: '#00000000' }, selector: '[data-visual-inspector-visualizer-foreground]', field: 'foregroundColor' },
	{ generator: { kind: 'sound-visualizer', mode: 'waveform', sourceIds: [], windowSeconds: 1,
		foregroundColor: '#ffffffff', backgroundColor: '#00000000' }, selector: '[data-visual-inspector-visualizer-background]', field: 'backgroundColor' },
];

for (const fixture of cases) {
	for (const draft of ['#123456ff', '#AABBCCDD']) {
		test(`${fixture.generator.kind} ${fixture.field} completes ${draft} without rewriting the live input`, async () => {
			const dom = installReactTestDom();
			const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
			const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
			Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
			environment.IS_REACT_ACT_ENVIRONMENT = true;
			const root = createRoot(dom.container as unknown as Element);
			const commits: unknown[] = [];
			try {
				await act(async () => root.render(<FramescaperVisualInspectorDialog project={projectFor(fixture.generator)}
					selectedClipId="visual" editingBlocked={false} readOnly={false}
					controller={{ actions: { edit: { commit: command => { commits.push(command); } } } }}
					run={operation => operation()} onClose={() => undefined} />));
				const color = dom.one(fixture.selector);
				await act(async () => reactProps(color).onChange({ currentTarget: { value: draft } }));
				assert.equal(reactProps(color).value, draft, 'native draft is preserved before Apply');
				await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
				assert.equal(commits.length, 1, 'ordinary RGBA text crosses the canonical document boundary');
				const command = commits[0] as { type: string; commands?: readonly { type: string; source?: { generator: Record<string, unknown> } }[] };
				const source = command.commands?.find(child => child.type === 'video-visual-source/set')?.source;
				assert.ok(source);
				assert.equal(source.generator[fixture.field], draft.toLowerCase());
			} finally {
				await act(async () => root.unmount());
				if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
				else Reflect.deleteProperty(globalThis, 'React');
				environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
				dom.restore();
			}
		});
	}
}

function projectFor(generator: VideoGeneratorDocumentV1) {
	const source = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator', id: 'visual-source',
		name: 'Visual', width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150, generator });
	const clip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'visual', sourceId: source.id,
		sequenceId: 'sequence', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 });
	return { schemaFamily: 'framescaper', schemaVersion: 1, selection: { clipIds: ['visual'] },
		sources: [source], clips: [clip], tracks: [{ id: 'picture', type: 'video', clipIds: ['visual'] }],
		projectBin: { clips: [] }, videoVisualPresentations: [], videoMaskMattes: [], videoVisualPresets: [] };
}
