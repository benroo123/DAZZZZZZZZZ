import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { config } from './config';

export const Public = () => SetMetadata('public', true);

@Injectable()
export class DemoAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    if (request.headers.authorization !== `Bearer ${config.authToken}`) {
      throw new UnauthorizedException('Use Authorization: Bearer demo-user for the local runtime');
    }
    request.userId = config.demoUserId;
    return true;
  }
}
