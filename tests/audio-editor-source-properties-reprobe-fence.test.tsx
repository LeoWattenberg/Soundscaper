/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { SourcePropertiesPanel } from '../src/common/editor/ui/toolbar/SourcePropertiesPanel.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const PAL = Object.freeze({ num: 25, den: 1 });

test('a completed re-probe cannot publish its outcome beneath a newly inspected source', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const pending = deferred<unknown>();
	const calls: string[] = [];
	const onReprobe = (sourceId: string): Promise<unknown> => {
		calls.push(sourceId);
		return pending.promise;
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SourcePropertiesPanel
			source={source('source-a')}
			copy={ENGLISH_COPY}
			onReprobe={onReprobe}
		/>));
		await act(async () => {
			void reactProps(dom.one('[data-source-reprobe="source-a"]')).onClick?.();
			await Promise.resolve();
		});
		assert.deepEqual(calls, ['source-a']);

		await act(async () => root.render(<SourcePropertiesPanel
			source={source('source-b')}
			copy={ENGLISH_COPY}
			onReprobe={onReprobe}
		/>));
		assert.equal(dom.find('[data-source-reprobe-outcome="unchanged"]'), null);

		await act(async () => {
			pending.resolve({ upgraded: false });
			await pending.promise;
		});
		assert.equal(dom.find('[data-source-reprobe-outcome="unchanged"]'), null,
			'a source-a completion must not be reported as source-b\'s outcome');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function source(id: string): Readonly<Record<string, unknown>> {
	return Object.freeze({
		kind: 'video', id, name: `${id}.mov`, width: 1_024, height: 576,
		frameRate: PAL, sourceFrameCount: 250, videoCodec: 'unknown', audioCodec: null,
		timingDecision: Object.freeze({ mode: 'exact', rate: PAL, backend: 'ffmpeg' }),
	});
}

function deferred<Value>(): Readonly<{
	promise: Promise<Value>;
	resolve(value: Value): void;
}> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}
