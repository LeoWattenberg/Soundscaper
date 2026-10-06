/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AUDACITY_ACTION_ALIASES, AUDACITY_ACTION_MANIFEST, applyAudacityParityToMenus,
	audacityActionDefinition, resolveAudacityActionHandler, resolveAudacityActionId } from '../src/common/editor/audacity-action-parity.js';

interface Definition { readonly id: string; readonly handler: string; readonly status: string }
interface Match { definition: Definition; dynamic: boolean; template: boolean; valid: boolean; parameters: Array<string | number> }
type MatchAction = (id: unknown) => Match | null;
// Inspect the existing private result contract without adding an application export solely for tests.
const sourceUrl = new URL('../src/common/editor/audacity-action-parity.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8').replace(/from\s+(['"])(\.[^'"]+)\1/g,
	(_match: string, quote: string, path: string) => `from ${quote}${new URL(path, sourceUrl).href}${quote}`);
const privateModule = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { matchAudacityAction };`).toString('base64')}`) as {
	matchAudacityAction: MatchAction; AUDACITY_ACTION_MANIFEST: Readonly<Record<string, Definition>>;
};
const rate = 'action://trackedit/track/change-rate?rate=';
const color = 'action://trackedit/clip/change-color?colorindex=';
const effect = 'action://effects/open?effectId=';

test('exact definitions, aliases and prototype-like unknown IDs retain the pinned matching authority', () => {
	for (const id of Object.keys(AUDACITY_ACTION_MANIFEST)) assert.equal(audacityActionDefinition(id), AUDACITY_ACTION_MANIFEST[resolveAudacityActionId(id)], id);
	for (const [alias, id] of Object.entries(AUDACITY_ACTION_ALIASES)) { assert.ok(typeof id === 'string'); assert.equal(audacityActionDefinition(alias), AUDACITY_ACTION_MANIFEST[id], alias); }
	for (const id of [null, undefined, 0, {}, '', 'constructor', '__proto__', 'toString', 'unknown-action', `${rate}1/extra`]) {
		assert.equal(privateModule.matchAudacityAction(id)?.valid ?? false, false, String(id));
	}
});

test('dynamic decoding and numeric admission preserve exact existing values and invalid-result definitions', () => {
	const cases: Array<readonly [string, boolean, Array<string | number>]> = [
		[`${rate}44100`, true, [44100]], [`${rate}4.41e4`, true, [44100]], [`${rate}%2B44100`, true, [44100]],
		[`${rate}0`, false, []], [`${rate}-1`, false, []], [`${rate}1.5`, false, []], [`${rate}9007199254740992`, false, []],
		[`${color}0`, true, [0]], [`${color}-0`, true, [-0]], [`${color}+`, true, [0]], [`${color}-1`, false, []],
		[`${effect}hello+world`, true, ['hello world']], [`${effect}hello%2Bworld`, true, ['hello+world']],
		[`${effect}caf%C3%A9%2Ftest%3Fa%3D1`, true, ['café/test?a=1']], [`${effect}%20`, true, [' ']],
		[`${effect}`, false, []], [`${effect}%`, false, []], [`${effect}%E0%A4%A`, false, []],
	];
	for (const [id, valid, parameters] of cases) {
		const match = privateModule.matchAudacityAction(id); assert.ok(match, id);
		assert.equal(match.template, false, id); assert.equal(match.dynamic, true, id); assert.equal(match.valid, valid, id); assert.deepEqual(match.parameters, parameters, id);
		assert.equal(audacityActionDefinition(id)?.id, match.definition.id, id);
	}
	for (const definition of Object.values(privateModule.AUDACITY_ACTION_MANIFEST).filter((entry) => entry.id.includes('%1'))) {
		assert.deepEqual(privateModule.matchAudacityAction(definition.id), { definition, template: true, dynamic: true, valid: true, parameters: [] });
		const concrete = privateModule.matchAudacityAction(definition.id.replace('%1', '17'))!;
		assert.equal(concrete.definition, definition); assert.equal(concrete.valid, true); assert.equal(concrete.template, false);
	}
});

test('unknown and concrete dynamic lookups perform no repeated manifest enumeration after initialization', (context) => {
	let scans = 0; const values = Object.values;
	context.mock.method(Object, 'values', (value: object) => { if (value === AUDACITY_ACTION_MANIFEST) scans++; return values(value); });
	for (let index = 0; index < 1000; index++) { audacityActionDefinition(`unknown-${index}`); audacityActionDefinition(`${rate}44100`); }
	assert.equal(scans, 0);
});

test('private results, parameter arrays, dynamic handlers and decorated public menu trees remain fresh', () => {
	for (const id of ['file-new', `${rate}44100`, `${effect}%`]) {
		const first = privateModule.matchAudacityAction(id)!; const second = privateModule.matchAudacityAction(id)!;
		assert.notEqual(first, second); assert.notEqual(first.parameters, second.parameters); first.parameters.push('caller edit'); assert.ok(!second.parameters.includes('caller edit'));
	}
	const calls: unknown[] = []; const runtime = { track: { setRate(value: unknown) { calls.push(value); } } };
	const first = resolveAudacityActionHandler(`${rate}44100`, runtime); const second = resolveAudacityActionHandler(`${rate}44100`, runtime);
	assert.ok(first && second); assert.notEqual(first, second); first(); second(); assert.deepEqual([...calls], [44100, 44100]);
	assert.equal(resolveAudacityActionHandler(`${rate}%`, runtime), null);
	assert.equal(resolveAudacityActionHandler(`${rate}44100`, { track: Object.create(runtime.track) }), null);
	runtime.track.setRate = (value) => { calls.push(['replacement', value]); }; resolveAudacityActionHandler(`${rate}44100`, runtime)!();
	assert.deepEqual(calls.at(-1), ['replacement', 44100]);
	const input = [{ id: 'local-container', items: [{ id: `${rate}44100`, label: '44.1 kHz' }] }];
	const menus = applyAudacityParityToMenus(input); const next = applyAudacityParityToMenus(input);
	assert.notEqual(menus, next); assert.notEqual(menus[0], next[0]); assert.notEqual(menus[0].items, next[0].items);
	menus[0].items.push({ id: 'caller-item' }); assert.equal(next[0].items.length, 1); assert.equal(input[0]!.items.length, 1);
});
