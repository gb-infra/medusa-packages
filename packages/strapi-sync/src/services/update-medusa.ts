import { addIgnore_, shouldIgnore_ } from "../utils/redis-key-manager";
import { MedusaService } from "@medusajs/framework/utils";
import {
  IProductModuleService,
  IRegionModuleService,
  Logger,
  ProductDTO,
  ProductVariantDTO,
  RegionDTO,
  UpdateProductDTO,
  UpdateProductVariantDTO,
} from "@medusajs/framework/types";
import Redis from "ioredis";

function isEmptyObject(obj: Record<string, any>): boolean {
  return Object.keys(obj ?? {}).length === 0;
}

class UpdateMedusaService extends MedusaService({}) {
  productModuleService_: IProductModuleService;
  redisClient_: Redis;
  regionModuleService_: IRegionModuleService;
  logger: Logger;
  constructor(container: {
    productModuleService: IProductModuleService;
    regionModuleService: IRegionModuleService;
    redisConnection: Redis;
    logger: Logger;
  }) {
    super(container);
    this.redisClient_ = container.redisConnection;
    this.productModuleService_ = container.productModuleService;
    this.regionModuleService_ = container.regionModuleService;
    this.logger = container.logger;
  }

  async sendStrapiProductVariantToMedusa(
    variantEntry,
    variantId
  ): Promise<ProductVariantDTO> {
    const ignore = await shouldIgnore_(variantId, "medusa", this.redisClient_);
    if (ignore)
      throw new Error(
        "Invalid request, update is already done by another instance!!"
      );

    const variant = await this.productModuleService_.retrieveProductVariant(
      variantId
    );
    const update: Partial<UpdateProductVariantDTO> = {};

    if (variant.title !== variantEntry.title) {
      update["title"] = variantEntry.title;
    }

    if (isEmptyObject(update)) return variant;

    const updatedVariant =
      await this.productModuleService_.updateProductVariants(variantId, update);

    await addIgnore_(variantId, "strapi", this.redisClient_);
    return updatedVariant;
  }

  async sendStrapiProductToMedusa(
    productEntry,
    productId
  ): Promise<ProductDTO> {
    const ignore = await shouldIgnore_(productId, "medusa", this.redisClient_);
    if (ignore)
      throw new Error(
        "Invalid request, update is already done by another instance!!"
      );

    const product = await this.productModuleService_.retrieveProduct(productId);
    if (
      product.handle.toLowerCase().trim() !=
      productEntry.handle.toLowerCase().trim()
    ) {
      this.logger.error(`handle and id mismatch in strapi, `);
      throw new Error(
        "Synchronization Error - handles mismatched, please resync with strapi after dumping strapi database"
      );
    }
    const update: UpdateProductDTO = {};
    this.logger.debug("old data in medusa : " + JSON.stringify(product));
    this.logger.debug(
      "data received from strapi : " + JSON.stringify(productEntry)
    );
    const entryKeys = Object.keys(productEntry);
    for (const key of entryKeys) {
      if (
        !(productEntry[key] instanceof Object) &&
        !Array.isArray(productEntry[key])
      ) {
        if (
          product[key] != productEntry[key] &&
          key != "medusa_id" &&
          key != "id"
        )
          update[key] = productEntry[key];
      }
    }

    if (isEmptyObject(update)) return product;

    const updated = await this.productModuleService_.updateProducts(
      productId,
      update
    );

    await addIgnore_(productId, "strapi", this.redisClient_);
    return updated;
  }

  async sendStrapiRegionToMedusa(regionEntry, regionId): Promise<RegionDTO> {
    const ignore = await shouldIgnore_(regionId, "medusa", this.redisClient_);
    if (ignore)
      throw new Error(
        "Invalid request, update is already done by another instance!!"
      );

    const region = await this.regionModuleService_.retrieveRegion(regionId);
    const update = {};

    if (region.name !== regionEntry.name) {
      update["name"] = regionEntry.name;
    }
    if (isEmptyObject(update)) return region;

    const updated = await this.regionModuleService_.updateRegions(
      regionId,
      update
    );

    await addIgnore_(regionId, "strapi", this.redisClient_);
    return updated;
  }
}

export default UpdateMedusaService;
