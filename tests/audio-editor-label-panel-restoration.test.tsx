/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';

test('a restored labels panel waits for its project and then uses the real project sample rate', () => {
	let actions = 0;
	const project = { id: 'restored-project', sampleRate: 96_000,
		tracks: [{ id: 'labels-track', type: 'label', name: 'Captions', labels: [{ id: 'cue', title: 'Caption', startFrame: 24_000, endFrame: 168_000 }] }] };
	const props = {
		panelId: 'labels', controller: { getTelemetrySnapshot: () => { actions++; throw new Error('Unexpected project action while rendering.'); } },
		snapshot: { project: null as typeof project | null, productId: 'soundscaper', capabilities: {}, readOnly: false, selectedTrackId: 'labels-track' },
		copy: { loading: 'Loading project', newLabel: 'New label' }, locale: 'en', fileService: undefined,
		playbackMeterSettings: undefined, run: () => { actions++; throw new Error('Unexpected rendering action.'); },
		showArmControls: false, displayAudioSupported: false, onOpenEffects: undefined, effectsPanelTarget: undefined,
		onEffectWindowChange: undefined, blocked: false,
	};
	// Bridge only this fixture's labels branch; keep rendering the production component.
	const LabelsWorkspace = WorkspacePanelContent as unknown as (properties: typeof props) => React.ReactNode;
	const waiting = renderToStaticMarkup(<LabelsWorkspace {...props} />);
	assert.match(waiting, /role="status"/u); assert.match(waiting, /Loading project/u);
	assert.doesNotMatch(waiting, /button|data-labels-panel-list/u);
	const restored = LabelsWorkspace({ ...props, snapshot: { ...props.snapshot, project } });
	assert.ok(React.isValidElement<{ sampleRate: number; projectId: string; labels: readonly Readonly<{ id: string; startFrame: number; endFrame: number }>[] }>(restored));
	assert.equal(restored.props.sampleRate, 96_000); assert.equal(restored.props.projectId, 'restored-project');
	assert.deepEqual(restored.props.labels, [{ ...project.tracks[0]!.labels[0], trackId: 'labels-track', trackName: 'Captions' }]);
	assert.equal(actions, 0);
});
