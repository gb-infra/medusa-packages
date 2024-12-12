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

export class TransformationModuleService extends MedusaService({
  Transformation,
  EventWebhook,
}) {
  protected baseRepository_: DAL.RepositoryService;
  protected readonly transformationService_: ModulesSdkTypes.IMedusaInternalService<
    InferEntityType<typeof Transformation>
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
