/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertProducts,
	compareText,
	formatBinaryBytes,
	page,
	productSentence,
	reviewedLabel,
	table,
} from './markdown.mjs';

const WORKFLOW_LABELS = Object.freeze({
	'transcribe-captions': 'Transcribe and caption',
	'clean-filler-silence': 'Clean up filler words and silence',
	'identify-speakers': 'Identify speakers',
	'enhance-dialogue': 'Enhance dialogue',
	'reduce-reverb': 'Reduce reverb',
	'separate-dialogue-music-effects': 'Separate dialogue, music, and effects',
	'mark-reactions': 'Mark reactions',
	'index-transcript': 'Index the transcript',
	'detect-beats-tempo': 'Detect beats and tempo',
	'mark-cuts': 'Mark cuts',
	'index-video': 'Index the video',
	reframe: 'Reframe',
	'make-highlights': 'Make highlights',
	'generate-editorial-text': 'Generate editorial text',
});

/**
 * One vocabulary covers both the operation IDs a workflow stage names and the
 * task each catalogued model declares. They are separate runtime enumerations,
 * but they answer the same reader question, so a reader should not meet two
 * spellings of "speech recognition" on one page.
 */
const TASK_LABELS = Object.freeze({
	'voice-activity-detection': 'Voice activity detection',
	'speech-recognition': 'Speech recognition',
	'word-alignment': 'Word alignment',
	'speaker-diarization': 'Speaker diarization',
	'speaker-segmentation': 'Speaker segmentation',
	'speaker-embedding': 'Speaker embedding',
	'speech-enhancement': 'Speech enhancement',
	dereverberation: 'Dereverberation',
	'source-separation': 'Source separation',
	'audio-tagging': 'Audio tagging',
	'beat-tracking': 'Beat tracking',
	'text-embedding': 'Text embedding',
	'image-text-embedding': 'Image and text embedding',
	'optical-character-recognition': 'Optical character recognition',
	'shot-detection': 'Shot detection',
	'subject-detection': 'Subject detection',
	'face-detection': 'Face detection',
	'object-detection': 'Object detection',
	'saliency-detection': 'Saliency detection',
	'editorial-generation': 'Editorial generation',
});

const PLATFORM_LABELS = Object.freeze({
	'darwin-arm64': 'macOS arm64',
	'darwin-x64': 'macOS x64',
	'linux-arm64': 'Linux arm64',
	'linux-x64': 'Linux x64',
	'win32-arm64': 'Windows arm64',
	'win32-x64': 'Windows x64',
});

const DISTRIBUTION_LABELS = Object.freeze({
	'identity-mirrored': 'Mirrored byte-for-byte from upstream',
});

function operationSequence(stages, wanted) {
	const labels = stages
		.filter((stage) => stage.operation !== null && stage.required === wanted)
		.map((stage) => reviewedLabel(TASK_LABELS, stage.operation, 'assistance operation'));
	return [...new Set(labels)];
}

function workflowRows(workflowIds, stageGraph) {
	return workflowIds
		.map((id) => {
			const stages = stageGraph(id);
			return {
				label: reviewedLabel(WORKFLOW_LABELS, id, 'assistance workflow'),
				id,
				required: operationSequence(stages, true),
				optional: operationSequence(stages, false),
				stageCount: stages.length,
			};
		})
		.sort((left, right) => compareText(left.label, right.label))
		.map((workflow) => [
			workflow.label,
			`\`${workflow.id}\``,
			String(workflow.stageCount),
			workflow.required.join(' → ') || '—',
			workflow.optional.join('; ') || '—',
		]);
}

function modelRows(entries) {
	return entries
		.map((entry) => ({
			modelId: entry.modelId,
			task: reviewedLabel(TASK_LABELS, entry.task, 'assistance model task'),
			version: entry.version,
			distribution: reviewedLabel(DISTRIBUTION_LABELS, entry.distribution?.kind, 'model distribution'),
			memory: formatBinaryBytes(entry.minimumMemoryBytes),
			platforms: entry.platforms
				.map((platform) => reviewedLabel(PLATFORM_LABELS, platform, 'model platform'))
				.sort(compareText)
				.join('; '),
		}))
		.sort((left, right) => compareText(left.task, right.task) || compareText(left.modelId, right.modelId))
		.map((entry) => [
			`\`${entry.modelId}\``,
			entry.task,
			entry.version,
			entry.distribution,
			entry.memory,
			entry.platforms,
		]);
}

export function renderAssistanceReference({
	products,
	guidedWorkflowIds,
	operations,
	stageGraph,
	modelCatalog,
}) {
	assertProducts(products);
	if (!Array.isArray(guidedWorkflowIds) || guidedWorkflowIds.length === 0) throw new TypeError('The guided assistance workflow list is required.');
	if (!Array.isArray(operations) || operations.length === 0) throw new TypeError('The assistance operation list is required.');
	if (typeof stageGraph !== 'function') throw new TypeError('The assistance stage graph reader is required.');
	if (!Array.isArray(modelCatalog?.entries)) throw new TypeError('The local model catalog is required.');
	const enabledProducts = products.filter((product) => product.capabilities?.assistanceAssets === true);
	if (enabledProducts.length === 0) throw new Error('No product profile enables local assistance assets.');

	const operationRows = operations
		.map((operation) => ({
			label: reviewedLabel(TASK_LABELS, operation, 'assistance operation'),
			id: operation,
		}))
		.sort((left, right) => compareText(left.label, right.label))
		.map((operation) => [operation.label, `\`${operation.id}\``, `\`advanced:${operation.id}\``]);

	const body = [
		`Local assistance is available in ${productSentence(enabledProducts)}. Models are stored in a directory you choose on your own filesystem, and every run happens on your device; nothing about your media is sent anywhere.`,
		'',
		'A workflow is a fixed graph of steps. A step that names an operation runs a model; a step that names none is deterministic and runs no model. An optional step is skipped when its model is not installed, and the workflow still produces a result from the steps that ran.',
		'',
		'## Guided workflows',
		'',
		table(
			['Workflow', 'Workflow ID', 'Steps', 'Operations in order', 'Optional operations'],
			workflowRows(guidedWorkflowIds, stageGraph),
		),
		'',
		'## Operations',
		'',
		'Every operation can also be run on its own, without a surrounding workflow, under the advanced ID below.',
		'',
		table(['Operation', 'Operation ID', 'Run on its own as'], operationRows),
		'',
		'## Published models',
		'',
		`Models are published from \`${modelCatalog.publication.publicBaseUrl}\` and verified against a recorded SHA-256 digest before use. “Minimum memory” is the free memory a model needs to load; it is not a claim about how fast it will run. A task below is what one model does, which is not always spelled the same as the operation that uses it, and a single operation may draw on more than one model.`,
		'',
		table(
			['Model', 'Task', 'Version', 'Distribution', 'Minimum memory', 'Platforms'],
			modelRows(modelCatalog.entries),
		),
	].join('\n');
	return page({
		title: 'Local assistance',
		description: 'Guided local-assistance workflows, the operations they run, and the published local models.',
		order: 7,
		body,
	});
}
