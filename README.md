# Maestro

**Multi-Agent Orchestration CLI** - Coordinate AI agents using confidence-based routing with isolated memory systems.

## Overview

Maestro is a TypeScript CLI tool that orchestrates multiple AI agents (Orchestrator, Architect, Implementer, Reviewer) to complete complex software engineering tasks. It uses confidence-based routing to assign tasks to the most suitable agent and maintains isolated memory systems for each agent.

## Features

- **Multi-Agent Architecture**: Specialized agents for different tasks
  - **Orchestrator**: Coordinates task execution and manages agent workflow
  - **Architect**: Designs system architecture and solution structure
  - **Implementer**: Generates code and implements solutions
  - **Reviewer**: Validates quality, security, and correctness

- **Confidence-Based Routing**: Agents assess their fitness for each task, and the most confident agent is selected

- **Isolated Memory Systems**:
  - **Short-Term Memory**: In-memory LRU cache with TTL
  - **Long-Term Memory**: SQLite-backed persistent storage per agent
  - **Shared Memory**: Cross-agent namespace-based scratchpad

- **Task Management**: Dependency-aware task queue with priority scheduling

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/maestro.git
cd maestro

# Install dependencies
bun install

# Build the project
bun run build

# Link for global usage
bun link
```

## Quick Start

```bash
# Initialize config in your project
maestro init

# Or copy the example config
cp maestro.config.example.json maestro.config.json

# Set your API key
export ANTHROPIC_API_KEY="your-api-key"

# Ship a feature
maestro ship "Add user authentication"
```

## Configuration

### Environment Variables

```bash
# Required: Anthropic API key
export ANTHROPIC_API_KEY="your-api-key"

# Optional configuration
export MAESTRO_MODEL="claude-sonnet-4-20250514"
export MAESTRO_DATA_DIR="./data"
export MAESTRO_LOG_LEVEL="info"
export MAESTRO_CONFIDENCE_THRESHOLD="0.6"
```

### Configuration File

Create `maestro.config.json` in your project root using the init command:

```bash
maestro init
```

Or copy and modify the example:

```bash
cp maestro.config.example.json maestro.config.json
```

Example configuration:

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 4096,
    "temperature": 0.7
  },
  "orchestration": {
    "defaultConfidenceThreshold": 0.6,
    "maxTaskRetries": 3,
    "taskTimeoutMs": 300000,
    "reviewRequired": true
  },
  "agents": {
    "architect": { "enabled": true },
    "implementer": { "enabled": true },
    "reviewer": { "enabled": true }
  }
}
```

## Usage

### Initialize Project

Create a new config file in the current directory:

```bash
# Create maestro.config.json
maestro init

# Force overwrite existing config
maestro init --force
```

### Ship a Feature

The main command to complete a goal using the agent orchestration system:

```bash
# Basic usage
maestro ship "Add user authentication with OAuth2"

# With options
maestro ship "Refactor database layer" --verbose
maestro ship "Add unit tests" --no-review
maestro ship "Fix login bug" --dry-run

# Output as JSON
maestro ship "Add caching" --json
```

### Check Status

View the current system status:

```bash
maestro status
maestro status --verbose
maestro status --json
```

### Manage Agents

List and inspect available agents:

```bash
# List all agents
maestro agents list
maestro agents list --json

# Get detailed info about an agent
maestro agents info architect
maestro agents info implementer
```

### Inspect Memory

View and manage agent memory:

```bash
# List memory entries
maestro memory list
maestro memory list --agent orchestrator
maestro memory list --namespace artifacts

# View memory statistics
maestro memory stats

# List shared namespaces
maestro memory namespaces

# Clear memory (with confirmation)
maestro memory clear
maestro memory clear --agent implementer --force
maestro memory clear --namespace artifacts --force
```

## Architecture

### Agent Workflow

