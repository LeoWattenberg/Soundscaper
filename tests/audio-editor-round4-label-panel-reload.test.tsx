/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a persisted Labels panel survives reload before the project arrives and retains its native rate', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const oldReact = globals.React; const oldAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const errors: unknown[] = [];
	const root = createRoot(dom.container as unknown as HTMLElement, { onUncaughtError: error => { errors.push(error); } });
	const selections: [number, number][] = [];
	const controller = { actions: {
		labels: { update() {}, remove() {}, add() {} },
		timeline: { setExactSelection(start: number, end: number) { selections.push([start, end]); } },
	}, getTelemetrySnapshot: () => ({ positionFrame: 0 }) };
	const project = createSoundscaperProject({ id: 'saved-captions', sampleRate: 44_100,
		tracks: [{ id: 'captions', type: 'label', name: 'Captions', labels: [
			{ id: 'intro', title: 'Edited intro', startFrame: 11_025, endFrame: 77_175 },
		] }] });
	const render = async (current: SoundscaperProject | null): Promise<void> => {
		await act(async () => root.render(<WorkspacePanelContent panelId="labels" controller={controller}
			snapshot={{ project: current, selectedTrackId: 'captions', selection: { startFrame: 0, endFrame: 0 }, readOnly: false }}
			copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} fileService={null}
			playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
			onOpenEffects={() => undefined} effectsPanelTarget={null} onEffectWindowChange={() => undefined} blocked={false} />));
	};
	try {
		await render(null);
		assert.deepEqual(errors, [], 'the restored panel can mount during ordinary project bootstrap');
		assert.equal(dom.find('[data-labels-panel-list]'), null);
		assert.equal(dom.find('button'), null, 'authoring waits for an actual project rather than a fallback rate');
		await render(project);
		const row = dom.one('[data-label-id="intro"]');
		assert.equal(row.querySelector('input')?.value, 'Edited intro');
		assert.deepEqual(row.querySelectorAll('[data-timecode-direct-entry]').map(input => input.value), ['0.250', '1.750']);
		const select = row.querySelector('.button--secondary');
		assert.ok(select);
		await act(async () => reactProps(select).onClick?.({ currentTarget: select }));
		assert.deepEqual(selections, [[11_025, 77_175]], 'the restored cue retains native sample boundaries');
		await render(null);
		assert.equal(dom.find('[data-label-id="intro"]'), null);
		assert.deepEqual(errors, [], 'a later reload also retires the old authoring list safely');
		await render(project);
		assert.equal(dom.one('[data-label-id="intro"]').querySelector('input')?.value, 'Edited intro');
		assert.deepEqual(errors, []);
	} finally {
		await act(async () => root.unmount());
		globals.React = oldReact; globals.IS_REACT_ACT_ENVIRONMENT = oldAct; dom.restore();
	}
});
