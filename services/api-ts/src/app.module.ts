import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DemoAuthGuard } from './auth.guard';
import { InfraService } from './infra.service';
import { ModelService } from './model.service';
import { RequestInterceptor } from './request.interceptor';

@Module({
  controllers: [AppController],
  providers: [
    InfraService,
    AppService,
    ModelService,
    { provide: APP_GUARD, useClass: DemoAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestInterceptor },
  ],
})
export class AppModule {}
