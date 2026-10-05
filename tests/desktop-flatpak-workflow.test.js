/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('Flatpak CI repackages the audited Linux packages for the selected products', async () => {
	const job = extractJob(await readWorkflow('desktop-preview.yml'), 'flatpak');
	assert.match(job, /needs: \[quality, package\]/u);
	assert.match(job, /product: \$\{\{ fromJSON\(needs\.quality\.outputs\.release-products\) \}\}/u);
	assert.match(job, /runner: ubuntu-24\.04\s+arch: x64\s+flatpak_arch: x86_64/u);
	assert.match(job, /runner: ubuntu-24\.04-arm\s+arch: arm64\s+flatpak_arch: aarch64/u);
	assert.match(job, /node-version-file: \.nvmrc/u);
	assert.match(job, /npm install --global npm@12\.0\.1/u);
	assert.match(job, /name: nightly-\$\{\{ matrix\.product \}\}-linux-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(job, /node scripts\/desktop-flatpak\.mjs\s+--packages \.desktop-build\/flatpak-packages\s+--product "\$\{\{ matrix\.product \}\}"\s+--arch "\$\{\{ matrix\.target\.arch \}\}"/u);
	assert.doesNotMatch(job, /desktop-prepare\.mjs|desktop:publish:assistance-runtimes|R2_MODELS_|electron-builder/u);
});

test('Flatpak CI installs the current Electron runtime and smokes the installed bundle', async () => {
	const job = extractJob(await readWorkflow('desktop-preview.yml'), 'flatpak');
	assert.match(job, /ci-apt-install\.sh flatpak flatpak-builder xvfb xauth dbus-daemon/u);
	assert.match(job, /apparmor_restrict_unprivileged_userns=0/u);
	assert.match(job, /flatpak remote-add --user --if-not-exists flathub/u);
	assert.match(job, /flatpak install --user --noninteractive --arch="\$\{\{ matrix\.target\.flatpak_arch \}\}"/u);
	for (const dependency of ['org.freedesktop.Platform', 'org.freedesktop.Sdk', 'org.electronjs.Electron2.BaseApp']) {
		assert.ok(job.includes(`${dependency}//25.08`), `missing ${dependency} runtime`);
	}
	assert.match(job, /flatpak install --user --noninteractive release\/flatpak\/\*\.flatpak/u);
	assert.match(job, /SOUNDSCAPER_SMOKE_FLATPAK_ID: org\.\$\{\{ matrix\.product \}\}\.desktop/u);
	assert.match(job, /SOUNDSCAPER_SMOKE_ARCH: \$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(job, /SOUNDSCAPER_SMOKE_XVFB: 'true'/u);
	assert.match(job, /dbus-run-session -- npm run desktop:smoke/u);
	assert.doesNotMatch(job, /--no-sandbox/u);
	assert.ok(job.indexOf('flatpak install --user --noninteractive release/flatpak/*.flatpak')
		< job.indexOf('dbus-run-session -- npm run desktop:smoke'));
});

test('Flatpak artifacts stay separate from the existing release package inventory', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const job = extractJob(workflow, 'flatpak');
	assert.match(job, /name: flatpak-\$\{\{ matrix\.product \}\}-linux-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(job, /path: release\/flatpak\//u);
	assert.match(job, /if-no-files-found: error/u);
	assert.match(job, /retention-days: 14/u);
	for (const consumer of ['release-inventory', 'milestone-5-package-audit-summary']) {
		assert.doesNotMatch(extractJob(workflow, consumer), /pattern: flatpak-|needs:.*flatpak/u);
	}
	for (const match of job.matchAll(/uses: [^@\s]+@([^\s]+)/gu)) {
		assert.match(match[1], /^[a-f0-9]{40}$/u, 'actions must use immutable commit pins');
	}
});
