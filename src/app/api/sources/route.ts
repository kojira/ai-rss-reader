export const dynamic = 'force-dynamic';

import { DAO } from '@/lib/db/index';
import { NextResponse } from 'next/server';

export async function GET() {
  const sources = DAO.getRssSources();
  return NextResponse.json(sources);
}

export async function POST(request: Request) {
  const { url, name } = await request.json();
  DAO.addRssSource(url, name);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();
  DAO.deleteRssSource(id);
  return NextResponse.json({ success: true });
}
