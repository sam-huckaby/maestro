import { ShortTermMemory, AgentShortTermView } from './stores/ShortTermMemory.js';
import { LongTermMemory, AgentLongTermView } from './stores/LongTermMemory.js';
import { SharedMemory, AgentSharedView } from './stores/SharedMemory.js';
import type { MemoryManagerConfig, MemoryStats, SharedNamespace } from './types.js';
import type { AgentRole, AgentMemoryView } from '../agents/base/types.js';
import { SharedNamespaces } from './types.js';

// Define which namespaces each agent role can access
const AGENT_NAMESPACE_ACCESS: Record<AgentRole, SharedNamespace[]> = {
  orchestrator: [
    SharedNamespaces.ARTIFACTS,
    SharedNamespaces.DECISIONS,
    SharedNamespaces.CONTEXT,
    SharedNamespaces.ERRORS,
  ],
  architect: [
    SharedNamespaces.ARTIFACTS,
    SharedNamespaces.DECISIONS,
    SharedNamespaces.CONTEXT,
  ],
  implementer: [
    SharedNamespaces.ARTIFACTS,
    SharedNamespaces.CONTEXT,
  ],
  reviewer: [
    SharedNamespaces.ARTIFACTS,
    SharedNamespaces.DECISIONS,
    SharedNamespaces.ERRORS,
  ],
};

export class MemoryManager {
  private shortTerm: ShortTermMemory;
  private longTerm: LongTermMemory;
  private shared: SharedMemory;
  private agentViews: Map<string, AgentMemoryViewImpl> = new Map();

  constructor(config: MemoryManagerConfig) {
    this.shortTerm = new ShortTermMemory(config.shortTerm);
    this.longTerm = new LongTermMemory(config.longTerm);
    this.shared = new SharedMemory(config.shared);
  }

  getAgentView(agentId: string, agentRole: AgentRole): AgentMemoryView {
    const cacheKey = `${agentId}:${agentRole}`;

    if (!this.agentViews.has(cacheKey)) {
      const allowedNamespaces = AGENT_NAMESPACE_ACCESS[agentRole];
      const view = new AgentMemoryViewImpl(
        this.shortTerm.createAgentView(agentId),
        this.longTerm.createAgentView(agentId),
        this.shared.createAgentView(agentId, allowedNamespaces)
      );
      this.agentViews.set(cacheKey, view);
    }

    return this.agentViews.get(cacheKey)!;
  }

  async getStats(): Promise<MemoryStats> {
    const shortTermStats = this.shortTerm.getStats();
    const longTermStats = await this.longTerm.getStats();
    const sharedStats = await this.shared.getStats();

    return {
      shortTerm: {
        size: shortTermStats.size,
        maxSize: shortTermStats.maxSize,
        hitRate: shortTermStats.hitRate,
      },
      longTerm: {
        entries: longTermStats.entries,
        sizeBytes: longTermStats.sizeBytes,
      },
      shared: {
        namespaces: sharedStats.namespaces.map((ns) => ns.name),
        totalEntries: sharedStats.totalEntries,
      },
    };
  }

  async clearAgent(agentId: string): Promise<void> {
    this.shortTerm.clear(agentId);
    await this.longTerm.clear(agentId);
    // Remove cached views for this agent
    for (const key of this.agentViews.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.agentViews.delete(key);
      }
    }
  }

  async clearAll(): Promise<void> {
    this.shortTerm.clear();
    await this.longTerm.clear();
    for (const namespace of Object.values(SharedNamespaces)) {
      await this.shared.clearNamespace(namespace);
    }
    this.agentViews.clear();
  }

  // Direct access for administrative operations
  getShortTermMemory(): ShortTermMemory {
    return this.shortTerm;
  }

  getLongTermMemory(): LongTermMemory {
    return this.longTerm;
  }

  getSharedMemory(): SharedMemory {
    return this.shared;
  }

  close(): void {
    this.longTerm.close();
    this.shared.close();
  }
}

class AgentMemoryViewImpl implements AgentMemoryView {
  constructor(
    public readonly shortTerm: AgentShortTermView,
    public readonly longTerm: AgentLongTermView,
    public readonly shared: AgentSharedView
  ) {}
}

// Singleton instance management
let instance: MemoryManager | null = null;

export function initializeMemory(config: MemoryManagerConfig): MemoryManager {
  if (instance) {
    instance.close();
  }
  instance = new MemoryManager(config);
  return instance;
}

export function getMemoryManager(): MemoryManager {
  if (!instance) {
    throw new Error('MemoryManager not initialized. Call initializeMemory() first.');
  }
  return instance;
}

export function isMemoryInitialized(): boolean {
  return instance !== null;
}

export function closeMemory(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
