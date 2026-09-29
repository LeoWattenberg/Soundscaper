import path from 'node:path';
import ts from 'typescript';

const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const SOURCE_EXTENSIONS = new Set([...SCRIPT_EXTENSIONS, '.c', '.cc', '.cpp', '.h', '.hpp', '.rs']);
const { posix } = path;

export function isSourcePath(file) {
	return SOURCE_EXTENSIONS.has(posix.extname(file));
}

function isScriptPath(file) {
	return SCRIPT_EXTENSIONS.has(posix.extname(file));
}

function sourceFile(pathname, content) {
	const kind = /\.(?:tsx|jsx)$/u.test(pathname) ? ts.ScriptKind.TSX
		: /\.(?:js|mjs|cjs)$/u.test(pathname) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
	return ts.createSourceFile(pathname, content, ts.ScriptTarget.Latest, true, kind);
}

function directoryParts(file) {
	return posix.dirname(file).split('/').filter(Boolean);
}

/** The smallest useful bucket for cross-directory dependency edges. */
export function ownerOf(file) {
	const parts = directoryParts(file);
	if (parts[0] === 'native') return parts.slice(0, 2).join('/');
	if (parts[0] === 'desktop') return parts.length > 1 ? parts.slice(0, 2).join('/') : 'desktop';
	if (parts[0] === 'src' && parts[1] === 'common' && parts[2] === 'editor') {
		if (parts.length <= 3) return 'src/common/editor/root';
		if ((parts[3] === 'controller' || parts[3] === 'ui') && parts.length > 4) {
			return parts.slice(0, 5).join('/');
		}
		return parts.slice(0, 4).join('/');
	}
	if (parts[0] === 'src') return parts.length > 2 ? parts.slice(0, 3).join('/') : `${parts.join('/')}/root`;
	return parts.join('/') || '(root)';
}

