import { cosmiconfig } from 'cosmiconfig';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getDefaultConfig, getConfigSearchPlaces, getEnvVariables } from './defaults.js';
import type { MaestroConfig, ResolvedConfig, ConfigSource } from './types.js';
import type { ProjectProfile } from '../context/profileProject.js';
import { ConfigurationError } from '../utils/errors.js';

const ProjectProfileSchema = z.object({
  buildCommand: z.string(),
  testCommand: z.string(),
  installCommand: z.string(),
  languages: z.array(z.string()),
  bundler: z.string().nullable(),
  packageManager: z.string().nullable(),
  framework: z.string().nullable(),
  monorepo: z.boolean(),
  notes: z.string(),
});

const ConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(['anthropic', 'openai', 'local']),
    apiKey: z.string().optional(),
    model: z.string(),
    maxTokens: z.number().positive(),
    temperature: z.number().min(0).max(2),
    timeout: z.number().positive(),
  }),
  memory: z.object({
    shortTerm: z.object({
      maxSize: z.number().positive(),
      defaultTtlMs: z.number().positive(),
    }),
    longTerm: z.object({
      databasePath: z.string(),
      walMode: z.boolean(),
    }),
    shared: z.object({
      databasePath: z.string(),
      namespaces: z.array(z.string()),
    }),
  }),
  agents: z.record(
    z.object({
      enabled: z.boolean(),
      confidenceThreshold: z.number().min(0).max(1).optional(),
      maxRetries: z.number().int().positive().optional(),
      customPrompt: z.string().optional(),
    })
  ),
  orchestration: z.object({
    defaultConfidenceThreshold: z.number().min(0).max(1),
    maxTaskRetries: z.number().int().positive(),
    taskTimeoutMs: z.number().positive(),
    parallelAssessment: z.boolean(),
    reviewRequired: z.boolean(),
  }),
  cli: z.object({
    colors: z.boolean(),
    spinners: z.boolean(),
    verbosity: z.enum(['debug', 'info', 'warn', 'error', 'silent']),
    outputFormat: z.enum(['text', 'json']),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error', 'silent']),
    file: z.string().optional(),
    includeTimestamp: z.boolean(),
    includeAgentId: z.boolean(),
  }),
  project: ProjectProfileSchema.optional(),
});

export class Config {
  private static instance: Config | null = null;
  private config: ResolvedConfig;
  private configFilePath: string | null;

  private constructor(config: ResolvedConfig, configFilePath: string | null) {
    this.config = config;
    this.configFilePath = configFilePath;
  }

  static async load(overrides?: Partial<MaestroConfig>): Promise<Config> {
    const defaults = getDefaultConfig();
    const sources: ConfigSource[] = [{ path: 'defaults', type: 'default' }];

    // Load from config file
    const explorer = cosmiconfig('maestro', {
      searchPlaces: getConfigSearchPlaces(),
    });

    let fileConfig: Partial<MaestroConfig> = {};
    let loadedFilePath: string | null = null;
    try {
      const result = await explorer.search();
      if (result && !result.isEmpty) {
        fileConfig = result.config;
        loadedFilePath = result.filepath;
        sources.push({ path: result.filepath, type: 'file' });
      }
    } catch (error) {
      throw new ConfigurationError(`Failed to load config file: ${error}`);
    }

    // Load from environment variables
    const envConfig = Config.loadFromEnv();
    if (Object.keys(envConfig).length > 0) {
      sources.push({ path: 'environment', type: 'env' });
    }

    // Merge configs: defaults < file < env < overrides
    const merged = Config.deepMerge(
      defaults,
      fileConfig,
      envConfig,
      overrides ?? {}
    ) as MaestroConfig;

    // Validate
    const validated = ConfigSchema.safeParse(merged);
    if (!validated.success) {
      const errors = validated.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      throw new ConfigurationError(`Invalid configuration: ${errors}`);
    }

    const resolvedConfig: ResolvedConfig = {
      ...validated.data,
      sources,
    };

    Config.instance = new Config(resolvedConfig, loadedFilePath);
    return Config.instance;
  }

  static get(): Config {
    if (!Config.instance) {
      throw new ConfigurationError('Config not loaded. Call Config.load() first.');
    }
    return Config.instance;
  }

  static isLoaded(): boolean {
    return Config.instance !== null;
  }

  static reset(): void {
    Config.instance = null;
  }

  private static loadFromEnv(): Partial<MaestroConfig> {
    const envVars = getEnvVariables();
    const config: Record<string, unknown> = {};

    for (const [envKey, configPath] of Object.entries(envVars)) {
      const value = process.env[envKey];
      if (value !== undefined) {
        Config.setNestedValue(config, configPath, Config.parseEnvValue(value));
      }
    }

    return config as Partial<MaestroConfig>;
  }

  private static parseEnvValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const num = Number(value);
    if (!isNaN(num)) return num;
    return value;
  }

  private static setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1]!;
    current[lastPart] = value;
  }

  private static deepMerge(...objects: Partial<MaestroConfig>[]): Partial<MaestroConfig> {
    const result: Record<string, unknown> = {};

    for (const obj of objects) {
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            typeof result[key] === 'object' &&
            result[key] !== null
          ) {
            result[key] = Config.deepMerge(
              result[key] as Partial<MaestroConfig>,
              value as Partial<MaestroConfig>
            );
          } else {
            result[key] = value;
          }
        }
      }
    }

    return result as Partial<MaestroConfig>;
  }

  get llm() {
    return this.config.llm;
  }

  get memory() {
    return this.config.memory;
  }

  get agents() {
    return this.config.agents;
  }

  get orchestration() {
    return this.config.orchestration;
  }

  get cli() {
    return this.config.cli;
  }

  get logging() {
    return this.config.logging;
  }

  get project(): ProjectProfile | undefined {
    return this.config.project;
  }

  get sources() {
    return this.config.sources;
  }

  getAll(): ResolvedConfig {
    return { ...this.config };
  }

  toJSON(): MaestroConfig {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sources: _, ...config } = this.config;
    return config;
  }

  private resolveConfigFilePath(): string {
    if (this.configFilePath && this.configFilePath.endsWith('.json')) {
      return this.configFilePath;
    }
    return join(process.cwd(), 'maestro.config.json');
  }

  private readJsonFile(filePath: string): Record<string, unknown> {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  saveProjectProfile(profile: ProjectProfile): string {
    const filePath = this.resolveConfigFilePath();
    const existing = this.readJsonFile(filePath);
    existing.project = profile;
    writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    this.config.project = profile;
    return filePath;
  }
}
