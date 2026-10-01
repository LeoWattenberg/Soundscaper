/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperSoakWorkflowDriver } from '../scripts/lib/soundscaper-soak-workflows.mjs';

test('packaged autosave reopen waits for replacement project activation before opening its menu', async () => {
	const page = new AutosavePage();
	const driver = createSoundscaperSoakWorkflowDriver({
		page, target: 'desktop', outputDirectory: '/tmp/soundscaper-soak-autosave-readiness',
	});

	await driver.execute('autosave-reload');

	assert.equal(page.projectId, page.persistedProjectId);
	assert.equal(page.reopened, true);
	assert.equal(page.activationWaits, 1);
});

class AutosavePage {
	readonly persistedProjectId = 'soak-persisted-project';
	projectId = this.persistedProjectId;
	projectName = 'Soak project';
	activationPending = false;
	activationWaits = 0;
	menuBlocked = false;
	reopened = false;

	locator(selector: string): AutosaveLocator {
		return new AutosaveLocator(this, selector);
	}

	getByRole(role: string, options?: { name: string | RegExp }): AutosaveLocator {
		return new AutosaveLocator(this, roleName(options?.name ?? role, this.projectName));
	}

	waitForTimeout(): Promise<void> {
		assert.equal(this.activationPending, true, 'only pending activation needs a readiness retry');
		this.activationWaits += 1;
		this.activationPending = false;
		return Promise.resolve();
	}
}

class AutosaveLocator {
	constructor(readonly owner: AutosavePage, readonly name: string) {}

	locator(selector: string): AutosaveLocator {
		return this.owner.locator(selector);
	}

	getByRole(role: string, options?: { name: string | RegExp }): AutosaveLocator {
		return this.owner.getByRole(role, options);
	}

	page(): AutosavePage { return this.owner; }
	async waitFor(): Promise<void> {}

	getAttribute(attribute: string): Promise<string | null> {
		const attributes: Record<string, string | null> = {
			'data-audio-editor-bound': 'true',
			'data-project-id': this.owner.projectId,
			'data-track-count': '1',
			'data-clip-count': '1',
			'data-editor-ready': 'true',
			'data-project-activation-pending': this.owner.activationPending ? 'true' : null,
			'data-state': this.name === '[data-status]' ? 'success' : 'saved',
			'aria-disabled': this.owner.menuBlocked ? 'true' : 'false',
		};
		return Promise.resolve(attributes[attribute] ?? null);
	}

	textContent(): Promise<string> {
		assert.equal(this.name, '[data-project-name]');
		return Promise.resolve(this.owner.projectName);
	}

	fill(value: string): Promise<void> {
		assert.equal(this.name, 'Project name');
		this.owner.projectName = value;
		return Promise.resolve();
	}

	press(key: string): Promise<void> {
		assert.equal(this.name, 'Project management');
		assert.equal(key, 'ArrowRight');
		return Promise.resolve();
	}

	click(): Promise<void> {
		switch (this.name) {
			case 'File':
				// Menu commands retain the enablement snapshot taken when File opens.
				this.owner.menuBlocked = this.owner.activationPending;
				break;
			case 'Rename project':
			case 'Save name': break;
			case 'Close project':
				this.owner.projectId = 'replacement-project';
				this.owner.activationPending = true;
				break;
			case 'Local projects':
				assert.equal(this.owner.menuBlocked, false,
					'opening Local projects during replacement activation freezes a disabled menu command');
				break;
			case 'Open persisted project':
				this.owner.projectId = this.owner.persistedProjectId;
				this.owner.reopened = true;
				break;
			default: assert.fail(`Unexpected click on ${this.name}.`);
		}
		return Promise.resolve();
	}
}

function roleName(name: string | RegExp, projectName: string): string {
	if (typeof name === 'string') return name;
	for (const command of ['Project management', 'Rename project', 'Close project', 'Local projects']) {
		if (name.test(command)) return command;
	}
	assert.equal(name.test(projectName), true);
	return 'Open persisted project';
}
