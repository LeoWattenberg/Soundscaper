/* SPDX-License-Identifier: AGPL-3.0-only */

import ts from 'typescript';

export function deriveV8FunctionTopology(sourceFile, sourceLength) {
	const functions = [{ end: sourceLength, kind: 'root', names: new Set(['']), start: 0 }];
	visit(sourceFile);
	return {
		boundaries: contextualSourceBoundaries(sourceFile),
		functions: mergeEquivalentShapes(functions),
	};

	function visit(node) {
		if (isV8FunctionNode(node)) functions.push(v8FunctionShape(node, sourceFile));
		if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
			functions.push(...classInitializerShapes(node, sourceFile));
		}
		ts.forEachChild(node, visit);
	}
}

export function validateV8FunctionObservations(functions, topology, sourceLength, scriptId) {
	const failures = [];
	const observedBySpan = new Map();
	for (const [functionIndex, entry] of functions.entries()) {
		if (typeof entry?.functionName !== 'string' || typeof entry?.isBlockCoverage !== 'boolean'
			|| !Array.isArray(entry?.ranges) || entry.ranges.length === 0) {
			failures.push(`${scriptId} V8 function ${functionIndex} has invalid range topology.`);
			continue;
		}
		const root = entry.ranges[0];
		if (!validRange(root, sourceLength)) {
			failures.push(`${scriptId} V8 function ${functionIndex} has an invalid or escaped range.`);
			continue;
		}
		const shape = topology.functions.find(({ start, end }) => (
			start === root.startOffset && end === root.endOffset
		));
		if (!shape) {
			failures.push(`${scriptId} V8 function ${functionIndex} is not a source-derived V8 function.`);
		} else {
			const observed = observedBySpan.get(shape) ?? [];
			observed.push(entry);
			observedBySpan.set(shape, observed);
		}
		if (!entry.isBlockCoverage && entry.ranges.length !== 1) {
			failures.push(`${scriptId} non-block V8 function has nested ranges.`);
		}
		failures.push(...validateRangeTree(
			entry.ranges,
			topology.boundaries,
			sourceLength,
			scriptId,
			functionIndex,
		));
	}
	for (const [shape, observed] of observedBySpan) {
		if (observed.length > shape.identities.length) {
			failures.push(`${scriptId} duplicates a source-derived function span ${shape.start}-${shape.end}.`);
		} else if (!matchFunctionIdentities(observed, shape.identities)) {
			failures.push(`${scriptId} has a function identity that is not a source-derived V8 function at ${shape.start}-${shape.end}.`);
		}
	}
	return failures;
}

export function validateV8OwnerMultiplicity(entries, owners, scriptId) {
	const ownersBySpan = new Map();
	for (const candidate of owners) {
		const key = `${candidate.start}:${candidate.end}`;
		const matching = ownersBySpan.get(key) ?? [];
		matching.push(candidate);
		ownersBySpan.set(key, matching);
	}
	const failures = [];
	for (const [ownerSpan, matching] of ownersBySpan) {
		if (matching.length < 2) continue;
		const maximumObserved = Math.max(0, ...entries.map(({ functions }) => (
			Array.isArray(functions) ? functions.filter(({ ranges }) => (
				ranges?.[0]?.startOffset === matching[0].start
				&& ranges[0].endOffset === matching[0].end
			)).length : 0
		)));
		if (maximumObserved < matching.length) {
			failures.push(`${scriptId} is missing source-derived function multiplicity at ${ownerSpan}.`);
		}
	}
	return failures;
}

export function isV8FunctionNode(node) {
	if (ts.isFunctionLike(node)) return true;
	if (!ts.isClassStaticBlockDeclaration(node)) return false;
	return staticInitializerMembers(node.parent).length === 1;
}

export function v8FunctionStart(node, sourceFile) {
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

export function v8FunctionLabel(node, sourceFile) {
	if (ts.isClassStaticBlockDeclaration(node)) return '<static_initializer>';
	if (node.name && typeof node.name.getText === 'function') return JSON.stringify(node.name.getText(sourceFile));
	return `<anonymous at ${node.getStart(sourceFile)}>`;
}

function v8FunctionShape(node, sourceFile) {
	return {
		end: node.end,
		kind: 'explicit',
		names: v8FunctionNames(node, sourceFile),
		start: v8FunctionStart(node, sourceFile),
	};
}

function v8FunctionNames(node, sourceFile) {
	if (ts.isClassStaticBlockDeclaration(node)) return new Set(['<static_initializer>']);
	if (ts.isConstructorDeclaration(node)) {
		return node.parent.name ? nonemptyNames(propertyName(node.parent.name, sourceFile)) : null;
	}
	if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
		if (node.name && ts.isComputedPropertyName(node.name)) return null;
		const prefix = ts.isGetAccessorDeclaration(node) ? 'get ' : 'set ';
		return prefixedNames(prefix, nonemptyNames(propertyName(node.name, sourceFile)));
	}
	if (ts.isMethodDeclaration(node)) {
		return node.name && !ts.isComputedPropertyName(node.name)
			? nonemptyNames(propertyName(node.name, sourceFile)) : null;
	}
	if (node.name && !ts.isComputedPropertyName(node.name)) {
		return nonemptyNames(propertyName(node.name, sourceFile));
	}
	if (ts.isFunctionDeclaration(node) && hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
		return new Set(['default']);
	}
	return null;
}

