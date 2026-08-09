/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Qualification narratives that appear in both a register and a markdown
// document are derived, not hand-mirrored: the register text is the single
// source, and the document carries a marked block holding its rendered form.
// `node scripts/sync-policy-narratives.mjs` rewrites the blocks; `--check`
// (and tests/policy-narrative-sync.test.js) fails when a block drifts.

export const FALLBACK_WITNESS_ROLES = Object.freeze([
	'project-audio-mix-v1',
	'audio-track-render-v1',
	'project-video-render-v1',
	'video-clip-render-v1',
]);

export const FALLBACK_ROUNDTRIP_WORKFLOWS = Object.freeze([
	'audio-whole-mix-electron-roundtrip',
	'audio-track-render-electron-roundtrip',
	'video-full-project-electron-roundtrip',
	'video-clip-render-electron-roundtrip',
]);

export const ELECTRON_LIBRARY_WORKFLOWS = Object.freeze([
	'electron-soundscaper-to-framescaper-to-soundscaper-library',
	'electron-framescaper-to-soundscaper-to-framescaper-library',
]);

export const ELECTRON_LEASE_WORKFLOWS = Object.freeze([
	'same-project-simultaneous-open',
	'cross-product-simultaneous-open',
	'writer-lease-transfer',
	'stale-lease-takeover',
	'conflicting-canonical-commit',
	'renderer-loss-during-operation',
	'orderly-process-restart',
	'crash-restart-recovery',
]);

const QUALIFICATION_ID_TOKENS = Object.freeze([
	...FALLBACK_WITNESS_ROLES,
	...FALLBACK_ROUNDTRIP_WORKFLOWS,
	...ELECTRON_LIBRARY_WORKFLOWS,
	...ELECTRON_LEASE_WORKFLOWS,
]);

export const POLICY_NARRATIVE_BINDINGS = Object.freeze([
	Object.freeze({
		marker: 'timeline-annotation-capability',
		register: 'config/project-compatibility.json',
		ruleId: 'current-timeline-annotation-capability',
		field: 'currentBehavior',
		document: 'docs/project-compatibility.md',
		intro: null,
		wrap: 80,
	}),
	Object.freeze({
		marker: 'desktop-electron-lease-protections',
		register: 'config/project-compatibility.json',
		ruleId: 'current-desktop-electron-lease-protections',
		field: 'currentBehavior',
		document: 'docs/project-compatibility.md',
		intro: null,
		wrap: 80,
	}),
	Object.freeze({
		marker: 'packaged-cross-platform-electron-lease-matrix',
		register: 'config/production-security-matrix.json',
		riskId: 'shared-desktop-project-library-integrity',
		controlId: 'packaged-cross-platform-electron-lease-matrix',
		field: 'summary',
		document: 'docs/production-threat-model.md',
		intro: null,
	}),
	Object.freeze({
		marker: 'packaged-source-bearing-handoff',
		register: 'config/production-security-matrix.json',
		riskId: 'shared-desktop-project-library-integrity',
		controlId: 'packaged-linux-x64-source-bearing-project-library-handoff',
		field: 'summary',
		document: 'docs/production-threat-model.md',
		intro: Object.freeze([
			'A maintained Linux x64 CI job runs',
			'A separate maintained Linux x64 CI job runs',
		]),
	}),
	Object.freeze({
		marker: 'chromium-scape-mixed-media-handoff',
		register: 'config/production-security-matrix.json',
		riskId: 'shared-desktop-project-library-integrity',
		controlId: 'chromium-scape-mixed-media-handoff',
		field: 'summary',
		document: 'docs/production-threat-model.md',
		intro: null,
	}),
	Object.freeze({
		marker: 'desktop-packaged-source-bearing-handoff',
		register: 'config/project-compatibility.json',
		ruleId: 'current-desktop-packaged-source-bearing-handoff',
		field: 'currentBehavior',
		document: 'docs/project-compatibility.md',
		intro: Object.freeze([
			'A maintained Linux x64 CI job runs',
			'A second maintained Linux x64 CI job runs',
		]),
		wrap: 80,
	}),
]);

