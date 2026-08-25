import { Buffer } from 'node:buffer';

import { framescaperProjectV20FoundationV27 } from '../../../src/framescaper/editor-project-v27-runtime.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../../../src/framescaper/editor-project-runtime-profile-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from '../../../src/framescaper/editor-project-v28-foundation.ts';
import { framescaperProjectV28FoundationShapeV31 } from '../../../src/framescaper/editor-project-v31-foundation.ts';
import { createSoundscaperProjectV23 } from '../../../src/soundscaper/editor-project-v23.ts';
import { createSoundscaperProjectV29 } from '../../../src/soundscaper/editor-project-v29.ts';
import { createSoundscaperProjectV30 } from '../../../src/soundscaper/editor-project-v30.ts';

export async function promoteFramescaperArchiveToSoundscaperV23(
	input,
	{ id, title, mutate = () => {} },
	rewriteArchive,
) {
	return promoteFramescaperArchive(
		input, { id, title, mutate }, rewriteArchive, createSoundscaperProjectV23,
	);
}

export async function promoteFramescaperArchiveToSoundscaperV29(
	input,
	{ id, title, mutate = () => {} },
	rewriteArchive,
) {
	return promoteFramescaperArchive(
		input, { id, title, mutate }, rewriteArchive, createSoundscaperProjectV29,
	);
}

export async function promoteFramescaperArchiveToSoundscaperV30(
	input,
	{ id, title, mutate = () => {} },
	rewriteArchive,
) {
	return promoteFramescaperArchive(
		input, { id, title, mutate }, rewriteArchive, createSoundscaperProjectV30,
	);
}

async function promoteFramescaperArchive(input, { id, title, mutate }, rewriteArchive, createProject) {
	return rewriteArchive(input, ({ project }) => {
		const foundation = framescaperFoundationForSoundscaper(project);
		foundation.id = id;
		foundation.title = title;
		mutate(foundation);
		const promoted = structuredClone(createProject(foundation));
		for (const key of Object.keys(project)) delete project[key];
		Object.assign(project, promoted);
	});
}

export function publisherRequirementManifest(project, requirement) {
	return {
		schemaVersion: 2,
		requirements: [
			...project.featureRequirements.requirements.filter(({ featureId }) => (
				featureId !== requirement.featureId
			)),
			requirement,
		],
	};
}

export function createScapePcmPayload(source) {
	const chunkCount = Math.ceil(source.frameCount / source.chunkFrames);
	const output = Buffer.alloc(
		source.frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT + chunkCount * 4,
	);
	let frameOffset = 0;
	let byteOffset = 0;
	while (frameOffset < source.frameCount) {
		const frames = Math.min(source.chunkFrames, source.frameCount - frameOffset);
		output.writeUInt32LE(frames, byteOffset);
		byteOffset += 4;
		for (let channel = 0; channel < source.channelCount; channel += 1) {
			if (frameOffset === 0) {
				const value = channel === 0 ? 0.125 : 0.75;
				for (let frame = 0; frame < Math.min(frames, 2_048); frame += 1) {
					output.writeFloatLE(value, byteOffset + frame * Float32Array.BYTES_PER_ELEMENT);
				}
			}
			byteOffset += frames * Float32Array.BYTES_PER_ELEMENT;
		}
		frameOffset += frames;
	}
	return output;
}

function framescaperFoundationForSoundscaper(value) {
	const project = structuredClone(framescaperSelectedFoundation(value));
	delete project.schemaVersion;
	delete project.subsequences;
	delete project.multicameraGroups;
	delete project.mixer;
	project.sources = project.sources.map((source) => {
		const result = { ...source };
		delete result.proxyAttachment;
		return result;
	});
	project.clips = project.clips.map(withoutVideoComposition);
	project.projectBin = {
		...project.projectBin,
		clips: project.projectBin.clips.map(withoutVideoComposition),
	};
	return project;
}

function framescaperSelectedFoundation(value) {
	if (value.schemaVersion === 31) {
		return framescaperSelectedFoundation(framescaperProjectV28FoundationShapeV31(value));
	}
	if (value.schemaVersion === 28) {
		return framescaperProjectV20FoundationV27(
			FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV27FoundationShapeV28(value),
		);
	}
	return value.schemaVersion === 27
		? framescaperProjectV20FoundationV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, value)
		: value;
}

function withoutVideoComposition(clip) {
	const result = { ...clip };
	delete result.videoComposition;
	return result;
}
