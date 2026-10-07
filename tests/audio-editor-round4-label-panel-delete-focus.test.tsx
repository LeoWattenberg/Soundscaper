/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const destination of ['next-row', 'new-label', 'other-control'] as const) {
	test(`label manager deletion preserves the ${destination} destination`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const removed: string[] = [];
		const controller = { actions: { labels: { remove(_trackId: string, id: string) { removed.push(id); },
			update() {}, add() {} }, timeline: { setSelection() {} } }, getTelemetrySnapshot: () => ({ positionFrame: 0 }) };
		const labels = [{ id: 'first', title: 'First', startFrame: 0, endFrame: 0 },
			{ id: 'second', title: 'Second', startFrame: 48000, endFrame: 48000 }];
		const render = async (ids: readonly string[]): Promise<void> => {
			await act(async () => { root.render(<>
				<button type="button" data-other-control>Other authoring</button>
				<WorkspacePanelContent panelId="labels" controller={controller} snapshot={{ project: { id: 'project', sampleRate: 48000,
					tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: labels.filter(label => ids.includes(label.id)) }] },
					selectedTrackId: 'labels', selection: { startFrame: 0, endFrame: 0 }, readOnly: false }}
					copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} fileService={null}
					playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
					onOpenEffects={() => undefined} effectsPanelTarget={null} onEffectWindowChange={() => undefined} blocked={false} />
			</>); });
		};
		try {
			await render(destination === 'next-row' ? ['first', 'second'] : ['first']);
			const remove = dom.one('[aria-label="Delete label: First"]');
			remove.focus();
			await act(async () => { reactProps(remove).onClick?.({ currentTarget: remove }); });
			const other = dom.one('[data-other-control]');
			if (destination === 'other-control') other.focus();
			await render(destination === 'next-row' ? ['second'] : []);
			assert.deepEqual(removed, ['first']);
			assert.equal(document.activeElement, destination === 'other-control' ? other
				: destination === 'next-row' ? dom.one('[aria-label="Delete label: Second"]')
					: dom.one('.kw-audio-editor__panel-actions-inline').querySelector('button'));
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
