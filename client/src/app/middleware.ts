import { NextRequest, NextResponse } from 'next/server';

// This middleware runs on the Node.js runtime only, not the Edge runtime
export const config = {
    matcher: [],
    runtime: 'nodejs'
};

export function middleware(request: NextRequest) {
    return NextResponse.next();
} 