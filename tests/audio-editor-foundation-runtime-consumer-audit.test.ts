/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import {
	FOUNDATION_RUNTIME_CONSUMER_SURFACES,
	FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS,
	FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES,
	FOUNDATION_RUNTIME_SHIELDED_OWNERS,
	FOUNDATION_RUNTIME_TIMING_READER_EXCLUSIONS,
} from '../src/common/editor/foundation-runtime-consumer-audit.ts';
import {
	createAudioClipV10,
	createAudioEditorProjectV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	createSourceFile,
	forEachChild,
	isAsExpression,
	isBinaryExpression,
	isCallExpression,
	isFunctionDeclaration,
	isIdentifier,
	isImportDeclaration,
	isMethodDeclaration,
	isParenthesizedExpression,
	isPropertyAccessExpression,
	isStringLiteral,
	isVariableDeclaration,
	ScriptKind,
	ScriptTarget,
	SyntaxKind,
	type FunctionLikeDeclaration,
	type Node,
	type SourceFile,
} from 'typescript';

const TIMING_FIELDS = new Set([
	'timelineStartFrame', 'timelineEndFrame', 'durationFrames',
	'sourceStartFrame', 'sourceEndFrame', 'sourceDurationFrames',
	'sequenceStartFrame', 'sequenceEndFrame', 'sequenceFrameCount',
	'sourceInFrame', 'sourceFrameCount', 'musicalStartBeat', 'musicalDurationBeats',
]);
const REPOSITORY_ROOT = new URL('../', import.meta.url);
const EDITOR_ROOT = new URL('../src/common/editor/', import.meta.url);

test('every shielded consumer surface crosses a registered runtime projection boundary before timing reads', async () => {
	assert.deepEqual(
		[...new Set(FOUNDATION_RUNTIME_CONSUMER_SURFACES.map(({ surface }) => surface))].sort(),
		['audio-export', 'composition', 'interchange', 'navigation', 'playback', 'preview', 'timeline', 'transition', 'video-export', 'waveform'],
	);
	const registeredBoundaries = new Set(FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES.map(({ boundary }) => boundary));
	for (const consumer of FOUNDATION_RUNTIME_CONSUMER_SURFACES) {
		assert.ok(registeredBoundaries.has(consumer.boundary), `${consumer.id} uses an unregistered boundary`);
		const source = await parsedSource(consumer.file);
		const entryPoint = findFunction(source, consumer.entryPoint);
		const boundaryCall = findCalls(entryPoint, consumer.boundary)[0];
		assert.ok(boundaryCall, `${consumer.surface} must call ${consumer.boundary}`);
		assert.equal(callFirstIdentifier(boundaryCall), consumer.inputIdentifier);
		if (consumer.projectedIdentifier !== null) {
			assert.ok(
				projectionIsAssigned(entryPoint, boundaryCall, consumer.projectedIdentifier),
				`${consumer.surface} must retain the projected project as ${consumer.projectedIdentifier}`,
			);
		}
		const firstTimingRead = propertyReads(entryPoint)
			.filter(({ name }) => TIMING_FIELDS.has(name))
			.sort((left, right) => left.position - right.position)[0];
		if (firstTimingRead) {
			assert.ok(
				boundaryCall.getStart() < firstTimingRead.position,
				`${consumer.surface} reads ${firstTimingRead.name} before runtime projection`,
			);
		}
		assert.ok(consumer.evidence.length > 20, `${consumer.surface} must explain its projection ownership`);
	}
});

test('every exported project entry point in the video consumer modules is registered', async () => {
	for (const file of ['src/common/editor/video-timeline.js', 'src/common/editor/video-export.js']) {
		const source = await parsedSource(file);
		const discovered = source.statements
			.filter(isFunctionDeclaration)
			.filter((declaration) => declaration.modifiers?.some(({ kind }) => kind === SyntaxKind.ExportKeyword))
			.filter((declaration) => declaration.parameters[0]?.name.getText(source) === 'project')
			.map((declaration) => declaration.name?.text)
			.filter((name): name is string => Boolean(name))
			.sort();
		const registered = FOUNDATION_RUNTIME_CONSUMER_SURFACES
			.filter((consumer) => consumer.file === file)
			.map(({ entryPoint }) => entryPoint)
			.sort();
		assert.deepEqual(registered, discovered, `${file} projection entry-point inventory drifted`);
	}
});

