/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PreferenceNumberInput from '../src/common/editor/ui/dialogs/PreferenceNumberInput.tsx';
import RecordingOffsetInput from '../src/common/editor/ui/dialogs/RecordingOffsetInput.tsx';
import WaveformPreferencesPage from '../src/common/editor/ui/dialogs/WaveformPreferencesPage.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES } from '../src/common/editor/waveform-visualization-preferences.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const owner of ['preference', 'offset', 'waveform'] as const) {
	for (const key of ['Enter', 'Escape']) {
		test(`numeric ${owner} Preferences release composing ${key} without publishing or discarding their draft`, async () => {
			const dom = installReactTestDom();
			const root = createRoot(dom.container as unknown as HTMLElement);
			const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
			actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
			const writes: unknown[] = [];
			const draft = owner === 'waveform' ? '300' : '120';
			try {
				await act(async () => {
					root.render(owner === 'preference' ? <PreferenceNumberInput label="Precision" value={10}
						minimum={1} maximum={240} onCommit={value => { writes.push(value); }} />
						: owner === 'offset' ? <RecordingOffsetInput label="Offset" value={10}
							onCommit={value => { writes.push(value); }} />
						: <WaveformPreferencesPage copy={ENGLISH_COPY}
							preferences={{ waveformVisualization: DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES }}
							controller={{ actions: { preferences: { update: value => { writes.push(value); } } } }}
							run={operation => operation()} />);
				});
				const input = dom.container.querySelectorAll('input')[0];
				assert.ok(input);
				await act(async () => { reactProps(input).onChange({ currentTarget: { value: draft } }); });
				let prevented = false; let stopped = false;
				await act(async () => { reactProps(input).onKeyDown({ key, nativeEvent: { isComposing: true },
					currentTarget: { blur() { reactProps(input).onBlur({}); } },
					preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
				}); });
				assert.deepEqual(writes, [], 'the input method owns unfinished numeric text');
				assert.equal(input.value, draft, 'native Escape retains the application draft');
				assert.equal(prevented || stopped, false, 'native defaults and enclosing composition admission remain available');
				await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false },
					currentTarget: { blur() { reactProps(input).onBlur({}); } },
					preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
				}); });
				assert.equal(writes.length, 1, 'completed Enter retains ordinary numeric publication');
				assert.deepEqual(writes[0], owner === 'waveform'
					? { waveformVisualization: { ...DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES, lowMidCrossoverHz: 300 } }
					: 120);
			} finally {
				await act(async () => { root.unmount(); });
				dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			}
		});
	}
}