function resolveModule(file, specifier, knownPaths) {
	if (!specifier.startsWith('.')) return null;
	const base = posix.normalize(posix.join(posix.dirname(file), specifier));
	const extension = posix.extname(base);
	const candidates = [base];
	if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
		for (const replacement of ['.ts', '.tsx', '.mts', '.cts']) {
			candidates.push(base.slice(0, -extension.length) + replacement);
		}
	}
	if (!extension) {
		for (const suffix of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js']) {
			candidates.push(base + suffix);
		}
	}
	return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function importIsTypeOnly(node) {
	if (ts.isExportDeclaration(node)) return Boolean(node.isTypeOnly);
	const clause = node.importClause;
	if (!clause) return false;
	if (clause.isTypeOnly) return true;
	if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
	return clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function readImports(ast, file, knownPaths) {
	const imports = [];
	for (const statement of ast.statements) {
		if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
			&& statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
			const target = resolveModule(file, statement.moduleSpecifier.text, knownPaths);
			if (target) imports.push({ target, typeOnly: importIsTypeOnly(statement), declaration: statement });
		}
	}
	function visit(node) {
		if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
			&& (node.expression.kind === ts.SyntaxKind.ImportKeyword
				|| (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
			const target = resolveModule(file, node.arguments[0].text, knownPaths);
			if (target) imports.push({ target, typeOnly: false, declaration: node });
		}
		ts.forEachChild(node, visit);
	}
	visit(ast);
	return imports;
}

function ownershipGraph(sources) {
	const counts = new Map();
	for (const { path: file } of sources) {
		const parts = directoryParts(file);
		for (let length = 1; length <= parts.length; length += 1) {
			const directory = parts.slice(0, length).join('/');
			const entry = counts.get(directory) ?? { direct: 0, total: 0 };
			entry.total += 1;
			if (length === parts.length) entry.direct += 1;
			counts.set(directory, entry);
		}
	}
	const nodes = [...counts].map(([id, count]) => ({
		id,
		total: count.total,
		direct: count.direct,
		label: `${id}\n${count.total} source file${count.total === 1 ? '' : 's'}`
			+ (count.direct ? ` (${count.direct} here)` : ''),
	}));
	const edges = [...counts.keys()].flatMap((id) => {
		const parent = posix.dirname(id);
		return parent !== '.' && counts.has(parent) ? [{ from: parent, to: id }] : [];
	});
	return { title: 'Source ownership by directory', direction: 'TB', nodes, edges };
}

function ownershipOverviewGraph(graph) {
	const all = new Map(graph.nodes.map((node) => [node.id, node]));
	const roots = graph.nodes.filter(({ id }) => !id.includes('/'));
	const srcChildren = graph.nodes.filter(({ id }) => posix.dirname(id) === 'src');
	const desired = new Set([
		...roots.map(({ id }) => id),
		...srcChildren.map(({ id }) => id),
		'src/common/editor',
		'src/common/editor/controller',
		'src/common/editor/engine',
		'src/common/editor/ui',
	]);
	const nodes = graph.nodes.filter(({ id }) => desired.has(id)).map(({ id, total }) => ({
		id,
		label: `${id}\n${total} source file${total === 1 ? '' : 's'}`,
	}));
	const shown = new Set(nodes.map(({ id }) => id));
	const edges = graph.edges.filter(({ from, to }) => shown.has(from) && shown.has(to));
	const total = roots.reduce((sum, node) => sum + node.total, 0);
	if (roots.length) {
		nodes.push({ id: '@repository', label: `Repository source\n${total} source files` });
		edges.push(...roots.map(({ id }) => ({ from: '@repository', to: id })));
	}
	for (const parent of ['src', 'src/common', 'src/common/editor']) {
		const parentNode = all.get(parent);
		if (!parentNode) continue;
		const shownChildren = edges.filter(({ from }) => from === parent)
			.map(({ to }) => all.get(to)).filter(Boolean);
		const remaining = parentNode.total - shownChildren.reduce((sum, node) => sum + node.total, 0);
		if (remaining > 0) {
			const id = `@other:${parent}`;
			nodes.push({ id, label: `Other in ${parent}\n${remaining} source file${remaining === 1 ? '' : 's'}` });
			edges.push({ from: parent, to: id });
		}
	}
	return { title: 'Source ownership overview', direction: 'TB', nodes, edges };
}

function architectureArea(file) {
	const parts = file.split('/');
	if (parts[0] === 'src' && parts[1] === 'common' && parts[2] === 'editor') {
		return ['engine', 'controller', 'ui'].includes(parts[3])
			? `src/common/editor/${parts[3]}` : 'src/common/editor/other';
	}
	if (parts[0] === 'src' && parts[1] === 'common') return 'src/common/other';
	if (parts[0] === 'src') return parts.length > 2 ? parts.slice(0, 2).join('/') : 'src/root';
	return parts[0];
}

function importGraph(parsed, knownPaths, groupFor, title, compact = false) {
	const owners = new Set();
	const edges = new Map();
	for (const { file, ast } of parsed) {
		const from = groupFor(file);
		owners.add(from);
		for (const imported of readImports(ast, file, knownPaths)) {
			const to = groupFor(imported.target);
			owners.add(to);
			if (from === to) continue;
			const key = `${from}\0${to}\0${compact ? 'all' : imported.typeOnly}`;
			const edge = edges.get(key) ?? { from, to, typeOnly: compact ? false : imported.typeOnly, count: 0 };
			edge.count += 1;
			edges.set(key, edge);
		}
	}
	const selected = compact
		? [...owners].flatMap((owner) => [...edges.values()].filter((edge) => edge.from === owner)
			.sort((a, b) => b.count - a.count || a.to.localeCompare(b.to, 'en')).slice(0, 3))
		: [...edges.values()];
	const shownOwners = compact ? new Set(selected.flatMap(({ from, to }) => [from, to])) : owners;
	return {
		title,
		direction: 'LR',
		nodes: [...shownOwners].map((id) => ({ id, label: id })),
		edges: selected.map(({ count, ...edge }) => ({ ...edge, label: `${count} import${count === 1 ? '' : 's'}` })),
	};
}

function declaredTypes(parsed) {
	const declarations = new Map();
	for (const { file, ast } of parsed) {
		function visit(node) {
			if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
				const name = node.name.text;
				declarations.set(`${file}#${name}`, { id: `${file}#${name}`, label: `${name}\n${file}`, group: ownerOf(file) });
			}
			ts.forEachChild(node, visit);
		}
		visit(ast);
	}
	return declarations;
}

function importedTypeNames(ast, file, knownPaths) {
	const names = new Map();
	for (const statement of ast.statements) {
		if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const target = resolveModule(file, statement.moduleSpecifier.text, knownPaths);
		if (!target) continue;
		const bindings = statement.importClause.namedBindings;
		if (bindings && ts.isNamedImports(bindings)) {
			for (const binding of bindings.elements) names.set(binding.name.text, `${target}#${binding.propertyName?.text ?? binding.name.text}`);
		}
	}
	return names;
}

