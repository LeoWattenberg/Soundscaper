/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('linked-video compatibility policy qualifies only binding-safe same-store duplication', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-linked-retained-video-original');
	assert.ok(rule);
	assert.match(
		rule.requiredOutcome,
		/same-store project duplicate.*bound reachable references.*complete alias inventory.*fresh pathless aliases.*exact reachable linked-video bindings.*normal project-publication admission.*project and revision rows only when no destination project or revision exists.*determinate failure.*exact creation and alias tokens.*preserving replacements.*Desktop commit recovery.*exact remote equality.*proven remote absence.*indeterminate error.*divergent or unreadable.*no linked, source, or media-body I\/O.*does not claim project-plus-alias atomicity.*crash or restart cleanup.*cross-store, cross-profile, cross-process, or browser-race serialization/iu,
	);
	assert.match(
		rule.currentBehavior,
		/duplicateProject.*serialized.*source first.*Desktop.*canonical shared document.*without resolving media.*catalog check.*source ID.*absent destination ID.*revision 0.*4,094.*100,000-row.*128-unique-reference.*pre-existing destination binding.*storage key, MIME type.*source geometry.*fresh token and timestamp.*neither loads nor releases a locator.*does not read, stage, write, or copy.*bodies.*one IndexedDB readwrite transaction.*separate from project publication.*create-if-absent.*every destination revision.*staged source and media records remain unchanged.*determinate failure.*exact fresh tokens.*replacement prevents.*Desktop local-shadow rollback.*persisted creation fence.*identically republished project.*remote reread.*exact equality as success.*proven absence.*divergent or unreadable.*ProjectDuplicationIndeterminateError.*no durable duplication receipt or restart cleanup.*overlapping browser IndexedDB connections.*unqualified/isu,
	);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/same lifecycle coordinator.*serializes project duplication.*exact canonical shared-document read.*no managed-media resolution.*4,094 references.*no linked body, source body, media body, locator, or playback capability is loaded, released, staged, or copied.*100,000 closed rows.*128 unique exact locator\/revision references.*create-only project repository.*every revision.*determinate later failure.*exact fresh binding tokens.*Desktop local-shadow compensation.*persisted creation fence.*ProjectDuplicationIndeterminateError.*no durable duplication receipt or restart reconciliation.*overlapping browser IndexedDB connections/isu,
	);
});
