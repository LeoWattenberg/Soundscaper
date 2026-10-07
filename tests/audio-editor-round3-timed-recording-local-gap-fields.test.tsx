/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import TimedRecordingDialogFields from '../src/common/editor/ui/dialogs/TimedRecordingDialogFields.tsx';
import type { TimedRecordingDialogValue } from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';
import { RECORDING_COPY_BY_LOCALE } from '../src/common/i18n/recording-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('timer fields associate localized gap validation with the invalid active date and clear it after repair', async () => {
	const dom = installReactTestDom();
	const previousTimeZone = process.env.TZ;
	process.env.TZ = 'Europe/Berlin';
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
		observe() {} disconnect() {}
	} });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const base: TimedRecordingDialogValue = { startTime: '2030-03-31T01:30',
		endTime: '2030-03-31T03:30', durationSeconds: 3_600, endMode: 'duration' };
	const render = async (value: TimedRecordingDialogValue, locale: 'en' | 'de' = 'en'): Promise<void> => {
		await act(async () => { root.render(<TimedRecordingDialogFields value={value}
			onValueChange={() => {}} onSubmit={() => {}} locale={locale}
			copy={RECORDING_COPY_BY_LOCALE[locale]} />); });
	};
	try {
		await render({ ...base, startTime: '2030-03-31T02:30' });
		const dates = dom.container.querySelectorAll('input').filter((input) => reactProps(input).type === 'datetime-local');
		assert.equal(dates.length, 2);
		assert.equal(dates[0]?.getAttribute('aria-invalid'), 'true');
		assert.equal(dates[0]?.getAttribute('aria-describedby'), dom.one('[role="alert"]').getAttribute('id'));
		assert.equal(dom.one('[role="alert"]').textContent, RECORDING_COPY_BY_LOCALE.en.timedRecordingInvalidLocalDateTime);
		await render({ ...base, endMode: 'end', endTime: '2030-03-31T02:30' }, 'de');
		assert.equal(dates[0]?.getAttribute('aria-invalid'), null);
		assert.equal(dates[1]?.getAttribute('aria-invalid'), 'true');
		assert.equal(dates[1]?.getAttribute('aria-describedby'), dom.one('[role="alert"]').getAttribute('id'));
		assert.equal(dom.one('[role="alert"]').textContent, RECORDING_COPY_BY_LOCALE.de.timedRecordingInvalidLocalDateTime);
		await render(base);
		assert.equal(dom.find('[role="alert"]'), null);
		assert.equal(dates[0]?.getAttribute('aria-invalid'), null);
		assert.equal(dates[1]?.getAttribute('aria-invalid'), null);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousTimeZone === undefined) delete process.env.TZ;
		else process.env.TZ = previousTimeZone;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
