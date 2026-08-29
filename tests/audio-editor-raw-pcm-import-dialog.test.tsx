/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { RawPcmImportDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('raw PCM import admits only one rapid submit while conversion and import remain pending', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const readPending = deferred<ArrayBuffer>();
	const readStarted = deferred<void>();
	const importPending = deferred<void>();
	const importStarted = deferred<void>();
	let reads = 0;
	let imports = 0;
	let closes = 0;
	const file = {
		name: 'voice.raw', size: 2, lastModified: 1,
		slice: () => ({
			arrayBuffer: () => {
				reads += 1;
				readStarted.resolve();
				return readPending.promise;
			},
		}),
	} as unknown as File;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<RawPcmImportDialog
			controller={{
				project: null,
				actions: {
					project: { importFiles: () => {
						imports += 1;
						importStarted.resolve();
						return importPending.promise;
					} },
					timelineAnnotations: { regularInterval: () => undefined },
				},
			}}
			copy={ENGLISH_COPY}
			run={(operation) => operation()}
			onClose={() => { closes += 1; }}
		/>));
		await act(async () => {
			reactProps(dom.one('input')).onChange({ currentTarget: { files: [file] } });
		});
		const form = dom.one('form');
		const submit = () => reactProps(form).onSubmit({ preventDefault() {} });
		await act(async () => {
			submit();
			submit();
			await readStarted.promise;
		});
		assert.equal(reads, 1, 'the second submit must not start another conversion');
		assert.equal(form.getAttribute('aria-busy'), 'true');
		assert.equal(dom.one('[type="submit"]').hasAttribute('disabled'), true);

		await act(async () => {
			readPending.resolve(new Uint8Array([0, 0]).buffer);
			await importStarted.promise;
		});
		assert.equal(imports, 1);
		await act(async () => {
			submit();
			await Promise.resolve();
		});
		assert.equal(reads, 1, 'the guard must remain held until project import settles');
		assert.equal(imports, 1);

		await act(async () => {
			importPending.resolve();
			await importPending.promise;
			await Promise.resolve();
		});
		assert.equal(closes, 1);
		assert.equal(form.getAttribute('aria-busy'), 'false');
		assert.equal(dom.one('[type="submit"]').hasAttribute('disabled'), false);
	} finally {
		readPending.resolve(new Uint8Array([0, 0]).buffer);
		importPending.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
}> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}