test('owned shield modules discover every named function that crosses a projection boundary', async () => {
	const boundaries = new Set(FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES.map(({ boundary }) => boundary));
	const registeredKeys = new Set(FOUNDATION_RUNTIME_CONSUMER_SURFACES
		.map(({ file, entryPoint }) => `${file}:${entryPoint}`));
	const discovered: string[] = [];
	for (const owner of FOUNDATION_RUNTIME_SHIELDED_OWNERS) {
		const source = await parsedSource(owner.file);
		visit(source, (node) => {
			if (!(isFunctionDeclaration(node) || isMethodDeclaration(node)) || !node.name) return;
			const entryPoint = node.name.getText(source);
			if (boundaries.has(entryPoint) && !registeredKeys.has(`${owner.file}:${entryPoint}`)) return;
			if (directBoundaryCalls(node, boundaries).length) discovered.push(`${owner.file}:${entryPoint}`);
		});
	}
	const registered = FOUNDATION_RUNTIME_CONSUMER_SURFACES
		.map(({ file, entryPoint }) => `${file}:${entryPoint}`)
		.sort();
	assert.deepEqual([...new Set(discovered)].sort(), registered);

	const ownedFiles = new Set(FOUNDATION_RUNTIME_SHIELDED_OWNERS.map(({ file }) => file));
	assert.deepEqual(
		[...new Set(FOUNDATION_RUNTIME_CONSUMER_SURFACES.map(({ file }) => file))].sort(),
		[...ownedFiles].sort(),
	);
	for (const owner of FOUNDATION_RUNTIME_SHIELDED_OWNERS) {
		const registeredSurfaces = new Set(FOUNDATION_RUNTIME_CONSUMER_SURFACES
			.filter(({ file }) => file === owner.file)
			.map(({ surface }) => surface));
		assert.deepEqual([...registeredSurfaces].sort(), [...owner.surfaces].sort());
	}
});

test('unregistered raw-project timing readers fail unless they have one exact persisted/downstream exclusion', async () => {
	const discovered: string[] = [];
	for (const owner of FOUNDATION_RUNTIME_SHIELDED_OWNERS) {
		const source = await parsedSource(owner.file);
		visit(source, (node) => {
			if (!(isFunctionDeclaration(node) || isMethodDeclaration(node)) || !node.name || !node.body) return;
			if (!node.parameters.some((parameter) => isIdentifier(parameter.name) && parameter.name.text === 'project')) return;
			if (!directTimingReads(node).length) return;
			discovered.push(`${owner.file}:${node.name.getText(source)}`);
		});
	}
	const registered = new Set(FOUNDATION_RUNTIME_CONSUMER_SURFACES
		.map(({ file, entryPoint }) => `${file}:${entryPoint}`));
	const exclusions = new Set(FOUNDATION_RUNTIME_TIMING_READER_EXCLUSIONS
		.map(({ file, entryPoint }) => `${file}:${entryPoint}`));
	assert.deepEqual(
		discovered.filter((entryPoint) => !registered.has(entryPoint)).sort(),
		[...exclusions].sort(),
	);
	for (const exclusion of FOUNDATION_RUNTIME_TIMING_READER_EXCLUSIONS) {
		assert.ok(exclusion.reason.length > 30);
		assert.ok(!registered.has(`${exclusion.file}:${exclusion.entryPoint}`));
	}
	const videoExport = await parsedSource('src/common/editor/video-export.js');
	const downstreamCalls = findCalls(videoExport, 'firstVisibleTimelineVideo');
	assert.equal(downstreamCalls.length, 1);
	assert.equal(callFirstIdentifier(downstreamCalls[0]), 'runtimeProject');
});

test('every projection or runtime-wrapper importer is an owned boundary or one exact non-consumer adapter', async () => {
	const discovered: string[] = [];
	for (const absoluteFile of await sourceFiles(EDITOR_ROOT.pathname)) {
		const sourceText = await readFile(absoluteFile, 'utf8');
		const file = relative(REPOSITORY_ROOT.pathname, absoluteFile).replaceAll('\\', '/');
		const source = createSourceFile(file, sourceText, ScriptTarget.Latest, true, scriptKind(file));
		if (source.statements.some((statement) => isImportDeclaration(statement)
			&& isStringLiteral(statement.moduleSpecifier)
			&& /(?:runtime-clip-projection|project-current-runtime)\.ts$/u.test(statement.moduleSpecifier.text))) {
			discovered.push(file);
		}
	}
	const classified = new Set([
		...FOUNDATION_RUNTIME_SHIELDED_OWNERS.map(({ file }) => file),
		...FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES.filter(({ root }) => !root).map(({ file }) => file),
		...FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS.map(({ file }) => file),
	]);
	assert.deepEqual(discovered.sort(), [...classified].sort());
	for (const exclusion of FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS) {
		assert.ok(exclusion.reason.length > 30);
	}
});

