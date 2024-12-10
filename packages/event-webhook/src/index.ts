import { Module } from "@medusajs/framework/utils";
import { EventWebhookModuleService } from "@services";

export const EventModule = "event-webhook";

export default Module(EventModule, {
  service: EventWebhookModuleService,
});
