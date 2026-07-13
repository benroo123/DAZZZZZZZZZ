import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

@Injectable()
export class RequestInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startedAt = performance.now();
    const correlationId = request.headers['x-correlation-id'] ?? randomUUID();
    request.correlationId = correlationId;
    response.header('x-correlation-id', correlationId);
    return next.handle().pipe(
      finalize(() => {
        const event = {
          level: 'info',
          service: 'api-ts',
          correlationId,
          method: request.method,
          path: request.url,
          statusCode: response.statusCode,
          latencyMs: Math.round(performance.now() - startedAt),
          userId: request.userId ? String(request.userId).slice(0, 8) : undefined,
        };
        process.stdout.write(`${JSON.stringify(event)}\n`);
      }),
    );
  }
}
