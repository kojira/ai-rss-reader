import { NextResponse } from 'next/server';
import { DAO } from '@/lib/db';

export async function GET() {
  const status = DAO.getCrawlerStatus();
  return NextResponse.json({
    isCrawling: status.is_crawling === 1,
    lastRun: status.last_run,
    currentTask: status.current_task,
    articlesProcessed: status.articles_processed,
    lastError: status.last_error
  });
}
