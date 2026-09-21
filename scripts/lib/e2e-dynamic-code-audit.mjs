/* SPDX-License-Identifier: AGPL-3.0-only */

import ts from 'typescript';
import { parse } from 'parse5';

import {
	callableName,
	canonicalMacroBlob,
	canonicalMacroWorker,
	canonicalPinnedFfmpegImport,
	canonicalRendererRecipeCall,
	closedDynamicImportCallsite,
	closedMappedSourceCallsite,
	closedWorkerCallsite,
	literalText,
	mappedRepositorySources,
	propertyName,
	trueExpression,
	unwrapStringConversion,
} from './e2e-dynamic-code-recipes.mjs';

const EXECUTE_JAVASCRIPT = new Set([
	'executeJavaScript',
	'executeJavaScriptInIsolatedWorld',
]);
const VM_CALLS = new Set([
	'compileFunction',
	'runInContext',
	'runInNewContext',
	'runInThisContext',
]);
const VM_CONSTRUCTORS = new Set(['Script', 'SourceTextModule', 'SyntheticModule']);
const EXECUTABLE_MIME = /^(?:application|text)\/(?:ecmascript|javascript)(?:\s*;|$)/iu;
const DANGEROUS_SCHEME = /^(?:blob|data|javascript|soundscaper-macro):/iu;
const SAFE_MODULE_SCHEME = /^(?:file|node):/u;

/**
 * Refuse shipped executable-source producers unless they are one of the two
 * closed recipes: the renderer-smoke bridge or the digest-attested macro Blob.
 */
export function assertE2EExecutableStringPolicy(
	scripts,
	{
		allowRendererRecipe = false,
		htmlResources = [],
		label = 'E2E build',
	} = {},
) {
	const primitives = [];
	const mappedSources = new Map();
	for (const [index, script] of scripts.entries()) {
		if (script?.owned === false) continue;
		const sources = mappedRepositorySources(script);
		if (script.fullSourceMap !== null && script.fullSourceMap !== undefined && sources.length > 0) {
			primitives.push(...executablePrimitives(script, index, label, false, true));
			for (const source of sources) mappedSources.set(`${source.artifactPath}\0${source.source}`, source);
		} else {
			primitives.push(...executablePrimitives(script, index, label));
		}
	}
	for (const [index, source] of [...mappedSources.values()].entries()) {
		primitives.push(...executablePrimitives(source, index, label, true));
	}
	for (const [index, resource] of htmlResources.entries()) {
		primitives.push(...htmlPrimitives(resource, index, label));
	}
	const rendererRecipes = primitives.filter(({ admission }) => admission === 'renderer-recipe');
	const macroProducers = primitives.filter(({ admission }) => admission === 'macro-worker');
	const ffmpegImports = primitives.filter(({ admission }) => admission === 'pinned-ffmpeg-import');
	const rejected = primitives.filter(({ admission }) => admission === null);
	const duplicateCallsites = [...new Set(primitives
		.map(({ admission }) => admission)
		.filter((admission) => admission?.startsWith('closed-callsite:')))]
		.filter((admission) => primitives.filter((entry) => entry.admission === admission).length !== 1);
	const invalidRendererCount = allowRendererRecipe
		? rendererRecipes.length !== 1 : rendererRecipes.length !== 0;
	if (!invalidRendererCount && macroProducers.length <= 1 && ffmpegImports.length <= 1
		&& rejected.length === 0 && duplicateCallsites.length === 0) return;
	const reported = rejected.length > 0 ? rejected : primitives;
	const detail = reported.length === 0 ? 'none observed' : reported
		.map(({ artifactPath, kind }) => `${kind} in ${artifactPath}`).join(', ');
	throw new Error(`The ${label} evidence contains an unattested executable-string primitive: ${detail}.`);
}

/** Audit exact inventoried HTML bytes, including packaged Electron resources. */
export function assertE2EHtmlExecutablePolicy(htmlResources, { label = 'E2E build' } = {}) {
	const rejected = htmlResources.flatMap((resource, index) => htmlPrimitives(resource, index, label));
	if (rejected.length === 0) return;
	const detail = rejected.map(({ artifactPath, kind }) => `${kind} in ${artifactPath}`).join(', ');
	throw new Error(`The ${label} evidence contains an unattested executable-string primitive: ${detail}.`);
}

