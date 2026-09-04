/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useRef, useState } from 'react';

import { macroScriptIsRunnable } from '../../macro-script-library.ts';
import MacroScriptEditor from './MacroScriptEditor.jsx';

/**
 * One macro program: the editor, the run, and what the run said.
 *
 * The run state lives here rather than in the manager so the manager stays a
 * list and a detail pane, and so a program's log is discarded with the program
 * rather than outliving it.
 */
export default function MacroScriptPanel({ controller, copy, script, blocked, onChange }) {
	// A program the user wrote here is theirs. One that arrived from a file has
	// no Run button until somebody has read it and said so, and the permission
	// they give names the exact text they read.
	const runnable = macroScriptIsRunnable(script);
	const [log, setLog] = useState([]);
	const [failure, setFailure] = useState(null);
	const [running, setRunning] = useState(false);
	// A run that logged nothing still ran. Inferring completion from the log
	// would leave a silent program indistinguishable from one nobody started.
	const [completed, setCompleted] = useState(false);
	const runRef = useRef(null);

	const run = useCallback(async () => {
		if (runRef.current) return;
		const operation = Symbol('macro-script-run');
		runRef.current = operation;
		setLog([]);
		setFailure(null);
		setCompleted(false);
		setRunning(true);
		try {
			const result = await controller.actions.macros.runScript({
				name: script.name,
				source: script.source,
			});
			if (runRef.current !== operation) return;
			// The last line is the editor's, not the program's: a run that printed
			// nothing must still say it finished, or the live region announces
			// nothing at all to somebody who cannot see the button change back.
			setLog([...(result?.log ?? []), { level: 'info', text: copy.programApplied, at: 0 }]);
			setCompleted(true);
		} catch (cause) {
			if (runRef.current !== operation) return;
			setFailure({
				message: cause instanceof Error ? cause.message : String(cause),
				line: typeof cause?.line === 'number' ? cause.line : null,
			});
		} finally {
			if (runRef.current === operation) {
				runRef.current = null;
				setRunning(false);
			}
		}
	}, [controller, copy.programApplied, script.name, script.source]);

	return (
		<MacroScriptEditor
			copy={copy}
			script={script}
			log={log}
			failure={failure}
			running={running}
			completed={completed}
			blocked={blocked}
			runnable={runnable}
			onChange={onChange}
			onRun={() => { void run(); }}
			onTrust={() => controller.actions.macros.scripts.trust(script.id)}
			onCancel={() => controller.actions.macros.cancel()}
		/>
	);
}
