/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import { createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { normalizeVideoGeneratorSourceV1, normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function projectFor() {
	const common = { schemaVersion: 1, kind: 'generator', width: 1920, height: 1080,
		frameRate: { num: 30, den: 1 }, frameCount: 150 };
	const title = normalizeVideoGeneratorSourceV1({ ...common, id: 'title-source', name: 'Title',
		generator: { kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
			color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' } });
	const visualizer = normalizeVideoGeneratorSourceV1({ ...common, id: 'visualizer-source', name: 'Visualizer',
		generator: { kind: 'sound-visualizer', mode: 'waveform', sourceIds: ['speech-source'],
			windowSeconds: 1, backgroundColor: '#00000000', foregroundColor: '#ffffffff' } });
	const titleClip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'title',
		sourceId: title.id, sequenceId: 'sequence', sequenceStartFrame: 0, sequenceFrameCount: 150,
		sourceInFrame: 0, sourceFrameCount: 150 });
	return { schemaFamily: 'framescaper', schemaVersion: 1, selection: { clipIds: ['title'] },
		sources: [title, visualizer, { id: 'speech-source', kind: 'audio', name: 'Speech' },
			{ id: 'other-source', kind: 'audio', name: 'Other sequence' }],
		clips: [titleClip, { id: 'speech', kind: 'audio', sourceId: 'speech-source' },
			{ id: 'other', kind: 'audio', sourceId: 'other-source' }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['title'] },
			{ id: 'audio', type: 'audio', clipIds: ['speech'] }, { id: 'other-audio', type: 'audio', clipIds: ['other'] }],
		sequences: [{ id: 'sequence', trackIds: ['picture', 'audio'] }, { id: 'other-sequence', trackIds: ['other-audio'] }],
		videoVisualPresentations: [], videoMaskMattes: [],
		videoVisualPresets: [{ schemaVersion: 1, kind: 'video-preset', id: 'saved', name: 'Speech display',
			modelKind: 'generator', authoredStateSha256: fingerprintNativeMediaPlan(visualizer).sha256 }],
	};
}

test('a Title Inspector includes its sequence audio for a selectable visualizer preset', () => {
	const model = createFramescaperVisualInspectorModel({ project: projectFor(), selectedClipId: 'title' });
	assert.equal(model.kind, 'title');
	assert.equal(model.presets[0]?.generator.kind, 'sound-visualizer');
	assert.deepEqual(model.audioSources, [{ id: 'speech-source', name: 'Speech' }]);
});

test('the mounted preset draft retains real audio choices before applying its generator change', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let commits = 0;
	try {
		await act(async () => { root.render(<FramescaperVisualInspectorDialog project={projectFor()}
			selectedClipId="title" editingBlocked={false} readOnly={false}
			controller={{ actions: { edit: { commit: () => { commits += 1; } } } }}
			run={operation => operation()} onClose={() => {}} />); });
		const picker = dom.one('[data-visual-inspector-preset]');
		await act(async () => { reactProps(picker).onChange({ currentTarget: { value: 'saved' } }); });
		const source = dom.one('[data-visual-inspector-visualizer-source="speech-source"]');
		assert.equal(reactProps(source).checked, true);
		assert.equal(dom.find('[data-visual-inspector-visualizer-source="other-source"]'), null);
		await act(async () => { reactProps(source).onChange({ currentTarget: { checked: false } }); });
		assert.equal(reactProps(source).checked, false);
		assert.equal(commits, 0, 'preset input remains a draft until ordinary Apply');
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
