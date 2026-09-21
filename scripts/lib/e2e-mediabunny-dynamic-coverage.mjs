/* SPDX-License-Identifier: AGPL-3.0-only */

import ts from 'typescript';

import {
	mappedE2ESourceAt,
	mappedE2ESourceMapEntries,
	mappedE2ESourceMapSegments,
} from './e2e-coverage-source-maps.mjs';

const EXTERNAL_SOURCE_PREFIX = 'file:///__soundscaper_external__/';
const RECIPE_CONTRACTS = Object.freeze([
	Object.freeze({
		id: 'unthrottled-timer-v1',
		calls: Object.freeze(['clearInterval', 'clearTimeout', 'postMessage', 'setInterval', 'setTimeout']),
		literals: Object.freeze(['clear-interval', 'clear-timeout', 'fire', 'set-interval', 'set-timeout']),
		mime: 'text/javascript',
		revokes: true,
		sourcePath: 'node_modules/mediabunny/dist/modules/src/misc.js',
		tail: ')();',
	}),
	Object.freeze({
		id: 'color-alpha-merger-v1',
		calls: Object.freeze(['VideoFrame', 'addEventListener', 'postMessage']),
		literals: Object.freeze(['CPU color/alpha merging requires a known VideoFrame format.', 'message']),
		mime: 'application/javascript',
		revokes: false,
		sourcePath: 'node_modules/mediabunny/dist/modules/src/media-sink.js',
		tail: ')()',
	}),
	Object.freeze({
		id: 'color-alpha-splitter-v1',
		calls: Object.freeze(['VideoFrame', 'addEventListener', 'postMessage']),
		literals: Object.freeze(['CPU color/alpha splitting requires a known VideoFrame format.', 'message']),
		mime: 'application/javascript',
		revokes: false,
		sourcePath: 'node_modules/mediabunny/dist/modules/src/media-source.js',
		tail: ')()',
	}),
	Object.freeze({
		id: 'media-stream-track-processor-v1',
		calls: Object.freeze([
			'AbortController',
			'MediaStreamTrackProcessor',
			'WritableStream',
			'addEventListener',
			'postMessage',
		]),
		literals: Object.freeze(['stopTrack', 'support', 'trackStopped', 'videoFrame', 'videoTrack']),
		mime: 'application/javascript',
		revokes: false,
		sourcePath: 'node_modules/mediabunny/dist/modules/src/media-source.js',
		tail: ')()',
	}),
]);

/** Derive the exact four third-party Blob worker programs from attested emitted bytes. */
export function mediabunnyBlobWorkerSources(scripts, label = 'E2E build') {
	const sources = new Map();
	const observedRecipes = new Set();
	for (const script of scripts) {
		const provenance = mediabunnyMappedSources(script.fullSourceMap, label);
		if (provenance.size === 0) continue;
		for (const recipe of emittedWorkerRecipes(
			script.source,
			script.artifactPath,
			script.fullSourceMap,
			label,
		)) {
			if (!provenance.has(recipe.contract.sourcePath)) {
				throw new Error(
					`The ${label} Mediabunny ${recipe.contract.id} recipe has no matching mapped provenance.`,
				);
			}
			if (observedRecipes.has(recipe.contract.id)) {
				throw new Error(`The ${label} contains a duplicate Mediabunny ${recipe.contract.id} recipe.`);
			}
			const previous = sources.get(recipe.source);
			if (previous !== undefined && previous !== recipe.contract.id) {
				throw new Error(`The ${label} Mediabunny Blob worker recipe is ambiguous.`);
			}
			observedRecipes.add(recipe.contract.id);
			sources.set(recipe.source, recipe.contract.id);
		}
	}
	return Object.freeze([...sources.keys()].sort());
}

/** A packaged renderer may never borrow a worker program from main or preload. */
export function rendererMediabunnyBlobWorkerSources(scripts, label = 'Electron renderer') {
	return mediabunnyBlobWorkerSources(
		scripts.filter(({ realm }) => realm === 'renderer'),
		label,
	);
}

/** Authenticate a browser Blob against the build whose HTTP origin created it. */
export function isBrowserMediabunnyBlobCoverage({ entry, evidence, profile }) {
	if (!blobUrl(entry?.url)) return false;
	const origin = new URL(entry.url).origin;
	const product = [...evidence.browser.values()].find((candidate) => candidate.origin === origin);
	return product !== undefined && admittedSource(product.mediabunnyBlobWorkerSources, profile, entry.url);
}

/** Authenticate a packaged Blob against either shipped renderer for its product. */
export function isPackagedMediabunnyBlobCoverage({ entry, evidence, profile, productId }) {
	if (!blobUrl(entry?.url)) return false;
	const expected = [
		...(evidence.browser.get(productId)?.mediabunnyBlobWorkerSources ?? []),
		...(evidence.electron.get(productId)?.mediabunnyBlobWorkerSources ?? []),
	];
	return admittedSource(expected, profile, entry.url);
}

