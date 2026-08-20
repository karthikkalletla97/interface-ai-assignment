import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { DistillerService, DistillConfig } from './distiller.service';

const distiller = new DistillerService();

// Minimal helper to build a discovery step.
function step(url: string, role: string, name: string, action: any) {
  return {
    step: 0,
    observation: { url, title: '', elements: [{ index: 0, role, name, editable: role === 'textbox' }], textDigest: '' },
    action,
    result: 'ok',
  };
}

const readBalanceRun: any = {
  status: 'success',
  runId: 'discovery-test',
  target: 'http://localhost:4000/login',
  outputs: { savings_balance: '$4250.75' },
  checkpoint: 'ok',
  steps: [
    step('http://localhost:4000/login', 'textbox', 'Username', { kind: 'type', target: 0, text: 'teller', why: '' }),
    step('http://localhost:4000/login', 'textbox', 'Password', { kind: 'type', target: 0, text: 'demo1234', why: '' }),
    step('http://localhost:4000/login', 'button', 'Sign in', { kind: 'click', target: 0, why: '' }),
    // a discovery detour: navigate to the page we are already on
    step('http://localhost:4000/search', 'textbox', 'Member ID', { kind: 'navigate', url: 'http://localhost:4000/search', why: '' }),
    step('http://localhost:4000/search', 'textbox', 'Member ID', { kind: 'type', target: 0, text: '100001', why: '' }),
    step('http://localhost:4000/search', 'button', 'Look up', { kind: 'click', target: 0, why: '' }),
    {
      step: 7,
      observation: { url: 'http://localhost:4000/member?id=100001', title: '', elements: [], textDigest: 'Savings\t$4250.75' },
      action: { kind: 'finish', outputs: { savings_balance: '$4250.75' }, checkpoint: 'Read the balance.', why: '' },
      result: 'finished',
    },
  ],
};

const config: DistillConfig = {
  capability: { id: 'member.readSavingsBalance', name: 'Read balance', description: '...', version: 1 },
  inputs: [
    { name: 'username', value: 'teller', secret: true, required: true },
    { name: 'password', value: 'demo1234', secret: true, required: true },
    { name: 'memberId', value: '100001', secret: false, required: true },
  ],
};

describe('distiller', () => {
  it('drops the detour and keeps only the real steps', () => {
    const art = distiller.distill(readBalanceRun, config);
    // entry navigate + 5 real steps (the detour navigate is dropped) = 6
    expect(art.steps.length).toBe(6);
    expect(art.steps.filter((s) => s.action === 'navigate').length).toBe(1);
  });

  it('binds inputs and never writes a secret as a literal', () => {
    const art = distiller.distill(readBalanceRun, config);
    const typeSteps = art.steps.filter((s) => s.action === 'type') as any[];
    expect(typeSteps.map((s) => s.valueFrom)).toEqual(['username', 'password', 'memberId']);
    // no step carries a literal credential value
    const literals = typeSteps.map((s) => s.value).filter(Boolean);
    expect(literals).not.toContain('demo1234');
    expect(literals).not.toContain('teller');
  });

  it('omits example values for secret inputs', () => {
    const art = distiller.distill(readBalanceRun, config);
    const pw = art.inputs.find((i) => i.name === 'password')!;
    expect(pw.secret).toBe(true);
    expect(pw.example).toBeUndefined();
    const mid = art.inputs.find((i) => i.name === 'memberId')!;
    expect(mid.example).toBe('100001');
  });

  it('derives a label-anchored output from the final page', () => {
    const art = distiller.distill(readBalanceRun, config);
    expect(art.outputs[0].extract.label).toBe('Savings');
  });

  it('binds a secret by field name even when its value is redacted in evidence', () => {
    const redacted = JSON.parse(JSON.stringify(readBalanceRun));
    redacted.steps[1].action.text = '[REDACTED-SECRET]'; // password value masked
    const art = distiller.distill(redacted, config);
    const pwStep = (art.steps.filter((s) => s.action === 'type') as any[])[1];
    expect(pwStep.valueFrom).toBe('password'); // still bound, by field name
  });

  it('tags a commit click as risky and everything else as safe', () => {
    const subRun: any = JSON.parse(JSON.stringify(readBalanceRun));
    subRun.steps.push(
      step('http://localhost:4000/member/100001/subaccount', 'button', 'Confirm and open', { kind: 'click', target: 0, why: '' }),
    );
    const art = distiller.distill(subRun, config);
    const risky = art.steps.filter((s) => s.risk === 'risky');
    expect(risky.length).toBe(1);
    expect((risky[0] as any).target.primary.name).toBe('Confirm and open');
  });
});
