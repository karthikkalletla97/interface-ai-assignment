import { Injectable, Inject } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AgentAction, Observation } from '../contracts';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class PlannerService {
  constructor(@Inject(LlmService) private readonly llm: LlmService) {}

  // One tool per action kind. tool_choice 'any' guarantees the model picks one,
  // so we never parse free-form text into an action. 'why' is required on every
  // acting tool, which gives us the reasoning trail for evidence for free.
  private readonly tools: Anthropic.Tool[] = [
    { name: 'click', description: 'Click an interactive element by its index.',
      input_schema: { type: 'object', properties: { target: { type: 'integer' }, why: { type: 'string' } }, required: ['target', 'why'] } },
    { name: 'type', description: 'Type text into an editable element by its index. Existing text is cleared first.',
      input_schema: { type: 'object', properties: { target: { type: 'integer' }, text: { type: 'string' }, why: { type: 'string' } }, required: ['target', 'text', 'why'] } },
    { name: 'navigate', description: 'Navigate directly to a URL.',
      input_schema: { type: 'object', properties: { url: { type: 'string' }, why: { type: 'string' } }, required: ['url', 'why'] } },
    { name: 'finish', description: 'Call only when the goal checkpoint is satisfied. Put extracted values in outputs.',
      input_schema: { type: 'object', properties: { outputs: { type: 'object', additionalProperties: { type: 'string' } }, checkpoint: { type: 'string' }, why: { type: 'string' } }, required: ['outputs', 'checkpoint', 'why'] } },
    { name: 'give_up', description: 'Call when the goal cannot be reached from here.',
      input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  ];

  private readonly system =
    'You operate a bank back-office web UI to accomplish a goal. You are given the ' +
    'interactive elements (each with an index) and the visible page text. Choose the ' +
    'single best next action and call exactly one tool. Prefer the fewest steps. ' +
    'An editable field shows its current contents as = "...". If a field already holds ' +
    'the value you intended, do NOT type it again; move on. After all required fields are ' +
    'filled, click the button that submits the form (for example Look up or Sign in). ' +
    'Never repeat an action that already succeeded. Read values from the page text. ' +
    'Call finish only once the goal checkpoint is truly met, and put extracted values in outputs.';

  async decide(goal: string, obs: Observation, history: string[]): Promise<AgentAction> {
    const elementList = obs.elements
      .map((e) =>
        `[${e.index}] ${e.role} "${e.name}"` +
        (e.editable ? ' (editable)' : '') +
        (e.value ? ` = "${e.value}"` : ''),
      )
      .join('\n');

    const user =
      `Goal: ${goal}\n\nURL: ${obs.url}\nTitle: ${obs.title}\n\n` +
      `Interactive elements:\n${elementList || '(none)'}\n\n` +
      `Page text:\n${obs.textDigest}\n\n` +
      `Actions so far:\n${history.length ? history.join('\n') : '(none)'}`;

    const msg = await this.llm.createMessage(this.system, user, this.tools);
    const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!call) throw new Error('Model returned no tool call');

    // Reunite the tool name (the kind) with its input, then validate hard.
    return AgentAction.parse({ kind: call.name, ...(call.input as Record<string, unknown>) });
  }
}
