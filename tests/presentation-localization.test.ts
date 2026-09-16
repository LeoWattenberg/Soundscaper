/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPresentationLocalization, publishedCopyFor, selectPresentationCopy } from '../src/common/editor/controller/shared/presentation-localization.ts';
import { createLocalizedError, localizedErrorMessage, setLocalizedStatus } from '../src/common/i18n/presentation-message.ts';
import { createControllerPresentationState } from '../src/common/editor/controller/composition/presentation-state.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';

const english = { ready: 'Ready', done: 'Done', count: '{count} results', genericError: 'Failed: {message}', unknownError: 'Unknown error' };
const french = { ...english, ready: 'Prêt', done: 'Terminé', count: '{count} résultats' };

test('preview has stable service getters and new immutable snapshots while retaining published defaults', () => {
	const session = createPresentationLocalization({ locale: 'fr', publishedCopy: french, englishCopy: english });
	const original = session.port.getSnapshot();
	const scoped = selectPresentationCopy(session.copy, ['ready', 'done']);
	let notifications = 0;
	const unsubscribe = session.port.subscribe(() => { notifications += 1; });
	session.port.applyPreview('de', { ready: 'Bereit', count: '{count} Ergebnisse' });
	assert.equal(session.copy.ready, 'Bereit');
	assert.equal(scoped.ready, 'Bereit');
	assert.equal(publishedCopyFor(session.copy).ready, 'Prêt');
	assert.equal(publishedCopyFor(scoped).ready, 'Prêt');
	assert.equal(session.port.getSnapshot().copy.count, '{count} Ergebnisse');
	assert.equal(original.copy.ready, 'Prêt');
	assert.ok(Object.isFrozen(session.copy));
	assert.ok(Object.isFrozen(session.port.getSnapshot().copy));
	assert.equal(notifications, 1);
	session.port.resetPreview();
	assert.equal(session.copy.ready, 'Prêt');
	assert.equal(session.port.getSnapshot().locale, 'fr');
	unsubscribe();
	unsubscribe();
	session.dispose();
	session.dispose();
	assert.throws(() => session.port.applyPreview('fr', { done: 'Fini' }), /disposed/u);
});

test('invalid templates, unknown keys and unpublished locales cannot enter a preview', () => {
	const session = createPresentationLocalization({ locale: 'fr', publishedCopy: french, englishCopy: english });
	const invalid: readonly Readonly<Record<string, string>>[] = [{ count: 'résultats' }, { done: 'Fini…' }, { missing: 'x' }];
	for (const copy of invalid) {
		assert.throws(() => session.port.applyPreview('fr', copy));
	}
	assert.throws(() => session.port.applyPreview('xx', { done: 'x' }));
	assert.throws(() => session.port.applyPreview('en', { done: 'x' }));
	assert.equal(session.port.getSnapshot().revision, 0);
	assert.equal(publishedCopyFor(english), english);
	session.dispose();
});

test('bundled executable input is kept separately from previewable copy', () => {
	const copy = { ...english, nyquistPromptDefault: '(print "program")' };
	const session = createPresentationLocalization({ locale: 'de', publishedCopy: { ...copy, nyquistPromptDefault: '(print "Programm")' }, englishCopy: copy });
	session.port.applyPreview('fr', { ready: 'Prêt', nyquistPromptDefault: '(print "Programm")' });
	assert.equal(session.copy.nyquistPromptDefault, '(print "Programm")');
	assert.throws(() => session.port.applyPreview('fr', { nyquistPromptDefault: '(print "draft")' }));
	session.dispose();
});