function inheritanceGraph(parsed, knownPaths) {
	const declarations = declaredTypes(parsed);
	const nodes = new Map(declarations);
	const edges = [];
	for (const { file, ast } of parsed) {
		const imported = importedTypeNames(ast, file, knownPaths);
		function visit(node) {
			if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
				const from = `${file}#${node.name.text}`;
				for (const clause of node.heritageClauses ?? []) {
					const relation = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends';
					for (const type of clause.types) {
						const name = type.expression.getText(ast);
						const target = imported.get(name) ?? `${file}#${name}`;
						const to = declarations.has(target) ? target : `external#${name}`;
						if (!nodes.has(to)) nodes.set(to, { id: to, label: name, group: 'External or unresolved' });
						edges.push({ from, to, label: relation, typeOnly: relation === 'implements' });
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(ast);
	}
	const connected = new Set(edges.flatMap(({ from, to }) => [from, to]));
	return {
		title: 'Declared class and interface inheritance',
		direction: 'LR',
		nodes: [...nodes.values()].filter((node) => connected.has(node.id)),
		edges,
	};
}

function inheritanceOverviewGraph(graph) {
	const adjacency = new Map();
	for (const { from, to } of graph.edges) {
		for (const [node, neighbor] of [[from, to], [to, from]]) {
			const neighbors = adjacency.get(node) ?? new Set();
			neighbors.add(neighbor);
			adjacency.set(node, neighbors);
		}
	}
	const visited = new Set();
	const components = [];
	for (const start of adjacency.keys()) {
		if (visited.has(start)) continue;
		const pending = [start];
		const members = new Set();
		visited.add(start);
		while (pending.length) {
			const current = pending.pop();
			members.add(current);
			for (const neighbor of adjacency.get(current) ?? []) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					pending.push(neighbor);
				}
			}
		}
		components.push(members);
	}
	const candidates = components.filter((component) => component.size <= 18);
	const chosen = (candidates.length ? candidates : components)
		.sort((a, b) => b.size - a.size || [...a][0].localeCompare([...b][0], 'en'))[0] ?? new Set();
	return {
		title: 'Largest connected inheritance family with at most 18 types',
		direction: 'LR',
		nodes: graph.nodes.filter(({ id }) => chosen.has(id)),
		edges: graph.edges.filter(({ from, to }) => chosen.has(from) && chosen.has(to)),
	};
}

function enclosingScope(node, ast) {
	let current = node.parent;
	while (current && current !== ast) {
		if (ts.isMethodDeclaration(current) && current.name) {
			const parent = current.parent;
			const className = ts.isClassDeclaration(parent) && parent.name ? `${parent.name.text}.` : '';
			return `${className}${current.name.getText(ast)}`;
		}
		if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
		if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current))
			&& ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
			return current.parent.name.text;
		}
		current = current.parent;
	}
	return '(module)';
}

function expressionName(node, ast) {
	return node.getText(ast).replace(/\s+/gu, ' ').slice(0, 72);
}

function audioConnectImports(ast) {
	const names = new Set();
	for (const statement of ast.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
			|| !/audio-node-utils\.(?:ts|js)$/u.test(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const binding of bindings.elements) {
			if ((binding.propertyName?.text ?? binding.name.text) === 'connect') names.add(binding.name.text);
		}
	}
	return names;
}

function audioGraph(parsed) {
	const nodes = new Map();
	const edges = [];
	for (const { file, ast } of parsed) {
		if (!file.startsWith('src/common/editor/') || file.includes('/ui/')
			|| file.endsWith('/audio-node-utils.ts')) continue;
		const helperNames = audioConnectImports(ast);
		function addEdge(fromNode, toNode, call) {
			const scope = enclosingScope(call, ast);
			const fromName = expressionName(fromNode, ast);
			const toName = expressionName(toNode, ast);
			const from = `${file}#${scope}#${fromName}`;
			const to = `${file}#${scope}#${toName}`;
			const line = ast.getLineAndCharacterOfPosition(call.getStart(ast)).line + 1;
			for (const [id, name] of [[from, fromName], [to, toName]]) {
				if (!nodes.has(id)) nodes.set(id, { id, label: `${scope}: ${name}`, group: file });
			}
			edges.push({ from, to, scopeId: `${file}#${scope}`, tooltip: `${file}:${line}` });
		}
		function visit(node) {
			if (ts.isCallExpression(node)) {
				if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'connect'
					&& node.arguments.length > 0) {
					addEdge(node.expression.expression, node.arguments[0], node);
				} else if (ts.isIdentifier(node.expression) && helperNames.has(node.expression.text)
					&& node.arguments.length > 1) {
					addEdge(node.arguments[0], node.arguments[1], node);
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(ast);
	}
	return { title: 'Static audio connect call sites', direction: 'LR', nodes: [...nodes.values()], edges };
}

function audioOverviewGraph(graph) {
	const byScope = new Map();
	for (const edge of graph.edges) {
		const entries = byScope.get(edge.scopeId) ?? [];
		entries.push(edge);
		byScope.set(edge.scopeId, entries);
	}
	const selected = [...byScope].sort((a, b) => b[1].length - a[1].length
		|| a[0].localeCompare(b[0], 'en'))[0];
	const edgeCounts = new Map();
	for (const edge of selected?.[1] ?? []) {
		const key = `${edge.from}\0${edge.to}`;
		const entry = edgeCounts.get(key) ?? { ...edge, count: 0 };
		entry.count += 1;
		edgeCounts.set(key, entry);
	}
	const edges = [...edgeCounts.values()].map(({ count, ...edge }) => ({
		...edge,
		...(count > 1 ? { label: `${count} call sites` } : {}),
	}));
	const nodeIds = new Set(edges.flatMap(({ from, to }) => [from, to]));
	return {
		title: selected ? `Most connected audio routing scope: ${selected[0]}` : 'Audio routing scope',
		direction: 'LR',
		nodes: graph.nodes.filter(({ id }) => nodeIds.has(id)),
		edges,
	};
}

export function buildSourceGraphs(sources) {
	const relevant = sources.filter(({ path: file }) => isSourcePath(file));
	const knownPaths = new Set(relevant.map(({ path: file }) => file));
	const parsed = relevant.filter(({ path: file }) => isScriptPath(file))
		.map(({ path: file, content }) => ({ file, ast: sourceFile(file, content) }));
	const inheritance = inheritanceGraph(parsed, knownPaths);
	const audio = audioGraph(parsed);
	const ownership = ownershipGraph(relevant);
	return {
		ownership,
		ownershipOverview: ownershipOverviewGraph(ownership),
		dependencies: importGraph(parsed, knownPaths, ownerOf, 'Static imports between source owners'),
		overview: importGraph(parsed, knownPaths, architectureArea,
			'Three strongest import destinations per source area (types included)', true),
		inheritance,
		inheritanceOverview: inheritanceOverviewGraph(inheritance),
		audio,
		audioOverview: audioOverviewGraph(audio),
	};
}

function orderedGraph(graph) {
	return {
		...graph,
		nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id, 'en')),
		edges: [...graph.edges].sort((a, b) => [a.from, a.to, a.label ?? ''].join('\0')
			.localeCompare([b.from, b.to, b.label ?? ''].join('\0'), 'en')),
	};
}

