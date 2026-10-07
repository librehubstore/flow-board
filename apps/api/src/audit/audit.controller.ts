import { Controller, Get } from '@nestjs/common';
import { AdminOnly } from '../common/decorators';
import { AuditService } from './audit.service';

@AdminOnly()
@Controller('admin/audit')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list() {
    return this.audit.list();
  }
}
