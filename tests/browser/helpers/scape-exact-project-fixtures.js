import { Buffer } from 'node:buffer';

import { createSoundscaperProjectV21 } from '../../../src/soundscaper/editor-project-v21.ts';

export async function promoteFramescaperArchiveToSoundscaperV21(
	input,
	{ id, title, mutate = () => {} },
	rewriteArchive,
) {
	return rewriteArchive(input, ({ project }) => {
		const foundation = framescaperV19FoundationForSoundscaperV21(project);
		foundation.id = id;
		foundation.title = title;
		mutate(foundation);
		const promoted = structuredClone(createSoundscaperProjectV21(foundation));
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

function framescaperV19FoundationForSoundscaperV21(value) {
	const project = structuredClone(value);
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

function withoutVideoComposition(clip) {
	const result = { ...clip };
	delete result.videoComposition;
	return result;
}
