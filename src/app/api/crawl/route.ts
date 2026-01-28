import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { DAO } from '@/lib/db';

export async function POST() {
  const status = DAO.getCrawlerStatus();
  
  if (status.is_crawling === 1) {
    return NextResponse.json({ message: 'Already crawling' }, { status: 400 });
  }

  // Trigger worker.ts in the background
  exec('npx ts-node src/worker.ts', (error) => {
    if (error) {
      console.error(`Worker error: ${error}`);
      DAO.updateCrawlerStatus({ last_error: error.message, is_crawling: 0 });
    }
  });

  return NextResponse.json({ message: 'Crawl started' });
}

export async function DELETE() {
  // Find and kill ts-node src/worker.ts processes
  exec("ps aux | grep 'src/worker.ts' | grep -v grep | awk '{print $2}' | xargs kill -9", (error) => {
    if (error) {
       console.error(`Kill error: ${error}`);
    }
  });

  DAO.updateCrawlerStatus({ 
    is_crawling: 0, 
    current_task: 'Stopped by user',
    last_error: null 
  });

  return NextResponse.json({ message: 'Crawl stopped' });
}