test('existing status and active task templates update and reset without changing task progress', () => {
	const session = createPresentationLocalization({ locale: 'fr', publishedCopy: french, englishCopy: english });
	const state = {
		status: { message: french.ready, state: 'info' }, exportProgress: 0,
		analysisResult: null as unknown, analysisVisuals: null as unknown, analysisReport: null as unknown,
		localDiagnostics: { record: () => {} },
	};
	const presentation = createControllerPresentationState({ state, copy: session.copy, formatMessage: session.formatMessage, publishDocument: () => {}, publishTelemetry: () => {}, updateTaskProgress: () => {} });
	const progress = createEditorTaskProgressCoordinator({ formatMessage: session.formatMessage });
	const task = progress.begin('analysis', french.count.replace('{count}', '3'), 0.4, { key: 'count', parameters: { count: 3 } });
	setLocalizedStatus(presentation.setStatus, session.copy, 'count', { count: 3 }, 'success');
	session.port.subscribe(() => { presentation.refreshLocalization(session.formatMessage); progress.refreshLocalization(); });
	session.port.applyPreview('de', { count: '{count} Ergebnisse' });
	assert.equal(state.status.message, '3 Ergebnisse');
	assert.equal(state.status.state, 'success');
	assert.equal(progress.getSnapshot()?.label, '3 Ergebnisse');
	assert.equal(progress.getSnapshot()?.value, 0.4);
	assert.equal(progress.getSnapshot()?.id, task.id);
	// A producer may retain its original formatted prefix while work is running.
	presentation.setStatus('3 résultats', 'success', { key: 'count', parameters: { count: 3 } });
	task.setPhase('3 résultats', { value: 0.6 }, { key: 'count', parameters: { count: 3 } });
	assert.equal(state.status.message, '3 Ergebnisse');
	assert.equal(progress.getSnapshot()?.label, '3 Ergebnisse');
	session.port.resetPreview();
	assert.equal(state.status.message, '3 résultats');
	assert.equal(progress.getSnapshot()?.label, '3 résultats');
	task.finish();
	session.dispose();
});

test('application errors retain their message template inside the generic error status', () => {
	const session = createPresentationLocalization({ locale: 'fr', publishedCopy: french, englishCopy: english });
	const state = {
		status: { message: french.ready, state: 'info' }, exportProgress: 0,
		analysisResult: null as unknown, analysisVisuals: null as unknown, analysisReport: null as unknown,
		localDiagnostics: { record: () => {} },
	};
	const presentation = createControllerPresentationState({ state, copy: session.copy, publishDocument: () => {}, publishTelemetry: () => {}, updateTaskProgress: () => {} });
	const failure = createLocalizedError(RangeError, session.copy, 'count', { count: '$&' });
	assert.ok(failure instanceof RangeError);
	assert.equal(failure.message, '$& résultats');
	presentation.handleError(failure);
	session.port.applyPreview('de', { count: '{count} Ergebnisse' });
	presentation.refreshLocalization(session.formatMessage);
	assert.equal(state.status.message, 'Failed: $& Ergebnisse');
	session.dispose();
});

test('retained templates detach nested parameters from mutable producer inputs', () => {
	const session = createPresentationLocalization({ locale: 'fr', publishedCopy: french, englishCopy: english });
	const nested = { key: 'done' };
	const parameters = { count: 3 };
	const message = { key: 'count', parameters, append: [' / ', nested] };
	const progress = createEditorTaskProgressCoordinator({ formatMessage: session.formatMessage });
	const task = progress.begin('analysis', 'original', 0.4, message);
	const error = createLocalizedError(Error, session.copy, 'genericError', { message: nested });
	parameters.count = 99;
	nested.key = 'ready';
	message.append.push(' changed');
	session.port.applyPreview('de', { count: '{count} Ergebnisse', done: 'Fertig' });
	progress.refreshLocalization();
	assert.equal(progress.getSnapshot()?.label, '3 Ergebnisse / Fertig');
	assert.ok(Object.isFrozen(progress.getSnapshot()?.localization?.parameters));
	assert.ok(Object.isFrozen(progress.getSnapshot()?.localization?.append));
	assert.equal(session.formatMessage(localizedErrorMessage(error)!), 'Failed: Fertig');
	const caused = Object.assign(error, { cause: new Error('decoder detail') });
	assert.equal(localizedErrorMessage(caused), undefined);
	assert.equal(localizedErrorMessage(new AggregateError([], 'external')), undefined);
	assert.equal(localizedErrorMessage('external'), undefined);
	task.finish();
	session.dispose();
});
