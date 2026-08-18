import { Injectable } from '@nestjs/common';
import { Policy, loadPolicy, checkAllowed } from './policy';

@Injectable()
export class PolicyGuard {
  private policy: Policy = loadPolicy();

  check(url: string, action: string): { allowed: boolean; reason?: string } {
    return checkAllowed(this.policy, url, action);
  }

  describe(): Policy {
    return this.policy;
  }
}
