/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	mediaHostUnifiedPlanGeneration,
} from './helpers/framescaper-media-host-unified-plan-fixture.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(repositoryRoot, 'native/framescaper-media-host/src');
const fixtureSource = join(
	repositoryRoot,
	'native/framescaper-media-host/tests/unified_plan_admission_fixture.cpp',
);
const SOURCE_SHA256 = 'ab'.repeat(32);
const PRESENTATION_TICKS = Object.freeze(Array.from({ length: 20 }, (_, index) => (
	index === 0 ? 0n : Array.from({ length: index }, (__, cell) => [11n, 17n, 13n][cell % 3]).reduce(
		(sum, duration) => sum + duration, 0n,
	)
)));
const TIMESCALE = 10;
const FINAL_DURATION_TICKS = 19n;
let compiledFixture = null;
let compiledProductionHost = null;

test.after(() => {
	compiledFixture?.dispose();
	compiledFixture = null;
	compiledProductionHost?.dispose();
	compiledProductionHost = null;
});

test('production media-host CLI authenticates exact timing tuples and rejects omission, replay, and tamper', (context) => {
	const fixture = buildProductionHost(context);
	if (fixture === null) return;
	try {
		const timing = timingAsset(PRESENTATION_TICKS, FINAL_DURATION_TICKS, TIMESCALE);
		writeFileSync(fixture.timing, timing.bytes);
		const reference = { ...timing.reference, sourceSha256: fixture.sourceSha256 };
		const plan = vfrPlan(9, reference);
		plan.sources[0].contentSha256 = fixture.sourceSha256;
		const exact = [{ path: fixture.timing, sha256: reference.sha256, byteLength: timing.bytes.length }];
		const admitted = runProductionHost(fixture, plan, exact);
		assert.equal(admitted.status, 78, admitted.stderr);
		assert.deepEqual(JSON.parse(admitted.stdout), {
			error: 'unsupported-render-subset', operation: 'media-render',
			planVersion: 9, family: 'unified-exact-v9-graph',
		});
		assert.equal(runProductionHost(fixture, plan, []).status, 65, 'missing timing grant');
		assert.equal(runProductionHost(fixture, plan, [...exact, ...exact]).status, 65, 'replayed timing grant');
		assert.equal(
			runProductionHost(fixture, mediaHostUnifiedPlanGeneration(9, fixture.sourceSha256), exact).status,
			65,
			'unused timing grant',
		);
		assert.equal(runProductionHost(fixture, plan, [{
			...exact[0], byteLength: timing.bytes.length - 1,
		}]).status, 65, 'wrong timing byte-length grant');
		const tampered = Buffer.from(timing.bytes);
		tampered[tampered.length - 1] ^= 0xff;
		writeFileSync(fixture.timing, tampered);
		assert.equal(runProductionHost(fixture, plan, exact).status, 65, 'timing bytes changed');
	} finally {
		fixture.cleanup();
	}
});

test('native unified validators admit authenticated VFR timing without graph dispatch authority', (context) => {
	const fixture = buildFixture(context);
	if (fixture === null) return;
	try {
		const timing = timingAsset(PRESENTATION_TICKS, FINAL_DURATION_TICKS, TIMESCALE);
		writeFileSync(fixture.timing, timing.bytes);
		for (const version of [9, 10, 11, 12]) {
			const plan = vfrPlan(version, timing.reference);
			const withoutSidecar = admit(fixture, plan);
			assert.equal(withoutSidecar.status, 65, `V${String(version)} without timing bytes`);
			assert.match(withoutSidecar.stderr, /verified timing asset bytes/iu);
			const admitted = admit(fixture, plan, [[fixture.timing, timing.reference.sha256]]);
			assert.equal(admitted.status, 0, `valid VFR V${String(version)}: ${admitted.stderr}`);
			assert.equal(
				admitted.stdout,
				`${String(version)}|original-only|unified-exact-v${String(version)}-graph\n`,
			);
		}
	} finally {
		fixture.cleanup();
	}
});

