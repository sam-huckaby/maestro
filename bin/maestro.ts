#!/usr/bin/env node

import { runCli } from '../src/cli/index.js';

runCli().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