test('registered projection boundaries terminate at the branded clip resolver', async () => {
	const roots = FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES.filter(({ root }) => root);
	assert.deepEqual(roots.map(({ boundary }) => boundary), ['resolveRuntimeProjectProjection']);
	for (const boundary of FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES) {
		const source = await parsedSource(boundary.file);
		const implementation = findFunction(source, boundary.boundary);
		if (boundary.root) {
			assert.ok(findCalls(implementation, 'resolveRuntimeClipProjection').length >= 2);
			assert.ok(findCalls(implementation, 'brandRuntimeProjectProjection').length === 1);
			continue;
		}
		assert.ok(boundary.delegate);
		assert.ok(findCalls(implementation, boundary.delegate).length >= 1);
		assert.equal(findCalls(implementation, 'isRuntimeProjectProjection').length === 1, boundary.guardsBrand);
	}
});

test('audio export admission receives resolved musical clip timing from its entry projection', () => {
	const source = createAudioSourceV10({ id: 'source', frameCount: 192_000, channelCount: 1 });
	const clip = createAudioClipV10({
		id: 'clip',
		sourceId: source.id,
		sourceDurationFrames: 48_000,
		anchor: 'musical',
		musicalStartBeat: { num: 3, den: 1 },
		musicalExtent: 'beat',
		musicalDurationBeats: { num: 2, den: 1 },
	});
	const track = createAudioTrackV10({ id: 'track', clipIds: [clip.id] });
	const project = createAudioEditorProjectV10({
		id: 'audio-export-runtime-projection',
		now: '2026-08-09T12:00:00.000Z',
		sources: [source],
		clips: [clip],
		tracks: [track],
		selection: { startFrame: 80_000, endFrame: 90_000 },
	});
	const plan = createExportPlan(project, {
		format: 'wav',
		range: 'selection',
		includeTail: false,
		livePcmBytes: 0,
	});

	assert.equal(plan.render.offlineRenderAdmission?.preRollFrames, 80_000);
});

test('clip selection navigation owns its projected timing boundary', () => {
	const consumer = FOUNDATION_RUNTIME_CONSUMER_SURFACES.find(({ id }) => (
		id === 'clip-selection-navigation'
	));
	assert.deepEqual(consumer, {
		id: 'clip-selection-navigation',
		surface: 'navigation',
		file: 'src/common/editor/controller/clip-selection-navigation-service.ts',
		entryPoint: 'projectedAudioClips',
		inputIdentifier: 'project',
		projectedIdentifier: 'projection',
		boundary: 'resolveRuntimeProjectProjection',
		evidence: 'Clip-boundary and adjacent-clip navigation collect audio candidates only after resolving musical and sequence-backed clip timing at the owned service boundary.',
	});
	assert.deepEqual(
		FOUNDATION_RUNTIME_SHIELDED_OWNERS.find(({ file }) => file === consumer?.file),
		{ file: consumer?.file, surfaces: ['navigation'] },
	);
});

test('the runtime consumer audit is immutable and uniquely identifies each surface', () => {
	assert.equal(
		new Set(FOUNDATION_RUNTIME_CONSUMER_SURFACES.map(({ id }) => id)).size,
		FOUNDATION_RUNTIME_CONSUMER_SURFACES.length,
	);
	assert.ok(Object.isFrozen(FOUNDATION_RUNTIME_CONSUMER_SURFACES));
	assert.ok(Object.isFrozen(FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES));
	assert.ok(Object.isFrozen(FOUNDATION_RUNTIME_SHIELDED_OWNERS));
	assert.ok(Object.isFrozen(FOUNDATION_RUNTIME_TIMING_READER_EXCLUSIONS));
	assert.ok(Object.isFrozen(FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS));
	for (const consumer of FOUNDATION_RUNTIME_CONSUMER_SURFACES) assert.ok(Object.isFrozen(consumer));
	for (const boundary of FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES) assert.ok(Object.isFrozen(boundary));
	for (const owner of FOUNDATION_RUNTIME_SHIELDED_OWNERS) assert.ok(Object.isFrozen(owner));
	for (const exclusion of FOUNDATION_RUNTIME_TIMING_READER_EXCLUSIONS) assert.ok(Object.isFrozen(exclusion));
	for (const exclusion of FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS) assert.ok(Object.isFrozen(exclusion));
});

