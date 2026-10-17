/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { main as deploy } from '../scripts/deploy-pages.ts';
import { main as release } from '../scripts/verify-motionscaper-release.ts';
import { main as artifact } from '../scripts/motionscaper-release-web.ts';

test('Motion release and deploy CLIs reject incomplete or conflicting instructions before external operations', async () => {
	await assert.rejects(deploy(['--product=motionscaper', '--project=soundscaper'], {}), /project/u);
	await assert.rejects(deploy(['--product=motionscaper', '--unknown=publish'], {}), /Unknown option/u);
	await assert.rejects(release([]), /requires --tag/u);
	await assert.rejects(artifact([]), /requires --directory/u);
	await assert.rejects(artifact(['--operation=publish', '--directory=/missing', '--evidence=/missing', '--tag=motionscaper-v1.0.0', '--source-revision=main']), /operation/u);
});
