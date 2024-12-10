import {
  ApiKeyType,
  IEventBusModuleService,
  Logger,
} from "@medusajs/framework/types";

export type InitializeModuleInjectableDependencies = {
  logger?: Logger;
  EventBus?: IEventBusModuleService;
};

export type CreateEventWebhookDTO = {
  token: string;
  salt: string;
  redacted: string;
  title: string;
  type: ApiKeyType;
  created_by: string;
};
