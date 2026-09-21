/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import { stableSha256Digest } from './e2e-coverage-integrity.mjs';
import { E2E_REPOSITORY_URL_PREFIX } from './e2e-coverage-prefixes.mjs';
import { mappedE2ESourceMapSegments } from './e2e-coverage-source-maps.mjs';

const LOGICAL_OPERATORS = new Set([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * Bind V8's runtime ranges to a denominator parsed independently from the
 * authenticated emitted JavaScript. Mapped chunks admit only generated code
 * attributed to the inventory's first-party sources; the script root remains
 * mandatory because V8 reports it for every admitted executable.
 *
 * Branch count inequalities are anti-omission consistency checks for counted
 * precise coverage. They are deliberately limited to syntax whose decision
 * and outcome probes have sound V8 count relationships.
 */
export function validateE2ERawV8Topology({ artifactRoot, profiles, scripts }) {
	if (typeof artifactRoot !== 'string' || !Array.isArray(profiles) || !Array.isArray(scripts)) {
		throw new TypeError('Raw V8 topology validation needs an artifact root, profiles, and scripts.');
	}
	const entriesByUrl = collectEntries(profiles);
	const sourceMapsByUrl = collectSourceMaps(profiles);
	const failures = [];
	for (const group of groupEquivalentScripts(scripts)) {
		const observedScripts = group.scripts.filter(({ coverageUrl }) => entriesByUrl.has(coverageUrl));
		const entries = observedScripts.flatMap(({ coverageUrl }) => entriesByUrl.get(coverageUrl) ?? []);
		if (entries.length === 0) continue;
		const script = observedScripts[0];
		let source;
		try {
			source = readFileSync(resolveInside(artifactRoot, script.artifactPath), 'utf8');
		} catch (error) {
			failures.push(`${script.id} topology source could not be read: ${errorMessage(error)}`);
			continue;
		}
		const ownerships = observedScripts.map((member) => sourceOwnership({
			caches: sourceMapsByUrl.get(member.coverageUrl),
			script: member,
			source,
		}));
		for (const ownership of ownerships) failures.push(...ownership.failures);
		if (ownerships.some(({ failures: mapFailures }) => mapFailures.length > 0)) continue;
		const topology = deriveTopology(source, script.artifactPath, ownerships[0]);
		failures.push(...topology.failures.map((failure) => `${script.id} ${failure}`));
		const observations = entries.flatMap(({ functions }) => Array.isArray(functions) ? functions : []);
		failures.push(...validateRanges(observations, source.length, script.id));
		for (const owner of topology.owners) {
			const matches = observations.filter((observation) => hasSpan(observation, owner));
			if (matches.length === 0) {
				const kind = owner.root ? 'root function' : 'explicit function';
				failures.push(`${script.id} is missing the source-derived ${kind} span ${span(owner)}.`);
				continue;
			}
			const detailedMatches = matches.filter(({ isBlockCoverage }) => isBlockCoverage === true);
			if (detailedMatches.length === 0) {
				failures.push(`${script.id} ${owner.label} supplied no detailed block coverage.`);
				continue;
			}
			if (owner.branches.length === 0) continue;
			const measured = coverageCounter(matches);
			const properRanges = detailedMatches.flatMap(({ ranges }) => ranges.slice(1));
			if (properRanges.length === 0) {
				failures.push(`${script.id} ${owner.label} is missing source-derived branch topology.`);
				continue;
			}
			for (const branch of owner.branches) {
				const failure = validateBranch(branch, measured);
				if (failure) failures.push(`${script.id} ${owner.label} ${failure}`);
			}
		}
	}
	return failures;
}

function collectSourceMaps(profiles) {
	const byUrl = new Map();
	for (const profile of profiles) {
		for (const [url, cache] of Object.entries(profile?.['source-map-cache'] ?? {})) {
			const values = byUrl.get(url) ?? [];
			values.push(cache);
			byUrl.set(url, values);
		}
	}
	return byUrl;
}

function collectEntries(profiles) {
	const byUrl = new Map();
	for (const profile of profiles) {
		for (const entry of profile?.result ?? []) {
			if (typeof entry?.url !== 'string') continue;
			const entries = byUrl.get(entry.url) ?? [];
			entries.push(entry);
			byUrl.set(entry.url, entries);
		}
	}
	return byUrl;
}

function groupEquivalentScripts(scripts) {
	const groups = new Map();
	for (const script of scripts) {
		const members = groups.get(script.coverageKey) ?? [];
		members.push(script);
		groups.set(script.coverageKey, members);
	}
	return [...groups.entries()].map(([coverageKey, members]) => ({
		coverageKey,
		scripts: members,
	}));
}

function deriveTopology(source, fileName, ownership) {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const root = owner('the root function', 0, source.length, true);
	const owners = [root];
	const failures = [];
	visitChildren(sourceFile, root);
	return { failures, owners };

	function visit(node, currentOwner) {
		if (isExplicitFunction(node)) {
			const start = functionStart(node, sourceFile);
			const functionOwner = owner(
				`explicit function ${functionLabel(node, sourceFile)}`,
				start,
				node.end,
				false,
			);
			if (ownership.ownsAny(start, node.end, nestedFunctionSpans(node, sourceFile))) {
				owners.push(functionOwner);
			}
			visitChildren(node, functionOwner);
			return;
		}
		const branch = branchProbe(node, sourceFile);
		for (const candidate of branch ?? []) {
			const probes = [candidate.decision, ...candidate.outcomes];
			const owned = probes.map(({ offset }) => ownership.owns(offset));
			if (owned.every(Boolean)) currentOwner.branches.push(candidate);
			else if (owned.some(Boolean)) {
				failures.push(`${candidate.label} crosses first-party source-map ownership.`);
			}
		}
		visitChildren(node, currentOwner);
	}

	function visitChildren(node, currentOwner) {
		ts.forEachChild(node, (child) => visit(child, currentOwner));
	}
}

function nestedFunctionSpans(node, sourceFile) {
	const spans = [];
	ts.forEachChild(node, visit);
	return spans.sort((left, right) => left.start - right.start);

	function visit(child) {
		if (isExplicitFunction(child)) {
			spans.push({
				start: child.getStart(sourceFile),
				end: child.end,
			});
			return;
		}
		ts.forEachChild(child, visit);
	}
}

function sourceOwnership({ caches, script, source }) {
	if (script.sourceMapSha256 == null) {
		return { failures: [], owns: () => true, ownsAny: (start, end) => start < end };
	}
	const failurePrefix = `${script.id} source-derived topology`;
	if (!Array.isArray(caches) || caches.length === 0 || caches.some((cache) => (
		!cache?.data || stableSha256Digest(cache.data) !== script.sourceMapSha256
	))) {
		return {
			failures: [`${failurePrefix} has no authenticated source map.`],
			owns: () => false,
			ownsAny: () => false,
		};
	}
	const cache = caches[0];
	let segments;
	try {
		segments = mappedE2ESourceMapSegments(cache.data, `${script.id} topology source map`);
	} catch (error) {
		return {
			failures: [`${failurePrefix} source map is invalid: ${errorMessage(error)}`],
			owns: () => false,
			ownsAny: () => false,
		};
	}
	const ownedSources = new Set(script.sources);
	const byLine = new Map();
	for (const segment of segments) {
		const line = byLine.get(segment.line) ?? [];
		line.push(segment);
		byLine.set(segment.line, line);
	}
	const positions = sourcePositions(source);
	const intervals = [];
	for (const [line, lineSegments] of byLine) {
		const lineStart = positions[line];
		const lineEnd = line + 1 < positions.length ? positions[line + 1] - 1 : source.length;
		if (lineStart === undefined || lineSegments.some(({ column }) => lineStart + column > lineEnd)) {
			return {
				failures: [`${failurePrefix} source map escapes its generated line.`],
				owns: () => false,
				ownsAny: () => false,
			};
		}
		for (const [index, segment] of lineSegments.entries()) {
			const end = index + 1 < lineSegments.length
				? lineStart + lineSegments[index + 1].column : lineEnd;
			if (ownedMapSource(segment.source, ownedSources) && lineStart + segment.column < end) {
				intervals.push({ start: lineStart + segment.column, end });
			}
		}
	}
	intervals.sort((left, right) => left.start - right.start);
	return {
		failures: [],
		owns(offset) {
			const interval = intervals[firstIntervalEndingAfter(intervals, offset)];
			return interval !== undefined && interval.start <= offset && offset < interval.end;
		},
		ownsAny(start, end, exclusions = []) {
			for (let index = firstIntervalEndingAfter(intervals, start); index < intervals.length; index += 1) {
				const interval = intervals[index];
				if (interval.start >= end) break;
				if (unexcludedOwnedCode(interval, start, end, exclusions, source)) return true;
			}
			return false;
		},
	};
}

function firstIntervalEndingAfter(intervals, offset) {
	let low = 0;
	let high = intervals.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (intervals[middle].end <= offset) low = middle + 1;
		else high = middle;
	}
	return low;
}

function sourcePositions(source) {
	const starts = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === '\n') starts.push(index + 1);
	}
	return starts;
}

