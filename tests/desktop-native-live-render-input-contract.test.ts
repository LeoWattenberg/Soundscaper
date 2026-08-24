/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { HELPER_DATA_CHUNK_MAXIMUM_BYTES } from '../desktop/helper-data-plane.ts';
import {
	framescaperNativeLiveRenderInputChunkRequest,
} from '../desktop/native-services-live-render-input-contract.ts';

const STAGE_ID = 'ab'.repeat(20);

test('main independently rejects a live renderer chunk above the 16 MiB data-plane limit', () => {
	const request = {
		stageId: STAGE_ID,
		role: 'evaluated-rgba-frame-pack',
		sequence: 0,
		offset: 0,
		bytes: new Uint8Array(HELPER_DATA_CHUNK_MAXIMUM_BYTES + 1),
	};
	assert.throws(
		() => framescaperNativeLiveRenderInputChunkRequest(request),
		/16 MiB|chunk.*limit|too large/iu,
	);
});
