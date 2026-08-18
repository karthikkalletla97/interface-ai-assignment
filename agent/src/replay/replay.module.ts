import { Module } from '@nestjs/common';
import { BrowserService } from '../browser/browser.service';
import { EvidenceService } from '../evidence/evidence.service';
import { LocatorResolverService } from './locator-resolver.service';
import { PolicyGuard } from '../policy/policy.guard';
import { HandoffService } from '../handoff/handoff.service';
import { ReplayService } from './replay.service';

@Module({
  providers: [BrowserService, EvidenceService, LocatorResolverService, PolicyGuard, HandoffService, ReplayService],
})
export class ReplayModule {}
