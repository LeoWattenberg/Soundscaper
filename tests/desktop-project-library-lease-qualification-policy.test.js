/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('current desktop lease qualification is product-isolated and remains pending external', async () => {
	const compatibility = await json('config/project-compatibility.json');
	const rule = compatibility.rules.find(
		({ id }) => id === 'current-desktop-electron-lease-protections',
	);
	assert.ok(rule);
	assert.equal(rule.status, 'partial');
	const claim = `${rule.requiredOutcome} ${rule.currentBehavior}`;
	assert.match(claim, /Soundscaper.*V9.*short-lived.*writer (?:session|lease)/isu);
	assert.match(claim, /Framescaper.*V10.*process-lifetime.*main-owned.*lease/isu);
	assert.match(claim, /Framescaper.*session.*recovery/isu);
	assert.match(claim, /cross-product.*(?:physical|storage).*isolation.*not.*shared mutable catalog/isu);
	assert.match(claim, /historical.*eight.*V9.*V17/isu);
	assert.match(claim, /does not authorize.*Framescaper V17/isu);
	for (const product of ['Soundscaper V9', 'Framescaper V10']) {
		for (const target of ['Windows x64', 'Linux x64']) {
			assert.match(claim, new RegExp(`${product}.*${target}.*pending-external`, 'isu'));
		}
	}
	assert.match(claim, /no accepted packaged result/isu);

	const security = await json('config/production-security-matrix.json');
	const controls = new Map(security.risks.flatMap(({ currentControls }) => (
		currentControls.map((control) => [control.id, control])
	)));
	const v9 = controls.get('packaged-cross-platform-electron-lease-matrix');
	const v10 = controls.get('framescaper-v18-desktop-v10-isolation');
	assert.ok(v9);
	assert.ok(v10);
	assert.match(v9.summary, /Soundscaper.*V9.*seven.*workflow/isu);
	assert.match(v9.summary, /cross-product-simultaneous-open.*historical.*not run/isu);
	assert.match(v9.summary, /Windows x64.*Linux x64.*pending-external/isu);
	assert.match(v10.summary, /process-lifetime.*lease.*session.*recovery/isu);
	assert.match(v10.summary, /Windows x64.*Linux x64.*pending-external/isu);
	assert.match(`${v9.summary} ${v10.summary}`, /separate.*(?:scope|database|storage).*cross-product.*isolation/isu);
});

test('roadmap preserves the frozen M2 inventory as history without re-admitting Framescaper V17', async () => {
	const closure = await json('config/milestone-2-closure.json');
	const item = closure.items.find(({ id }) => id === 'm2-electron-lease-matrix');
	assert.equal(closure.scopeRevision, 2);
	assert.deepEqual(item.workflowIds, [
		'same-project-simultaneous-open',
		'cross-product-simultaneous-open',
		'writer-lease-transfer',
		'stale-lease-takeover',
		'conflicting-canonical-commit',
		'renderer-loss-during-operation',
		'orderly-process-restart',
		'crash-restart-recovery',
	]);

	const roadmap = await text('roadmap.md');
	assert.match(roadmap, /eight.*workflow.*frozen historical.*V9.*V17/isu);
	assert.match(roadmap, /current executable qualification.*Soundscaper V9.*Framescaper V10/isu);
	assert.match(roadmap, /does not.*re-admit.*Framescaper V17/isu);
	assert.match(roadmap, /Windows x64.*Linux x64.*accepted packaged results.*absent.*Partial/isu);
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, ROOT), 'utf8');
}
