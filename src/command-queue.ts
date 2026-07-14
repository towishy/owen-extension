export type ExpiringQueueItem = {
	id: string;
	expiresAt: string;
};

export class CommandQueueError extends Error {
	constructor(public readonly code: 'duplicate_command' | 'queue_full', message: string) {
		super(message);
		this.name = 'CommandQueueError';
	}
}

export class ExpiringCommandQueue<T extends ExpiringQueueItem> {
	private readonly items: T[] = [];

	constructor(private maxSize: number) {
		this.setMaxSize(maxSize);
	}

	setMaxSize(maxSize: number) {
		this.maxSize = Math.min(Math.max(Math.trunc(maxSize), 1), 500);
	}

	enqueue(item: T, now = Date.now()) {
		this.pruneExpired(now);
		if (this.items.some(existing => existing.id === item.id)) {
			throw new CommandQueueError('duplicate_command', `Browser command is already queued: ${item.id}`);
		}
		if (this.items.length >= this.maxSize) {
			throw new CommandQueueError('queue_full', `Browser command queue is full (${this.maxSize}).`);
		}
		this.items.push(item);
	}

	take(now = Date.now()) {
		this.pruneExpired(now);
		return this.items.shift();
	}

	remove(id: string) {
		const index = this.items.findIndex(item => item.id === id);
		if (index < 0) {
			return false;
		}
		this.items.splice(index, 1);
		return true;
	}

	pruneExpired(now = Date.now()) {
		const expired: T[] = [];
		for (let index = this.items.length - 1; index >= 0; index -= 1) {
			const expiresAt = Date.parse(this.items[index].expiresAt);
			if (!Number.isFinite(expiresAt) || expiresAt <= now) {
				expired.push(...this.items.splice(index, 1));
			}
		}
		return expired.reverse();
	}

	get length() {
		return this.items.length;
	}
}