```
1. Orchestrator receives goal
2. TaskPlanner decomposes goal into tasks
3. ConfidenceRouter assesses all agents in parallel
4. Highest-confidence agent above threshold is selected
5. Selected agent executes the task
6. Reviewer validates results (optional)
7. Orchestrator decides: Done? Retry? Reroute?
```

### Confidence-Based Routing

```typescript
// All agents assess task fitness in parallel
const assessments = await Promise.all(
  agents.map(agent => agent.assessTask(task, context))
);

// Select highest confidence above threshold (default: 0.6)
const best = assessments.sort((a, b) => b.confidence - a.confidence)[0];
if (best.confidence < threshold) throw new NoConfidentAgentError();
```

### Memory Model

| Type | Scope | Storage | Purpose |
|------|-------|---------|---------|
| Short-Term | Session | In-memory LRU | Fast, temporary context |
| Long-Term | Per-agent | SQLite | Persistent learnings |
| Shared | Cross-agent | SQLite | Artifacts, decisions |

### Memory Namespaces

- `artifacts`: Code, designs, and other outputs
- `decisions`: Architectural and implementation decisions
- `context`: Project and task context
- `errors`: Error logs and failure patterns

## Development

### Scripts

```bash
bun run build      # Compile TypeScript
bun run dev        # Watch mode
bun run lint       # Run ESLint
bun run lint:fix   # Fix linting issues
bun run format     # Format with Prettier
bun test           # Run tests
bun test --watch   # Watch mode
bun test --coverage # With coverage
```

### Project Structure

```
maestro/
├── bin/
│   └── maestro.ts           # CLI entry point
├── src/
│   ├── cli/                 # CLI commands and UI
│   ├── agents/              # Agent implementations
│   │   ├── base/            # Base classes
│   │   ├── orchestrator/    # Orchestration logic
│   │   ├── architect/       # Design agent
│   │   ├── implementer/     # Coding agent
│   │   └── reviewer/        # Review agent
│   ├── memory/              # Memory systems
│   ├── tasks/               # Task management
│   ├── llm/                 # LLM providers
│   ├── config/              # Configuration
│   └── utils/               # Utilities
├── tests/                   # Test files
└── data/                    # SQLite databases
```

## API Reference

### Programmatic Usage

```typescript
import {
  createOrchestrator,
  createLLMProvider,
  initializeMemory,
  Config,
} from 'maestro';

// Load configuration
await Config.load();
const config = Config.get();

// Initialize systems
initializeMemory(config.memory);
const llm = createLLMProvider(config.llm);

// Create orchestrator
const orchestrator = createOrchestrator(llm, {
  name: 'my-project',
  description: 'Project description',
  workingDirectory: process.cwd(),
  constraints: [],
  preferences: {},
});

// Execute a goal
orchestrator.on('taskCompleted', (task, result) => {
  console.log(`Task completed: ${task.goal}`);
});

const results = await orchestrator.ship('Add user authentication');
```

### Types

```typescript
interface Task {
  id: string;
  goal: string;
  status: TaskStatus;
  assignedTo?: AgentRole;
  handoff: HandoffPayload;
  attempts: TaskAttempt[];
}

interface ConfidenceScore {
  confidence: number;  // 0.0 - 1.0
  reason: string;
}

interface AgentResponse {
  success: boolean;
  output: string;
  artifacts: Artifact[];
  nextAction?: NextAction;
}
```

## Troubleshooting

### Common Issues

**"No agent met confidence threshold"**
- The task may be too ambiguous or outside agent capabilities
- Try rephrasing the goal more specifically
- Lower the confidence threshold in configuration

**"Authentication failed for anthropic"**
- Ensure `ANTHROPIC_API_KEY` is set correctly
- Verify the API key has sufficient permissions

**"Memory not initialized"**
- Call `initializeMemory(config.memory)` before using memory features
- Ensure the data directory is writable

### Debug Mode

Enable verbose logging for debugging:

```bash
maestro ship "task" --verbose
# or
export MAESTRO_LOG_LEVEL=debug
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `bun test`
5. Submit a pull request
