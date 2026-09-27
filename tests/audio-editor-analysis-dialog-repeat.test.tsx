/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('repeat opens the remembered spectrum result in its analysis dialog', async () => {
	await checkRepeatedDialog(
		{ type: 'spectrum', scope: 'master', options: {} },
		{ type: 'spectrum', scope: 'master', startFrame: 10, endFrame: 30,
			bins: [{ frequency: 0, db: -120 }, { frequency: 440, db: -12 }],
			peak: { frequency: 440, db: -12 }, size: 32, sampleRate: 48_000 },
		'spectrum',
	);
});

test('repeat captures the remembered contrast role and shows its result', async () => {
	await checkRepeatedDialog(
		{ type: 'contrast', role: 'background', scope: 'master', options: {} },
		{ type: 'contrast', foreground: { rmsDb: -10 }, background: { rmsDb: -35 },
			differenceDb: 25, passes: true },
		'contrast',
	);
});

async function checkRepeatedDialog(request: Readonly<Record<string, unknown>>, report: Readonly<Record<string, unknown>>, mode: string) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let repeated = 0;
	const controller = { actions: { analysis: { repeatLast: async () => { repeated += 1; return report; } } } };
	const project = {
		id: 'analysis-project', title: 'Analysis project', sampleRate: 48_000,
		clips: [{ id: 'clip', timelineStartFrame: 10, durationFrames: 20 }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track'], clipIds: [] },
	};
	const snapshot = { project, selectedClipId: null, lastAnalysisRequest: request,
		ready: true, importing: false, recording: false, exporting: false, analysisProcessing: false,
		missingSourceIds: [] };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AnalysisDialog mode="repeat" controller={controller}
			snapshot={snapshot} copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
		assert.equal(repeated, 1);
		assert.equal(dom.one('[data-analysis-mode]').getAttribute('data-analysis-mode'), mode);
		assert.equal(dom.one('[data-analysis-repeat]').getAttribute('data-analysis-repeat'), 'true');
		assert.ok(dom.find(`[data-analysis-report="${mode}"]`));
		assert.equal(dom.one('[data-analysis-mode]').getAttribute('aria-modal'), mode === 'contrast' ? null : 'true');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}
