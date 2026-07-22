import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
	AUDACITY_ACTION_ALIASES,
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_SOURCE,
	AUDACITY_ACTION_STATUS,
	applyAudacityParityToMenus,
	audacityActionDefinition,
	resolveAudacityActionId,
} from '../src/common/editor/audacity-action-parity.js';

import {
	AUDACITY_PINNED_APP_MENU_ACTIONS,
	AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY,
	AUDACITY_PINNED_APP_MENU_CONTAINERS,
	AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS,
	AUDACITY_PINNED_BUILTIN_EFFECT_POLICY,
	AUDACITY_PINNED_UI_ACTIONS,
	AUDACITY_PINNED_UI_AUDIT,
	AUDACITY_PINNED_UI_COMMIT,
	AUDACITY_PINNED_UI_SOURCES,
} from '../src/common/editor/audacity-pinned-ui-inventory.js';
import { AUDACITY_EFFECT_DEFINITIONS } from '../src/common/editor/audacity-effects/manifest.js';
import { AUDIO_EDITOR_GENERATOR_TYPES } from '../src/common/editor/generators.js';

const PINNED_COMMIT = '908ad0a526e5bfdab68de780e893cebe172d27eb';

test('pinned Audacity UI inventory is immutable and carries exact source hashes', () => {
	assert.equal(AUDACITY_PINNED_UI_COMMIT, PINNED_COMMIT);
	assert.equal(Object.keys(AUDACITY_PINNED_UI_SOURCES).length, 11);
	assert.ok(Object.isFrozen(AUDACITY_PINNED_UI_SOURCES));
	assert.equal(
		AUDACITY_PINNED_UI_SOURCES['src/au3cloud/internal/clouduiactions.cpp'].sha256,
		'ba6f66ac53b5c8ab322124b6f6efef1db271a21cc6b38de8f9c350b716b6efd2',
	);

	for (const [source, record] of Object.entries(AUDACITY_PINNED_UI_SOURCES)) {
		assert.match(source, /\.cpp$/);
		assert.match(record.sha256, /^[a-f0-9]{64}$/);
		assert.ok(Object.isFrozen(record));
		assert.ok(Object.isFrozen(record.actions));
	}

	assert.equal(AUDACITY_PINNED_UI_ACTIONS.length, 280);
	assert.equal(new Set(AUDACITY_PINNED_UI_ACTIONS.map(({ id }) => id)).size, 277);
	assert.ok(Object.isFrozen(AUDACITY_PINNED_UI_ACTIONS));
	assert.ok(AUDACITY_PINNED_UI_ACTIONS.every(({ id, source }) => (
		typeof id === 'string' && id.length > 0 && AUDACITY_PINNED_UI_SOURCES[source]
	)));
	assert.equal(
		new Set(AUDACITY_PINNED_UI_ACTIONS.map(({ id, source }) => `${source}\0${id}`)).size,
		AUDACITY_PINNED_UI_ACTIONS.length,
		'Each source/action provenance pair must occur exactly once.',
	);
	assert.deepEqual(AUDACITY_PINNED_UI_AUDIT, {
		literalRegistrations: 255,
		uniqueLiteralActionIds: 251,
		resolvedRegistrationRecords: 280,
		uniqueResolvedActionIds: 277,
	});
});

test('pinned inventory retains dynamic actions, menu-only IDs, and builtin registrations', () => {
	const actionIds = new Set(AUDACITY_PINNED_UI_ACTIONS.map(({ id }) => id));
	for (const id of [
		'action://effects/open?effectId=%1',
		'action://effects/realtime-add?effectId=%1',
		'action://effects/realtime-replace?effectId=%1',
		'action://trackedit/track/change-format?format=%1',
		'action://trackedit/track/change-rate?rate=%1',
		'action://trackedit/clip/change-color?colorindex=%1',
		'action://trackedit/track/change-color?colorindex=%1',
		'track-spectrogram-settings',
	]) {
		assert.ok(actionIds.has(id), id);
	}

	assert.equal(AUDACITY_PINNED_APP_MENU_ACTIONS.length, 140);
	assert.equal(new Set(AUDACITY_PINNED_APP_MENU_ACTIONS).size, 140);
	assert.equal(AUDACITY_PINNED_APP_MENU_CONTAINERS.length, 48);
	assert.equal(new Set(AUDACITY_PINNED_APP_MENU_CONTAINERS).size, 48);
	assert.ok(AUDACITY_PINNED_APP_MENU_ACTIONS.includes('file-open-recent'));
	assert.ok(AUDACITY_PINNED_APP_MENU_ACTIONS.includes('diagnostic-show-actions'));
	assert.ok(AUDACITY_PINNED_APP_MENU_CONTAINERS.includes('menu-extra'));
	assert.deepEqual(
		Object.keys(AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY).sort(),
		[...AUDACITY_PINNED_APP_MENU_CONTAINERS].sort(),
	);
	for (const [id, policy] of Object.entries(AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY)) {
		assert.ok(['implemented', 'disabled-upstream', 'excluded'].includes(policy.status), id);
		if (policy.status !== 'implemented') assert.ok(policy.reason, id);
	}
	assert.equal(AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY['menu-extra'].status, 'excluded');
	assert.equal(AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY['menu-skip'].status, 'disabled-upstream');

	assert.equal(AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS.length, 26);
	assert.equal(new Set(AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS).size, 26);
	assert.ok(AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS.includes('ChangePitchEffect'));
	assert.ok(AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS.includes('LimiterEffect'));
	assert.ok(Object.isFrozen(AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS));
	assert.deepEqual(
		Object.keys(AUDACITY_PINNED_BUILTIN_EFFECT_POLICY).sort(),
		[...AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS].sort(),
	);
	for (const [registration, policy] of Object.entries(AUDACITY_PINNED_BUILTIN_EFFECT_POLICY)) {
		if (policy.kind === 'processor') assert.ok(AUDACITY_EFFECT_DEFINITIONS[policy.registryId], registration);
		else assert.ok(AUDIO_EDITOR_GENERATOR_TYPES.includes(policy.registryId), registration);
	}
});

