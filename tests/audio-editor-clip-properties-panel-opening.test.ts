/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openClipPropertiesPanel, type ClipPropertiesFocusRequest } from '../src/common/editor/controller/composition/clip-properties-panel-opening.ts';

function fixture() {
	const calls: string[] = [];
	const requests: ClipPropertiesFocusRequest[] = [];
	const ports = {
		closeSurface: () => { calls.push('close-overlay'); },
		showPanel: () => { calls.push('show-panel'); },
		requestFocus: (request: ClipPropertiesFocusRequest) => { requests.push(request); },
	};
	return { calls, requests, ports };
}

test('existing properties commands open the panel and focus their own clip field', () => {
	for (const [surface, field] of [['clip', null], ['clip-pitch', 'pitchCents'], ['clip-speed', 'speedRatio']] as const) {
		const f = fixture();
		assert.equal(openClipPropertiesPanel(surface, 'selected-clip', f.ports), true);
		assert.deepEqual(f.calls, ['close-overlay', 'show-panel']);
		assert.deepEqual(f.requests, [{ clipId: 'selected-clip', field }]);
	}
});

test('opening the same field again issues a fresh focus request without toggling the panel', () => {
	const f = fixture();
	openClipPropertiesPanel('clip-pitch', 'one', f.ports);
	openClipPropertiesPanel('clip-pitch', 'one', f.ports);
	assert.notEqual(f.requests[0], f.requests[1]);
	assert.equal(f.calls.filter((call) => call === 'show-panel').length, 2);
	assert.deepEqual(f.requests[0], f.requests[1]);
});

test('other surfaces keep their normal routing and make no panel changes', () => {
	const f = fixture();
	for (const surface of [null, undefined, 'preferences', 'video-composition', 'generator', 'clip-unknown']) {
		assert.equal(openClipPropertiesPanel(surface, null, f.ports), false);
	}
	assert.deepEqual(f.calls, []);
	assert.deepEqual(f.requests, []);
});

test('the properties panel can open without a selected clip and waits for selection', () => {
	const f = fixture();
	assert.equal(openClipPropertiesPanel('clip', null, f.ports), true);
	assert.deepEqual(f.requests, [{ clipId: null, field: null }]);
});
