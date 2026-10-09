type DurableObjectIdLike = { toString: () => string };

type DurableObjectStorageLike = {
	get: <T = unknown>(key: string) => Promise<T | undefined>;
	put: <T = unknown>(key: string, value: T) => Promise<void>;
};

class NodeDurableObjectStorage implements DurableObjectStorageLike {
	private readonly store = new Map<string, unknown>();

	async get<T = unknown>(key: string): Promise<T | undefined> {
		return this.store.get(key) as T | undefined;
	}

	async put<T = unknown>(key: string, value: T): Promise<void> {
		this.store.set(key, value);
	}
}

class NodeDurableObjectState {
	public readonly id: DurableObjectIdLike;
	public readonly storage: DurableObjectStorageLike;

	constructor(id: string) {
		this.id = { toString: () => id };
		this.storage = new NodeDurableObjectStorage();
	}
}

type DurableObjectInstance = { fetch: (req: Request) => Promise<Response> | Response };

type DurableObjectFactory = (input: { id: string; state: any }) => DurableObjectInstance;

type NodeDurableObjectNamespaceOptions = Readonly<{
	/** 实例数上限（LRU 淘汰），防止每个 execution 永久滞留一份完整执行图。 */
	maxInstances?: number;
	/** 空闲多久后允许驱逐（无任何 namespace.get 触达）。 */
	idleTtlMs?: number;
}>;

// 默认上限：500 个执行实例（每个实例持有最后一次 graph 快照）。空闲 2h 驱逐与
// 进程重启等价——ExecutionDO 在 storage 为空时会从持久化 node facts 恢复（见
// execution.do.ts 的 recoverAfterRestart 路径），因此驱逐不丢权威状态。
const DEFAULT_MAX_INSTANCES = 500;
const DEFAULT_IDLE_TTL_MS = 2 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/** 所有存活 namespace 的注册表（[mem] 周期打点用）。 */
const liveNamespaces = new Set<NodeDurableObjectNamespace>();

export class NodeDurableObjectNamespace {
	private readonly instances = new Map<string, { instance: DurableObjectInstance; lastAccessAt: number }>();
	private readonly factory: DurableObjectFactory;
	private readonly maxInstances: number;
	private readonly idleTtlMs: number;
	private lastSweepAt = 0;
	private lastEvictLogAt = 0;

	constructor(factory: DurableObjectFactory, options: NodeDurableObjectNamespaceOptions = {}) {
		this.factory = factory;
		this.maxInstances = Math.max(1, options.maxInstances ?? DEFAULT_MAX_INSTANCES);
		this.idleTtlMs = Math.max(1, options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS);
		liveNamespaces.add(this);
	}

	idFromName(name: string): DurableObjectIdLike {
		const id = String(name || "").trim();
		return { toString: () => id };
	}

	get(id: DurableObjectIdLike): any {
		const key = id?.toString ? id.toString() : String(id || "");
		this.sweepIfDue();
		const existing = this.instances.get(key);
		if (existing) {
			existing.lastAccessAt = Date.now();
			return new NodeDurableObjectStub(existing.instance);
		}

		const state = new NodeDurableObjectState(key);
		const instance = this.factory({ id: key, state });
		this.instances.set(key, { instance, lastAccessAt: Date.now() });
		this.enforceCapacity();
		return new NodeDurableObjectStub(instance);
	}

	/** 当前缓存实例数（[mem] 周期打点用）。 */
	size(): number {
		return this.instances.size;
	}

	/** 立即执行一次驱逐；返回被驱逐的实例数。测试与诊断用。 */
	sweep(now = Date.now()): number {
		let evictedIdle = 0;
		for (const [key, entry] of this.instances) {
			if (now - entry.lastAccessAt > this.idleTtlMs) {
				this.instances.delete(key);
				evictedIdle += 1;
			}
		}
		let evictedCapacity = 0;
		while (this.instances.size > this.maxInstances) {
			let oldestKey: string | undefined;
			let oldestAt = Number.POSITIVE_INFINITY;
			for (const [key, entry] of this.instances) {
				if (entry.lastAccessAt < oldestAt) {
					oldestAt = entry.lastAccessAt;
					oldestKey = key;
				}
			}
			if (oldestKey === undefined) break;
			this.instances.delete(oldestKey);
			evictedCapacity += 1;
		}
		if (evictedIdle + evictedCapacity > 0 && now - this.lastEvictLogAt > SWEEP_INTERVAL_MS) {
			this.lastEvictLogAt = now;
			console.log(
				`[node-durable] evicted execution DO instances idle=${evictedIdle} capacity=${evictedCapacity} remaining=${this.instances.size}`,
			);
		}
		return evictedIdle + evictedCapacity;
	}

	private sweepIfDue(): void {
		const now = Date.now();
		if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
		this.lastSweepAt = now;
		this.sweep(now);
	}

	private enforceCapacity(): void {
		if (this.instances.size <= this.maxInstances) return;
		this.sweep(Date.now());
	}
}

export function nodeDurableInstanceCount(): number {
	let total = 0;
	for (const namespace of liveNamespaces) total += namespace.size();
	return total;
}

class NodeDurableObjectStub {
	private readonly instance: DurableObjectInstance;

	constructor(instance: DurableObjectInstance) {
		this.instance = instance;
	}

	async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const req = input instanceof Request ? input : new Request(String(input), init);
		return await this.instance.fetch(req);
	}
}
