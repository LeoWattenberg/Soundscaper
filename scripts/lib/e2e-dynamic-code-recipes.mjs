/* SPDX-License-Identifier: AGPL-3.0-only */

import ts from 'typescript';

export function canonicalRendererRecipeCall(call, artifactPath) {
	if (!ts.isPropertyAccessExpression(call.expression)
		|| call.expression.name.text !== 'executeJavaScript' || call.arguments.length !== 2
		|| !ts.isIdentifier(call.expression.expression) || !ts.isIdentifier(call.arguments[0])
		|| !ts.isBinaryExpression(call.arguments[1])
		|| call.arguments[1].operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
		|| !ts.isIdentifier(call.arguments[1].left) || !trueExpression(call.arguments[1].right)
		|| !ts.isReturnStatement(call.parent)) return false;
	const owner = enclosingFunction(call);
	if (owner === null || owner.body === undefined || owner.parameters.length !== 5) return false;
	const parameters = owner.parameters.map(({ name }) => ts.isIdentifier(name) ? name.text : null);
	if (parameters.some((name) => name === null)
		|| call.expression.expression.text !== parameters[0]
		|| call.arguments[0].text !== parameters[3]
		|| call.arguments[1].left.text !== parameters[4]) return false;
	const statements = owner.body.statements;
	const executeIndex = statements.indexOf(call.parent);
	const transformed = artifactPath.endsWith('/desktop-smoke.js');
	let attestationIndex = -1;
	let attestationName = null;
	for (const [index, statement] of statements.entries()) {
		const candidate = rendererAttestationName(
			statement, statements, parameters[1], parameters[3], executeIndex, transformed,
		);
		if (candidate === null) continue;
		if (attestationName !== null) return false;
		attestationIndex = index;
		attestationName = candidate;
	}
	const guardIndex = statements.findIndex((statement) => rendererRecipeGuard(
		statement, statements, parameters[1], parameters[2], parameters[3], attestationName, transformed,
	));
	return guardIndex < executeIndex && (attestationName === null
		? guardIndex >= 0 : attestationIndex >= 0 && guardIndex > attestationIndex);
}

export function canonicalMacroBlob(blob) {
	return canonicalMacroWorkerForBlob(blob) !== null;
}

export function canonicalMacroWorker(worker) {
	if (!ts.isIdentifier(worker.arguments?.[0])) return false;
	const owner = enclosingFunction(worker);
	if (owner === null || owner.body === undefined) return false;
	const matching = [];
	const visit = (node) => {
		if (ts.isNewExpression(node) && callableName(node.expression) === 'Blob') {
			const candidate = canonicalMacroWorkerForBlob(node);
			if (candidate !== null) matching.push(candidate);
		}
		ts.forEachChild(node, visit);
	};
	visit(owner.body);
	return matching.length === 1 && matching[0] === worker;
}

function canonicalMacroWorkerForBlob(blob) {
	if (blob.arguments?.length !== 2 || !ts.isArrayLiteralExpression(blob.arguments[0])
		|| blob.arguments[0].elements.length !== 1 || !ts.isIdentifier(blob.arguments[0].elements[0])
		|| !exactObject(blob.arguments[1], { type: 'text/javascript' })) return null;
	const create = blob.parent;
	if (!ts.isCallExpression(create) || create.arguments.length !== 1 || create.arguments[0] !== blob
		|| !isNamedProperty(create.expression, 'URL', 'createObjectURL')) return null;
	const declaration = create.parent;
	if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return null;
	const owner = enclosingFunction(blob);
	if (owner === null || owner.body === undefined || owner.parameters.length !== 2
		|| !owner.parameters.every(({ name }) => ts.isIdentifier(name))) return null;
	const [sourceName, workerName] = owner.parameters.map(({ name }) => name.text);
	if (blob.arguments[0].elements[0].text !== sourceName || !createWorkerProperty(owner)) return null;
	const urlName = declaration.name.text;
	const workers = [];
	let revokes = false;
	let terminates = false;
	const visit = (node) => {
		if (ts.isNewExpression(node) && callableName(node.expression) === 'Worker'
			&& ts.isIdentifier(node.arguments?.[0]) && node.arguments[0].text === urlName
			&& exactObject(node.arguments?.[1], { type: 'module', name: workerName })) workers.push(node);
		if (ts.isCallExpression(node) && isNamedProperty(node.expression, 'URL', 'revokeObjectURL')
			&& ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === urlName) revokes = true;
		ts.forEachChild(node, visit);
	};
	visit(owner.body);
	const worker = workers.length === 1 ? workers[0] : null;
	if (worker !== null && ts.isVariableDeclaration(worker.parent)
		&& ts.isIdentifier(worker.parent.name)) {
		const name = worker.parent.name.text;
		const inspect = (node) => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
				&& ts.isIdentifier(node.expression.expression)
				&& node.expression.expression.text === name && node.expression.name.text === 'terminate') {
				terminates = true;
			}
			ts.forEachChild(node, inspect);
		};
		inspect(owner.body);
	}
	return worker !== null && revokes && terminates ? worker : null;
}

