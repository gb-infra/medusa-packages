import {
  DAL,
  InferEntityType,
  InternalModuleDeclaration,
  ModuleJoinerConfig,
  ModulesSdkTypes,
} from "@medusajs/framework/types";
import { MedusaService } from "@medusajs/framework/utils";
import { EventWebhook } from "@models";
import { joinerConfig } from "../joiner-config";

type InjectedDependencies = {
  baseRepository: DAL.RepositoryService;
};

export class EventWebhookModuleService extends MedusaService({ EventWebhook }) {
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

  __joinerConfig(): ModuleJoinerConfig {
    return joinerConfig;
  }
}
