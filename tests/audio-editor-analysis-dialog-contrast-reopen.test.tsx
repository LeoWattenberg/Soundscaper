/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('Contrast restores the current saved report without recapture and clears it on a project switch', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const project = {
		id: 'first', title: 'Project', sampleRate: 48_000,
		clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 48_000 }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		selection: { startFrame: 0, endFrame: 48_000, trackIds: ['track'], clipIds: [] },
	};
	const snapshot = { project, ready: true, analysisProcessing: false, missingSourceIds: [],
		analysisReport: { type: 'contrast', foreground: { rmsDb: -10 }, background: { rmsDb: -35 },
			differenceDb: 25, passes: true } };
	const controller = { actions: { analysis: { contrast: () => { throw new Error('Unexpected recapture.'); } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AnalysisDialog mode="contrast" controller={controller}
			snapshot={snapshot} copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
		assert.ok(dom.find('[data-analysis-report="contrast"]'));
		assert.match(dom.one('[data-analysis-report="contrast"]').textContent, /25\.00 dB/u);
		await act(async () => root.render(<AnalysisDialog mode="contrast" controller={controller}
			snapshot={{ ...snapshot, project: { ...project, id: 'second' }, analysisReport: null }}
			copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
		assert.equal(dom.find('[data-analysis-report="contrast"]'), null);
		await act(async () => root.render(<AnalysisDialog mode="contrast" controller={controller}
			snapshot={{ ...snapshot, project: { ...project, id: 'third' }, analysisReport: { type: 'levels' } }}
			copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
		assert.equal(dom.find('[data-analysis-report="contrast"]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
