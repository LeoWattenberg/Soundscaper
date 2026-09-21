/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from 'node:inspector';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { runInThisContext } from 'node:vm';

import { validateE2ERawV8Topology } from '../scripts/lib/e2e-v8-topology.mjs';

const SOURCE = 'function collision(){return 1}';
const ANONYMOUS_SOURCE = '()=>1';

test('a script root and explicit function may share one required source span', async (t) => {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-v8-function-topology-'));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	const artifactRoot = join(workspace, 'artifacts');
	const artifactPath = 'executables/collision.js';
	const executable = join(artifactRoot, artifactPath);
	mkdirSync(join(artifactRoot, 'executables'), { recursive: true });
	writeFileSync(executable, SOURCE);
	const coverageUrl = pathToFileURL(executable).href;
	const entry = await captureCoverage(SOURCE, coverageUrl, 'collision()');
	assert.equal(entry.functions.length, 2);
	assert.ok(entry.functions.every(({ ranges }) => (
		ranges[0]?.startOffset === 0 && ranges[0]?.endOffset === SOURCE.length
	)));
	const fixture = {
		artifactRoot,
		scripts: [{ artifactPath, coverageKey: coverageUrl, coverageUrl, id: artifactPath }],
	};
	assert.deepEqual(validate(fixture, entry), []);
	assert.match(validate(fixture, { ...entry, functions: entry.functions.slice(0, 1) }).join('\n'),
		/missing source-derived function multiplicity/u);

	const anonymousPath = 'executables/anonymous.js';
	const anonymousExecutable = join(artifactRoot, anonymousPath);
	writeFileSync(anonymousExecutable, ANONYMOUS_SOURCE);
	const anonymousUrl = pathToFileURL(anonymousExecutable).href;
	const anonymous = await captureCoverage(ANONYMOUS_SOURCE, anonymousUrl);
	assert.equal(anonymous.functions.length, 2);
	const anonymousFixture = {
		artifactRoot,
		scripts: [{
			artifactPath: anonymousPath,
			coverageKey: anonymousUrl,
			coverageUrl: anonymousUrl,
			id: anonymousPath,
		}],
	};
	const uncovered = validate(anonymousFixture, anonymous).join('\n');
	assert.doesNotMatch(uncovered, /duplicates a source-derived function span/u);
	assert.equal(uncovered, '');
	const excess = { ...anonymous, functions: [...anonymous.functions, anonymous.functions[1]] };
	assert.match(validate(anonymousFixture, excess).join('\n'), /duplicates a source-derived function span/u);
});

async function captureCoverage(source, coverageUrl, invocation) {
	const session = new Session();
	session.connect();
	const post = (method, parameters = {}) => new Promise((resolve, reject) => {
		session.post(method, parameters, (error, result) => error ? reject(error) : resolve(result));
	});
	try {
		await post('Profiler.enable');
		await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
		runInThisContext(source, { filename: coverageUrl });
		if (invocation) runInThisContext(invocation, { filename: 'soundscaper-topology-harness' });
		const { result } = await post('Profiler.takePreciseCoverage');
		const entry = result.find(({ url }) => url === coverageUrl);
		assert.ok(entry);
		return entry;
	} finally {
		runInThisContext('delete globalThis.collision');
		await post('Profiler.stopPreciseCoverage');
		session.disconnect();
	}
}

function validate(fixture, entry) {
	return validateE2ERawV8Topology({
		artifactRoot: fixture.artifactRoot,
		profiles: [{ result: [entry] }],
		scripts: fixture.scripts,
	});
}