function executablePrimitives(script, index, label, sourceOnly = false, mappedEmitted = false) {
	if (typeof script?.source !== 'string') {
		throw new TypeError(`${label} dynamic-code audit requires inventoried script bytes.`);
	}
	const artifactPath = typeof script.artifactPath === 'string'
		? script.artifactPath : `<inline-script-${String(index + 1)}>`;
	const file = ts.createSourceFile(
		artifactPath,
		script.source,
		ts.ScriptTarget.Latest,
		true,
		scriptKind(artifactPath),
	);
	if (file.parseDiagnostics.length > 0) {
		throw new Error(`The ${label} executable ${artifactPath} is not parseable JavaScript.`);
	}
	const found = [];
	const add = (kind, node, admission = null) => {
		found.push({ admission, artifactPath, kind, node });
	};
	const context = {
		artifactPath,
		file,
		hasMappedSources: !sourceOnly && (script.repositorySources?.length ?? 0) > 0,
		mappedEmitted,
		sourceOnly,
	};
	const visit = (node) => {
		if (ts.isCallExpression(node)) inspectCall(node, context, add);
		else if (ts.isNewExpression(node)) inspectConstruction(node, context, add);
		else if (sourceOnly && ts.isPropertyAssignment(node)) inspectMappedHtmlProperty(node, context, add);
		else if (sourceOnly && ts.isBinaryExpression(node)) inspectAssignment(node, add);
		else if (sourceOnly) {
			// Emitted bytes own all other executable-source primitives; mapped source
			// is consulted only to close identifiers that bundling has renamed.
		} else if (!mappedEmitted && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) {
			inspectStaticModuleSource(node, add);
		} else if (!mappedEmitted && ts.isBinaryExpression(node)) inspectAssignment(node, add);
		else if (!mappedEmitted && ts.isPropertyAssignment(node)) inspectHtmlProperty(node, context, add);
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

function inspectCall(node, context, add) {
	if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
		const specifier = node.arguments[0];
		if (!context.sourceOnly && canonicalPinnedFfmpegImport(node, context.artifactPath)) {
			add('pinned FFmpeg data import', node, 'pinned-ffmpeg-import');
		} else if (!safeModuleExpression(specifier)) {
			const admission = closedDynamicImportCallsite(node, context);
			if (admission !== null) add('closed dynamic import', node, admission);
			else if (context.sourceOnly || !context.hasMappedSources
				|| context.mappedEmitted && literalText(specifier) !== null) add('dynamic import', node);
		}
		return;
	}
	if (context.sourceOnly) {
		inspectMappedCall(node, context, add);
		inspectStableDomCall(node, add);
		return;
	}
	const name = callableName(node.expression);
	if (EXECUTE_JAVASCRIPT.has(name)) {
		add(name, node, name === 'executeJavaScript'
			&& canonicalRendererRecipeCall(node, context.artifactPath)
			? 'renderer-recipe' : null);
	} else if (name === 'eval' || name === 'Function') add(name, node);
	else if (VM_CALLS.has(name)) add(`vm.${name}`, node);
	else if (['setInterval', 'setTimeout'].includes(name) && stringExpression(node.arguments[0])) {
		add(`${name}(string)`, node);
	} else if (context.mappedEmitted) {
		return;
	} else if (name === 'addModule' && audioWorkletAddModule(node)
		|| name === 'register' && serviceWorkerRegister(node)) {
		if (dangerousOrUnresolvedSource(node.arguments[0], true) && !context.hasMappedSources) {
			add(`${name}(executable source)`, node);
		}
	} else inspectStableDomCall(node, add);
}

function inspectConstruction(node, context, add) {
	const name = callableName(node.expression);
	if (context.sourceOnly) {
		if (name === 'Blob' && executableBlob(node)) {
			add('executable Blob', node, canonicalMacroBlob(node) ? 'macro-worker' : null);
		} else if (name === 'Worker' || name === 'SharedWorker') {
			if (workerEvaluatesSource(node.arguments?.[1])) add(`${name} eval`, node);
			else if (!canonicalMacroWorker(node) && !safeAssetUrl(node.arguments?.[0])) {
				const admission = closedWorkerCallsite(node, context);
				add(`${name}(executable source)`, node, admission);
			}
		}
		return;
	}
	if (name === 'Function') add('new Function', node);
	else if (VM_CONSTRUCTORS.has(name)) add(`vm.${name}`, node);
	else if (context.mappedEmitted) return;
	else if (name === 'Blob' && executableBlob(node)) {
		add('executable Blob', node, canonicalMacroBlob(node) ? 'macro-worker' : null);
	} else if (name === 'Worker' || name === 'SharedWorker') {
		if (workerEvaluatesSource(node.arguments?.[1])) add(`${name} eval`, node);
		else if (!canonicalMacroWorker(node) && !context.hasMappedSources
			&& dangerousOrUnresolvedWorkerSource(node.arguments?.[0])) {
			add(`${name}(executable source)`, node, closedWorkerCallsite(node, context));
		}
	}
}

function inspectStableDomCall(node, add) {
	const name = callableName(node.expression);
	if (name === 'createElement' && literalText(node.arguments[0])?.toLowerCase() === 'script') {
		add('DOM script element', node);
	} else if (name === 'insertAdjacentHTML' || documentWriter(node.expression)) {
		add(`DOM ${name}`, node);
	} else if (name === 'setAttribute') {
		const attribute = literalText(node.arguments[0])?.toLowerCase();
		if (attribute?.startsWith('on') || attribute === 'srcdoc'
			|| attribute === 'src' && dangerousOrUnresolvedSource(node.arguments[1], true)) {
			add(`DOM ${name}(${attribute})`, node);
		}
	}
}

function inspectStaticModuleSource(node, add) {
	const specifier = node.moduleSpecifier;
	if (specifier !== undefined && !safeModuleExpression(specifier)) add('static module source', node);
}

function inspectAssignment(node, add) {
	if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isPropertyAccessExpression(node.left)) return;
	if (['innerHTML', 'outerHTML', 'srcdoc'].includes(node.left.name.text)) {
		add(`DOM ${node.left.name.text}`, node);
	}
}

