/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { extractJob } from './helpers/workflow-jobs.js';

const workflowUrl = new URL('../.github/workflows/desktop-nightly-tests.yml', import.meta.url);

test('manual Tauri builds run on feature branches and bypass Electron packaging', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	assert.match(workflow, /desktop_host:\s+description: [^\n]+\s+required: true\s+default: electron\s+type: choice\s+options:\s+- electron\s+- tauri/u);
	const electronTargets = extractJob(workflow, 'nightly-test-targets');
	const tauriTargets = extractJob(workflow, 'tauri-prototype-targets');
	const scenarios = [
		{ event: 'workflow_dispatch', ref: 'refs/heads/feat/tauri-prototype', host: 'tauri', electron: false, tauri: true },
		{ event: 'workflow_dispatch', ref: 'refs/heads/feat/tauri-prototype', host: 'electron', electron: true, tauri: false },
		{ event: 'workflow_dispatch', ref: 'refs/heads/main', host: 'tauri', electron: false, tauri: true },
		{ event: 'push', ref: 'refs/heads/main', host: '', electron: true, tauri: false },
		{ event: 'push', ref: 'refs/heads/feat/tauri-prototype', host: '', electron: false, tauri: false },
	];
	for (const scenario of scenarios) {
		const context = {
			github: { event_name: scenario.event, ref: scenario.ref },
			inputs: { desktop_host: scenario.host },
		};
		for (const [job, expected] of [[electronTargets, scenario.electron], [tauriTargets, scenario.tauri]] as const) {
			const condition = /^ {4}if: (.+)$/mu.exec(job)?.[1];
			assert.ok(condition, 'host selection must declare its event guard');
			assert.equal(runInNewContext(condition, context), expected,
				`${scenario.event} ${scenario.ref} ${scenario.host}`);
		}
	}
	assert.match(tauriTargets, /ref: \$\{\{ github\.sha \}\}/u);
	assert.match(tauriTargets, /selectTauriPrototypeBuildTargets\(process\.env\.NIGHTLY_TEST_TARGETS\)/u);
	assert.match(tauriTargets, /NIGHTLY_TEST_TARGETS: \$\{\{ inputs\.nightly_tests_targets \|\| 'all' \}\}/u);
});

test('Tauri artifacts use the pinned Rust host and include a portable executable with notices', async () => {
	const job = extractJob(await readFile(workflowUrl, 'utf8'), 'package-tauri-prototype');
	assert.match(job, /needs: tauri-prototype-targets/u);
	assert.match(job, /needs\.tauri-prototype-targets\.result == 'success'/u);
	assert.match(job, /fromJSON\(needs\.tauri-prototype-targets\.outputs\.targets\)/u);
	assert.match(job, /ref: \$\{\{ github\.sha \}\}/u);
	assert.match(job, /node-version-file: \.nvmrc/u);
	assert.match(job, /npm install --global npm@12\.0\.1/u);
	assert.match(job, /run: npm ci/u);
	assert.match(job, /working-directory: prototypes\/tauri\/host/u);
	assert.match(job, /readFileSync\('rust-toolchain\.toml', 'utf8'\)/u);
	assert.match(job, /execFileSync\('rustup', \['toolchain', 'install', channel/u);
	assert.match(job, /libwebkit2gtk-4\.1-dev/u);
	assert.match(job, /node prototypes\/tauri\/run\.mjs test --release/u);
	assert.match(job, /node prototypes\/tauri\/run\.mjs build --release/u);
	assert.match(job, /if: runner\.os == 'Linux'\s+run: node prototypes\/tauri\/run\.mjs smoke --release/u);
	assert.match(job, /tar -czf [^\n]+ -C \.tauri-prototype\/artifact \./u);
	assert.match(job, /node prototypes\/tauri\/stage-artifact\.mjs\s+env:\s+SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(job, /name: tauri-prototype-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(job, /if-no-files-found: error/u);
	assert.match(job, /include-hidden-files: true/u);
	assert.doesNotMatch(job, /desktop-prepare|assistance-runtime|R2_MODELS_|electron-builder|needs: \[/u);
});

test('nightly-with-tests builds and stages the native Tauri smoke host for every selected target', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const targets = extractJob(workflow, 'nightly-test-targets');
	assert.match(targets, /rust_target: tauriPrototypeRustTarget\(target\.platform, target\.arch\)/u);
	const job = extractJob(workflow, 'package-with-tests');
	assert.match(job, /libwebkit2gtk-4\.1-dev/u);
	assert.match(job, /working-directory: prototypes\/tauri\/host/u);
	assert.match(job, /readFileSync\('rust-toolchain\.toml', 'utf8'\)/u);
	assert.match(job, /execFileSync\('rustup', \['toolchain', 'install', channel/u);
	assert.match(job, /'--target', process\.env\.TAURI_RUST_TARGET/u);
	assert.match(job, /TAURI_RUST_TARGET: \$\{\{ matrix\.target\.rust_target \}\}/u);
	assert.match(job, /node prototypes\/tauri\/run\.mjs test --release --target=\$\{\{ matrix\.target\.rust_target \}\}/u);
	assert.match(job, /node prototypes\/tauri\/run\.mjs build --release --target=\$\{\{ matrix\.target\.rust_target \}\}/u);
	assert.match(job, /node prototypes\/tauri\/stage-artifact\.mjs\s+env:\s+SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}\s+SOUNDSCAPER_TAURI_TARGET: \$\{\{ matrix\.target\.rust_target \}\}/u);
	assert.match(job, /SOUNDSCAPER_NIGHTLY_TESTS_TAURI_ARTIFACT_PATH: \$\{\{ github\.workspace \}\}\/\.tauri-prototype\/artifact/u);
	const staging = job.indexOf('node prototypes/tauri/stage-artifact.mjs');
	assert.ok(staging > job.indexOf('node prototypes/tauri/run.mjs build'));
	assert.ok(staging < job.indexOf('node scripts/desktop-nightly-tests-prepare.mjs'));
	assert.match(job, /node scripts\/lib\/desktop-nightly-tests-tauri\.mjs/u);
	assert.match(job, /--payload "\$\{\{ github\.workspace \}\}\/\.desktop-build\/nightly-tests"/u);
	assert.match(job, /--arch \$\{\{ matrix\.target\.arch \}\}/u);
	assert.ok(job.indexOf('node scripts/lib/desktop-nightly-tests-tauri.mjs')
		> job.indexOf('node scripts/desktop-nightly-tests-prepare.mjs'));
	assert.match(job, /id: tauri-native-smoke/u);
	assert.match(job, /steps\.tauri-native-smoke\.outcome == 'success' \|\| steps\.tauri-native-smoke\.outcome == 'failure'/u);
	assert.match(job, /path: \.native-build\/tauri-nightly-smoke\/\s+include-hidden-files: true/u);
	assert.doesNotMatch(job, /desktop:publish:assistance-runtimes|R2_MODELS_/u);
});
