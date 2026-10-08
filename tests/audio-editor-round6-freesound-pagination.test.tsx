/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import FreesoundPanel, { type FreesoundPanelState, type FreesoundSearchRequest } from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Freesound pagination follows the displayed results while preserving an unsubmitted query draft', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const requests: FreesoundSearchRequest[] = [];
	const state: FreesoundPanelState = {
		query: 'rain', license: 'commercial', sort: 'rating', page: 2, pageCount: 3,
		totalResults: 60, status: 'ready', previewingSoundId: null, previewPaused: false, results: [],
	};
	try {
		await act(async () => root.render(<FreesoundPanel copy={FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en}
			state={state} disabled={false} onSearch={request => { requests.push(request); }}
			onPreview={() => undefined} onPausePreview={() => undefined} onResumePreview={() => undefined}
			onSeekPreview={() => undefined} onInsertAtPlayhead={() => undefined} onAddToProjectBin={() => undefined} />));
		const input = dom.one('input');
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: 'wind' } }); });
		for (const [label, page] of [['Next', 3], ['Previous', 1]] as const) {
			const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label);
			assert.ok(button);
			await act(async () => { reactProps(button).onClick({}); });
			assert.deepEqual(requests.at(-1), { query: 'rain', license: 'commercial', sort: 'rating', page });
			assert.equal(input.value, 'wind', 'paging does not consume an unsubmitted draft');
		}
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); });
		assert.deepEqual(requests.at(-1), { query: 'wind', license: 'commercial', sort: 'rating', page: 1 });
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
