/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	readProductReleaseLinesSync, resolveProductApplicationVersion,
	resolveProductDesktopMetadata, resolveProductReleaseTag, validateProductReleaseLines,
} from '../scripts/lib/product-release-lines.mjs';

test('Motionscaper has its own alpha application, desktop, and updater identity', () => {
	const lines = readProductReleaseLinesSync();
	assert.equal(resolveProductApplicationVersion('motionscaper', lines), '0.1.0-alpha.1');
	assert.deepEqual(resolveProductDesktopMetadata('motionscaper', lines), {
		schemaVersion: 1, id: 'motionscaper', applicationVersion: '0.1.0-alpha.1',
		applicationVersionChannel: 'candidate', releaseChannel: 'candidate',
		updateTagPrefix: 'motionscaper-v',
	});
	assert.deepEqual(resolveProductReleaseTag('motionscaper-v0.1.0-alpha.1', lines), {
		productId: 'motionscaper', channel: 'candidate', version: '0.1.0-alpha.1',
	});
	assert.throws(() => resolveProductReleaseTag('motionscaper-v1.0.0', lines), /not active/u);
});

test('Motionscaper release tags cannot impersonate a sibling product or use malformed alpha versions', () => {
	const lines = readProductReleaseLinesSync();
	for (const tagPrefix of ['v', 'soundscaper-v', 'framescaper-v']) {
		const changed = structuredClone(lines);
		changed.products.motionscaper.stable.tagPrefix = tagPrefix;
		assert.throws(() => validateProductReleaseLines(changed), /ownership/u);
	}
	for (const version of ['0.1.0-alpha.01', '0.1.0-alpha.', '0.1.0-preview.1']) {
		const changed = structuredClone(lines);
		changed.products.motionscaper.candidate.version = version;
		assert.throws(() => validateProductReleaseLines(changed), /version/u);
	}
});