test('every pinned registration and app-menu action has exactly one honest parity classification', () => {
	assert.equal(AUDACITY_ACTION_SOURCE.commit, AUDACITY_PINNED_UI_COMMIT);
	const upstreamIds = [...new Set([
		...AUDACITY_PINNED_UI_ACTIONS.map(({ id }) => id),
		...AUDACITY_PINNED_APP_MENU_ACTIONS,
	])];
	assert.equal(upstreamIds.length, 302);

	const missing = upstreamIds.filter((id) => !audacityActionDefinition(id));
	assert.deepEqual(missing, []);
	assert.equal(new Set(Object.keys(AUDACITY_ACTION_MANIFEST)).size, Object.keys(AUDACITY_ACTION_MANIFEST).length);
	for (const [alias, stableId] of Object.entries(AUDACITY_ACTION_ALIASES)) {
		assert.ok(AUDACITY_ACTION_MANIFEST[stableId], `${alias} -> ${stableId}`);
	}

	for (const id of upstreamIds) {
		const stableId = resolveAudacityActionId(id);
		const definition = audacityActionDefinition(id);
		assert.equal(definition, AUDACITY_ACTION_MANIFEST[stableId], id);
		assert.ok(Object.values(AUDACITY_ACTION_STATUS).includes(definition.status), id);
		if (definition.status === AUDACITY_ACTION_STATUS.IMPLEMENTED) {
			assert.match(definition.handler, /^[a-z][a-zA-Z]*(?:\.[a-z][a-zA-Z]*)+$/, id);
			assert.notEqual(definition.enableWhen, 'never', id);
		} else {
			assert.equal(definition.handler, null, id);
			assert.equal(definition.enableWhen, 'never', id);
			assert.ok(definition.reason.en && definition.reason.de, id);
		}
	}
	for (const id of ['audacity://cloud/open-project-page', 'audacity://cloud/open-audio-page']) {
		assert.equal(audacityActionDefinition(id).status, AUDACITY_ACTION_STATUS.EXCLUDED, id);
	}
});

test('excluded menu actions disappear and disabled actions remain inert and explained', () => {
	const menu = [{
		id: 'file',
		label: 'Pinned audit',
		items: AUDACITY_PINNED_APP_MENU_ACTIONS.map((id) => ({ id, label: id, onClick: () => id })),
	}];
	const [decorated] = applyAudacityParityToMenus(menu, { locale: 'en' });
	const output = new Map(decorated.items.map((item) => [item.id, item]));

	for (const id of AUDACITY_PINNED_APP_MENU_ACTIONS) {
		const definition = audacityActionDefinition(id);
		if (definition.status === AUDACITY_ACTION_STATUS.EXCLUDED || definition.menuVisible === false) {
			assert.equal(output.has(id), false, id);
		} else if (definition.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM) {
			assert.equal(output.get(id)?.disabled, true, id);
			assert.equal(output.get(id)?.onClick, undefined, id);
			assert.ok(output.get(id)?.disabledReason, id);
		} else {
			assert.equal(typeof output.get(id)?.onClick, 'function', id);
		}
	}
});

test('no implemented pinned action is surfaced as an unavailable application-menu placeholder', async () => {
	const source = await readFile(new URL('../src/common/editor/ui/AudioEditorApp.jsx', import.meta.url), 'utf8');
	const unavailableIds = [...source.matchAll(/unavailable\('([^']+)'/g)].map((match) => match[1]);
	assert.deepEqual(
		unavailableIds.filter((id) => audacityActionDefinition(id)?.status === AUDACITY_ACTION_STATUS.IMPLEMENTED),
		[],
	);
});
