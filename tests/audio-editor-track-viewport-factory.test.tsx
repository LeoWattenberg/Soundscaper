/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrackViewportRow } from '../src/common/editor/ui/timeline/TrackViewportRow.tsx';

test('unmounted viewport rows defer creating heavy child elements, including label rows', () => {
	let calls = 0;
	const render = (enabled: boolean) => renderToStaticMarkup(<TrackViewportRow
		enabled={enabled} trackId="labels" trackIndex={8} trackName="Labels" trackType="label"
		height={100} panelWidth={180} headerWidth={180} tabIndex={32}
	>{() => { calls += 1; return <span data-heavy-row>Labels</span>; }}</TrackViewportRow>);
	const placeholder = render(true);
	assert.equal(calls, 0);
	assert.match(placeholder, /data-label-track="true"/u);
	assert.match(placeholder, /data-track-mounted="false"/u);
	assert.doesNotMatch(placeholder, /data-heavy-row/u);
	assert.match(render(false), /data-heavy-row/u);
	assert.equal(calls, 1);
});
