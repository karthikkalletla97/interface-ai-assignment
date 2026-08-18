import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '../discovery/discovery.module';
import { DiscoveryService } from '../discovery/discovery.service';

async function main() {
  // Standalone application context: DI and modules, no HTTP server.
  // ConfigModule loads .env as part of this boot, so read config afterwards.
  const app = await NestFactory.createApplicationContext(DiscoveryModule, {
    logger: ['error', 'warn'],
  });

  const config = app.get(ConfigService);
  const goal = config.get<string>('GOAL') ?? process.argv[2];
  const target =
    config.get<string>('TARGET') ?? process.argv[3] ?? 'http://localhost:4000/login';

  if (!goal) {
    console.error('Set GOAL in .env, or pass it as the first argument.');
    await app.close();
    process.exit(2);
  }

  const discovery = app.get(DiscoveryService);
  const result = await discovery.run(goal, target);
  console.log(`\nstatus: ${result.status}`);
  console.log(`steps:  ${result.steps.length}`);
  console.log(`outputs:`, result.outputs ?? '(none)');
  console.log(`evidence: evidence/${result.runId}/`);

  await app.close();
  process.exit(result.status === 'success' ? 0 : 1);
}

main();
