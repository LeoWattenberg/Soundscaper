/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_PROFILE, SOUNDSCAPER_PROFILE } from '../src/common/product-profiles.js';
import {
	KNOWN_PRODUCT_COMMANDS,
	OPTIONAL_COMPOSITION_DOMAINS,
	resolveProductCompositionDecision,
	type OptionalCompositionDomain,
} from '../src/common/editor/controller/product-composition-policy.ts';

test('Soundscaper composes every optional audio subsystem domain', () => {
	const decision = resolveProductCompositionDecision(SOUNDSCAPER_PROFILE);
	assert.deepEqual({ ...decision }, {
		recording: true,
		generators: true,
		labeledAudio: true,
		effects: true,
		spectral: true,
		analysis: true,
		macros: true,
		selectionEffectWorkers: true,
	});
});

test('Framescaper composes no optional audio subsystem domain', () => {
	const decision = resolveProductCompositionDecision(FRAMESCAPER_PROFILE);
	assert.deepEqual({ ...decision }, {
		recording: false,
		generators: false,
		labeledAudio: false,
		effects: false,
		spectral: false,
		analysis: false,
		macros: false,
		selectionEffectWorkers: false,
	});
});

test('every command a shipped profile declares is a domain the policy knows', () => {
	for (const profile of [SOUNDSCAPER_PROFILE, FRAMESCAPER_PROFILE]) {
		for (const command of profile.enabledCommands) {
			assert.ok(
				KNOWN_PRODUCT_COMMANDS.includes(command),
				`${profile.id} declares unknown command "${command}"`,
			);
		}
	}
});

test('a command the policy does not know is refused rather than ignored', () => {
	assert.throws(
		() => resolveProductCompositionDecision({ enabledCommands: ['project', 'image-retouch'] }),
		/image-retouch/u,
	);
});

test('the decision reports exactly the optional domains the policy publishes', () => {
	const decision = resolveProductCompositionDecision({ enabledCommands: [] });
	for (const domain of OPTIONAL_COMPOSITION_DOMAINS) {
		assert.equal(decision[domain], false, `${domain} should be absent with no commands enabled`);
	}
	const published = new Set<string>(OPTIONAL_COMPOSITION_DOMAINS);
	for (const key of Object.keys(decision)) {
		if (key === 'selectionEffectWorkers') continue;
		assert.ok(published.has(key), `decision key "${key}" is not a published optional domain`);
	}
	assert.equal(published.size, Object.keys(decision).length - 1);
});

test('the selection-effect worker pool follows either the effect or the spectral domain', () => {
	const effectsOnly = resolveProductCompositionDecision({ enabledCommands: ['audio-effects'] });
	const spectralOnly = resolveProductCompositionDecision({ enabledCommands: ['audio-spectral'] });
	const neither = resolveProductCompositionDecision({ enabledCommands: ['audio-analysis'] });
	assert.equal(effectsOnly.selectionEffectWorkers, true);
	assert.equal(spectralOnly.selectionEffectWorkers, true);
	assert.equal(neither.selectionEffectWorkers, false);
});

test('labeled-audio generation rides the generator command', () => {
	const generators = resolveProductCompositionDecision({ enabledCommands: ['audio-generate'] });
	const domains: readonly OptionalCompositionDomain[] = ['generators', 'labeledAudio'];
	for (const domain of domains) assert.equal(generators[domain], true);
});
