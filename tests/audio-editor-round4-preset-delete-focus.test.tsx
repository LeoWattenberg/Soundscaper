/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const destination of ['picker', 'other-control', 'new-effect', 'pending'] as const) {
	test(`effect preset deletion preserves the ${destination} focus destination`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let deletions = 0;
		const render = async (selectedId: string, disabled = false, resetKey = 'reverb'): Promise<void> => {
			await act(async () => { root.render(<>
				<button type="button" data-other-control>Other authoring</button>
				<EffectPresetBar copy={ENGLISH_COPY} presets={selectedId ? [{ id: selectedId, label: 'Room', custom: true }] : []}
					selectedId={selectedId} disabled={disabled} resetKey={resetKey}
					onSelect={() => undefined} onSave={() => undefined} onSaveAs={() => undefined} onReset={() => undefined}
					onDelete={() => { deletions += 1; }} onImport={() => undefined} onExport={() => undefined} />
			</>); });
		};
		try {
			await render('room');
			const remove = dom.one('[aria-label="Delete preset"]');
			remove.focus();
			await act(async () => { reactProps(remove).onClick?.({ currentTarget: remove }); });
			const other = dom.one('[data-other-control]');
			if (destination === 'other-control') other.focus();
			if (destination === 'pending') {
				await render('room', true);
				assert.equal(document.activeElement, remove);
			}
			await render('', false, destination === 'new-effect' ? 'compressor' : 'reverb');
			assert.equal(deletions, 1);
			assert.equal(document.activeElement, destination === 'other-control' ? other
				: destination === 'new-effect' ? remove : dom.one('.dropdown__trigger'));
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
