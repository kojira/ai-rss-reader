export const dynamic = 'force-dynamic';

import { DAO } from '@/lib/db/index';
import { NextResponse } from 'next/server';

export async function GET() {
  const config = DAO.getConfig();
  return NextResponse.json(config);
}

export async function POST(request: Request) {
  const body = await request.json();
  DAO.updateConfig(body);
  return NextResponse.json({ success: true });
}
