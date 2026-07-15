import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt, { JwtHeader, JwtPayload, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from './config';

export const Public = () => SetMetadata('public', true);

const jwks = config.auth.jwksUrl
  ? jwksClient({
      jwksUri: config.auth.jwksUrl,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    })
  : null;

function signingKey(header: JwtHeader, callback: SigningKeyCallback): void {
  if (!jwks || !header.kid) {
    callback(new Error('Supabase JWKS is not configured'));
    return;
  }
  jwks.getSigningKey(header.kid, (error, key) => {
    callback(error, key?.getPublicKey());
  });
}

function verifySupabaseToken(token: string): Promise<JwtPayload> {
  const issuer = config.auth.supabaseUrl ? `${config.auth.supabaseUrl}/auth/v1` : undefined;
  if (!issuer || !jwks) return Promise.reject(new Error('Supabase Auth is not configured'));

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      signingKey,
      {
        algorithms: ['ES256', 'RS256'],
        audience: config.auth.audience,
        issuer,
      },
      (error, payload) => {
        if (error || typeof payload === 'string' || !payload) {
          reject(error ?? new Error('Invalid JWT payload'));
          return;
        }
        resolve(payload);
      },
    );
  });
}

@Injectable()
export class DemoAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    if (token === config.authToken && config.auth.mode !== 'supabase') {
      request.userId = config.demoUserId;
      return true;
    }
    if (!token || config.auth.mode === 'demo') {
      throw new UnauthorizedException('A valid access token is required');
    }

    try {
      const payload = await verifySupabaseToken(token);
      if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('JWT subject is missing');
      request.userId = payload.sub;
      request.authClaims = payload;
      return true;
    } catch {
      throw new UnauthorizedException('A valid Supabase access token is required');
    }
  }
}
