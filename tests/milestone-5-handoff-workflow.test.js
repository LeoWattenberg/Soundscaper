/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('desktop packaging publishes ten cells before one exact matrix assessment', async () => {
	const [workflow, metadata] = await Promise.all([
		readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8'),
		readFile(resolve(ROOT, 'package.json'), 'utf8').then(JSON.parse),
	]);
	assert.equal(
		metadata.scripts['milestone5:handoff-matrix'],
		'node scripts/aggregate-milestone-5-handoffs.mjs',
	);
	const packageStart = workflow.indexOf('\n  package:');
	const aggregateStart = workflow.indexOf('\n  milestone-5-handoff-matrix:');
	const nextJob = workflow.indexOf('\n  package-with-tests:', aggregateStart);
	assert.ok(packageStart > 0 && aggregateStart > packageStart && nextJob > aggregateStart);
	const packageJob = workflow.slice(packageStart, aggregateStart);
	const aggregateJob = workflow.slice(aggregateStart, nextJob);
	assert.match(packageJob, /strategy:\s+fail-fast: false\s+matrix:\s+product: \[soundscaper, framescaper\][\s\S]*?platform: win\s+arch: x64[\s\S]*?platform: win\s+arch: arm64[\s\S]*?platform: mac\s+arch: arm64[\s\S]*?platform: linux\s+arch: x64[\s\S]*?platform: linux\s+arch: arm64/u);
	assert.match(packageJob, /milestone-5-handoff-\$\{\{ matrix\.product \}\}-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}\.json/u);
	assert.match(aggregateJob, /needs: package/u);
	assert.match(aggregateJob, /needs\.package\.result == 'success'/u);
	assert.match(aggregateJob, /ref: \$\{\{ github\.sha \}\}/u);
	assert.match(aggregateJob, /Set up Node\.js[\s\S]*?run: npm ci[\s\S]*?Install cross-format package inspectors/u);
	assert.match(aggregateJob, /ci-apt-install\.sh p7zip-full squashfs-tools/u);
	assert.match(aggregateJob, /actions\/download-artifact@[a-f\d]{40}[\s\S]*?pattern: nightly-\*[\s\S]*?milestone-5-packages/u);
	assert.doesNotMatch(aggregateJob, /merge-multiple: true/u);
	assert.match(aggregateJob, /node scripts\/aggregate-milestone-5-handoffs\.mjs[\s\S]*?--package-directory[\s\S]*?--output/u);
	assert.match(aggregateJob, /SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(aggregateJob, /name: milestone-5-handoff-matrix[\s\S]*?milestone-5-handoff-matrix\.json/u);
	assert.doesNotMatch(packageJob, /--require-ready/u);
});
