export {
  MemoryManager,
  initializeMemory,
  getMemoryManager,
  isMemoryInitialized,
  closeMemory,
} from './MemoryManager.js';
export { ShortTermMemory, AgentShortTermView } from './stores/ShortTermMemory.js';
export { LongTermMemory, AgentLongTermView } from './stores/LongTermMemory.js';
export { SharedMemory, AgentSharedView } from './stores/SharedMemory.js';
export type {
  MemoryEntry,
  MemoryEntryType,
  MemoryStats,
  MemoryManagerConfig,
  ShortTermMemoryConfig,
  LongTermMemoryConfig,
  SharedMemoryConfig,
  AgentMemoryScope,
  SharedNamespace,
} from './types.js';
export { SharedNamespaces } from './types.js';
