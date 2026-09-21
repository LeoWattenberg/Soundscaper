/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector';
import test, { after } from 'node:test';

import { validateE2ERawV8Topology } from '../scripts/lib/e2e-v8-topology.mjs';
import { stableSha256Digest } from '../scripts/lib/e2e-coverage-integrity.mjs';
import { E2E_REPOSITORY_URL_PREFIX } from '../scripts/lib/e2e-coverage-prefixes.mjs';

const COVERAGE_URL = 'file:///__soundscaper_e2e__/browser/soundscaper/topology.mjs';
const BASE64_VLQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value) {
	let remaining = value < 0 ? ((-value) << 1) | 1 : value << 1;
	let result = '';
	do {
		let digit = remaining & 31;
		remaining >>>= 5;
		if (remaining > 0) digit |= 32;
		result += BASE64_VLQ[digit];
	} while (remaining > 0);
	return result;
}

function encodeMappings(lines) {
	let previousSource = 0;
	let previousOriginalLine = 0;
	let previousOriginalColumn = 0;
	return lines.map((segments) => {
		let previousGeneratedColumn = 0;
		return segments.map(([generatedColumn, source, originalLine, originalColumn]) => {
			const fields = [
				generatedColumn - previousGeneratedColumn,
				source - previousSource,
				originalLine - previousOriginalLine,
				originalColumn - previousOriginalColumn,
			];
			previousGeneratedColumn = generatedColumn;
			previousSource = source;
			previousOriginalLine = originalLine;
			previousOriginalColumn = originalColumn;
			return fields.map(encodeVlq).join('');
		}).join(',');
	}).join(';');
}

const SOURCE = `
for (const rootFlag of [true, false]) {
	const rootLogical = rootFlag && 'root';
	if (rootLogical) globalThis.__topologyRoot = rootLogical;
	else globalThis.__topologyRoot = 'fallback';
}
export function choose(value) {
	if (value === 1) return 'one';
	return value === 2 ? 'two' : 'other';
}
export function either(value) {
	if (value) { return 'truthy'; }
	else { return 'falsey'; }
}
export function logical(left, right) {
	return (left && right) || (left ?? right);
}
export function assignments(andValue, orValue, nullishValue) {
	andValue &&= 'and';
	orValue ||= 'or';
	nullishValue ??= 'nullish';
	return [andValue, orValue, nullishValue];
}
export function cases(value) {
	switch (value) {
		case 1: return 'one';
		case 2: return 'two';
		default: return 'other';
	}
}
export function optional(value) {
	return value?.child?.method?.() ?? 'missing';
}
export function repeated(values) {
	let total = 0;
	for (const value of values) total += value;
	while (total < 2) total += 1;
	do total -= 1; while (total > 2);
	return total;
}
export function recovered(value = 1) {
	try {
		if (value < 0) throw new Error('negative');
		return value;
	} catch {
		return 0;
	}
}
export function outer(flag) {
	function nested(value) { return value ? 1 : 2; }
	return nested(flag);
}
export const arrow = (value) => value ? 'yes' : 'no';
export class Example {
	static { this.ready = true; }
	static method(value) { return value ? 'static-yes' : 'static-no'; }
	static async asyncMethod(value) { return value ? 'async-yes' : 'async-no'; }
	static *values(value) { yield value ? 'generated-yes' : 'generated-no'; }
	static get status() { return this._status; }
	static set status(value) { this._status = value; }
	constructor(value) { this.current = value; }
	method(value) { return value ? value : this.current; }
	get value() { return this.current; }
	set value(value) { this.current = value; }
}
choose(1); choose(2); choose(3);
either(true); either(false);
logical(true, 2); logical(false, 2); logical(null, 2);
assignments(true, false, null); assignments(false, true, 'value');
cases(1); cases(2); cases(3);
optional({ child: { method: () => 'present' } }); optional(null);
repeated([1, 2]); repeated([]);
recovered(); recovered(-1);
outer(true); outer(false);
arrow(true); arrow(false);
const example = new Example(1);
example.method(2); example.method(0); example.value; example.value = 3;
Example.method(true); Example.method(false);
Example.asyncMethod(true); Example.asyncMethod(false);
[...Example.values(true)]; [...Example.values(false)];
Example.status; Example.status = 'updated';
`;
const workspaces = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('parser-derived topology admits complete representative V8 output', () => {
	const fixture = topologyFixture();
	assert.equal(fixture.entry.functions.find(({ functionName }) => functionName === 'assignments')?.ranges.length, 1,
		'V8 may collapse fully covered logical assignments to one function range');
	assert.deepEqual(validate(fixture, [fixture.entry]), []);
});

test('parser-derived topology admits live counted Inspector output', async () => {
	const fixture = topologyFixture();
	const entry = await inspectorEntry(fixture, true);
	assert.ok(entry.functions.some(({ ranges }) => ranges.some(({ count }) => count > 1)),
		'counted coverage must retain execution counts');
	assert.deepEqual(validate(fixture, [entry]), []);
});

