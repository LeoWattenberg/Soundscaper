/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { selectDesktopNightlyTestTargets } from '../scripts/lib/desktop-nightly-tests-target-matrix.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (source: string) => unknown };

function record(value: unknown): Record<string, unknown> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

test('every ARM runner installs native Node before installing dependencies', () => {
	let checked = 0;
	for (const name of readdirSync(resolve(root, '.github/workflows'))) {
		if (!name.endsWith('.yml')) continue;
		const workflow = record(load(readFileSync(resolve(root, '.github/workflows', name), 'utf8')));
		for (const [id, value] of Object.entries(record(workflow.jobs))) {
			const job = record(value);
			if (!job.strategy) continue;
			const matrix = record(record(job.strategy).matrix);
			const rows = Array.isArray(matrix.include) ? matrix.include
				: Array.isArray(matrix.target) ? matrix.target : [];
			for (const value of rows) {
				if (typeof value === 'string') continue;
				const row = record(value);
				if (row.arch !== 'arm64' && !String(row.target).endsWith('-arm64')) continue;
				assert.equal(row.node_arch, 'arm64', `${name}/${id} Node architecture`);
				if (row.tooling_node_arch) {
					assert.equal(row.tooling_node_arch, 'arm64', `${name}/${id} npm architecture`);
				}
				const steps = job.steps as Record<string, unknown>[];
				const setup = steps.findIndex((step) => step.uses === './.github/actions/setup-native-tooling');
				const install = steps.findIndex((step) => step.run === 'npm ci');
				assert.ok(setup >= 0 && setup < install, `${name}/${id} native tools before npm ci`);
				checked += 1;
			}
		}
	}
	assert.ok(checked >= 15);
});

test('helper-backed nightly and AI asset jobs use native Node and tools', () => {
	for (const row of selectDesktopNightlyTestTargets('all')) {
		assert.equal(row.node_arch, row.arch);
	}
	for (const name of ['desktop-nightly-tests.yml', 'update-ai-assets.yml']) {
		const workflow = record(load(readFileSync(resolve(root, '.github/workflows', name), 'utf8')));
		const jobs = record(workflow.jobs);
		const job = record(Object.values(jobs).find((value) =>
			record(value)['runs-on'] === '${{ matrix.target.runner }}'));
		const steps = job.steps as Record<string, unknown>[];
		const setup = steps.findIndex((step) => step.uses === './.github/actions/setup-native-tooling');
		assert.ok(setup >= 0 && setup < steps.findIndex((step) => step.run === 'npm ci'));
	}
});

test('Windows media and OpenFX activate native compiler hosts without replacing native Ninja', () => {
	for (const name of ['framescaper-media-host-native-build.yml', 'framescaper-openfx-native-build.yml']) {
		const source = readFileSync(resolve(root, '.github/workflows', name), 'utf8');
		assert.match(source, /-host_arch=\$env:FRAMESCAPER_VS_ARCH/u);
		assert.doesNotMatch(source, /choco install[^\n]*\bninja\b/u);
	}
	const media = readFileSync(resolve(root, '.github/workflows/framescaper-media-host-native-build.yml'), 'utf8');
	assert.match(media, /windows-media-tools: 'true'/u);
	assert.match(media, /Install Windows media build tools\n\s+if: runner\.os == 'Windows' && runner\.arch != 'ARM64'/u);
	const action = readFileSync(resolve(root, '.github/actions/setup-native-tooling/action.yml'), 'utf8');
	assert.match(action, /-arch=arm64 -host_arch=arm64/u);
	assert.match(action, /assertNativeWindowsExecutable\(readFileSync\(process\.argv\[1\]\), "MSVC compiler"\)/u);
});
