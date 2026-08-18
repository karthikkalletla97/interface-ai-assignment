import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DistillerModule } from '../distiller/distiller.module';
import { DistillerService, DistillConfig } from '../distiller/distiller.service';
import * as fs from 'fs';
import * as path from 'path';

const isRedacted = (v: string) => v.startsWith('[REDACTED');

// Pick the newest discovery run that is actually consistent with this capability's
// declared inputs: it succeeded, produced outputs, and every value it typed is a
// declared input value (redacted secrets are accepted). This is what makes the
// distilled artifact honestly parameterized, and it is why a stray not-found run
// (e.g. one that typed 999999) is skipped instead of silently hardcoded.
function selectRun(evidenceDir: string, config: DistillConfig): string {
  const declared = new Set(config.inputs.map((i) => String(i.value)));
  const dirs = fs
    .readdirSync(evidenceDir)
    .filter((d) => d.startsWith('discovery-'))
    .sort()
    .reverse(); // newest first

  const skipped: string[] = [];
  for (const d of dirs) {
    const p = path.join(evidenceDir, d, 'discovery.json');
    if (!fs.existsSync(p)) continue;
    let run: any;
    try {
      run = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    if (run.status !== 'success') {
      skipped.push(`  ${d}: status "${run.status}"`);
      continue;
    }
    if (!run.outputs || Object.keys(run.outputs).length === 0) {
      skipped.push(`  ${d}: no outputs`);
      continue;
    }
    const typed: string[] = (run.steps || [])
      .filter((s: any) => s.action?.kind === 'type')
      .map((s: any) => String(s.action.text));
    const unmatched = typed.filter((v) => !declared.has(v) && !isRedacted(v));
    if (unmatched.length) {
      skipped.push(`  ${d}: typed values not declared in config: ${unmatched.join(', ')}`);
      continue;
    }
    return p;
  }

  throw new Error(
    'No discovery run matches the declared inputs.\n' +
      (skipped.length ? skipped.join('\n') + '\n' : '') +
      'Re-run discovery using the config values, or set RUN=<path to discovery.json> explicitly.',
  );
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const evidenceDir = path.join(repoRoot, 'evidence');
  const configPath = process.env.CONFIG || path.join(repoRoot, 'agent', 'distill.config.json');
  const config: DistillConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const runPath = process.env.RUN || selectRun(evidenceDir, config);
  const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));

  const app = await NestFactory.createApplicationContext(DistillerModule, {
    logger: ['error', 'warn'],
  });
  const distiller = app.get(DistillerService);
  const artifact = distiller.distill(run, config);

  // Surface any typed value that stayed a literal: it means the run used a value the
  // config did not declare, which is almost always a mistake (an unparameterized input).
  const literals = artifact.steps.filter((s) => s.action === 'type' && (s as any).value !== undefined);
  if (literals.length) {
    console.warn(`WARNING: ${literals.length} typed step(s) were left as hardcoded literals, not bound to an input.`);
    console.warn('The run used a value your config does not declare. Check the run and config match.');
  }

  const outDir = path.join(repoRoot, 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, artifact.capability.id + '.json');
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

  console.log('distilled:', artifact.capability.id);
  console.log('from run: ', path.basename(path.dirname(runPath)));
  console.log(`steps: ${artifact.steps.length}  inputs: ${artifact.inputs.length}  outputs: ${artifact.outputs.length}`);
  console.log('written:  ', path.relative(repoRoot, outPath));
  await app.close();
}

main().catch((e) => {
  console.error('distill failed:', e.message);
  process.exit(1);
});