function inspectHtmlProperty(node, context, add) {
	const name = propertyName(node.name);
	if (name === 'srcDoc') add('React srcDoc', node);
	if (name !== 'dangerouslySetInnerHTML') return;
	if (!context.hasMappedSources) add('React dangerouslySetInnerHTML', node);
}

function inspectMappedHtmlProperty(node, context, add) {
	const name = propertyName(node.name);
	if (!['dangerouslySetInnerHTML', 'srcDoc'].includes(name)) return;
	const initializer = node.initializer;
	const property = ts.isObjectLiteralExpression(initializer) && initializer.properties.length === 1
		&& ts.isPropertyAssignment(initializer.properties[0]) ? initializer.properties[0] : null;
	const canonical = name === 'dangerouslySetInnerHTML'
		&& context.artifactPath === 'src/common/editor/ui/dialogs/PrivacyPolicyDialog.tsx'
		&& property !== null && propertyName(property.name) === '__html'
		&& ts.isPropertyAccessExpression(property.initializer)
		&& ts.isIdentifier(property.initializer.expression)
		&& property.initializer.expression.text === 'section'
		&& property.initializer.name.text === 'body';
	add(`React ${name}`, node, canonical
		? 'closed-callsite:privacy-policy-static-markup' : null);
}

function inspectMappedCall(node, context, add) {
	const name = callableName(node.expression);
	if (name === 'addModule' ? !audioWorkletAddModule(node)
		: name === 'register' ? !serviceWorkerRegister(node) : true) return;
	if (!dangerousOrUnresolvedSource(node.arguments[0], true)) return;
	add(`${name}(executable source)`, node, closedMappedSourceCallsite(node, context));
}

function htmlPrimitives(resource, index, label) {
	if (typeof resource?.source !== 'string') {
		throw new TypeError(`${label} HTML audit requires inventoried document bytes.`);
	}
	const artifactPath = typeof resource.artifactPath === 'string'
		? resource.artifactPath : `<inline-html-${String(index + 1)}>`;
	const found = [];
	const add = (kind) => found.push({ admission: null, artifactPath, kind, node: null });
	const document = parse(resource.source, { sourceCodeLocationInfo: true });
	visitHtmlNodes(document, add);
	return found;
}

function visitHtmlNodes(node, add) {
	if (typeof node?.tagName === 'string') inspectHtmlElement(node, add);
	for (const child of node?.childNodes ?? []) visitHtmlNodes(child, add);
	if (node?.content) visitHtmlNodes(node.content, add);
}