test('native unified VFR admission rejects missing, duplicate, unused, and unauthenticated timing grants', (context) => {
	const fixture = buildFixture(context);
	if (fixture === null) return;
	try {
		const timing = timingAsset(PRESENTATION_TICKS, FINAL_DURATION_TICKS, TIMESCALE);
		writeFileSync(fixture.timing, timing.bytes);
		const plan = vfrPlan(9, timing.reference);
		const grants = [[fixture.timing, timing.reference.sha256]];
		assert.equal(admit(fixture, plan).status, 65, 'missing timing grant');
		assert.equal(admit(fixture, plan, [...grants, ...grants]).status, 65, 'duplicate timing grant');
		assert.equal(
			admit(fixture, mediaHostUnifiedPlanGeneration(9, SOURCE_SHA256), grants).status,
			65,
			'unused timing grant',
		);
		assert.equal(admit(fixture, plan, [[fixture.timing, 'ef'.repeat(32)]]).status, 65, 'wrong grant digest');
		const excessive = admit(fixture, plan, Array.from({ length: 4_097 }, () => grants[0]));
		assert.equal(excessive.status, 65, 'timing grant count ceiling');
		assert.match(excessive.stderr, /grant count exceeds 4,096/iu);
		const tampered = Buffer.from(timing.bytes);
		tampered[tampered.length - 1] ^= 0xff;
		writeFileSync(fixture.timing, tampered);
		assert.equal(admit(fixture, plan, grants).status, 65, 'tampered timing bytes');
	} finally {
		fixture.cleanup();
	}
});

test('native unified admission authenticates VFR timing for inactive plan sources', (context) => {
	const fixture = buildFixture(context);
	if (fixture === null) return;
	try {
		const timing = timingAsset(PRESENTATION_TICKS, FINAL_DURATION_TICKS, TIMESCALE);
		writeFileSync(fixture.timing, timing.bytes);
		const plan = structuredClone(mediaHostUnifiedPlanGeneration(9, SOURCE_SHA256));
		plan.sources.push({
			inputIndex: 1,
			nodeId: 'inactive-source-node',
			sourceId: 'inactive-source',
			storageKey: 'media/inactive-source',
			mimeType: 'video/quicktime',
			contentSha256: SOURCE_SHA256,
			timing: { kind: 'vfr', reference: timing.reference },
		});
		const missing = admit(fixture, plan);
		assert.equal(missing.status, 65, 'inactive VFR source without timing bytes');
		assert.match(missing.stderr, /verified timing asset bytes/iu);
		const admitted = admit(fixture, plan, [[fixture.timing, timing.reference.sha256]]);
		assert.equal(admitted.status, 0, admitted.stderr);
		assert.equal(admitted.stdout, '9|original-only|unified-exact-v9-graph\n');
	} finally {
		fixture.cleanup();
	}
});

