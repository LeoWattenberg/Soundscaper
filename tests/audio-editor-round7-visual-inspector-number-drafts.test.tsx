/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1,
	type VideoGeneratorDocumentV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const cases: readonly { generator: VideoGeneratorDocumentV1; selector: string;
	draft: string; expected: number; field: string }[] = [
	{ generator: { kind: 'solid', color: '#ffffffff' }, selector: '[data-visual-inspector-opacity]',
		draft: '2.5e-1', expected: .25, field: 'opacity' },
	{ generator: { kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
		color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' },
		selector: '[data-visual-inspector-font-size]', draft: '1.2e2', expected: 120, field: 'fontSize' },
	{ generator: { kind: 'noise', mode: 'monochrome', grainSize: 2, seed: 42 },
		selector: '[data-visual-inspector-noise-grain-size]', draft: '3.2e1', expected: 32, field: 'grainSize' },
	{ generator: { kind: 'noise', mode: 'monochrome', grainSize: 2, seed: 42 },
		selector: '[data-visual-inspector-noise-seed]', draft: '1.2e3', expected: 1200, field: 'seed' },
	{ generator: { kind: 'sound-visualizer', mode: 'waveform', sourceIds: [], windowSeconds: 1,
		foregroundColor: '#ffffffff', backgroundColor: '#00000000' },
		selector: '[data-visual-inspector-visualizer-window]', draft: '7.5e-1', expected: .75, field: 'windowSeconds' },
];

for (const fixture of cases) {
	test(`Visual Inspector ${fixture.field} retains a native numeric draft until Apply`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = scope.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		scope.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const commits: unknown[] = [];
		try {
			await act(async () => root.render(<FramescaperVisualInspectorDialog project={projectFor(fixture.generator)}
				selectedClipId="visual" editingBlocked={false} readOnly={false} copy={{}}
				controller={{ actions: { edit: { commit: command => { commits.push(command); } } } }}
				run={operation => operation()} onClose={() => undefined} />));
			const field = dom.one(fixture.selector);
			for (const value of ['', fixture.draft]) {
				await act(async () => reactProps(field).onChange({ currentTarget: {
					value, valueAsNumber: value === '' ? NaN : Number(value),
				} }));
				assert.equal(reactProps(field).value, value, 'preserve the native text rather than reparsing prefixes');
				assert.equal(commits.length, 0);
				if (value === '') {
					await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
					assert.equal(commits.length, 0, 'a missing number cannot silently publish zero');
					assert.equal(reactProps(field).value, '');
					assert.match(dom.container.textContent, /requires a complete number/u);
				}
			}
			await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
			assert.equal(commits.length, 1);
			const command = commits[0] as { type: string; presentation?: { opacity: number };
				commands?: readonly { type: string; source?: { generator: Record<string, unknown> } }[] };
			if (fixture.field === 'opacity') assert.equal(command.presentation?.opacity, fixture.expected);
			else assert.equal(command.commands?.find(child => child.type === 'video-visual-source/set')
				?.source?.generator[fixture.field], fixture.expected);
		} finally {
			await act(async () => root.unmount());
			scope.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
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