test('binary Inspector output cannot satisfy counted branch evidence', async () => {
	const fixture = topologyFixture();
	const entry = await inspectorEntry(fixture, false);
	assert.ok(entry.functions.some(({ ranges }) => ranges.length === 1),
		'binary coverage may collapse fully covered branches');
	assert.match(validate(fixture, [entry]).join('\n'), /branch topology/u);
});

test('empty and top-level-only V8 entries cannot erase the source denominator', () => {
	const fixture = topologyFixture();
	assert.match(validate(fixture, [{ ...fixture.entry, functions: [] }]).join('\n'), /root function/u);
	assert.match(validate(fixture, [{
		...fixture.entry,
		functions: fixture.entry.functions.slice(0, 1),
	}]).join('\n'), /explicit function/u);
	assert.match(validate(fixture, [{
		...fixture.entry,
		functions: fixture.entry.functions.map((entry, index) => index === 0
			? { ...entry, isBlockCoverage: false } : entry),
	}]).join('\n'), /no detailed block coverage/u);
});

test('omitted nested functions and branch ranges fail independently', () => {
	const fixture = topologyFixture();
	assert.match(validate(fixture, [{
		...fixture.entry,
		functions: fixture.entry.functions.filter(({ functionName }) => functionName !== 'nested'),
	}]).join('\n'), /explicit function/u);

	const branchy = fixture.entry.functions.find(({ functionName }) => functionName === 'choose');
	assert.ok(branchy);
	assert.ok(branchy.ranges.length > 1);
	assert.match(validate(fixture, [{
		...fixture.entry,
		functions: fixture.entry.functions.map((entry) => entry === branchy
			? { ...entry, ranges: entry.ranges.slice(0, 1) }
			: entry),
	}]).join('\n'), /branch topology/u);

	const root = fixture.entry.functions.find(({ ranges }) => (
		ranges[0]?.startOffset === 0 && ranges[0]?.endOffset === SOURCE.length
	));
	assert.ok(root);
	assert.ok(root.ranges.length > 1);
	assert.match(validate(fixture, [{
		...fixture.entry,
		functions: fixture.entry.functions.map((entry) => entry === root
			? { ...entry, ranges: entry.ranges.slice(0, 1) }
			: entry),
	}]).join('\n'), /branch topology/u);
});

test('complementary profiles union topology and extra V8 functions stay harmless', () => {
	const fixture = topologyFixture();
	const left = structuredClone(fixture.entry);
	const right = structuredClone(fixture.entry);
	left.functions = left.functions.filter((_, index) => index % 2 === 0);
	right.functions = right.functions.filter((_, index) => index % 2 === 1);
	right.functions.push({
		functionName: '<synthetic-runtime-helper>',
		isBlockCoverage: false,
		ranges: [{ startOffset: 0, endOffset: SOURCE.length, count: 1 }],
	});
	assert.deepEqual(validate(fixture, [left, right]), []);
});

test('mapped vendor functions stay outside the source-derived first-party denominator', () => {
	const fixture = mappedTopologyFixture();
	const withoutVendor = {
		...fixture.entry,
		functions: fixture.entry.functions.filter(({ functionName }) => functionName !== 'vendorWrapper'),
	};
	assert.deepEqual(validate(fixture, [withoutVendor]), []);
	assert.match(validate(fixture, [{
		...withoutVendor,
		functions: withoutVendor.functions.filter(({ functionName }) => functionName !== 'owned'),
	}]).join('\n'), /explicit function/u);
	assert.match(validate(fixture, [{
		...withoutVendor,
		functions: withoutVendor.functions.filter(({ functionName }) => functionName !== 'mixed'),
	}]).join('\n'), /explicit function/u);
});

test('every observed equivalent script authenticates the same first-party map scope', () => {
	const fixture = mappedTopologyFixture();
	const equivalentUrl = `${COVERAGE_URL}?equivalent`;
	fixture.scripts.push({
		...fixture.scripts[0],
		coverageUrl: equivalentUrl,
		id: 'electron/mapped.mjs',
	});
	fixture.sourceMapCache[equivalentUrl] = structuredClone(fixture.sourceMapCache[COVERAGE_URL]);
	const withoutVendor = fixture.entry.functions.filter(({ functionName }) => functionName !== 'vendorWrapper');
	assert.deepEqual(validate(fixture, [
		{ ...fixture.entry, functions: withoutVendor },
		{ ...fixture.entry, functions: withoutVendor, url: equivalentUrl },
	]), []);
	fixture.sourceMapCache[equivalentUrl].data.names.push('changed');
	assert.match(validate(fixture, [
		{ ...fixture.entry, functions: withoutVendor },
		{ ...fixture.entry, functions: withoutVendor, url: equivalentUrl },
	]).join('\n'), /no authenticated source map/u);
});

test('a partially first-party mapped branch fails closed', () => {
	const fixture = mappedTopologyFixture({ partialBranch: true });
	assert.match(validate(fixture, [fixture.entry]).join('\n'), /crosses first-party source-map ownership/u);
});

