/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RawPcmImportDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [fieldIndex, label] of ['sample rate', 'channel count', 'byte offset'].entries()) {
	test(`raw PCM ${label} preserves its empty prefix until a complete validated submission`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const pending: Promise<unknown>[] = [];
		let imported: File | null = null;
		let closes = 0;
		try {
			await act(async () => { root.render(<RawPcmImportDialog copy={ENGLISH_COPY}
				controller={{ project: null, actions: {
					project: { importFiles: (files: readonly File[]) => { imported = files[0] ?? null; } },
					timelineAnnotations: { regularInterval: () => undefined },
				} }} onClose={() => { closes += 1; }} run={operation => {
					const result = Promise.resolve(operation()); pending.push(result); return result;
				}} />); });
			const inputs = dom.container.querySelectorAll('input').filter(input => reactProps(input).type === 'number');
			const field = inputs[fieldIndex]; assert.ok(field);
			await act(async () => { reactProps(field).onChange({ currentTarget: { value: '' } }); });
			assert.equal(field.value, '', 'the native empty exponent/sign prefix must not be rewritten to zero');
			for (const [index, value] of ['4.8e4', '2', '2'].entries()) {
				const input = inputs[index]; assert.ok(input);
				await act(async () => { reactProps(input).onChange({ currentTarget: { value } }); });
			}
			assert.equal(inputs[0]?.value, '4.8e4', 'keep the complete spelling until submission');
			const fileInput = dom.container.querySelectorAll('input').find(input => reactProps(input).type === 'file'); assert.ok(fileInput);
			await act(async () => { reactProps(fileInput).onChange({ currentTarget: {
				files: [new File([new Uint8Array([90, 90, 1, 0, 2, 0, 3, 0, 4, 0])], 'voice.raw')],
			} }); });
			await act(async () => {
				reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
				await Promise.all(pending);
			});
			assert.ok(imported);
			const header = new DataView(await (imported as File).arrayBuffer());
			assert.equal(header.getUint32(24, true), 48_000, 'the completed scientific rate reaches the actual WAV header');
			assert.equal(header.getUint16(22, true), 2, 'channel count is converted on submission');
			assert.equal(header.getUint32(40, true), 8, 'the complete byte offset retains the intended PCM body');
			assert.equal(header.getInt16(44, true), 1);
			assert.equal(closes, 1);
		} finally {
			await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		}
	});
}
