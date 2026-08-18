import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ReplayModule } from '../replay/replay.module';
import { ReplayService } from '../replay/replay.service';
import { Artifact } from '../artifact/artifact.contracts';
import * as fs from 'fs';
import * as path from 'path';

function firstArtifact(dir: string): string {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (!files.length) throw new Error('No artifact found in ' + dir);
  return path.join(dir, files[0]);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const artifactPath = process.env.ARTIFACT || firstArtifact(path.join(repoRoot, 'artifacts'));
  const artifact = Artifact.parse(JSON.parse(fs.readFileSync(artifactPath, 'utf8')));

  let inputs: Record<string, string> = {};
  let memberSource = 'artifact example';
  const inputsFile = path.join(repoRoot, 'agent', 'replay.inputs.json');
  if (process.env.INPUTS) {
    inputs = JSON.parse(process.env.INPUTS);
    if (inputs.memberId !== undefined) memberSource = 'INPUTS env';
  } else if (fs.existsSync(inputsFile)) {
    inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
    if (inputs.memberId !== undefined) memberSource = 'replay.inputs.json';
  }
  // Only memberId can be overridden per run. We deliberately do NOT read USERNAME
  // or PASSWORD from the environment: on Windows USERNAME is a reserved OS variable
  // (your account name), which would silently overwrite the credential.
  // NOTE: this CLI does not load .env (only `discover` does). Set the member id with
  // the command argument, e.g. `npm run replay -- 100003`.
  // Precedence: positional arg > MEMBER_ID env > inputs file.
  if (process.env.MEMBER_ID !== undefined) {
    inputs.memberId = process.env.MEMBER_ID;
    memberSource = 'MEMBER_ID env';
  }
  const argMember = process.argv[2];
  if (argMember !== undefined) {
    inputs.memberId = argMember;
    memberSource = 'command argument';
  }

  const shownMember = inputs.memberId === '' ? '(empty)' : inputs.memberId ?? '(none)';
  console.log(`replaying ${artifact.capability.id}`);
  console.log(`memberId:   ${shownMember}  (from ${memberSource})`);

  const app = await NestFactory.createApplicationContext(ReplayModule, { logger: ['error', 'warn'] });
  const replay = app.get(ReplayService);
  const approveRisky = process.env.APPROVE_RISKY === '1';
  const handoff = process.env.HANDOFF === '1';
  const result = await replay.replay(artifact, inputs, { approveRisky, handoff });

  console.log(`\ncapability: ${result.capabilityId}`);
  console.log(`status:     ${result.status}`);
  if (result.status === 'success') {
    console.log('outputs:   ', result.outputs);
    if (result.interventions?.length) {
      console.log(`handoffs:   ${result.interventions.length} (a human took control mid-run)`);
      for (const iv of result.interventions) {
        console.log(`  step ${iv.step} "${iv.control}" -> human; page changed: ${iv.changed}`);
      }
    }
  }
  if (result.status === 'business_outcome') console.log(`outcome:    ${result.outcome} - ${result.message}`);
  if (result.status === 'escalated') {
    const e = result.escalation;
    console.log(`escalation: step ${e.step} (${e.action} "${e.control}") - ${e.reason}`);
    console.log('            re-run with APPROVE_RISKY=1 to auto-authorize, or HANDOFF=1 for a live human handoff.');
  }
  if (result.status === 'hard_failure') {
    const f = result.failure;
    console.log(`failure:    step ${f.step} (${f.action}); expected ${f.expected}; observed ${f.observed}${result.escalate ? '  [ESCALATE]' : ''}`);
  }
  console.log(`evidence:   evidence/${result.runId}/`);

  await app.close();
  process.exit(result.status === 'hard_failure' ? 1 : 0);
}

main().catch((e) => {
  console.error('replay failed:', e.message);
  process.exit(1);
});
