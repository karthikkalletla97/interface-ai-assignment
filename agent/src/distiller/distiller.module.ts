import { Module } from '@nestjs/common';
import { DistillerService } from './distiller.service';

@Module({ providers: [DistillerService] })
export class DistillerModule {}