export function canonicalPinnedFfmpegImport(call, artifactPath) {
	if (!artifactPath.endsWith('/desktop/helper-probe-engine.js')
		&& !artifactPath.endsWith('desktop/helper-probe-engine.js')) return false;
	const source = call.arguments[0];
	if (!ts.isTemplateExpression(source) || source.head.text !== 'data:text/javascript;base64,'
		|| source.templateSpans.length !== 1 || source.templateSpans[0].literal.text !== '') return false;
	const expression = source.templateSpans[0].expression;
	return ts.isCallExpression(expression) && expression.arguments.length === 1
		&& literalText(expression.arguments[0]) === 'base64'
		&& ts.isPropertyAccessExpression(expression.expression)
		&& expression.expression.name.text === 'toString'
		&& ts.isIdentifier(expression.expression.expression);
}

export function mappedRepositorySources(script) {
	if (!script.fullSourceMap || !Array.isArray(script.fullSourceMap.sources)
		|| !Array.isArray(script.fullSourceMap.sourcesContent)) return [];
	const prefix = 'file:///__soundscaper_repo__/';
	return script.fullSourceMap.sources.flatMap((source, index) => {
		if (typeof source !== 'string' || !source.startsWith(prefix)
			|| typeof script.fullSourceMap.sourcesContent[index] !== 'string') return [];
		const artifactPath = decodeURIComponent(source.slice(prefix.length));
		if (!/\.[cm]?[jt]sx?$/iu.test(artifactPath) || /\.d\.[cm]?ts$/iu.test(artifactPath)) return [];
		return [{
			artifactPath,
			source: script.fullSourceMap.sourcesContent[index],
		}];
	});
}

export function closedMappedSourceCallsite(call, context) {
	const allowed = new Set([
		'src/common/editor/chunk-stream-worklet-node.js',
		'src/common/editor/ebu-r128-node.js',
		'src/common/editor/engine/band-dynamics-node.ts',
		'src/common/editor/engine/effect-worklets.ts',
		'src/common/editor/engine/standard-effect-node.ts',
		'src/common/editor/native-device-io-worklet-node.js',
		'src/common/editor/native-plugin-realtime-node.js',
		'src/common/editor/native-realtime-worklet-node.js',
		'src/common/editor/recording.js',
	]);
	const name = callableName(call.expression);
	if (name === 'register' && context.artifactPath === 'src/common/offline/application-shell.ts'
		&& ts.isIdentifier(call.arguments[0]) && call.arguments[0].text === 'scriptUrl') {
		return 'closed-callsite:offline-service-worker-registration';
	}
	if (name !== 'addModule' || !allowed.has(context.artifactPath)) return null;
	const argument = unwrapStringConversion(call.arguments[0]);
	if (!ts.isIdentifier(argument) || argument.text !== 'url') return null;
	return `closed-callsite:worklet:${context.artifactPath}`;
}

