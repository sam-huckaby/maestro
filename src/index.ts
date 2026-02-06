// Main exports for Maestro multi-agent orchestration system

// Config
export { Config, getDefaultConfig } from './config/index.js';
export type { MaestroConfig, ResolvedConfig, LogLevel } from './config/types.js';

// Agents
export {
  Agent,
  AgentRegistry,
  getAgentRegistry,
  resetAgentRegistry,
  Architect,
  createArchitect,
  Implementer,
  createImplementer,
  Reviewer,
  createReviewer,
  Orchestrator,
  createOrchestrator,
  TaskPlanner,
  ConfidenceRouter,
  ExecutionLoop,
} from './agents/index.js';

export type {
  AgentRole,
  AgentCapability,
  AgentConfig,
  AgentResponse,
  AgentMemoryView,
  AgentStatus,
  ConfidenceScore,
  Artifact,
  ArtifactType,
  NextAction,
  AgentDependencies,
  AgentAssessment,
  ReviewVerdict,
  ReviewResult,
  OrchestratorEvents,
  OrchestratorConfig,
  RouterConfig,
  RoutingDecision,
  ExecutionLoopEvents,
  ExecutionLoopConfig,
} from './agents/index.js';

// Tasks
export {
  createTask,
  updateTaskStatus,
  addTaskAttempt,
  completeTaskAttempt,
  TaskQueue,
  createHandoffPayload,
  updateHandoffWithResponse,
} from './tasks/index.js';

export type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskResult,
  TaskContext,
  TaskAttempt,
  HandoffPayload,
  ProjectContext,
  TaskDecomposition,
  CreateTaskOptions,
  TaskQueueEvents,
} from './tasks/index.js';

// Memory
export {
  MemoryManager,
  initializeMemory,
  getMemoryManager,
  isMemoryInitialized,
  closeMemory,
  ShortTermMemory,
  LongTermMemory,
  SharedMemory,
  SharedNamespaces,
} from './memory/index.js';

export type {
  MemoryEntry,
  MemoryEntryType,
  MemoryStats,
  MemoryManagerConfig,
  SharedNamespace,
} from './memory/index.js';

// LLM
export { createLLMProvider, AnthropicProvider } from './llm/index.js';
export type {
  LLMProvider,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  Message,
  MessageRole,
} from './llm/index.js';

// CLI
export { createCli, runCli } from './cli/index.js';
export { Logger, logger, Spinner, MultiStepProgress } from './cli/ui/index.js';

// Utils
export {
  MaestroError,
  AgentError,
  TaskError,
  MemoryError,
  LLMError,
  ConfigurationError,
  NoConfidentAgentError,
  TaskTimeoutError,
  TaskDependencyError,
  LLMAuthenticationError,
  LLMRateLimitError,
  ValidationError,
  MemoryAccessError,
  formatError,
  isRetryableError,
} from './utils/errors.js';

export {
  validate,
  validateOptional,
  isValidId,
  isValidConfidence,
} from './utils/validation.js';

export {
  ensureDirectory,
  fileExists,
  directoryExists,
  readJsonFile,
  writeJsonFile,
  getDataDirectory,
  getDatabasePath,
} from './utils/fs.js';
