/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContainerAddTrackFlyout } from '../src/common/editor/ui/timeline/TimelineFlyouts.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('add-track view toggles use design-system checkboxes without adding a keyboard stop', () => {
	const markup = renderToStaticMarkup(<ContainerAddTrackFlyout
		isOpen
		onSelectTrackType={() => undefined}
		mutationsBlocked
		showMasterTrack
		onToggleMasterTrack={() => undefined}
		markersAvailable
		showMarkers={false}
		onToggleMarkers={() => undefined}
		onClose={() => undefined}
		x={0}
		y={0}
		autoFocus={false}
		triggerRef={undefined}
		copy={ENGLISH_COPY}
	/>);
	const toggles = [...markup.matchAll(/<button[^>]*role="menuitemcheckbox"[^>]*>[\s\S]*?<\/button>/gu)].map((match) => match[0]);
	assert.equal(toggles.length, 2);
	for (const toggle of toggles) {
		assert.match(toggle, /<span class="add-track-flyout__checkbox-box" aria-hidden="true"><div class="checkbox /u);
		assert.match(toggle, /role="checkbox"[^>]*tabindex="-1"/iu);
	}
	assert.match(toggles[0] ?? '', /checkbox--checked[^>]*checkbox--disabled/u);
	assert.match(toggles[0] ?? '', /class="checkbox__icon"/u);
	assert.match(toggles[1] ?? '', /checkbox--unchecked/u);
	assert.doesNotMatch(toggles[1] ?? '', /checkbox--disabled/u, 'markers remain available while audio mutations are blocked');
});