async function parsedSource(file: string): Promise<SourceFile> {
	const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
	return createSourceFile(file, source, ScriptTarget.Latest, true, scriptKind(file));
}

function findFunction(source: SourceFile, name: string): FunctionLikeDeclaration {
	let match: FunctionLikeDeclaration | null = null;
	visit(source, (node) => {
		if (match) return;
		if ((isFunctionDeclaration(node) || isMethodDeclaration(node)) && node.name && node.name.getText(source) === name) {
			match = node;
		}
	});
	assert.ok(match, `${source.fileName} must define ${name}`);
	return match;
}

function findCalls(node: Node, name: string): readonly import('typescript').CallExpression[] {
	const calls: import('typescript').CallExpression[] = [];
	visit(node, (candidate) => {
		if (!isCallExpression(candidate)) return;
		if (callName(candidate) === name) calls.push(candidate);
	});
	return calls;
}

function directBoundaryCalls(
	node: FunctionLikeDeclaration,
	boundaries: ReadonlySet<string>,
): readonly import('typescript').CallExpression[] {
	const calls: import('typescript').CallExpression[] = [];
	const walk = (candidate: Node): void => {
		if (candidate !== node && (isFunctionDeclaration(candidate) || isMethodDeclaration(candidate))) return;
		if (isCallExpression(candidate) && boundaries.has(callName(candidate) ?? '')) calls.push(candidate);
		forEachChild(candidate, walk);
	};
	walk(node);
	return calls;
}

function callName(call: import('typescript').CallExpression): string | null {
	if (isIdentifier(call.expression)) return call.expression.text;
	if (isPropertyAccessExpression(call.expression)) return call.expression.name.text;
	return null;
}

function callFirstIdentifier(call: import('typescript').CallExpression): string | null {
	let argument = call.arguments[0];
	while (argument && (isAsExpression(argument) || isParenthesizedExpression(argument))) argument = argument.expression;
	return argument && isIdentifier(argument) ? argument.text : null;
}

function projectionIsAssigned(
	entryPoint: FunctionLikeDeclaration,
	call: import('typescript').CallExpression,
	identifier: string,
): boolean {
	let owned = false;
	visit(entryPoint, (node) => {
		if (owned || call.getStart() < node.getStart() || call.getEnd() > node.getEnd()) return;
		if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === identifier) owned = true;
		if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.EqualsToken
			&& isIdentifier(node.left) && node.left.text === identifier) owned = true;
	});
	return owned;
}

function propertyReads(node: Node): readonly { readonly name: string; readonly position: number }[] {
	const reads: { name: string; position: number }[] = [];
	visit(node, (candidate) => {
		if (isPropertyAccessExpression(candidate)) {
			reads.push({ name: candidate.name.text, position: candidate.getStart() });
		}
	});
	return reads;
}

function directTimingReads(node: FunctionLikeDeclaration): readonly { readonly name: string; readonly position: number }[] {
	const reads: { name: string; position: number }[] = [];
	const walk = (candidate: Node): void => {
		if (candidate !== node && (isFunctionDeclaration(candidate) || isMethodDeclaration(candidate))) return;
		if (isPropertyAccessExpression(candidate) && TIMING_FIELDS.has(candidate.name.text)) {
			reads.push({ name: candidate.name.text, position: candidate.getStart() });
		}
		forEachChild(candidate, walk);
	};
	walk(node);
	return reads;
}

function scriptKind(file: string): ScriptKind {
	if (/\.tsx$/u.test(file)) return ScriptKind.TSX;
	if (/\.jsx$/u.test(file)) return ScriptKind.JSX;
	if (/\.ts$/u.test(file)) return ScriptKind.TS;
	return ScriptKind.JS;
}

async function sourceFiles(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await sourceFiles(path));
		else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) files.push(path);
	}
	return files;
}

function visit(node: Node, callback: (node: Node) => void): void {
	callback(node);
	forEachChild(node, (child) => visit(child, callback));
}
