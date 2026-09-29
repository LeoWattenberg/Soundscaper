import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildSourceGraphs,
	focusDependencyGraph,
	ownerOf,
	renderDot,
	renderMermaid,
} from '../scripts/lib/source-graphs.mjs';

const sources = [
	{
		path: 'src/common/editor/engine/audio-node-utils.ts',
		content: 'export function connect(source: AudioNode, target: AudioNode) { source.connect(target); }',
	},
	{
		path: 'src/common/editor/engine/project-graph.ts',
		content: `import { connect } from './audio-node-utils.ts';
import type { Bus } from '../controller/routing/public-api.ts';
export class ProjectGraph extends BaseGraph implements Bus {
	build(input: AudioNode, output: AudioNode) {
		const gain = new GainNode(input.context);
		connect(input, gain);
		gain.connect(output);
	}
}`,
	},
	{
		path: 'src/common/editor/controller/routing/public-api.ts',
		content: 'export interface Bus extends Routable {}\ninterface Routable {}',
	},
	{
		path: 'src/common/editor/engine/base.ts',
		content: 'export class BaseGraph {}',
	},
	{
		path: 'src/common/editor/top-level.ts',
		content: 'export const version = 1;',
	},
	{
		path: 'src/common/editor/controller/transport/internal/transport-service.ts',
		content: 'function tick(context) { const oscillator = context.createOscillator(); oscillator.connect(context.destination); }',
	},
	{
		path: 'native/example/src/engine.cpp',
		content: 'struct Engine {};',
	},
];

test('ownership groups files by source directory and includes native source', () => {
	assert.equal(ownerOf('src/common/editor/controller/routing/public-api.ts'), 'src/common/editor/controller/routing');
	assert.equal(ownerOf('src/common/editor/engine/project-graph.ts'), 'src/common/editor/engine');
	const { ownership, ownershipOverview } = buildSourceGraphs(sources);
	assert(ownership.nodes.some((node) => node.id === 'native/example' && node.label.includes('1 source file')));
	assert(ownership.edges.some((edge) => edge.from === 'src/common/editor' && edge.to === 'src/common/editor/engine'));
	assert(ownershipOverview.nodes.some((node) => node.id === '@repository' && node.label.includes('7 source files')));
	assert(ownershipOverview.edges.some((edge) => edge.from === '@repository' && edge.to === 'native'));
	assert(ownershipOverview.edges.some((edge) => edge.from === 'src/common/editor'
		&& edge.to === 'src/common/editor/engine'));
	assert(ownershipOverview.nodes.some((node) => node.id === '@other:src/common/editor'
		&& node.label.includes('1 source file')));
	assert(!ownershipOverview.nodes.some((node) => node.id === 'native/example'));
});

test('dependency edges come from imports and preserve type-only information', () => {
	const { dependencies, overview } = buildSourceGraphs(sources);
	assert(dependencies.edges.some((edge) => edge.from === 'src/common/editor/engine'
		&& edge.to === 'src/common/editor/controller/routing'
		&& edge.typeOnly === true));
	assert(!dependencies.edges.some((edge) => edge.to === 'native/example'));
	assert(overview.edges.some((edge) => edge.from === 'src/common/editor/engine'
		&& edge.to === 'src/common/editor/controller'));
});

test('focused dependency view keeps only edges touching its owner', () => {
	const graph = {
		title: 'All imports', direction: 'LR',
		nodes: ['desktop', 'editor', 'engine', 'ui', 'isolated'].map((id) => ({ id, label: id })),
		edges: [
			{ from: 'desktop', to: 'editor', label: '3 imports' },
			{ from: 'editor', to: 'desktop', label: '1 import', typeOnly: true },
			{ from: 'engine', to: 'ui', label: '2 imports' },
		],
	};
	const focused = focusDependencyGraph(graph, 'desktop');
	assert.deepEqual(focused.nodes.map(({ id }) => id), ['desktop', 'editor']);
	assert.deepEqual(focused.edges, graph.edges.slice(0, 2));
	assert.match(focused.title, /desktop/);
	assert.match(renderDot(focused), /fillcolor="#e0f2fe"/);
	assert.match(renderMermaid(focused), /style n0 fill:#e0f2fe/);
	assert.deepEqual(focusDependencyGraph(graph, 'isolated').nodes.map(({ id }) => id), ['isolated']);
	assert.deepEqual(focusDependencyGraph(graph, 'isolated').edges, []);
	assert.throws(() => focusDependencyGraph(graph, 'missing'), /Unknown dependency owner/);
});

test('inheritance includes classes, interfaces, and implementation edges', () => {
	const { inheritance, inheritanceOverview } = buildSourceGraphs(sources);
	assert(inheritance.edges.some((edge) => edge.from.includes('ProjectGraph')
		&& edge.to.includes('BaseGraph') && edge.label === 'extends'));
	assert(inheritance.edges.some((edge) => edge.from.includes('ProjectGraph')
		&& edge.to.includes('Bus') && edge.label === 'implements'));
	assert(inheritance.edges.some((edge) => edge.from.includes('Bus')
		&& edge.to.includes('Routable') && edge.label === 'extends'));
	assert.equal(inheritanceOverview.edges.length, 3);
});

test('audio graph reads connect call sites and keeps functions separate', () => {
	const { audio, audioOverview } = buildSourceGraphs(sources);
	assert(audio.edges.some((edge) => edge.from.includes('project-graph.ts#ProjectGraph.build#input')
		&& edge.to.includes('project-graph.ts#ProjectGraph.build#gain')));
	assert(audio.edges.some((edge) => edge.from.includes('project-graph.ts#ProjectGraph.build#gain')
		&& edge.to.includes('project-graph.ts#ProjectGraph.build#output')));
	assert(!audio.edges.some((edge) => edge.from.includes('audio-node-utils.ts')));
	assert(audio.edges.some((edge) => edge.from.includes('transport-service.ts#tick#oscillator')));
	assert.equal(audioOverview.edges.length, 2);
});

test('DOT and Mermaid output escape source names and include graph links', () => {
	const graph = { title: 'A "graph"', direction: 'LR', nodes: [
		{ id: 'a', label: 'one "quoted"' },
		{ id: 'b', label: 'two' },
	], edges: [{ from: 'a', to: 'b', label: 'extends' }] };
	assert.match(renderDot(graph), /"one \\"quoted\\""/);
	assert.match(renderMermaid(graph), /flowchart LR/);
	assert.match(renderMermaid(graph), /-->|-- extends -->/);
});
