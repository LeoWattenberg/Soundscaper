/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned reservation layer for helper-authenticated top-level vendor windows. */
export function registerPluginVendorWindowHost({ launch, helper, hosts, realtime }) {
	const vendorWindows = new Map();
	hosts.set(launch.hostId, Object.freeze({ supervisor: helper.supervisor, vendorWindows }));
	return Object.freeze({
		kill: () => {
			vendorWindows.clear();
			hosts.delete(launch.hostId);
			helper.supervisor.dispose();
		},
		openVendorUi: ({ instanceId, windowHandleId }) => {
			const entry = realtime.get(instanceId);
			if (!entry) throw new Error('The isolated real-time plug-in session is unavailable.');
			const capability = entry.session.vendorWindowCapability(windowHandleId);
			vendorWindows.set(capability, instanceId);
			return capability;
		},
		closeVendorUi: (windowHandleId) => { vendorWindows.delete(windowHandleId); },
	});
}
