/* SPDX-License-Identifier: AGPL-3.0-only */

export async function runScapeOpenRendererSmoke(scope, plan) {
	const document = scope?.document;
	if (!document || typeof document.querySelectorAll !== 'function'
		|| typeof scope?.setTimeout !== 'function') {
		throw new Error('Packaged Scape-open renderer environment is incomplete');
	}
	if (!plan || plan.schemaVersion !== 1 || plan.mode !== 'scape-range-open-v1'
		|| plan.productId !== 'soundscaper' || !/^[a-f\d]{32}$/u.test(plan.token)
		|| !plan.archive || !plan.project) {
		throw new TypeError('Packaged Scape-open plan is invalid');
	}
	const now = () => scope.Date?.now?.() ?? Date.now();
	const delay = (milliseconds) => new Promise((resolve) => scope.setTimeout(resolve, milliseconds));
	const deadline = now() + 45_000;
	let chooserAnswers = 0;
	while (true) {
		// A fresh smoke profile is a first launch, so the workspace chooser opens
		// over the editor as a dialog of its own. Answering it with the default
		// workspace is what the other packaged smokes do; the answer needs a
		// render turn to take the dialog down, so the scan below waits for the
		// next pass, and a chooser that will not go is reported by name.
		const chooser = document.querySelectorAll('[data-workspace-onboarding-option="modern"]')[0];
		if (chooser && chooserAnswers < 40) {
			chooserAnswers += 1;
			chooser.click?.();
			await delay(25);
			continue;
		}
		const alerts = document.querySelectorAll('[role="alert"], [role="alertdialog"]');
		const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
		if (alerts.length || dialogs.length) {
			// Name what was exposed: a first-launch chooser and a stale-build prompt
			// are both dialogs, and a bare "exposed a dialog" tells them apart only
			// after a second packaged run.
			const exposed = [...alerts, ...dialogs].slice(0, 3).map((element) => {
				const role = element.getAttribute?.('role') ?? 'dialog';
				const label = element.getAttribute?.('aria-label')
					|| element.querySelector?.('h1, h2, h3, [role="heading"]')?.textContent
					|| element.textContent
					|| '';
				return `${role}: ${String(label).replace(/\s+/gu, ' ').trim().slice(0, 120)}`;
			});
			throw new Error(`Packaged Scape-open UI exposed an alert or dialog (${exposed.join('; ')})`);
		}
		const roots = document.querySelectorAll('[data-audio-editor][data-audio-editor-bound="true"]');
		if (roots.length === 1) {
			const root = roots[0];
			const escape = scope.CSS?.escape;
			if (typeof escape !== 'function') throw new Error('Packaged Scape-open selector escaping is unavailable');
			const trackSelector = `[data-track-row][data-track-id="${escape(plan.project.trackId)}"]`;
			const clipSelector = `[data-clip-id="${escape(plan.project.clipId)}"]`;
			const tabs = root.querySelectorAll('.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]');
			const tracks = root.querySelectorAll(trackSelector);
			const clips = tracks.length === 1 ? tracks[0].querySelectorAll(clipSelector) : [];
			const statuses = root.querySelectorAll('[data-editor-status][data-state="success"]');
			if (root.getAttribute('data-project-id') === plan.project.id
				&& root.getAttribute('data-track-count') === '1'
				&& root.getAttribute('data-clip-count') === '1'
				&& tabs.length === 1 && tabs[0].textContent.trim() === plan.project.title
				&& tracks.length === 1 && clips.length === 1
				&& statuses.length === 1 && statuses[0].textContent.trim()) {
				return {
					projectId: plan.project.id,
					trackCount: 1,
					clipCount: 1,
					activeTabTitle: plan.project.title,
					trackId: plan.project.trackId,
					clipId: plan.project.clipId,
					statusState: 'success',
					alertCount: 0,
					dialogCount: 0,
				};
			}
		}
		if (now() >= deadline) throw new Error('Packaged Scape-open smoke timed out waiting for project-open UI');
		await delay(25);
	}
}
