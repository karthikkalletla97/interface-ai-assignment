import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BrowserService } from '../browser/browser.service';
import { PerceptionService } from '../perception/perception.service';
import { PlannerService } from '../planner/planner.service';
import { ActuatorService } from '../actuator/actuator.service';
import { EvidenceService } from '../evidence/evidence.service';
import { LlmService } from '../llm/llm.service';
import { PolicyGuard } from '../policy/policy.guard';
import { DiscoveryService } from './discovery.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    BrowserService,
    PerceptionService,
    PlannerService,
    ActuatorService,
    EvidenceService,
    LlmService,
    PolicyGuard,
    DiscoveryService,
  ],
})
export class DiscoveryModule {}
