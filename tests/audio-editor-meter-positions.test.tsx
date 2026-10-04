/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MeterSettingsFlyout } from '../src/common/editor/ui/toolbar/AudioEditorMeters.jsx';
import { METERING_COPY_BY_LOCALE } from '../src/common/i18n/metering-copy.js';
import { DEFAULT_PLAYBACK_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';

test('meter positions expose one Panel option and Toolbar, without the legacy sidebar choice', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		const markup = renderToStaticMarkup(<MeterSettingsFlyout
			copy={{ ...METERING_COPY_BY_LOCALE.en, position: 'Position' }}
			settings={DEFAULT_PLAYBACK_METER_SETTINGS}
			onChange={() => {}}
		/>);
		assert.match(markup, />Toolbar</u);
		assert.match(markup, />Panel</u);
		assert.doesNotMatch(markup, /value="side"|Dockable panel|Top bar/u);
		assert.equal((markup.match(/name="meter-position-playback"/gu) ?? []).length, 3);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'React', previous);
		else Reflect.deleteProperty(globalThis, 'React');
	}
});