export function closedDynamicImportCallsite(call, context) {
	const argument = call.arguments[0];
	if (context.sourceOnly) {
		const nodeFsSources = new Set([
			'src/common/editor/nyquist/plugin-registry.js',
			'src/common/editor/parametric-eq/wasm-loader.js',
			'src/common/editor/pffft-wasm-loader.js',
		]);
		if (nodeFsSources.has(context.artifactPath) && ts.isIdentifier(argument)
			&& argument.text === 'nodeFsSpecifier') {
			return `closed-callsite:node-fs-import:${context.artifactPath}`;
		}
		return null;
	}
	const path = context.artifactPath;
	if (path.endsWith('/desktop/assistance-inference-worker.js')
		&& ts.isPropertyAccessExpression(argument) && ts.isIdentifier(argument.expression)
		&& argument.expression.text === 'verified' && argument.name.text === 'moduleSpecifier') {
		return 'closed-callsite:assistance-inference-runtime-import';
	}
	if (path.endsWith('/desktop/assistance-speech-runtime.js')
		&& (ts.isIdentifier(argument) && argument.text === 'id'
			|| rewriteRelativeImport(argument, 'id'))) {
		return 'closed-callsite:assistance-speech-runtime-import';
	}
	if (path.endsWith('/desktop/bundled-audio-codec-helper-process.js')
		&& (pathToFileHref(argument, 'path')
			|| rewriteRelativeImport(argument, null, (value) => pathToFileHref(value, 'path')))) {
		return 'closed-callsite:bundled-codec-runtime-import';
	}
	if (path.endsWith('/desktop/assistance-onnx-runtime-worker.js')
		&& pathToFileHref(argument, 'entrypoint')) {
		return 'closed-callsite:onnx-runtime-import';
	}
	return null;
}

export function closedWorkerCallsite(worker, context) {
	if (!context.artifactPath.endsWith('/desktop/assistance-runtime-family-thread-worker.ts')
		&& !context.artifactPath.endsWith('/desktop/assistance-runtime-family-thread-worker.js')) return null;
	if (!ts.isIdentifier(worker.arguments?.[0]) || worker.arguments[0].text !== 'entry'
		|| !ts.isObjectLiteralExpression(worker.arguments?.[1])
		|| worker.arguments[1].properties.length !== 1) return null;
	const property = worker.arguments[1].properties[0];
	return ts.isPropertyAssignment(property) && propertyName(property.name) === 'workerData'
		&& ts.isIdentifier(property.initializer) && property.initializer.text === 'job'
		? 'closed-callsite:assistance-runtime-family-thread' : null;
}

export function callableName(node) {
	if (ts.isIdentifier(node)) return node.text;
	if (ts.isPropertyAccessExpression(node)) return node.name.text;
	if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
		return node.argumentExpression.text;
	}
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
		|| ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
		return callableName(node.expression);
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
		return callableName(node.right);
	}
	return null;
}

export function propertyName(node) {
	return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) ? node.text : null;
}

export function literalText(node) {
	return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		? node.text : null;
}

export function unwrapStringConversion(node) {
	return ts.isCallExpression(node) && callableName(node.expression) === 'String' && node.arguments.length === 1
		? node.arguments[0] : node;
}

export function trueExpression(node) {
	return node.kind === ts.SyntaxKind.TrueKeyword || ts.isPrefixUnaryExpression(node)
		&& node.operator === ts.SyntaxKind.ExclamationToken
		&& ts.isNumericLiteral(node.operand) && node.operand.text === '0';
}

function rendererAttestationName(statement, statements, productName, sourceName, executeIndex, transformed) {
	const statementIndex = statements.indexOf(statement);
	if (statementIndex < 0 || statementIndex >= executeIndex || !ts.isVariableStatement(statement)
		|| statement.declarationList.declarations.length !== 1) return null;
	const declaration = statement.declarationList.declarations[0];
	if (!ts.isIdentifier(declaration.name) || !rendererAttestationCall(
		declaration.initializer, statements, productName, sourceName, statementIndex, transformed,
	)) return null;
	return declaration.name.text;
}

function rendererAttestationCall(node, statements, productName, sourceName, beforeIndex, transformed) {
	if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)
		|| !transformed && node.expression.text !== 'validateDesktopRendererDynamicSource'
		|| node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0])) return false;
	const object = node.arguments[0];
	if (object.properties.length !== 3) return false;
	const properties = new Map(object.properties.map((property) => propertyNode(property))
		.filter((entry) => entry !== null));
	return identifierNamed(properties.get('productId'), productName)
		&& identifierNamed(properties.get('source'), sourceName)
		&& rendererSourcePath(properties.get('path'), statements, sourceName, beforeIndex, transformed);
}