test('native SCTI admission rejects malformed binary authorities and summary substitutions', (context) => {
	const fixture = buildFixture(context);
	if (fixture === null) return;
	try {
		const canonical = timingAsset(PRESENTATION_TICKS, FINAL_DURATION_TICKS, TIMESCALE);
		for (const [label, mutate, referenceChanges = {}] of [
			['magic', (bytes) => { bytes[0] = 0; }],
			['version', (bytes) => { bytes.writeUInt16LE(2, 4); }],
			['header length', (bytes) => { bytes.writeUInt16LE(24, 6); }],
			['reserved bytes', (bytes) => { bytes.writeBigUInt64LE(1n, 24); }],
			['first presentation tick', (bytes) => { bytes.writeBigInt64LE(1n, 32); }],
			['duplicate presentation tick', (bytes) => { bytes.writeBigInt64LE(11n, 48); }],
			['decreasing positive presentation tick', (bytes) => { bytes.writeBigInt64LE(10n, 48); }],
			['negative presentation tick', (bytes) => { bytes.writeBigInt64LE(-1n, 40); }],
			['zero final duration', (bytes) => { bytes.writeBigInt64LE(0n, 16); }],
			['summary frame-count substitution', () => {}, { frameCount: 19 }],
			['summary byte-length substitution', () => {}, { referenceByteLength: 191 }],
			['summary timescale substitution', () => {}, { timescale: TIMESCALE + 1 }],
			['summary final-duration substitution', () => {}, { finalFrameDurationTicks: '20' }],
			['source digest substitution', () => {}, { sourceSha256: 'bc'.repeat(32) }],
		]) {
			const bytes = Buffer.from(canonical.bytes);
			mutate(bytes);
			const reference = referenceForBytes(bytes, { ...canonical.reference, ...referenceChanges });
			const plan = vfrPlan(9, reference);
			writeFileSync(fixture.timing, bytes);
			const refused = admit(fixture, plan, [[fixture.timing, reference.sha256]]);
			assert.equal(refused.status, 65, `${label}: ${refused.stderr}`);
		}
		const trailingBytes = Buffer.concat([canonical.bytes, Buffer.of(0)]);
		const trailingReference = referenceForBytes(trailingBytes, canonical.reference);
		writeFileSync(fixture.timing, trailingBytes);
		assert.equal(admit(
			fixture,
			vfrPlan(9, trailingReference),
			[[fixture.timing, trailingReference.sha256]],
		).status, 65, 'trailing timing bytes');

		const overflowTicks = [...PRESENTATION_TICKS];
		overflowTicks[overflowTicks.length - 1] = 0x7fff_ffff_ffff_fff0n;
		const overflow = timingAssetUnchecked(overflowTicks, 32n, TIMESCALE);
		writeFileSync(fixture.timing, overflow.bytes);
		assert.equal(
			admit(fixture, vfrPlan(9, overflow.reference), [[fixture.timing, overflow.reference.sha256]]).status,
			65,
			'end-tick overflow',
		);
	} finally {
		fixture.cleanup();
	}
});

test('native unified VFR intent validation reconstructs exact wall-clock and drawable boundary times', (context) => {
	const fixture = buildFixture(context);
	if (fixture === null) return;
	try {
		const timing = timingAsset(PRESENTATION_TICKS, FINAL_DURATION_TICKS, TIMESCALE);
		writeFileSync(fixture.timing, timing.bytes);
		const grants = [[fixture.timing, timing.reference.sha256]];
		for (const [label, mutate] of [
			['curve drawable boundary', (plan) => {
				const row = plan.nodes.find(({ clipId }) => clipId === 'clip-out')
					.sourceTimeMapping.intent.intersections[0];
				row.drawableEndTime.numerator = String(BigInt(row.drawableEndTime.numerator) + 1n);
			}],
			['wall-clock source boundary', (plan) => {
				const row = plan.nodes.find(({ clipId }) => clipId === 'clip-in')
					.sourceTimeMapping.intent.intersections[0];
				row.sourceStartTime.numerator = String(BigInt(row.sourceStartTime.numerator) + 1n);
			}],
			['explicit final frame duration', (plan) => {
				const row = plan.nodes.find(({ clipId }) => clipId === 'clip-later')
					.sourceTimeMapping.intent.intersections[0];
				row.sourceEndTime.numerator = String(BigInt(row.sourceEndTime.numerator) - 1n);
			}],
		]) {
			const plan = vfrPlan(9, timing.reference);
			mutate(plan);
			const refused = admit(fixture, plan, grants);
			assert.equal(refused.status, 65, `${label}: ${refused.stderr}`);
		}
	} finally {
		fixture.cleanup();
	}
});

function buildFixture(context) {
	if (compiledFixture !== null) return compiledFixture;
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return null;
	}
	const boostRoot = process.env.FRAMESCAPER_BOOST_192_SOURCE_ROOT;
	const boostArguments = boostRoot ? ['-I', boostRoot] : [];
	const boost = spawnSync('c++', ['-std=c++20', ...boostArguments, '-fsyntax-only', '-x', 'c++', '-'], {
		encoding: 'utf8', input: '#include <boost/multiprecision/cpp_int.hpp>\n',
	});
	if (boost.status !== 0) {
		context.skip('The pinned Boost closure is not provisioned on this source-audit host.');
		return null;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-unified-vfr-validator-'));
	const executable = join(directory, 'unified-plan-admission');
	const files = [
		'media_plan.cpp', 'legacy_plan_semantics.cpp', 'legacy_plan_v8_filter_semantics.cpp',
		'media_file_grants.cpp', 'sha256.cpp', 'strict_json.cpp',
	].map((file) => join(sourceRoot, file));
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		...boostArguments, '-I', sourceRoot, fixtureSource, ...files, '-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr);
	compiledFixture = {
		directory,
		executable,
		plan: join(directory, 'plan.json'),
		timing: join(directory, 'timing.scti'),
		cleanup: () => undefined,
		dispose: () => rmSync(directory, { recursive: true, force: true }),
	};
	return compiledFixture;
}

