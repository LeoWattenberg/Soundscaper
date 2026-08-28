import { Buffer } from 'node:buffer';

import { framescaperProjectRetimeFoundationFinishing } from '../../../src/framescaper/editor-project-finishing-runtime.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from '../../../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from '../../../src/framescaper/editor-project-native-media-foundation.ts';
import { framescaperProjectNativeMediaFoundationShapeAssistance } from '../../../src/framescaper/editor-project-assistance-foundation.ts';
import { createSoundscaperProject } from '../../../src/soundscaper/editor-project.ts';

export async function promoteFramescaperArchiveToSoundscaper(
	input,
	{ id, title, mutate = () => {} },
	rewriteArchive,
) {
	return promoteFramescaperArchive(
		input, { id, title, mutate }, rewriteArchive, createSoundscaperProject,
	);
}

export function prepareSoundscaperV1Foundation(foundation) {
	for (const track of foundation.tracks ?? []) delete track.videoTransitions;
	for (const source of foundation.sources ?? []) {
		if (source?.kind !== 'video' || !source.characteristics) continue;
		for (const key of ['bitDepth', 'pixelFormat', 'chromaFormat', 'alphaMode', 'alphaInterpretation']) {
			delete source.characteristics[key];
		}
		delete source.characteristics.colour?.masteringDisplay;
		delete source.characteristics.colour?.contentLight;
	}
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
		return framescaperSelectedFoundation(framescaperProjectNativeMediaFoundationShapeAssistance(value));
	}
	if (value.schemaVersion === 28) {
		return framescaperProjectRetimeFoundationFinishing(
			FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
			framescaperProjectFinishingFoundationShapeNativeMedia(value),
		);
	}
	return value.schemaVersion === 27
		? framescaperProjectRetimeFoundationFinishing(FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, value)
		: value;
}

function withoutVideoComposition(clip) {
	const result = { ...clip };
	delete result.videoComposition;
	return result;
}
