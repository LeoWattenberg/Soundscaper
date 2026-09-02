/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationSelectors } from '../src/common/editor/ui/timeline/TrackAutomationSelectors.tsx';
import type { TrackAutomationTargetV21 } from '../src/common/editor/track-automation-targets-v21.ts';

const strip = Object.freeze({ kind: 'track' as const, id: 'voice' });

test('automation selectors expose disabled targets with their actual reason', () => {
	const available = target('gain', 'Volume', null);
	const reason = 'This processor requires the bounded schedule queue.';
	const blocked = target('pan', 'Pan', reason);
	const markup = renderToStaticMarkup(<TrackAutomationSelectors
		trackId="voice"
		targets={[available, blocked]}
		selectedTarget={available}
		copy={{ automationParameter: 'Automation parameter', automationMode: 'Automation mode' }}
		onTarget={() => undefined}
	/>);

	assert.match(markup, /Pan — This processor requires the bounded schedule queue\./u);
	assert.match(markup, /aria-label="Automation parameter"/u);
	assert.match(markup, /aria-label="Automation mode"/u);
});

function target(
	parameterId: 'gain' | 'pan',
	label: string,
	disabledReason: string | null,
): TrackAutomationTargetV21 {
	const descriptor = stripParameterDescriptor({ kind: 'strip', strip, parameterId });
	return Object.freeze({
		key: descriptor.id,
		address: descriptor.address,
		descriptor,
		label,
		groupLabel: 'Track',
		effectId: null,
		edgeId: null,
		currentValue: descriptor.defaultValue,
		lane: null,
		disabledReason,
	});
}
