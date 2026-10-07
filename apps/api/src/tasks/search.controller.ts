import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { PublicUser } from '../users/user.entity';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  search(@CurrentUser() user: PublicUser, @Query('q') q = '', @Query('archived') archived?: string) {
    return this.searchService.search(user, String(q).slice(0, 200), archived === 'true');
  }
}