function unexcludedOwnedCode(interval, start, end, exclusions, source) {
	let cursor = Math.max(interval.start, start);
	const limit = Math.min(interval.end, end);
	if (cursor >= limit) return false;
	for (const excluded of exclusions) {
		if (excluded.end <= cursor) continue;
		if (excluded.start >= limit) break;
		if (excluded.start > cursor && /\S/u.test(source.slice(cursor, Math.min(excluded.start, limit)))) {
			return true;
		}
		cursor = Math.max(cursor, excluded.end);
		if (cursor >= limit) return false;
	}
	return cursor < limit && /\S/u.test(source.slice(cursor, limit));
}

function ownedMapSource(source, ownedSources) {
	if (typeof source !== 'string' || !source.startsWith(E2E_REPOSITORY_URL_PREFIX)) return false;
	try {
		return ownedSources.has(decodeURIComponent(source.slice(E2E_REPOSITORY_URL_PREFIX.length)));
	} catch {
		return false;
	}
}

function owner(label, start, end, root) {
	return { branches: [], end, label, root, start };
}

function isExplicitFunction(node) {
	return ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
}

function functionStart(node, sourceFile) {
	if (!ts.isClassStaticBlockDeclaration(node)
		&& node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.StaticKeyword)) {
		const retainedModifier = node.modifiers.find(({ kind }) => kind !== ts.SyntaxKind.StaticKeyword);
		if (retainedModifier) return retainedModifier.getStart(sourceFile);
		if (node.asteriskToken) return node.asteriskToken.getStart(sourceFile);
		const accessorKeyword = node.getChildren(sourceFile).find(({ kind }) => (
			kind === ts.SyntaxKind.GetKeyword || kind === ts.SyntaxKind.SetKeyword
		));
		return accessorKeyword?.getStart(sourceFile) ?? node.name?.getStart(sourceFile)
			?? node.getStart(sourceFile);
	}
	if (!ts.isFunctionDeclaration(node)) return node.getStart(sourceFile);
	const retainedModifier = node.modifiers?.find(({ kind }) => (
		kind !== ts.SyntaxKind.ExportKeyword && kind !== ts.SyntaxKind.DefaultKeyword
	));
	if (retainedModifier) return retainedModifier.getStart(sourceFile);
	const functionKeyword = node.getChildren(sourceFile)
		.find(({ kind }) => kind === ts.SyntaxKind.FunctionKeyword);
	return functionKeyword?.getStart(sourceFile) ?? node.getStart(sourceFile);
}