function rendererSourcePath(node, statements, sourceName, beforeIndex, transformed) {
	if (sourceUrlPathCall(node, sourceName, transformed)) return true;
	if (!ts.isIdentifier(node)) return false;
	return statements.slice(0, beforeIndex).some((statement) => {
		if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return false;
		const declaration = statement.declarationList.declarations[0];
		return ts.isIdentifier(declaration.name) && declaration.name.text === node.text
			&& sourceUrlPathCall(declaration.initializer, sourceName, transformed);
	});
}

function sourceUrlPathCall(node, sourceName, transformed) {
	return ts.isCallExpression(node) && ts.isIdentifier(node.expression)
		&& (transformed || node.expression.text === 'sourceUrlPath') && node.arguments.length === 1
		&& identifierNamed(node.arguments[0], sourceName);
}

function rendererRecipeGuard(
	statement, statements, productName, recipeName, sourceName, attestationName, transformed,
) {
	if (!ts.isIfStatement(statement)
		|| !ts.isBinaryExpression(statement.expression)
		|| statement.expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
		|| !ts.isPropertyAccessExpression(statement.expression.left)
		|| statement.expression.left.name.text !== 'recipeId'
		|| !identifierNamed(statement.expression.right, recipeName)) return false;
	const beforeIndex = statements.indexOf(statement);
	const attested = attestationName === null
		? rendererAttestationCall(
			statement.expression.left.expression,
			statements,
			productName,
			sourceName,
			beforeIndex,
			transformed,
		) : identifierNamed(statement.expression.left.expression, attestationName);
	if (!attested) return false;
	const body = ts.isBlock(statement.thenStatement)
		&& statement.thenStatement.statements.length === 1
		? statement.thenStatement.statements[0] : statement.thenStatement;
	return ts.isThrowStatement(body) && ts.isNewExpression(body.expression)
		&& ts.isIdentifier(body.expression.expression) && body.expression.expression.text === 'Error'
		&& body.expression.arguments?.length === 1
		&& literalText(body.expression.arguments[0]) === 'Renderer smoke recipe attestation disagrees.';
}

function propertyNode(property) {
	if (ts.isShorthandPropertyAssignment(property)) return [property.name.text, property.name];
	if (!ts.isPropertyAssignment(property)) return null;
	const name = propertyName(property.name);
	return name === null ? null : [name, property.initializer];
}

function identifierNamed(node, name) {
	return ts.isIdentifier(node) && node.text === name;
}

function exactObject(node, expected) {
	if (!node || !ts.isObjectLiteralExpression(node)
		|| node.properties.length !== Object.keys(expected).length) return false;
	const actual = new Map(node.properties.map((property) => propertyValue(property))
		.filter((entry) => entry !== null));
	return Object.entries(expected).every(([name, value]) => actual.get(name) === value);
}

function propertyValue(property) {
	if (ts.isShorthandPropertyAssignment(property)) return [property.name.text, property.name.text];
	if (!ts.isPropertyAssignment(property)) return null;
	const name = propertyName(property.name);
	const value = ts.isIdentifier(property.initializer)
		? property.initializer.text : literalText(property.initializer);
	return name === null || value === null ? null : [name, value];
}

function enclosingFunction(node) {
	let current = node.parent;
	while (current !== undefined && !ts.isFunctionLike(current)) current = current.parent;
	return current ?? null;
}

function createWorkerProperty(owner) {
	let current = owner.parent;
	while (current !== undefined && (ts.isParenthesizedExpression(current)
		|| ts.isAsExpression(current))) current = current.parent;
	return current !== undefined && ts.isPropertyAssignment(current)
		&& propertyName(current.name) === 'createWorker';
}

function rewriteRelativeImport(node, identifier = null, predicate = null) {
	if (!ts.isCallExpression(node) || callableName(node.expression) !== '__rewriteRelativeImportExtension'
		|| node.arguments.length !== 1) return false;
	if (predicate !== null) return predicate(node.arguments[0]);
	return ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === identifier;
}

function pathToFileHref(node, identifier) {
	return ts.isPropertyAccessExpression(node) && node.name.text === 'href'
		&& ts.isCallExpression(node.expression)
		&& callableName(node.expression.expression) === 'pathToFileURL'
		&& node.expression.arguments.length === 1
		&& ts.isIdentifier(node.expression.arguments[0])
		&& node.expression.arguments[0].text === identifier;
}

function isNamedProperty(node, receiver, property) {
	return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
		&& node.expression.text === receiver && node.name.text === property;
}