function dotText(value) {
	return String(value).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\n/gu, '\\n');
}

function mermaidText(value) {
	return String(value).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
		.replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/\n/gu, '<br/>');
}

export function renderDot(input) {
	const graph = orderedGraph(input);
	const nodeIds = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
	const lines = [`digraph source_graph {`, `  label="${dotText(graph.title)}";`,
		`  labelloc="t";`, `  rankdir=${graph.direction};`, `  graph [fontname="Helvetica"];`,
		`  node [fontname="Helvetica", shape=box];`, `  edge [fontname="Helvetica"];`];
	const groups = new Map();
	for (const node of graph.nodes) {
		const group = node.group ?? '';
		const members = groups.get(group) ?? [];
		members.push(node);
		groups.set(group, members);
	}
	for (const [group, members] of groups) {
		if (group) lines.push(`  subgraph cluster_${groups.size + [...groups.keys()].indexOf(group)} { label="${dotText(group)}"; color="#d1d5db";`);
		for (const node of members) lines.push(`    ${nodeIds.get(node.id)} [label="${dotText(node.label)}"];`);
		if (group) lines.push('  }');
	}
	for (const edge of graph.edges) {
		const attrs = [];
		if (edge.label) attrs.push(`label="${dotText(edge.label)}"`);
		if (edge.typeOnly) attrs.push('style=dashed');
		if (edge.tooltip) attrs.push(`tooltip="${dotText(edge.tooltip)}"`);
		lines.push(`  ${nodeIds.get(edge.from)} -> ${nodeIds.get(edge.to)}${attrs.length ? ` [${attrs.join(', ')}]` : ''};`);
	}
	return `${lines.join('\n')}\n}\n`;
}

export function renderMermaid(input) {
	const graph = orderedGraph(input);
	const nodeIds = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
	const lines = [`flowchart ${graph.direction}`];
	const groups = new Map();
	for (const node of graph.nodes) {
		const group = node.group ?? '';
		const members = groups.get(group) ?? [];
		members.push(node);
		groups.set(group, members);
	}
	let groupIndex = 0;
	for (const [group, members] of groups) {
		if (group) lines.push(`  subgraph sg${groupIndex++}["${mermaidText(group)}"]`);
		for (const node of members) lines.push(`    ${nodeIds.get(node.id)}["${mermaidText(node.label)}"]`);
		if (group) lines.push('  end');
	}
	for (const edge of graph.edges) {
		const arrow = edge.typeOnly ? '-.->' : '-->';
		const label = edge.label ? `|"${mermaidText(edge.label)}"|` : '';
		lines.push(`  ${nodeIds.get(edge.from)} ${arrow}${label} ${nodeIds.get(edge.to)}`);
	}
	return `${lines.join('\n')}\n`;
}
