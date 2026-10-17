/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { framescaperBuildApplicationVersion, resolveFramescaperBuildLine } from '../scripts/lib/product-build-line.mjs';

test('Motionscaper cannot accidentally select the Framescaper successor schema line', () => {
	assert.equal(resolveFramescaperBuildLine('motionscaper', undefined), 'baseline');
	assert.equal(resolveFramescaperBuildLine('framescaper', ''), 'baseline');
	assert.equal(resolveFramescaperBuildLine('framescaper', 'successor'), 'successor');
	assert.throws(() => resolveFramescaperBuildLine('motionscaper', 'successor'), /only.*Framescaper/u);
	assert.throws(() => resolveFramescaperBuildLine('soundscaper', 'successor'), /only.*Framescaper/u);
	assert.throws(() => resolveFramescaperBuildLine('framescaper', 'latest'), /baseline or successor/u);
});

test('successor carries independent 1.1 development identity and leaves frozen line versions alone', () => {
	const repositoryRoot = new URL('../', import.meta.url).pathname;
	assert.equal(framescaperBuildApplicationVersion(repositoryRoot, 'baseline', '1.0.0-rc.13'), '1.0.0-rc.13');
	assert.equal(framescaperBuildApplicationVersion(repositoryRoot, 'successor', '1.0.0-rc.13'), '1.1.0-dev.1');
});

test('successor renderer cannot be packaged behind baseline Framescaper desktop metadata', () => {
	assert.throws(() => execFileSync(process.execPath, ['scripts/desktop-prepare.mjs'], {
		cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: 'pipe',
		env: { ...process.env, SCAPE_PRODUCT: 'framescaper', SCAPE_FRAMESCAPER_LINE: 'successor', SCAPE_FRAMESCAPER_DESKTOP_PROFILE: '' },
	}), /baseline desktop runtime cannot load Framescaper successor projects/u);
});
