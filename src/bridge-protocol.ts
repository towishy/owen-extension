export const BRIDGE_PROTOCOL_VERSION = '3.0';

export type BrowserAgentHeartbeat = {
	id: string;
	browserName?: string;
	browserVersion?: string;
	protocolVersion: string;
};

export type BrowserAgentState = BrowserAgentHeartbeat & {
	firstSeenAt: string;
	lastSeenAt: string;
};

export class BrowserAgentRegistry {
	private readonly agents = new Map<string, BrowserAgentState>();

	touch(heartbeat: BrowserAgentHeartbeat, now = Date.now()) {
		const timestamp = new Date(now).toISOString();
		const existing = this.agents.get(heartbeat.id);
		const state: BrowserAgentState = {
			...heartbeat,
			firstSeenAt: existing?.firstSeenAt ?? timestamp,
			lastSeenAt: timestamp
		};
		this.agents.set(heartbeat.id, state);
		return state;
	}

	listActive(maxAgeMs = 60000, now = Date.now()) {
		return [...this.agents.values()]
			.filter(agent => now - Date.parse(agent.lastSeenAt) <= maxAgeMs)
			.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
	}

	resolveTarget(requestedAgentId: string | undefined, preferredAgentId: string | undefined, now = Date.now()) {
		const active = this.listActive(60000, now);
		if (requestedAgentId) {
			if (active.some(agent => agent.id === requestedAgentId)) {
				return requestedAgentId;
			}
			throw new Error(`Requested browser agent is not active: ${requestedAgentId}`);
		}
		if (preferredAgentId && active.some(agent => agent.id === preferredAgentId)) {
			return preferredAgentId;
		}
		if (active.length === 1) {
			return active[0].id;
		}
		if (active.length > 1) {
			throw new Error(`Multiple browser agents are active (${active.map(agent => agent.id).join(', ')}). Set targetAgentId or owenBrowserBridge.preferredAgentId.`);
		}
		return undefined;
	}
}

export function requireCompatibleProtocol(received: string | null | undefined) {
	if (received !== BRIDGE_PROTOCOL_VERSION) {
		throw new Error(`Browser bridge protocol mismatch. Expected ${BRIDGE_PROTOCOL_VERSION}, received ${received || 'missing'}.`);
	}
}