export function renderPolicyNarrative(text, binding) {
	let rendered = text;
	if (binding.intro) {
		const [registerIntro, documentIntro] = binding.intro;
		assert(rendered.startsWith(registerIntro),
			`${binding.marker} register text must start with "${registerIntro}"`);
		rendered = documentIntro + rendered.slice(registerIntro.length);
	}
	rendered = rendered.replace(/\b(Soundscaper|Framescaper) to (?=(?:Soundscaper|Framescaper)\b)/gu, '$1 → ');
	for (const token of QUALIFICATION_ID_TOKENS) {
		rendered = rendered.replace(new RegExp(`(?<!\`)\\b${token}\\b(?!\`)`, 'gu'), `\`${token}\``);
	}
	if (binding.wrap) rendered = wrapText(rendered, binding.wrap);
	return rendered;
}

function wrapText(text, width) {
	const lines = [];
	let line = '';
	for (const word of text.split(' ')) {
		if (line === '') line = word;
		else if (line.length + 1 + word.length <= width) line += ` ${word}`;
		else { lines.push(line); line = word; }
	}
	if (line !== '') lines.push(line);
	return lines.join('\n');
}

export async function loadPolicyNarratives(repositoryRoot) {
	assert(typeof repositoryRoot === 'string' && repositoryRoot, 'repositoryRoot is required');
	const narratives = [];
	for (const binding of POLICY_NARRATIVE_BINDINGS) {
		const register = JSON.parse(await readFile(resolve(repositoryRoot, binding.register), 'utf8'));
		let carrier;
		if (binding.ruleId) {
			carrier = register.rules.find(({ id }) => id === binding.ruleId);
			assert(carrier, `${binding.marker}: rule ${binding.ruleId} is missing from ${binding.register}`);
		} else {
			const risk = register.risks.find(({ id }) => id === binding.riskId);
			assert(risk, `${binding.marker}: risk ${binding.riskId} is missing from ${binding.register}`);
			carrier = risk.currentControls.find(({ id }) => id === binding.controlId);
			assert(carrier, `${binding.marker}: control ${binding.controlId} is missing from ${binding.register}`);
		}
		const source = carrier[binding.field];
		assert(typeof source === 'string' && source, `${binding.marker}: ${binding.field} is empty`);
		narratives.push({ binding, rendered: renderPolicyNarrative(source, binding) });
	}
	return narratives;
}

export async function syncPolicyNarratives(repositoryRoot, { write = false } = {}) {
	const narratives = await loadPolicyNarratives(repositoryRoot);
	const stale = [];
	const documents = new Map();
	for (const { binding, rendered } of narratives) {
		const documentPath = resolve(repositoryRoot, binding.document);
		if (!documents.has(documentPath)) {
			documents.set(documentPath, await readFile(documentPath, 'utf8'));
		}
		const text = documents.get(documentPath);
		const open = `<!-- policy-narrative:${binding.marker} -->\n`;
		const close = `\n<!-- /policy-narrative:${binding.marker} -->`;
		const start = text.indexOf(open);
		assert(start !== -1, `${binding.document} is missing the ${binding.marker} narrative marker`);
		const bodyStart = start + open.length;
		const end = text.indexOf(close, bodyStart);
		assert(end !== -1, `${binding.document} is missing the closing ${binding.marker} narrative marker`);
		assert(text.indexOf(open, bodyStart) === -1, `${binding.marker} narrative marker appears more than once`);
		if (text.slice(bodyStart, end) !== rendered) {
			stale.push(binding.marker);
			documents.set(documentPath, text.slice(0, bodyStart) + rendered + text.slice(end));
		}
	}
	if (write && stale.length > 0) {
		for (const [documentPath, text] of documents) await writeFile(documentPath, text);
	}
	return { stale, narrativeCount: narratives.length };
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