function functionLabel(node, sourceFile) {
	if (ts.isClassStaticBlockDeclaration(node)) return '<static_initializer>';
	if (node.name && typeof node.name.getText === 'function') return JSON.stringify(node.name.getText(sourceFile));
	return `<anonymous at ${node.getStart(sourceFile)}>`;
}

function branchProbe(node, sourceFile) {
	if (ts.isIfStatement(node)) {
		return [{
			decision: probe(node.expression, sourceFile),
			kind: node.elseStatement ? 'alternatives' : 'implicit-alternative',
			label: `if statement at ${node.getStart(sourceFile)}`,
			outcomes: [
				outcomeProbe(node.thenStatement, sourceFile),
				...(node.elseStatement ? [outcomeProbe(node.elseStatement, sourceFile)] : []),
			],
		}];
	}
	if (ts.isConditionalExpression(node)) {
		return [{
			decision: probe(node.condition, sourceFile),
			kind: 'alternatives',
			label: `conditional expression at ${node.getStart(sourceFile)}`,
			outcomes: [probe(node.whenTrue, sourceFile), probe(node.whenFalse, sourceFile)],
		}];
	}
	if (ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind)) {
		return [{
			decision: probe(node.left, sourceFile),
			kind: 'short-circuit',
			label: `logical expression at ${node.getStart(sourceFile)}`,
			outcomes: [probe(node.right, sourceFile)],
		}];
	}
	if (ts.isSwitchStatement(node)) {
		const outcomes = node.caseBlock.clauses
			.filter(({ statements }) => statements.length > 0)
			.map(({ statements }) => probe(statements[0], sourceFile));
		return outcomes.length > 1 ? [{
			decision: probe(node.expression, sourceFile),
			kind: 'switch',
			label: `switch statement at ${node.getStart(sourceFile)}`,
			outcomes,
		}] : [];
	}
	if (ts.isTryStatement(node) && node.catchClause) {
		const tryProbe = firstStatementProbe(node.tryBlock, sourceFile);
		const catchProbe = firstStatementProbe(node.catchClause.block, sourceFile);
		return tryProbe && catchProbe ? [{
			decision: tryProbe,
			kind: 'catch',
			label: `catch clause at ${node.catchClause.getStart(sourceFile)}`,
			outcomes: [catchProbe],
		}] : [];
	}
	if (hasOptionalContinuation(node)) {
		return [{
			decision: probe(node.expression, sourceFile),
			kind: 'short-circuit',
			label: `optional chain at ${node.getStart(sourceFile)}`,
			outcomes: [{ offset: node.questionDotToken.end }],
		}];
	}
	return null;
}

