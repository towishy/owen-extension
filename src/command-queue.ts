export type ExpiringQueueItem = {
	id: string;
	expiresAt: string;
};

export type CommandLease<T> = {
	item: T;
	ownerId: string;
	leasedUntil: number;
	deliveryAttempt: number;
};

export class CommandQueueError extends Error {
	constructor(public readonly code: 'duplicate_command' | 'queue_full', message: string) {
		super(message);
		this.name = 'CommandQueueError';
	}
}

export class ExpiringCommandQueue<T extends ExpiringQueueItem> {
	private readonly items: T[] = [];
	private readonly leases = new Map<string, { ownerId: string; leasedUntil: number }>();
	private readonly deliveryAttempts = new Map<string, number>();

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
		const item = this.items.shift();
		if (item) {
			this.leases.delete(item.id);
			this.deliveryAttempts.delete(item.id);
		}
		return item;
	}

	lease(ownerId: string, leaseMs: number, now = Date.now(), accepts: (item: T) => boolean = () => true): CommandLease<T> | undefined {
		this.pruneExpired(now);
		for (const item of this.items) {
			if (!accepts(item)) {
				continue;
			}
			const current = this.leases.get(item.id);
			if (current && current.leasedUntil > now) {
				continue;
			}
			const leasedUntil = now + Math.max(Math.trunc(leaseMs), 1000);
			const deliveryAttempt = (this.deliveryAttempts.get(item.id) ?? 0) + 1;
			this.leases.set(item.id, { ownerId, leasedUntil });
			this.deliveryAttempts.set(item.id, deliveryAttempt);
			return { item, ownerId, leasedUntil, deliveryAttempt };
		}
		return undefined;
	}

	acknowledge(id: string, ownerId: string, leaseMs: number, now = Date.now()) {
		const lease = this.leases.get(id);
		if (!lease || lease.ownerId !== ownerId || !this.items.some(item => item.id === id)) {
			return false;
		}
		lease.leasedUntil = now + Math.max(Math.trunc(leaseMs), 1000);
		return true;
	}

	isLeaseOwner(id: string, ownerId: string) {
		return this.leases.get(id)?.ownerId === ownerId && this.items.some(item => item.id === id);
	}

	complete(id: string, ownerId?: string) {
		const lease = this.leases.get(id);
		if (ownerId && lease?.ownerId !== ownerId) {
			return false;
		}
		return this.remove(id);
	}

	remove(id: string) {
		const index = this.items.findIndex(item => item.id === id);
		if (index < 0) {
			return false;
		}
		this.items.splice(index, 1);
		this.leases.delete(id);
		this.deliveryAttempts.delete(id);
		return true;
	}

	pruneExpired(now = Date.now()) {
		const expired: T[] = [];
		for (let index = this.items.length - 1; index >= 0; index -= 1) {
			const expiresAt = Date.parse(this.items[index].expiresAt);
			if (!Number.isFinite(expiresAt) || expiresAt <= now) {
				const [item] = this.items.splice(index, 1);
				expired.push(item);
				this.leases.delete(item.id);
				this.deliveryAttempts.delete(item.id);
			}
		}
		return expired.reverse();
	}

	get length() {
		return this.items.length;
	}

	get leasedCount() {
		return [...this.leases.values()].filter(lease => lease.leasedUntil > Date.now()).length;
	}
}