function buildProductionHost(context) {
	if (compiledProductionHost !== null) return compiledProductionHost;
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return null;
	}
	const boostRoot = process.env.FRAMESCAPER_BOOST_192_SOURCE_ROOT;
	const boostArguments = boostRoot ? ['-I', boostRoot] : [];
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-production-vfr-host-'));
	const executable = join(directory, 'framescaper-media-host');
	const files = [
		'media_host.cpp', 'image_sequence_pack.cpp', 'legacy_plan_semantics.cpp',
		'legacy_plan_v8_filter_semantics.cpp', 'media_file_grants.cpp', 'media_plan.cpp',
		'sha256.cpp', 'strict_json.cpp',
	].map((file) => join(sourceRoot, file));
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror', ...boostArguments,
		'-DFRAMESCAPER_MEDIA_HOST_CONTRACT_ONLY=1', '-I', sourceRoot,
		...files, '-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr);
	const source = join(directory, 'source.mov');
	writeFileSync(source, 'production-vfr-source');
	const scratch = join(directory, 'scratch');
	const destination = join(directory, 'destination');
	for (const path of [scratch, destination]) mkdirSync(path);
	compiledProductionHost = {
		directory, executable, source, sourceSha256: digest(readFileSync(source)),
		sourceByteLength: readFileSync(source).byteLength,
		scratch, destination, plan: join(directory, 'plan.json'),
		timing: join(directory, 'timing.scti'), temporaryOutput: join(destination, 'output.tmp'),
		cleanup: () => undefined,
		dispose: () => rmSync(directory, { recursive: true, force: true }),
	};
	return compiledProductionHost;
}

function runProductionHost(fixture, plan, timing) {
	const bytes = JSON.stringify(plan);
	writeFileSync(fixture.plan, bytes);
	return spawnSync(fixture.executable, [
		'--operation', 'media-render', '--plan', fixture.plan, '--plan-sha256', digest(bytes),
		'--source', fixture.source, '--source-sha256', fixture.sourceSha256,
		'--source-byte-length', String(fixture.sourceByteLength), '--source-role', 'original',
		...timing.flatMap((asset) => [
			'--video-timing-asset', asset.path, '--video-timing-sha256', asset.sha256,
			'--video-timing-byte-length', String(asset.byteLength),
		]),
		'--backend', 'native-cpu', '--maximum-output-bytes', '1048576',
		'--scratch', fixture.scratch, '--destination-root', fixture.destination,
		'--temporary-output', fixture.temporaryOutput,
	], { encoding: 'utf8' });
}

function admit(fixture, plan, timingGrants = []) {
	const bytes = JSON.stringify(plan);
	writeFileSync(fixture.plan, bytes);
	return spawnSync(fixture.executable, [
		fixture.plan, digest(bytes), ...timingGrants.flat(),
	], { encoding: 'utf8' });
}

function timingAsset(presentationTicks, finalFrameDurationTicks, timescale) {
	for (let index = 1; index < presentationTicks.length; index += 1) {
		assert.ok(presentationTicks[index] > presentationTicks[index - 1]);
	}
	assert.ok(presentationTicks[0] === 0n && finalFrameDurationTicks > 0n);
	assert.ok(presentationTicks.at(-1) + finalFrameDurationTicks <= 0x7fff_ffff_ffff_ffffn);
	return timingAssetUnchecked(presentationTicks, finalFrameDurationTicks, timescale);
}

