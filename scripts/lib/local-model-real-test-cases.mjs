/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared contract for costly packaged-model tests and their handbook pages. */

const OPERATIONS = Object.freeze({
	'voice-activity-detection': spec(['voice-activity-detection'], 'speech-16khz', 'voice-activity'),
	'speech-recognition': spec(['speech-recognition'], 'speech-16khz', 'transcript'),
	'speaker-diarization': spec(['speaker-segmentation', 'speaker-embedding'], 'speech-16khz', 'speaker-turns'),
	'speech-enhancement': spec(['speech-enhancement'], 'noisy-speech-48khz', 'changed-audio'),
	'subject-detection': spec(['face-detection', 'object-detection'], 'visual-subject-frames', 'subject-detections'),
	'saliency-detection': spec(['saliency-detection'], 'visual-subject-frames', 'saliency'),
	'optical-character-recognition': spec(['optical-character-recognition'], 'visual-text-frames', 'ocr'),
	'text-embedding': spec(['text-embedding'], 'transcript-text', 'embeddings'),
	'image-text-embedding': spec(['image-text-embedding'], 'visual-subject-frames', 'embeddings'),
});

function spec(tasks, fixtureId, validation) {
	return Object.freeze({ tasks: Object.freeze(tasks), fixtureId, validation });
}

function record(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	return value;
}

function text(value, label) {
	if (typeof value !== 'string' || value.trim() === '' || value.length > 4_096) {
		throw new TypeError(`${label} must be nonempty text.`);
	}
	return value;
}

function textList(value, label) {
	if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty list.`);
	return value.map((entry) => text(entry, label));
}

function validateDocumentation(value, modelIds, label) {
	const documentation = record(value, `${label} documentation`);
	const titles = record(documentation.modelTitles, `${label} model titles`);
	for (const modelId of modelIds) text(titles[modelId], `${modelId} documentation title`);
	if (Object.keys(titles).some((modelId) => !modelIds.includes(modelId))) {
		throw new TypeError(`${label} documentation has a foreign model title.`);
	}
	if (modelIds.length > 1 || documentation.modelDetails !== undefined) {
		const details = record(documentation.modelDetails, `${label} model details`);
		for (const modelId of modelIds) text(details[modelId], `${modelId} documentation details`);
		if (Object.keys(details).some((modelId) => !modelIds.includes(modelId))) {
			throw new TypeError(`${label} documentation has foreign model details.`);
		}
	}
	text(documentation.summary, `${label} summary`);
	text(documentation.menu, `${label} menu`);
	textList(documentation.steps, `${label} steps`);
	textList(documentation.limitations, `${label} limitations`);
}

export function validateLocalModelRealTestCases(value, catalogValue) {
	const manifest = record(value, 'Real model test manifest');
	const catalog = record(catalogValue, 'Local model catalog');
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length === 0) {
		throw new TypeError('Real model tests require schemaVersion 1 and nonempty cases.');
	}
	if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
		throw new TypeError('The local model catalog must contain published entries.');
	}
	const models = new Map(catalog.entries.map((entry) => [entry.modelId, entry]));
	if (models.size !== catalog.entries.length) throw new TypeError('The local model catalog has duplicate model identities.');
	const caseIds = new Set();
	const covered = new Set();
	for (const candidate of manifest.cases) {
		const entry = record(candidate, 'Real model test case');
		const id = text(entry.id, 'Real model test case ID');
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new TypeError(`${id} is not a valid case ID.`);
		if (caseIds.has(id)) throw new TypeError(`${id} is a duplicate real model test case.`);
		caseIds.add(id);
		const modelIds = textList(entry.modelIds, `${id} models`);
		if (new Set(modelIds).size !== modelIds.length) throw new TypeError(`${id} has duplicate model bindings.`);
		const tasks = modelIds.map((modelId) => {
			const model = models.get(modelId);
			if (!model) throw new TypeError(`${id} refers to unpublished model ${modelId}.`);
			covered.add(modelId);
			return model.task;
		});
		const operation = Object.hasOwn(OPERATIONS, entry.operation) ? OPERATIONS[entry.operation] : null;
		if (!operation || tasks.toSorted().join('|') !== operation.tasks.toSorted().join('|')) {
			throw new TypeError(`${id} has an unsupported operation or incomplete model pair.`);
		}
		if (entry.fixtureId !== operation.fixtureId) throw new TypeError(`${id} has an incompatible fixture.`);
		if (entry.validation !== operation.validation) throw new TypeError(`${id} has an incompatible output validation.`);
		validateDocumentation(entry.documentation, modelIds, id);
	}
	for (const modelId of models.keys()) {
		if (!covered.has(modelId)) throw new TypeError(`${modelId} has no real execution case.`);
	}
	return manifest.cases;
}
