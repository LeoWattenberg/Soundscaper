/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic SigLIP2 zero-shot tagging for the closed non-biometric taxonomy. */

import {
	createAssistanceEmbeddingMatrixV1,
	reviewAssistanceEmbeddingMatrixV1,
} from './binary-formats-v1.ts';
import {
	type AssistanceNonBiometricVisualTagV1,
	type AssistanceVisualSearchTagV1,
} from './visual-search-records-v1.ts';

export const ASSISTANCE_VISUAL_TAG_PROMPTS_V1 = Object.freeze([
	prompt('animal', 'This is a photo containing an animal.'),
	prompt('close-up', 'This is a photo with a close-up camera shot.'),
	prompt('document', 'This is a photo of a document.'),
	prompt('food', 'This is a photo of food.'),
	prompt('group', 'This is a photo of a group of people.'),
	prompt('high-motion', 'This is a photo from a high-motion action scene.'),
	prompt('indoor', 'This is a photo taken indoors.'),
	prompt('landscape', 'This is a photo of a landscape scene.'),
	prompt('low-motion', 'This is a photo from a low-motion static scene.'),
	prompt('medium-shot', 'This is a photo with a medium camera shot.'),
	prompt('nature', 'This is a photo of nature.'),
	prompt('office', 'This is a photo taken in an office.'),
	prompt('outdoor', 'This is a photo taken outdoors.'),
	prompt('performance', 'This is a photo of a live performance.'),
	prompt('person', 'This is a photo containing a person.'),
	prompt('presentation', 'This is a photo of a person giving a presentation.'),
	prompt('product', 'This is a photo of a product shot.'),
	prompt('screen', 'This is a photo of a computer or television screen.'),
	prompt('sports', 'This is a photo of a sports scene.'),
	prompt('stage', 'This is a photo of a stage.'),
	prompt('studio', 'This is a photo of a recording or production studio.'),
	prompt('text-overlay', 'This is a photo of a video frame with overlaid text.'),
	prompt('urban', 'This is a photo of an urban city scene.'),
	prompt('vehicle', 'This is a photo of a vehicle.'),
	prompt('vehicle-interior', 'This is a photo of the interior of a vehicle.'),
	prompt('wide-shot', 'This is a photo with a wide camera shot.'),
] as const);

export interface AssistanceClassifiedVisualTagEmbeddingsV1 {
	/** Image rows only; fixed text-prototype rows never enter the disposable search matrix. */
	readonly matrix: Uint8Array<ArrayBuffer>;
	readonly tags: readonly (readonly AssistanceVisualSearchTagV1[])[];
}

const TAG_SIMILARITY_THRESHOLD_V1 = 0.55;
const MAXIMUM_TAGS_PER_FRAME_V1 = 3;
const MAXIMUM_FRAME_ROWS = 100_000;

/**
 * Split a strict matrix containing image rows followed by one prototype row per
 * taxonomy entry, then apply the versioned owned cosine-ranking policy. The
 * split tower artifacts do not expose the full model's learned logit head.
 */
export function classifyAssistanceVisualTagEmbeddingsV1(
	value: ArrayBuffer | ArrayBufferView,
	frameCountValue: number,
): AssistanceClassifiedVisualTagEmbeddingsV1 {
	const frameCount = integer(frameCountValue, 1, MAXIMUM_FRAME_ROWS, 'visual frame row count');
	const source = reviewAssistanceEmbeddingMatrixV1(value);
	const prototypeCount = ASSISTANCE_VISUAL_TAG_PROMPTS_V1.length;
	if (source.rowCount !== frameCount + prototypeCount) {
		throw new RangeError('Visual tag prototype rows disagree with the versioned taxonomy.');
	}
	const imageVectors = Array.from({ length: frameCount }, (_, index) => source.vector(index));
	const prototypes = Array.from({ length: prototypeCount }, (_, index) =>
		source.vector(frameCount + index));
	const tags = imageVectors.map((image) => classifyRow(image, prototypes));
	return Object.freeze({
		matrix: createAssistanceEmbeddingMatrixV1({ dimensions: source.dimensions,
			vectors: imageVectors }),
		tags: Object.freeze(tags),
	});
}

function prompt<Tag extends AssistanceNonBiometricVisualTagV1>(tag: Tag, text: string): Readonly<{
	readonly tag: Tag;
	readonly text: string;
}> {
	return Object.freeze({ tag, text });
}

function cosineForNormalizedVectors(left: Float32Array, right: Float32Array): number {
	let result = 0;
	for (let index = 0; index < left.length; index += 1) result += left[index]! * right[index]!;
	return Math.max(-1, Math.min(1, result));
}

function classifyRow(
	image: Float32Array,
	prototypes: readonly Float32Array[],
): readonly AssistanceVisualSearchTagV1[] {
	const candidates = ASSISTANCE_VISUAL_TAG_PROMPTS_V1.map(({ tag }, index) => Object.freeze({
		index, tag,
		score: Math.fround((cosineForNormalizedVectors(image, prototypes[index]!) + 1) / 2),
	}));
	const selected = new Set(candidates
		.filter(({ score }) => score >= TAG_SIMILARITY_THRESHOLD_V1)
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.slice(0, MAXIMUM_TAGS_PER_FRAME_V1)
		.map(({ index }) => index));
	return Object.freeze(candidates.flatMap(({ index, tag, score }) => selected.has(index)
		? [Object.freeze({ tag, score })] : []));
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
