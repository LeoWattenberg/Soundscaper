/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { nativeDeliveryTargetExecution } from '../src/framescaper/delivery-native-target-execution-v1.ts';

test('native delivery target admission requires a catalogued V15 execution and exact profile', () => {
	assert.throws(
		() => nativeDeliveryTargetExecution('no-such-target', 'encode-mov-prores-422-hq'),
		/target no-such-target is not in the platform catalog/u,
	);
	assert.throws(
		() => nativeDeliveryTargetExecution('native-mezzanine-prores', 'encode-mov-prores-4444'),
		/does not select exact profile encode-mov-prores-4444/u,
	);
	assert.equal(nativeDeliveryTargetExecution('native-mezzanine-prores', 'encode-mov-prores-422-hq').profileId,
		'encode-mov-prores-422-hq');
});
