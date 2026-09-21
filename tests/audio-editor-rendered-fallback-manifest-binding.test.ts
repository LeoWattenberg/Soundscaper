import test from 'node:test';
import assert from 'node:assert/strict';

import {
	assertProjectFeatureRenderedFallbackManifestBinding,
	type ProjectFeatureRenderedFallbackManifestBinding,
} from '../src/common/editor/project-feature-rendered-fallback-manifest-binding.ts';

const SHA256 = 'a'.repeat(64);

const bindings = Object.freeze([
	Object.freeze({
		featureId: 'org.example.mix', requirementId: 'mix',
		fallback: Object.freeze({ role: 'project-audio-mix-v1' as const, kind: 'audio' as const, sourceId: 'mix-source', sha256: SHA256 }),
	}),
	Object.freeze({
		featureId: 'org.example.picture', requirementId: 'picture',
		fallback: Object.freeze({ role: 'project-video-render-v1' as const, kind: 'video' as const, sourceId: 'picture-source', sha256: SHA256 }),
	}),
	Object.freeze({
		featureId: 'org.soundscaper.capability.audio-effects', requirementId: 'track',
		fallback: Object.freeze({ role: 'audio-track-render-v1' as const, kind: 'audio' as const, sourceId: 'track-source', sha256: SHA256, targetTrackId: 'track-a' }),
	}),
	Object.freeze({
		featureId: 'org.soundscaper.capability.video-effects', requirementId: 'clip',
		fallback: Object.freeze({ role: 'video-clip-render-v1' as const, kind: 'video' as const, sourceId: 'clip-source', sha256: SHA256, targetClipId: 'clip-a' }),
	}),
] satisfies readonly ProjectFeatureRenderedFallbackManifestBinding[]);

function projectFor(binding: ProjectFeatureRenderedFallbackManifestBinding): object {
	return {
		featureRequirements: {
			requirements: [{
				id: binding.requirementId,
				featureId: binding.featureId,
				disposition: 'rendered-fallback',
				fallback: { ...binding.fallback },
			}],
		},
	};
}

test('manifest binding accepts each closed rendered-fallback role', () => {
	for (const binding of bindings) {
		assert.doesNotThrow(() => assertProjectFeatureRenderedFallbackManifestBinding(
			projectFor(binding), binding,
		));
	}
});

test('manifest binding rejects every base and relationship mismatch', () => {
	for (const binding of bindings) {
		for (const field of ['featureId', 'disposition', 'role', 'kind', 'sourceId', 'sha256'] as const) {
			const project = projectFor(binding) as {
				featureRequirements: { requirements: Array<Record<string, unknown>> };
			};
			const requirement = project.featureRequirements.requirements[0]!;
			const fallback = requirement.fallback as Record<string, unknown>;
			if (field === 'featureId' || field === 'disposition') requirement[field] = 'wrong';
			else fallback[field] = 'wrong';
			assert.throws(
				() => assertProjectFeatureRenderedFallbackManifestBinding(project, binding),
				/does not match the project manifest/u,
				`${binding.fallback.role}.${field}`,
			);
		}
		const relationship = binding.fallback.role === 'audio-track-render-v1'
			? 'targetTrackId'
			: binding.fallback.role === 'video-clip-render-v1'
				? 'targetClipId'
				: null;
		if (relationship) {
			const project = projectFor(binding) as {
				featureRequirements: { requirements: Array<Record<string, unknown>> };
			};
			(project.featureRequirements.requirements[0]!.fallback as Record<string, unknown>)[relationship] = 'wrong';
			assert.throws(
				() => assertProjectFeatureRenderedFallbackManifestBinding(project, binding),
				/does not match the project manifest/u,
				`${binding.fallback.role}.${relationship}`,
			);
		}
	}
});

test('manifest binding requires one data-backed matching requirement', () => {
	const binding = bindings[0]!;
	const duplicate = projectFor(binding) as {
		featureRequirements: { requirements: Array<Record<string, unknown>> };
	};
	duplicate.featureRequirements.requirements.push({
		...duplicate.featureRequirements.requirements[0]!,
	});
	assert.throws(
		() => assertProjectFeatureRenderedFallbackManifestBinding(duplicate, binding),
		/does not match one project manifest requirement/u,
	);

	const accessor = projectFor(binding) as {
		featureRequirements: { requirements: Array<Record<string, unknown>> };
	};
	Object.defineProperty(accessor.featureRequirements.requirements[0]!, 'id', {
		enumerable: true,
		get: () => binding.requirementId,
	});
	assert.throws(
		() => assertProjectFeatureRenderedFallbackManifestBinding(accessor, binding),
		/must be an own data property/u,
	);
});
