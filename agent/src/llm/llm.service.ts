import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class LlmService {
  private client: Anthropic;
  private model: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.client = new Anthropic({ apiKey: this.config.get<string>('ANTHROPIC_API_KEY') });
    this.model = this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';
  }

  // Forces the model to answer with exactly one tool call.
  async createMessage(system: string, user: string, tools: Anthropic.Tool[]) {
    return this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      tools,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: user }],
    });
  }
}
