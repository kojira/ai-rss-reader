export const dynamic = 'force-dynamic';

import { DAO } from '@/lib/db/index';
import { NextResponse } from 'next/server';

export async function GET() {
  const articles = DAO.getArticles();
  return NextResponse.json(articles);
}
