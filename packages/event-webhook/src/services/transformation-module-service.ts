import {
  DAL,
  InferEntityType,
  InternalModuleDeclaration,
  ModuleJoinerConfig,
  ModulesSdkTypes,
} from "@medusajs/framework/types";
import { MedusaService } from "@medusajs/framework/utils";
import { Transformation } from "@models";
import { joinerConfig } from "../joiner-config";

type InjectedDependencies = {
  baseRepository: DAL.RepositoryService;
};

export class TransformationModuleService extends MedusaService({
  Transformation,
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

  __joinerConfig(): ModuleJoinerConfig {
    return joinerConfig;
  }
}