function hasOptionalContinuation(node) {
	return (
		ts.isPropertyAccessExpression(node)
		|| ts.isElementAccessExpression(node)
		|| ts.isCallExpression(node)
	) && node.questionDotToken !== undefined;
}

function firstStatementProbe(block, sourceFile) {
	return block.statements.length > 0 ? probe(block.statements[0], sourceFile) : null;
}

function outcomeProbe(node, sourceFile) {
	return ts.isBlock(node) && node.statements.length > 0
		? probe(node.statements[0], sourceFile) : probe(node, sourceFile);
}

function probe(node, sourceFile) {
	return { offset: node.getStart(sourceFile) };
}

function validateBranch(branch, countAt) {
	const decisionCount = countAt(branch.decision.offset);
	const outcomeCounts = branch.outcomes.map(({ offset }) => countAt(offset));
	if (decisionCount <= 0 || outcomeCounts.some((count) => count <= 0)) {
		return `${branch.label} has incomplete branch topology.`;
	}
	if (branch.kind === 'alternatives') {
		if (outcomeCounts.some((count) => count >= decisionCount)) {
			return `${branch.label} has collapsed alternative branch topology.`;
		}
		return null;
	}
	if (branch.kind === 'implicit-alternative' || branch.kind === 'short-circuit' || branch.kind === 'catch') {
		if (outcomeCounts[0] >= decisionCount) {
			return `${branch.label} has collapsed implicit branch topology.`;
		}
		return null;
	}
	if (branch.kind === 'switch' && outcomeCounts.every((count) => count >= decisionCount)) {
		return `${branch.label} has collapsed switch branch topology.`;
	}
	return null;
}

function coverageCounter(functions) {
	return (offset) => functions.reduce((total, { ranges }) => {
		const containing = ranges
			.filter(({ startOffset, endOffset }) => startOffset <= offset && offset < endOffset)
			.sort((left, right) => (
				(left.endOffset - left.startOffset) - (right.endOffset - right.startOffset)
			));
		return total + (containing[0]?.count ?? 0);
	}, 0);
}

function validateRanges(functions, sourceLength, scriptId) {
	const failures = [];
	for (const [functionIndex, entry] of functions.entries()) {
		if (typeof entry?.functionName !== 'string' || typeof entry?.isBlockCoverage !== 'boolean'
			|| !Array.isArray(entry?.ranges) || entry.ranges.length === 0) {
			failures.push(`${scriptId} V8 function ${functionIndex} has invalid range topology.`);
			continue;
		}
		const root = entry.ranges[0];
		for (const range of entry.ranges) {
			if (!validRange(range, sourceLength)
				|| range.startOffset < root.startOffset || range.endOffset > root.endOffset) {
				failures.push(`${scriptId} V8 function ${functionIndex} has an invalid or escaped range.`);
				break;
			}
		}
	}
	return failures;
}

function validRange(range, sourceLength) {
	return Number.isSafeInteger(range?.startOffset)
		&& Number.isSafeInteger(range?.endOffset)
		&& Number.isSafeInteger(range?.count)
		&& range.startOffset >= 0
		&& range.startOffset < range.endOffset
		&& range.endOffset <= sourceLength
		&& range.count >= 0;
}

function hasSpan({ ranges }, { start, end }) {
	return Array.isArray(ranges)
		&& ranges[0]?.startOffset === start
		&& ranges[0]?.endOffset === end;
}

function resolveInside(root, candidate) {
	if (typeof candidate !== 'string' || candidate.length === 0 || isAbsolute(candidate)) {
		throw new Error('the artifact path is not a portable relative path');
	}
	const resolvedRoot = resolve(root);
	const resolved = resolve(resolvedRoot, candidate);
	const escaped = relative(resolvedRoot, resolved);
	if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
		throw new Error('the artifact path escapes the artifact root');
	}
	return resolved;
}

function span({ start, end }) {
	return `${start}-${end}`;
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