function topologyFixture() {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-v8-topology-'));
	workspaces.push(workspace);
	const artifactRoot = join(workspace, 'artifacts');
	const coverageRoot = join(workspace, 'coverage');
	const artifactPath = 'executables/topology.mjs';
	const executable = join(artifactRoot, artifactPath);
	mkdirSync(join(artifactRoot, 'executables'), { recursive: true });
	mkdirSync(coverageRoot);
	writeFileSync(executable, SOURCE);
	execFileSync(process.execPath, [executable], {
		env: { ...process.env, NODE_V8_COVERAGE: coverageRoot },
	});
	const raw = JSON.parse(readFileSync(join(
		coverageRoot,
		readdirSync(coverageRoot).find((name) => name.endsWith('.json')),
	), 'utf8'));
	const actualUrl = pathToFileURL(executable).href;
	const measured = raw.result.find(({ url }) => url === actualUrl);
	assert.ok(measured, 'Node must expose representative V8 topology');
	return {
		artifactRoot,
		executable,
		entry: { ...measured, url: COVERAGE_URL },
		scripts: [{
			artifactPath,
			coverageKey: 'sha256:topology-fixture',
			coverageUrl: COVERAGE_URL,
			id: 'browser/topology.mjs',
		}],
	};
}

function mappedTopologyFixture({ partialBranch = false } = {}) {
	const source = [
		'function vendorWrapper() {',
		'\tfunction owned(value) {',
		'\t\treturn value ? "owned" : "other";',
		'\t}',
		'\towned(true); owned(false);',
		'}',
		'vendorWrapper();',
		'function mixed(value) {',
		'\treturn value ? "mixed" : "other";',
		'}',
		'mixed(true); mixed(false);',
		'',
	].join('\n');
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-v8-mapped-topology-'));
	workspaces.push(workspace);
	const artifactRoot = join(workspace, 'artifacts');
	const coverageRoot = join(workspace, 'coverage');
	const artifactPath = 'executables/mapped.mjs';
	const executable = join(artifactRoot, artifactPath);
	mkdirSync(join(artifactRoot, 'executables'), { recursive: true });
	mkdirSync(coverageRoot);
	writeFileSync(executable, source);
	execFileSync(process.execPath, [executable], {
		env: { ...process.env, NODE_V8_COVERAGE: coverageRoot },
	});
	const raw = JSON.parse(readFileSync(join(
		coverageRoot,
		readdirSync(coverageRoot).find((name) => name.endsWith('.json')),
	), 'utf8'));
	const actualUrl = pathToFileURL(executable).href;
	const measured = raw.result.find(({ url }) => url === actualUrl);
	assert.ok(measured);
	const ownedSource = 'src/common/mapped-topology-fixture.ts';
	const decodedMappings = source.split('\n').map((lineText, line) => {
		const segments = [[0, (line >= 1 && line <= 3) || line === 8 ? 1 : 0, line, 0]];
		if (partialBranch && line === 2) segments.push([lineText.indexOf('"other"'), 0, line, 0]);
		return segments;
	});
	const map = {
		version: 3,
		sources: [
			'file:///__soundscaper_external__/node_modules/vendor.js',
			`${E2E_REPOSITORY_URL_PREFIX}${ownedSource}`,
		],
		sourcesContent: ['', ''],
		names: [],
		mappings: encodeMappings(decodedMappings),
	};
	return {
		artifactRoot,
		entry: { ...measured, url: COVERAGE_URL },
		sourceMapCache: { [COVERAGE_URL]: { data: map } },
		scripts: [{
			artifactPath,
			coverageKey: 'sha256:mapped-topology-fixture',
			coverageUrl: COVERAGE_URL,
			id: 'browser/mapped.mjs',
			sourceMapSha256: stableSha256Digest(map),
			sources: [ownedSource],
		}],
	};
}

async function inspectorEntry(fixture, callCount) {
	const session = new Session();
	session.connect();
	const post = (method, parameters = {}) => new Promise((resolve, reject) => {
		session.post(method, parameters, (error, result) => error ? reject(error) : resolve(result));
	});
	const actualUrl = pathToFileURL(fixture.executable).href;
	try {
		await post('Profiler.enable');
		await post('Profiler.startPreciseCoverage', { callCount, detailed: true });
		await import(actualUrl);
		const { result } = await post('Profiler.takePreciseCoverage');
		const measured = result.find(({ url }) => url === actualUrl);
		assert.ok(measured, 'Inspector must expose representative V8 topology');
		return { ...measured, url: COVERAGE_URL };
	} finally {
		await post('Profiler.stopPreciseCoverage');
		session.disconnect();
	}
}

function validate(fixture, entries) {
	return validateE2ERawV8Topology({
		artifactRoot: fixture.artifactRoot,
		profiles: [{ result: entries, 'source-map-cache': fixture.sourceMapCache ?? {} }],
		scripts: fixture.scripts,
	});
}