function emittedWorkerRecipes(source, artifactPath, map, label) {
	if (typeof source !== 'string') {
		throw new TypeError(`${label} Mediabunny evidence requires emitted script bytes.`);
	}
	const file = ts.createSourceFile(
		artifactPath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	if (file.parseDiagnostics.length > 0) {
		throw new Error(`The ${label} Mediabunny executable ${artifactPath} is not parseable JavaScript.`);
	}
	const checker = checkerFor(file, source);
	const segments = map === null || map === undefined
		? [] : mappedE2ESourceMapSegments(map, `${label} Mediabunny source map`);
	const recipes = [];
	const visit = (node) => {
		if (executableFunctionTemplate(node)) {
			const worker = workerFunction(node, checker);
			const contract = worker === null ? null : workerContract(worker);
			const callsite = contract === null ? null : canonicalWorkerCallsite(node, contract, checker);
			if (contract === null || node.templateSpans[0].literal.text !== contract.tail
				|| callsite === null) {
				throw new Error(
					`The ${label} executable ${artifactPath} has an unattested Mediabunny Blob worker recipe.`,
				);
			}
			// Evidence manifests authenticate the complete emitted bytes and their map.
			// Bind both sides of Function#toString to the exact third-party original so
			// an unrelated producer in a mixed first-party/vendor chunk cannot borrow it.
			if ([worker, node, ...callsite].some((candidate) => (
				!mappedMediabunnySpan(map, segments, file, candidate, contract.sourcePath, label)
			))) {
				throw new Error(
					`The ${label} Mediabunny ${contract.id} recipe has no matching mapped provenance.`,
				);
			}
			const functionSource = source.slice(worker.getStart(file), worker.end);
			recipes.push(Object.freeze({
				contract,
				source: `${node.head.text}${functionSource}${node.templateSpans[0].literal.text}`,
			}));
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return recipes;
}

function mappedMediabunnySpan(map, segments, file, node, sourcePath, label) {
	if (map === null || map === undefined) return null;
	const nodeStart = node.getStart(file);
	const lineStarts = file.getLineStarts();
	const start = file.getLineAndCharacterOfPosition(nodeStart);
	const end = file.getLineAndCharacterOfPosition(node.end);
	for (let line = start.line; line <= end.line; line += 1) {
		const from = Math.max(nodeStart, lineStarts[line]);
		const to = Math.min(node.end, lineStarts[line + 1] ?? file.text.length);
		const code = /\S/u.exec(file.text.slice(from, to));
		if (code !== null && externalSourcePath(mappedE2ESourceAt(
			map,
			line,
			from - lineStarts[line] + code.index,
			`${label} Mediabunny source map`,
		)?.source) !== sourcePath) return false;
	}
	return segments.filter((segment) => afterStart(segment, start) && beforeEnd(segment, end))
		.every(({ source }) => externalSourcePath(source) === sourcePath);
}

function afterStart(segment, start) {
	return segment.line > start.line
		|| segment.line === start.line && segment.column > start.character;
}

function beforeEnd(segment, end) {
	return segment.line < end.line || segment.line === end.line && segment.column < end.character;
}

function checkerFor(file, source) {
	const name = file.fileName;
	const host = {
		fileExists: (candidate) => candidate === name,
		getCanonicalFileName: (candidate) => candidate,
		getCurrentDirectory: () => '/',
		getDefaultLibFileName: () => '',
		getDirectories: () => [],
		getNewLine: () => '\n',
		getSourceFile: (candidate) => candidate === name ? file : undefined,
		readFile: (candidate) => candidate === name ? source : undefined,
		useCaseSensitiveFileNames: () => true,
		writeFile: () => undefined,
	};
	return ts.createProgram([name], { allowJs: true, noLib: true }, host).getTypeChecker();
}

function executableFunctionTemplate(node) {
	if (!ts.isTemplateExpression(node) || node.head.text !== '(' || node.templateSpans.length !== 1
		|| ![')()', ')();'].includes(node.templateSpans[0].literal.text)) return false;
	const expression = node.templateSpans[0].expression;
	return ts.isCallExpression(expression) && expression.arguments.length === 0
		&& ts.isPropertyAccessExpression(expression.expression)
		&& expression.expression.name.text === 'toString'
		&& ts.isIdentifier(expression.expression.expression);
}

function workerFunction(template, checker) {
	const receiver = template.templateSpans[0].expression.expression.expression;
	const declaration = checker.getSymbolAtLocation(receiver)?.valueDeclaration;
	if (declaration === undefined) return null;
	if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
		&& ts.isFunctionLike(declaration.initializer)) return declaration.initializer;
	return ts.isFunctionDeclaration(declaration) ? declaration : null;
}

function workerContract(worker) {
	if (worker.parameters.length !== 0) return null;
	const calls = new Set();
	const literals = new Set();
	const visit = (node) => {
		if (ts.isStringLiteralLike(node)) literals.add(node.text);
		if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
			const name = callableName(node.expression);
			if (name !== null) calls.add(name);
		}
		ts.forEachChild(node, visit);
	};
	visit(worker);
	const matches = RECIPE_CONTRACTS.filter((contract) => (
		contract.calls.every((name) => calls.has(name))
		&& contract.literals.every((value) => literals.has(value))
	));
	return matches.length === 1 ? matches[0] : null;
}

function canonicalWorkerCallsite(template, contract, checker) {
	const owner = enclosingFunction(template) ?? template.getSourceFile();
	const templateAliases = aliasesFor(owner, template, checker);
	const blobs = descendants(owner, (node) => ts.isNewExpression(node)
		&& callableName(node.expression) === 'Blob'
		&& node.arguments?.length === 2
		&& ts.isArrayLiteralExpression(node.arguments[0])
		&& node.arguments[0].elements.length === 1
		&& matchesAlias(node.arguments[0].elements[0], template, templateAliases, checker)
		&& exactMime(node.arguments[1], contract.mime));
	if (blobs.length !== 1) return null;
	const blobAliases = aliasesFor(owner, blobs[0], checker);
	const creates = descendants(owner, (node) => ts.isCallExpression(node)
		&& namedProperty(node.expression, 'URL', 'createObjectURL')
		&& node.arguments.length === 1
		&& matchesAlias(node.arguments[0], blobs[0], blobAliases, checker));
	if (creates.length !== 1) return null;
	const urlAliases = aliasesFor(owner, creates[0], checker);
	const workers = descendants(owner, (node) => ts.isNewExpression(node)
		&& callableName(node.expression) === 'Worker' && node.arguments?.length === 1
		&& matchesAlias(node.arguments[0], creates[0], urlAliases, checker));
	if (workers.length !== 1) return null;
	const revokes = descendants(owner, (node) => ts.isCallExpression(node)
		&& namedProperty(node.expression, 'URL', 'revokeObjectURL')
		&& node.arguments.length === 1
		&& matchesAlias(node.arguments[0], creates[0], urlAliases, checker));
	if (contract.revokes ? revokes.length !== 1 : revokes.length !== 0) return null;
	return [blobs[0], creates[0], workers[0], ...revokes];
}

function aliasesFor(root, target, checker) {
	const aliases = new Set();
	let changed = true;
	while (changed) {
		changed = false;
		for (const node of descendants(root, () => true)) {
			let name;
			let value;
			if (ts.isVariableDeclaration(node)) {
				({ name, initializer: value } = node);
			} else if (ts.isBinaryExpression(node)
				&& node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
				name = node.left;
				value = node.right;
			} else continue;
			if (!ts.isIdentifier(name) || value === undefined
				|| !matchesAlias(value, target, aliases, checker)) continue;
			const symbol = checker.getSymbolAtLocation(name);
			if (symbol !== undefined && !aliases.has(symbol)) {
				aliases.add(symbol);
				changed = true;
			}
		}
	}
	return aliases;
}

function matchesAlias(node, target, aliases, checker) {
	while (ts.isParenthesizedExpression(node)) node = node.expression;
	return node === target || ts.isIdentifier(node) && aliases.has(checker.getSymbolAtLocation(node));
}

function mediabunnyMappedSources(map, label) {
	if (map === null || map === undefined) return new Set();
	return new Set(mappedE2ESourceMapEntries(map, `${label} Mediabunny source map`)
		.map(({ source }) => externalSourcePath(source))
		.filter((source) => RECIPE_CONTRACTS.some(({ sourcePath }) => source === sourcePath)));
}

function externalSourcePath(source) {
	return typeof source === 'string' && source.startsWith(EXTERNAL_SOURCE_PREFIX)
		? decodeURIComponent(source.slice(EXTERNAL_SOURCE_PREFIX.length)) : null;
}

function descendants(root, predicate) {
	const found = [];
	const visit = (node) => {
		if (node !== root && predicate(node)) found.push(node);
		ts.forEachChild(node, visit);
	};
	visit(root);
	return found;
}

function exactMime(node, mime) {
	if (!ts.isObjectLiteralExpression(node) || node.properties.length !== 1) return false;
	const property = node.properties[0];
	return ts.isPropertyAssignment(property)
		&& (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
		&& property.name.text === 'type' && ts.isStringLiteralLike(property.initializer)
		&& property.initializer.text === mime;
}

function namedProperty(node, owner, property) {
	return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
		&& node.expression.text === owner && node.name.text === property;
}

function callableName(node) {
	if (ts.isIdentifier(node)) return node.text;
	return ts.isPropertyAccessExpression(node) ? node.name.text : null;
}

function enclosingFunction(node) {
	let current = node.parent;
	while (current !== undefined && !ts.isFunctionLike(current)) current = current.parent;
	return current ?? null;
}

function admittedSource(expected, profile, url) {
	const source = profile?.['script-source-cache']?.[url];
	return typeof source === 'string' && expected.includes(source);
}

function blobUrl(value) {
	if (typeof value !== 'string') return false;
	try { return new URL(value).protocol === 'blob:'; }
	catch { return false; }
}