function inspectHtmlElement(node, add) {
	const attributes = node.attrs ?? [];
	if (attributes.some(({ name, value }) => (
		name === 'srcdoc'
		|| /^on[a-z\d_-]+$/u.test(name)
		|| ['href', 'src'].includes(name) && /^\s*javascript:/iu.test(value)
	))) add('inline HTML executable attribute');
	if (node.tagName !== 'script') return;
	if (!node.sourceCodeLocation?.endTag) {
		add('malformed HTML script');
		return;
	}
	const src = attributes.find(({ name }) => name === 'src')?.value ?? null;
	const body = (node.childNodes ?? [])
		.filter((child) => child.nodeName === '#text')
		.map((child) => child.value ?? '')
		.join('');
	if (src === null || body.trim() !== '' || !safeHtmlScriptSource(src)) {
		add('inline HTML script');
	}
}

function executableBlob(node) {
	if (node.arguments === undefined || node.arguments.length < 2
		|| !ts.isObjectLiteralExpression(node.arguments[1])) return false;
	const type = node.arguments[1].properties.find((property) => (
		ts.isPropertyAssignment(property) && propertyName(property.name) === 'type'
	));
	return type !== undefined && EXECUTABLE_MIME.test(literalText(type.initializer) ?? '');
}

function dangerousOrUnresolvedWorkerSource(source) {
	if (source === undefined) return true;
	if (safeAssetUrl(source)) return false;
	const value = literalText(source);
	if (value !== null) return !safeLocalSpecifier(value);
	return true;
}

function dangerousOrUnresolvedSource(source, unresolvedIsDangerous) {
	if (source === undefined) return true;
	if (safeAssetUrl(source)) return false;
	const value = literalText(unwrapStringConversion(source));
	return value === null ? unresolvedIsDangerous : !safeLocalSpecifier(value);
}

function safeAssetUrl(node) {
	if (node === undefined) return false;
	if (node !== undefined && ts.isPropertyAccessExpression(node) && node.name.text === 'href') {
		return safeAssetUrl(node.expression);
	}
	return ts.isNewExpression(node) && callableName(node.expression) === 'URL'
		&& node.arguments?.length === 2
		&& safeLocalSpecifier(literalText(node.arguments[0]) ?? '')
		&& importMetaUrl(node.arguments[1]);
}

function safeModuleExpression(node) {
	const value = literalText(node);
	if (value === null) return false;
	return safeLocalSpecifier(value) || SAFE_MODULE_SCHEME.test(value) || barePackageSpecifier(value);
}

function safeLocalSpecifier(value) {
	return value !== '' && !DANGEROUS_SCHEME.test(value)
		&& !/^(?:https?|wss?):/iu.test(value)
		&& !/^[a-z][a-z\d+.-]*:/iu.test(value);
}

function safeHtmlScriptSource(value) {
	return safeLocalSpecifier(value.trim()) && !value.trim().startsWith('//');
}

function barePackageSpecifier(value) {
	return /^(?:@[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._/-]*|[a-z\d][a-z\d._/-]*)$/iu.test(value);
}

function stringExpression(node) {
	return literalText(node) !== null;
}

function workerEvaluatesSource(node) {
	if (!node || !ts.isObjectLiteralExpression(node)) return false;
	return node.properties.some((property) => ts.isPropertyAssignment(property)
		&& propertyName(property.name) === 'eval' && trueExpression(property.initializer));
}

function documentWriter(node) {
	return ts.isPropertyAccessExpression(node) && ['write', 'writeln'].includes(node.name.text)
		&& ts.isIdentifier(node.expression) && node.expression.text === 'document';
}

function importMetaUrl(node) {
	return ts.isPropertyAccessExpression(node) && node.name.text === 'url'
		&& ts.isMetaProperty(node.expression)
		&& node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
}

function audioWorkletAddModule(node) {
	if (!ts.isPropertyAccessExpression(node.expression)) return false;
	const receiver = node.expression.expression;
	return ts.isIdentifier(receiver) && receiver.text === 'audioWorklet'
		|| ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'audioWorklet';
}

function serviceWorkerRegister(node) {
	if (!ts.isPropertyAccessExpression(node.expression)) return false;
	const receiver = node.expression.expression;
	return ts.isIdentifier(receiver) && receiver.text === 'serviceWorker'
		|| ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'serviceWorker';
}

function scriptKind(artifactPath) {
	if (/\.tsx$/iu.test(artifactPath)) return ts.ScriptKind.TSX;
	if (/\.ts$/iu.test(artifactPath)) return ts.ScriptKind.TS;
	if (/\.jsx$/iu.test(artifactPath)) return ts.ScriptKind.JSX;
	return ts.ScriptKind.JS;
}
