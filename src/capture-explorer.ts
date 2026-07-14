import * as vscode from 'vscode';

export type CaptureExplorerEntry = {
	id: string;
	host: string;
	groupName: string;
	markdownPath: string;
	jsonPath: string;
	screenshotPath?: string;
	integrityPath?: string;
	collectedAt: string;
	title?: string;
	url?: string;
};

type CaptureTreeNode =
	| { kind: 'host'; host: string; captures: CaptureExplorerEntry[] }
	| { kind: 'group'; host: string; groupName: string; captures: CaptureExplorerEntry[] }
	| { kind: 'capture'; capture: CaptureExplorerEntry };

export class BrowserCapturesTreeProvider implements vscode.TreeDataProvider<CaptureTreeNode> {
	private readonly changed = new vscode.EventEmitter<CaptureTreeNode | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly loadCaptures: () => Promise<CaptureExplorerEntry[]>) {}

	refresh() {
		this.changed.fire(undefined);
	}

	getTreeItem(element: CaptureTreeNode) {
		if (element.kind === 'host') {
			const item = new vscode.TreeItem(element.host, vscode.TreeItemCollapsibleState.Collapsed);
			item.description = `${element.captures.length} capture(s)`;
			item.iconPath = new vscode.ThemeIcon('globe');
			item.contextValue = 'browserCaptureHost';
			return item;
		}
		if (element.kind === 'group') {
			const item = new vscode.TreeItem(element.groupName, vscode.TreeItemCollapsibleState.Collapsed);
			item.description = `${element.captures.length}`;
			item.iconPath = new vscode.ThemeIcon('folder');
			item.contextValue = 'browserCaptureGroup';
			return item;
		}
		const capture = element.capture;
		const item = new vscode.TreeItem(capture.title || capture.url || capture.id, vscode.TreeItemCollapsibleState.None);
		item.description = capture.collectedAt;
		item.tooltip = `${capture.host}/${capture.groupName}\n${capture.url || capture.id}`;
		item.iconPath = new vscode.ThemeIcon(capture.screenshotPath ? 'file-media' : 'file-text');
		item.contextValue = 'browserCapture';
		item.command = {
			command: 'owen-browser-bridge.openCapture',
			title: 'Open Browser Capture',
			arguments: [capture]
		};
		return item;
	}

	async getChildren(element?: CaptureTreeNode): Promise<CaptureTreeNode[]> {
		if (!element) {
			const captures = await this.loadCaptures();
			const byHost = new Map<string, CaptureExplorerEntry[]>();
			for (const capture of captures) {
				byHost.set(capture.host, [...(byHost.get(capture.host) ?? []), capture]);
			}
			return [...byHost.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([host, items]) => ({ kind: 'host', host, captures: items }));
		}
		if (element.kind === 'host') {
			const byGroup = new Map<string, CaptureExplorerEntry[]>();
			for (const capture of element.captures) {
				byGroup.set(capture.groupName, [...(byGroup.get(capture.groupName) ?? []), capture]);
			}
			return [...byGroup.entries()]
				.sort(([, left], [, right]) => right[0].collectedAt.localeCompare(left[0].collectedAt))
				.map(([groupName, captures]) => ({ kind: 'group', host: element.host, groupName, captures }));
		}
		if (element.kind === 'group') {
			return [...element.captures]
				.sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))
				.map(capture => ({ kind: 'capture', capture }));
		}
		return [];
	}
}
