import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';
import { DiscoveryResult } from '../contracts';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EvidenceService {
  private root = path.resolve(__dirname, '../../..', 'evidence');

  newRunId(): string {
    return 'discovery-' + new Date().toISOString().replace(/[:.]/g, '-');
  }

  newReplayRunId(): string {
    return 'replay-' + new Date().toISOString().replace(/[:.]/g, '-');
  }

  private dir(runId: string): string {
    const d = path.join(this.root, runId);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  async screenshot(page: Page, runId: string, label: number | string): Promise<string> {
    const name = typeof label === 'number' ? `step-${String(label).padStart(2, '0')}` : label;
    const file = path.join(this.dir(runId), `${name}.png`);
    await page.screenshot({ path: file }).catch(() => undefined);
    return path.relative(this.root, file);
  }

  // Redacts PII patterns (SSN, email) plus any explicitly declared secret values
  // (credentials passed in from the caller), so a real secret never persists to a log.
  private redactString(s: string, secrets: string[]): string {
    let out = s
      .replace(/\d{3}-\d{2}-\d{4}/g, '[REDACTED-SSN]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[REDACTED-EMAIL]');
    for (const secret of secrets) {
      if (secret) out = out.split(secret).join('[REDACTED-SECRET]');
    }
    return out;
  }

  // Walk the structure and redact string leaves only. Redacting the serialized
  // JSON string instead lets a match eat into an escape sequence (\t, \n) and
  // produce invalid JSON, which is the bug this avoids.
  private redact<T>(value: T, secrets: string[] = []): T {
    if (typeof value === 'string') return this.redactString(value, secrets) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.redact(v, secrets)) as unknown as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.redact(v, secrets);
      return out as unknown as T;
    }
    return value;
  }

  write(result: DiscoveryResult, secrets: string[] = []): void {
    const d = this.dir(result.runId);
    fs.writeFileSync(path.join(d, 'discovery.json'), JSON.stringify(this.redact(result, secrets), null, 2));
    const jsonl = result.steps
      .map((s) => JSON.stringify(this.redact({ step: s.step, action: s.action, result: s.result }, secrets)))
      .join('\n');
    fs.writeFileSync(path.join(d, 'transcript.jsonl'), jsonl);
  }

  writeReplay(runId: string, result: unknown): void {
    const d = this.dir(runId);
    fs.writeFileSync(path.join(d, 'replay.json'), JSON.stringify(this.redact(result), null, 2));
  }
}
