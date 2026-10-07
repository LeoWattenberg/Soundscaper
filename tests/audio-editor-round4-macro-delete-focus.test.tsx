/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MacroManagerLibraryList from '../src/common/editor/ui/inspector/MacroManagerLibraryList.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const destination of ['empty', 'remaining', 'other-control'] as const) {
	test(`macro deletion preserves the ${destination} keyboard destination`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let deletions = 0;
		const render = async (selectedId: string | null): Promise<void> => {
			await act(async () => { root.render(<>
				<button type="button" data-other-control>Other authoring</button>
				<MacroManagerLibraryList copy={ENGLISH_COPY} macros={[]} selectedId={null}
					exportDisabled scripts={{ entries: selectedId ? [{ id: selectedId, name: 'Program', trust: 'authored' }] : [],
						selectedId, heading: 'Programs', newProgram: 'New program', importProgram: 'Import program',
						exportProgram: 'Export program', deleteProgram: 'Delete program', notTrusted: 'Review',
						onSelect() {}, onCreate() {}, onImport() {}, onExport() {}, onDelete() { deletions += 1; } }}
					onSelect={() => undefined} onCreate={() => undefined} onImport={() => undefined}
					onExport={() => undefined} onDelete={() => undefined} />
			</>); });
		};
		try {
			await render('program-1');
			const remove = dom.one('[aria-label="Delete program"]');
			remove.focus();
			await act(async () => { reactProps(remove).onClick?.({ currentTarget: remove }); });
			const other = dom.one('[data-other-control]');
			if (destination === 'other-control') other.focus();
			await render(destination === 'remaining' ? 'program-2' : null);
			assert.equal(deletions, 1);
			assert.equal(document.activeElement, destination === 'remaining' ? remove
				: destination === 'other-control' ? other : dom.one('[aria-label="New program"]'));
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
