/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import {
	changeFile,
	changeText,
	click,
	deferred,
	macroSnapshot,
	mountedMacroManagerFixture,
	SERIALIZED_NOISE_PROFILE,
} from './helpers/macro-manager-fixture.tsx';

const MANAGER_COPY = resolveMacroManagerCopy('en');

test('every built-in template is offered, including the one that moves the selection', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		assert.equal(fixture.buttonLabels().includes('Restoration'), true);
		assert.equal(fixture.buttonLabels().includes('Fade ends'), true);

		await click(fixture.button('Fade ends'));
		// A command step is named by the command it runs and what it carries; a
		// blank row would say nothing at all.
		assert.deepEqual(fixture.effectNames(), [
			'Select: start 0, end 1',
			'Fade In',
			'Select: start 0, end 1, relativeTo project-end',
			'Fade Out',
			'Select: start 0, end 0',
		]);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a running macro offers a cancel that stops it and says so', async () => {
	// Before this the manager had no way to stop a macro at all; a long chain ran
	// to the end or the user switched project.
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		assert.equal(fixture.buttonLabels().includes(MANAGER_COPY.cancelRun), false,
			'nothing to cancel before a run starts');

		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.buttonLabels().includes(MANAGER_COPY.cancelRun), true,
			'a running macro must offer a cancel');

		await click(fixture.button(MANAGER_COPY.cancelRun));
		assert.equal(fixture.cancels(), 1);
		assert.equal(fixture.message(), MANAGER_COPY.runCancelled);
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), false,
			'a cancelled run releases the manager');
		assert.equal(fixture.buttonLabels().includes(MANAGER_COPY.cancelRun), false);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a project switch retires an in-flight macro run before the next project can run', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.runs.length, 1);
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);

		await fixture.render(macroSnapshot('project-b'));
		assert.equal(
			fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'),
			false,
			'project A must not retain project B\'s run admission',
		);
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.deepEqual(fixture.runs.map(({ projectId }) => projectId), ['project-a', 'project-b']);

		await act(async () => {
			fixture.runs[0]!.settlement.reject(new Error('project A was replaced'));
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
		assert.equal(fixture.message(), ENGLISH_COPY.macroProcessing);

		await act(async () => {
			fixture.runs[1]!.settlement.resolve(true);
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), false);
		assert.equal(fixture.message(), ENGLISH_COPY.macroApplied);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a macro import started for a replaced project cannot overwrite the surviving draft', async () => {
	const fixture = await mountedMacroManagerFixture();
	const importedText = deferred<string>();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await changeFile(fixture.importInput(), {
			name: 'project-a-chain.txt',
			size: 42,
			text: () => importedText.promise,
		} as File);

		await fixture.render(macroSnapshot('project-b'));
		await changeText(fixture.nameInput(), 'Project B chain');
		await act(async () => {
			importedText.resolve('Echo:Delay="0.4" Decay="0.5"\n');
			await importedText.promise;
			await Promise.resolve();
		});

		assert.equal(fixture.nameInput().value, 'Project B chain');
		assert.deepEqual(fixture.effectNames(), ['Invert']);
		assert.equal(fixture.message(), '');
		assert.deepEqual(fixture.macroNames(), ['Project B chain'], 'the stale import must not save a macro');
	} finally {
		importedText.resolve('Invert:\n');
		await fixture.cleanup();
	}
});

