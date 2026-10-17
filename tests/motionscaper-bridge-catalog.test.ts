/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotionLinkBridgeCopy, MOTION_LINK_BRIDGE_CANONICAL_ENGLISH_COPY, MOTION_LINK_BRIDGE_COPY_BY_LOCALE } from '../src/common/i18n/editor-motion-link-bridge-copy.ts';

const french = {
	title: 'Lien de composition', send: 'Connecter à Framescaper',
	hint: 'Gardez les deux éditeurs et ces fenêtres ouverts pendant le transfert de la composition.',
	receiving: 'Connexion au projet Framescaper.', sending: 'Connexion à Motionscaper.',
	connected: 'Connecté. Les mises à jour enregistrées passent entre les éditeurs.',
	closed: 'La connexion est fermée. Revenez aux éditeurs pour vérifier le transfert.',
	cancel: 'Annuler la connexion', failed: 'La connexion de composition a échoué.',
};
function catalog(entries: Readonly<Record<string, unknown>>, locale = 'fr') { return { schemaVersion: 2, locale, entries }; }
function entries(): Record<string, unknown> {
	return Object.fromEntries(Object.entries(french).map(([key, value]) => [
		`ui.motion-link-bridge.${key}`, ['machine', MOTION_LINK_BRIDGE_CANONICAL_ENGLISH_COPY[`ui.motion-link-bridge.${key}`], value],
	]));
}

test('M10 all nine French bridge catalog entries reach the normal loader and owned copy resolver', async () => {
	let calls = 0;
	const copy = await loadMotionLinkBridgeCopy('fr', { loaders: { fr: () => { calls++; return Promise.resolve({ default: catalog(entries()) }); } } });
	assert.equal(calls, 1); assert.deepEqual(copy, french); assert.equal(Object.isFrozen(copy), true);
	assert.equal(Object.keys(MOTION_LINK_BRIDGE_CANONICAL_ENGLISH_COPY).length, 9);
	assert.ok(Object.keys(MOTION_LINK_BRIDGE_CANONICAL_ENGLISH_COPY).every(key => key.startsWith('ui.motion-link-bridge.')));
});

test('M10 stale, unknown-origin and foreign-owner bridge translations retain their human fallback', async () => {
	const values = entries();
	values['ui.motion-link-bridge.title'] = ['machine', 'Retired title', 'Titre périmé'];
	values['ui.motion-link-bridge.send'] = ['unknown', MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en.send, french.send];
	delete values['ui.motion-link-bridge.cancel'];
	values['ui.motionscaper.cancel'] = ['machine', MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en.cancel, 'Mauvais propriétaire'];
	values['ui.motion-link-bridge.unknown'] = ['machine', 'Unknown', 'Inconnu'];
	values.title = ['machine', MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en.title, 'Clé sans propriétaire'];
	const copy = await loadMotionLinkBridgeCopy('fr', { loaders: { fr: () => Promise.resolve(catalog(values)) } });
	assert.deepEqual(copy, { ...french, title: MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en.title,
		send: MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en.send, cancel: MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en.cancel });
	assert.equal(Object.keys(copy).length, 9);
});

test('M10 bridge catalog loader preserves English/German defaults and refuses mismatched catalogs', async () => {
	assert.deepEqual(await loadMotionLinkBridgeCopy('en', { loaders: {} }), MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en);
	assert.deepEqual(await loadMotionLinkBridgeCopy('de', { loaders: {} }), MOTION_LINK_BRIDGE_COPY_BY_LOCALE.de);
	await assert.rejects(loadMotionLinkBridgeCopy('fr', { loaders: { fr: () => Promise.resolve(catalog(entries(), 'es')) } }), /does not match/u);
	await assert.rejects(loadMotionLinkBridgeCopy('fr', { loaders: { fr: () => Promise.reject(new Error('Unavailable catalog chunk')) } }), /Unavailable catalog chunk/u);
});
