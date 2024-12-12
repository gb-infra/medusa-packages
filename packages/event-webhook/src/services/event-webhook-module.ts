import {
  DAL,
  InferEntityType,
  InternalModuleDeclaration,
  ModulesSdkTypes,
} from "@medusajs/framework/types";
import { MedusaService } from "@medusajs/framework/utils";
import { EventWebhook, Transformation } from "@models";

type InjectedDependencies = {
  baseRepository: DAL.RepositoryService;
};

export class EventWebhookModuleService extends MedusaService({
  EventWebhook,
  Transformation,
}) {
  protected baseRepository_: DAL.RepositoryService;
  protected readonly eventWebhookService_: ModulesSdkTypes.IMedusaInternalService<
    InferEntityType<typeof EventWebhook>
  >;

  constructor(
    { baseRepository }: InjectedDependencies,
    protected readonly moduleDeclaration: InternalModuleDeclaration
  ) {
    // @ts-ignore
    super(...arguments);
    this.baseRepository_ = baseRepository;
  }
}