function propertyName(node, sourceFile) {
	if (!node) return '';
	if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)
		|| ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
	return node.getText(sourceFile);
}

function classInitializerShapes(node, sourceFile) {
	const fields = node.members.filter(ts.isPropertyDeclaration);
	return [
		initializerShape(fields.filter((field) => !hasModifier(field, ts.SyntaxKind.StaticKeyword)),
			'<instance_members_initializer>', sourceFile),
		initializerShape(staticInitializerMembers(node),
			'<static_initializer>', sourceFile),
	].filter(Boolean);
}

function initializerShape(fields, name, sourceFile) {
	if (fields.length === 0) return null;
	return {
		end: initializerMemberEnd(fields.at(-1)),
		kind: 'implicit',
		names: new Set([name]),
		start: fields[0].getStart(sourceFile),
	};
}

function staticInitializerMembers(node) {
	return node.members.filter((member) => ts.isClassStaticBlockDeclaration(member)
		|| (ts.isPropertyDeclaration(member) && hasModifier(member, ts.SyntaxKind.StaticKeyword)));
}

function initializerMemberEnd(member) {
	if (ts.isPropertyDeclaration(member)) return member.initializer?.end ?? member.name.end;
	return member.end;
}

function contextualSourceBoundaries(sourceFile) {
	const boundaries = new Set([0, sourceFile.text.length]);
	visit(sourceFile);
	return boundaries;

	function visit(node) {
		boundaries.add(node.getStart(sourceFile));
		boundaries.add(node.end);
		for (const child of node.getChildren(sourceFile)) visit(child);
	}
}

function validateRangeTree(ranges, boundaries, sourceLength, scriptId, functionIndex) {
	const failures = [];
	const root = ranges[0];
	const stack = [root];
	let invalidBoundary = false;
	for (const [index, range] of ranges.entries()) {
		if (!validRange(range, sourceLength)
			|| range.startOffset < root.startOffset || range.endOffset > root.endOffset) {
			failures.push(`${scriptId} V8 function ${functionIndex} has an invalid or escaped range.`);
			return failures;
		}
		if (!boundaries.has(range.startOffset) || !boundaries.has(range.endOffset)) {
			invalidBoundary = true;
		}
		if (index === 0) continue;
		while (stack.length > 0 && range.startOffset >= stack.at(-1).endOffset) stack.pop();
		const parent = stack.at(-1);
		if (!parent || range.startOffset < parent.startOffset || range.endOffset > parent.endOffset) {
			failures.push(`${scriptId} V8 function ${functionIndex} has crossing V8 range topology.`);
			return failures;
		}
		if (range.startOffset === parent.startOffset && range.endOffset === parent.endOffset) {
			failures.push(`${scriptId} V8 function ${functionIndex} repeats a V8 range.`);
			return failures;
		}
		stack.push(range);
	}
	if (invalidBoundary) {
		failures.push(`${scriptId} V8 function ${functionIndex} has a non-source-derived range boundary.`);
	}
	return failures;
}

function mergeEquivalentShapes(shapes) {
	const merged = new Map();
	for (const shape of shapes) {
		const key = `${shape.start}:${shape.end}`;
		const existing = merged.get(key);
		if (!existing) merged.set(key, { ...shape, identities: [shape.names] });
		else if (sameStaticInitializer(existing, shape)) {
			existing.kind = 'explicit';
			existing.names = shape.names;
			existing.identities = [shape.names];
		} else existing.identities.push(shape.names);
	}
	return [...merged.values()];
}

function sameStaticInitializer(existing, shape) {
	if (!new Set([existing.kind, shape.kind]).has('implicit')
		|| !new Set([existing.kind, shape.kind]).has('explicit')) return false;
	return [existing.names, shape.names].every((names) => names?.size === 1
		&& names.has('<static_initializer>'));
}

function matchFunctionIdentities(observed, identities, index = 0) {
	if (index === observed.length) return true;
	for (const [identityIndex, names] of identities.entries()) {
		if (names !== null && !names.has(observed[index].functionName)) continue;
		const remaining = identities.filter((_, candidate) => candidate !== identityIndex);
		if (matchFunctionIdentities(observed, remaining, index + 1)) return true;
	}
	return false;
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

function prefixedNames(prefix, names) {
	return new Set([...names].map((name) => name.length > 0 ? `${prefix}${name}` : name));
}

function nonemptyNames(...names) {
	return new Set(names.filter((name) => typeof name === 'string'));
}

function hasModifier(node, kind) {
	return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}
