/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The benign format fixtures the plug-in scanner and host are proven against.
 *
 * Real plug-in formats are visible for testing and run only through their
 * authenticated adapters, payloads, and containment authority. The machinery
 * is also proven against fixtures that are our own code under our own licence:
 * one source built once per variant, including the
 * ones that genuinely abort, genuinely hang, and genuinely answer with more
 * state than the cap allows — a simulated crash would exercise the simulation
 * rather than the supervision. Human review remains milestone-9 release work.
 *
 * Like the addon, these are pinned per target and audited without a compiler,
 * and only the host's own target is ever built.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { NATIVE_HELPER_ADDON_ROOT } from './native-helper-addon-build.mjs';

export const FIXTURE_PLUGIN_ROOT = 'native/soundscaper-fixture-plugins';
export const FIXTURE_PLUGIN_SUFFIX = '.scapefx';

/**
 * `kind` records why each fixture exists so a reader does not have to infer the
 * intent from compiler flags. `module` fixtures are not built from the fixture
 * source at all: they exist to prove the loader paths for something that is not
 * a module and for a module with no entry point.
 */
export const FIXTURE_PLUGIN_VARIANTS = Object.freeze([
	Object.freeze({ name: 'clean-effect', kind: 'compiled', behaviour: 'PASSTHROUGH', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.clean', label: 'Fixture Clean Effect' }),
	Object.freeze({ name: 'gain-effect', kind: 'compiled', behaviour: 'GAIN', classification: 'EFFECT', latency: 64, stableId: 'soundscaper.fixture.gain', label: 'Fixture Gain' }),
	Object.freeze({ name: 'impulse-effect', kind: 'compiled', behaviour: 'IMPULSE', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.impulse', label: 'Fixture Impulse' }),
	Object.freeze({ name: 'instrument', kind: 'compiled', behaviour: 'PASSTHROUGH', classification: 'INSTRUMENT', latency: 0, stableId: 'soundscaper.fixture.instrument', label: 'Fixture Instrument' }),
	Object.freeze({ name: 'duplicate-identity', kind: 'compiled', behaviour: 'PASSTHROUGH', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.clean', label: 'Fixture Duplicate Identity' }),
	Object.freeze({ name: 'crash-on-scan', kind: 'compiled', behaviour: 'CRASH_ON_SCAN', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.crash-scan', label: 'Fixture Crash On Scan' }),
	Object.freeze({ name: 'hang-on-scan', kind: 'compiled', behaviour: 'HANG_ON_SCAN', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.hang-scan', label: 'Fixture Hang On Scan' }),
	Object.freeze({ name: 'crash-on-process', kind: 'compiled', behaviour: 'CRASH_ON_PROCESS', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.crash-process', label: 'Fixture Crash On Process' }),
	Object.freeze({ name: 'oversize-state', kind: 'compiled', behaviour: 'OVERSIZE_STATE', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.oversize', label: 'Fixture Oversize State' }),
	Object.freeze({ name: 'unstable-latency', kind: 'compiled', behaviour: 'UNSTABLE_LATENCY', classification: 'EFFECT', latency: 0, stableId: 'soundscaper.fixture.unstable', label: 'Fixture Unstable Latency' }),
	Object.freeze({ name: 'not-a-module', kind: 'text' }),
	Object.freeze({ name: 'no-entry-point', kind: 'module-without-entry' }),
]);

const NO_ENTRY_SOURCE = 'int soundscaper_unrelated_symbol(void) { return 7; }\n';
const NOT_A_MODULE_SOURCE = 'This file is deliberately not a loadable module.\n';

export function fixturePluginDirectory(repositoryRoot, targetId) {
	return resolve(repositoryRoot, FIXTURE_PLUGIN_ROOT, 'prebuilt', targetId);
}

export function buildFixturePlugins({ repositoryRoot, targetId, compiler = process.env.CC || 'cc', run = spawnSync }) {
	const sourcePath = resolve(repositoryRoot, FIXTURE_PLUGIN_ROOT, 'src/fixture_plugin.c');
	const outputRoot = fixturePluginDirectory(repositoryRoot, targetId);
	rmSync(outputRoot, { recursive: true, force: true });
	mkdirSync(outputRoot, { recursive: true });
	const built = [];
	for (const variant of FIXTURE_PLUGIN_VARIANTS) {
		const outputPath = join(outputRoot, `${variant.name}${FIXTURE_PLUGIN_SUFFIX}`);
		if (variant.kind === 'text') {
			writeFileSync(outputPath, NOT_A_MODULE_SOURCE);
		} else if (variant.kind === 'module-without-entry') {
			const temporary = join(outputRoot, `.${variant.name}.c`);
			writeFileSync(temporary, NO_ENTRY_SOURCE);
			assertRun(run(compiler, ['-std=c11', '-O1', '-fPIC', '-shared', '-o', outputPath, temporary], { encoding: 'utf8' }), variant.name);
			rmSync(temporary, { force: true });
		} else {
			assertRun(run(compiler, [
				'-std=c11', '-O1', '-fPIC', '-fvisibility=hidden', '-fno-ident', '-D_POSIX_C_SOURCE=200809L',
				`-DSOUNDSCAPER_FIXTURE_BEHAVIOUR=SOUNDSCAPER_FIXTURE_${variant.behaviour}`,
				`-DSOUNDSCAPER_FIXTURE_CLASS=SOUNDSCAPER_FIXTURE_${variant.classification}`,
				`-DSOUNDSCAPER_FIXTURE_LATENCY=${String(variant.latency)}`,
				`-DSOUNDSCAPER_FIXTURE_STABLE_ID="${variant.stableId}"`,
				`-DSOUNDSCAPER_FIXTURE_NAME="${variant.label}"`,
				'-shared', '-Wl,--build-id=none', '-o', outputPath, sourcePath,
			], { encoding: 'utf8' }), variant.name);
		}
		const bytes = readFileSync(outputPath);
		built.push({ name: `${variant.name}${FIXTURE_PLUGIN_SUFFIX}`, byteLength: bytes.byteLength, sha256: sha256(bytes) });
	}
	return Object.freeze({ targetId, outputRoot, files: Object.freeze(built) });
}

export function auditFixturePlugins({ repositoryRoot, manifest, targetId }) {
	const findings = [];
	const record = manifest.fixturePlugins?.targets?.[targetId];
	if (!record) return [`Missing fixture plug-in record for ${targetId}`];
	if (record.status === 'pending-external') {
		if ((record.files ?? []).length > 0) findings.push(`${targetId}: a pending-external fixture set must pin no files.`);
		return findings;
	}
	if (record.status !== 'built') return [`${targetId}: unsupported fixture status ${String(record.status)}`];
	const directory = fixturePluginDirectory(repositoryRoot, targetId);
	const expected = new Map((record.files ?? []).map((file) => [file.name, file]));
	if (expected.size !== FIXTURE_PLUGIN_VARIANTS.length) {
		findings.push(`${targetId}: expected ${String(FIXTURE_PLUGIN_VARIANTS.length)} fixtures, found ${String(expected.size)}.`);
	}
	let present;
	try {
		present = readdirSync(directory).filter((name) => name.endsWith(FIXTURE_PLUGIN_SUFFIX)).sort();
	} catch {
		return [...findings, `${targetId}: the fixture directory is missing.`];
	}
	for (const name of present) {
		if (!expected.has(name)) findings.push(`${targetId}: unpinned fixture ${name}`);
	}
	for (const [name, file] of expected) {
		let bytes;
		try {
			bytes = readFileSync(join(directory, name));
		} catch {
			findings.push(`${targetId}: missing pinned fixture ${name}`);
			continue;
		}
		if (bytes.byteLength !== file.byteLength || sha256(bytes) !== file.sha256) {
			findings.push(`${targetId}: fixture digest mismatch for ${name}`);
		}
	}
	return findings;
}

export function fixturePluginSourcePins(repositoryRoot) {
	const sourceRoot = resolve(repositoryRoot, FIXTURE_PLUGIN_ROOT, 'src');
	return readdirSync(sourceRoot).filter((name) => name.endsWith('.c')).sort().map((name) => {
		const bytes = readFileSync(join(sourceRoot, name));
		return { path: name, byteLength: bytes.byteLength, sha256: sha256(bytes) };
	});
}

export { NATIVE_HELPER_ADDON_ROOT };

function assertRun(result, label) {
	if (result.status !== 0) {
		throw new Error(`The ${label} fixture build failed: ${result.stderr || result.stdout || 'unknown error'}`);
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