function timingAssetUnchecked(presentationTicks, finalFrameDurationTicks, timescale) {
	const bytes = Buffer.alloc(32 + presentationTicks.length * 8);
	bytes.set([0x53, 0x43, 0x54, 0x49], 0);
	bytes.writeUInt16LE(1, 4);
	bytes.writeUInt16LE(32, 6);
	bytes.writeUInt32LE(timescale, 8);
	bytes.writeUInt32LE(presentationTicks.length, 12);
	bytes.writeBigInt64LE(finalFrameDurationTicks, 16);
	bytes.writeBigUInt64LE(0n, 24);
	for (const [index, tick] of presentationTicks.entries()) {
		bytes.writeBigInt64LE(tick, 32 + index * 8);
	}
	return { bytes, reference: referenceForBytes(bytes, {
		sourceSha256: SOURCE_SHA256,
		frameCount: presentationTicks.length,
		timescale,
		finalFrameDurationTicks: String(finalFrameDurationTicks),
	}) };
}

function referenceForBytes(bytes, authority) {
	const sha256 = digest(bytes);
	return {
		encoding: 'soundscaper-video-timing-v1',
		storageKey: `video-timing-sha256:${sha256}`,
		sha256,
		sourceSha256: authority.sourceSha256,
		byteLength: authority.referenceByteLength ?? bytes.length,
		frameCount: authority.frameCount,
		timescale: authority.timescale,
		finalFrameDurationTicks: authority.finalFrameDurationTicks,
	};
}

function vfrPlan(version, reference) {
	const plan = structuredClone(mediaHostUnifiedPlanGeneration(version, SOURCE_SHA256));
	plan.sources[0].timing = { kind: 'vfr', reference };
	for (const node of plan.nodes) {
		if (node.kind !== 'clip') continue;
		const { intent } = node.sourceTimeMapping;
		for (const row of intent.intersections) {
			if (row.mapping === 'curve') {
				row.drawableStartTime = boundaryTime(BigInt(row.drawableStartTime.numerator));
				row.drawableEndTime = boundaryTime(BigInt(row.drawableEndTime.numerator));
			} else {
				const sourceStart = boundary(BigInt(row.sourceInFrame));
				const sourceEnd = boundary(BigInt(row.sourceOutFrame));
				row.sourceStartTime = decimal(sourceStart);
				row.sourceEndTime = decimal(sourceEnd);
				row.clippedSourceStartTime = decimal(interpolate(
					sourceStart, sourceEnd, BigInt(row.startSample - row.clipStartSample),
					BigInt(row.clipEndSample - row.clipStartSample),
				));
				row.clippedSourceEndTime = decimal(interpolate(
					sourceStart, sourceEnd, BigInt(row.endSample - row.clipStartSample),
					BigInt(row.clipEndSample - row.clipStartSample),
				));
			}
		}
		intent.limits.decimalByteCount = decimalBytes(intent.intersections);
	}
	return plan;
}

function boundaryTime(frame) { return decimal(boundary(frame)); }

function boundary(frame) {
	const numerator = frame === BigInt(PRESENTATION_TICKS.length)
		? PRESENTATION_TICKS.at(-1) + FINAL_DURATION_TICKS
		: PRESENTATION_TICKS[Number(frame)];
	return rational(numerator, BigInt(TIMESCALE));
}

function interpolate(start, end, offset, span) {
	return add(start, multiply(subtract(end, start), rational(offset, span)));
}

function add(left, right) {
	return rational(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtract(left, right) {
	return rational(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function multiply(left, right) {
	return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function rational(numerator, denominator) {
	const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function decimal(value) {
	return { numerator: String(value.numerator), denominator: String(value.denominator) };
}

function gcd(left, right) {
	while (right !== 0n) [left, right] = [right, left % right];
	return left;
}

function decimalBytes(value) {
	if (Array.isArray(value)) return value.reduce((sum, child) => sum + decimalBytes(child), 0);
	if (value === null || typeof value !== 'object') return 0;
	if (typeof value.numerator === 'string' && typeof value.denominator === 'string'
		&& Object.keys(value).length === 2) {
		return value.numerator.length + value.denominator.length + 4;
	}
	return Object.values(value).reduce((sum, child) => sum + decimalBytes(child), 0);
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
