/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RawPcmImportDialog, RegularIntervalAnnotationDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const raw of [true, false]) {
	test(`the ${raw ? 'raw import' : 'regular labels'} owner releases writable admission when its lease changes`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let calls = 0;
		let closes = 0;
		const running: Promise<unknown>[] = [];
		const project = { id: 'recording', primarySequenceId: 'main', sampleRate: 48_000, clips: [] };
		const controller = {
			project,
			actions: {
				project: { importFiles: () => { calls++; } },
				timelineAnnotations: { regularInterval: () => { calls++; } },
			},
		};
		const render = async (readOnly: boolean) => {
			const props = {
				controller, copy: ENGLISH_COPY, snapshot: { readOnly },
				run: (operation: () => unknown) => {
					const result = Promise.resolve(operation());
					running.push(result);
					return result;
				},
				onClose: () => { closes++; },
			};
			await act(async () => root.render(raw ? <RawPcmImportDialog {...props} /> : <RegularIntervalAnnotationDialog {...props} />));
		};
		const action = (label: string) => {
			const result = dom.container.querySelectorAll('button').find(button => button.textContent === label);
			assert.ok(result);
			return result;
		};
		try {
			await render(false);
			if (raw) await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: {
				files: [new File([new Uint8Array([0, 0])], 'ordinary.raw')],
			} }));
			const submit = action(raw ? ENGLISH_COPY.importFile : ENGLISH_COPY.regularIntervalCreate);
			assert.equal(submit.hasAttribute('disabled'), false);
			const staleSubmit = reactProps(dom.one('form')).onSubmit;
			await render(true);
			assert.equal(submit.hasAttribute('disabled'), true, 'the open surface follows the live writer lease');
			assert.equal(action(ENGLISH_COPY.cancel).hasAttribute('disabled'), false);
			await act(async () => {
				staleSubmit({ preventDefault() {} });
				await Promise.all(running);
			});
			assert.equal(calls, 0, 'a saved form callback cannot start an unavailable write');
			assert.equal(closes, 0);
			await render(false);
			assert.equal(submit.hasAttribute('disabled'), false);
			await act(async () => {
				reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
				await Promise.all(running);
			});
			assert.equal(calls, 1, 'normal writable completion remains available');
			assert.equal(closes, 1);
		} finally {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
