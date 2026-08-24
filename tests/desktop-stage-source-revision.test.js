/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveDesktopSourceRevision,
	resolveDesktopStageTarget,
} from '../scripts/desktop-prepare.mjs';
import { resolveNativeAddonPayloadTarget } from '../scripts/lib/native-addon-payload-manifest.mjs';

test('desktop stage source revision is nullable and otherwise one exact Git object ID', () => {
	assert.equal(resolveDesktopSourceRevision(undefined), null);
	assert.equal(resolveDesktopSourceRevision(''), null);
	assert.equal(resolveDesktopSourceRevision(`  ${'a'.repeat(40)}  `), 'a'.repeat(40));
	assert.equal(resolveDesktopSourceRevision('b'.repeat(64)), 'b'.repeat(64));
	for (const value of ['A'.repeat(40), 'a'.repeat(39), `${'a'.repeat(40)}-dirty`]) {
		assert.throws(() => resolveDesktopSourceRevision(value), /source revision/iu);
	}
});

test('desktop stage target follows the resolved declared or build-host native target', () => {
	const declared = resolveNativeAddonPayloadTarget({ platform: 'win', arch: 'arm64' });
	assert.deepEqual(resolveDesktopStageTarget(declared), { platform: 'win', arch: 'arm64' });

	const buildHost = resolveNativeAddonPayloadTarget({
		platform: null,
		arch: null,
		hostPlatform: 'linux',
		hostArch: 'x64',
	});
	assert.equal(buildHost.source, 'build-host');
	assert.deepEqual(resolveDesktopStageTarget(buildHost), { platform: 'linux', arch: 'x64' });
	assert.throws(
		() => resolveDesktopStageTarget({ id: 'linux-invented', source: 'build-host' }),
		/desktop target/iu,
	);
});
