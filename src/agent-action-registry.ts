import type { AgentBrowserAction, AgentBrowserResult } from './agent-runner';

export type AgentActionCapability = 'browser-read' | 'browser-write' | 'evidence';
export type AgentActionRisk = 'low' | 'sensitive' | 'destructive';

export type AgentActionExecutionContext = {
	executeBuiltIn(action: AgentBrowserAction): Promise<AgentBrowserResult>;
};

export type AgentActionPlugin = {
	name: `custom.${string}`;
	description: string;
	capability: AgentActionCapability;
	risk: AgentActionRisk;
	handler(input: AgentBrowserAction, context: AgentActionExecutionContext): Promise<AgentBrowserResult>;
};

export class AgentActionPluginRegistry {
	private readonly plugins = new Map<string, AgentActionPlugin>();

	register(plugin: AgentActionPlugin) {
		validatePlugin(plugin);
		if (this.plugins.has(plugin.name)) {
			throw new Error(`Browser Agent custom action is already registered: ${plugin.name}`);
		}
		this.plugins.set(plugin.name, plugin);
		return {
			dispose: () => {
				if (this.plugins.get(plugin.name) === plugin) {
					this.plugins.delete(plugin.name);
				}
			}
		};
	}

	get(name: string) {
		return this.plugins.get(name);
	}

	listAutonomous() {
		return [...this.plugins.values()].filter(plugin => plugin.risk !== 'destructive');
	}
}

function validatePlugin(plugin: AgentActionPlugin) {
	if (!/^custom\.[a-z][a-z0-9.-]{2,63}$/.test(plugin.name)) {
		throw new Error('Custom action name must match custom.<lowercase-name> and contain 3-64 characters after the prefix.');
	}
	if (!plugin.description.trim() || plugin.description.length > 300) {
		throw new Error('Custom action description must contain 1-300 characters.');
	}
	if (plugin.capability === 'browser-write' && plugin.risk === 'low') {
		throw new Error('browser-write custom actions must be sensitive or destructive.');
	}
	if (typeof plugin.handler !== 'function') {
		throw new Error('Custom action handler must be a function.');
	}
}
