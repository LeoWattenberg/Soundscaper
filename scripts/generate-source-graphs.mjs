#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceGraphs, focusDependencyGraph, isSourcePath, renderDot, renderMermaid } from './lib/source-graphs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputNames = {
	ownership: 'ownership',
	ownershipOverview: 'ownership-overview',
	overview: 'architecture-overview',
	dependencies: 'dependencies',
	inheritance: 'inheritance',
	inheritanceOverview: 'inheritance-overview',
	audio: 'audio-routing',
	audioOverview: 'audio-routing-overview',
};
const excludedDirectories = new Set(['node_modules', 'dist', 'build', 'prebuilt', 'fixtures', 'tests', 'coverage']);

function argumentsForRun(args) {
	let outputDirectory = path.join(root, '.source-graphs');
	let svg = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--help') return { help: true };
		if (arg === '--svg') svg = true;
		else if (arg === '--out-dir' && args[index + 1]) outputDirectory = path.resolve(args[++index]);
		else throw new Error(`Unknown or incomplete option: ${arg}`);
	}
	return { outputDirectory, svg };
}

async function collectSources(directory, relative = '') {
	const sources = [];
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
		const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!excludedDirectories.has(entry.name)) sources.push(...await collectSources(absolute, nextRelative));
		} else if (entry.isFile() && isSourcePath(nextRelative)) {
			sources.push({ path: nextRelative, content: await readFile(absolute, 'utf8') });
		}
	}
	return sources;
}

function renderSvg(dotPath, svgPath, graph) {
	// dot's spline router can fail on large graphs, and dense dependency layouts
	// take much longer. sfdp handles both without dropping nodes or edges.
	const renderer = graph.nodes.length > 500 || graph.edges.length > 300 ? 'sfdp' : 'dot';
	const arguments_ = ['-Tsvg', ...(renderer === 'sfdp' ? ['-Gsplines=false'] : []), dotPath, '-o', svgPath];
	const result = spawnSync(renderer, arguments_, { encoding: 'utf8' });
	if (result.error) throw new Error(`Graphviz ${renderer} is required for --svg: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`Graphviz ${renderer} could not render ${dotPath}: ${result.stderr.trim()}`);
}

async function writeGraph(outputDirectory, name, graph, svg) {
	const dotPath = path.join(outputDirectory, `${name}.dot`);
	const mermaidPath = path.join(outputDirectory, `${name}.mmd`);
	await mkdir(path.dirname(dotPath), { recursive: true });
	await writeFile(dotPath, renderDot(graph));
	await writeFile(mermaidPath, renderMermaid(graph));
	if (svg) renderSvg(dotPath, path.join(outputDirectory, `${name}.svg`), graph);
}

async function main() {
	const options = argumentsForRun(process.argv.slice(2));
	if (options.help) {
		process.stdout.write('Usage: npm run graphs:generate -- [--out-dir PATH] [--svg]\n');
		process.stdout.write('Writes separate Graphviz DOT and Mermaid flowcharts from source analysis.\n');
		return;
	}
	const sources = (await Promise.all(['src', 'desktop', 'native'].map((directory) => (
		collectSources(path.join(root, directory), directory)
	)))).flat();
	const graphs = buildSourceGraphs(sources);
	await mkdir(options.outputDirectory, { recursive: true });
	for (const [key, name] of Object.entries(outputNames)) {
		const graph = graphs[key];
		await writeGraph(options.outputDirectory, name, graph, options.svg);
		process.stdout.write(`${name}: ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`);
	}
	await rm(path.join(options.outputDirectory, 'dependencies-by-owner'), { recursive: true, force: true });
	for (const { id: owner } of graphs.dependencies.nodes) {
		const graph = focusDependencyGraph(graphs.dependencies, owner);
		await writeGraph(options.outputDirectory, `dependencies-by-owner/${owner}`, graph, options.svg);
	}
	process.stdout.write(`dependencies-by-owner: ${graphs.dependencies.nodes.length} focused views\n`);
	process.stdout.write(`Wrote source graphs to ${options.outputDirectory}\n`);
}

await main();