test('a stale macro export cannot replace the current project completion message', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(ENGLISH_COPY.exportMacro));
		assert.equal(fixture.exports.length, 1);

		await fixture.render(macroSnapshot('project-b'));
		await click(fixture.button(ENGLISH_COPY.exportMacro));
		assert.equal(fixture.exports.length, 2);
		await act(async () => {
			fixture.exports[1]!.settlement.resolve({ cancelled: false });
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.message(), ENGLISH_COPY.macroExported);

		await act(async () => {
			fixture.exports[0]!.settlement.reject(new Error('project A destination failed'));
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.message(), ENGLISH_COPY.macroExported);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('the Restoration template saves a macro of its own, embeds its captured profile, and only then admits Run', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		assert.deepEqual(fixture.macroNames(), ['Portable chain', 'Restoration']);
		assert.equal(fixture.selectedMacroName(), 'Restoration');
		assert.deepEqual(fixture.effectNames(), ['Click Removal', 'Noise Reduction', 'Filter Curve EQ']);
		assert.deepEqual(
			fixture.library()[0]!.effects.map(({ type }) => type),
			['audacity-invert'],
			'the template must not reach into the macro that was open',
		);
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
		assert.match(fixture.text(), /Capture a noise profile in every Noise Reduction step/u);

		await click(fixture.selectEffect('Noise Reduction'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));
		assert.equal(fixture.profileCaptures(), 1);
		assert.deepEqual(fixture.profileParams(), [{
			reductionDb: 6, sensitivity: 6, frequencySmoothingBands: 6, output: 'reduce',
		}]);
		assert.ok(fixture.button(ENGLISH_COPY.replaceNoiseProfile));
		await click(fixture.button('Close'));
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), false);

		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.runs.length, 1);
		const effects = fixture.runs[0]!.macro.effects as Array<Readonly<{
			type: string;
			context?: Readonly<{ noiseProfile?: unknown }>;
		}>>;
		assert.equal(effects[1]?.type, 'audacity-noise-reduction');
		assert.deepEqual(effects[1]?.context?.noiseProfile, SERIALIZED_NOISE_PROFILE);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('the macro list creates, renames, selects, and deletes saved macros', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		assert.deepEqual(fixture.macroNames(), ['Portable chain']);

		await click(fixture.button(ENGLISH_COPY.newMacro));
		assert.deepEqual(fixture.macroNames(), ['Portable chain', ENGLISH_COPY.untitledMacro]);
		assert.deepEqual(fixture.effectNames(), []);

		await changeText(fixture.nameInput(), 'Second chain');
		assert.deepEqual(fixture.macroNames(), ['Portable chain', 'Second chain']);
		assert.deepEqual(fixture.library().map(({ name }) => name), ['Portable chain', 'Second chain']);

		await click(fixture.macro('Portable chain'));
		assert.equal(fixture.selectedMacroName(), 'Portable chain');
		assert.deepEqual(fixture.effectNames(), ['Invert']);

		await click(fixture.button(ENGLISH_COPY.deleteMacro));
		assert.deepEqual(fixture.macroNames(), ['Second chain']);
		assert.equal(fixture.selectedMacroName(), 'Second chain');
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('an emptied library leaves nothing to edit and takes the manager back to its own hint', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(ENGLISH_COPY.deleteMacro));

		assert.deepEqual(fixture.macroNames(), []);
		assert.ok(fixture.find('[data-macro-library-empty]'));
		assert.ok(fixture.find('[data-macro-unselected]'));
		assert.equal(fixture.find('[data-macro-steps]'), null);
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('Add effect sits after the last step and opens the rack flyout rather than a dialog', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		const steps = fixture.find('[data-macro-steps]');
		assert.ok(steps);
		const rows = steps.childNodes.filter((node) => node.nodeType === 1);
		assert.equal(rows.at(-1), fixture.addEffect(), 'Add effect must follow the step stack.');

		await click(fixture.addEffect());
		assert.equal(fixture.find('[data-effect-picker]'), null, 'the picker must not open as a dialog');
		const flyout = fixture.find('.audio-editor-effect-picker-flyout__grid');
		assert.ok(flyout, 'the picker must open as the flyout the realtime rack uses');

		await click(fixture.menuItem('Echo'));
		assert.deepEqual(fixture.effectNames(), ['Invert', 'Echo']);
		assert.deepEqual(
			fixture.library()[0]!.effects.map(({ type }) => type),
			['audacity-invert', 'audacity-echo'],
			'the added step must reach the saved macro',
		);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('the picker offers the offline effects a macro runs, not only the rack', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.addEffect());
		const offered = fixture.menuItems();
		assert.ok(offered.includes('Compressor'), 'the realtime rack effects stay on offer');
		for (const name of ['Amplify', 'Normalize', 'Fade In', 'Change Pitch', 'Truncate Silence']) {
			assert.ok(offered.includes(name), `${name} must be offered as a macro step`);
		}

		await click(fixture.menuItem('Normalize'));
		assert.deepEqual(fixture.effectNames(), ['Invert', 'Normalize']);
		assert.deepEqual(
			fixture.library()[0]!.effects.map(({ type }) => type),
			['audacity-invert', 'audacity-normalize'],
			'an offline step must reach the saved macro',
		);

		await click(fixture.selectEffect('Normalize'));
		assert.match(fixture.text(), /Peak amplitude/u, 'an offline step opens its own settings');
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a failed Restoration profile capture stays gated and reports the failure in the dialog', async () => {
	const fixture = await mountedMacroManagerFixture({ id: 'macro-initial', name: ENGLISH_COPY.untitledMacro, effects: [] });
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		await click(fixture.selectEffect('Noise Reduction'));
		fixture.failNextProfileCapture(new Error('profile worker unavailable'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));

		assert.match(fixture.message(), /profile worker unavailable/u);
		await click(fixture.button('Close'));
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('Restoration profile recapture replaces the embedded portable profile', async () => {
	const fixture = await mountedMacroManagerFixture({ id: 'macro-initial', name: ENGLISH_COPY.untitledMacro, effects: [] });
	const replacement = Object.freeze({ ...SERIALIZED_NOISE_PROFILE, windowCount: 3 });
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		await click(fixture.selectEffect('Noise Reduction'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));
		fixture.queueProfileResponse(Promise.resolve(replacement));
		await click(fixture.button(ENGLISH_COPY.replaceNoiseProfile));
		await click(fixture.button('Close'));
		await click(fixture.button(ENGLISH_COPY.runMacro));

		const effects = fixture.runs[0]!.macro.effects as Array<Readonly<{
			context?: Readonly<{ noiseProfile?: unknown }>;
		}>>;
		assert.deepEqual(effects[1]?.context?.noiseProfile, replacement);
		assert.equal(fixture.profileCaptures(), 2);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a stale Restoration recapture cannot replace the surviving embedded profile', async () => {
	const fixture = await mountedMacroManagerFixture({ id: 'macro-initial', name: ENGLISH_COPY.untitledMacro, effects: [] });
	const pending = deferred<unknown>();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		await click(fixture.selectEffect('Noise Reduction'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));
		fixture.queueProfileResponse(pending.promise);
		await click(fixture.button(ENGLISH_COPY.replaceNoiseProfile));
		await fixture.render(macroSnapshot('project-b'));
		await act(async () => {
			pending.resolve({ ...SERIALIZED_NOISE_PROFILE, windowCount: 99 });
			await pending.promise;
			await Promise.resolve();
		});
		await click(fixture.button('Close'));
		await click(fixture.button(ENGLISH_COPY.runMacro));

		const effects = fixture.runs[0]!.macro.effects as Array<Readonly<{
			context?: Readonly<{ noiseProfile?: unknown }>;
		}>>;
		assert.deepEqual(effects[1]?.context?.noiseProfile, SERIALIZED_NOISE_PROFILE);
	} finally {
		pending.resolve(SERIALIZED_NOISE_PROFILE);
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('Framescaper keeps its shared Macro Manager unchanged', async () => {
	const fixture = await mountedMacroManagerFixture(undefined, 'framescaper');
	try {
		await fixture.render(macroSnapshot('project-a'));
		assert.equal(fixture.find('[data-macro-templates]'), null);
		assert.doesNotMatch(fixture.text(), /Restoration/u);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});
