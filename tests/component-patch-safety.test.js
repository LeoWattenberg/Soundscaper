import assert from 'node:assert/strict';
import test from 'node:test';

import { validateComponentPatch } from '../scripts/apply-component-patches.mjs';

const allowedPatch = `diff --git a/node_modules/@dilsonspickles/components/dist/Flyout.js b/node_modules/@dilsonspickles/components/dist/Flyout.js
--- a/node_modules/@dilsonspickles/components/dist/Flyout.js
+++ b/node_modules/@dilsonspickles/components/dist/Flyout.js
@@ -1 +1 @@
-old
+new
`;

test('component patches are confined to the pinned package distribution', () => {
	assert.doesNotThrow(() => validateComponentPatch(allowedPatch, 'allowed.patch'));
	assert.throws(
		() => validateComponentPatch(allowedPatch.replaceAll(
			'node_modules/@dilsonspickles/components/dist/Flyout.js',
			'node_modules/@dilsonspickles/components/dist/../../../../escape.js',
		), 'traversal.patch'),
		/escapes @dilsonspickles\/components\/dist/u,
	);
	assert.throws(
		() => validateComponentPatch(allowedPatch.replaceAll(
			'node_modules/@dilsonspickles/components/dist/Flyout.js',
			'src/common/editor/app.js',
		), 'outside.patch'),
		/escapes @dilsonspickles\/components\/dist/u,
	);
});

test('component patches reject file-system indirection and binary payloads', () => {
	for (const forbidden of [
		'rename from node_modules/@dilsonspickles/components/dist/Flyout.js',
		'copy to node_modules/@dilsonspickles/components/dist/Flyout-copy.js',
		'new file mode 120000',
		'old mode 120000',
		'GIT binary patch',
	]) {
		assert.throws(
			() => validateComponentPatch(`${allowedPatch}${forbidden}\n`, 'forbidden.patch'),
			/renames, copies, symlinks, and binary patches are not supported/u,
		);
	}
});
