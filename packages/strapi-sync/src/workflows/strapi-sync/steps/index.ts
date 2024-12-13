import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import { CmsModuleService } from "@services";
import { CMS_MODULE } from "../../..";
import { AuthInterface } from "@types";

export const createProductStep = createStep(
  "create-product",
  async (input: { data: any; authInterface: AuthInterface }, { container }) => {
    const productModuleService = container.resolve(Modules.PRODUCT);

    const cmsModuleService =
      container.resolve<CmsModuleService>(CMS_MODULE);

    const product = await productModuleService.retrieveProduct(input.data.id);

    const res = cmsModuleService.createProductInStrapi(
      product,
      input.authInterface
    );

    return new StepResponse(product, res);
  }
);
